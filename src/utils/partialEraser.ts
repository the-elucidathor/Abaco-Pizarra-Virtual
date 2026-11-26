import type {
  CanvasObject,
  LineObject,
  Point2D,
  ShapeObject,
  StrokeObject,
} from '../types/whiteboard';
import { clamp, uid } from './id';
// OPT: 2.4 — Prefiltrado espacial en borrador parcial
import { queryObjectsInWorldBox } from './cad/cadSpatialIndex';
import { isOptEnabled, safeRunOpt } from './optFlags';
import {
  buildLineObjectFromWorldEndpoints,
  buildPolylineShapeFromWorldPoints,
  getLineWorldSegments,
  getShapeEditableGeometry,
  localToWorld,
  worldToLocal,
} from './geometryCad';

// Longitud mínima en unidades del mundo para conservar fragmentos tras el borrado parcial
const MIN_FRAGMENT_LENGTH = 2.0;
const EPS = 1e-6;

export interface SweptEraserResult {
  deleteIds: string[];
  addObjects: CanvasObject[];
  changed: boolean;
}

// Calcula la distancia mínima de un punto al segmento [a, b] en coordenadas del mundo
export function distancePointToSegmentWorld(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Convierte un ángulo SVG de shapeRenderer (0° arriba, sentido horario) a coordenadas cartesianas
function svgArcPoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number
): Point2D {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + rx * Math.cos(rad),
    y: cy + ry * Math.sin(rad),
  };
}

function normalizeDeg360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// Intersección paramétrica de un rayo/segmento S + t*D (t in [0,1]) con un disco (C, R)
function segmentDiskInterval(
  s: Point2D,
  d: Point2D,
  center: Point2D,
  radius: number
): [number, number] | null {
  const fx = s.x - center.x;
  const fy = s.y - center.y;
  const a = d.x * d.x + d.y * d.y;
  if (a <= EPS) {
    return fx * fx + fy * fy <= radius * radius ? [0, 1] : null;
  }
  const b = 2 * (fx * d.x + fy * d.y);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t0 = Math.max(0, (-b - sqrtDisc) / (2 * a));
  const t1 = Math.min(1, (-b + sqrtDisc) / (2 * a));
  if (t1 < t0 - EPS) return null;
  return [Math.min(t0, t1), Math.max(t0, t1)];
}

// Clipping de Liang-Barsky contra el cuerpo rectangular orientado entre A y B de semiancho R
function segmentCapsuleRectInterval(
  s: Point2D,
  d: Point2D,
  a: Point2D,
  b: Point2D,
  radius: number
): [number, number] | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = Math.hypot(abx, aby);
  if (len <= EPS) return null;

  const ux = abx / len;
  const uy = aby / len;
  const nx = -uy;
  const ny = ux;

  const fx = s.x - a.x;
  const fy = s.y - a.y;

  const u0 = fx * ux + fy * uy;
  const du = d.x * ux + d.y * uy;
  const n0 = fx * nx + fy * ny;
  const dn = d.x * nx + d.y * ny;

  let tMin = 0;
  let tMax = 1;

  const clipBound = (p: number, q: number): boolean => {
    if (Math.abs(p) <= EPS) {
      return q >= -EPS;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tMax + EPS) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin - EPS) return false;
      if (r < tMax) tMax = r;
    }
    return tMin <= tMax + EPS;
  };

  if (!clipBound(-du, u0)) return null; // u >= 0
  if (!clipBound(du, len - u0)) return null; // u <= len
  if (!clipBound(-dn, n0 + radius)) return null; // n >= -R
  if (!clipBound(dn, radius - n0)) return null; // n <= R

  const lo = clamp(tMin, 0, 1);
  const hi = clamp(tMax, 0, 1);
  if (hi < lo - EPS) return null;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/**
 * Calcula los tramos sobrevivientes [t0, t1] en [0, 1] de un segmento [segA, segB]
 * tras sustraer la cápsula barrida del borrador (recorrido entre capA y capB con radio R).
 * Al ser la cápsula convexa, la intersección eliminada siempre forma un único intervalo continuo.
 */
