import React from 'react';
import type {
  CadDraftingConfig,
  CadResolvedCursor,
  CadSessionState,
  PathArraySessionOptions,
} from '../types/cad';
import type {
  BoardViewport,
  CanvasObject,
  GroupRecord,
  LineObject,
  Point2D,
  ShapeObject,
  StrokeObject,
  ToolOptions,
} from '../types/whiteboard';
import { formatCadNumber, getUnitShortLabel } from '../utils/cad/cadCoords';
import {
  buildCadArcFrom3Points,
  buildCadArcFromCenterStartEnd,
  buildCadPolygon,
  getSegmentSummary,
} from '../utils/cad/cadBuilders';
import { computeDimensionMetrics } from '../utils/cad/cadDimensions';
import { DimensionSvgContent } from '../utils/cad/cadDimensionsSvg';
import { formatCadDist, getCadBasePoint } from '../utils/cad/cadSessionController';
import { mirrorObjectsAcrossLine } from '../utils/cad/cadTransform';
import {
  extractWorldPathPoints,
  generatePathArray,
  resolvePathArrayBasePoint,
} from '../utils/cad/cadArrays';
import {
  type BoardThemeColors,
  getTrackingVisualPalette,
} from '../utils/themePalette';
import { findObjectNearWorldPoint } from '../utils/cad/cadSnap';
import { getLineWorldSegments } from '../utils/geometryCad';
import { renderShapeSvgElement } from '../utils/shapeRenderer';

const FALLBACK_BOARD_THEME: BoardThemeColors = {
  boardBg: '#ffffff',
  surroundingBg: '#eef1f6',
  gridStroke: '#e2e8f0',
  linedStroke: '#dbe4f0',
  dotFill: '#94a3b8',
  axisStroke: '#64748b',
  axisText: '#64748b',
  defaultInk: '#0f172a',
  isDarkSurface: false,
};

// Recorta una línea infinita que pasa por origin en dirección dir contra el rectángulo del viewport visible
function clipLineToRect(
  origin: Point2D,
  dir: Point2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): [Point2D, Point2D] | null {
  const dx = dir.x;
  const dy = dir.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;

  let tMin = -1e6;
  let tMax = 1e6;

  const updateBounds = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-8) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > tMax) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin) return false;
      if (r < tMax) tMax = r;
    }
    return true;
  };

  if (!updateBounds(-dx, origin.x - minX)) return null;
  if (!updateBounds(dx, maxX - origin.x)) return null;
  if (!updateBounds(-dy, origin.y - minY)) return null;
  if (!updateBounds(dy, maxY - origin.y)) return null;

  if (tMin > tMax) return null;
  return [
    { x: origin.x + tMin * dx, y: origin.y + tMin * dy },
    { x: origin.x + tMax * dx, y: origin.y + tMax * dy },
  ];
}

interface CadWorldOverlayProps {
  viewport: BoardViewport;
  cadConfig: CadDraftingConfig;
  cadSession: CadSessionState;
  resolvedCursor: CadResolvedCursor | null;
  toolOptions: ToolOptions;
  layerId: string;
  objects?: CanvasObject[];
  groups?: GroupRecord[];
  selectedIds?: string[];
  livePathArrayDraft?: PathArraySessionOptions | null;
  arrayPickMode?: 'polar-center' | 'path-object' | 'path-base-point' | null;
  boardTheme?: BoardThemeColors;
  stageSize?: { width: number; height: number };
  onTrackingError?: (err: unknown) => void;
}

