import { DEFAULT_CAD_CONFIG, type CadDraftingConfig, type CadLinearDimAxis } from '../../types/cad';
import type {
  CanvasObject,
  DimensionAnchor,
  DimensionKind,
  DimensionObject,
  Point2D,
} from '../../types/whiteboard';
import { uid } from '../id';
import { localToWorld, worldToLocal } from '../geometryCad';
import { formatCadNumber, getUnitShortLabel, worldDistToCadDist, worldToCad } from './cadCoords';
import type { CadBuildContext } from './cadBuilders';

export interface DimensionMetrics {
  numericValue: number;
  formattedLabel: string;
  displayLabel: string;
  extLines: [Point2D, Point2D][];
  dimLines: [Point2D, Point2D][];
  dimArc?: {
    center: Point2D;
    radius: number;
    startPt: Point2D;
    endPt: Point2D;
    largeArc: boolean;
    sweepFlag: 0 | 1;
  };
  centerCross?: Point2D;
  arrows: { tip: Point2D; dirX: number; dirY: number }[];
  textPos: Point2D;
  textAngleDeg: number;
  bbox: { x: number; y: number; width: number; height: number };
}

function addPointToBounds(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  p: Point2D,
  pad = 0
) {
  b.minX = Math.min(b.minX, p.x - pad);
  b.minY = Math.min(b.minY, p.y - pad);
  b.maxX = Math.max(b.maxX, p.x + pad);
  b.maxY = Math.max(b.maxY, p.y + pad);
}

function makeExtensionSegment(fromPt: Point2D, toLinePt: Point2D): [Point2D, Point2D] | null {
  const dx = toLinePt.x - fromPt.x;
  const dy = toLinePt.y - fromPt.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  const ux = dx / len;
  const uy = dy / len;
  const gap = Math.min(4, len * 0.25);
  const overshoot = 7;
  return [
    { x: fromPt.x + ux * gap, y: fromPt.y + uy * gap },
    { x: toLinePt.x + ux * overshoot, y: toLinePt.y + uy * overshoot },
  ];
}

function readableAngleDeg(dx: number, dy: number): number {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return deg;
}

export function resolveLinearAxisMode(
  p1: Point2D,
  p2: Point2D,
  offsetPt: Point2D,
  explicit?: CadLinearDimAxis
): 'horizontal' | 'vertical' | 'aligned' {
  if (
    explicit === 'horizontal' ||
    explicit === 'vertical' ||
    explicit === 'aligned'
  ) {
    return explicit;
  }
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  // If offsetPt lies horizontally outside [minX, maxX] and vertically inside [minY, maxY], measure vertical ΔY
  const outX = offsetPt.x < minX ? minX - offsetPt.x : offsetPt.x > maxX ? offsetPt.x - maxX : 0;
  const outY = offsetPt.y < minY ? minY - offsetPt.y : offsetPt.y > maxY ? offsetPt.y - maxY : 0;

  const absDx = Math.abs(p2.x - p1.x);
  const absDy = Math.abs(p2.y - p1.y);
  const isDiagonal =
    absDx >= 12 &&
    absDy >= 12 &&
    Math.min(absDx, absDy) / Math.max(absDx, absDy) >= 0.18;

  if (isDiagonal) {
    if (outX === 0 && outY === 0) {
      return 'aligned';
    }
    if (
      outX > 0 &&
      outY > 0 &&
      Math.abs(outX - outY) <= Math.max(outX, outY) * 0.45
    ) {
      return 'aligned';
    }
  }

  if (outX > outY + 4) return 'vertical';
  if (outY > outX + 4) return 'horizontal';

  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  return Math.abs(offsetPt.y - mid.y) >= Math.abs(offsetPt.x - mid.x)
    ? 'horizontal'
    : 'vertical';
}