export function computeSurvivingSegmentIntervals(
  segA: Point2D,
  segB: Point2D,
  capA: Point2D,
  capB: Point2D,
  radius: number
): { removed: [number, number] | null; surviving: [number, number][] } {
  const d = { x: segB.x - segA.x, y: segB.y - segA.y };
  const intervals: [number, number][] = [];

  const i1 = segmentDiskInterval(segA, d, capA, radius);
  if (i1) intervals.push(i1);
  const i2 = segmentDiskInterval(segA, d, capB, radius);
  if (i2) intervals.push(i2);
  const iRect = segmentCapsuleRectInterval(segA, d, capA, capB, radius);
  if (iRect) intervals.push(iRect);

  if (intervals.length === 0) {
    return { removed: null, surviving: [[0, 1]] };
  }

  let cutStart = 1;
  let cutEnd = 0;
  for (const [lo, hi] of intervals) {
    if (lo < cutStart) cutStart = lo;
    if (hi > cutEnd) cutEnd = hi;
  }

  if (cutEnd <= cutStart + EPS) {
    return { removed: null, surviving: [[0, 1]] };
  }

  const surviving: [number, number][] = [];
  if (cutStart > 1e-4) {
    surviving.push([0, cutStart]);
  }
  if (cutEnd < 1 - 1e-4) {
    surviving.push([cutEnd, 1]);
  }

  return { removed: [cutStart, cutEnd], surviving };
}

function lerpPoint2D(a: Point2D, b: Point2D, t: number): Point2D {
  const p = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
  if (typeof a.pressure === 'number' || typeof b.pressure === 'number') {
    const pa = a.pressure ?? 0.5;
    const pb = b.pressure ?? 0.5;
    (p as Point2D).pressure = pa + (pb - pa) * t;
  }
  return p;
}

function polylineLength(pts: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

// Construye un StrokeObject limpio en coordenadas del mundo a partir de una lista de puntos
function buildStrokeFromWorldPoints(
  template: StrokeObject,
  worldPts: Point2D[],
  zIndex: number
): StrokeObject {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of worldPts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(4, maxX - minX);
  const h = Math.max(4, maxY - minY);
  return {
    id: uid('str'),
    type: 'stroke',
    layerId: template.layerId,
    groupId: template.groupId,
    x: minX,
    y: minY,
    width: w,
    height: h,
    rotation: 0,
    opacity: template.opacity,
    locked: false,
    zIndex,
    points: worldPts.map((p) => ({
      x: p.x - minX,
      y: p.y - minY,
      pressure: p.pressure,
    })),
    color: template.color,
    strokeWidth: template.strokeWidth,
    strokeStyle: template.strokeStyle,
    isHighlighter: template.isHighlighter,
  };
}

// Borrado parcial de un trazo a mano alzada con interpolación en los bordes de corte
export function sliceStrokeWithCapsule(
  obj: StrokeObject,
  capA: Point2D,
  capB: Point2D,
  radius: number,
  startZIndex: number
): StrokeObject[] | null {
  const pts = obj.points;
  if (pts.length === 0) return null;

  const worldPts: Point2D[] = pts.map((p) => {
    const wp = localToWorld(p, obj);
    return p.pressure !== undefined ? { ...wp, pressure: p.pressure } : wp;
  });

  // Caso de trazo de un solo punto
  if (worldPts.length === 1) {
    const dist = distancePointToSegmentWorld(worldPts[0], capA, capB);
    return dist <= radius ? [] : null;
  }

  let anyErased = false;
  const subPolylines: Point2D[][] = [];
  let currentPoly: Point2D[] = [];

  const flushCurrent = () => {
    if (currentPoly.length >= 2) {
      subPolylines.push(currentPoly);
    }
    currentPoly = [];
  };

  for (let i = 0; i < worldPts.length - 1; i++) {
    const a = worldPts[i];
    const b = worldPts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen <= EPS) continue;

    const { removed, surviving } = computeSurvivingSegmentIntervals(
      a,
      b,
      capA,
      capB,
      radius
    );

    if (removed) {
      anyErased = true;
    }

    if (surviving.length === 0) {
      flushCurrent();
      continue;
    }

    for (const [t0, t1] of surviving) {
      const pStart = t0 <= EPS ? a : lerpPoint2D(a, b, t0);
      const pEnd = t1 >= 1 - EPS ? b : lerpPoint2D(a, b, t1);

      if (t0 > EPS || currentPoly.length === 0) {
        if (currentPoly.length > 0) {
          flushCurrent();
        }
        currentPoly.push(pStart, pEnd);
      } else {
        const last = currentPoly[currentPoly.length - 1];
        if (Math.hypot(pEnd.x - last.x, pEnd.y - last.y) > 0.05) {
          currentPoly.push(pEnd);
        }
      }

      if (t1 < 1 - EPS) {
        flushCurrent();
      }
    }
  }
  flushCurrent();

  if (!anyErased) return null;

  const kept: StrokeObject[] = [];
  let z = startZIndex;
  for (const sub of subPolylines) {
    if (polylineLength(sub) < MIN_FRAGMENT_LENGTH) continue;
    kept.push(buildStrokeFromWorldPoints(obj, sub, z++));
  }
  return kept;
}

