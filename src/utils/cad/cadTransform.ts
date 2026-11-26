import type { CadDraftingConfig } from '../../types/cad';
import type {
  CanvasObject,
  DimensionObject,
  EquationObject,
  GroupRecord,
  LineObject,
  Point2D,
  ShapeObject,
  StickyObject,
  StrokeObject,
  TableObject,
  TextObject,
} from '../../types/whiteboard';
import { uid } from '../id';
import {
  buildLineObjectFromWorldEndpoints,
  buildPolylineShapeFromWorldPoints,
  buildShapeObjectFromWorldPolygon,
  getShapeCutPolygonWorld,
  getShapeEditableGeometry,
  localToWorld,
} from '../geometryCad';
import { is3DSolidShape } from '../shapeRenderer';
import {
  clampTextFontSize,
  getDefaultRunStyle,
  normalizarContenidoTexto,
  normalizeTextAlign,
  resolveRunStyle,
  roundFontSizeDecimal,
  syncTextObjectFromParagraphs,
} from '../richText';
import { scaleTableToDimensions } from '../tableUtils';
import {
  ensureGroupsArray,
  expandSelectionToGroups,
  translateCanvasObject,
} from './cadGroups';
import { computeDimensionMetrics } from './cadDimensions';

export function reflectPointAcrossLine(
  p: Point2D,
  axisA: Point2D,
  axisB: Point2D
): Point2D {
  const dx = axisB.x - axisA.x;
  const dy = axisB.y - axisA.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) return { ...p };
  const t = ((p.x - axisA.x) * dx + (p.y - axisA.y) * dy) / lenSq;
  const projX = axisA.x + t * dx;
  const projY = axisA.y + t * dy;
  return {
    x: 2 * projX - p.x,
    y: 2 * projY - p.y,
  };
}