export function computeDimensionMetrics(
  dim: Pick<
    DimensionObject,
    | 'dimKind'
    | 'p1'
    | 'p2'
    | 'p3'
    | 'offsetPt'
    | 'linearAxis'
    | 'ordinateAxis'
    | 'fontSize'
    | 'textOverride'
  >,
  config: CadDraftingConfig
): DimensionMetrics {
  const unit = getUnitShortLabel(config.unit);
  const extLines: [Point2D, Point2D][] = [];
  const dimLines: [Point2D, Point2D][] = [];
  const arrows: { tip: Point2D; dirX: number; dirY: number }[] = [];
  let dimArc: DimensionMetrics['dimArc'];
  let centerCross: Point2D | undefined;

  let numericValue = 0;
  let formattedLabel = '';
  let textPos: Point2D = { ...dim.offsetPt };
  let textAngleDeg = 0;

  const { p1, p2, offsetPt } = dim;
  const resolvedLinearAxis =
    dim.dimKind === 'linear'
      ? resolveLinearAxisMode(p1, p2, offsetPt, dim.linearAxis)
      : null;

  if (dim.dimKind === 'linear' && resolvedLinearAxis !== 'aligned') {
    if (resolvedLinearAxis === 'horizontal') {
      const yLine = offsetPt.y;
      const d1 = { x: p1.x, y: yLine };
      const d2 = { x: p2.x, y: yLine };
      const distW = Math.abs(p2.x - p1.x);
      numericValue = worldDistToCadDist(distW, config);
      formattedLabel = `${formatCadNumber(numericValue, config.decimals)} ${unit}`;

      const e1 = makeExtensionSegment(p1, d1);
      const e2 = makeExtensionSegment(p2, d2);
      if (e1) extLines.push(e1);
      if (e2) extLines.push(e2);
      dimLines.push([d1, d2]);

      const sign = d2.x >= d1.x ? 1 : -1;
      if (distW > 2) {
        arrows.push({ tip: d1, dirX: sign, dirY: 0 });
        arrows.push({ tip: d2, dirX: -sign, dirY: 0 });
      }
      textPos = { x: (d1.x + d2.x) / 2, y: yLine - 7 };
      textAngleDeg = 0;
    } else {
      const xLine = offsetPt.x;
      const d1 = { x: xLine, y: p1.y };
      const d2 = { x: xLine, y: p2.y };
      const distW = Math.abs(p2.y - p1.y);
      numericValue = worldDistToCadDist(distW, config);
      formattedLabel = `${formatCadNumber(numericValue, config.decimals)} ${unit}`;

      const e1 = makeExtensionSegment(p1, d1);
      const e2 = makeExtensionSegment(p2, d2);
      if (e1) extLines.push(e1);
      if (e2) extLines.push(e2);
      dimLines.push([d1, d2]);

      const sign = d2.y >= d1.y ? 1 : -1;
      if (distW > 2) {
        arrows.push({ tip: d1, dirX: 0, dirY: sign });
        arrows.push({ tip: d2, dirX: 0, dirY: -sign });
      }
      textPos = { x: xLine - 8, y: (d1.y + d2.y) / 2 };
      textAngleDeg = -90;
    }
  } else if (dim.dimKind === 'aligned' || resolvedLinearAxis === 'aligned') {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    numericValue = worldDistToCadDist(len, config);
    formattedLabel = `${formatCadNumber(numericValue, config.decimals)} ${unit}`;

    if (len >= 1e-3) {
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const signedOffset = (offsetPt.x - p1.x) * nx + (offsetPt.y - p1.y) * ny;
      const d1 = { x: p1.x + nx * signedOffset, y: p1.y + ny * signedOffset };
      const d2 = { x: p2.x + nx * signedOffset, y: p2.y + ny * signedOffset };

      const e1 = makeExtensionSegment(p1, d1);
      const e2 = makeExtensionSegment(p2, d2);
      if (e1) extLines.push(e1);
      if (e2) extLines.push(e2);
      dimLines.push([d1, d2]);
      arrows.push({ tip: d1, dirX: ux, dirY: uy });
      arrows.push({ tip: d2, dirX: -ux, dirY: -uy });

      const midX = (d1.x + d2.x) / 2;
      const midY = (d1.y + d2.y) / 2;
      textAngleDeg = readableAngleDeg(dx, dy);
      const radT = (textAngleDeg * Math.PI) / 180;
      const tNormX = Math.sin(radT);
      const tNormY = -Math.cos(radT);
      textPos = { x: midX + tNormX * 8, y: midY + tNormY * 8 };
    }
  } else if (dim.dimKind === 'angular') {
    const vertex = p1;
    const ray1 = p2;
    const ray2 = dim.p3 ?? offsetPt;
    const a1 = Math.atan2(ray1.y - vertex.y, ray1.x - vertex.x);
    const a2 = Math.atan2(ray2.y - vertex.y, ray2.x - vertex.x);

    const radius = Math.max(20, Math.hypot(offsetPt.x - vertex.x, offsetPt.y - vertex.y));
    const normAng = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const s1 = normAng(a1);
    const s2 = normAng(a2);
    const sOff = normAng(Math.atan2(offsetPt.y - vertex.y, offsetPt.x - vertex.x));

    // Check whether offsetPt falls in CW sweep (s1 -> s2 in screen space) or reverse sweep
    const cwSweep = normAng(s2 - s1);
    const cwOff = normAng(sOff - s1);
    const insideMinorCw = cwOff <= cwSweep;

    let startRad: number;
    let endRad: number;
    let sweepRad: number;
    let sweepFlag: 0 | 1;

    if (insideMinorCw) {
      startRad = s1;
      endRad = s2;
      sweepRad = cwSweep;
      sweepFlag = 1;
    } else {
      startRad = s1;
      endRad = s2;
      sweepRad = 2 * Math.PI - cwSweep;
      sweepFlag = 0;
    }

    const deg = (sweepRad * 180) / Math.PI;
    numericValue = deg;
    formattedLabel = `${formatCadNumber(deg, Math.min(2, Math.max(1, config.decimals)))}°`;

    const startPt = {
      x: vertex.x + radius * Math.cos(startRad),
      y: vertex.y + radius * Math.sin(startRad),
    };
    const endPt = {
      x: vertex.x + radius * Math.cos(endRad),
      y: vertex.y + radius * Math.sin(endRad),
    };

    const e1 = makeExtensionSegment(ray1, startPt);
    const e2 = makeExtensionSegment(ray2, endPt);
    if (e1) extLines.push(e1);
    if (e2) extLines.push(e2);
    // Also subtle ray lines from vertex if needed
    extLines.push([vertex, startPt], [vertex, endPt]);

    dimArc = {
      center: vertex,
      radius,
      startPt,
      endPt,
      largeArc: sweepRad > Math.PI,
      sweepFlag,
    };

    // Tangent vectors along arc at startPt and endPt
    const dirSign = sweepFlag === 1 ? 1 : -1;
    arrows.push({
      tip: startPt,
      dirX: -Math.sin(startRad) * dirSign,
      dirY: Math.cos(startRad) * dirSign,
    });
    arrows.push({
      tip: endPt,
      dirX: Math.sin(endRad) * dirSign,
      dirY: -Math.cos(endRad) * dirSign,
    });

    const midRad = startRad + dirSign * (sweepRad / 2);
    textPos = {
      x: vertex.x + (radius + 12) * Math.cos(midRad),
      y: vertex.y + (radius + 12) * Math.sin(midRad),
    };
    textAngleDeg = 0;
  } else if (dim.dimKind === 'radial') {
    const center = p1;
    const radiusW = Math.max(1, Math.hypot(p2.x - center.x, p2.y - center.y));
    numericValue = worldDistToCadDist(radiusW, config);
    formattedLabel = `R${formatCadNumber(numericValue, config.decimals)} ${unit}`;
    centerCross = center;

    const dx = offsetPt.x - center.x;
    const dy = offsetPt.y - center.y;
    const offLen = Math.hypot(dx, dy);
    const ux = offLen > 1 ? dx / offLen : (p2.x - center.x) / radiusW;
    const uy = offLen > 1 ? dy / offLen : (p2.y - center.y) / radiusW;
    const rimPt = { x: center.x + ux * radiusW, y: center.y + uy * radiusW };
    const lineEnd = offLen > radiusW + 10 ? offsetPt : rimPt;

    dimLines.push([center, lineEnd]);
    arrows.push({ tip: rimPt, dirX: -ux, dirY: -uy });
    if (offLen > radiusW + 10) {
      textPos = { x: offsetPt.x + ux * 10, y: offsetPt.y + uy * 10 };
      textAngleDeg = 0;
    } else {
      textPos = {
        x: (center.x + rimPt.x) / 2 - uy * 8,
        y: (center.y + rimPt.y) / 2 + ux * 8,
      };
      textAngleDeg = readableAngleDeg(ux, uy);
    }
  } else if (dim.dimKind === 'diametral') {
    const center = p1;
    const radiusW = Math.max(1, Math.hypot(p2.x - center.x, p2.y - center.y));
    numericValue = worldDistToCadDist(radiusW * 2, config);
    formattedLabel = `Ø${formatCadNumber(numericValue, config.decimals)} ${unit}`;
    centerCross = center;

    const dx = offsetPt.x - center.x;
    const dy = offsetPt.y - center.y;
    const offLen = Math.hypot(dx, dy);
    const ux = offLen > 1 ? dx / offLen : (p2.x - center.x) / radiusW;
    const uy = offLen > 1 ? dy / offLen : (p2.y - center.y) / radiusW;
    const rimPos = { x: center.x + ux * radiusW, y: center.y + uy * radiusW };
    const rimNeg = { x: center.x - ux * radiusW, y: center.y - uy * radiusW };

    dimLines.push([rimNeg, rimPos]);
    if (offLen > radiusW + 12) {
      dimLines.push([rimPos, offsetPt]);
      textPos = { x: offsetPt.x + ux * 10, y: offsetPt.y + uy * 10 };
      textAngleDeg = 0;
    } else {
      textPos = {
        x: center.x - uy * 8,
        y: center.y + ux * 8,
      };
      textAngleDeg = readableAngleDeg(ux, uy);
    }
    arrows.push({ tip: rimPos, dirX: -ux, dirY: -uy });
    arrows.push({ tip: rimNeg, dirX: ux, dirY: uy });
  } else if (dim.dimKind === 'ordinate') {
    const ordAxis: 'x' | 'y' =
      dim.ordinateAxis ??
      (Math.abs(offsetPt.y - p1.y) >= Math.abs(offsetPt.x - p1.x) ? 'x' : 'y');
    const cadPt = worldToCad(p1, config);
    numericValue = ordAxis === 'x' ? cadPt.x : cadPt.y;
    formattedLabel = `${ordAxis.toUpperCase()}=${formatCadNumber(numericValue, config.decimals)} ${unit}`;

    if (ordAxis === 'x') {
      const midY = p1.y + (offsetPt.y - p1.y) * 0.55;
      const bend1 = { x: p1.x, y: midY };
      const bend2 = { x: offsetPt.x, y: midY };
      dimLines.push([p1, bend1], [bend1, bend2], [bend2, offsetPt]);
      const dirY = offsetPt.y >= p1.y ? 1 : -1;
      textPos = { x: offsetPt.x, y: offsetPt.y + dirY * 12 };
    } else {
      const midX = p1.x + (offsetPt.x - p1.x) * 0.55;
      const bend1 = { x: midX, y: p1.y };
      const bend2 = { x: midX, y: offsetPt.y };
      dimLines.push([p1, bend1], [bend1, bend2], [bend2, offsetPt]);
      const dirX = offsetPt.x >= p1.x ? 1 : -1;
      textPos = { x: offsetPt.x + dirX * 26, y: offsetPt.y };
    }
    arrows.push({ tip: p1, dirX: 0, dirY: 0 });
  }

  const displayLabel =
    dim.textOverride !== undefined && dim.textOverride.trim().length > 0
      ? dim.textOverride.trim()
      : formattedLabel;

  // Tight bounding box containing all lines, arc, and label text
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  addPointToBounds(b, p1, 8);
  if (dim.dimKind !== 'ordinate') addPointToBounds(b, p2, 8);
  if (dim.p3) addPointToBounds(b, dim.p3, 8);
  addPointToBounds(b, offsetPt, 12);
  for (const [a, c] of extLines) {
    addPointToBounds(b, a, 6);
    addPointToBounds(b, c, 6);
  }
  for (const [a, c] of dimLines) {
    addPointToBounds(b, a, 8);
    addPointToBounds(b, c, 8);
  }
  if (dimArc) {
    addPointToBounds(b, dimArc.startPt, 10);
    addPointToBounds(b, dimArc.endPt, 10);
    addPointToBounds(b, dimArc.center, 8);
  }
  const approxTextW = Math.max(36, displayLabel.length * ((dim.fontSize || 12) * 0.65));
  const approxTextH = Math.max(18, (dim.fontSize || 12) * 1.6);
  addPointToBounds(b, textPos, Math.max(approxTextW / 2 + 8, approxTextH + 8));

  const x = Number.isFinite(b.minX) ? b.minX : p1.x - 20;
  const y = Number.isFinite(b.minY) ? b.minY : p1.y - 20;
  const width = Math.max(24, (Number.isFinite(b.maxX) ? b.maxX : x + 40) - x);
  const height = Math.max(24, (Number.isFinite(b.maxY) ? b.maxY : y + 40) - y);

  return {
    numericValue,
    formattedLabel,
    displayLabel,
    extLines,
    dimLines,
    dimArc,
    centerCross,
    arrows,
    textPos,
    textAngleDeg,
    bbox: { x, y, width, height },
  };
}

