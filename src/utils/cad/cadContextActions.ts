import type { CanvasObject, ShapeKind } from '../../types/whiteboard';

const RADIAL_SHAPE_KINDS = new Set<ShapeKind>([
  'circle',
  'ellipse',
  'arc',
  'semicircle',
  'sector',
]);

export function isGeometricObject(obj: CanvasObject): boolean {
  return obj.type === 'line' || obj.type === 'shape';
}

export function isOpenSegmentObject(obj: CanvasObject): boolean {
  if (obj.type === 'line') {
    return obj.lineKind !== 'connector' && obj.lineKind !== 'orthogonal';
  }
  return obj.type === 'shape' && obj.shapeKind === 'polyline';
}

export function isRadialDimensionCompatible(obj: CanvasObject): boolean {
  return obj.type === 'shape' && RADIAL_SHAPE_KINDS.has(obj.shapeKind);
}

export function isDimensionCompatible(obj: CanvasObject): boolean {
  return obj.type === 'line' || obj.type === 'shape' || obj.type === 'stroke';
}

export function isColorStyleCompatible(obj: CanvasObject): boolean {
  return (
    obj.type === 'stroke' ||
    obj.type === 'shape' ||
    obj.type === 'line' ||
    obj.type === 'text' ||
    obj.type === 'sticky' ||
    obj.type === 'equation' ||
    obj.type === 'dimension'
  );
}

export function isStrokeWidthCompatible(obj: CanvasObject): boolean {
  return obj.type === 'stroke' || obj.type === 'shape' || obj.type === 'line';
}

export interface SelectionContextCapabilities {
  count: number;
  isSingle: boolean;
  isMultiple: boolean;
  anyLocked: boolean;
  allLocked: boolean;
  hasGroup: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canRotate: boolean;
  canMirror: boolean;
  canArray: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  canDimension: boolean;
  canRadialDim: boolean;
  canStyleColor: boolean;
  canStyleStrokeWidth: boolean;
  isCompatibleGeometryPair: boolean;
  canJoinSegments: boolean;
  canCreatePolyline: boolean;
  canMatchPoints: boolean;
  canAlignEndpoints: boolean;
}

export function getSelectionContextCapabilities(
  selectedObjects: CanvasObject[]
): SelectionContextCapabilities {
  const count = selectedObjects.length;
  const isSingle = count === 1;
  const isMultiple = count >= 2;
  const anyLocked = selectedObjects.some((o) => o.locked);
  const allLocked = count > 0 && selectedObjects.every((o) => o.locked);
  const unlocked = selectedObjects.filter((o) => !o.locked);

  const hasGroup = selectedObjects.some((o) => Boolean(o.groupId));
  const distinctGroupUnits = new Set(selectedObjects.map((o) => o.groupId || o.id));
  const canGroup = count >= 2 && distinctGroupUnits.size >= 2;
  const canUngroup = hasGroup;

  const canRotate = unlocked.some((o) => o.type !== 'dimension');
  const canMirror = unlocked.length > 0;
  const canArray = count >= 1;
  const canAlign = unlocked.length >= 2;
  const canDistribute = unlocked.length >= 3;

  // V1.11.8-17: Acotar aplica únicamente a un elemento individual; se oculta en selección múltiple
  const canDimension = isSingle && isDimensionCompatible(selectedObjects[0]);
  const canRadialDim = isSingle && isRadialDimensionCompatible(selectedObjects[0]);

  const canStyleColor = unlocked.some(isColorStyleCompatible);
  const canStyleStrokeWidth = unlocked.some(isStrokeWidthCompatible);

  const unlockedGeom = unlocked.filter(isGeometricObject);
  const unlockedOpenSegs = unlocked.filter(isOpenSegmentObject);

  const isCompatibleGeometryPair = unlockedGeom.length >= 2;
  const canJoinSegments = unlockedOpenSegs.length >= 2;
  const canCreatePolyline = unlockedOpenSegs.length >= 2;
  const canMatchPoints = unlockedGeom.length >= 2;
  const canAlignEndpoints = unlockedGeom.length >= 2;

  return {
    count,
    isSingle,
    isMultiple,
    anyLocked,
    allLocked,
    hasGroup,
    canGroup,
    canUngroup,
    canRotate,
    canMirror,
    canArray,
    canAlign,
    canDistribute,
    canDimension,
    canRadialDim,
    canStyleColor,
    canStyleStrokeWidth,
    isCompatibleGeometryPair,
    canJoinSegments,
    canCreatePolyline,
    canMatchPoints,
    canAlignEndpoints,
  };
}