// Borrado parcial de líneas rectas, vectores, flechas, segmentos y conectores
export function sliceLineWithCapsule(
  obj: LineObject,
  capA: Point2D,
  capB: Point2D,
  radius: number,
  startZIndex: number
): CanvasObject[] | null {
  // Líneas ortogonales o curvas se recortan como polilínea segmentada
  if (obj.lineKind === 'orthogonal' || obj.lineKind === 'connector') {
    const { pts } = getLineWorldSegments(obj);
    if (pts.length < 2) return null;

    let anyErased = false;
    const chains: Point2D[][] = [];
    let current: Point2D[] = [];

    for (let i = 0; i < pts.length - 1; i++) {
      const sa = pts[i];
      const sb = pts[i + 1];
      if (Math.hypot(sb.x - sa.x, sb.y - sa.y) <= EPS) continue;
      const { removed, surviving } = computeSurvivingSegmentIntervals(
        sa,
        sb,
        capA,
        capB,
        radius
      );
      if (removed) anyErased = true;
      if (surviving.length === 0) {
        if (current.length >= 2) chains.push(current);
        current = [];
        continue;
      }
      for (const [t0, t1] of surviving) {
        const p0 = lerpPoint2D(sa, sb, t0);
        const p1 = lerpPoint2D(sa, sb, t1);
        if (t0 > EPS || current.length === 0) {
          if (current.length >= 2) chains.push(current);
          current = [p0, p1];
        } else {
          current.push(p1);
        }
        if (t1 < 1 - EPS) {
          if (current.length >= 2) chains.push(current);
          current = [];
        }
      }
    }
    if (current.length >= 2) chains.push(current);

    if (!anyErased) return null;

    const out: CanvasObject[] = [];
    let z = startZIndex;
    const baseShapeTemplate: ShapeObject = {
      id: obj.id,
      type: 'shape',
      shapeKind: 'polyline',
      layerId: obj.layerId,
      groupId: obj.groupId,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      rotation: 0,
      opacity: obj.opacity,
      locked: false,
      zIndex: z,
      strokeColor: obj.strokeColor,
      fillColor: 'transparent',
      strokeWidth: obj.strokeWidth,
      strokeStyle: obj.strokeStyle,
      cornerRadius: 0,
    };

    for (const chain of chains) {
      if (polylineLength(chain) < MIN_FRAGMENT_LENGTH) continue;
      if (chain.length === 2) {
        out.push(
          buildLineObjectFromWorldEndpoints(
            { ...obj, lineKind: 'line' },
            chain[0],
            chain[1],
            uid('line'),
            z++
          )
        );
      } else {
        out.push(buildPolylineShapeFromWorldPoints(baseShapeTemplate, chain, uid('shp'), z++));
      }
    }
    return out;
  }

  // Línea recta estándar (o segmento/flecha/vector)
  const sWorld = localToWorld(obj.startPoint, obj);
  const eWorld = localToWorld(obj.endPoint, obj);
  const { removed, surviving } = computeSurvivingSegmentIntervals(
    sWorld,
    eWorld,
    capA,
    capB,
    radius
  );

  if (!removed) return null;

  const out: LineObject[] = [];
  let z = startZIndex;
  for (let i = 0; i < surviving.length; i++) {
    const [t0, t1] = surviving[i];
    const p0 = lerpPoint2D(sWorld, eWorld, t0);
    const p1 = lerpPoint2D(sWorld, eWorld, t1);
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < MIN_FRAGMENT_LENGTH) continue;

    // Si es flecha direccional partida al centro, evitar duplicar la punta en el corte interior
    let nextKind = obj.lineKind;
    if (obj.lineKind === 'arrow' && t1 < 1 - EPS) {
      nextKind = 'line';
    } else if (obj.lineKind === 'vector') {
      if (t0 > EPS && t1 < 1 - EPS) nextKind = 'line';
      else if (t0 > EPS) nextKind = 'arrow';
      else if (t1 < 1 - EPS) nextKind = 'line';
    }

    const seg = buildLineObjectFromWorldEndpoints(
      { ...obj, lineKind: nextKind },
      p0,
      p1,
      uid('line'),
      z++
    );
    out.push(seg);
  }
  return out;
}