export function createDimensionAnchor(
  objectId: string | null | undefined,
  worldPt: Point2D,
  objects: CanvasObject[],
  role: DimensionAnchor['role'] = 'point'
): DimensionAnchor | undefined {
  if (!objectId) return undefined;
  const target = objects.find((o) => o.id === objectId);
  if (!target || target.type === 'dimension') return undefined;

  if (
    target.type === 'shape' &&
    (target.shapeKind === 'circle' ||
      target.shapeKind === 'ellipse' ||
      target.shapeKind === 'sphere' ||
      target.shapeKind === 'arc')
  ) {
    const center = localToWorld({ x: target.width / 2, y: target.height / 2 }, target);
    const distFromCenter = Math.hypot(worldPt.x - center.x, worldPt.y - center.y);
    if (role === 'center' || distFromCenter < 4) {
      return {
        objectId: target.id,
        localPoint: { x: target.width / 2, y: target.height / 2 },
        role: 'center',
      };
    }
    if (role === 'rim') {
      const local = worldToLocal(worldPt, target);
      const rimAngleDeg =
        (Math.atan2(local.y - target.height / 2, local.x - target.width / 2) * 180) /
        Math.PI;
      return {
        objectId: target.id,
        localPoint: local,
        role: 'rim',
        rimAngleDeg,
      };
    }
  }

  return {
    objectId: target.id,
    localPoint: worldToLocal(worldPt, target),
    role,
  };
}