function normalizeDeg(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

/**
 * Computes exact reflected rotation, flipX, and flipY for shapes whose local SVG
 * supports flipX/flipY (3D solids, ellipses, rectangles, etc.) using 2x2 orthogonal matrix math.
 */
function reflectRotationAndFlips(
  rotationDeg: number,
  flipX: boolean,
  flipY: boolean,
  axisA: Point2D,
  axisB: Point2D
): { rotation: number; flipX: boolean; flipY: boolean } {
  const theta = Math.atan2(axisB.y - axisA.y, axisB.x - axisA.x);
  const c2 = Math.cos(2 * theta);
  const s2 = Math.sin(2 * theta);
  // Reflection matrix M(theta) = [[cos(2t), sin(2t)], [sin(2t), -cos(2t)]]
  const m00 = c2;
  const m01 = s2;
  const m10 = s2;
  const m11 = -c2;

  const rot = (rotationDeg * Math.PI) / 180;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  // Current linear map L = R(rot) * diag(sx, sy)
  const l00 = cr * sx;
  const l01 = -sr * sy;
  const l10 = sr * sx;
  const l11 = cr * sy;

  // L_new = M * L
  const n00 = m00 * l00 + m01 * l10;
  const n01 = m00 * l01 + m01 * l11;
  const n10 = m10 * l00 + m11 * l10;
  const n11 = m10 * l01 + m11 * l11;

  const det = n00 * n11 - n01 * n10;
  let nextFlipX = false;
  let nextFlipY = false;
  if (det < 0) {
    // Prefer flipX for mostly vertical mirror lines, flipY for mostly horizontal mirror lines
    if (Math.abs(Math.sin(theta)) >= Math.abs(Math.cos(theta))) {
      nextFlipX = true;
      nextFlipY = false;
    } else {
      nextFlipX = false;
      nextFlipY = true;
    }
  }

  const nsx = nextFlipX ? -1 : 1;
  const nsy = nextFlipY ? -1 : 1;
  // R_new = L_new * diag(nsx, nsy)
  const r00 = n00 * nsx;
  const r10 = n10 * nsx;
  void n01;
  void n11;
  void nsy;
  const nextRot = normalizeDeg((Math.atan2(r10, r00) * 180) / Math.PI);
  return {
    rotation: Math.round(nextRot * 100) / 100,
    flipX: nextFlipX,
    flipY: nextFlipY,
  };
}

function mirrorSingleObject(
  obj: CanvasObject,
  axisA: Point2D,
  axisB: Point2D,
  newId: string,
  zIndex: number,
  layerId: string,
  cadConfig: CadDraftingConfig,
  idMap: Map<string, string>
): CanvasObject {
  if (obj.type === 'line') {
    const s = reflectPointAcrossLine(localToWorld(obj.startPoint, obj), axisA, axisB);
    const e = reflectPointAcrossLine(localToWorld(obj.endPoint, obj), axisA, axisB);
    const ctrl = obj.controlPoint
      ? reflectPointAcrossLine(localToWorld(obj.controlPoint, obj), axisA, axisB)
      : undefined;
    const rebuilt = buildLineObjectFromWorldEndpoints(obj, s, e, newId, zIndex, ctrl);
    return { ...rebuilt, layerId, locked: false };
  }

  if (obj.type === 'stroke') {
    const worldPts = obj.points.map((p) =>
      reflectPointAcrossLine(localToWorld(p, obj), axisA, axisB)
    );
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
    const nextStroke: StrokeObject = {
      ...obj,
      id: newId,
      layerId,
      zIndex,
      locked: false,
      x: minX,
      y: minY,
      width: Math.max(8, maxX - minX),
      height: Math.max(8, maxY - minY),
      rotation: 0,
      points: worldPts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    };
    return nextStroke;
  }

  if (obj.type === 'dimension') {
    const p1 = reflectPointAcrossLine(obj.p1, axisA, axisB);
    const p2 = reflectPointAcrossLine(obj.p2, axisA, axisB);
    const p3 = obj.p3 ? reflectPointAcrossLine(obj.p3, axisA, axisB) : undefined;
    const offsetPt = reflectPointAcrossLine(obj.offsetPt, axisA, axisB);
    const draft: DimensionObject = {
      ...obj,
      id: newId,
      layerId,
      zIndex,
      locked: false,
      p1,
      p2,
      p3,
      offsetPt,
      anchor1:
        obj.anchor1 && idMap.has(obj.anchor1.objectId)
          ? { ...obj.anchor1, objectId: idMap.get(obj.anchor1.objectId)! }
          : undefined,
      anchor2:
        obj.anchor2 && idMap.has(obj.anchor2.objectId)
          ? { ...obj.anchor2, objectId: idMap.get(obj.anchor2.objectId)! }
          : undefined,
      anchor3:
        obj.anchor3 && idMap.has(obj.anchor3.objectId)
          ? { ...obj.anchor3, objectId: idMap.get(obj.anchor3.objectId)! }
          : undefined,
    };
    const m = computeDimensionMetrics(draft, cadConfig);
    return {
      ...draft,
      x: m.bbox.x,
      y: m.bbox.y,
      width: m.bbox.width,
      height: m.bbox.height,
    };
  }

  if (obj.type === 'shape') {
    if (obj.shapeKind === 'polyline') {
      const geom = getShapeEditableGeometry(obj);
      if (geom && geom.vertices.length >= 2) {
        const reflected = geom.vertices.map((v) =>
          reflectPointAcrossLine(localToWorld(v, obj), axisA, axisB)
        );
        const rebuilt = buildPolylineShapeFromWorldPoints(obj, reflected, newId, zIndex);
        return { ...rebuilt, layerId, locked: false };
      }
    }

    if (obj.shapeKind === 'curve') {
      const geom = getShapeEditableGeometry(obj);
      if (geom && geom.vertices.length >= 3) {
        const reflected = geom.vertices.map((v) =>
          reflectPointAcrossLine(localToWorld(v, obj), axisA, axisB)
        );
        const pad = obj.strokeWidth / 2 + 2;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of reflected) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        const x = minX - pad;
        const y = minY - pad;
        return {
          ...obj,
          id: newId,
          layerId,
          zIndex,
          locked: false,
          x,
          y,
          width: Math.max(16, maxX - minX + pad * 2),
          height: Math.max(16, maxY - minY + pad * 2),
          rotation: 0,
          customPoints: reflected.map((p) => ({ x: p.x - x, y: p.y - y })),
        };
      }
    }

    if (obj.shapeKind === 'arc') {
      const center = localToWorld({ x: obj.width / 2, y: obj.height / 2 }, obj);
      const refCenter = reflectPointAcrossLine(center, axisA, axisB);
      const rx = Math.max(4, obj.width / 2 - 4);
      const ry = Math.max(4, obj.height / 2 - 4);
      const sa = obj.arcStartAngle ?? 0;
      const ea = obj.arcEndAngle ?? 220;
      const toWorldOnArc = (deg: number) => {
        const r = ((deg - 90) * Math.PI) / 180;
        return localToWorld(
          { x: obj.width / 2 + rx * Math.cos(r), y: obj.height / 2 + ry * Math.sin(r) },
          obj
        );
      };
      const ws = reflectPointAcrossLine(toWorldOnArc(sa), axisA, axisB);
      const we = reflectPointAcrossLine(toWorldOnArc(ea), axisA, axisB);
      const worldToSvgDeg = (pt: Point2D) => {
        const d = (Math.atan2(pt.y - refCenter.y, pt.x - refCenter.x) * 180) / Math.PI + 90;
        return ((d % 360) + 360) % 360;
      };
      return {
        ...obj,
        id: newId,
        layerId,
        zIndex,
        locked: false,
        x: refCenter.x - obj.width / 2,
        y: refCenter.y - obj.height / 2,
        rotation: 0,
        arcStartAngle: Math.round(worldToSvgDeg(we) * 100) / 100,
        arcEndAngle: Math.round(worldToSvgDeg(ws) * 100) / 100,
      };
    }

    // Circles, ellipses & 3D solids preserve exact parametric/dashed depth geometry
    if (
      obj.shapeKind === 'circle' ||
      obj.shapeKind === 'ellipse' ||
      is3DSolidShape(obj.shapeKind)
    ) {
      const center = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
      const refCenter = reflectPointAcrossLine(center, axisA, axisB);
      const xform = reflectRotationAndFlips(
        obj.rotation || 0,
        Boolean(obj.flipX),
        Boolean(obj.flipY),
        axisA,
        axisB
      );
      return {
        ...obj,
        id: newId,
        layerId,
        zIndex,
        locked: false,
        x: refCenter.x - obj.width / 2,
        y: refCenter.y - obj.height / 2,
        rotation: xform.rotation,
        flipX: xform.flipX || undefined,
        flipY: xform.flipY || undefined,
      };
    }

    // All polygons (rectangle, triangle, hexagon, star, trapezoid, custom-polygon, etc.)
    const geom = getShapeEditableGeometry(obj);
    if (geom && geom.closed && geom.vertices.length >= 3) {
      const reflectedVerts = geom.vertices.map((v) =>
        reflectPointAcrossLine(localToWorld(v, obj), axisA, axisB)
      );
      // Keep simple symmetric rectangle as rectangle if still axis-aligned
      if (
        (obj.shapeKind === 'rectangle' || obj.shapeKind === 'square' || obj.shapeKind === 'rounded-rect') &&
        Math.abs(axisB.x - axisA.x) < 1e-3 ||
        Math.abs(axisB.y - axisA.y) < 1e-3
      ) {
        if (Math.abs(obj.rotation || 0) < 1e-3) {
          const center = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
          const refCenter = reflectPointAcrossLine(center, axisA, axisB);
          return {
            ...obj,
            id: newId,
            layerId,
            zIndex,
            locked: false,
            x: refCenter.x - obj.width / 2,
            y: refCenter.y - obj.height / 2,
          };
        }
      }
      const rebuilt = buildShapeObjectFromWorldPolygon(obj, reflectedVerts, newId, zIndex);
      return { ...rebuilt, layerId, locked: false };
    }
  }

  // Text, Sticky, Equation, Graph, Image, Document: reflect center cleanly keeping readable orientation
  const center = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
  const refCenter = reflectPointAcrossLine(center, axisA, axisB);
  return {
    ...obj,
    id: newId,
    layerId,
    zIndex,
    locked: false,
    x: refCenter.x - obj.width / 2,
    y: refCenter.y - obj.height / 2,
  };
}

