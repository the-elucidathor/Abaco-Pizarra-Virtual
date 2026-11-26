import type { CanvasObject, LineObject, Point2D, ShapeObject } from '../types/whiteboard';
import { clamp, uid } from './id';
// OPT: 2.4 — Prefiltrado espacial en corte con cuchilla y recorte automático
import {
  getObjectExpandedBounds,
  queryObjectsInWorldBox,
} from './cad/cadSpatialIndex';
import { isOptEnabled, safeRunOpt } from './optFlags';

export function localToWorld(
  pt: Point2D,
  obj: { x: number; y: number; width: number; height: number; rotation: number }
): Point2D {
  const rad = ((obj.rotation || 0) * Math.PI) / 180;
  if (Math.abs(rad) < 1e-6) {
    return { x: obj.x + pt.x, y: obj.y + pt.y };
  }
  const cx = obj.width / 2;
  const cy = obj.height / 2;
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: obj.x + cx + dx * cos - dy * sin,
    y: obj.y + cy + dx * sin + dy * cos,
  };
}

export function worldToLocal(
  pt: Point2D,
  obj: { x: number; y: number; width: number; height: number; rotation: number }
): Point2D {
  const rad = -((obj.rotation || 0) * Math.PI) / 180;
  if (Math.abs(rad) < 1e-6) {
    return { x: pt.x - obj.x, y: pt.y - obj.y };
  }
  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: obj.width / 2 + dx * cos - dy * sin,
    y: obj.height / 2 + dx * sin + dy * cos,
  };
}

function regularPolyPts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  offsetRad = -Math.PI / 2
): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < sides; i++) {
    const ang = (i * 2 * Math.PI) / sides + offsetRad;
    pts.push({
      x: cx + rx * Math.cos(ang),
      y: cy + ry * Math.sin(ang),
    });
  }
  return pts;
}

export interface Solid3DHandleMeta {
  roleX: 'left' | 'right' | 'none';
  roleY: 'top' | 'bottom' | 'none';
  alphaX: number;
  alphaY: number;
}

export interface ShapeEditableGeometry {
  vertices: Point2D[];
  closed: boolean;
  canInsertEdgeMidpoints: boolean;
  mode: 'polygon' | 'polyline' | 'curve' | 'ellipse-cardinal' | 'solid-3d';
  solidHandles?: Solid3DHandleMeta[];
}

function buildSolid3DGeometry(
  vertices: Point2D[],
  roles: [Solid3DHandleMeta['roleX'], Solid3DHandleMeta['roleY']][],
  pad: number,
  iw: number,
  ih: number
): ShapeEditableGeometry {
  return {
    vertices,
    closed: true,
    canInsertEdgeMidpoints: false,
    mode: 'solid-3d',
    solidHandles: vertices.map((pt, idx) => ({
      roleX: roles[idx][0],
      roleY: roles[idx][1],
      alphaX: clamp((pt.x - pad) / Math.max(1, iw), 0, 1),
      alphaY: clamp((pt.y - pad) / Math.max(1, ih), 0, 1),
    })),
  };
}

export function getShapeEditableGeometry(obj: ShapeObject): ShapeEditableGeometry | null {
  const base = getUnflippedShapeEditableGeometry(obj);
  if (!base) return null;
  if (!obj.flipX && !obj.flipY) return base;

  const w = Math.max(10, obj.width);
  const h = Math.max(10, obj.height);
  const sw = obj.strokeWidth;
  const pad = sw / 2 + 2;
  const iw = Math.max(6, w - pad * 2);
  const ih = Math.max(6, h - pad * 2);

  const vertices = base.vertices.map((pt) => ({
    x: obj.flipX ? w - pt.x : pt.x,
    y: obj.flipY ? h - pt.y : pt.y,
  }));

  const solidHandles = base.solidHandles?.map((hm, idx) => {
    const pt = vertices[idx];
    const roleX = obj.flipX
      ? hm.roleX === 'left'
        ? 'right'
        : hm.roleX === 'right'
        ? 'left'
        : 'none'
      : hm.roleX;
    const roleY = obj.flipY
      ? hm.roleY === 'top'
        ? 'bottom'
        : hm.roleY === 'bottom'
        ? 'top'
        : 'none'
      : hm.roleY;
    return {
      roleX,
      roleY,
      alphaX: clamp((pt.x - pad) / Math.max(1, iw), 0, 1),
      alphaY: clamp((pt.y - pad) / Math.max(1, ih), 0, 1),
    };
  });

  return {
    ...base,
    vertices,
    solidHandles,
  };
}