// Construye un objeto arco en coordenadas del mundo conservando exactamente centro y radio originales
function buildArcShapeFromCircleParams(
  template: ShapeObject,
  worldCenter: Point2D,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
  zIndex: number
): ShapeObject {
  const safeRx = Math.max(4, rx);
  const safeRy = Math.max(4, ry);
  // shapeRenderer.buildArcPath utiliza margen fijo 4 por lado (rx = w/2 - 4)
  const w = Math.max(12, safeRx * 2 + 8);
  const h = Math.max(12, safeRy * 2 + 8);
  const normStart = normalizeDeg360(startDeg);
  const normEnd = normalizeDeg360(endDeg);

  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'arc',
    layerId: template.layerId,
    groupId: template.groupId,
    x: worldCenter.x - w / 2,
    y: worldCenter.y - h / 2,
    width: w,
    height: h,
    rotation: template.rotation,
    flipX: template.flipX,
    flipY: template.flipY,
    opacity: template.opacity,
    locked: false,
    zIndex,
    strokeColor: template.strokeColor,
    fillColor: 'transparent',
    strokeWidth: template.strokeWidth,
    strokeStyle: template.strokeStyle,
    cornerRadius: 0,
    arcStartAngle: normStart,
    arcEndAngle: normEnd,
  };
}

// Borrado parcial de círculos, elipses y arcos convirtiendo los tramos restantes en arcos independientes
export function sliceCircleOrArcWithCapsule(
  obj: ShapeObject,
  capAWorld: Point2D,
  capBWorld: Point2D,
  radius: number,
  startZIndex: number
): ShapeObject[] | null {
  const w = Math.max(10, obj.width);
  const h = Math.max(10, obj.height);
  const isArc = obj.shapeKind === 'arc';
  const rx = isArc ? Math.max(4, w / 2 - 4) : Math.max(4, w / 2 - (obj.strokeWidth / 2 + 2));
  const ry = isArc ? Math.max(4, h / 2 - 4) : Math.max(4, h / 2 - (obj.strokeWidth / 2 + 2));

  const cxLocal = w / 2;
  const cyLocal = h / 2;
  const worldCenter = {
    x: obj.x + cxLocal,
    y: obj.y + cyLocal,
  };

  // Transformar la cápsula al espacio local del trazado (considerando rotación y espejo)
  const aLoc = worldToLocal(capAWorld, obj);
  const bLoc = worldToLocal(capBWorld, obj);
  const aRender: Point2D = {
    x: obj.flipX ? w - aLoc.x : aLoc.x,
    y: obj.flipY ? h - aLoc.y : aLoc.y,
  };
  const bRender: Point2D = {
    x: obj.flipX ? w - bLoc.x : bLoc.x,
    y: obj.flipY ? h - bLoc.y : bLoc.y,
  };

  let theta0 = 0;
  let theta1 = 360;
  let isClosedLoop = true;

  if (isArc) {
    const rawStart = obj.arcStartAngle ?? 0;
    const rawEnd = obj.arcEndAngle ?? 220;
    const sweep = normalizeDeg360(rawEnd - rawStart);
    if (sweep < 359.8) {
      theta0 = normalizeDeg360(rawStart);
      theta1 = theta0 + sweep;
      isClosedLoop = false;
    }
  }

  const totalSweep = theta1 - theta0;
  const approxPerimeter =
    Math.PI * (3 * (rx + ry) - Math.sqrt(Math.max(1, (3 * rx + ry) * (rx + 3 * ry)))) *
    (totalSweep / 360);
  const maxStepArc = Math.max(0.4, radius * 0.25);
  const steps = Math.min(2048, Math.max(360, Math.ceil(approxPerimeter / maxStepArc)));
  const dTheta = totalSweep / steps;

  const isHitAtAngle = (deg: number): boolean => {
    const pt = svgArcPoint(cxLocal, cyLocal, rx, ry, deg);
    return distancePointToSegmentWorld(pt, aRender, bRender) <= radius;
  };

  const refineBoundary = (degA: number, degB: number, hitA: boolean): number => {
    let lo = degA;
    let hi = degB;
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) * 0.5;
      if (isHitAtAngle(mid) === hitA) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) * 0.5;
  };

  const rawSurviving: [number, number][] = [];
  let prevDeg = theta0;
  let prevHit = isHitAtAngle(prevDeg);
  let activeStart: number | null = prevHit ? null : prevDeg;
  let anyHit = prevHit;

  for (let i = 1; i <= steps; i++) {
    const currDeg = i === steps ? theta1 : theta0 + i * dTheta;
    const currHit = isHitAtAngle(currDeg);
    if (currHit) anyHit = true;

    if (prevHit !== currHit) {
      const boundary = refineBoundary(prevDeg, currDeg, prevHit);
      if (!prevHit && currHit) {
        if (activeStart !== null && boundary > activeStart + 1e-4) {
          rawSurviving.push([activeStart, boundary]);
        }
        activeStart = null;
      } else {
        activeStart = boundary;
      }
    }

    prevDeg = currDeg;
    prevHit = currHit;
  }

  if (activeStart !== null && theta1 > activeStart + 1e-4) {
    rawSurviving.push([activeStart, theta1]);
  }

  if (!anyHit) return null;

  // Para círculos cerrados, fusionar el tramo final con el inicial si no se cortó en 0°/360°
  const merged: [number, number][] = [...rawSurviving];
  if (
    isClosedLoop &&
    merged.length >= 2 &&
    Math.abs(merged[0][0] - theta0) < 1e-3 &&
    Math.abs(merged[merged.length - 1][1] - theta1) < 1e-3
  ) {
    const first = merged.shift()!;
    const last = merged.pop()!;
    merged.unshift([last[0], last[1] + (first[1] - first[0])]);
  }

  const avgR = (rx + ry) * 0.5;
  const out: ShapeObject[] = [];
  let z = startZIndex;
  for (const [aDeg, bDeg] of merged) {
    const sweepDeg = bDeg - aDeg;
    if (sweepDeg <= 0.1) continue;
    const arcLen = ((sweepDeg * Math.PI) / 180) * avgR;
    if (arcLen < MIN_FRAGMENT_LENGTH) continue;
    out.push(buildArcShapeFromCircleParams(obj, worldCenter, rx, ry, aDeg, bDeg, z++));
  }

  return out;
}

