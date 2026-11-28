import type { CadDraftingConfig } from '../../types/cad';
import type {
  CanvasObject,
  DimensionObject,
  LineObject,
  Point2D,
  ShapeObject,
} from '../../types/whiteboard';
import { is3DSolidShape } from '../shapeRenderer';
import {
  getLineWorldSegments,
  getShapeEditableGeometry,
  pointInPolygon,
  pointToSegmentDistance,
  worldToLocal,
} from '../geometryCad';
import { computeDimensionMetrics, type DimensionMetrics } from './cadDimensions';
import { getObjectExpandedBounds, queryObjectsInWorldBox } from './cadSpatialIndex';

export interface TightWorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const dimMetricsCache = new WeakMap<
  DimensionObject,
  {
    key: string;
    metrics: DimensionMetrics;
  }
>();

// V1.11.8-6: Caché de métricas de cota para prefiltrado rápido en hitbox y guías
export function getCachedDimensionMetrics(
  dim: DimensionObject,
  cadConfig: CadDraftingConfig
): DimensionMetrics {
  const key = [
    dim.dimKind,
    dim.p1.x,
    dim.p1.y,
    dim.p2.x,
    dim.p2.y,
    dim.p3?.x ?? '',
    dim.p3?.y ?? '',
    dim.offsetPt.x,
    dim.offsetPt.y,
    dim.linearAxis ?? '',
    dim.ordinateAxis ?? '',
    dim.fontSize ?? 12,
    dim.fontFamily ?? '',
    dim.textOverride ?? '',
    cadConfig.unit,
    cadConfig.decimals,
    cadConfig.originX,
    cadConfig.originY,
    cadConfig.yAxisUp,
  ].join('|');

  const cached = dimMetricsCache.get(dim);
  if (cached && cached.key === key) {
    return cached.metrics;
  }
  const metrics = computeDimensionMetrics(dim, cadConfig);
  dimMetricsCache.set(dim, { key, metrics });
  return metrics;
}

// V1.11.8-10: Caja delimitadora mundial en caché antes de pruebas geométricas exactas
export function getObjectTightCachedBounds(
  obj: CanvasObject,
  cadConfig: CadDraftingConfig
): TightWorldBounds {
  if (obj.type === 'dimension') {
    const m = getCachedDimensionMetrics(obj, cadConfig);
    return {
      minX: m.bbox.x - 16,
      minY: m.bbox.y - 16,
      maxX: m.bbox.x + m.bbox.width + 16,
      maxY: m.bbox.y + m.bbox.height + 16,
    };
  }
  const b = getObjectExpandedBounds(obj);
  if (obj.type === 'shape' && obj.shapeKind === 'curve') {
    const padCtrl = Math.max(24, obj.height * 0.45);
    return {
      minX: b.minX - 12,
      minY: b.minY - padCtrl,
      maxX: b.maxX + 12,
      maxY: b.maxY + padCtrl,
    };
  }
  return b;
}

function minDistanceToSegments(pt: Point2D, segs: [Point2D, Point2D][]): number {
  let best = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const d = pointToSegmentDistance(pt, segs[i][0], segs[i][1]).dist;
    if (d < best) best = d;
  }
  return best;
}

function minDistanceToPolyline(pt: Point2D, pts: Point2D[], closed: boolean): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(pt.x - pts[0].x, pt.y - pts[0].y);
  let best = Infinity;
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const d = pointToSegmentDistance(pt, pts[i], pts[(i + 1) % pts.length]).dist;
    if (d < best) best = d;
  }
  return best;
}

function distanceToEllipseBorderLocal(
  lp: Point2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): { borderDist: number; inside: boolean } {
  const safeRx = Math.max(1, rx);
  const safeRy = Math.max(1, ry);
  const dx = lp.x - cx;
  const dy = lp.y - cy;
  const norm = Math.hypot(dx / safeRx, dy / safeRy);
  if (norm < 1e-6) {
    return { borderDist: Math.min(safeRx, safeRy), inside: true };
  }
  const gradLen = Math.hypot(dx / (safeRx * safeRx), dy / (safeRy * safeRy)) / norm;
  const borderDist = gradLen > 1e-9 ? Math.abs(norm - 1) / gradLen : Math.min(safeRx, safeRy);
  return { borderDist, inside: norm <= 1 };
}