function getUnflippedShapeEditableGeometry(obj: ShapeObject): ShapeEditableGeometry | null {
  const w = Math.max(10, obj.width);
  const h = Math.max(10, obj.height);
  const sw = obj.strokeWidth;
  const pad = sw / 2 + 2;
  const iw = Math.max(6, w - pad * 2);
  const ih = Math.max(6, h - pad * 2);

  if (obj.shapeKind === 'custom-polygon' || (obj.customVertices && obj.customVertices.length >= 2)) {
    const verts =
      obj.customVertices && obj.customVertices.length >= 2
        ? obj.customVertices
        : [
            { x: pad, y: pad },
            { x: pad + iw, y: pad },
            { x: pad + iw, y: pad + ih },
            { x: pad, y: pad + ih },
          ];
    return {
      vertices: verts,
      closed: true,
      canInsertEdgeMidpoints: verts.length >= 3,
      mode: 'polygon',
    };
  }

  switch (obj.shapeKind) {
    case 'rectangle':
    case 'square':
    case 'rounded-rect':
      return {
        vertices: [
          { x: pad, y: pad },
          { x: pad + iw, y: pad },
          { x: pad + iw, y: pad + ih },
          { x: pad, y: pad + ih },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'triangle':
      return {
        vertices: [
          { x: w / 2, y: pad },
          { x: w - pad, y: h - pad },
          { x: pad, y: h - pad },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'right-triangle':
      return {
        vertices: [
          { x: pad, y: pad },
          { x: w - pad, y: h - pad },
          { x: pad, y: h - pad },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'right-trapezoid':
      return {
        vertices: [
          { x: pad, y: pad },
          { x: pad + iw * 0.72, y: pad },
          { x: w - pad, y: h - pad },
          { x: pad, y: h - pad },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'trapezoid':
      return {
        vertices: [
          { x: pad + iw * 0.2, y: pad },
          { x: pad + iw * 0.8, y: pad },
          { x: w - pad, y: h - pad },
          { x: pad, y: h - pad },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'parallelogram':
      return {
        vertices: [
          { x: pad + iw * 0.25, y: pad },
          { x: w - pad, y: pad },
          { x: pad + iw * 0.75, y: h - pad },
          { x: pad, y: h - pad },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'diamond':
      return {
        vertices: [
          { x: w / 2, y: pad },
          { x: w - pad, y: h / 2 },
          { x: w / 2, y: h - pad },
          { x: pad, y: h / 2 },
        ],
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'pentagon':
      return {
        vertices: regularPolyPts(w / 2, h / 2, iw / 2, ih / 2, 5),
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'hexagon':
      return {
        vertices: regularPolyPts(w / 2, h / 2, iw / 2, ih / 2, 6, 0),
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'octagon':
      return {
        vertices: regularPolyPts(w / 2, h / 2, iw / 2, ih / 2, 8, Math.PI / 8),
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    case 'polygon': {
      const sides = Math.max(3, obj.polygonSides || 6);
      return {
        vertices: regularPolyPts(w / 2, h / 2, iw / 2, ih / 2, sides),
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    }
    case 'star': {
      const verts: Point2D[] = [];
      for (let i = 0; i < 10; i++) {
        const ang = (i * Math.PI) / 5 - Math.PI / 2;
        const rScale = i % 2 === 0 ? 1 : 0.42;
        verts.push({
          x: w / 2 + (iw / 2) * rScale * Math.cos(ang),
          y: h / 2 + (ih / 2) * rScale * Math.sin(ang),
        });
      }
      return {
        vertices: verts,
        closed: true,
        canInsertEdgeMidpoints: true,
        mode: 'polygon',
      };
    }
    case 'circle':
    case 'ellipse':
      return {
        vertices: [
          { x: w / 2, y: pad },
          { x: pad + iw, y: h / 2 },
          { x: w / 2, y: pad + ih },
          { x: pad, y: h / 2 },
        ],
        closed: true,
        canInsertEdgeMidpoints: false,
        mode: 'ellipse-cardinal',
      };
    case 'curve': {
      const pts =
        obj.customPoints && obj.customPoints.length === 3
          ? obj.customPoints
          : [
              { x: pad, y: h - pad },
              { x: w / 2, y: pad - h * 0.35 },
              { x: w - pad, y: h - pad },
            ];
      return {
        vertices: pts,
        closed: false,
        canInsertEdgeMidpoints: false,
        mode: 'curve',
      };
    }
    case 'polyline': {
      const pts =
        obj.customPoints && obj.customPoints.length >= 2
          ? obj.customPoints
          : [
              { x: pad, y: h - pad },
              { x: w * 0.38, y: pad },
              { x: w * 0.65, y: h * 0.68 },
              { x: w - pad, y: pad + 4 },
            ];
      return {
        vertices: pts,
        closed: false,
        canInsertEdgeMidpoints: true,
        mode: 'polyline',
      };
    }
    // 3D solids: editable edge/corner points preserve shapeKind & dashed depth details
    case 'cube':
    case 'cube-wire': {
      const dx = iw * 0.25;
      const dy = ih * 0.22;
      const fx = pad;
      const fy = pad + dy;
      const fw = iw - dx;
      const fh = ih - dy;
      return buildSolid3DGeometry(
        [
          { x: fx, y: fy },
          { x: fx + dx, y: pad },
          { x: w - pad, y: pad },
          { x: w - pad, y: pad + fh },
          { x: fx + fw, y: fy + fh },
          { x: fx, y: fy + fh },
        ],
        [
          ['left', 'top'],
          ['none', 'top'],
          ['right', 'top'],
          ['right', 'bottom'],
          ['right', 'bottom'],
          ['left', 'bottom'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'oblique-prism': {
      const dx = iw * 0.26;
      const dy = ih * 0.22;
      const skew = iw * 0.14;
      const topY = pad;
      const frontTopY = pad + dy;
      const botY = h - pad;
      return buildSolid3DGeometry(
        [
          { x: pad + skew, y: frontTopY },
          { x: pad + skew + dx, y: topY },
          { x: w - pad, y: topY },
          { x: w - pad - skew, y: botY - dy },
          { x: w - pad - dx - skew, y: botY },
          { x: pad, y: botY },
        ],
        [
          ['left', 'top'],
          ['none', 'top'],
          ['right', 'top'],
          ['right', 'bottom'],
          ['none', 'bottom'],
          ['left', 'bottom'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'cylinder':
      return buildSolid3DGeometry(
        [
          { x: w / 2, y: pad },
          { x: w - pad, y: h / 2 },
          { x: w / 2, y: h - pad },
          { x: pad, y: h / 2 },
        ],
        [
          ['none', 'top'],
          ['right', 'none'],
          ['none', 'bottom'],
          ['left', 'none'],
        ],
        pad,
        iw,
        ih
      );
    case 'square-pyramid':
      return buildSolid3DGeometry(
        [
          { x: w * 0.5, y: pad },
          { x: w - pad, y: h - pad - ih * 0.14 },
          { x: w * 0.44, y: h - pad },
          { x: pad, y: h - pad - ih * 0.12 },
        ],
        [
          ['none', 'top'],
          ['right', 'bottom'],
          ['none', 'bottom'],
          ['left', 'bottom'],
        ],
        pad,
        iw,
        ih
      );
    case 'cone': {
      const ry = Math.max(4, ih * 0.15);
      const botCy = h - pad - ry;
      return buildSolid3DGeometry(
        [
          { x: w / 2, y: pad },
          { x: w - pad, y: botCy },
          { x: w / 2, y: h - pad },
          { x: pad, y: botCy },
        ],
        [
          ['none', 'top'],
          ['right', 'none'],
          ['none', 'bottom'],
          ['left', 'none'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'sphere':
      return buildSolid3DGeometry(
        [
          { x: w / 2, y: pad },
          { x: w - pad, y: h / 2 },
          { x: w / 2, y: h - pad },
          { x: pad, y: h / 2 },
        ],
        [
          ['none', 'top'],
          ['right', 'none'],
          ['none', 'bottom'],
          ['left', 'none'],
        ],
        pad,
        iw,
        ih
      );
    case 'tetrahedron':
      return buildSolid3DGeometry(
        [
          { x: w * 0.56, y: pad },
          { x: w - pad, y: h - pad - ih * 0.24 },
          { x: w * 0.45, y: h - pad },
          { x: pad, y: h - pad - ih * 0.14 },
        ],
        [
          ['none', 'top'],
          ['right', 'bottom'],
          ['none', 'bottom'],
          ['left', 'bottom'],
        ],
        pad,
        iw,
        ih
      );
    case 'triangular-prism': {
      const t1 = { x: pad + iw * 0.22, y: pad };
      const t2 = { x: w - pad, y: pad + ih * 0.18 };
      const t3 = { x: pad, y: pad + ih * 0.32 };
      const b2 = { x: t2.x, y: h - pad - ih * 0.1 };
      const b3 = { x: pad + iw * 0.12, y: h - pad };
      return buildSolid3DGeometry(
        [t1, t2, b2, b3, t3],
        [
          ['left', 'top'],
          ['right', 'top'],
          ['right', 'bottom'],
          ['left', 'bottom'],
          ['left', 'none'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'hex-pyramid': {
      const apex = { x: w / 2, y: pad };
      const cy = h - pad - ih * 0.16;
      const rx = iw / 2;
      const ry = ih * 0.16;
      const ptAt = (i: number) => {
        const ang = (i * Math.PI) / 3;
        return { x: w / 2 + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) };
      };
      return buildSolid3DGeometry(
        [apex, ptAt(0), ptAt(1), ptAt(2), ptAt(3)],
        [
          ['none', 'top'],
          ['right', 'none'],
          ['right', 'bottom'],
          ['left', 'bottom'],
          ['left', 'none'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'hex-prism': {
      const rx = iw / 2;
      const ry = ih * 0.16;
      const topCy = pad + ry;
      const botCy = h - pad - ry;
      const topAt = (i: number) => {
        const ang = (i * Math.PI) / 3;
        return { x: w / 2 + rx * Math.cos(ang), y: topCy + ry * Math.sin(ang) };
      };
      const botAt = (i: number) => {
        const ang = (i * Math.PI) / 3;
        return { x: w / 2 + rx * Math.cos(ang), y: botCy + ry * Math.sin(ang) };
      };
      return buildSolid3DGeometry(
        [topAt(4), topAt(5), topAt(0), botAt(0), botAt(1), botAt(2), botAt(3), topAt(3)],
        [
          ['left', 'top'],
          ['right', 'top'],
          ['right', 'top'],
          ['right', 'bottom'],
          ['right', 'bottom'],
          ['left', 'bottom'],
          ['left', 'bottom'],
          ['left', 'top'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'octahedron':
      return buildSolid3DGeometry(
        [
          { x: w / 2, y: pad },
          { x: w - pad, y: h / 2 },
          { x: w / 2, y: h - pad },
          { x: pad, y: h / 2 },
        ],
        [
          ['none', 'top'],
          ['right', 'none'],
          ['none', 'bottom'],
          ['left', 'none'],
        ],
        pad,
        iw,
        ih
      );
    case 'frustum-pyramid': {
      const tl = { x: pad + iw * 0.24, y: pad + ih * 0.08 };
      const tr = { x: pad + iw * 0.76, y: pad + ih * 0.08 };
      const tfl = { x: pad + iw * 0.18, y: pad + ih * 0.18 };
      const bl = { x: pad, y: h - pad - ih * 0.08 };
      const bf = { x: pad + iw * 0.72, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.14 };
      return buildSolid3DGeometry(
        [tl, tr, br, bf, bl, tfl],
        [
          ['left', 'top'],
          ['right', 'top'],
          ['right', 'bottom'],
          ['right', 'bottom'],
          ['left', 'bottom'],
          ['left', 'top'],
        ],
        pad,
        iw,
        ih
      );
    }
    case 'frustum-cone': {
      const topRx = iw * 0.26;
      const topRy = Math.max(3, ih * 0.09);
      const botRy = Math.max(4, ih * 0.14);
      const topCy = pad + topRy;
      const botCy = h - pad - botRy;
      return buildSolid3DGeometry(
        [
          { x: w / 2, y: pad },
          { x: w / 2 + topRx, y: topCy },
          { x: w - pad, y: botCy },
          { x: w / 2, y: h - pad },
          { x: pad, y: botCy },
          { x: w / 2 - topRx, y: topCy },
        ],
        [
          ['none', 'top'],
          ['right', 'top'],
          ['right', 'none'],
          ['none', 'bottom'],
          ['left', 'none'],
          ['left', 'top'],
        ],
        pad,
        iw,
        ih
      );
    }
    default:
      return null;
  }
}

export function getShapeCutPolygonWorld(
  obj: ShapeObject
): { pts: Point2D[]; closed: boolean } | null {
  const w = Math.max(10, obj.width);
  const h = Math.max(10, obj.height);
  const sw = obj.strokeWidth;
  const pad = sw / 2 + 2;
  const iw = Math.max(6, w - pad * 2);
  const ih = Math.max(6, h - pad * 2);

  let localPts: Point2D[] = [];
  let closed = true;

  if (obj.shapeKind === 'custom-polygon' || (obj.customVertices && obj.customVertices.length >= 3)) {
    localPts = obj.customVertices ? [...obj.customVertices] : [];
  } else if (obj.shapeKind === 'circle' || obj.shapeKind === 'ellipse' || obj.shapeKind === 'sphere') {
    const cx = w / 2;
    const cy = h / 2;
    const rx = iw / 2;
    const ry = ih / 2;
    for (let i = 0; i < 48; i++) {
      const ang = (i * 2 * Math.PI) / 48;
      localPts.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) });
    }
  } else if (obj.shapeKind === 'semicircle') {
    const rx = iw / 2;
    const ry = ih * 0.72;
    const baseY = h - pad - ih * 0.14;
    const cx = w / 2;
    for (let i = 0; i <= 24; i++) {
      const ang = Math.PI + (i * Math.PI) / 24;
      localPts.push({ x: cx + rx * Math.cos(ang), y: baseY + ry * Math.sin(ang) });
    }
  } else if (obj.shapeKind === 'sector') {
    const sx = pad;
    const sy = h - pad;
    localPts.push({ x: sx, y: sy });
    for (let i = 0; i <= 20; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / (2 * 20);
      localPts.push({ x: sx + iw * Math.cos(ang), y: sy + ih * Math.sin(ang) });
    }
  } else if (obj.shapeKind === 'curve') {
    closed = false;
    const p0 = obj.customPoints?.[0] ?? { x: pad, y: h - pad };
    const p1 = obj.customPoints?.[1] ?? { x: w / 2, y: pad - h * 0.35 };
    const p2 = obj.customPoints?.[2] ?? { x: w - pad, y: h - pad };
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const mt = 1 - t;
      localPts.push({
        x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
        y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
      });
    }
  } else if (obj.shapeKind === 'arc') {
    closed = false;
    const cx = w / 2;
    const cy = h / 2;
    const rx = Math.max(4, w / 2 - 4);
    const ry = Math.max(4, h / 2 - 4);
    const startAngle = obj.arcStartAngle ?? 0;
    const endAngle = obj.arcEndAngle ?? 220;
    const diff = (((endAngle - startAngle) % 360) + 360) % 360;
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const deg = startAngle + (diff * i) / steps;
      const rad = ((deg - 90) * Math.PI) / 180;
      localPts.push({ x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) });
    }
  } else if (obj.shapeKind === 'cylinder') {
    const rx = iw / 2;
    const ry = Math.max(4, ih * 0.15);
    const topCy = pad + ry;
    const botCy = h - pad - ry;
    for (let i = 0; i <= 16; i++) {
      const ang = Math.PI + (i * Math.PI) / 16;
      localPts.push({ x: w / 2 + rx * Math.cos(ang), y: topCy + ry * Math.sin(ang) });
    }
    for (let i = 0; i <= 16; i++) {
      const ang = (i * Math.PI) / 16;
      localPts.push({ x: w / 2 + rx * Math.cos(ang), y: botCy + ry * Math.sin(ang) });
    }
  } else if (obj.shapeKind === 'cone') {
    const rx = iw / 2;
    const ry = Math.max(4, ih * 0.15);
    const botCy = h - pad - ry;
    localPts.push({ x: w / 2, y: pad });
    for (let i = 16; i >= 0; i--) {
      const ang = (i * Math.PI) / 16;
      localPts.push({ x: w / 2 + rx * Math.cos(ang), y: botCy + ry * Math.sin(ang) });
    }
  } else if (obj.shapeKind === 'frustum-cone') {
    const topRx = iw * 0.26;
    const topRy = Math.max(3, ih * 0.09);
    const botRx = iw / 2;
    const botRy = Math.max(4, ih * 0.14);
    const topCy = pad + topRy;
    const botCy = h - pad - botRy;
    for (let i = 0; i <= 12; i++) {
      const ang = Math.PI + (i * Math.PI) / 12;
      localPts.push({ x: w / 2 + topRx * Math.cos(ang), y: topCy + topRy * Math.sin(ang) });
    }
    for (let i = 0; i <= 16; i++) {
      const ang = (i * Math.PI) / 16;
      localPts.push({ x: w / 2 + botRx * Math.cos(ang), y: botCy + botRy * Math.sin(ang) });
    }
  } else {
    const info = getShapeEditableGeometry(obj);
    if (!info) return null;
    if (info.vertices.length < 2) return null;
    return {
      pts: info.vertices.map((p) => localToWorld(p, obj)),
      closed: info.closed,
    };
  }

  if (localPts.length < 2) return null;
  const flippedPts =
    obj.flipX || obj.flipY
      ? localPts.map((p) => ({
          x: obj.flipX ? w - p.x : p.x,
          y: obj.flipY ? h - p.y : p.y,
        }))
      : localPts;
  return {
    pts: flippedPts.map((p) => localToWorld(p, obj)),
    closed,
  };
}

export function pointToSegmentDistance(
  p: Point2D,
  a: Point2D,
  b: Point2D
): { dist: number; t: number; closest: Point2D } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) {
    return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0, closest: { x: a.x, y: a.y } };
  }
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: Math.hypot(p.x - closest.x, p.y - closest.y), t, closest };
}

export function segmentSegmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  eps = 1e-6
): { x: number; y: number; t: number; u: number } | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-9) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = (dx * dby - dy * dbx) / denom;
  const u = (dx * day - dy * dax) / denom;
  if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
    const ct = clamp(t, 0, 1);
    return {
      x: a1.x + ct * dax,
      y: a1.y + ct * day,
      t: ct,
      u: clamp(u, 0, 1),
    };
  }
  return null;
}

export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return area / 2;
}

function ensureCCW(poly: Point2D[]): Point2D[] {
  return polygonArea(poly) < 0 ? [...poly].reverse() : [...poly];
}

function cleanPolygonVertices(poly: Point2D[]): Point2D[] {
  const res: Point2D[] = [];
  for (const p of poly) {
    if (res.length === 0 || Math.hypot(p.x - res[res.length - 1].x, p.y - res[res.length - 1].y) > 0.4) {
      res.push(p);
    }
  }
  if (
    res.length >= 2 &&
    Math.hypot(res[0].x - res[res.length - 1].x, res[0].y - res[res.length - 1].y) <= 0.4
  ) {
    res.pop();
  }
  return res;
}

/**
 * Splits a general simple closed polygon (convex or concave) by the cut segment A->B.
 * Requires the finite segment A->B to cross the polygon boundary at >= 2 points.
 */
export function splitPolygonByCutSegment(
  rawPoly: Point2D[],
  cutA: Point2D,
  cutB: Point2D,
  requireSegmentCrossing = true
): { polygons: Point2D[][]; intersections: Point2D[] } {
  const poly = cleanPolygonVertices(ensureCCW(rawPoly));
  if (poly.length < 3) return { polygons: [], intersections: [] };

  const dx = cutB.x - cutA.x;
  const dy = cutB.y - cutA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return { polygons: [], intersections: [] };

  const dir = { x: dx / len, y: dy / len };
  const norm = { x: -dir.y, y: dir.x };

  // First count finite segment intersections with polygon edges
  const finiteHits: Point2D[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const hit = segmentSegmentIntersection(cutA, cutB, a, b, 1e-4);
    if (hit) {
      if (!finiteHits.some((h) => Math.hypot(h.x - hit.x, h.y - hit.y) < 1.5)) {
        finiteHits.push({ x: hit.x, y: hit.y });
      }
    }
  }

  if (requireSegmentCrossing && finiteHits.length < 2) {
    return { polygons: [], intersections: [] };
  }

  // Perturb infinite line slightly if any vertex sits practically on it (avoids vertex-on-line degeneracy)
  let baseA = { ...cutA };
  for (let attempt = 0; attempt < 6; attempt++) {
    const hasZero = poly.some((v) => Math.abs((v.x - baseA.x) * norm.x + (v.y - baseA.y) * norm.y) < 1e-3);
    if (!hasZero) break;
    baseA = {
      x: cutA.x + norm.x * (0.017 * (attempt + 1)),
      y: cutA.y + norm.y * (0.017 * (attempt + 1)),
    };
  }

  interface RingNode {
    pt: Point2D;
    isInter: boolean;
    side: 1 | -1 | 0;
    s: number; // projection along dir from baseA
    edgeIdx: number;
    edgeT: number;
    mateIdx?: number;
  }

  const ring: RingNode[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    const d1 = (p1.x - baseA.x) * norm.x + (p1.y - baseA.y) * norm.y;
    const d2 = (p2.x - baseA.x) * norm.x + (p2.y - baseA.y) * norm.y;
    ring.push({
      pt: p1,
      isInter: false,
      side: d1 >= 0 ? 1 : -1,
      s: (p1.x - baseA.x) * dir.x + (p1.y - baseA.y) * dir.y,
      edgeIdx: i,
      edgeT: 0,
    });
    if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
      const t = d1 / (d1 - d2);
      const ix = p1.x + t * (p2.x - p1.x);
      const iy = p1.y + t * (p2.y - p1.y);
      ring.push({
        pt: { x: ix, y: iy },
        isInter: true,
        side: 0,
        s: (ix - baseA.x) * dir.x + (iy - baseA.y) * dir.y,
        edgeIdx: i,
        edgeT: t,
      });
    }
  }

  const interIndices = ring
    .map((n, idx) => (n.isInter ? idx : -1))
    .filter((idx) => idx >= 0)
    .sort((a, b) => ring[a].s - ring[b].s);

  if (interIndices.length < 2 || interIndices.length % 2 !== 0) {
    return { polygons: [], intersections: [] };
  }

  // Pair intersections along cut line: (0,1), (2,3), ...
  for (let k = 0; k < interIndices.length; k += 2) {
    const i1 = interIndices[k];
    const i2 = interIndices[k + 1];
    ring[i1].mateIdx = i2;
    ring[i2].mateIdx = i1;
  }

  const collectSidePolygons = (targetSide: 1 | -1): Point2D[][] => {
    const visitedStartEdge = new Set<number>();
    const polys: Point2D[][] = [];

    for (const startIdx of interIndices) {
      const nextIdx = (startIdx + 1) % ring.length;
      if (ring[nextIdx].side !== targetSide && !(ring[nextIdx].isInter && isMidpointOnSide(ring, startIdx, nextIdx, poly, baseA, norm, targetSide))) {
        continue;
      }
      if (visitedStartEdge.has(startIdx)) continue;

      const outPts: Point2D[] = [];
      let cur = startIdx;
      let guard = 0;
      let closedCleanly = false;

      while (guard++ < ring.length * 4) {
        if (ring[cur].isInter) {
          if (cur === startIdx && outPts.length > 0) {
            closedCleanly = true;
            break;
          }
          if (visitedStartEdge.has(cur)) break;
          visitedStartEdge.add(cur);
        }
        outPts.push(ring[cur].pt);

        // Follow boundary arc until next intersection
        let walk = (cur + 1) % ring.length;
        let walkGuard = 0;
        while (!ring[walk].isInter && walkGuard++ < ring.length) {
          outPts.push(ring[walk].pt);
          walk = (walk + 1) % ring.length;
        }
        outPts.push(ring[walk].pt);

        const mate = ring[walk].mateIdx;
        if (mate === undefined) break;
        if (mate === startIdx) {
          closedCleanly = true;
          break;
        }
        cur = mate;
      }

      if (closedCleanly) {
        const cleaned = cleanPolygonVertices(outPts);
        if (cleaned.length >= 3 && Math.abs(polygonArea(cleaned)) >= 20) {
          polys.push(cleaned);
        }
      }
    }

    return polys;
  };

  const posPolys = collectSidePolygons(1);
  const negPolys = collectSidePolygons(-1);
  const allPolys = [...posPolys, ...negPolys];

  if (allPolys.length < 2) {
    return { polygons: [], intersections: [] };
  }

  return {
    polygons: allPolys,
    intersections: interIndices.map((idx) => ring[idx].pt),
  };
}

function isMidpointOnSide(
  ring: { pt: Point2D }[],
  idxA: number,
  idxB: number,
  _poly: Point2D[],
  baseA: Point2D,
  norm: Point2D,
  targetSide: 1 | -1
): boolean {
  const mx = (ring[idxA].pt.x + ring[idxB].pt.x) / 2;
  const my = (ring[idxA].pt.y + ring[idxB].pt.y) / 2;
  const d = (mx - baseA.x) * norm.x + (my - baseA.y) * norm.y;
  return targetSide === 1 ? d >= 0 : d < 0;
}

export function buildShapeObjectFromWorldPolygon(
  template: ShapeObject,
  worldPoly: Point2D[],
  id: string,
  zIndex: number
): ShapeObject {
  const pad = template.strokeWidth / 2 + 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of worldPoly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX - pad;
  const y = minY - pad;
  const width = Math.max(12, maxX - minX + pad * 2);
  const height = Math.max(12, maxY - minY + pad * 2);
  const customVertices = worldPoly.map((p) => ({ x: p.x - x, y: p.y - y }));

  return {
    ...template,
    id,
    shapeKind: 'custom-polygon',
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex,
    customPoints: undefined,
    customVertices,
    flipX: undefined,
    flipY: undefined,
  };
}

export function buildPolylineShapeFromWorldPoints(
  template: ShapeObject,
  worldPts: Point2D[],
  id: string,
  zIndex: number
): ShapeObject {
  const pad = template.strokeWidth / 2 + 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of worldPts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = minX - pad;
  const y = minY - pad;
  const width = Math.max(12, maxX - minX + pad * 2);
  const height = Math.max(12, maxY - minY + pad * 2);
  const customPoints = worldPts.map((p) => ({ x: p.x - x, y: p.y - y }));

  return {
    ...template,
    id,
    shapeKind: 'polyline',
    fillColor: 'transparent',
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex,
    customVertices: undefined,
    customPoints,
    flipX: undefined,
    flipY: undefined,
  };
}

export function buildLineObjectFromWorldEndpoints(
  template: LineObject,
  startWorld: Point2D,
  endWorld: Point2D,
  id: string,
  zIndex: number,
  controlWorld?: Point2D
): LineObject {
  const pts = controlWorld ? [startWorld, endWorld, controlWorld] : [startWorld, endWorld];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const width = Math.max(16, maxX - minX);
  const height = Math.max(16, maxY - minY);
  return {
    ...template,
    id,
    x: minX,
    y: minY,
    width,
    height,
    rotation: 0,
    zIndex,
    startPoint: { x: startWorld.x - minX, y: startWorld.y - minY },
    endPoint: { x: endWorld.x - minX, y: endWorld.y - minY },
    controlPoint: controlWorld
      ? { x: controlWorld.x - minX, y: controlWorld.y - minY }
      : undefined,
  };
}

export function getLineWorldSegments(obj: LineObject): { pts: Point2D[]; isPolyline: boolean } {
  const s = localToWorld(obj.startPoint, obj);
  const e = localToWorld(obj.endPoint, obj);

  if (obj.lineKind === 'orthogonal') {
    const midX = (obj.startPoint.x + obj.endPoint.x) / 2;
    const m1 = localToWorld({ x: midX, y: obj.startPoint.y }, obj);
    const m2 = localToWorld({ x: midX, y: obj.endPoint.y }, obj);
    return { pts: [s, m1, m2, e], isPolyline: true };
  }

  if (obj.lineKind === 'connector') {
    const ctrl = obj.controlPoint || {
      x: (obj.startPoint.x + obj.endPoint.x) / 2,
      y: (obj.startPoint.y + obj.endPoint.y) / 2 - 36,
    };
    const c = localToWorld(ctrl, obj);
    const sampled: Point2D[] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const mt = 1 - t;
      sampled.push({
        x: mt * mt * s.x + 2 * mt * t * c.x + t * t * e.x,
        y: mt * mt * s.y + 2 * mt * t * c.y + t * t * e.y,
      });
    }
    return { pts: sampled, isPolyline: true };
  }

  return { pts: [s, e], isPolyline: false };
}

function splitOpenPolylineByCutSegment(
  pts: Point2D[],
  cutA: Point2D,
  cutB: Point2D
): { chains: Point2D[][]; intersections: Point2D[] } {
  if (pts.length < 2) return { chains: [], intersections: [] };
  const chains: Point2D[][] = [];
  const intersections: Point2D[] = [];
  let current: Point2D[] = [pts[0]];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    // Find all intersections on this segment (at most 1 non-collinear)
    const hit = segmentSegmentIntersection(a, b, cutA, cutB, 1e-4);
    if (hit && hit.t > 0.02 && hit.t < 0.98) {
      const interPt = { x: hit.x, y: hit.y };
      intersections.push(interPt);
      current.push(interPt);
      if (current.length >= 2) {
        chains.push(current);
      }
      current = [interPt];
    }
    current.push(b);
  }
  if (current.length >= 2) {
    chains.push(current);
  }

  return {
    chains: intersections.length > 0 ? chains : [],
    intersections,
  };
}

export interface BladeCutPlan {
  deleteIds: string[];
  addObjects: CanvasObject[];
  intersections: Point2D[];
}

export function computeBladeCut(
  cutA: Point2D,
  cutB: Point2D,
  candidateObjects: CanvasObject[],
  startZIndex: number
): BladeCutPlan {
  if (Math.hypot(cutB.x - cutA.x, cutB.y - cutA.y) < 8) {
    return { deleteIds: [], addObjects: [], intersections: [] };
  }

  const deleteIds: string[] = [];
  const addObjects: CanvasObject[] = [];
  const intersections: Point2D[] = [];
  let z = startZIndex;

  // OPT: 2.4 — Consulta espacial del segmento de corte
  const cutMinX = Math.min(cutA.x, cutB.x) - 16;
  const cutMinY = Math.min(cutA.y, cutB.y) - 16;
  const cutMaxX = Math.max(cutA.x, cutB.x) + 16;
  const cutMaxY = Math.max(cutA.y, cutB.y) + 16;
  const scopedCandidates =
    candidateObjects.length > 24 && isOptEnabled('spatialIndex')
      ? safeRunOpt(
          'spatialIndex',
          () => queryObjectsInWorldBox(candidateObjects, cutMinX, cutMinY, cutMaxX, cutMaxY),
          () => candidateObjects
        )
      : candidateObjects;

  for (const obj of scopedCandidates) {
    if (obj.type === 'line') {
      const s = localToWorld(obj.startPoint, obj);
      const e = localToWorld(obj.endPoint, obj);
      if (obj.lineKind === 'orthogonal' || obj.lineKind === 'connector') {
        const { pts } = getLineWorldSegments(obj);
        const res = splitOpenPolylineByCutSegment(pts, cutA, cutB);
        if (res.intersections.length > 0 && res.chains.length >= 2) {
          deleteIds.push(obj.id);
          intersections.push(...res.intersections);
          const tmplShape: ShapeObject = {
            id: '',
            type: 'shape',
            shapeKind: 'polyline',
            layerId: obj.layerId,
            x: obj.x,
            y: obj.y,
            width: obj.width,
            height: obj.height,
            rotation: 0,
            opacity: obj.opacity,
            locked: false,
            zIndex: obj.zIndex,
            strokeColor: obj.strokeColor,
            fillColor: 'transparent',
            strokeWidth: obj.strokeWidth,
            strokeStyle: obj.strokeStyle,
          };
          for (const ch of res.chains) {
            addObjects.push(buildPolylineShapeFromWorldPoints(tmplShape, ch, uid('shp'), z++));
          }
        }
      } else {
        const hit = segmentSegmentIntersection(s, e, cutA, cutB, 1e-4);
        if (hit && hit.t > 0.02 && hit.t < 0.98) {
          const splitPt = { x: hit.x, y: hit.y };
          deleteIds.push(obj.id);
          intersections.push(splitPt);
          addObjects.push(buildLineObjectFromWorldEndpoints(obj, s, splitPt, uid('line'), z++));
          addObjects.push(buildLineObjectFromWorldEndpoints(obj, splitPt, e, uid('line'), z++));
        }
      }
      continue;
    }

    if (obj.type === 'shape') {
      const geom = getShapeCutPolygonWorld(obj);
      if (!geom) continue;
      if (!geom.closed) {
        const res = splitOpenPolylineByCutSegment(geom.pts, cutA, cutB);
        if (res.intersections.length > 0 && res.chains.length >= 2) {
          deleteIds.push(obj.id);
          intersections.push(...res.intersections);
          for (const ch of res.chains) {
            addObjects.push(buildPolylineShapeFromWorldPoints(obj, ch, uid('shp'), z++));
          }
        }
      } else {
        const split = splitPolygonByCutSegment(geom.pts, cutA, cutB, true);
        if (split.polygons.length >= 2) {
          deleteIds.push(obj.id);
          intersections.push(...split.intersections);
          for (const subPoly of split.polygons) {
            addObjects.push(buildShapeObjectFromWorldPolygon(obj, subPoly, uid('shp'), z++));
          }
        }
      }
    }
  }

  return { deleteIds, addObjects, intersections };
}

export interface AutoTrimPreview {
  targetId: string;
  highlightSegments: [Point2D, Point2D][];
  highlightPolygon?: Point2D[];
  intersectionPoints: Point2D[];
  replacements: CanvasObject[];
}

function collectBoundarySegments(
  objects: CanvasObject[],
  excludeId: string,
  targetObj?: CanvasObject
): { a: Point2D; b: Point2D; sourceId: string }[] {
  // OPT: 2.4 — Solo inspecciona objetos cuya caja intersecta el objeto objetivo
  let scoped = objects;
  if (targetObj && objects.length > 24 && isOptEnabled('spatialIndex')) {
    scoped = safeRunOpt(
      'spatialIndex',
      () => {
        const tb = getObjectExpandedBounds(targetObj);
        return queryObjectsInWorldBox(objects, tb.minX, tb.minY, tb.maxX, tb.maxY, [excludeId]);
      },
      () => objects
    );
  }
  const segs: { a: Point2D; b: Point2D; sourceId: string }[] = [];
  for (const obj of scoped) {
    if (obj.id === excludeId) continue;
    if (obj.type === 'line') {
      const { pts } = getLineWorldSegments(obj);
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], sourceId: obj.id });
      }
    } else if (obj.type === 'shape') {
      const geom = getShapeCutPolygonWorld(obj);
      if (!geom) continue;
      const count = geom.closed ? geom.pts.length : geom.pts.length - 1;
      for (let i = 0; i < count; i++) {
        segs.push({
          a: geom.pts[i],
          b: geom.pts[(i + 1) % geom.pts.length],
          sourceId: obj.id,
        });
      }
    }
  }
  return segs;
}

/**
 * Technical drafting TRIM on hover/click at `clickWorld`.
 * - Clicking a line/polyline segment between intersections trims/deletes only that span.
 * - Clicking a shape half cut by another intersecting line (or shape edge) trims away the clicked half.
 */
export function computeAutoTrimAtPoint(
  clickWorld: Point2D,
  candidateObjects: CanvasObject[],
  tolerance: number,
  startZIndex: number
): AutoTrimPreview | null {
  // OPT: 2.4 — Prefiltrado espacial alrededor del punto del cursor
  const nearClickObjects =
    candidateObjects.length > 24 && isOptEnabled('spatialIndex')
      ? safeRunOpt(
          'spatialIndex',
          () =>
            queryObjectsInWorldBox(
              candidateObjects,
              clickWorld.x - tolerance - 8,
              clickWorld.y - tolerance - 8,
              clickWorld.x + tolerance + 8,
              clickWorld.y + tolerance + 8
            ),
          () => candidateObjects
        )
      : candidateObjects;

  // 1. Check LineObjects & open ShapeObjects (polyline/arc/curve) first if click is near their stroke
  let bestLineHit: { obj: LineObject; dist: number; t: number } | null = null;
  for (const obj of nearClickObjects) {
    if (obj.type !== 'line') continue;
    if (obj.lineKind === 'connector' || obj.lineKind === 'orthogonal') continue;
    const s = localToWorld(obj.startPoint, obj);
    const e = localToWorld(obj.endPoint, obj);
    const d = pointToSegmentDistance(clickWorld, s, e);
    if (d.dist <= tolerance && (!bestLineHit || d.dist < bestLineHit.dist)) {
      bestLineHit = { obj, dist: d.dist, t: d.t };
    }
  }

  if (bestLineHit) {
    const lineObj = bestLineHit.obj;
    const s = localToWorld(lineObj.startPoint, lineObj);
    const e = localToWorld(lineObj.endPoint, lineObj);
    const boundaries = collectBoundarySegments(candidateObjects, lineObj.id, lineObj);
    const cutTs: number[] = [];
    const interPts: Point2D[] = [];

    for (const seg of boundaries) {
      const hit = segmentSegmentIntersection(s, e, seg.a, seg.b, 1e-4);
      if (hit && hit.t > 0.015 && hit.t < 0.985) {
        if (!cutTs.some((prev) => Math.abs(prev - hit.t) < 0.008)) {
          cutTs.push(hit.t);
          interPts.push({ x: hit.x, y: hit.y });
        }
      }
    }

    if (cutTs.length > 0) {
      cutTs.sort((a, b) => a - b);
      const stops = [0, ...cutTs, 1];
      let spanIdx = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        if (bestLineHit.t >= stops[i] - 1e-6 && bestLineHit.t <= stops[i + 1] + 1e-6) {
          spanIdx = i;
          break;
        }
      }
      const lerpPt = (t: number): Point2D => ({
        x: s.x + t * (e.x - s.x),
        y: s.y + t * (e.y - s.y),
      });

      const trimA = lerpPt(stops[spanIdx]);
      const trimB = lerpPt(stops[spanIdx + 1]);
      const replacements: LineObject[] = [];
      let z = startZIndex;

      if (stops[spanIdx] > 0.015) {
        replacements.push(
          buildLineObjectFromWorldEndpoints(lineObj, s, trimA, uid('line'), z++)
        );
      }
      if (stops[spanIdx + 1] < 0.985) {
        replacements.push(
          buildLineObjectFromWorldEndpoints(lineObj, trimB, e, uid('line'), z++)
        );
      }

      const activeInters = [
        ...(stops[spanIdx] > 0 ? [trimA] : []),
        ...(stops[spanIdx + 1] < 1 ? [trimB] : []),
      ];

      return {
        targetId: lineObj.id,
        highlightSegments: [[trimA, trimB]],
        intersectionPoints: activeInters.length > 0 ? activeInters : interPts,
        replacements,
      };
    }
  }

  // 2. Check open polylines
  for (const obj of nearClickObjects) {
    if (obj.type !== 'shape' || obj.shapeKind !== 'polyline') continue;
    const geom = getShapeCutPolygonWorld(obj);
    if (!geom || geom.pts.length < 2) continue;

    // Total cumulative arc lengths along polyline
    const cumLen: number[] = [0];
    for (let i = 1; i < geom.pts.length; i++) {
      cumLen.push(
        cumLen[i - 1] + Math.hypot(geom.pts[i].x - geom.pts[i - 1].x, geom.pts[i].y - geom.pts[i - 1].y)
      );
    }
    const totalLen = cumLen[cumLen.length - 1];
    if (totalLen < 2) continue;

    let hitSegIdx = -1;
    let hitDist = tolerance;
    let hitT = 0;
    for (let i = 0; i < geom.pts.length - 1; i++) {
      const d = pointToSegmentDistance(clickWorld, geom.pts[i], geom.pts[i + 1]);
      if (d.dist <= hitDist) {
        hitDist = d.dist;
        hitSegIdx = i;
        hitT = d.t;
      }
    }
    if (hitSegIdx < 0) continue;

    const segLen = cumLen[hitSegIdx + 1] - cumLen[hitSegIdx];
    const clickDistAlong = cumLen[hitSegIdx] + hitT * segLen;
    const boundaries = collectBoundarySegments(candidateObjects, obj.id, obj);

    const cutDists: { dist: number; pt: Point2D }[] = [];
    for (let i = 0; i < geom.pts.length - 1; i++) {
      const sLen = cumLen[i + 1] - cumLen[i];
      for (const seg of boundaries) {
        const inter = segmentSegmentIntersection(geom.pts[i], geom.pts[i + 1], seg.a, seg.b, 1e-4);
        if (inter) {
          const dAlong = cumLen[i] + inter.t * sLen;
          if (dAlong > 1 && dAlong < totalLen - 1) {
            if (!cutDists.some((c) => Math.abs(c.dist - dAlong) < 1.5)) {
              cutDists.push({ dist: dAlong, pt: { x: inter.x, y: inter.y } });
            }
          }
        }
      }
    }

    if (cutDists.length > 0) {
      cutDists.sort((a, b) => a.dist - b.dist);
      const stops = [0, ...cutDists.map((c) => c.dist), totalLen];
      let spanIdx = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        if (clickDistAlong >= stops[i] - 1e-4 && clickDistAlong <= stops[i + 1] + 1e-4) {
          spanIdx = i;
          break;
        }
      }

      const slicePolyline = (fromD: number, toD: number): Point2D[] => {
        const res: Point2D[] = [];
        for (let i = 0; i < geom.pts.length - 1; i++) {
          const d0 = cumLen[i];
          const d1 = cumLen[i + 1];
          if (d1 < fromD - 1e-4 || d0 > toD + 1e-4) continue;
          const segL = Math.max(1e-6, d1 - d0);
          if (d0 <= fromD && d1 >= fromD) {
            const f = clamp((fromD - d0) / segL, 0, 1);
            res.push({
              x: geom.pts[i].x + f * (geom.pts[i + 1].x - geom.pts[i].x),
              y: geom.pts[i].y + f * (geom.pts[i + 1].y - geom.pts[i].y),
            });
          } else if (res.length === 0) {
            res.push(geom.pts[i]);
          }
          if (d1 <= toD + 1e-4) {
            res.push(geom.pts[i + 1]);
          } else if (d0 <= toD && d1 >= toD) {
            const f = clamp((toD - d0) / segL, 0, 1);
            res.push({
              x: geom.pts[i].x + f * (geom.pts[i + 1].x - geom.pts[i].x),
              y: geom.pts[i].y + f * (geom.pts[i + 1].y - geom.pts[i].y),
            });
          }
        }
        return res;
      };

      const trimmedChain = slicePolyline(stops[spanIdx], stops[spanIdx + 1]);
      const highlightSegments: [Point2D, Point2D][] = [];
      for (let i = 0; i < trimmedChain.length - 1; i++) {
        highlightSegments.push([trimmedChain[i], trimmedChain[i + 1]]);
      }

      const replacements: ShapeObject[] = [];
      let z = startZIndex;
      if (stops[spanIdx] > 1.5) {
        const leftChain = slicePolyline(0, stops[spanIdx]);
        if (leftChain.length >= 2) {
          replacements.push(buildPolylineShapeFromWorldPoints(obj, leftChain, uid('shp'), z++));
        }
      }
      if (stops[spanIdx + 1] < totalLen - 1.5) {
        const rightChain = slicePolyline(stops[spanIdx + 1], totalLen);
        if (rightChain.length >= 2) {
          replacements.push(buildPolylineShapeFromWorldPoints(obj, rightChain, uid('shp'), z++));
        }
      }

      return {
        targetId: obj.id,
        highlightSegments,
        intersectionPoints: cutDists.map((c) => c.pt),
        replacements,
      };
    }
  }

  // 3. Check closed ShapeObjects cut by any intersecting LineObject or another shape's edge
  // Prioritize topmost shape containing clickWorld or whose edge is within tolerance
  const shapeCandidates = [...nearClickObjects]
    .filter((o): o is ShapeObject => o.type === 'shape')
    .reverse();

  for (const shapeObj of shapeCandidates) {
    const geom = getShapeCutPolygonWorld(shapeObj);
    if (!geom || !geom.closed) continue;

    let minEdgeDist = Infinity;
    for (let i = 0; i < geom.pts.length; i++) {
      const d = pointToSegmentDistance(
        clickWorld,
        geom.pts[i],
        geom.pts[(i + 1) % geom.pts.length]
      ).dist;
      minEdgeDist = Math.min(minEdgeDist, d);
    }
    const inside = pointInPolygon(clickWorld, geom.pts);
    if (!inside && minEdgeDist > tolerance) continue;

    // Look for cutting LineObjects or other ShapeObject edges that slice this shape into >= 2 pieces
    const cutSegs = collectBoundarySegments(candidateObjects, shapeObj.id, shapeObj);
    let chosenSplit: {
      polygons: Point2D[][];
      intersections: Point2D[];
      cutDist: number;
    } | null = null;

    for (const seg of cutSegs) {
      const split = splitPolygonByCutSegment(geom.pts, seg.a, seg.b, true);
      if (split.polygons.length >= 2) {
        const cutDist = pointToSegmentDistance(clickWorld, seg.a, seg.b).dist;
        if (!chosenSplit || cutDist < chosenSplit.cutDist) {
          chosenSplit = { ...split, cutDist };
        }
      }
    }

    if (chosenSplit) {
      // Pick which sub-polygon contains clickWorld (or is closest to clickWorld)
      let clickedIdx = chosenSplit.polygons.findIndex((p) => pointInPolygon(clickWorld, p));
      if (clickedIdx < 0) {
        let bestDist = Infinity;
        chosenSplit.polygons.forEach((p, idx) => {
          for (let i = 0; i < p.length; i++) {
            const d = pointToSegmentDistance(clickWorld, p[i], p[(i + 1) % p.length]).dist;
            if (d < bestDist) {
              bestDist = d;
              clickedIdx = idx;
            }
          }
        });
      }

      if (clickedIdx >= 0) {
        const trimmedPoly = chosenSplit.polygons[clickedIdx];
        const remainingPolys = chosenSplit.polygons.filter((_, idx) => idx !== clickedIdx);
        let z = startZIndex;
        const replacements = remainingPolys.map((p) =>
          buildShapeObjectFromWorldPolygon(shapeObj, p, uid('shp'), z++)
        );
        const highlightSegments: [Point2D, Point2D][] = [];
        for (let i = 0; i < trimmedPoly.length; i++) {
          highlightSegments.push([
            trimmedPoly[i],
            trimmedPoly[(i + 1) % trimmedPoly.length],
          ]);
        }

        return {
          targetId: shapeObj.id,
          highlightSegments,
          highlightPolygon: trimmedPoly,
          intersectionPoints: chosenSplit.intersections,
          replacements,
        };
      }
    }
  }

  return null;
}