export function resolveDimensionAnchorWorld(
  anchor: DimensionAnchor | undefined,
  objectsById: Map<string, CanvasObject>
): Point2D | null {
  if (!anchor) return null;
  const target = objectsById.get(anchor.objectId);
  if (!target) return null;

  if (anchor.role === 'center') {
    return localToWorld({ x: target.width / 2, y: target.height / 2 }, target);
  }

  if (anchor.role === 'rim' && target.type === 'shape') {
    const pad = target.shapeKind === 'arc' ? 4 : target.strokeWidth / 2 + 2;
    const rx = Math.max(3, target.width / 2 - pad);
    const ry = Math.max(3, target.height / 2 - pad);
    const rad = ((anchor.rimAngleDeg ?? 0) * Math.PI) / 180;
    return localToWorld(
      {
        x: target.width / 2 + rx * Math.cos(rad),
        y: target.height / 2 + ry * Math.sin(rad),
      },
      target
    );
  }

  return localToWorld(anchor.localPoint, target);
}

export function buildDimensionObject(
  params: {
    dimKind: DimensionKind;
    p1: Point2D;
    p2: Point2D;
    p3?: Point2D;
    offsetPt: Point2D;
    linearAxis?: CadLinearDimAxis;
    ordinateAxis?: 'x' | 'y';
    anchor1?: DimensionAnchor;
    anchor2?: DimensionAnchor;
    anchor3?: DimensionAnchor;
    textOverride?: string;
  },
  config: CadDraftingConfig,
  ctx: CadBuildContext
): DimensionObject {
  const strokeColor = ctx.toolOptions.shapeStrokeColor || '#0f172a';
  const baseDim: DimensionObject = {
    id: uid('dim'),
    type: 'dimension',
    layerId: ctx.layerId,
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    dimKind: params.dimKind,
    p1: { ...params.p1 },
    p2: { ...params.p2 },
    p3: params.p3 ? { ...params.p3 } : undefined,
    offsetPt: { ...params.offsetPt },
    linearAxis: params.linearAxis,
    ordinateAxis: params.ordinateAxis,
    anchor1: params.anchor1,
    anchor2: params.anchor2,
    anchor3: params.anchor3,
    strokeColor,
    textColor: strokeColor,
    fontSize: 12,
    textOverride: params.textOverride,
  };
  const metrics = computeDimensionMetrics(baseDim, config);
  return {
    ...baseDim,
    x: metrics.bbox.x,
    y: metrics.bbox.y,
    width: metrics.bbox.width,
    height: metrics.bbox.height,
  };
}