function distanceToEllipticalArcLocal(
  lp: Point2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startRad: number,
  endRad: number,
  steps = 20
): number {
  let prev = {
    x: cx + rx * Math.cos(startRad),
    y: cy + ry * Math.sin(startRad),
  };
  let best = Infinity;
  for (let i = 1; i <= steps; i++) {
    const ang = startRad + ((endRad - startRad) * i) / steps;
    const curr = {
      x: cx + rx * Math.cos(ang),
      y: cy + ry * Math.sin(ang),
    };
    const d = pointToSegmentDistance(lp, prev, curr).dist;
    if (d < best) best = d;
    prev = curr;
  }
  return best;
}

function isPointInsideRoundedRectLocal(
  lp: Point2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): boolean {
  if (lp.x < x || lp.x > x + w || lp.y < y || lp.y > y + h) return false;
  const cr = Math.min(Math.max(0, r), w / 2, h / 2);
  if (cr <= 0.5) return true;
  if (lp.x < x + cr && lp.y < y + cr) {
    return Math.hypot(lp.x - (x + cr), lp.y - (y + cr)) <= cr;
  }
  if (lp.x > x + w - cr && lp.y < y + cr) {
    return Math.hypot(lp.x - (x + w - cr), lp.y - (y + cr)) <= cr;
  }
  if (lp.x < x + cr && lp.y > y + h - cr) {
    return Math.hypot(lp.x - (x + cr), lp.y - (y + h - cr)) <= cr;
  }
  if (lp.x > x + w - cr && lp.y > y + h - cr) {
    return Math.hypot(lp.x - (x + w - cr), lp.y - (y + h - cr)) <= cr;
  }
  return true;
}

function distanceToRoundedRectBorderLocal(
  lp: Point2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): number {
  const cr = Math.min(Math.max(0, r), w / 2, h / 2);
  if (cr <= 0.5) {
    const pts: Point2D[] = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    return minDistanceToPolyline(lp, pts, true);
  }
  const segs: [Point2D, Point2D][] = [
    [{ x: x + cr, y }, { x: x + w - cr, y }],
    [{ x: x + w, y: y + cr }, { x: x + w, y: y + h - cr }],
    [{ x: x + w - cr, y: y + h }, { x: x + cr, y: y + h }],
    [{ x, y: y + h - cr }, { x, y: y + cr }],
  ];
  let best = minDistanceToSegments(lp, segs);
  best = Math.min(
    best,
    distanceToEllipticalArcLocal(lp, x + cr, y + cr, cr, cr, Math.PI, (3 * Math.PI) / 2, 8),
    distanceToEllipticalArcLocal(lp, x + w - cr, y + cr, cr, cr, (3 * Math.PI) / 2, 2 * Math.PI, 8),
    distanceToEllipticalArcLocal(lp, x + w - cr, y + h - cr, cr, cr, 0, Math.PI / 2, 8),
    distanceToEllipticalArcLocal(lp, x + cr, y + h - cr, cr, cr, Math.PI / 2, Math.PI, 8)
  );
  return best;
}

