import type { CadDraftingConfig, PathArrayBasePointMode } from '../../types/cad';
import type {
  CanvasObject,
  DimensionObject,
  GroupRecord,
  LineObject,
  Point2D,
  ShapeObject,
  StrokeObject,
} from '../../types/whiteboard';
import { getObjectsBoundingBox } from '../id';
import {
  buildLineObjectFromWorldEndpoints,
  buildPolylineShapeFromWorldPoints,
  buildShapeObjectFromWorldPolygon,
  getLineWorldSegments,
  getShapeCutPolygonWorld,
  getShapeEditableGeometry,
  localToWorld,
  pointToSegmentDistance,
} from '../geometryCad';
import { cloneObjectsWithGroupTree, ensureGroupsArray } from './cadGroups';
import { computeDimensionMetrics } from './cadDimensions';

const MAX_ARRAY_OBJECTS = 240;

function rotatePointAroundCenter(
  pt: Point2D,
  center: Point2D,
  angleDegScreenCW: number
): Point2D {
  const rad = (angleDegScreenCW * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - center.x;
  const dy = pt.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function rotateCanvasObjectAroundPoint(
  obj: CanvasObject,
  pivot: Point2D,
  angleDegScreenCW: number,
  rotateItemOrientation: boolean,
  cadConfig: CadDraftingConfig
): CanvasObject {
  if (Math.abs(angleDegScreenCW) < 1e-5) return obj;

  const objCenter = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
  const nextCenter = rotatePointAroundCenter(objCenter, pivot, angleDegScreenCW);

  if (!rotateItemOrientation) {
    const dx = nextCenter.x - objCenter.x;
    const dy = nextCenter.y - objCenter.y;
    if (obj.type === 'dimension') {
      const dim = obj as DimensionObject;
      return {
        ...dim,
        x: dim.x + dx,
        y: dim.y + dy,
        p1: { x: dim.p1.x + dx, y: dim.p1.y + dy },
        p2: { x: dim.p2.x + dx, y: dim.p2.y + dy },
        p3: dim.p3 ? { x: dim.p3.x + dx, y: dim.p3.y + dy } : undefined,
        offsetPt: { x: dim.offsetPt.x + dx, y: dim.offsetPt.y + dy },
      };
    }
    return { ...obj, x: obj.x + dx, y: obj.y + dy };
  }

  if (obj.type === 'line') {
    const s = rotatePointAroundCenter(localToWorld(obj.startPoint, obj), pivot, angleDegScreenCW);
    const e = rotatePointAroundCenter(localToWorld(obj.endPoint, obj), pivot, angleDegScreenCW);
    const ctrl = obj.controlPoint
      ? rotatePointAroundCenter(localToWorld(obj.controlPoint, obj), pivot, angleDegScreenCW)
      : undefined;
    return buildLineObjectFromWorldEndpoints(obj as LineObject, s, e, obj.id, obj.zIndex, ctrl);
  }

  if (obj.type === 'stroke') {
    const origPts = (obj as StrokeObject).points;
    const worldPts = origPts.map((p) => ({
      pt: rotatePointAroundCenter(localToWorld(p, obj), pivot, angleDegScreenCW),
      pressure: p.pressure,
    }));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of worldPts) {
      minX = Math.min(minX, item.pt.x);
      minY = Math.min(minY, item.pt.y);
      maxX = Math.max(maxX, item.pt.x);
      maxY = Math.max(maxY, item.pt.y);
    }
    return {
      ...(obj as StrokeObject),
      x: minX,
      y: minY,
      width: Math.max(8, maxX - minX),
      height: Math.max(8, maxY - minY),
      rotation: 0,
      points: worldPts.map((item) => ({
        x: item.pt.x - minX,
        y: item.pt.y - minY,
        ...(item.pressure !== undefined ? { pressure: item.pressure } : {}),
      })),
    };
  }

  if (obj.type === 'dimension') {
    const dim = obj as DimensionObject;
    const rotatedDim: DimensionObject = {
      ...dim,
      p1: rotatePointAroundCenter(dim.p1, pivot, angleDegScreenCW),
      p2: rotatePointAroundCenter(dim.p2, pivot, angleDegScreenCW),
      p3: dim.p3 ? rotatePointAroundCenter(dim.p3, pivot, angleDegScreenCW) : undefined,
      offsetPt: rotatePointAroundCenter(dim.offsetPt, pivot, angleDegScreenCW),
    };
    const m = computeDimensionMetrics(rotatedDim, cadConfig);
    return {
      ...rotatedDim,
      x: m.bbox.x,
      y: m.bbox.y,
      width: m.bbox.width,
      height: m.bbox.height,
    };
  }

  if (obj.type === 'shape' && obj.shapeKind === 'polyline') {
    const geom = getShapeEditableGeometry(obj as ShapeObject);
    if (geom && geom.vertices.length >= 2) {
      const rotPts = geom.vertices.map((v) =>
        rotatePointAroundCenter(localToWorld(v, obj), pivot, angleDegScreenCW)
      );
      return buildPolylineShapeFromWorldPoints(obj as ShapeObject, rotPts, obj.id, obj.zIndex);
    }
  }

  if (obj.type === 'shape' && obj.shapeKind === 'custom-polygon') {
    const geom = getShapeEditableGeometry(obj as ShapeObject);
    if (geom && geom.vertices.length >= 3) {
      const rotPts = geom.vertices.map((v) =>
        rotatePointAroundCenter(localToWorld(v, obj), pivot, angleDegScreenCW)
      );
      return buildShapeObjectFromWorldPolygon(obj as ShapeObject, rotPts, obj.id, obj.zIndex);
    }
  }

  return {
    ...obj,
    x: nextCenter.x - obj.width / 2,
    y: nextCenter.y - obj.height / 2,
    rotation: Math.round(((obj.rotation || 0) + angleDegScreenCW) * 100) / 100,
  };
}

export function generateRectangularArray(
  sourceObjects: CanvasObject[],
  sourceGroups: GroupRecord[],
  params: {
    rows: number;
    cols: number;
    dxWorld: number;
    dyWorld: number;
  },
  layerId: string,
  startZIndex: number
): {
  addObjects: CanvasObject[];
  addGroups: GroupRecord[];
  createdIds: string[];
} {
  if (sourceObjects.length === 0) {
    return { addObjects: [], addGroups: [], createdIds: [] };
  }
  const rows = Math.max(1, Math.min(40, Math.round(params.rows)));
  const cols = Math.max(1, Math.min(40, Math.round(params.cols)));
  const safeGroups = ensureGroupsArray(sourceGroups);

  const addObjects: CanvasObject[] = [];
  const addGroups: GroupRecord[] = [];
  let z = startZIndex;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      if (addObjects.length + sourceObjects.length > MAX_ARRAY_OBJECTS) break;
      const dx = c * params.dxWorld;
      const dy = r * params.dyWorld;
      const { clones, newGroups } = cloneObjectsWithGroupTree(
        sourceObjects,
        safeGroups,
        dx,
        dy,
        layerId,
        z
      );
      z += clones.length;
      addObjects.push(...clones);
      addGroups.push(...newGroups);
    }
  }

  return {
    addObjects,
    addGroups,
    createdIds: addObjects.map((o) => o.id),
  };
}