/**
 * Updates all associative dimensions in `objects` whenever referenced geometry moves/resizes/edits.
 */
export function recomputeAssociativeDimensions(
  objects: CanvasObject[],
  config: CadDraftingConfig
): CanvasObject[] {
  let hasDim = false;
  for (const o of objects) {
    if (o.type === 'dimension') {
      hasDim = true;
      break;
    }
  }
  if (!hasDim) return objects;

  const byId = new Map<string, CanvasObject>();
  for (const o of objects) byId.set(o.id, o);

  let anyChanged = false;
  const next = objects.map((obj) => {
    if (obj.type !== 'dimension') return obj;
    const nextP1 = resolveDimensionAnchorWorld(obj.anchor1, byId) ?? obj.p1;
    const nextP2 = resolveDimensionAnchorWorld(obj.anchor2, byId) ?? obj.p2;
    const nextP3 = obj.p3
      ? resolveDimensionAnchorWorld(obj.anchor3, byId) ?? obj.p3
      : undefined;

    // Shift offsetPt coherently if p1 shifted (or average shift for radial/linear)
    const d1x = nextP1.x - obj.p1.x;
    const d1y = nextP1.y - obj.p1.y;
    const d2x = nextP2.x - obj.p2.x;
    const d2y = nextP2.y - obj.p2.y;
    let nextOffset = obj.offsetPt;

    if (obj.dimKind === 'radial' || obj.dimKind === 'diametral' || obj.dimKind === 'ordinate' || obj.dimKind === 'angular') {
      if (Math.abs(d1x) > 1e-4 || Math.abs(d1y) > 1e-4) {
        nextOffset = { x: obj.offsetPt.x + d1x, y: obj.offsetPt.y + d1y };
      }
    } else {
      const avgDx = (d1x + d2x) / 2;
      const avgDy = (d1y + d2y) / 2;
      if (Math.abs(avgDx) > 1e-4 || Math.abs(avgDy) > 1e-4) {
        nextOffset = { x: obj.offsetPt.x + avgDx, y: obj.offsetPt.y + avgDy };
      }
    }

    const updated: DimensionObject = {
      ...obj,
      p1: nextP1,
      p2: nextP2,
      p3: nextP3,
      offsetPt: nextOffset,
    };
    const metrics = computeDimensionMetrics(updated, config);
    const finalDim: DimensionObject = {
      ...updated,
      x: metrics.bbox.x,
      y: metrics.bbox.y,
      width: metrics.bbox.width,
      height: metrics.bbox.height,
    };

    if (
      Math.abs(finalDim.x - obj.x) > 1e-3 ||
      Math.abs(finalDim.y - obj.y) > 1e-3 ||
      Math.abs(finalDim.width - obj.width) > 1e-3 ||
      Math.abs(finalDim.height - obj.height) > 1e-3 ||
      Math.abs(finalDim.p1.x - obj.p1.x) > 1e-3 ||
      Math.abs(finalDim.p1.y - obj.p1.y) > 1e-3 ||
      Math.abs(finalDim.p2.x - obj.p2.x) > 1e-3 ||
      Math.abs(finalDim.p2.y - obj.p2.y) > 1e-3
    ) {
      anyChanged = true;
      return finalDim;
    }
    return obj;
  });

  return anyChanged ? next : objects;
}