export function mirrorObjectsAcrossLine(
  targetIds: string[],
  axisA: Point2D,
  axisB: Point2D,
  keepSource: boolean,
  objects: CanvasObject[],
  groups: GroupRecord[],
  layerId: string,
  startZIndex: number,
  cadConfig: CadDraftingConfig
): {
  objects: CanvasObject[];
  groups: GroupRecord[];
  mirroredIds: string[];
} {
  if (Math.hypot(axisB.x - axisA.x, axisB.y - axisA.y) < 1) {
    return { objects, groups: ensureGroupsArray(groups), mirroredIds: [] };
  }

  const safeGroups = ensureGroupsArray(groups);
  const targetSet = new Set(targetIds);
  const targets = objects.filter((o) => targetSet.has(o.id));
  if (targets.length === 0) {
    return { objects, groups: safeGroups, mirroredIds: [] };
  }

  const idMap = new Map<string, string>();
  const groupIdMap = new Map<string, string>();

  if (keepSource) {
    for (const o of targets) {
      idMap.set(o.id, uid(o.type.slice(0, 3)));
      if (o.groupId && !groupIdMap.has(o.groupId)) {
        groupIdMap.set(o.groupId, uid('grp'));
      }
    }
  } else {
    for (const o of targets) idMap.set(o.id, o.id);
  }

  const newGroups: GroupRecord[] = [...safeGroups];
  if (keepSource && groupIdMap.size > 0) {
    const grpById = new Map(safeGroups.map((g) => [g.id, g]));
    for (const [oldG, newG] of groupIdMap.entries()) {
      const src = grpById.get(oldG);
      newGroups.push({
        id: newG,
        name: src ? `${src.name} (Simetría)` : 'Grupo (Simetría)',
        parentGroupId:
          src?.parentGroupId && groupIdMap.has(src.parentGroupId)
            ? groupIdMap.get(src.parentGroupId)
            : undefined,
        createdAt: Date.now(),
      });
    }
  }

  const mirroredList: CanvasObject[] = targets.map((orig, idx) => {
    const newId = idMap.get(orig.id)!;
    const z = keepSource ? startZIndex + idx : orig.zIndex;
    const m = mirrorSingleObject(orig, axisA, axisB, newId, z, keepSource ? layerId : orig.layerId, cadConfig, idMap);
    if (keepSource) {
      if (orig.groupId && groupIdMap.has(orig.groupId)) {
        m.groupId = groupIdMap.get(orig.groupId);
      } else {
        delete m.groupId;
      }
    } else if (orig.groupId) {
      m.groupId = orig.groupId;
    }
    return m;
  });

  if (keepSource) {
    return {
      objects: [...objects, ...mirroredList],
      groups: newGroups,
      mirroredIds: mirroredList.map((m) => m.id),
    };
  }

  const mirroredById = new Map(mirroredList.map((m) => [m.id, m]));
  return {
    objects: objects.map((o) => mirroredById.get(o.id) ?? o),
    groups: safeGroups,
    mirroredIds: mirroredList.map((m) => m.id),
  };
}

/**
 * Coincidencia de puntos (CP): Moves the chosen object (or its entire group) rigidly
 * so `movingPtWorld` lands identically on `targetPtWorld` with zero geometric deformation.
 */