function getSolid3DLocalGeometry(
  obj: ShapeObject
): {
  edges: [Point2D, Point2D][];
  faces: Point2D[][];
  ellipses: { cx: number; cy: number; rx: number; ry: number }[];
  arcs: { cx: number; cy: number; rx: number; ry: number; start: number; end: number }[];
} {
  const w = Math.max(10, obj.width);
  const h = Math.max(10, obj.height);
  const pad = obj.strokeWidth / 2 + 2;
  const iw = Math.max(6, w - pad * 2);
  const ih = Math.max(6, h - pad * 2);
  const edges: [Point2D, Point2D][] = [];
  const faces: Point2D[][] = [];
  const ellipses: { cx: number; cy: number; rx: number; ry: number }[] = [];
  const arcs: { cx: number; cy: number; rx: number; ry: number; start: number; end: number }[] = [];

  const addPoly = (pts: Point2D[]) => {
    faces.push(pts);
    for (let i = 0; i < pts.length; i++) {
      edges.push([pts[i], pts[(i + 1) % pts.length]]);
    }
  };

  switch (obj.shapeKind) {
    case 'cube':
    case 'cube-wire': {
      const dx = iw * 0.25;
      const dy = ih * 0.22;
      const fx = pad;
      const fy = pad + dy;
      const fw = iw - dx;
      const fh = ih - dy;
      addPoly([
        { x: fx, y: fy },
        { x: fx + fw, y: fy },
        { x: fx + fw, y: fy + fh },
        { x: fx, y: fy + fh },
      ]);
      addPoly([
        { x: fx, y: fy },
        { x: fx + dx, y: pad },
        { x: w - pad, y: pad },
        { x: fx + fw, y: fy },
      ]);
      addPoly([
        { x: fx + fw, y: fy },
        { x: w - pad, y: pad },
        { x: w - pad, y: pad + fh },
        { x: fx + fw, y: fy + fh },
      ]);
      if (obj.shapeKind === 'cube-wire') {
        edges.push(
          [{ x: fx + dx, y: pad }, { x: fx + dx, y: pad + fh }],
          [{ x: fx + dx, y: pad + fh }, { x: fx, y: fy + fh }],
          [{ x: fx + dx, y: pad + fh }, { x: w - pad, y: pad + fh }]
        );
      }
      break;
    }
    case 'oblique-prism': {
      const dx = iw * 0.26;
      const dy = ih * 0.22;
      const skew = iw * 0.14;
      const topY = pad;
      const frontTopY = pad + dy;
      const botY = h - pad;
      addPoly([
        { x: pad + skew + dx, y: topY },
        { x: w - pad, y: topY },
        { x: w - pad - dx, y: frontTopY },
        { x: pad + skew, y: frontTopY },
      ]);
      addPoly([
        { x: pad + skew, y: frontTopY },
        { x: w - pad - dx, y: frontTopY },
        { x: w - pad - dx - skew, y: botY },
        { x: pad, y: botY },
      ]);
      addPoly([
        { x: w - pad - dx, y: frontTopY },
        { x: w - pad, y: topY },
        { x: w - pad - skew, y: botY - dy },
        { x: w - pad - dx - skew, y: botY },
      ]);
      break;
    }
    case 'cylinder': {
      const rx = iw / 2;
      const ry = Math.max(4, ih * 0.15);
      const topCy = pad + ry;
      const botCy = h - pad - ry;
      edges.push(
        [{ x: pad, y: topCy }, { x: pad, y: botCy }],
        [{ x: w - pad, y: topCy }, { x: w - pad, y: botCy }]
      );
      ellipses.push({ cx: w / 2, cy: topCy, rx, ry });
      arcs.push(
        { cx: w / 2, cy: botCy, rx, ry, start: 0, end: Math.PI },
        { cx: w / 2, cy: botCy, rx, ry, start: Math.PI, end: 2 * Math.PI }
      );
      const poly: Point2D[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI + (i * Math.PI) / 12;
        poly.push({ x: w / 2 + rx * Math.cos(a), y: topCy + ry * Math.sin(a) });
      }
      for (let i = 0; i <= 12; i++) {
        const a = (i * Math.PI) / 12;
        poly.push({ x: w / 2 + rx * Math.cos(a), y: botCy + ry * Math.sin(a) });
      }
      faces.push(poly);
      break;
    }
    case 'square-pyramid': {
      const apex = { x: w * 0.5, y: pad };
      const bl = { x: pad, y: h - pad - ih * 0.12 };
      const bf = { x: w * 0.44, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.14 };
      const bb = { x: w * 0.58, y: h - pad - ih * 0.28 };
      addPoly([apex, bl, bf]);
      addPoly([apex, bf, br]);
      edges.push([apex, bb], [bl, bb], [br, bb]);
      break;
    }
    case 'cone': {
      const rx = iw / 2;
      const ry = Math.max(4, ih * 0.15);
      const botCy = h - pad - ry;
      const apex = { x: w / 2, y: pad };
      edges.push(
        [apex, { x: pad, y: botCy }],
        [apex, { x: w - pad, y: botCy }]
      );
      arcs.push(
        { cx: w / 2, cy: botCy, rx, ry, start: 0, end: Math.PI },
        { cx: w / 2, cy: botCy, rx, ry, start: Math.PI, end: 2 * Math.PI }
      );
      const poly: Point2D[] = [apex];
      for (let i = 12; i >= 0; i--) {
        const a = (i * Math.PI) / 12;
        poly.push({ x: w / 2 + rx * Math.cos(a), y: botCy + ry * Math.sin(a) });
      }
      faces.push(poly);
      break;
    }
    case 'sphere': {
      const cx = w / 2;
      const cy = h / 2;
      const rx = iw / 2;
      const ry = ih / 2;
      const eqRy = Math.max(4, ry * 0.32);
      ellipses.push({ cx, cy, rx, ry });
      arcs.push(
        { cx, cy, rx, ry: eqRy, start: 0, end: Math.PI },
        { cx, cy, rx, ry: eqRy, start: Math.PI, end: 2 * Math.PI }
      );
      break;
    }
    case 'tetrahedron': {
      const apex = { x: w * 0.56, y: pad };
      const bl = { x: pad, y: h - pad - ih * 0.14 };
      const bf = { x: w * 0.45, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.24 };
      addPoly([apex, bl, bf]);
      addPoly([apex, bf, br]);
      edges.push([bl, br]);
      break;
    }
    case 'triangular-prism': {
      const t1 = { x: pad + iw * 0.22, y: pad };
      const t2 = { x: w - pad, y: pad + ih * 0.18 };
      const t3 = { x: pad, y: pad + ih * 0.32 };
      const b1 = { x: t1.x, y: h - pad - ih * 0.26 };
      const b2 = { x: t2.x, y: h - pad - ih * 0.1 };
      const b3 = { x: pad + iw * 0.12, y: h - pad };
      addPoly([t3, t2, b2, b3]);
      addPoly([t1, t2, t3]);
      edges.push([t1, b1], [b3, b1], [b2, b1]);
      break;
    }
    case 'hex-pyramid': {
      const apex = { x: w / 2, y: pad };
      const cy = h - pad - ih * 0.16;
      const rx = iw / 2;
      const ry = ih * 0.16;
      const pts: Point2D[] = [];
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        pts.push({ x: w / 2 + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) });
      }
      addPoly([apex, pts[3], pts[2]]);
      addPoly([apex, pts[2], pts[1]]);
      addPoly([apex, pts[1], pts[0]]);
      edges.push([apex, pts[4]], [apex, pts[5]], [pts[3], pts[4]], [pts[4], pts[5]], [pts[5], pts[0]]);
      break;
    }
    case 'hex-prism': {
      const rx = iw / 2;
      const ry = ih * 0.16;
      const topCy = pad + ry;
      const botCy = h - pad - ry;
      const topPts: Point2D[] = [];
      const botPts: Point2D[] = [];
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const px = w / 2 + rx * Math.cos(ang);
        topPts.push({ x: px, y: topCy + ry * Math.sin(ang) });
        botPts.push({ x: px, y: botCy + ry * Math.sin(ang) });
      }
      addPoly([topPts[3], topPts[2], botPts[2], botPts[3]]);
      addPoly([topPts[2], topPts[1], botPts[1], botPts[2]]);
      addPoly([topPts[1], topPts[0], botPts[0], botPts[1]]);
      addPoly(topPts);
      edges.push(
        [topPts[4], botPts[4]],
        [topPts[5], botPts[5]],
        [botPts[3], botPts[4]],
        [botPts[4], botPts[5]],
        [botPts[5], botPts[0]]
      );
      break;
    }
    case 'octahedron': {
      const top = { x: w / 2, y: pad };
      const bot = { x: w / 2, y: h - pad };
      const left = { x: pad, y: h / 2 };
      const right = { x: w - pad, y: h / 2 };
      const midFront = { x: w * 0.44, y: h * 0.58 };
      const midBack = { x: w * 0.56, y: h * 0.42 };
      addPoly([top, left, midFront]);
      addPoly([top, midFront, right]);
      addPoly([bot, left, midFront]);
      addPoly([bot, midFront, right]);
      edges.push([top, midBack], [bot, midBack], [left, midBack], [right, midBack]);
      break;
    }
    case 'frustum-pyramid': {
      const tl = { x: pad + iw * 0.24, y: pad + ih * 0.08 };
      const tr = { x: pad + iw * 0.76, y: pad + ih * 0.08 };
      const tf = { x: pad + iw * 0.62, y: pad + ih * 0.18 };
      const tfl = { x: pad + iw * 0.18, y: pad + ih * 0.18 };
      const bl = { x: pad, y: h - pad - ih * 0.08 };
      const bf = { x: pad + iw * 0.72, y: h - pad };
      const br = { x: w - pad, y: h - pad - ih * 0.14 };
      const bb = { x: pad + iw * 0.28, y: h - pad - ih * 0.22 };
      addPoly([tfl, tf, bf, bl]);
      addPoly([tf, tr, br, bf]);
      addPoly([tl, tr, tf, tfl]);
      edges.push([tl, bb], [bl, bb], [br, bb]);
      break;
    }
    case 'frustum-cone': {
      const topRx = iw * 0.26;
      const topRy = Math.max(3, ih * 0.09);
      const botRx = iw / 2;
      const botRy = Math.max(4, ih * 0.14);
      const topCy = pad + topRy;
      const botCy = h - pad - botRy;
      edges.push(
        [{ x: w / 2 - topRx, y: topCy }, { x: pad, y: botCy }],
        [{ x: w / 2 + topRx, y: topCy }, { x: w - pad, y: botCy }]
      );
      ellipses.push({ cx: w / 2, cy: topCy, rx: topRx, ry: topRy });
      arcs.push(
        { cx: w / 2, cy: botCy, rx: botRx, ry: botRy, start: 0, end: Math.PI },
        { cx: w / 2, cy: botCy, rx: botRx, ry: botRy, start: Math.PI, end: 2 * Math.PI }
      );
      const poly: Point2D[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (i * Math.PI) / 10;
        poly.push({ x: w / 2 + topRx * Math.cos(a), y: topCy + topRy * Math.sin(a) });
      }
      for (let i = 0; i <= 12; i++) {
        const a = (i * Math.PI) / 12;
        poly.push({ x: w / 2 + botRx * Math.cos(a), y: botCy + botRy * Math.sin(a) });
      }
      faces.push(poly);
      break;
    }
    default:
      break;
  }

  return { edges, faces, ellipses, arcs };
}

