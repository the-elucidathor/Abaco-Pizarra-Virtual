import type { CanvasObject, Point2D, ShapeObject } from '../../types/whiteboard';
import { getShapeEditableGeometry, localToWorld } from '../geometryCad';
// OPT: 2.4 — Protección por feature flag y fallback seguro en consultas espaciales
import { isOptEnabled, safeRunOpt } from '../optFlags';

export interface SnapGeometryPool {
  endpoints: { point: Point2D; objectId: string; seg?: [Point2D, Point2D] }[];
  midpoints: { point: Point2D; objectId: string; seg: [Point2D, Point2D] }[];
  centers: { point: Point2D; objectId: string }[];
  quadrants: { point: Point2D; objectId: string }[];
  segments: { a: Point2D; b: Point2D; objectId: string }[];
}

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SpatialGridIndex {
  cellSize: number;
  buckets: Map<number, CanvasObject[]>;
  oversized: CanvasObject[];
  boundsMap: WeakMap<CanvasObject, WorldBounds>;
  orderMap: WeakMap<CanvasObject, number>;
}

// OPT: 2.4 — Empaquetado entero de celda (evita miles de asignaciones de cadenas `${cx},${cy}`)
function packCellKey(cx: number, cy: number): number {
  if (cx < -32000 || cx > 32000 || cy < -32000 || cy > 32000) {
    return (cx & 0xffff) * 65536 + (cy & 0xffff);
  }
  return (cx + 32768) * 65536 + (cy + 32768);
}

const SPATIAL_CELL_SIZE = 240;
const spatialIndexCache = new WeakMap<CanvasObject[], SpatialGridIndex>();
const objectBoundsWeakCache = new WeakMap<
  CanvasObject,
  { x: number; y: number; w: number; h: number; r: number; sw: number; b: WorldBounds }
>();

export function getObjectExpandedBounds(obj: CanvasObject): WorldBounds {
  const sw =
    obj.type === 'stroke' || obj.type === 'line' || obj.type === 'shape'
      ? obj.strokeWidth || 2
      : 0;
  const cached = objectBoundsWeakCache.get(obj);
  if (
    cached &&
    cached.x === obj.x &&
    cached.y === obj.y &&
    cached.w === obj.width &&
    cached.h === obj.height &&
    cached.r === (obj.rotation || 0) &&
    cached.sw === sw
  ) {
    return cached.b;
  }

  const basePad = obj.type === 'line' && obj.lineKind === 'connector' ? 48 : 18;
  const pad = Math.max(basePad, sw + 8);
  let b: WorldBounds;
  if (Math.abs(obj.rotation || 0) < 1e-4) {
    b = {
      minX: obj.x - pad,
      minY: obj.y - pad,
      maxX: obj.x + obj.width + pad,
      maxY: obj.y + obj.height + pad,
    };
  } else {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const halfDiag = Math.hypot(obj.width, obj.height) / 2 + pad;
    b = {
      minX: cx - halfDiag,
      minY: cy - halfDiag,
      maxX: cx + halfDiag,
      maxY: cy + halfDiag,
    };
  }

  objectBoundsWeakCache.set(obj, {
    x: obj.x,
    y: obj.y,
    w: obj.width,
    h: obj.height,
    r: obj.rotation || 0,
    sw,
    b,
  });
  return b;
}

function buildSpatialIndex(objects: CanvasObject[]): SpatialGridIndex {
  const buckets = new Map<number, CanvasObject[]>();
  const oversized: CanvasObject[] = [];
  const boundsMap = new WeakMap<CanvasObject, WorldBounds>();
  const orderMap = new WeakMap<CanvasObject, number>();

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    orderMap.set(obj, i);
    if (obj.type === 'dimension') continue;
    const b = getObjectExpandedBounds(obj);
    boundsMap.set(obj, b);

    const cx0 = Math.floor(b.minX / SPATIAL_CELL_SIZE);
    const cy0 = Math.floor(b.minY / SPATIAL_CELL_SIZE);
    const cx1 = Math.floor(b.maxX / SPATIAL_CELL_SIZE);
    const cy1 = Math.floor(b.maxY / SPATIAL_CELL_SIZE);

    const spanCells = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (spanCells > 64 || !Number.isFinite(spanCells)) {
      oversized.push(obj);
      continue;
    }

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = packCellKey(cx, cy);
        let list = buckets.get(key);
        if (!list) {
          list = [];
          buckets.set(key, list);
        }
        list.push(obj);
      }
    }
  }

  return { cellSize: SPATIAL_CELL_SIZE, buckets, oversized, boundsMap, orderMap };
}