/**
 * Helper to extract circular center + rim radius from a selected or clicked ShapeObject
 * for Radial & Diametral dimensions.
 */
export function extractCircleRadiusAtPoint(
  obj: CanvasObject | undefined,
  clickWorld: Point2D
): { center: Point2D; rimPt: Point2D; radiusWorld: number } | null {
  if (!obj || obj.type !== 'shape') return null;
  if (
    obj.shapeKind !== 'circle' &&
    obj.shapeKind !== 'ellipse' &&
    obj.shapeKind !== 'sphere' &&
    obj.shapeKind !== 'arc'
  ) {
    return null;
  }
  const center = localToWorld({ x: obj.width / 2, y: obj.height / 2 }, obj);
  const pad = obj.shapeKind === 'arc' ? 4 : obj.strokeWidth / 2 + 2;
  const rx = Math.max(3, obj.width / 2 - pad);
  const ry = Math.max(3, obj.height / 2 - pad);
  const localClick = worldToLocal(clickWorld, obj);
  const ang = Math.atan2(localClick.y - obj.height / 2, localClick.x - obj.width / 2);
  const rimPt = localToWorld(
    {
      x: obj.width / 2 + rx * Math.cos(ang),
      y: obj.height / 2 + ry * Math.sin(ang),
    },
    obj
  );
  return {
    center,
    rimPt,
    radiusWorld: Math.hypot(rimPt.x - center.x, rimPt.y - center.y),
  };
}

// V1.11.8-2: Lectura y actualización editable del desplazamiento de la línea de cota (px del mundo)
export function getDimensionLineOffset(
  dim: DimensionObject,
  config: CadDraftingConfig = DEFAULT_CAD_CONFIG
): { value: number; min: number; max: number; label: string } | null {
  try {
    const { p1, p2, offsetPt } = dim;
    const linearAxis =
      dim.dimKind === 'linear'
        ? resolveLinearAxisMode(p1, p2, offsetPt, dim.linearAxis)
        : null;
    if (dim.dimKind === 'linear' && linearAxis && linearAxis !== 'aligned') {
      if (linearAxis === 'horizontal') {
        const refY = (p1.y + p2.y) / 2;
        return {
          value: Math.round(offsetPt.y - refY),
          min: -2000,
          max: 2000,
          label: 'Desplazamiento (px)',
        };
      }
      const refX = (p1.x + p2.x) / 2;
      return {
        value: Math.round(offsetPt.x - refX),
        min: -2000,
        max: 2000,
        label: 'Desplazamiento (px)',
      };
    }
    if (dim.dimKind === 'aligned' || linearAxis === 'aligned') {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) return null;
      const nx = -dy / len;
      const ny = dx / len;
      const signed = (offsetPt.x - p1.x) * nx + (offsetPt.y - p1.y) * ny;
      return {
        value: Math.round(signed),
        min: -2000,
        max: 2000,
        label: 'Desplazamiento (px)',
      };
    }
    if (dim.dimKind === 'angular') {
      const radius = Math.max(20, Math.hypot(offsetPt.x - p1.x, offsetPt.y - p1.y));
      return {
        value: Math.round(radius),
        min: 20,
        max: 2000,
        label: 'Radio de arco (px)',
      };
    }
    if (dim.dimKind === 'radial' || dim.dimKind === 'diametral') {
      const dist = Math.hypot(offsetPt.x - p1.x, offsetPt.y - p1.y);
      return {
        value: Math.round(dist),
        min: 10,
        max: 2000,
        label: 'Extensión (px)',
      };
    }
    if (dim.dimKind === 'ordinate') {
      const ordAxis: 'x' | 'y' =
        dim.ordinateAxis ??
        (Math.abs(offsetPt.y - p1.y) >= Math.abs(offsetPt.x - p1.x) ? 'x' : 'y');
      const delta = ordAxis === 'x' ? offsetPt.y - p1.y : offsetPt.x - p1.x;
      return {
        value: Math.round(delta),
        min: -2000,
        max: 2000,
        label: 'Desplazamiento (px)',
      };
    }
    void config;
    return null;
  } catch {
    return null;
  }
}