function isPointOnDimensionHitbox(
  worldPt: Point2D,
  obj: DimensionObject,
  safeZoom: number,
  cadConfig: CadDraftingConfig
): boolean {
  const tolWorld = 6 / safeZoom;
  const metrics = getCachedDimensionMetrics(obj, cadConfig);
  const { bbox } = metrics;
  if (
    worldPt.x < bbox.x - tolWorld - 16 ||
    worldPt.x > bbox.x + bbox.width + tolWorld + 16 ||
    worldPt.y < bbox.y - tolWorld - 16 ||
    worldPt.y > bbox.y + bbox.height + tolWorld + 16
  ) {
    return false;
  }

  if (minDistanceToSegments(worldPt, metrics.dimLines) <= tolWorld) {
    return true;
  }
  if (minDistanceToSegments(worldPt, metrics.extLines) <= tolWorld) {
    return true;
  }

  if (metrics.dimArc) {
    const { center, radius, startPt, endPt, sweepFlag } = metrics.dimArc;
    const distCenter = Math.hypot(worldPt.x - center.x, worldPt.y - center.y);
    if (Math.abs(distCenter - radius) <= tolWorld) {
      const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const a0 = norm(Math.atan2(startPt.y - center.y, startPt.x - center.x));
      const a1 = norm(Math.atan2(endPt.y - center.y, endPt.x - center.x));
      const aP = norm(Math.atan2(worldPt.y - center.y, worldPt.x - center.x));
      const angTol = tolWorld / Math.max(12, radius);
      if (sweepFlag === 1) {
        const sweep = norm(a1 - a0);
        const off = norm(aP - a0);
        if (off <= sweep + angTol || norm(a0 - aP) <= angTol) return true;
      } else {
        const sweep = norm(a0 - a1);
        const off = norm(a0 - aP);
        if (off <= sweep + angTol || norm(aP - a0) <= angTol) return true;
      }
    }
  }

  if (metrics.centerCross) {
    const c = metrics.centerCross;
    const crossDist = minDistanceToSegments(worldPt, [
      [{ x: c.x - 5, y: c.y }, { x: c.x + 5, y: c.y }],
      [{ x: c.x, y: c.y - 5 }, { x: c.x, y: c.y + 5 }],
    ]);
    if (crossDist <= tolWorld) return true;
  }

  for (const ar of metrics.arrows) {
    if (ar.dirX === 0 && ar.dirY === 0) {
      if (Math.hypot(worldPt.x - ar.tip.x, worldPt.y - ar.tip.y) <= tolWorld + 3 / safeZoom) {
        return true;
      }
      continue;
    }
    const baseCenter = { x: ar.tip.x + ar.dirX * 9, y: ar.tip.y + ar.dirY * 9 };
    if (pointToSegmentDistance(worldPt, ar.tip, baseCenter).dist <= tolWorld + 3 / safeZoom) {
      return true;
    }
  }

  // Caja del texto de cota (respetando su rotación legible)
  const dx = worldPt.x - metrics.textPos.x;
  const dy = worldPt.y - metrics.textPos.y;
  const rad = -((metrics.textAngleDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const fontSize = Math.max(8, obj.fontSize || 12);
  const halfW = Math.max(14, (metrics.displayLabel.length * fontSize * 0.62 + 8) / 2);
  const halfH = Math.max(8, (fontSize * 1.35 + 4) / 2);
  if (Math.abs(lx) <= halfW + tolWorld && Math.abs(ly) <= halfH + tolWorld) {
    return true;
  }

  return false;
}

function isPointOnShapeHitbox(
  worldPt: Point2D,
  obj: ShapeObject,
  safeZoom: number
): boolean {
  const w = Math.max(10, obj.width);
  const h = Math.max(10, obj.height);
  const sw = Math.max(1, obj.strokeWidth || 2);
  const tolWorld = Math.max(5 / safeZoom, sw / 2 + 4 / safeZoom);
  const pad = sw / 2 + 2;
  const iw = Math.max(6, w - pad * 2);
  const ih = Math.max(6, h - pad * 2);

  const isOpenShape =
    obj.shapeKind === 'arc' || obj.shapeKind === 'curve' || obj.shapeKind === 'polyline';
  const hasFill =
    !isOpenShape &&
    Boolean(obj.fillColor && obj.fillColor !== 'transparent' && obj.fillColor !== 'none');

  const rawLocal = worldToLocal(worldPt, obj);
  const lp: Point2D = {
    x: obj.flipX ? w - rawLocal.x : rawLocal.x,
    y: obj.flipY ? h - rawLocal.y : rawLocal.y,
  };

  if (obj.shapeKind === 'custom-polygon' || (obj.customVertices && obj.customVertices.length >= 2)) {
    const verts =
      obj.customVertices && obj.customVertices.length >= 2
        ? obj.customVertices
        : [
            { x: pad, y: pad },
            { x: w - pad, y: pad },
            { x: w - pad, y: h - pad },
            { x: pad, y: h - pad },
          ];
    if (verts.length === 2) {
      return pointToSegmentDistance(lp, verts[0], verts[1]).dist <= tolWorld;
    }
    if (hasFill && pointInPolygon(lp, verts)) return true;
    return minDistanceToPolyline(lp, verts, true) <= tolWorld;
  }

  if (obj.shapeKind === 'circle' || obj.shapeKind === 'ellipse') {
    const { borderDist, inside } = distanceToEllipseBorderLocal(
      lp,
      w / 2,
      h / 2,
      iw / 2,
      ih / 2
    );
    return hasFill ? inside || borderDist <= tolWorld : borderDist <= tolWorld;
  }

  if (obj.shapeKind === 'rectangle' || obj.shapeKind === 'square' || obj.shapeKind === 'rounded-rect') {
    const cr =
      obj.shapeKind === 'rounded-rect' ? Math.min(iw, ih) * 0.22 : obj.cornerRadius || 0;
    if (hasFill && isPointInsideRoundedRectLocal(lp, pad, pad, iw, ih, cr)) {
      return true;
    }
    return distanceToRoundedRectBorderLocal(lp, pad, pad, iw, ih, cr) <= tolWorld;
  }

  if (obj.shapeKind === 'arc') {
    const a0 = obj.arcStartAngle ?? 0;
    const a1 = obj.arcEndAngle ?? 220;
    const diff = (((a1 - a0) % 360) + 360) % 360;
    const rx = Math.max(4, w / 2 - 4);
    const ry = Math.max(4, h / 2 - 4);
    if (diff >= 359.8 || (Math.abs(a1 - a0) >= 359.8 && diff < 0.2)) {
      return distanceToEllipseBorderLocal(lp, w / 2, h / 2, rx, ry).borderDist <= tolWorld;
    }
    const startRad = ((a0 - 90) * Math.PI) / 180;
    const endRad = startRad + (diff * Math.PI) / 180;
    return distanceToEllipticalArcLocal(lp, w / 2, h / 2, rx, ry, startRad, endRad, 28) <= tolWorld;
  }

  if (obj.shapeKind === 'curve') {
    const p0 = obj.customPoints?.[0] ?? { x: pad, y: h - pad };
    const p1 = obj.customPoints?.[1] ?? { x: w / 2, y: pad - h * 0.35 };
    const p2 = obj.customPoints?.[2] ?? { x: w - pad, y: h - pad };
    let prev = p0;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const mt = 1 - t;
      const curr = {
        x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
        y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
      };
      if (pointToSegmentDistance(lp, prev, curr).dist <= tolWorld) return true;
      prev = curr;
    }
    return false;
  }

  if (obj.shapeKind === 'polyline') {
    const pts =
      obj.customPoints && obj.customPoints.length > 0
        ? obj.customPoints
        : [
            { x: pad, y: h - pad },
            { x: w * 0.38, y: pad },
            { x: w * 0.65, y: h * 0.68 },
            { x: w - pad, y: pad + 4 },
          ];
    return minDistanceToPolyline(lp, pts, false) <= tolWorld;
  }

  if (obj.shapeKind === 'semicircle') {
    const rX = iw / 2;
    const rY = ih * 0.72;
    const baseY = h - pad - ih * 0.14;
    const poly: Point2D[] = [];
    for (let i = 0; i <= 24; i++) {
      const ang = Math.PI + (i * Math.PI) / 24;
      poly.push({ x: w / 2 + rX * Math.cos(ang), y: baseY + rY * Math.sin(ang) });
    }
    if (hasFill && pointInPolygon(lp, poly)) return true;
    return minDistanceToPolyline(lp, poly, true) <= tolWorld;
  }

  if (obj.shapeKind === 'sector') {
    const sx = pad;
    const sy = h - pad;
    const poly: Point2D[] = [{ x: sx, y: sy }];
    for (let i = 0; i <= 20; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / (2 * 20);
      poly.push({ x: sx + iw * Math.cos(ang), y: sy + ih * Math.sin(ang) });
    }
    if (hasFill && pointInPolygon(lp, poly)) return true;
    return minDistanceToPolyline(lp, poly, true) <= tolWorld;
  }

  if (is3DSolidShape(obj.shapeKind)) {
    const g = getSolid3DLocalGeometry(obj);
    if (minDistanceToSegments(lp, g.edges) <= tolWorld) return true;
    for (const el of g.ellipses) {
      const res = distanceToEllipseBorderLocal(lp, el.cx, el.cy, el.rx, el.ry);
      if (res.borderDist <= tolWorld || (hasFill && res.inside)) return true;
    }
    for (const arc of g.arcs) {
      if (
        distanceToEllipticalArcLocal(lp, arc.cx, arc.cy, arc.rx, arc.ry, arc.start, arc.end, 16) <=
        tolWorld
      ) {
        return true;
      }
    }
    if (hasFill) {
      for (const face of g.faces) {
        if (pointInPolygon(lp, face)) return true;
      }
    }
    return false;
  }

  // Polígonos regulares y básicos restantes (triangle, diamond, star, hexagon, etc.)
  // En `getShapeEditableGeometry`, sus vértices ya reflejan `flipX`/`flipY`, así que probamos sobre `rawLocal`.
  const editable = getShapeEditableGeometry(obj);
  if (editable && editable.vertices.length >= 2) {
    if (hasFill && editable.closed && pointInPolygon(rawLocal, editable.vertices)) {
      return true;
    }
    return minDistanceToPolyline(rawLocal, editable.vertices, editable.closed) <= tolWorld;
  }

  return (
    rawLocal.x >= -tolWorld &&
    rawLocal.x <= w + tolWorld &&
    rawLocal.y >= -tolWorld &&
    rawLocal.y <= h + tolWorld
  );
}

function isPointOnLineHitbox(
  worldPt: Point2D,
  obj: LineObject,
  safeZoom: number
): boolean {
  const sw = Math.max(1, obj.strokeWidth || 2);
  const tolWorld = Math.max(5 / safeZoom, sw / 2 + 4 / safeZoom);
  const { pts } = getLineWorldSegments(obj);
  if (minDistanceToPolyline(worldPt, pts, false) <= tolWorld) {
    return true;
  }
  if (
    obj.lineKind === 'arrow' ||
    obj.lineKind === 'double-arrow' ||
    obj.lineKind === 'vector'
  ) {
    const headLen = Math.max(8, sw * 3.5);
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      if (Math.hypot(worldPt.x - b.x, worldPt.y - b.y) <= headLen * 0.75 + tolWorld) {
        return true;
      }
      if (obj.lineKind === 'double-arrow') {
        const s = pts[0];
        if (Math.hypot(worldPt.x - s.x, worldPt.y - s.y) <= headLen * 0.75 + tolWorld) {
          return true;
        }
      }
      void a;
    }
  }
  return false;
}