// Descompone rectángulos, polígonos o polilíneas en segmentos del mundo y aplica el corte parcial
export function slicePolygonOrRectWithCapsule(
  obj: ShapeObject,
  capA: Point2D,
  capB: Point2D,
  radius: number,
  startZIndex: number
): CanvasObject[] | null {
  const geom = getShapeEditableGeometry(obj);
  if (!geom || geom.mode === 'solid-3d' || geom.mode === 'ellipse-cardinal') {
    return null;
  }

  const worldVerts = geom.vertices.map((v) => localToWorld(v, obj));
  if (worldVerts.length < 2) return null;

  const edges: [Point2D, Point2D][] = [];
  for (let i = 0; i < worldVerts.length - 1; i++) {
    edges.push([worldVerts[i], worldVerts[i + 1]]);
  }
  if (geom.closed && worldVerts.length >= 3) {
    edges.push([worldVerts[worldVerts.length - 1], worldVerts[0]]);
  }

  let anyErased = false;
  const survivingSegs: [Point2D, Point2D][] = [];

  for (const [ea, eb] of edges) {
    const { removed, surviving } = computeSurvivingSegmentIntervals(
      ea,
      eb,
      capA,
      capB,
      radius
    );
    if (removed) {
      anyErased = true;
    }
    for (const [t0, t1] of surviving) {
      const p0 = lerpPoint2D(ea, eb, t0);
      const p1 = lerpPoint2D(ea, eb, t1);
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) >= MIN_FRAGMENT_LENGTH) {
        survivingSegs.push([p0, p1]);
      }
    }
  }

  if (!anyErased) return null;

  const lineTemplate: LineObject = {
    id: obj.id,
    type: 'line',
    lineKind: 'line',
    layerId: obj.layerId,
    groupId: obj.groupId,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: obj.opacity,
    locked: false,
    zIndex: startZIndex,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 10, y: 0 },
    strokeColor: obj.strokeColor,
    strokeWidth: obj.strokeWidth,
    strokeStyle: obj.strokeStyle,
  };

  let z = startZIndex;
  return survivingSegs.map(([p0, p1]) =>
    buildLineObjectFromWorldEndpoints(lineTemplate, p0, p1, uid('line'), z++)
  );
}