export function generatePolarArray(
  sourceObjects: CanvasObject[],
  sourceGroups: GroupRecord[],
  params: {
    centerWorld: Point2D;
    count: number;
    totalAngleDeg: number;
    rotateItems: boolean;
  },
  cadConfig: CadDraftingConfig,
  layerId: string,
  startZIndex: number
): {
  addObjects: CanvasObject[];
  addGroups: GroupRecord[];
  createdIds: string[];
} {
  if (sourceObjects.length === 0) {
    return { addObjects: [], addGroups: [], createdIds: [] };
  }
  const count = Math.max(2, Math.min(120, Math.round(params.count)));
  const safeGroups = ensureGroupsArray(sourceGroups);
  const fullCircle = Math.abs(Math.abs(params.totalAngleDeg) - 360) < 1e-3;
  const cadStepDeg = fullCircle
    ? params.totalAngleDeg / count
    : params.totalAngleDeg / Math.max(1, count - 1);

  const addObjects: CanvasObject[] = [];
  const addGroups: GroupRecord[] = [];
  let z = startZIndex;

  for (let i = 1; i < count; i++) {
    if (addObjects.length + sourceObjects.length > MAX_ARRAY_OBJECTS) break;
    const cadAngDeg = cadStepDeg * i;
    const screenAngleCW = cadConfig.yAxisUp ? -cadAngDeg : cadAngDeg;
    const { clones, newGroups } = cloneObjectsWithGroupTree(
      sourceObjects,
      safeGroups,
      0,
      0,
      layerId,
      z
    );
    z += clones.length;
    const rotatedClones = clones.map((c) =>
      rotateCanvasObjectAroundPoint(
        c,
        params.centerWorld,
        screenAngleCW,
        params.rotateItems,
        cadConfig
      )
    );
    addObjects.push(...rotatedClones);
    addGroups.push(...newGroups);
  }

  return {
    addObjects,
    addGroups,
    createdIds: addObjects.map((o) => o.id),
  };
}