export function withDimensionLineOffset(
  dim: DimensionObject,
  nextOffset: number,
  config: CadDraftingConfig = DEFAULT_CAD_CONFIG
): DimensionObject {
  const safeVal = Number.isFinite(nextOffset) ? nextOffset : 0;
  let nextOffsetPt = { ...dim.offsetPt };
  let nextLinearAxis = dim.linearAxis;

  const resolvedLinearAxis =
    dim.dimKind === 'linear'
      ? resolveLinearAxisMode(dim.p1, dim.p2, dim.offsetPt, dim.linearAxis)
      : null;

  if (dim.dimKind === 'linear' && resolvedLinearAxis && resolvedLinearAxis !== 'aligned') {
    nextLinearAxis = resolvedLinearAxis;
    if (resolvedLinearAxis === 'horizontal') {
      const refY = (dim.p1.y + dim.p2.y) / 2;
      nextOffsetPt = { ...dim.offsetPt, y: refY + safeVal };
    } else {
      const refX = (dim.p1.x + dim.p2.x) / 2;
      nextOffsetPt = { ...dim.offsetPt, x: refX + safeVal };
    }
  } else if (dim.dimKind === 'aligned' || resolvedLinearAxis === 'aligned') {
    if (dim.dimKind === 'linear') {
      nextLinearAxis = 'aligned';
    }
    const dx = dim.p2.x - dim.p1.x;
    const dy = dim.p2.y - dim.p1.y;
    const len = Math.hypot(dx, dy);
    if (len >= 1e-3) {
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const along = (dim.offsetPt.x - dim.p1.x) * ux + (dim.offsetPt.y - dim.p1.y) * uy;
      nextOffsetPt = {
        x: dim.p1.x + ux * along + nx * safeVal,
        y: dim.p1.y + uy * along + ny * safeVal,
      };
    }
  } else if (dim.dimKind === 'angular') {
    const dx = dim.offsetPt.x - dim.p1.x;
    const dy = dim.offsetPt.y - dim.p1.y;
    const curLen = Math.hypot(dx, dy);
    const radius = Math.max(20, safeVal);
    const ang = curLen > 1e-3 ? Math.atan2(dy, dx) : Math.atan2(dim.p2.y - dim.p1.y, dim.p2.x - dim.p1.x);
    nextOffsetPt = {
      x: dim.p1.x + radius * Math.cos(ang),
      y: dim.p1.y + radius * Math.sin(ang),
    };
  } else if (dim.dimKind === 'radial' || dim.dimKind === 'diametral') {
    const dx = dim.offsetPt.x - dim.p1.x;
    const dy = dim.offsetPt.y - dim.p1.y;
    const curLen = Math.hypot(dx, dy);
    const ux = curLen > 1e-3 ? dx / curLen : (dim.p2.x - dim.p1.x) / Math.max(1, Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y));
    const uy = curLen > 1e-3 ? dy / curLen : (dim.p2.y - dim.p1.y) / Math.max(1, Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y));
    const dist = Math.max(10, safeVal);
    nextOffsetPt = {
      x: dim.p1.x + ux * dist,
      y: dim.p1.y + uy * dist,
    };
  } else if (dim.dimKind === 'ordinate') {
    const ordAxis: 'x' | 'y' =
      dim.ordinateAxis ??
      (Math.abs(dim.offsetPt.y - dim.p1.y) >= Math.abs(dim.offsetPt.x - dim.p1.x) ? 'x' : 'y');
    nextOffsetPt =
      ordAxis === 'x'
        ? { ...dim.offsetPt, y: dim.p1.y + safeVal }
        : { ...dim.offsetPt, x: dim.p1.x + safeVal };
  }

  const updated: DimensionObject = {
    ...dim,
    linearAxis: nextLinearAxis,
    offsetPt: nextOffsetPt,
  };
  const metrics = computeDimensionMetrics(updated, config);
  return {
    ...updated,
    x: metrics.bbox.x,
    y: metrics.bbox.y,
    width: metrics.bbox.width,
    height: metrics.bbox.height,
  };
}

