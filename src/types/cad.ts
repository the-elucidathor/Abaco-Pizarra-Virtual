import type { Point2D } from './whiteboard';

// Interruptor interno para desactivar el rastreo de referencia sin afectar RG ni otras ayudas
export const FEATURE_TRACKING_ENABLED = true;

export type CadUnit = 'px' | 'mm' | 'cm' | 'm';

export type CadCommandId =
  | 'line'
  | 'pline'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'dim-linear'
  | 'dim-aligned'
  | 'dim-angular'
  | 'dim-radial'
  | 'dim-diametral'
  | 'dim-ordinate'
  | 'mirror'
  | 'match-points'
  | 'join'
  | 'array-rect'
  | 'array-polar'
  | 'array-path'
  | 'group'
  | 'ungroup';

export type CadSnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'quadrant'
  | 'intersection'
  | 'perpendicular'
  | 'parallel';

export type CadArcMethod = '3point' | 'center-start-angle';
export type CadCircleMethod = 'radius' | 'diameter';
export type CadRectMethod = 'corner' | 'dimensions';
export type CadPolygonFit = 'inscribed' | 'circumscribed';
export type CadLinearDimAxis = 'auto' | 'horizontal' | 'vertical' | 'aligned';

export type CadTrackingMode = 'auto' | 'acquire';

export interface CadDraftingConfig {
  unit: CadUnit;
  decimals: number;
  yAxisUp: boolean;
  originX: number;
  originY: number;
  ortho: boolean;
  polar: boolean;
  polarAngle: number; // degrees: 15 | 30 | 45 | 90
  gridSnap: boolean;
  snapStep: number; // in current drawing units (or px when unit='px')
  osnapEnabled: boolean;
  osnapModes: Record<CadSnapKind, boolean>;
  dynInput: boolean;
  // Rastreo de referencia (RAS)
  trackingEnabled: boolean;
  trackingMode: CadTrackingMode;
  trackingShowPolarAngles: boolean;
  trackingMaxPoints: number;
  trackingTolerancePx: number;
  trackingSnapFreehand: boolean;
}

export interface CadSnapTarget {
  point: Point2D; // world coordinates
  kind: CadSnapKind;
  label: string;
  objectId?: string;
  refSegment?: [Point2D, Point2D];
}

export interface CadConstraintGuide {
  kind: 'ortho' | 'polar' | 'parallel' | 'perpendicular' | 'proportion';
  angleDeg: number;
  from: Point2D;
  to: Point2D;
  refSegment?: [Point2D, Point2D];
  label: string;
}

export interface CadTrackingPoint {
  id: string;
  point: Point2D;
  kind: CadSnapKind;
  objectId?: string;
  acquiredAt: number;
}

export interface CadTrackingGuideLine {
  key: string;
  originId: string;
  origin: Point2D;
  originKind: CadSnapKind;
  angleDeg: number;
  dir: Point2D; // vector unitario orientado desde origin hacia el punto resuelto
  distanceWorld: number;
  label: string;
}

export interface CadTrackingResolution {
  acquiredPoints: CadTrackingPoint[];
  activeGuides: CadTrackingGuideLine[];
  intersectionPoint: Point2D | null;
  snappedPoint: Point2D | null;
}

export interface CadResolvedCursor {
  world: Point2D;
  cad: Point2D;
  snap: CadSnapTarget | null;
  guide: CadConstraintGuide | null;
  snappedToGrid: boolean;
  tracking?: CadTrackingResolution | null;
}

export type PathArrayBasePointMode = 'closest' | 'center' | 'custom';

export interface PathArraySessionOptions {
  basePointMode: PathArrayBasePointMode;
  customBasePointWorld: Point2D | null;
  pathObjectId: string | null;
  mode: 'count' | 'spacing';
  count: number;
  spacingWorld: number;
  alignToPath: boolean;
  includeOriginalAtStart: boolean;
}

export interface CadSessionState {
  activeCommand: CadCommandId | null;
  step: number;
  points: Point2D[]; // picked points in world space
  pickedObjectIds: (string | null)[]; // object id associated with each picked point
  // Command sub-options
  circleMethod: CadCircleMethod;
  rectMethod: CadRectMethod;
  rectWidthWorld?: number;
  arcMethod: CadArcMethod;
  polygonSides: number;
  polygonFit: CadPolygonFit;
  linearDimAxis: CadLinearDimAxis;
  mirrorKeepSource: boolean;
  matchKeepFirstFixed: boolean;
  joinToleranceCad: number;
  pathArray: PathArraySessionOptions;
  lastLineIds: string[]; // track segments drawn in current LIN command for undo/feedback
  pickingOrigin?: boolean;
  statusMessage?: string | null;
}

export const DEFAULT_CAD_CONFIG: CadDraftingConfig = {
  unit: 'px',
  decimals: 2,
  yAxisUp: true,
  originX: 0,
  originY: 0,
  ortho: false,
  polar: false,
  polarAngle: 45,
  gridSnap: false,
  snapStep: 10,
  osnapEnabled: true,
  osnapModes: {
    endpoint: true,
    midpoint: true,
    center: true,
    quadrant: true,
    intersection: true,
    perpendicular: true,
    parallel: true,
  },
  dynInput: true,
  trackingEnabled: true,
  trackingMode: 'auto',
  trackingShowPolarAngles: true,
  trackingMaxPoints: 3,
  trackingTolerancePx: 8,
  trackingSnapFreehand: false,
};

export const INITIAL_CAD_SESSION: CadSessionState = {
  activeCommand: null,
  step: 0,
  points: [],
  pickedObjectIds: [],
  circleMethod: 'radius',
  rectMethod: 'corner',
  arcMethod: '3point',
  polygonSides: 6,
  polygonFit: 'inscribed',
  linearDimAxis: 'auto',
  mirrorKeepSource: true,
  matchKeepFirstFixed: true,
  joinToleranceCad: 2,
  pathArray: {
    basePointMode: 'closest',
    customBasePointWorld: null,
    pathObjectId: null,
    mode: 'count',
    count: 6,
    spacingWorld: 80,
    alignToPath: false,
    includeOriginalAtStart: false,
  },
  lastLineIds: [],
  pickingOrigin: false,
  statusMessage: null,
};