export function matchPointBetweenObjects(
  objects: CanvasObject[],
  groups: GroupRecord[],
  movingObjId: string,
  movingPtWorld: Point2D,
  targetPtWorld: Point2D
): {
  objects: CanvasObject[];
  movedIds: string[];
  dx: number;
  dy: number;
} {
  const dx = targetPtWorld.x - movingPtWorld.x;
  const dy = targetPtWorld.y - movingPtWorld.y;
  const movingObj = objects.find((o) => o.id === movingObjId);
  if (!movingObj) {
    return { objects, movedIds: [], dx: 0, dy: 0 };
  }

  const expandedIds = expandSelectionToGroups(movingObj, objects, ensureGroupsArray(groups));
  const moveSet = new Set(expandedIds);

  const nextObjects = objects.map((o) => {
    if (!moveSet.has(o.id) || o.locked) return o;
    return translateCanvasObject(o, dx, dy);
  });

  return {
    objects: nextObjects,
    movedIds: expandedIds,
    dx,
    dy,
  };
}

/**
 * Unión de segmentos (UNI): Independent from point matching.
 * Joins consecutive LineObjects and/or open polyline ShapeObjects whose endpoints coincide
 * or lie within `toleranceWorld` into continuous editable `polyline` ShapeObject(s).
 */
export function joinCompatibleSegments(
  targetIds: string[] | null,
  objects: CanvasObject[],
  toleranceWorld: number,
  layerId: string,
  startZIndex: number
): {
  objects: CanvasObject[];
  joinedIds: string[];
  consumedCount: number;
} {
  const tol = Math.max(0.5, toleranceWorld);
  const scopeSet =
    targetIds && targetIds.length > 0 ? new Set(targetIds) : null;

  interface ChainItem {
    sourceIds: string[];
    pts: Point2D[];
    template: ShapeObject;
    groupId?: string;
  }

  const chains: ChainItem[] = [];

  for (const obj of objects) {
    if (obj.locked) continue;
    if (scopeSet && !scopeSet.has(obj.id)) continue;

    if (
      obj.type === 'line' &&
      obj.lineKind !== 'connector' &&
      obj.lineKind !== 'orthogonal'
    ) {
      const s = localToWorld(obj.startPoint, obj);
      const e = localToWorld(obj.endPoint, obj);
      chains.push({
        sourceIds: [obj.id],
        pts: [s, e],
        groupId: obj.groupId,
        template: {
          id: obj.id,
          type: 'shape',
          shapeKind: 'polyline',
          layerId: obj.layerId || layerId,
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
        },
      });
    } else if (obj.type === 'shape' && obj.shapeKind === 'polyline') {
      const geom = getShapeCutPolygonWorld(obj);
      if (geom && !geom.closed && geom.pts.length >= 2) {
        chains.push({
          sourceIds: [obj.id],
          pts: [...geom.pts],
          groupId: obj.groupId,
          template: { ...obj, rotation: 0 },
        });
      }
    }
  }

  if (chains.length < 2) {
    return { objects, joinedIds: [], consumedCount: 0 };
  }

  const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const A = chains[i];
        const B = chains[j];
        const aHead = A.pts[0];
        const aTail = A.pts[A.pts.length - 1];
        const bHead = B.pts[0];
        const bTail = B.pts[B.pts.length - 1];

        let combinedPts: Point2D[] | null = null;
        if (dist(aTail, bHead) <= tol) {
          combinedPts = [...A.pts, ...B.pts.slice(1)];
        } else if (dist(aTail, bTail) <= tol) {
          const revB = [...B.pts].reverse();
          combinedPts = [...A.pts, ...revB.slice(1)];
        } else if (dist(aHead, bTail) <= tol) {
          combinedPts = [...B.pts, ...A.pts.slice(1)];
        } else if (dist(aHead, bHead) <= tol) {
          const revA = [...A.pts].reverse();
          combinedPts = [...revA, ...B.pts.slice(1)];
        }

        if (combinedPts) {
          chains[i] = {
            sourceIds: [...A.sourceIds, ...B.sourceIds],
            pts: combinedPts,
            template: A.template,
            groupId: A.groupId && A.groupId === B.groupId ? A.groupId : undefined,
          };
          chains.splice(j, 1);
          mergedAny = true;
          break outer;
        }
      }
    }
  }

  const mergedChains = chains.filter((c) => c.sourceIds.length >= 2);
  if (mergedChains.length === 0) {
    return { objects, joinedIds: [], consumedCount: 0 };
  }

  const consumedIds = new Set<string>();
  const newPolylines: ShapeObject[] = [];
  let z = startZIndex;

  for (const ch of mergedChains) {
    for (const id of ch.sourceIds) consumedIds.add(id);
    // Clean near-duplicate consecutive vertices
    const cleanPts: Point2D[] = [];
    for (const pt of ch.pts) {
      if (
        cleanPts.length === 0 ||
        dist(cleanPts[cleanPts.length - 1], pt) > 0.25
      ) {
        cleanPts.push(pt);
      }
    }
    const poly = buildPolylineShapeFromWorldPoints(
      ch.template,
      cleanPts,
      uid('shp'),
      z++
    );
    if (ch.groupId) poly.groupId = ch.groupId;
    newPolylines.push(poly);
  }

  const remaining = objects.filter((o) => !consumedIds.has(o.id));
  return {
    objects: [...remaining, ...newPolylines],
    joinedIds: newPolylines.map((p) => p.id),
    consumedCount: consumedIds.size,
  };
}

/**
 * Crear polilínea continua a partir de 2 o más líneas o polilíneas abiertas seleccionadas.
 * Primero intenta unir tramos contiguos dentro de la tolerancia; si existen separaciones mayores,
 * conecta los extremos más cercanos en secuencia formando una sola polilínea editable.
 */