// V1.11.8-2: Manejador manual en la pizarra para desplazar la línea de cota
export function getDimensionOffsetHandleWorld(
  dim: DimensionObject,
  metrics: DimensionMetrics
): Point2D {
  if (dim.dimKind === 'linear' || dim.dimKind === 'aligned') {
    if (metrics.dimLines.length > 0) {
      const [d1, d2] = metrics.dimLines[0];
      return { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
    }
    return { ...dim.offsetPt };
  }
  if (dim.dimKind === 'angular' && metrics.dimArc) {
    const { center, radius, startPt, endPt, sweepFlag } = metrics.dimArc;
    const a1 = Math.atan2(startPt.y - center.y, startPt.x - center.x);
    const a2 = Math.atan2(endPt.y - center.y, endPt.x - center.x);
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const sweep = sweepFlag === 1 ? norm(a2 - a1) : norm(a1 - a2);
    const midRad = a1 + (sweepFlag === 1 ? 1 : -1) * (sweep / 2);
    return {
      x: center.x + radius * Math.cos(midRad),
      y: center.y + radius * Math.sin(midRad),
    };
  }
  if ((dim.dimKind === 'radial' || dim.dimKind === 'diametral') && metrics.dimLines.length > 0) {
    const lastSeg = metrics.dimLines[metrics.dimLines.length - 1];
    return { ...lastSeg[1] };
  }
  return { ...dim.offsetPt };
}

export function getDimensionOffsetHandleCursor(dim: DimensionObject): string {
  if (dim.dimKind === 'linear') {
    const axis = resolveLinearAxisMode(dim.p1, dim.p2, dim.offsetPt, dim.linearAxis);
    if (axis === 'aligned') return 'move';
    return axis === 'horizontal' ? 'ns-resize' : 'ew-resize';
  }
  return 'move';
}

export function applyDimensionManualOffsetDrag(
  dim: DimensionObject,
  targetWorld: Point2D,
  config: CadDraftingConfig = DEFAULT_CAD_CONFIG,
  opts?: { shiftKey?: boolean; lockLinearAxis?: 'horizontal' | 'vertical' | 'aligned' }
): DimensionObject {
  try {
    const shiftKey = Boolean(opts?.shiftKey);
    const dragLinearAxis =
      dim.dimKind === 'linear'
        ? opts?.lockLinearAxis ??
          resolveLinearAxisMode(dim.p1, dim.p2, dim.offsetPt, dim.linearAxis)
        : null;
    if (dim.dimKind === 'linear' && dragLinearAxis && dragLinearAxis !== 'aligned') {
      const refCoord =
        dragLinearAxis === 'horizontal'
          ? (dim.p1.y + dim.p2.y) / 2
          : (dim.p1.x + dim.p2.x) / 2;
      const targetCoord = dragLinearAxis === 'horizontal' ? targetWorld.y : targetWorld.x;
      let rawOffset = targetCoord - refCoord;
      if (shiftKey) {
        rawOffset = Math.round(rawOffset / 10) * 10;
      }
      return withDimensionLineOffset(
        { ...dim, linearAxis: dragLinearAxis },
        rawOffset,
        config
      );
    }

    if (dim.dimKind === 'aligned' || dragLinearAxis === 'aligned') {
      const dx = dim.p2.x - dim.p1.x;
      const dy = dim.p2.y - dim.p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) return dim;
      const nx = -dy / len;
      const ny = dx / len;
      let rawOffset = (targetWorld.x - dim.p1.x) * nx + (targetWorld.y - dim.p1.y) * ny;
      if (shiftKey) {
        rawOffset = Math.round(rawOffset / 10) * 10;
      }
      return withDimensionLineOffset(
        dim.dimKind === 'linear' ? { ...dim, linearAxis: 'aligned' } : dim,
        rawOffset,
        config
      );
    }

    if (dim.dimKind === 'angular') {
      let rawRadius = Math.max(20, Math.hypot(targetWorld.x - dim.p1.x, targetWorld.y - dim.p1.y));
      if (shiftKey) {
        rawRadius = Math.max(20, Math.round(rawRadius / 10) * 10);
      }
      return withDimensionLineOffset(dim, rawRadius, config);
    }

    if (dim.dimKind === 'radial' || dim.dimKind === 'diametral') {
      let dx = targetWorld.x - dim.p1.x;
      let dy = targetWorld.y - dim.p1.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1e-3) {
        const fbDx = dim.offsetPt.x - dim.p1.x;
        const fbDy = dim.offsetPt.y - dim.p1.y;
        const fbLen = Math.hypot(fbDx, fbDy);
        dx = fbLen > 1e-3 ? (fbDx / fbLen) * 10 : 10;
        dy = fbLen > 1e-3 ? (fbDy / fbLen) * 10 : 0;
        dist = 10;
      } else if (dist < 10) {
        dx = (dx / dist) * 10;
        dy = (dy / dist) * 10;
        dist = 10;
      }
      if (shiftKey) {
        const snapAng =
          Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * (Math.PI / 12);
        const snapDist = Math.max(10, Math.round(dist / 10) * 10);
        dx = snapDist * Math.cos(snapAng);
        dy = snapDist * Math.sin(snapAng);
      }
      const updated: DimensionObject = {
        ...dim,
        offsetPt: { x: dim.p1.x + dx, y: dim.p1.y + dy },
      };
      const metrics = computeDimensionMetrics(updated, config);
      return {
        ...updated,
        x: metrics.bbox.x,
        y: metrics.bbox.y,
        width: metrics.bbox.width,
        height: metrics.bbox.height,
      };
    }

    if (dim.dimKind === 'ordinate') {
      const nextPt = shiftKey
        ? {
            x: dim.p1.x + Math.round((targetWorld.x - dim.p1.x) / 10) * 10,
            y: dim.p1.y + Math.round((targetWorld.y - dim.p1.y) / 10) * 10,
          }
        : { x: targetWorld.x, y: targetWorld.y };
      const updated: DimensionObject = {
        ...dim,
        offsetPt: nextPt,
      };
      const metrics = computeDimensionMetrics(updated, config);
      return {
        ...updated,
        x: metrics.bbox.x,
        y: metrics.bbox.y,
        width: metrics.bbox.width,
        height: metrics.bbox.height,
      };
    }

    return dim;
  } catch {
    return dim;
  }
}