// OPT: 2.4 — Consulta espacial por rectángulo del mundo preservando el orden Z original
export function queryObjectsInWorldBox(
  objects: CanvasObject[],
  qMinX: number,
  qMinY: number,
  qMaxX: number,
  qMaxY: number,
  excludeObjectIds?: string[]
): CanvasObject[] {
  if (objects.length === 0) return [];

  if (!isOptEnabled('spatialIndex') || objects.length <= 160) {
    const excludeSet =
      excludeObjectIds && excludeObjectIds.length > 0 ? new Set(excludeObjectIds) : null;
    return objects.filter((o) => {
      if (o.type === 'dimension') return false;
      if (excludeSet && excludeSet.has(o.id)) return false;
      const b = getObjectExpandedBounds(o);
      return b.maxX >= qMinX && b.minX <= qMaxX && b.maxY >= qMinY && b.minY <= qMaxY;
    });
  }

  return safeRunOpt(
    'spatialIndex',
    () => {
      let index = spatialIndexCache.get(objects);
      if (!index) {
        index = buildSpatialIndex(objects);
        spatialIndexCache.set(objects, index);
      }

      const cx0 = Math.floor(qMinX / index.cellSize);
      const cy0 = Math.floor(qMinY / index.cellSize);
      const cx1 = Math.floor(qMaxX / index.cellSize);
      const cy1 = Math.floor(qMaxY / index.cellSize);

      const excludeSet =
        excludeObjectIds && excludeObjectIds.length > 0 ? new Set(excludeObjectIds) : null;
      const seen = new Set<string>();
      const result: CanvasObject[] = [];

      const maybeAdd = (obj: CanvasObject) => {
        if (seen.has(obj.id)) return;
        if (excludeSet && excludeSet.has(obj.id)) return;
        seen.add(obj.id);
        const b = index!.boundsMap.get(obj) ?? getObjectExpandedBounds(obj);
        if (b.maxX >= qMinX && b.minX <= qMaxX && b.maxY >= qMinY && b.minY <= qMaxY) {
          result.push(obj);
        }
      };

      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const bucket = index.buckets.get(packCellKey(cx, cy));
          if (!bucket) continue;
          for (const obj of bucket) {
            maybeAdd(obj);
          }
        }
      }

      for (const obj of index.oversized) {
        maybeAdd(obj);
      }

      if (result.length > 1) {
        const om = index.orderMap;
        result.sort((a, b) => (om.get(a) ?? 0) - (om.get(b) ?? 0));
      }

      return result;
    },
    () => objects
  );
}

/**
 * Consulta objetos cercanos al punto indicado usando el índice espacial en cuadrícula.
 * Permite escalar con miles de objetos sin recorrer todo el lienzo en cada movimiento del puntero.
 */
export function queryNearbyObjects(
  objects: CanvasObject[],
  center: Point2D,
  radiusWorld: number,
  excludeObjectIds?: string[]
): CanvasObject[] {
  return queryObjectsInWorldBox(
    objects,
    center.x - radiusWorld,
    center.y - radiusWorld,
    center.x + radiusWorld,
    center.y + radiusWorld,
    excludeObjectIds
  );
}

function polarArcLocalPoint(
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

function isAngleInsideSweep(angleDeg: number, startDeg: number, endDeg: number): boolean {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const target = norm(angleDeg);
  const s = norm(startDeg);
  const sweep = norm(endDeg - startDeg);
  const delta = norm(target - s);
  return delta <= sweep + 0.5;
}

export function segmentIntersection(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D
): Point2D | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-6) return null;
  const rx = b1.x - a1.x;
  const ry = b1.y - a1.y;
  const s = (rx * dby - ry * dbx) / denom;
  const t = (rx * day - ry * dax) / denom;
  if (s >= -1e-4 && s <= 1 + 1e-4 && t >= -1e-4 && t <= 1 + 1e-4) {
    return {
      x: a1.x + s * dax,
      y: a1.y + s * day,
    };
  }
  return null;
}