export function createPolylineFromSelectedSegments(
  targetIds: string[],
  objects: CanvasObject[],
  toleranceWorld: number,
  layerId: string,
  startZIndex: number
): {
  objects: CanvasObject[];
  polylineId: string | null;
  consumedCount: number;
} {
  const joined = joinCompatibleSegments(
    targetIds,
    objects,
    toleranceWorld,
    layerId,
    startZIndex
  );
  if (joined.joinedIds.length === 1 && joined.consumedCount >= targetIds.length) {
    return {
      objects: joined.objects,
      polylineId: joined.joinedIds[0],
      consumedCount: joined.consumedCount,
    };
  }

  const targetSet = new Set(targetIds);
  const segItems: {
    id: string;
    pts: Point2D[];
    template: ShapeObject;
    groupId?: string;
  }[] = [];

  for (const obj of objects) {
    if (!targetSet.has(obj.id) || obj.locked) continue;
    if (obj.type === 'line' && obj.lineKind !== 'connector' && obj.lineKind !== 'orthogonal') {
      const s = localToWorld(obj.startPoint, obj);
      const e = localToWorld(obj.endPoint, obj);
      segItems.push({
        id: obj.id,
        pts: [s, e],
        groupId: obj.groupId,
        template: {
          id: obj.id,
          type: 'shape',
          shapeKind: 'polyline',
          layerId: obj.layerId || layerId,
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
        },
      });
    } else if (obj.type === 'shape' && obj.shapeKind === 'polyline') {
      const geom = getShapeCutPolygonWorld(obj);
      if (geom && !geom.closed && geom.pts.length >= 2) {
        segItems.push({
          id: obj.id,
          pts: [...geom.pts],
          groupId: obj.groupId,
          template: { ...obj, rotation: 0 },
        });
      }
    }
  }

  if (segItems.length < 2) {
    return { objects, polylineId: null, consumedCount: 0 };
  }

  const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);
  const used = new Set<number>([0]);
  const combinedPts: Point2D[] = [...segItems[0].pts];

  while (used.size < segItems.length) {
    const tail = combinedPts[combinedPts.length - 1];
    let bestIdx = -1;
    let bestReverse = false;
    let bestDist = Infinity;

    for (let i = 0; i < segItems.length; i++) {
      if (used.has(i)) continue;
      const pts = segItems[i].pts;
      const dHead = dist(tail, pts[0]);
      const dTail = dist(tail, pts[pts.length - 1]);
      if (dHead < bestDist) {
        bestDist = dHead;
        bestIdx = i;
        bestReverse = false;
      }
      if (dTail < bestDist) {
        bestDist = dTail;
        bestIdx = i;
        bestReverse = true;
      }
    }

    if (bestIdx === -1) break;
    used.add(bestIdx);
    const nextPts = bestReverse ? [...segItems[bestIdx].pts].reverse() : segItems[bestIdx].pts;
    for (const pt of nextPts) {
      if (dist(combinedPts[combinedPts.length - 1], pt) > 0.5) {
        combinedPts.push(pt);
      }
    }
  }

  const consumedIds = new Set(segItems.map((s) => s.id));
  const sharedGroupId = segItems.every((s) => s.groupId && s.groupId === segItems[0].groupId)
    ? segItems[0].groupId
    : undefined;

  const newPoly = buildPolylineShapeFromWorldPoints(
    segItems[0].template,
    combinedPts,
    uid('shp'),
    startZIndex
  );
  if (sharedGroupId) {
    newPoly.groupId = sharedGroupId;
  }

  return {
    objects: [...objects.filter((o) => !consumedIds.has(o.id)), newPoly],
    polylineId: newPoly.id,
    consumedCount: consumedIds.size,
  };
}

export type EndpointAlignMode = 'start-x' | 'end-x' | 'start-y' | 'end-y';

/**
 * Alinear extremos de dos o más elementos geométricos compatibles respecto al primer elemento.
 */