/**
 * V1.11.8-10 / V1.11.8-6:
 * Prueba geométrica ajustada al contorno/contenido visible con prefiltrado por caja delimitadora en caché.
 */
export function isPointOnObjectTightHitbox(
  worldPt: Point2D,
  obj: CanvasObject,
  zoom: number,
  cadConfig: CadDraftingConfig
): boolean {
  try {
    const safeZoom = Math.max(0.1, Number.isFinite(zoom) ? zoom : 1);
    const tolPad = 6 / safeZoom + 12;
    const b = getObjectTightCachedBounds(obj, cadConfig);
    if (
      worldPt.x < b.minX - tolPad ||
      worldPt.x > b.maxX + tolPad ||
      worldPt.y < b.minY - tolPad ||
      worldPt.y > b.maxY + tolPad
    ) {
      return false;
    }

    if (obj.type === 'dimension') {
      return isPointOnDimensionHitbox(worldPt, obj, safeZoom, cadConfig);
    }

    if (obj.type === 'shape') {
      return isPointOnShapeHitbox(worldPt, obj, safeZoom);
    }

    if (obj.type === 'line') {
      return isPointOnLineHitbox(worldPt, obj, safeZoom);
    }

    if (obj.type === 'stroke') {
      const sw = Math.max(1, obj.strokeWidth || 2);
      const tolWorld = Math.max(5 / safeZoom, sw / 2 + 4 / safeZoom);
      const lp = worldToLocal(worldPt, obj);
      if (obj.points.length === 0) return false;
      if (obj.points.length === 1) {
        return Math.hypot(lp.x - obj.points[0].x, lp.y - obj.points[0].y) <= tolWorld;
      }
      return minDistanceToPolyline(lp, obj.points, false) <= tolWorld;
    }

    // Textos, ecuaciones, notas, imágenes, documentos, gráficas y tablas usan su caja rotada (+ tolerancia ligera)
    const boxTol = 5 / safeZoom;
    const lp = worldToLocal(worldPt, obj);
    const w = Math.max(1, obj.width);
    const h = Math.max(1, obj.height);
    return (
      lp.x >= -boxTol &&
      lp.x <= w + boxTol &&
      lp.y >= -boxTol &&
      lp.y <= h + boxTol
    );
  } catch {
    return false;
  }
}

