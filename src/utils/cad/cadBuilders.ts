import type { CadDraftingConfig, CadPolygonFit } from '../../types/cad';
import type {
  LineObject,
  Point2D,
  ShapeObject,
  ToolOptions,
} from '../../types/whiteboard';
import { uid } from '../id';
import {
  buildLineObjectFromWorldEndpoints,
  buildPolylineShapeFromWorldPoints,
  buildShapeObjectFromWorldPolygon,
} from '../geometryCad';
import { worldDeltaToCadAngleDeg } from './cadCoords';

export interface CadBuildContext {
  layerId: string;
  zIndex: number;
  toolOptions: ToolOptions;
}

export function buildCadLine(
  p1: Point2D,
  p2: Point2D,
  ctx: CadBuildContext
): LineObject {
  const template: LineObject = {
    id: uid('line'),
    type: 'line',
    lineKind: ctx.toolOptions.lineKind,
    layerId: ctx.layerId,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 10, y: 0 },
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    strokeWidth: ctx.toolOptions.shapeStrokeWidth,
    strokeStyle:
      ctx.toolOptions.lineKind === 'dashed-line'
        ? 'dashed'
        : ctx.toolOptions.shapeStrokeStyle,
  };
  return buildLineObjectFromWorldEndpoints(template, p1, p2, template.id, ctx.zIndex);
}

export function buildCadPolyline(
  points: Point2D[],
  closed: boolean,
  ctx: CadBuildContext
): ShapeObject {
  const template: ShapeObject = {
    id: uid('shp'),
    type: 'shape',
    shapeKind: closed && points.length >= 3 ? 'custom-polygon' : 'polyline',
    layerId: ctx.layerId,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    fillColor: closed ? ctx.toolOptions.shapeFillColor : 'transparent',
    strokeWidth: ctx.toolOptions.shapeStrokeWidth,
    strokeStyle: ctx.toolOptions.shapeStrokeStyle,
  };

  if (closed && points.length >= 3) {
    return buildShapeObjectFromWorldPolygon(template, points, template.id, ctx.zIndex);
  }
  return buildPolylineShapeFromWorldPoints(template, points, template.id, ctx.zIndex);
}

/**
 * Exact rectangle compensating for shapeRenderer pad = sw/2 + 2 so the drawn stroke center
 * lands precisely on the geometric corners corner1 and corner2.
 */
export function buildCadRectangle(
  corner1: Point2D,
  corner2: Point2D,
  ctx: CadBuildContext
): ShapeObject {
  const sw = ctx.toolOptions.shapeStrokeWidth;
  const pad = sw / 2 + 2;
  const minX = Math.min(corner1.x, corner2.x);
  const minY = Math.min(corner1.y, corner2.y);
  const maxX = Math.max(corner1.x, corner2.x);
  const maxY = Math.max(corner1.y, corner2.y);
  const geomW = Math.max(4, maxX - minX);
  const geomH = Math.max(4, maxY - minY);

  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'rectangle',
    layerId: ctx.layerId,
    x: minX - pad,
    y: minY - pad,
    width: geomW + pad * 2,
    height: geomH + pad * 2,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    fillColor: ctx.toolOptions.shapeFillColor,
    strokeWidth: sw,
    strokeStyle: ctx.toolOptions.shapeStrokeStyle,
    cornerRadius: 0,
  };
}

/**
 * Exact circle compensating for shapeRenderer pad = sw/2 + 2 so center=(x+w/2,y+h/2)
 * and radius = iw/2 = radiusWorld.
 */
export function buildCadCircle(
  center: Point2D,
  radiusWorld: number,
  ctx: CadBuildContext
): ShapeObject {
  const sw = ctx.toolOptions.shapeStrokeWidth;
  const pad = sw / 2 + 2;
  const r = Math.max(2, radiusWorld);
  const size = r * 2 + pad * 2;
  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'circle',
    layerId: ctx.layerId,
    x: center.x - size / 2,
    y: center.y - size / 2,
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    fillColor: ctx.toolOptions.shapeFillColor,
    strokeWidth: sw,
    strokeStyle: ctx.toolOptions.shapeStrokeStyle,
  };
}

/**
 * Exact regular polygon (Inscribed: radius = center-to-vertex; Circumscribed: radius = apothem).
 */
export function buildCadPolygon(
  center: Point2D,
  radiusWorld: number,
  sides: number,
  fit: CadPolygonFit,
  ctx: CadBuildContext
): ShapeObject {
  const n = Math.max(3, Math.min(24, Math.round(sides)));
  const rInput = Math.max(2, radiusWorld);
  const circumR =
    fit === 'circumscribed' ? rInput / Math.max(0.1, Math.cos(Math.PI / n)) : rInput;

  const sw = ctx.toolOptions.shapeStrokeWidth;
  const pad = sw / 2 + 2;
  const size = circumR * 2 + pad * 2;

  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'polygon',
    layerId: ctx.layerId,
    x: center.x - size / 2,
    y: center.y - size / 2,
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    fillColor: ctx.toolOptions.shapeFillColor,
    strokeWidth: sw,
    strokeStyle: ctx.toolOptions.shapeStrokeStyle,
    polygonSides: n,
  };
}