export function alignSelectedGeometricEndpoints(
  targetIds: string[],
  objects: CanvasObject[],
  mode: EndpointAlignMode
): {
  objects: CanvasObject[];
  alignedCount: number;
} {
  const targetSet = new Set(targetIds);
  const targets = objects.filter(
    (o) => targetSet.has(o.id) && !o.locked && (o.type === 'line' || o.type === 'shape')
  );
  if (targets.length < 2) {
    return { objects, alignedCount: 0 };
  }

  const getObjectEndpoints = (o: CanvasObject): { start: Point2D; end: Point2D } => {
    if (o.type === 'line') {
      return {
        start: localToWorld(o.startPoint, o),
        end: localToWorld(o.endPoint, o),
      };
    }
    if (o.type === 'shape' && o.shapeKind === 'polyline') {
      const geom = getShapeCutPolygonWorld(o);
      if (geom && geom.pts.length >= 2) {
        return { start: geom.pts[0], end: geom.pts[geom.pts.length - 1] };
      }
    }
    return {
      start: { x: o.x, y: o.y },
      end: { x: o.x + o.width, y: o.y + o.height },
    };
  };

  const refEp = getObjectEndpoints(targets[0]);
  const refVal =
    mode === 'start-x'
      ? refEp.start.x
      : mode === 'end-x'
      ? refEp.end.x
      : mode === 'start-y'
      ? refEp.start.y
      : refEp.end.y;

  let alignedCount = 0;
  const updatedById = new Map<string, CanvasObject>();

  for (let i = 1; i < targets.length; i++) {
    const obj = targets[i];
    if (obj.type === 'line') {
      const s = localToWorld(obj.startPoint, obj);
      const e = localToWorld(obj.endPoint, obj);
      const ctrl = obj.controlPoint ? localToWorld(obj.controlPoint, obj) : undefined;
      const nextS = { ...s };
      const nextE = { ...e };
      if (mode === 'start-x') nextS.x = refVal;
      else if (mode === 'end-x') nextE.x = refVal;
      else if (mode === 'start-y') nextS.y = refVal;
      else if (mode === 'end-y') nextE.y = refVal;
      updatedById.set(
        obj.id,
        buildLineObjectFromWorldEndpoints(obj, nextS, nextE, obj.id, obj.zIndex, ctrl)
      );
      alignedCount++;
    } else if (obj.type === 'shape' && obj.shapeKind === 'polyline') {
      const geom = getShapeCutPolygonWorld(obj);
      if (geom && geom.pts.length >= 2) {
        const pts = geom.pts.map((p) => ({ ...p }));
        if (mode === 'start-x') pts[0].x = refVal;
        else if (mode === 'end-x') pts[pts.length - 1].x = refVal;
        else if (mode === 'start-y') pts[0].y = refVal;
        else if (mode === 'end-y') pts[pts.length - 1].y = refVal;
        updatedById.set(
          obj.id,
          buildPolylineShapeFromWorldPoints(obj, pts, obj.id, obj.zIndex)
        );
        alignedCount++;
      }
    } else if (obj.type === 'shape') {
      const dx =
        mode === 'start-x'
          ? refVal - obj.x
          : mode === 'end-x'
          ? refVal - (obj.x + obj.width)
          : 0;
      const dy =
        mode === 'start-y'
          ? refVal - obj.y
          : mode === 'end-y'
          ? refVal - (obj.y + obj.height)
          : 0;
      updatedById.set(obj.id, translateCanvasObject(obj, dx, dy));
      alignedCount++;
    }
  }

  if (alignedCount === 0) {
    return { objects, alignedCount: 0 };
  }

  return {
    objects: objects.map((o) => updatedById.get(o.id) ?? o),
    alignedCount,
  };
}

export interface WorldBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calcula la envolvente AABB en coordenadas de mundo teniendo en cuenta la rotación del objeto.
 */