export function extractWorldPathPoints(
  pathObject: CanvasObject
): { pts: Point2D[]; closed: boolean } | null {
  if (pathObject.type === 'line') {
    const seg = getLineWorldSegments(pathObject);
    return { pts: seg.pts, closed: false };
  }
  if (pathObject.type === 'shape') {
    const poly = getShapeCutPolygonWorld(pathObject);
    if (!poly || poly.pts.length < 2) return null;
    if (poly.closed) {
      return { pts: [...poly.pts, poly.pts[0]], closed: true };
    }
    return { pts: poly.pts, closed: false };
  }
  if (pathObject.type === 'stroke' && pathObject.points.length >= 2) {
    return {
      pts: pathObject.points.map((p) => localToWorld(p, pathObject)),
      closed: false,
    };
  }
  return null;
}

function samplePathAtDistance(
  pts: Point2D[],
  cumLen: number[],
  targetDist: number
): { point: Point2D; tangentDegScreenCW: number } {
  const total = cumLen[cumLen.length - 1];
  const d = Math.max(0, Math.min(total, targetDist));
  for (let i = 0; i < cumLen.length - 1; i++) {
    if (d <= cumLen[i + 1] + 1e-6 || i === cumLen.length - 2) {
      const segLen = Math.max(1e-6, cumLen[i + 1] - cumLen[i]);
      const t = Math.max(0, Math.min(1, (d - cumLen[i]) / segLen));
      const a = pts[i];
      const b = pts[i + 1];
      return {
        point: {
          x: a.x + t * (b.x - a.x),
          y: a.y + t * (b.y - a.y),
        },
        tangentDegScreenCW: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? last;
  return {
    point: last,
    tangentDegScreenCW: (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI,
  };
}

/**
 * Obtiene puntos característicos en coordenadas del mundo (extremos, vértices,
 * puntos cardinales o esquinas) para determinar el punto de apoyo predeterminado
 * de un objeto seleccionado al ejecutar una Matriz por Camino (MC).
 */
export function getObjectCharacteristicPointsWorld(obj: CanvasObject): Point2D[] {
  if (obj.type === 'line') {
    const seg = getLineWorldSegments(obj);
    return seg.pts.length > 0
      ? seg.pts
      : [localToWorld(obj.startPoint, obj), localToWorld(obj.endPoint, obj)];
  }

  if (obj.type === 'shape') {
    const pts: Point2D[] = [];
    const geom = getShapeEditableGeometry(obj);
    if (geom && geom.vertices.length > 0) {
      for (const v of geom.vertices) {
        pts.push(localToWorld(v, obj));
      }
    }
    if (obj.shapeKind === 'arc' || obj.shapeKind === 'curve') {
      const cutPoly = getShapeCutPolygonWorld(obj);
      if (cutPoly && cutPoly.pts.length >= 2) {
        pts.push(cutPoly.pts[0], cutPoly.pts[cutPoly.pts.length - 1]);
      }
    }
    if (pts.length > 0) return pts;
  }

  if (obj.type === 'stroke' && obj.points.length > 0) {
    const first = localToWorld(obj.points[0], obj);
    const last = localToWorld(obj.points[obj.points.length - 1], obj);
    const mid = localToWorld(obj.points[Math.floor(obj.points.length / 2)], obj);
    return [first, mid, last];
  }

  if (obj.type === 'dimension') {
    return [obj.p1, obj.p2, ...(obj.p3 ? [obj.p3] : [])];
  }

  // Objetos de caja (texto, nota, tabla, ecuación, gráfica, imagen, documento)
  const w = Math.max(1, obj.width);
  const h = Math.max(1, obj.height);
  return [
    localToWorld({ x: 0, y: 0 }, obj),
    localToWorld({ x: w / 2, y: 0 }, obj),
    localToWorld({ x: w, y: 0 }, obj),
    localToWorld({ x: w, y: h / 2 }, obj),
    localToWorld({ x: w, y: h }, obj),
    localToWorld({ x: w / 2, y: h }, obj),
    localToWorld({ x: 0, y: h }, obj),
    localToWorld({ x: 0, y: h / 2 }, obj),
  ];
}

/**
 * Calcula el punto base predeterminado ("Extremo") para Matriz por Camino (MC):
 * busca entre los puntos característicos de los objetos seleccionados aquel
 * más cercano al camino (y en caso de empate en distancia al camino, el más
 * próximo al inicio del camino pts[0]). Así, una línea vertical apoyada sobre
 * un camino horizontal toma su extremo inferior como punto base.
 */
export function computeDefaultPathArrayBasePoint(
  sourceObjects: CanvasObject[],
  pathObject?: CanvasObject | null
): Point2D {
  const bbox = getObjectsBoundingBox(sourceObjects);
  if (!bbox) return { x: 0, y: 0 };

  const candidates: Point2D[] = [];
  for (const obj of sourceObjects) {
    candidates.push(...getObjectCharacteristicPointsWorld(obj));
  }
  if (candidates.length === 0) {
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height };
  }

  const pathData = pathObject ? extractWorldPathPoints(pathObject) : null;
  if (!pathData || pathData.pts.length < 2) {
    // Sin camino elegido todavía: preferir el punto inferior (mayor Y) y luego menor X
    let best = candidates[0];
    for (const pt of candidates) {
      if (pt.y > best.y + 0.5 || (Math.abs(pt.y - best.y) <= 0.5 && pt.x < best.x)) {
        best = pt;
      }
    }
    return best;
  }

  const pts = pathData.pts;
  const pathStart = pts[0];
  const scored = candidates.map((pt) => {
    let minDistToPath = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointToSegmentDistance(pt, pts[i], pts[i + 1]).dist;
      if (d < minDistToPath) minDistToPath = d;
    }
    const distToStart = Math.hypot(pt.x - pathStart.x, pt.y - pathStart.y);
    return { pt, minDistToPath, distToStart };
  });

  let globalMinPathDist = Infinity;
  for (const s of scored) {
    if (s.minDistToPath < globalMinPathDist) globalMinPathDist = s.minDistToPath;
  }

  // Tolerancia de 1.5 px para desempatar puntos igualmente apoyados sobre el camino por cercanía al inicio
  let chosen = scored[0];
  let bestStartDist = Infinity;
  for (const s of scored) {
    if (s.minDistToPath <= globalMinPathDist + 1.5) {
      if (s.distToStart < bestStartDist) {
        bestStartDist = s.distToStart;
        chosen = s;
      }
    }
  }
  return chosen.pt;
}

/**
 * Resuelve el punto base efectivo según el modo elegido:
 * - 'center': centro geométrico de la caja delimitadora (comportamiento clásico/legado).
 * - 'closest': punto del objeto más cercano al camino / inicio del camino (predeterminado MC).
 * - 'custom': coordenada exacta marcada con clic (RG/OSNAP) o teclado por el usuario.
 */
export function resolvePathArrayBasePoint(
  sourceObjects: CanvasObject[],
  pathObject: CanvasObject | null | undefined,
  mode: PathArrayBasePointMode = 'center',
  customBasePointWorld?: Point2D | null
): Point2D | null {
  if (sourceObjects.length === 0) return null;
  const bbox = getObjectsBoundingBox(sourceObjects);
  if (!bbox) return null;

  if (mode === 'custom') {
    if (
      customBasePointWorld &&
      Number.isFinite(customBasePointWorld.x) &&
      Number.isFinite(customBasePointWorld.y)
    ) {
      return { x: customBasePointWorld.x, y: customBasePointWorld.y };
    }
    return null;
  }

  if (mode === 'center') {
    return {
      x: bbox.x + bbox.width / 2,
      y: bbox.y + bbox.height / 2,
    };
  }

  return computeDefaultPathArrayBasePoint(sourceObjects, pathObject);
}

/**
 * Genera una matriz por camino (MC) colocando el punto base de cada copia
 * exactamente sobre los puntos muestreados del camino:
 *
 * Cálculo de la posición y orientación de cada copia `i`:
 * 1. Sea B = (Bx, By) el punto base resuelto en los objetos originales.
 * 2. Para la muestra `i` a distancia `d_i` sobre el camino se obtiene
 *    P_i = (Pix, Piy) y la tangente local `tan_i` (y `tan_0` en el inicio).
 * 3. Vector de traslación: v_i = P_i - B = (Pix - Bx, Piy - By).
 *    Al trasladar cada copia por v_i, el punto base queda sobre P_i y se
 *    conserva intacto el vector relativo (Q - B) de todo el objeto respecto al camino.
 * 4. Si `alignToPath` es verdadero, la copia ya trasladada gira alrededor del
 *    pivote P_i un ángulo `tan_i - tan_0`, siguiendo la tangente del camino
 *    sin despegar el punto base de la trayectoria y manteniendo el ángulo relativo
 *    que tenía el original respecto al camino en su primer punto.
 */
export function generatePathArray(
  sourceObjects: CanvasObject[],
  sourceGroups: GroupRecord[],
  pathObject: CanvasObject,
  params: {
    mode: 'count' | 'spacing';
    count: number;
    spacingWorld: number;
    alignToPath: boolean;
    basePointMode?: PathArrayBasePointMode;
    basePointWorld?: Point2D | null;
    includeOriginalAtStart?: boolean;
  },
  cadConfig: CadDraftingConfig,
  layerId: string,
  startZIndex: number
): {
  addObjects: CanvasObject[];
  addGroups: GroupRecord[];
  createdIds: string[];
  basePointUsed: Point2D | null;
  error?: string;
} {
  if (sourceObjects.length === 0) {
    return {
      addObjects: [],
      addGroups: [],
      createdIds: [],
      basePointUsed: null,
      error: 'Selecciona al menos un objeto para la matriz por camino.',
    };
  }

  const pathData = extractWorldPathPoints(pathObject);
  if (!pathData || pathData.pts.length < 2) {
    return {
      addObjects: [],
      addGroups: [],
      createdIds: [],
      basePointUsed: null,
      error: 'El camino seleccionado no es válido para la matriz por camino.',
    };
  }

  const pts = pathData.pts;
  const cumLen: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cumLen.push(cumLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const totalLen = cumLen[cumLen.length - 1];
  if (!Number.isFinite(totalLen) || totalLen < 2) {
    return {
      addObjects: [],
      addGroups: [],
      createdIds: [],
      basePointUsed: null,
      error: 'El camino seleccionado tiene longitud insuficiente.',
    };
  }

  // Conserva comportamiento "Centro" cuando el invocador legado no especifica basePointMode
  const effectiveMode: PathArrayBasePointMode =
    params.basePointMode ?? (params.basePointWorld ? 'custom' : 'center');
  const basePoint = resolvePathArrayBasePoint(
    sourceObjects,
    pathObject,
    effectiveMode,
    params.basePointWorld
  );
  if (!basePoint || !Number.isFinite(basePoint.x) || !Number.isFinite(basePoint.y)) {
    return {
      addObjects: [],
      addGroups: [],
      createdIds: [],
      basePointUsed: null,
      error: 'El punto base especificado no es válido.',
    };
  }

  const sampleDists: number[] = [];
  if (params.mode === 'spacing') {
    const step = Math.max(4, params.spacingWorld);
    const maxItems = Math.min(80, Math.floor(totalLen / step) + 1);
    for (let i = 0; i < maxItems; i++) {
      const d = i * step;
      if (pathData.closed && totalLen - d < step * 0.25 && i > 0) break;
      sampleDists.push(d);
    }
  } else {
    const cnt = Math.max(2, Math.min(80, Math.round(params.count)));
    for (let i = 0; i < cnt; i++) {
      const d = pathData.closed
        ? (totalLen * i) / cnt
        : (totalLen * i) / Math.max(1, cnt - 1);
      sampleDists.push(d);
    }
  }

  const safeGroups = ensureGroupsArray(sourceGroups);
  const startTan = samplePathAtDistance(pts, cumLen, 0).tangentDegScreenCW;
  const addObjects: CanvasObject[] = [];
  const addGroups: GroupRecord[] = [];
  let z = startZIndex;

  for (let i = 0; i < sampleDists.length; i++) {
    // Evita duplicar una copia sobre el original en el inicio del camino cuando el usuario activa esa opción
    if (params.includeOriginalAtStart && i === 0) {
      continue;
    }
    if (addObjects.length + sourceObjects.length > MAX_ARRAY_OBJECTS) break;

    const sample = samplePathAtDistance(pts, cumLen, sampleDists[i]);
    const dx = sample.point.x - basePoint.x;
    const dy = sample.point.y - basePoint.y;

    const { clones, newGroups } = cloneObjectsWithGroupTree(
      sourceObjects,
      safeGroups,
      dx,
      dy,
      layerId,
      z
    );
    z += clones.length;

    const deltaAngle = params.alignToPath ? sample.tangentDegScreenCW - startTan : 0;
    const finalClones =
      params.alignToPath && Math.abs(deltaAngle) >= 1e-5
        ? clones.map((c) =>
            rotateCanvasObjectAroundPoint(c, sample.point, deltaAngle, true, cadConfig)
          )
        : clones;

    addObjects.push(...finalClones);
    addGroups.push(...newGroups);
  }

  return {
    addObjects,
    addGroups,
    createdIds: addObjects.map((o) => o.id),
    basePointUsed: basePoint,
  };
}