/**
 * Converts a World displacement (dx, dy) from an arc center into the SVG arc angle
 * convention used by shapeRenderer.buildArcPath (0° = top, 90° = right, CW positive).
 */
export function worldDirToSvgArcAngleDeg(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return ((deg % 360) + 360) % 360;
}

export function solveCircumcircle(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D
): { center: Point2D; radius: number } | null {
  const ax = p1.x;
  const ay = p1.y;
  const bx = p2.x;
  const by = p2.y;
  const cx = p3.x;
  const cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-3) return null;

  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;

  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const center = { x: ux, y: uy };
  const radius = Math.hypot(ax - ux, ay - uy);
  if (!Number.isFinite(radius) || radius < 1 || radius > 1e6) return null;
  return { center, radius };
}

/**
 * Builds an Arc ShapeObject passing exactly through pStart -> pMid -> pEnd.
 * Note: buildArcPath uses a fixed margin of 4 (rx = w/2 - 4, ry = h/2 - 4).
 */
export function buildCadArcFrom3Points(
  pStart: Point2D,
  pMid: Point2D,
  pEnd: Point2D,
  ctx: CadBuildContext
): ShapeObject | null {
  const circle = solveCircumcircle(pStart, pMid, pEnd);
  if (!circle) return null;
  const { center, radius } = circle;

  const degStart = worldDirToSvgArcAngleDeg(pStart.x - center.x, pStart.y - center.y);
  const degMid = worldDirToSvgArcAngleDeg(pMid.x - center.x, pMid.y - center.y);
  const degEnd = worldDirToSvgArcAngleDeg(pEnd.x - center.x, pEnd.y - center.y);

  const cwMid = (((degMid - degStart) % 360) + 360) % 360;
  const cwEnd = (((degEnd - degStart) % 360) + 360) % 360;
  const useStartToEnd = cwMid <= cwEnd;

  const arcStartAngle = useStartToEnd ? degStart : degEnd;
  const arcEndAngle = useStartToEnd ? degEnd : degStart;

  const size = Math.max(12, radius * 2 + 8); // margin 4 each side -> w/2 - 4 === radius
  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'arc',
    layerId: ctx.layerId,
    x: center.x - size / 2,
    y: center.y - size / 2,
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    fillColor: 'transparent',
    strokeWidth: ctx.toolOptions.shapeStrokeWidth,
    strokeStyle: ctx.toolOptions.shapeStrokeStyle,
    arcStartAngle: Math.round(arcStartAngle * 100) / 100,
    arcEndAngle: Math.round(arcEndAngle * 100) / 100,
  };
}

/**
 * Builds an Arc from center, start point, and end point (or sweep/end direction).
 * Follows counter-clockwise arc sweep when yAxisUp=true (screen CCW, so SVG CW angle goes end->start).
 */
export function buildCadArcFromCenterStartEnd(
  center: Point2D,
  startPt: Point2D,
  endPtOrDir: Point2D,
  config: CadDraftingConfig,
  ctx: CadBuildContext
): ShapeObject | null {
  const radius = Math.hypot(startPt.x - center.x, startPt.y - center.y);
  if (radius < 2) return null;

  const degStart = worldDirToSvgArcAngleDeg(startPt.x - center.x, startPt.y - center.y);
  const degEnd = worldDirToSvgArcAngleDeg(
    endPtOrDir.x - center.x,
    endPtOrDir.y - center.y
  );

  // In CAD standard (yAxisUp=true), angles increase CCW (screen CCW = SVG decreasing angle),
  // so CCW sweep from start -> end corresponds to SVG CW sweep from degEnd -> degStart.
  const arcStartAngle = config.yAxisUp ? degEnd : degStart;
  const arcEndAngle = config.yAxisUp ? degStart : degEnd;

  const size = Math.max(12, radius * 2 + 8);
  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'arc',
    layerId: ctx.layerId,
    x: center.x - size / 2,
    y: center.y - size / 2,
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: ctx.zIndex,
    strokeColor: ctx.toolOptions.shapeStrokeColor,
    fillColor: 'transparent',
    strokeWidth: ctx.toolOptions.shapeStrokeWidth,
    strokeStyle: ctx.toolOptions.shapeStrokeStyle,
    arcStartAngle: Math.round(arcStartAngle * 100) / 100,
    arcEndAngle: Math.round(arcEndAngle * 100) / 100,
  };
}

export function getSegmentSummary(
  fromWorld: Point2D,
  toWorld: Point2D,
  config: CadDraftingConfig
): { distWorld: number; cadAngleDeg: number } {
  const dx = toWorld.x - fromWorld.x;
  const dy = toWorld.y - fromWorld.y;
  return {
    distWorld: Math.hypot(dx, dy),
    cadAngleDeg: worldDeltaToCadAngleDeg(dx, dy, config),
  };
}