export function getRotatedObjectWorldBounds(obj: CanvasObject): WorldBoxRect {
  const rot = obj.rotation || 0;
  if (Math.abs(rot % 360) < 1e-5) {
    return {
      x: obj.x,
      y: obj.y,
      width: Math.max(1, obj.width),
      height: Math.max(1, obj.height),
    };
  }
  const corners: Point2D[] = [
    localToWorld({ x: 0, y: 0 }, obj),
    localToWorld({ x: obj.width, y: 0 }, obj),
    localToWorld({ x: obj.width, y: obj.height }, obj),
    localToWorld({ x: 0, y: obj.height }, obj),
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Calcula la caja envolvente conjunta de un conjunto de objetos considerando sus rotaciones.
 */
export function getObjectsWorldBoundingBox(objects: CanvasObject[]): WorldBoxRect | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    const b = getRotatedObjectWorldBounds(obj);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Rota un punto 2D alrededor de un pivote en sentido horario de pantalla (angleDegScreenCW).
 */
export function rotatePointAroundPivot(
  pt: Point2D,
  pivot: Point2D,
  angleDegScreenCW: number
): Point2D {
  const rad = (angleDegScreenCW * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - pivot.x;
  const dy = pt.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/**
 * Rota cualquier CanvasObject de manera solidaria alrededor de un pivote común (matriz rígida 2D),
 * reconstruyendo geometrías de puntos mundiales (líneas, trazos, cotas, polilíneas, polígonos y curvas).
 */
export function rotateCanvasObjectAroundPivot(
  obj: CanvasObject,
  pivot: Point2D,
  angleDegScreenCW: number,
  cadConfig: CadDraftingConfig
): CanvasObject {
  if (Math.abs(angleDegScreenCW) < 1e-6) return obj;

  if (obj.type === 'line') {
    const s = rotatePointAroundPivot(localToWorld(obj.startPoint, obj), pivot, angleDegScreenCW);
    const e = rotatePointAroundPivot(localToWorld(obj.endPoint, obj), pivot, angleDegScreenCW);
    const ctrl = obj.controlPoint
      ? rotatePointAroundPivot(localToWorld(obj.controlPoint, obj), pivot, angleDegScreenCW)
      : undefined;
    return buildLineObjectFromWorldEndpoints(obj, s, e, obj.id, obj.zIndex, ctrl);
  }

  if (obj.type === 'stroke') {
    const worldPts = obj.points.map((p) => ({
      pt: rotatePointAroundPivot(localToWorld(p, obj), pivot, angleDegScreenCW),
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
      ...obj,
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
    const rotatedDim: DimensionObject = {
      ...obj,
      p1: rotatePointAroundPivot(obj.p1, pivot, angleDegScreenCW),
      p2: rotatePointAroundPivot(obj.p2, pivot, angleDegScreenCW),
      p3: obj.p3 ? rotatePointAroundPivot(obj.p3, pivot, angleDegScreenCW) : undefined,
      offsetPt: rotatePointAroundPivot(obj.offsetPt, pivot, angleDegScreenCW),
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
    const geom = getShapeEditableGeometry(obj);
    if (geom && geom.vertices.length >= 2) {
      const rotPts = geom.vertices.map((v) =>
        rotatePointAroundPivot(localToWorld(v, obj), pivot, angleDegScreenCW)
      );
      return buildPolylineShapeFromWorldPoints(obj, rotPts, obj.id, obj.zIndex);
    }
  }

  if (obj.type === 'shape' && obj.shapeKind === 'custom-polygon') {
    const geom = getShapeEditableGeometry(obj);
    if (geom && geom.vertices.length >= 3) {
      const rotPts = geom.vertices.map((v) =>
        rotatePointAroundPivot(localToWorld(v, obj), pivot, angleDegScreenCW)
      );
      return buildShapeObjectFromWorldPolygon(obj, rotPts, obj.id, obj.zIndex);
    }
  }

  if (obj.type === 'shape' && obj.shapeKind === 'curve') {
    const geom = getShapeEditableGeometry(obj);
    if (geom && geom.vertices.length >= 3) {
      const rotPts = geom.vertices.map((v) =>
        rotatePointAroundPivot(localToWorld(v, obj), pivot, angleDegScreenCW)
      );
      const pad = obj.strokeWidth / 2 + 2;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of rotPts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const x = minX - pad;
      const y = minY - pad;
      return {
        ...obj,
        x,
        y,
        width: Math.max(16, maxX - minX + pad * 2),
        height: Math.max(16, maxY - minY + pad * 2),
        rotation: 0,
        customPoints: rotPts.map((p) => ({ x: p.x - x, y: p.y - y })),
      };
    }
  }

  const center = { x: obj.x + obj.width / 2, y: obj.y + obj.height / 2 };
  const nextCenter = rotatePointAroundPivot(center, pivot, angleDegScreenCW);
  return {
    ...obj,
    x: nextCenter.x - obj.width / 2,
    y: nextCenter.y - obj.height / 2,
    rotation: Math.round(((obj.rotation || 0) + angleDegScreenCW) * 100) / 100,
  };
}

/**
 * Escala un objeto hijo de un grupo aplicando transformación afín relativa desde initBox hacia nextBox.
 * Preserva proporciones y orientación mediante composición matricial D(sx, sy) * R(theta).
 */
export function scaleCanvasObjectInBox(
  initObj: CanvasObject,
  initBox: WorldBoxRect,
  nextBox: WorldBoxRect,
  cadConfig: CadDraftingConfig,
  scaleTextFontSizes = true
): CanvasObject {
  const sx = nextBox.width / Math.max(1e-4, initBox.width);
  const sy = nextBox.height / Math.max(1e-4, initBox.height);
  const uniformScale = Math.sqrt(Math.max(1e-4, Math.abs(sx * sy)));

  const mapPt = (p: Point2D): Point2D => ({
    x: nextBox.x + (p.x - initBox.x) * sx,
    y: nextBox.y + (p.y - initBox.y) * sy,
  });

  if (initObj.type === 'line') {
    const s = mapPt(localToWorld(initObj.startPoint, initObj));
    const e = mapPt(localToWorld(initObj.endPoint, initObj));
    const ctrl = initObj.controlPoint
      ? mapPt(localToWorld(initObj.controlPoint, initObj))
      : undefined;
    return buildLineObjectFromWorldEndpoints(initObj, s, e, initObj.id, initObj.zIndex, ctrl);
  }

  if (initObj.type === 'stroke') {
    const worldPts = initObj.points.map((p) => ({
      pt: mapPt(localToWorld(p, initObj)),
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
      ...initObj,
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

  if (initObj.type === 'dimension') {
    const scaledFont = Math.max(9, Math.min(36, Math.round(initObj.fontSize * uniformScale)));
    const scaledDim: DimensionObject = {
      ...initObj,
      p1: mapPt(initObj.p1),
      p2: mapPt(initObj.p2),
      p3: initObj.p3 ? mapPt(initObj.p3) : undefined,
      offsetPt: mapPt(initObj.offsetPt),
      fontSize: scaledFont,
    };
    const m = computeDimensionMetrics(scaledDim, cadConfig);
    return {
      ...scaledDim,
      x: m.bbox.x,
      y: m.bbox.y,
      width: m.bbox.width,
      height: m.bbox.height,
    };
  }

  if (initObj.type === 'shape' && initObj.shapeKind === 'polyline') {
    const geom = getShapeEditableGeometry(initObj);
    if (geom && geom.vertices.length >= 2) {
      const pts = geom.vertices.map((v) => mapPt(localToWorld(v, initObj)));
      return buildPolylineShapeFromWorldPoints(initObj, pts, initObj.id, initObj.zIndex);
    }
  }

  if (initObj.type === 'shape' && initObj.shapeKind === 'custom-polygon') {
    const geom = getShapeEditableGeometry(initObj);
    if (geom && geom.vertices.length >= 3) {
      const pts = geom.vertices.map((v) => mapPt(localToWorld(v, initObj)));
      return buildShapeObjectFromWorldPolygon(initObj, pts, initObj.id, initObj.zIndex);
    }
  }

  if (initObj.type === 'shape' && initObj.shapeKind === 'curve') {
    const geom = getShapeEditableGeometry(initObj);
    if (geom && geom.vertices.length >= 3) {
      const pts = geom.vertices.map((v) => mapPt(localToWorld(v, initObj)));
      const pad = initObj.strokeWidth / 2 + 2;
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
      const x = minX - pad;
      const y = minY - pad;
      return {
        ...initObj,
        x,
        y,
        width: Math.max(16, maxX - minX + pad * 2),
        height: Math.max(16, maxY - minY + pad * 2),
        rotation: 0,
        customPoints: pts.map((p) => ({ x: p.x - x, y: p.y - y })),
      };
    }
  }

  // Transformación matricial para cajas generales (con o sin rotación previa):
  // D(sx, sy) * R(theta) sobre los vectores base locales u y v respecto al centro.
  const rot = initObj.rotation || 0;
  let nextX: number;
  let nextY: number;
  let nextW: number;
  let nextH: number;
  let nextRotation = rot;

  if (Math.abs(rot % 360) < 1e-4) {
    const tl = mapPt({ x: initObj.x, y: initObj.y });
    nextX = tl.x;
    nextY = tl.y;
    nextW = Math.max(8, initObj.width * Math.abs(sx));
    nextH = Math.max(8, initObj.height * Math.abs(sy));
  } else {
    const rad = (rot * Math.PI) / 180;
    const ux = Math.cos(rad) * initObj.width * sx;
    const uy = Math.sin(rad) * initObj.width * sy;
    const vx = -Math.sin(rad) * initObj.height * sx;
    const vy = Math.cos(rad) * initObj.height * sy;
    nextW = Math.max(8, Math.hypot(ux, uy));
    const nextRad = Math.atan2(uy, ux);
    const projH = Math.abs(-vx * Math.sin(nextRad) + vy * Math.cos(nextRad));
    nextH = Math.max(8, projH);
    nextRotation = Math.round(((nextRad * 180) / Math.PI) * 100) / 100;
    const nextCenter = mapPt({
      x: initObj.x + initObj.width / 2,
      y: initObj.y + initObj.height / 2,
    });
    nextX = nextCenter.x - nextW / 2;
    nextY = nextCenter.y - nextH / 2;
  }

  if (initObj.type === 'shape') {
    const lsx = nextW / Math.max(1e-4, initObj.width);
    const lsy = nextH / Math.max(1e-4, initObj.height);
    const shapeObj = initObj as ShapeObject;
    return {
      ...shapeObj,
      x: nextX,
      y: nextY,
      width: nextW,
      height: nextH,
      rotation: nextRotation,
      customVertices: shapeObj.customVertices?.map((p) => ({ x: p.x * lsx, y: p.y * lsy })),
      customPoints: shapeObj.customPoints?.map((p) => ({ x: p.x * lsx, y: p.y * lsy })),
    };
  }

  if (initObj.type === 'table') {
    const scaled = scaleTableToDimensions(initObj as TableObject, Math.max(60, nextW), Math.max(40, nextH));
    return {
      ...scaled,
      x: nextX,
      y: nextY,
      rotation: nextRotation,
    };
  }

  if (initObj.type === 'equation') {
    const eq = initObj as EquationObject;
    return {
      ...eq,
      x: nextX,
      y: nextY,
      width: Math.max(24, nextW),
      height: Math.max(24, nextH),
      rotation: nextRotation,
      fontSize: scaleTextFontSizes
        ? Math.max(10, Math.min(96, roundFontSizeDecimal(eq.fontSize * uniformScale)))
        : eq.fontSize,
    };
  }

  if (initObj.type === 'sticky') {
    const st = initObj as StickyObject;
    return {
      ...st,
      x: nextX,
      y: nextY,
      width: Math.max(48, nextW),
      height: Math.max(40, nextH),
      rotation: nextRotation,
      fontSize: scaleTextFontSizes
        ? Math.max(9, Math.min(48, roundFontSizeDecimal(st.fontSize * uniformScale)))
        : st.fontSize,
    };
  }

  if (initObj.type === 'text') {
    const txt = initObj as TextObject;
    const defaults = getDefaultRunStyle(txt);
    const safeAlign = normalizeTextAlign(txt.align, 'left');
    const paragraphs = normalizarContenidoTexto(
      Array.isArray(txt.paragraphs) && txt.paragraphs.length > 0 ? txt.paragraphs : txt.content,
      defaults,
      safeAlign
    );
    const nextParagraphs = scaleTextFontSizes
      ? paragraphs.map((p) => ({
          ...p,
          runs: p.runs.map((r) => {
            const rs = resolveRunStyle(r, defaults);
            return {
              ...r,
              fontSize: clampTextFontSize(rs.fontSize * uniformScale),
            };
          }),
        }))
      : paragraphs;

    const synced = syncTextObjectFromParagraphs(
      {
        ...txt,
        x: nextX,
        y: nextY,
        width: Math.max(32, nextW),
        height: Math.max(24, nextH),
        rotation: nextRotation,
        fontSize: scaleTextFontSizes ? clampTextFontSize(txt.fontSize * uniformScale) : txt.fontSize,
      },
      nextParagraphs
    );
    return synced;
  }

  return {
    ...initObj,
    x: nextX,
    y: nextY,
    width: Math.max(12, nextW),
    height: Math.max(12, nextH),
    rotation: nextRotation,
  };
}