// Prueba rápida de caja envolvente para descartar objetos alejados de la zona barrida
function objectOverlapsSweepBox(
  obj: CanvasObject,
  capMinX: number,
  capMinY: number,
  capMaxX: number,
  capMaxY: number
): boolean {
  const sw =
    obj.type === 'stroke' || obj.type === 'shape' || obj.type === 'line'
      ? obj.strokeWidth
      : 4;
  const pad = Math.max(8, sw + 6);

  if (Math.abs(obj.rotation || 0) < 1e-4) {
    return (
      obj.x - pad <= capMaxX &&
      obj.x + obj.width + pad >= capMinX &&
      obj.y - pad <= capMaxY &&
      obj.y + obj.height + pad >= capMinY
    );
  }

  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  const halfDiag = Math.hypot(obj.width, obj.height) * 0.5 + pad;
  return (
    cx - halfDiag <= capMaxX &&
    cx + halfDiag >= capMinX &&
    cy - halfDiag <= capMaxY &&
    cy + halfDiag >= capMinY
  );
}

/**
 * Aplica una pasada elemental del borrador entre prevWorld y currWorld sobre todos los
 * elementos compatibles (trazos, líneas, rectángulos, polígonos, círculos y arcos).
 * Todo se calcula y guarda en coordenadas del mundo.
 */
export function computeSweptEraserResult(
  prevWorld: Point2D,
  currWorld: Point2D,
  radiusWorld: number,
  objects: CanvasObject[],
  startZIndex: number,
  isEditableObject: (obj: CanvasObject) => boolean
): SweptEraserResult {
  const radius = Math.max(0.5, radiusWorld);
  const capMinX = Math.min(prevWorld.x, currWorld.x) - radius;
  const capMaxX = Math.max(prevWorld.x, currWorld.x) + radius;
  const capMinY = Math.min(prevWorld.y, currWorld.y) - radius;
  const capMaxY = Math.max(prevWorld.y, currWorld.y) + radius;

  const deleteIds: string[] = [];
  const addObjects: CanvasObject[] = [];
  let cursorZ = startZIndex;

  // OPT: 2.4 — Prefiltrado por índice espacial O(k) en tableros grandes (>800); en tableros menores objectOverlapsSweepBox evita reconstruir cuadrículas tras cada fragmentación
  const candidates =
    objects.length > 800 && isOptEnabled('spatialIndex')
      ? safeRunOpt(
          'spatialIndex',
          () => queryObjectsInWorldBox(objects, capMinX, capMinY, capMaxX, capMaxY),
          () => objects
        )
      : objects;

  for (const obj of candidates) {
    if (!isEditableObject(obj)) continue;
    if (!objectOverlapsSweepBox(obj, capMinX, capMinY, capMaxX, capMaxY)) {
      continue;
    }

    if (obj.type === 'stroke') {
      const pieces = sliceStrokeWithCapsule(obj, prevWorld, currWorld, radius, cursorZ);
      if (pieces !== null) {
        deleteIds.push(obj.id);
        addObjects.push(...pieces);
        cursorZ += pieces.length;
      }
      continue;
    }

    if (obj.type === 'line') {
      const pieces = sliceLineWithCapsule(obj, prevWorld, currWorld, radius, cursorZ);
      if (pieces !== null) {
        deleteIds.push(obj.id);
        addObjects.push(...pieces);
        cursorZ += pieces.length;
      }
      continue;
    }

    if (obj.type === 'shape') {
      if (
        obj.shapeKind === 'circle' ||
        obj.shapeKind === 'ellipse' ||
        obj.shapeKind === 'arc'
      ) {
        const pieces = sliceCircleOrArcWithCapsule(
          obj,
          prevWorld,
          currWorld,
          radius,
          cursorZ
        );
        if (pieces !== null) {
          deleteIds.push(obj.id);
          addObjects.push(...pieces);
          cursorZ += pieces.length;
        }
        continue;
      }

      const pieces = slicePolygonOrRectWithCapsule(
        obj,
        prevWorld,
        currWorld,
        radius,
        cursorZ
      );
      if (pieces !== null) {
        deleteIds.push(obj.id);
        addObjects.push(...pieces);
        cursorZ += pieces.length;
      }
    }
  }

  return {
    deleteIds,
    addObjects,
    changed: deleteIds.length > 0 || addObjects.length > 0,
  };
}