const POLYGON_OR_POLYLINE_KINDS = new Set<ShapeObject['shapeKind']>([
  'rectangle',
  'square',
  'rounded-rect',
  'triangle',
  'right-triangle',
  'right-trapezoid',
  'trapezoid',
  'parallelogram',
  'diamond',
  'pentagon',
  'hexagon',
  'octagon',
  'polygon',
  'star',
  'polyline',
  'custom-polygon',
]);

const CENTER_SHAPE_KINDS = new Set<ShapeObject['shapeKind']>([
  'circle',
  'ellipse',
  'sphere',
  'arc',
  'pentagon',
  'hexagon',
  'octagon',
  'polygon',
]);

export function extractSnapGeometry(objects: CanvasObject[]): SnapGeometryPool {
  const pool: SnapGeometryPool = {
    endpoints: [],
    midpoints: [],
    centers: [],
    quadrants: [],
    segments: [],
  };

  for (const obj of objects) {
    if (obj.type === 'dimension') continue;

    if (obj.type === 'line') {
      const s = localToWorld(obj.startPoint, obj);
      const e = localToWorld(obj.endPoint, obj);
      if (obj.lineKind === 'orthogonal') {
        const midX = (obj.startPoint.x + obj.endPoint.x) / 2;
        const p1 = localToWorld({ x: midX, y: obj.startPoint.y }, obj);
        const p2 = localToWorld({ x: midX, y: obj.endPoint.y }, obj);
        const segs: [Point2D, Point2D][] = [
          [s, p1],
          [p1, p2],
          [p2, e],
        ];
        pool.endpoints.push(
          { point: s, objectId: obj.id, seg: [s, p1] },
          { point: e, objectId: obj.id, seg: [p2, e] }
        );
        for (const seg of segs) {
          pool.segments.push({ a: seg[0], b: seg[1], objectId: obj.id });
          pool.midpoints.push({
            point: { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 },
            objectId: obj.id,
            seg,
          });
        }
      } else {
        const seg: [Point2D, Point2D] = [s, e];
        pool.segments.push({ a: s, b: e, objectId: obj.id });
        pool.endpoints.push(
          { point: s, objectId: obj.id, seg },
          { point: e, objectId: obj.id, seg }
        );
        pool.midpoints.push({
          point: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 },
          objectId: obj.id,
          seg,
        });
      }
      continue;
    }

    if (obj.type === 'shape') {
      if (CENTER_SHAPE_KINDS.has(obj.shapeKind)) {
        pool.centers.push({
          point: localToWorld({ x: obj.width / 2, y: obj.height / 2 }, obj),
          objectId: obj.id,
        });
      }

      if (
        obj.shapeKind === 'circle' ||
        obj.shapeKind === 'ellipse' ||
        obj.shapeKind === 'sphere'
      ) {
        const pad = obj.strokeWidth / 2 + 2;
        const rx = Math.max(3, (obj.width - pad * 2) / 2);
        const ry = Math.max(3, (obj.height - pad * 2) / 2);
        const cx = obj.width / 2;
        const cy = obj.height / 2;
        const quads: Point2D[] = [
          { x: cx, y: cy - ry },
          { x: cx + rx, y: cy },
          { x: cx, y: cy + ry },
          { x: cx - rx, y: cy },
        ];
        for (const qp of quads) {
          pool.quadrants.push({
            point: localToWorld(qp, obj),
            objectId: obj.id,
          });
        }
        continue;
      }

      if (obj.shapeKind === 'semicircle') {
        const pad = obj.strokeWidth / 2 + 2;
        const iw = Math.max(6, obj.width - pad * 2);
        const ih = Math.max(6, obj.height - pad * 2);
        const rx = iw / 2;
        const ry = ih * 0.72;
        const baseY = obj.height - pad - ih * 0.14;
        const cx = obj.width / 2;
        const pLeft = localToWorld({ x: cx - rx, y: baseY }, obj);
        const pRight = localToWorld({ x: cx + rx, y: baseY }, obj);
        const pTop = localToWorld({ x: cx, y: baseY - ry }, obj);
        const pCenter = localToWorld({ x: cx, y: baseY }, obj);
        pool.centers.push({ point: pCenter, objectId: obj.id });
        pool.endpoints.push(
          { point: pLeft, objectId: obj.id },
          { point: pRight, objectId: obj.id }
        );
        pool.quadrants.push(
          { point: pLeft, objectId: obj.id },
          { point: pTop, objectId: obj.id },
          { point: pRight, objectId: obj.id }
        );
        continue;
      }

      if (obj.shapeKind === 'arc') {
        const cx = obj.width / 2;
        const cy = obj.height / 2;
        const rx = Math.max(4, obj.width / 2 - 4);
        const ry = Math.max(4, obj.height / 2 - 4);
        const sa = obj.arcStartAngle ?? 0;
        const ea = obj.arcEndAngle ?? 220;
        const sweep = (((ea - sa) % 360) + 360) % 360;
        const pStart = localToWorld(polarArcLocalPoint(cx, cy, rx, ry, sa), obj);
        const pEnd = localToWorld(polarArcLocalPoint(cx, cy, rx, ry, ea), obj);
        const pMid = localToWorld(
          polarArcLocalPoint(cx, cy, rx, ry, sa + sweep / 2),
          obj
        );
        pool.endpoints.push(
          { point: pStart, objectId: obj.id },
          { point: pEnd, objectId: obj.id }
        );
        pool.midpoints.push({
          point: pMid,
          objectId: obj.id,
          seg: [pStart, pEnd],
        });
        for (const deg of [0, 90, 180, 270]) {
          if (isAngleInsideSweep(deg, sa, ea)) {
            pool.quadrants.push({
              point: localToWorld(polarArcLocalPoint(cx, cy, rx, ry, deg), obj),
              objectId: obj.id,
            });
          }
        }
        continue;
      }

      if (POLYGON_OR_POLYLINE_KINDS.has(obj.shapeKind)) {
        const geom = getShapeEditableGeometry(obj);
        if (!geom || geom.vertices.length < 2) continue;
        const worldVerts = geom.vertices.map((v) => localToWorld(v, obj));
        const edgeCount = geom.closed ? worldVerts.length : worldVerts.length - 1;
        for (let i = 0; i < worldVerts.length; i++) {
          const nextSeg: [Point2D, Point2D] | undefined =
            i < edgeCount ? [worldVerts[i], worldVerts[(i + 1) % worldVerts.length]] : undefined;
          pool.endpoints.push({ point: worldVerts[i], objectId: obj.id, seg: nextSeg });
        }
        for (let i = 0; i < edgeCount; i++) {
          const a = worldVerts[i];
          const b = worldVerts[(i + 1) % worldVerts.length];
          if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-3) continue;
          const seg: [Point2D, Point2D] = [a, b];
          pool.segments.push({ a, b, objectId: obj.id });
          pool.midpoints.push({
            point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            objectId: obj.id,
            seg,
          });
        }
      }
    }
  }

  return pool;
}

/**
 * Comprueba si existe algún extremo/vértice de otro objeto visible dentro del radio indicado.
 * Usado en Selección para priorizar el objeto de abajo cuando el clic queda entre 5 y 8 px de un asa.
 */
export function hasOtherObjectEndpointNearPoint(
  pt: Point2D,
  visibleObjects: CanvasObject[],
  excludeObjectId: string,
  radiusWorld: number
): boolean {
  const nearby = queryNearbyObjects(visibleObjects, pt, radiusWorld + 4, [excludeObjectId]);
  if (nearby.length === 0) return false;
  const pool = extractSnapGeometry(nearby);
  for (const ep of pool.endpoints) {
    if (Math.hypot(ep.point.x - pt.x, ep.point.y - pt.y) <= radiusWorld) {
      return true;
    }
  }
  return false;
}