export const CadWorldOverlay: React.FC<CadWorldOverlayProps> = ({
  viewport,
  cadConfig,
  cadSession,
  resolvedCursor,
  toolOptions,
  layerId,
  objects = [],
  groups = [],
  selectedIds = [],
  livePathArrayDraft = null,
  arrayPickMode = null,
  boardTheme,
  stageSize,
  onTrackingError,
}) => {
  const z = Math.max(0.15, viewport.zoom);
  const invZ = 1 / z;
  const cursorPt = resolvedCursor?.world ?? null;
  const baseWorld = getCadBasePoint(cadSession);

  const showOriginMarker =
    cadConfig.originX !== 0 ||
    cadConfig.originY !== 0 ||
    Boolean(cadSession.activeCommand) ||
    Boolean(cadSession.pickingOrigin);

  const previewCtx = {
    layerId,
    zIndex: 9999,
    toolOptions,
  };

  // Calcula los extremos de guía temporal (ORT / SP / Paralelo / Proporción 1:1)
  const extendedGuideEnd = (() => {
    const g = resolvedCursor?.guide;
    if (!g) return null;
    if (g.kind === 'perpendicular' || g.kind === 'proportion') return g.to;
    const dx = g.to.x - g.from.x;
    const dy = g.to.y - g.from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return g.to;
    const ext = Math.max(len + 360 * invZ, 900 * invZ);
    return {
      x: g.from.x + (dx / len) * ext,
      y: g.from.y + (dy / len) * ext,
    };
  })();

  const previewArcObj = (() => {
    if (cadSession.activeCommand !== 'arc' || !cursorPt) return null;
    if (cadSession.points.length !== 2) return null;
    const [p0, p1] = cadSession.points;
    if (Math.hypot(cursorPt.x - p1.x, cursorPt.y - p1.y) < 2) return null;
    return cadSession.arcMethod === 'center-start-angle'
      ? buildCadArcFromCenterStartEnd(p0, p1, cursorPt, cadConfig, previewCtx)
      : buildCadArcFrom3Points(p0, p1, cursorPt, previewCtx);
  })();

  const previewPolygonObj = (() => {
    if (cadSession.activeCommand !== 'polygon' || !cursorPt) return null;
    if (cadSession.points.length < 1) return null;
    const center = cadSession.points[0];
    const r = Math.hypot(cursorPt.x - center.x, cursorPt.y - center.y);
    if (r < 2) return null;
    return buildCadPolygon(
      center,
      r,
      cadSession.polygonSides,
      cadSession.polygonFit,
      previewCtx
    );
  })();

  // Live dimension preview
  const previewDimensionMetrics = (() => {
    const cmd = cadSession.activeCommand;
    if (!cursorPt || !cmd) return null;
    if (cmd === 'dim-linear' && cadSession.points.length === 2) {
      return computeDimensionMetrics(
        {
          dimKind: 'linear',
          p1: cadSession.points[0],
          p2: cadSession.points[1],
          offsetPt: cursorPt,
          linearAxis: cadSession.linearDimAxis,
          fontSize: 12,
        },
        cadConfig
      );
    }
    if (cmd === 'dim-aligned' && cadSession.points.length === 2) {
      return computeDimensionMetrics(
        {
          dimKind: 'aligned',
          p1: cadSession.points[0],
          p2: cadSession.points[1],
          offsetPt: cursorPt,
          fontSize: 12,
        },
        cadConfig
      );
    }
    if (cmd === 'dim-angular' && cadSession.points.length === 3) {
      return computeDimensionMetrics(
        {
          dimKind: 'angular',
          p1: cadSession.points[0],
          p2: cadSession.points[1],
          p3: cadSession.points[2],
          offsetPt: cursorPt,
          fontSize: 12,
        },
        cadConfig
      );
    }
    if (
      (cmd === 'dim-radial' || cmd === 'dim-diametral') &&
      cadSession.points.length >= 1
    ) {
      const p1 = cadSession.points[0];
      const p2 = cadSession.points[1] ?? cursorPt;
      return computeDimensionMetrics(
        {
          dimKind: cmd === 'dim-radial' ? 'radial' : 'diametral',
          p1,
          p2,
          offsetPt: cursorPt,
          fontSize: 12,
        },
        cadConfig
      );
    }
    if (cmd === 'dim-ordinate' && cadSession.points.length === 1) {
      return computeDimensionMetrics(
        {
          dimKind: 'ordinate',
          p1: cadSession.points[0],
          p2: cadSession.points[0],
          offsetPt: cursorPt,
          ordinateAxis:
            cadSession.linearDimAxis === 'horizontal'
              ? 'x'
              : cadSession.linearDimAxis === 'vertical'
              ? 'y'
              : undefined,
          fontSize: 12,
        },
        cadConfig
      );
    }
    return null;
  })();

  // Live Mirror Axis + Ghost Preview
  const mirrorPreview = (() => {
    if (
      cadSession.activeCommand !== 'mirror' ||
      cadSession.points.length !== 1 ||
      !cursorPt ||
      selectedIds.length === 0
    ) {
      return null;
    }
    const axisA = cadSession.points[0];
    const axisB = cursorPt;
    if (Math.hypot(axisB.x - axisA.x, axisB.y - axisA.y) < 3) {
      return { axisA, axisB, ghosts: [] as CanvasObject[] };
    }
    const selSet = new Set(selectedIds);
    const res = mirrorObjectsAcrossLine(
      selectedIds,
      axisA,
      axisB,
      true,
      objects.filter((o) => selSet.has(o.id)),
      groups,
      layerId,
      9999,
      cadConfig
    );
    const ghostSet = new Set(res.mirroredIds);
    return {
      axisA,
      axisB,
      ghosts: res.objects.filter((o) => ghostSet.has(o.id)),
    };
  })();

  // Previsualización en vivo de Matriz por Camino (MC) durante comando interactivo o modal
  const pathArrayPreview = (() => {
    const activeDraft =
      cadSession.activeCommand === 'array-path'
        ? cadSession.pathArray
        : livePathArrayDraft;
    if (!activeDraft || selectedIds.length === 0) return null;

    const selObjs = objects.filter((o) => selectedIds.includes(o.id));
    if (selObjs.length === 0) return null;

    // Determinar camino elegido o camino bajo el cursor mientras se selecciona
    let pathObj = activeDraft.pathObjectId
      ? objects.find((o) => o.id === activeDraft.pathObjectId) ?? null
      : null;

    const isPickingPath =
      (cadSession.activeCommand === 'array-path' && cadSession.step === 1) ||
      arrayPickMode === 'path-object';

    if (!pathObj && isPickingPath && cursorPt) {
      const nonSelectedPaths = objects.filter(
        (o) => !selectedIds.includes(o.id) && extractWorldPathPoints(o) !== null
      );
      const validPaths = objects.filter((o) => extractWorldPathPoints(o) !== null);
      pathObj =
        findObjectNearWorldPoint(cursorPt, nonSelectedPaths, 24 * invZ) ??
        findObjectNearWorldPoint(cursorPt, validPaths, 24 * invZ) ??
        null;
    }

    const isPickingBase =
      (cadSession.activeCommand === 'array-path' && cadSession.step === 0) ||
      arrayPickMode === 'path-base-point';

    const effectiveMode =
      isPickingBase && activeDraft.basePointMode === 'custom' && cursorPt
        ? 'custom'
        : activeDraft.basePointMode;
    const effectiveCustomBase =
      isPickingBase &&
      (activeDraft.basePointMode === 'custom' || arrayPickMode === 'path-base-point') &&
      cursorPt
        ? cursorPt
        : activeDraft.customBasePointWorld;

    const basePoint = resolvePathArrayBasePoint(
      selObjs,
      pathObj,
      effectiveMode,
      effectiveCustomBase
    );

    const pathData = pathObj ? extractWorldPathPoints(pathObj) : null;
    if (!pathObj || !pathData) {
      return {
        basePoint,
        pathPts: null as Point2D[] | null,
        ghosts: [] as CanvasObject[],
      };
    }

    const res = generatePathArray(
      selObjs,
      groups,
      pathObj,
      {
        mode: activeDraft.mode,
        count: activeDraft.count,
        spacingWorld: activeDraft.spacingWorld,
        alignToPath: activeDraft.alignToPath,
        basePointMode: effectiveMode,
        basePointWorld: effectiveCustomBase,
        includeOriginalAtStart: activeDraft.includeOriginalAtStart,
      },
      cadConfig,
      layerId,
      9999
    );

    return {
      basePoint: res.basePointUsed ?? basePoint,
      pathPts: pathData.pts,
      ghosts: res.addObjects,
    };
  })();

  const renderGhostObjectSvg = (g: CanvasObject, idx: number) => {
    const strokeCol = '#7c3aed';
    const sw = Math.max(1.2 * invZ, 1.4);

    if (g.type === 'line') {
      const lineObj = g as LineObject;
      const seg = getLineWorldSegments(lineObj);
      if (seg.pts.length >= 2) {
        return (
          <polyline
            key={`${g.id}-${idx}`}
            points={seg.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={strokeCol}
            strokeWidth={Math.max(lineObj.strokeWidth, sw)}
            strokeDasharray={`${5 * invZ} ${3 * invZ}`}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.78}
          />
        );
      }
    }

    if (g.type === 'shape') {
      const shapeObj = g as ShapeObject;
      const cx = shapeObj.x + shapeObj.width / 2;
      const cy = shapeObj.y + shapeObj.height / 2;
      return (
        <g
          key={`${g.id}-${idx}`}
          transform={`translate(${shapeObj.x}, ${shapeObj.y})${
            shapeObj.rotation ? ` rotate(${shapeObj.rotation} ${shapeObj.width / 2} ${shapeObj.height / 2})` : ''
          }`}
          opacity={0.75}
        >
          {renderShapeSvgElement(shapeObj.shapeKind, shapeObj.width, shapeObj.height, {
            strokeColor: strokeCol,
            fillColor: 'rgba(124, 58, 237, 0.08)',
            strokeWidth: Math.max(shapeObj.strokeWidth, sw),
            strokeStyle: 'dashed',
            polygonSides: shapeObj.polygonSides,
            arcStartAngle: shapeObj.arcStartAngle,
            arcEndAngle: shapeObj.arcEndAngle,
            customPoints: shapeObj.customPoints,
            customVertices: shapeObj.customVertices,
            flipX: shapeObj.flipX,
            flipY: shapeObj.flipY,
          })}
          {/* Referencia sutil de centro en rotación */}
          {false && cx + cy}
        </g>
      );
    }

    if (g.type === 'stroke') {
      const st = g as StrokeObject;
      if (st.points.length >= 2) {
        return (
          <polyline
            key={`${g.id}-${idx}`}
            points={st.points
              .map((p) => `${(st.x + p.x).toFixed(1)},${(st.y + p.y).toFixed(1)}`)
              .join(' ')}
            fill="none"
            stroke={strokeCol}
            strokeWidth={Math.max(st.strokeWidth, sw)}
            strokeDasharray={`${5 * invZ} ${3 * invZ}`}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.75}
          />
        );
      }
    }

    return (
      <rect
        key={`${g.id}-${idx}`}
        x={g.x}
        y={g.y}
        width={Math.max(4, g.width)}
        height={Math.max(4, g.height)}
        transform={
          g.rotation
            ? `rotate(${g.rotation} ${g.x + g.width / 2} ${g.y + g.height / 2})`
            : undefined
        }
        fill="rgba(124, 58, 237, 0.08)"
        stroke={strokeCol}
        strokeWidth={sw}
        strokeDasharray={`${4 * invZ} ${3 * invZ}`}
      />
    );
  };

  // Renderizado protegido del rastreo de referencia (líneas guía, marcadores +, etiquetas e intersección X)
  const trackingSvgLayer = (() => {
    const trk = resolvedCursor?.tracking;
    if (!trk) return null;
    if (
      trk.acquiredPoints.length === 0 &&
      trk.activeGuides.length === 0 &&
      !trk.intersectionPoint
    ) {
      return null;
    }
    try {
      const palette = getTrackingVisualPalette(boardTheme ?? FALLBACK_BOARD_THEME);
      const vw = stageSize?.width ?? 1600;
      const vh = stageSize?.height ?? 1000;
      const padWorld = 120 * invZ;
      const minX = -viewport.panX / z - padWorld;
      const maxX = (vw - viewport.panX) / z + padWorld;
      const minY = -viewport.panY / z - padWorld;
      const maxY = (vh - viewport.panY) / z + padWorld;
      const snapTarget = trk.snappedPoint ?? cursorPt;

      return (
        <g data-export-ignore="true">
          {/* Líneas guía punteadas de proyección en todo el área visible */}
          {trk.activeGuides.map((guide) => {
            const clipped = clipLineToRect(guide.origin, guide.dir, minX, minY, maxX, maxY);
            const pA = clipped ? clipped[0] : guide.origin;
            const pB =
              clipped?.[1] ?? {
                x: guide.origin.x + guide.dir.x * 1600 * invZ,
                y: guide.origin.y + guide.dir.y * 1600 * invZ,
              };

            const endPt = snapTarget ?? {
              x: guide.origin.x + guide.dir.x * Math.max(40 * invZ, guide.distanceWorld),
              y: guide.origin.y + guide.dir.y * Math.max(40 * invZ, guide.distanceWorld),
            };
            const midX = (guide.origin.x + endPt.x) / 2;
            const midY = (guide.origin.y + endPt.y) / 2;
            const perpX = -guide.dir.y;
            const perpY = guide.dir.x;
            const labelX = midX + perpX * 14 * invZ;
            const labelY = midY + perpY * 14 * invZ;
            const textLen = Math.max(38, guide.label.length * 6.5 + 12);

            return (
              <g key={guide.key}>
                <line
                  x1={pA.x}
                  y1={pA.y}
                  x2={pB.x}
                  y2={pB.y}
                  stroke={palette.haloStroke}
                  strokeWidth={2.4 * invZ}
                  strokeDasharray={`${5 * invZ} ${4 * invZ}`}
                  strokeLinecap="round"
                  opacity={0.55}
                />
                <line
                  x1={pA.x}
                  y1={pA.y}
                  x2={pB.x}
                  y2={pB.y}
                  stroke={palette.guideStroke}
                  strokeWidth={1.3 * invZ}
                  strokeDasharray={`${5 * invZ} ${4 * invZ}`}
                  strokeLinecap="round"
                />
                {guide.distanceWorld > 0.5 && (
                  <g transform={`translate(${labelX}, ${labelY}) scale(${invZ})`}>
                    <rect
                      x={-textLen / 2}
                      y={-10}
                      width={textLen}
                      height={20}
                      rx={4}
                      fill={palette.badgeBg}
                      stroke={palette.badgeBorder}
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fill={palette.badgeText}
                      fontSize={10.5}
                      fontWeight={600}
                      fontFamily="var(--font-mono)"
                    >
                      {guide.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Puntos adquiridos marcados con + */}
          {trk.acquiredPoints.map((pt) => {
            const arm = 5.5 * invZ;
            return (
              <g key={pt.id}>
                <line
                  x1={pt.point.x - arm}
                  y1={pt.point.y}
                  x2={pt.point.x + arm}
                  y2={pt.point.y}
                  stroke={palette.haloStroke}
                  strokeWidth={3.2 * invZ}
                  strokeLinecap="round"
                />
                <line
                  x1={pt.point.x}
                  y1={pt.point.y - arm}
                  x2={pt.point.x}
                  y2={pt.point.y + arm}
                  stroke={palette.haloStroke}
                  strokeWidth={3.2 * invZ}
                  strokeLinecap="round"
                />
                <line
                  x1={pt.point.x - arm}
                  y1={pt.point.y}
                  x2={pt.point.x + arm}
                  y2={pt.point.y}
                  stroke={palette.acquiredPlusStroke}
                  strokeWidth={1.7 * invZ}
                  strokeLinecap="round"
                />
                <line
                  x1={pt.point.x}
                  y1={pt.point.y - arm}
                  x2={pt.point.x}
                  y2={pt.point.y + arm}
                  stroke={palette.acquiredPlusStroke}
                  strokeWidth={1.7 * invZ}
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {/* Intersección simultánea de 2 guías marcada con X */}
          {trk.intersectionPoint && (() => {
            const ix = trk.intersectionPoint.x;
            const iy = trk.intersectionPoint.y;
            const arm = 6.5 * invZ;
            return (
              <g>
                <line
                  x1={ix - arm}
                  y1={iy - arm}
                  x2={ix + arm}
                  y2={iy + arm}
                  stroke={palette.haloStroke}
                  strokeWidth={3.6 * invZ}
                  strokeLinecap="round"
                />
                <line
                  x1={ix - arm}
                  y1={iy + arm}
                  x2={ix + arm}
                  y2={iy - arm}
                  stroke={palette.haloStroke}
                  strokeWidth={3.6 * invZ}
                  strokeLinecap="round"
                />
                <line
                  x1={ix - arm}
                  y1={iy - arm}
                  x2={ix + arm}
                  y2={iy + arm}
                  stroke={palette.intersectionStroke}
                  strokeWidth={2 * invZ}
                  strokeLinecap="round"
                />
                <line
                  x1={ix - arm}
                  y1={iy + arm}
                  x2={ix + arm}
                  y2={iy - arm}
                  stroke={palette.intersectionStroke}
                  strokeWidth={2 * invZ}
                  strokeLinecap="round"
                />
              </g>
            );
          })()}
        </g>
      );
    } catch (err) {
      console.error('[Ábaco] Error al dibujar líneas guía de rastreo:', err);
      onTrackingError?.(err);
      return null;
    }
  })();

  return (
    <svg
      data-export-ignore="true"
      shapeRendering="geometricPrecision"
      style={{ zIndex: 5000 }}
      className="overflow-visible pointer-events-none absolute top-0 left-0"
      width={1}
      height={1}
    >
      {/* Reference Origin Icon */}
      {showOriginMarker && (
        <g opacity={0.9}>
          <line
            x1={cadConfig.originX}
            y1={cadConfig.originY}
            x2={cadConfig.originX + 32 * invZ}
            y2={cadConfig.originY}
            stroke="#ef4444"
            strokeWidth={1.8 * invZ}
          />
          <polygon
            points={`${cadConfig.originX + 36 * invZ},${cadConfig.originY} ${cadConfig.originX + 29 * invZ},${cadConfig.originY - 3 * invZ} ${cadConfig.originX + 29 * invZ},${cadConfig.originY + 3 * invZ}`}
            fill="#ef4444"
          />
          <line
            x1={cadConfig.originX}
            y1={cadConfig.originY}
            x2={cadConfig.originX}
            y2={cadConfig.originY + (cadConfig.yAxisUp ? -32 * invZ : 32 * invZ)}
            stroke="#22c55e"
            strokeWidth={1.8 * invZ}
          />
          <polygon
            points={
              cadConfig.yAxisUp
                ? `${cadConfig.originX},${cadConfig.originY - 36 * invZ} ${cadConfig.originX - 3 * invZ},${cadConfig.originY - 29 * invZ} ${cadConfig.originX + 3 * invZ},${cadConfig.originY - 29 * invZ}`
                : `${cadConfig.originX},${cadConfig.originY + 36 * invZ} ${cadConfig.originX - 3 * invZ},${cadConfig.originY + 29 * invZ} ${cadConfig.originX + 3 * invZ},${cadConfig.originY + 29 * invZ}`
            }
            fill="#22c55e"
          />
          <circle
            cx={cadConfig.originX}
            cy={cadConfig.originY}
            r={3.5 * invZ}
            fill="none"
            stroke="#0284c7"
            strokeWidth={1.4 * invZ}
          />
        </g>
      )}

      {trackingSvgLayer}

      {/* Guía temporal única (ORT / SP 45° / Paralelo / Proporción 1:1) */}
      {resolvedCursor?.guide && extendedGuideEnd && (
        <g>
          {resolvedCursor.guide.refSegment && (
            <line
              x1={resolvedCursor.guide.refSegment[0].x}
              y1={resolvedCursor.guide.refSegment[0].y}
              x2={resolvedCursor.guide.refSegment[1].x}
              y2={resolvedCursor.guide.refSegment[1].y}
              stroke="#0ea5e9"
              strokeWidth={3 * invZ}
              strokeOpacity={0.5}
              strokeLinecap="round"
            />
          )}
          <line
            x1={resolvedCursor.guide.from.x}
            y1={resolvedCursor.guide.from.y}
            x2={extendedGuideEnd.x}
            y2={extendedGuideEnd.y}
            stroke={
              resolvedCursor.guide.kind === 'ortho' ||
              resolvedCursor.guide.kind === 'proportion'
                ? '#0ea5e9'
                : resolvedCursor.guide.kind === 'polar'
                ? '#10b981'
                : '#8b5cf6'
            }
            strokeWidth={1.3 * invZ}
            strokeDasharray={`${6 * invZ} ${4 * invZ}`}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Active Drawing Command Dynamic Previews */}
      {cadSession.activeCommand === 'line' &&
        cadSession.points.length >= 1 &&
        cursorPt && (
          <g>
            <line
              x1={cadSession.points[cadSession.points.length - 1].x}
              y1={cadSession.points[cadSession.points.length - 1].y}
              x2={cursorPt.x}
              y2={cursorPt.y}
              stroke={toolOptions.shapeStrokeColor}
              strokeWidth={toolOptions.shapeStrokeWidth}
              strokeDasharray={`${6 * invZ} ${4 * invZ}`}
              strokeOpacity={0.85}
            />
          </g>
        )}

      {cadSession.activeCommand === 'pline' && cadSession.points.length >= 1 && (
        <g>
          <polyline
            points={[...cadSession.points, ...(cursorPt ? [cursorPt] : [])]
              .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(' ')}
            fill="none"
            stroke={toolOptions.shapeStrokeColor}
            strokeWidth={toolOptions.shapeStrokeWidth}
            strokeDasharray={`${6 * invZ} ${4 * invZ}`}
            strokeLinejoin="round"
          />
        </g>
      )}

      {cadSession.activeCommand === 'rectangle' &&
        cadSession.points.length >= 1 &&
        cursorPt && (() => {
          const c1 = cadSession.points[0];
          const w =
            cadSession.rectMethod === 'dimensions' &&
            cadSession.rectWidthWorld !== undefined
              ? Math.abs(cadSession.rectWidthWorld)
              : Math.abs(cursorPt.x - c1.x);
          const x =
            cadSession.rectMethod === 'dimensions' &&
            cadSession.rectWidthWorld !== undefined
              ? cadSession.rectWidthWorld >= 0
                ? c1.x
                : c1.x + cadSession.rectWidthWorld
              : Math.min(c1.x, cursorPt.x);
          const y = Math.min(c1.y, cursorPt.y);
          const h = Math.abs(cursorPt.y - c1.y);
          return (
            <rect
              x={x}
              y={y}
              width={Math.max(1, w)}
              height={Math.max(1, h)}
              fill="rgba(37, 99, 235, 0.06)"
              stroke={toolOptions.shapeStrokeColor}
              strokeWidth={toolOptions.shapeStrokeWidth}
              strokeDasharray={`${6 * invZ} ${4 * invZ}`}
            />
          );
        })()}

      {cadSession.activeCommand === 'circle' &&
        cadSession.points.length >= 1 &&
        cursorPt && (() => {
          const center = cadSession.points[0];
          const r = Math.hypot(cursorPt.x - center.x, cursorPt.y - center.y);
          return (
            <g>
              <line
                x1={center.x}
                y1={center.y}
                x2={cursorPt.x}
                y2={cursorPt.y}
                stroke="#0284c7"
                strokeWidth={1.3 * invZ}
                strokeDasharray={`${4 * invZ} ${3 * invZ}`}
              />
              <circle
                cx={center.x}
                cy={center.y}
                r={Math.max(1, r)}
                fill="rgba(37, 99, 235, 0.05)"
                stroke={toolOptions.shapeStrokeColor}
                strokeWidth={toolOptions.shapeStrokeWidth}
                strokeDasharray={`${6 * invZ} ${4 * invZ}`}
              />
            </g>
          );
        })()}

      {cadSession.activeCommand === 'arc' && cadSession.points.length >= 1 && cursorPt && (
        <g>
          {cadSession.points.length === 1 && (
            <line
              x1={cadSession.points[0].x}
              y1={cadSession.points[0].y}
              x2={cursorPt.x}
              y2={cursorPt.y}
              stroke="#0284c7"
              strokeWidth={1.4 * invZ}
              strokeDasharray={`${5 * invZ} ${4 * invZ}`}
            />
          )}
          {cadSession.points.length === 2 && previewArcObj && (
            <g transform={`translate(${previewArcObj.x}, ${previewArcObj.y})`} opacity={0.85}>
              {renderShapeSvgElement('arc', previewArcObj.width, previewArcObj.height, {
                strokeColor: toolOptions.shapeStrokeColor,
                fillColor: 'transparent',
                strokeWidth: toolOptions.shapeStrokeWidth,
                strokeStyle: 'dashed',
                arcStartAngle: previewArcObj.arcStartAngle,
                arcEndAngle: previewArcObj.arcEndAngle,
              })}
            </g>
          )}
          {cadSession.points.length === 2 && !previewArcObj && (
            <polyline
              points={`${cadSession.points[0].x},${cadSession.points[0].y} ${cadSession.points[1].x},${cadSession.points[1].y} ${cursorPt.x},${cursorPt.y}`}
              fill="none"
              stroke="#0284c7"
              strokeWidth={1.4 * invZ}
              strokeDasharray={`${5 * invZ} ${4 * invZ}`}
            />
          )}
        </g>
      )}

      {cadSession.activeCommand === 'polygon' &&
        cadSession.points.length >= 1 &&
        cursorPt && (
          <g>
            <line
              x1={cadSession.points[0].x}
              y1={cadSession.points[0].y}
              x2={cursorPt.x}
              y2={cursorPt.y}
              stroke="#0284c7"
              strokeWidth={1.3 * invZ}
              strokeDasharray={`${4 * invZ} ${3 * invZ}`}
            />
            {previewPolygonObj && (
              <g
                transform={`translate(${previewPolygonObj.x}, ${previewPolygonObj.y})`}
                opacity={0.85}
              >
                {renderShapeSvgElement(
                  'polygon',
                  previewPolygonObj.width,
                  previewPolygonObj.height,
                  {
                    strokeColor: toolOptions.shapeStrokeColor,
                    fillColor: 'rgba(37, 99, 235, 0.05)',
                    strokeWidth: toolOptions.shapeStrokeWidth,
                    strokeStyle: 'dashed',
                    polygonSides: previewPolygonObj.polygonSides,
                  }
                )}
              </g>
            )}
          </g>
        )}

      {/* Dimension rubber-band guides & preview */}
      {(cadSession.activeCommand === 'dim-linear' ||
        cadSession.activeCommand === 'dim-aligned') &&
        cadSession.points.length === 1 &&
        cursorPt && (
          <line
            x1={cadSession.points[0].x}
            y1={cadSession.points[0].y}
            x2={cursorPt.x}
            y2={cursorPt.y}
            stroke="#0284c7"
            strokeWidth={1.4 * invZ}
            strokeDasharray={`${5 * invZ} ${4 * invZ}`}
          />
        )}

      {cadSession.activeCommand === 'dim-angular' &&
        cadSession.points.length >= 1 &&
        cadSession.points.length <= 2 &&
        cursorPt && (
          <g stroke="#0284c7" strokeWidth={1.4 * invZ} strokeDasharray={`${5 * invZ} ${4 * invZ}`}>
            {cadSession.points.length >= 2 && (
              <line
                x1={cadSession.points[0].x}
                y1={cadSession.points[0].y}
                x2={cadSession.points[1].x}
                y2={cadSession.points[1].y}
              />
            )}
            <line
              x1={cadSession.points[0].x}
              y1={cadSession.points[0].y}
              x2={cursorPt.x}
              y2={cursorPt.y}
            />
          </g>
        )}

      {previewDimensionMetrics && (
        <g opacity={0.9}>
          <DimensionSvgContent
            metrics={previewDimensionMetrics}
            strokeColor={toolOptions.shapeStrokeColor || '#0284c7'}
            fontSize={12}
            strokeWidth={1.4 * invZ}
            dashedPreview
          />
        </g>
      )}

      {/* Mirror reflection axis + ghost shapes */}
      {mirrorPreview && (
        <g>
          <line
            x1={mirrorPreview.axisA.x}
            y1={mirrorPreview.axisA.y}
            x2={mirrorPreview.axisB.x}
            y2={mirrorPreview.axisB.y}
            stroke="#8b5cf6"
            strokeWidth={2 * invZ}
            strokeDasharray={`${7 * invZ} ${4 * invZ}`}
          />
          {mirrorPreview.ghosts.map((g) => (
            <rect
              key={g.id}
              x={g.x}
              y={g.y}
              width={Math.max(4, g.width)}
              height={Math.max(4, g.height)}
              transform={
                g.rotation
                  ? `rotate(${g.rotation} ${g.x + g.width / 2} ${g.y + g.height / 2})`
                  : undefined
              }
              fill="rgba(139, 92, 246, 0.08)"
              stroke="#8b5cf6"
              strokeWidth={1.4 * invZ}
              strokeDasharray={`${4 * invZ} ${3 * invZ}`}
            />
          ))}
        </g>
      )}

      {/* Previsualización en vivo de Matriz por Camino (MC) */}
      {pathArrayPreview && (
        <g>
          {pathArrayPreview.pathPts && pathArrayPreview.pathPts.length >= 2 && (
            <polyline
              points={pathArrayPreview.pathPts
                .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(' ')}
              fill="none"
              stroke="#0ea5e9"
              strokeWidth={3.2 * invZ}
              strokeOpacity={0.45}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {pathArrayPreview.ghosts.map((g, idx) => renderGhostObjectSvg(g, idx))}
          {pathArrayPreview.basePoint && (
            <g>
              <circle
                cx={pathArrayPreview.basePoint.x}
                cy={pathArrayPreview.basePoint.y}
                r={6 * invZ}
                fill="#f59e0b"
                fillOpacity={0.22}
                stroke="#f59e0b"
                strokeWidth={2 * invZ}
              />
              <line
                x1={pathArrayPreview.basePoint.x - 9 * invZ}
                y1={pathArrayPreview.basePoint.y}
                x2={pathArrayPreview.basePoint.x + 9 * invZ}
                y2={pathArrayPreview.basePoint.y}
                stroke="#d97706"
                strokeWidth={1.6 * invZ}
              />
              <line
                x1={pathArrayPreview.basePoint.x}
                y1={pathArrayPreview.basePoint.y - 9 * invZ}
                x2={pathArrayPreview.basePoint.x}
                y2={pathArrayPreview.basePoint.y + 9 * invZ}
                stroke="#d97706"
                strokeWidth={1.6 * invZ}
              />
            </g>
          )}
        </g>
      )}

      {/* Match-points displacement preview arrow */}
      {cadSession.activeCommand === 'match-points' &&
        cadSession.points.length === 1 &&
        cursorPt && (() => {
          const p1 = cadSession.points[0];
          const from = cadSession.matchKeepFirstFixed ? cursorPt : p1;
          const to = cadSession.matchKeepFirstFixed ? p1 : cursorPt;
          return (
            <g>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#10b981"
                strokeWidth={2 * invZ}
                strokeDasharray={`${6 * invZ} ${3 * invZ}`}
              />
              <circle
                cx={to.x}
                cy={to.y}
                r={5 * invZ}
                fill="none"
                stroke="#10b981"
                strokeWidth={1.8 * invZ}
              />
            </g>
          );
        })()}

      {/* Picked anchor points */}
      {cadSession.points.map((pt, i) => (
        <circle
          key={i}
          cx={pt.x}
          cy={pt.y}
          r={4 * invZ}
          fill="#2563eb"
          stroke="#ffffff"
          strokeWidth={1.5 * invZ}
        />
      ))}

      {/* Base point radial helper */}
      {baseWorld &&
        cursorPt &&
        cadSession.activeCommand === 'arc' &&
        cadSession.arcMethod === 'center-start-angle' &&
        cadSession.points.length === 2 && (
          <line
            x1={cadSession.points[0].x}
            y1={cadSession.points[0].y}
            x2={cursorPt.x}
            y2={cursorPt.y}
            stroke="#94a3b8"
            strokeWidth={1.1 * invZ}
            strokeDasharray={`${3 * invZ} ${3 * invZ}`}
          />
        )}

      {/* RG (Referencias geométricas) Marker Symbol */}
      {resolvedCursor?.snap && (() => {
        const { point, kind } = resolvedCursor.snap;
        const r = 6 * invZ;
        const sw = 2 * invZ;
        const haloSw = 3.4 * invZ;
        if (kind === 'endpoint') {
          return (
            <g>
              <rect
                x={point.x - r}
                y={point.y - r}
                width={r * 2}
                height={r * 2}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.85}
                strokeWidth={haloSw}
              />
              <rect
                x={point.x - r}
                y={point.y - r}
                width={r * 2}
                height={r * 2}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={sw}
              />
            </g>
          );
        }
        if (kind === 'midpoint') {
          return (
            <polygon
              points={`${point.x},${point.y - r * 1.15} ${point.x + r},${point.y + r * 0.85} ${point.x - r},${point.y + r * 0.85}`}
              fill="none"
              stroke="#10b981"
              strokeWidth={sw}
            />
          );
        }
        if (kind === 'center') {
          return (
            <g>
              <circle
                cx={point.x}
                cy={point.y}
                r={r * 1.1}
                fill="none"
                stroke="#06b6d4"
                strokeWidth={sw}
              />
              <circle cx={point.x} cy={point.y} r={1.8 * invZ} fill="#06b6d4" />
            </g>
          );
        }
        if (kind === 'quadrant') {
          return (
            <polygon
              points={`${point.x},${point.y - r * 1.25} ${point.x + r * 1.25},${point.y} ${point.x},${point.y + r * 1.25} ${point.x - r * 1.25},${point.y}`}
              fill="none"
              stroke="#ec4899"
              strokeWidth={sw}
            />
          );
        }
        if (kind === 'intersection') {
          return (
            <g stroke="#ef4444" strokeWidth={sw} strokeLinecap="round">
              <line x1={point.x - r} y1={point.y - r} x2={point.x + r} y2={point.y + r} />
              <line x1={point.x - r} y1={point.y + r} x2={point.x + r} y2={point.y - r} />
            </g>
          );
        }
        if (kind === 'perpendicular') {
          return (
            <g stroke="#8b5cf6" strokeWidth={sw} fill="none">
              <polyline
                points={`${point.x - r},${point.y - r * 0.4} ${point.x - r},${point.y + r * 0.6} ${point.x + r},${point.y + r * 0.6}`}
              />
              <polyline
                points={`${point.x - r},${point.y} ${point.x},${point.y} ${point.x},${point.y + r * 0.6}`}
              />
            </g>
          );
        }
        if (kind === 'parallel') {
          return (
            <g stroke="#0ea5e9" strokeWidth={sw} strokeLinecap="round">
              <line
                x1={point.x - r * 0.7}
                y1={point.y + r}
                x2={point.x + r * 0.1}
                y2={point.y - r}
              />
              <line
                x1={point.x + r * 0.1}
                y1={point.y + r}
                x2={point.x + r * 0.9}
                y2={point.y - r}
              />
            </g>
          );
        }
        return null;
      })()}
    </svg>
  );
};

interface CadDynamicHudProps {
  viewport: BoardViewport;
  stageSize: { width: number; height: number };
  cadConfig: CadDraftingConfig;
  cadSession: CadSessionState;
  resolvedCursor: CadResolvedCursor | null;
  dragBaseWorld: Point2D | null;
}

export const CadDynamicHud: React.FC<CadDynamicHudProps> = ({
  viewport,
  stageSize,
  cadConfig,
  cadSession,
  resolvedCursor,
  dragBaseWorld,
}) => {
  if (!cadConfig.dynInput || !resolvedCursor) return null;

  const isDrafting =
    Boolean(cadSession.activeCommand) ||
    Boolean(cadSession.pickingOrigin) ||
    Boolean(dragBaseWorld);

  if (!isDrafting) return null;

  const base = getCadBasePoint(cadSession) ?? dragBaseWorld;
  const unit = getUnitShortLabel(cadConfig.unit);

  const sx = resolvedCursor.world.x * viewport.zoom + viewport.panX;
  const sy = resolvedCursor.world.y * viewport.zoom + viewport.panY;

  const left = Math.max(8, Math.min(stageSize.width - 195, sx + 16));
  const top = Math.max(8, Math.min(stageSize.height - 64, sy + 16));

  const seg = base
    ? getSegmentSummary(base, resolvedCursor.world, cadConfig)
    : null;

  return (
    <div
      data-export-ignore="true"
      style={{ left, top }}
      className="pointer-events-none absolute z-30 px-2 py-1 rounded-md bg-slate-900/92 text-slate-50 border border-slate-700/90 shadow-lg text-[10px] font-mono-tabular leading-tight space-y-0.5 whitespace-nowrap"
    >
      <div className="flex items-center gap-2">
        <span>
          X: {formatCadNumber(resolvedCursor.cad.x, cadConfig.decimals)}
        </span>
        <span>
          Y: {formatCadNumber(resolvedCursor.cad.y, cadConfig.decimals)}
        </span>
        <span className="text-slate-400">{unit}</span>
      </div>

      {seg && seg.distWorld > 0.5 && (
        <div className="flex items-center gap-2 text-sky-300">
          <span>
            {cadSession.activeCommand === 'circle' || cadSession.activeCommand === 'polygon'
              ? 'R: '
              : 'D: '}
            {formatCadDist(seg.distWorld, cadConfig)} {unit}
          </span>
          <span>∠ {formatCadNumber(seg.cadAngleDeg, 1)}°</span>
        </div>
      )}

      {(resolvedCursor.snap ||
        resolvedCursor.guide ||
        (resolvedCursor.tracking && resolvedCursor.tracking.activeGuides.length > 0)) && (
        <div className="text-amber-300 font-sans font-medium">
          {resolvedCursor.snap?.label ||
            (resolvedCursor.tracking?.intersectionPoint
              ? 'Intersección de guías'
              : resolvedCursor.tracking?.activeGuides[0]?.label) ||
            resolvedCursor.guide?.label}
        </div>
      )}
    </div>
  );
};