/**
 * V1.11.8-10 / V1.11.8-6 / V1.11.8-13:
 * Devuelve el objeto superior (mayor zIndex) cuyo hitbox ajustado contenga `worldPt`,
 * permitiendo que los clics en zonas vacías traspasen hacia elementos subyacentes o al lienzo.
 */
export function findTopTightHitObjectAtPoint(
  worldPt: Point2D,
  visibleObjects: CanvasObject[],
  zoom: number,
  cadConfig: CadDraftingConfig,
  options?: {
    includeRefBg?: boolean;
    excludeIds?: Set<string>;
  }
): CanvasObject | null {
  if (visibleObjects.length === 0) return null;
  const safeZoom = Math.max(0.1, Number.isFinite(zoom) ? zoom : 1);
  const queryPad = 24 / safeZoom + 24;

  // queryObjectsInWorldBox excluye `dimension`, así que combinamos ambas búsquedas sin recorrer geometría pesada
  const spatialCandidates = queryObjectsInWorldBox(
    visibleObjects,
    worldPt.x - queryPad,
    worldPt.y - queryPad,
    worldPt.x + queryPad,
    worldPt.y + queryPad
  );

  const candidates: CanvasObject[] = [...spatialCandidates];
  for (let i = 0; i < visibleObjects.length; i++) {
    const obj = visibleObjects[i];
    if (obj.type !== 'dimension') continue;
    const b = getObjectTightCachedBounds(obj, cadConfig);
    if (
      worldPt.x >= b.minX - queryPad &&
      worldPt.x <= b.maxX + queryPad &&
      worldPt.y >= b.minY - queryPad &&
      worldPt.y <= b.maxY + queryPad
    ) {
      candidates.push(obj);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    candidates.sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  }

  const includeRefBg = Boolean(options?.includeRefBg);
  const excludeIds = options?.excludeIds;

  for (let i = 0; i < candidates.length; i++) {
    const obj = candidates[i];
    if (excludeIds && excludeIds.has(obj.id)) continue;
    if (
      !includeRefBg &&
      (obj.type === 'image' || obj.type === 'document') &&
      obj.isReferenceBackground
    ) {
      continue;
    }
    if (isPointOnObjectTightHitbox(worldPt, obj, safeZoom, cadConfig)) {
      return obj;
    }
  }

  return null;
}
