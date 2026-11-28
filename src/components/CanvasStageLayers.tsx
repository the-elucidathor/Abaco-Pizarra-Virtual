// OPT: 1.5, 2.2, 2.5, 2.6 — Capas memorizadas e independientes para fondo y objetos estáticos del lienzo
import React from 'react';
import type {
  Board,
  CanvasObject,
  DimensionObject,
  DocumentObject,
  EquationObject,
  GraphObject,
  LineObject,
  Point2D,
  ShapeObject,
  SpellcheckLanguage,
  StickyObject,
  TableObject,
  TextObject,
} from '../types/whiteboard';
import { type CadDraftingConfig, DEFAULT_CAD_CONFIG } from '../types/cad';
import { getCachedDimensionMetrics } from '../utils/cad/cadHitTest';
import { DimensionSvgContent } from '../utils/cad/cadDimensionsSvg';
import {
  getInitialEditCursor,
  type MathCursor,
  type MathSelectionRange,
} from '../utils/latexEditorEngine';
import { getTextFontCss } from '../utils/textFonts';
import { isOptEnabled } from '../utils/optFlags';
import {
  type SelectionStyleSummary,
  getDefaultRunStyle,
  normalizarContenidoTexto,
  normalizeTextAlign,
  resolveTextWidthMode,
  syncTextObjectFromParagraphs,
} from '../utils/richText';
import { renderShapeSvgElement } from '../utils/shapeRenderer';
import { getRememberedTextLang } from '../utils/spellcheck/personalDictionary';
import { getStrokeSvgPath } from '../utils/strokePathCache';
import type { TableCellCoord } from '../utils/tableUtils';
import { adaptStrokeColorForCanvasBg } from '../utils/themePalette';
import {
  type ActiveInlineEquationSession,
  type InlineEquationRequest,
  RichTextEditor,
  type RichTextEditorHandle,
  RichTextViewer,
  TEXT_AUTO_MAX_WIDTH,
} from './RichTextEditor';
import { TextObjectErrorBoundary } from './TextObjectErrorBoundary';
import { DocumentNodeView } from './nodes/DocumentNodeView';
import { EquationNodeView } from './nodes/EquationNodeView';
import { GraphNodeView } from './nodes/GraphNodeView';
import { TableErrorBoundary, TableNodeView } from './nodes/TableNodeView';

const DEFAULT_EQ_CURSOR: MathCursor = { path: [], offset: 0 };

export interface InfiniteBoardBgLayerProps {
  hasFixedPage: boolean;
  backgroundPattern: Board['backgroundPattern'];
  showCoordinates: boolean;
  patternId: string;
  gSize: number;
  panX: number;
  panY: number;
  zoom: number;
  gridStroke: string;
  linedStroke: string;
  dotFill: string;
  axisStroke: string;
  axisText: string;
}

// OPT: 2.2 — Capa de fondo infinito aislada en React.memo
export const InfiniteBoardBgLayer = React.memo<InfiniteBoardBgLayerProps>(
  ({
    hasFixedPage,
    backgroundPattern,
    showCoordinates,
    patternId,
    gSize,
    panX,
    panY,
    zoom,
    gridStroke,
    linedStroke,
    dotFill,
    axisStroke,
    axisText,
  }) => {
    if (hasFixedPage) return null;
    return (
      <>
        {backgroundPattern !== 'blank' && (
          <svg
            data-board-background="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <defs>
              {backgroundPattern === 'grid' && (
                <pattern
                  id={patternId}
                  width={gSize * zoom}
                  height={gSize * zoom}
                  patternUnits="userSpaceOnUse"
                  x={panX}
                  y={panY}
                >
                  <path
                    data-export-role="grid-stroke"
                    d={`M ${gSize * zoom} 0 L 0 0 0 ${gSize * zoom}`}
                    fill="none"
                    stroke={gridStroke}
                    strokeWidth={1}
                  />
                </pattern>
              )}
              {backgroundPattern === 'lined' && (
                <pattern
                  id={patternId}
                  width={gSize * zoom}
                  height={gSize * zoom}
                  patternUnits="userSpaceOnUse"
                  x={panX}
                  y={panY}
                >
                  <line
                    data-export-role="lined-stroke"
                    x1={0}
                    y1={gSize * zoom}
                    x2={gSize * zoom}
                    y2={gSize * zoom}
                    stroke={linedStroke}
                    strokeWidth={1}
                  />
                </pattern>
              )}
              {backgroundPattern === 'dotted' && (
                <pattern
                  id={patternId}
                  width={gSize * zoom}
                  height={gSize * zoom}
                  patternUnits="userSpaceOnUse"
                  x={panX}
                  y={panY}
                >
                  <circle
                    data-export-role="dot-fill"
                    cx={1.5}
                    cy={1.5}
                    r={gSize <= 12 ? 0.95 : 1.25}
                    fill={dotFill}
                  />
                </pattern>
              )}
              {backgroundPattern === 'isometric' && (
                <pattern
                  id={patternId}
                  width={gSize * zoom * 1.732}
                  height={gSize * zoom}
                  patternUnits="userSpaceOnUse"
                  x={panX}
                  y={panY}
                >
                  <path
                    data-export-role="grid-stroke"
                    d={`M 0 0 L ${gSize * zoom * 1.732} ${gSize * zoom} M ${gSize * zoom * 1.732} 0 L 0 ${gSize * zoom} M ${(gSize * zoom * 1.732) / 2} 0 L ${(gSize * zoom * 1.732) / 2} ${gSize * zoom}`}
                    fill="none"
                    stroke={gridStroke}
                    strokeWidth={0.85}
                  />
                </pattern>
              )}
            </defs>
            <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          </svg>
        )}

        {showCoordinates && (
          <svg
            data-board-background="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {/* V1.11.8-15: Marcas de escala sincronizadas con gSize mediante patrones SVG sin sobrecarga DOM */}
            <defs>
              <pattern
                id={`${patternId}-axis-ticks-x`}
                x={panX}
                y={panY - 4}
                width={Math.max(4, gSize * zoom)}
                height={8}
                patternUnits="userSpaceOnUse"
              >
                <line x1={0} y1={0} x2={0} y2={8} stroke={axisStroke} strokeWidth={1} />
              </pattern>
              <pattern
                id={`${patternId}-axis-ticks-y`}
                x={panX - 4}
                y={panY}
                width={8}
                height={Math.max(4, gSize * zoom)}
                patternUnits="userSpaceOnUse"
              >
                <line x1={0} y1={0} x2={8} y2={0} stroke={axisStroke} strokeWidth={1} />
              </pattern>
            </defs>
            <line
              data-export-role="axis-stroke"
              x1={0}
              y1={panY}
              x2="100%"
              y2={panY}
              stroke={axisStroke}
              strokeWidth={1.2}
            />
            <rect
              x={0}
              y={panY - 4}
              width="100%"
              height={8}
              fill={`url(#${patternId}-axis-ticks-x)`}
            />
            <line
              data-export-role="axis-stroke"
              x1={panX}
              y1={0}
              x2={panX}
              y2="100%"
              stroke={axisStroke}
              strokeWidth={1.2}
            />
            <rect
              x={panX - 4}
              y={0}
              width={8}
              height="100%"
              fill={`url(#${patternId}-axis-ticks-y)`}
            />
            <text
              data-export-role="axis-text"
              x={panX + 6}
              y={panY - 6}
              fill={axisText}
              fontSize={10}
              fontFamily="var(--font-mono)"
            >
              (0,0)
            </text>
          </svg>
        )}
      </>
    );
  },
  (prev, next) => {
    if (!isOptEnabled('layeredRender')) return false;
    return (
      prev.hasFixedPage === next.hasFixedPage &&
      prev.backgroundPattern === next.backgroundPattern &&
      prev.showCoordinates === next.showCoordinates &&
      prev.patternId === next.patternId &&
      prev.gSize === next.gSize &&
      prev.panX === next.panX &&
      prev.panY === next.panY &&
      prev.zoom === next.zoom &&
      prev.gridStroke === next.gridStroke &&
      prev.linedStroke === next.linedStroke &&
      prev.dotFill === next.dotFill &&
      prev.axisStroke === next.axisStroke &&
      prev.axisText === next.axisText
    );
  }
);

InfiniteBoardBgLayer.displayName = 'InfiniteBoardBgLayer';

interface CanvasObjectItemProps {
  obj: CanvasObject;
  isSelected: boolean;
  // V1.11.8-7b: Estado de arrastre del elemento
  isDragging?: boolean;
  locked: boolean;
  disablePointerEvents: boolean;
  isEditingText: boolean;
  isEditingEquation: boolean;
  isEditingDimension: boolean;
  activeTableCell: TableCellCoord | null;
  equationCursor: MathCursor;
  // V1.11.8-7d: Subselección activa en editor de ecuaciones
  equationSelection?: MathSelectionRange | null;
  dimOverrideDraft: string;
  tableZoom: number;
  tableDockBarBottom: boolean;
  cadConfigForDim: CadDraftingConfig;
  isDarkSurface: boolean;
  boardBg: string;
  adaptStrokeColorsToCanvasBg: boolean;
  spellcheckEnabled: boolean;
  defaultSpellcheckLang: SpellcheckLanguage;
  editingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  equationInputRef: React.RefObject<HTMLInputElement | null>;
  activeRichTextEditorRef?: React.RefObject<RichTextEditorHandle | null>;
  onObjectPointerDown: (
    e: React.PointerEvent,
    obj: CanvasObject,
    forceDragEvenIfEditing?: boolean
  ) => void;
  onObjectDoubleClick: (e: React.MouseEvent, obj: CanvasObject, locked: boolean) => void;
  onObjectContextMenu?: (e: React.MouseEvent, obj: CanvasObject) => void;
  onUpdateObjects: (
    ids: string[],
    updater: (obj: CanvasObject) => CanvasObject,
    recordHistory?: boolean
  ) => void;
  onSelectIds: (ids: string[]) => void;
  onDeleteObjects: (ids: string[]) => void;
  onSetEditingTextId: (id: string | null) => void;
  onSetEditingEquationId: (id: string | null) => void;
  onSetEditingDimensionId?: (id: string | null) => void;
  onSetEditingTableCell?: (tableId: string | null, cell: TableCellCoord | null) => void;
  onEquationCursorChange: (cursor: MathCursor) => void;
  onEquationSelectionChange?: (selection: MathSelectionRange | null) => void;
  onOpenEquationModal: (obj: EquationObject) => void;
  onRequestTextEquationEditor?: (objId: string, req: InlineEquationRequest) => void;
  onActiveInlineTextEquationChange?: (
    objId: string,
    session: ActiveInlineEquationSession | null
  ) => void;
  onRichTextSelectionSummaryChange?: (summary: SelectionStyleSummary | null) => void;
  onPushTextParagraphsSnapshot?: (
    objId: string,
    snapshotParagraphs: TextObject['paragraphs']
  ) => void;
  onRepairTextBox: (id: string) => void;
  onRepairTableObject?: (id: string) => void;
  onCommitTableWithSnapshot: (
    objId: string,
    snapshotBefore: TableObject,
    nextTable: TableObject
  ) => void;
  onDimOverrideDraftChange: (val: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

const CanvasObjectItem = React.memo<CanvasObjectItemProps>(
  ({
    obj,
    isSelected,
    isDragging = false,
    locked,
    disablePointerEvents,
    isEditingText,
    isEditingEquation,
    isEditingDimension,
    activeTableCell,
    equationCursor,
    equationSelection = null,
    dimOverrideDraft,
    tableZoom,
    tableDockBarBottom,
    cadConfigForDim,
    isDarkSurface,
    boardBg,
    adaptStrokeColorsToCanvasBg,
    spellcheckEnabled,
    defaultSpellcheckLang,
    editingTextareaRef,
    equationInputRef,
    activeRichTextEditorRef,
    onObjectPointerDown,
    onObjectDoubleClick,
    onObjectContextMenu,
    onUpdateObjects,
    onSelectIds,
    onDeleteObjects,
    onSetEditingTextId,
    onSetEditingEquationId,
    onSetEditingDimensionId,
    onSetEditingTableCell,
    onEquationCursorChange,
    onEquationSelectionChange,
    onOpenEquationModal,
    onRequestTextEquationEditor,
    onActiveInlineTextEquationChange,
    onRichTextSelectionSummaryChange,
    onPushTextParagraphsSnapshot,
    onRepairTextBox,
    onRepairTableObject,
    onCommitTableWithSnapshot,
    onDimOverrideDraftChange,
    onUndo,
    onRedo,
  }) => {
    const resolveDisplayStrokeColor = (color: string): string =>
      adaptStrokeColorsToCanvasBg ? adaptStrokeColorForCanvasBg(color, boardBg) : color;

    const isRefBg =
      (obj.type === 'image' || obj.type === 'document') && obj.isReferenceBackground;

    const renderShapeSvg = (shape: ShapeObject) => {
      const w = Math.max(10, shape.width);
      const h = Math.max(10, shape.height);
      const strokeColor = resolveDisplayStrokeColor(shape.strokeColor);
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible block">
          {renderShapeSvgElement(shape.shapeKind, w, h, {
            strokeColor,
            fillColor: shape.fillColor,
            strokeWidth: shape.strokeWidth,
            strokeStyle: shape.strokeStyle,
            cornerRadius: shape.cornerRadius,
            polygonSides: shape.polygonSides,
            arcStartAngle: shape.arcStartAngle,
            arcEndAngle: shape.arcEndAngle,
            customPoints: shape.customPoints,
            customVertices: shape.customVertices,
            flipX: shape.flipX,
            flipY: shape.flipY,
          })}
        </svg>
      );
    };

    const renderLineSvg = (line: LineObject) => {
      const w = Math.max(10, line.width);
      const h = Math.max(10, line.height);
      const { startPoint: s, endPoint: end } = line;
      const strokeCol = resolveDisplayStrokeColor(line.strokeColor);
      const baseDash =
        line.strokeStyle === 'dashed' ? '8 5' : line.strokeStyle === 'dotted' ? '2 5' : undefined;
      const dash = line.lineKind === 'dashed-line' ? baseDash || '8 5' : baseDash;
      const headLen = Math.max(9, line.strokeWidth * 3.2);

      const renderArrowHead = (from: Point2D, to: Point2D) => {
        const ang = Math.atan2(to.y - from.y, to.x - from.x);
        const p1x = to.x - headLen * Math.cos(ang - Math.PI / 6);
        const p1y = to.y - headLen * Math.sin(ang - Math.PI / 6);
        const p2x = to.x - headLen * Math.cos(ang + Math.PI / 6);
        const p2y = to.y - headLen * Math.sin(ang + Math.PI / 6);
        return <polygon points={`${to.x},${to.y} ${p1x},${p1y} ${p2x},${p2y}`} fill={strokeCol} />;
      };

      const renderSegmentTick = (at: Point2D, other: Point2D) => {
        const ang = Math.atan2(other.y - at.y, other.x - at.x) + Math.PI / 2;
        const tick = 6;
        return (
          <line
            x1={at.x - tick * Math.cos(ang)}
            y1={at.y - tick * Math.sin(ang)}
            x2={at.x + tick * Math.cos(ang)}
            y2={at.y + tick * Math.sin(ang)}
            stroke={strokeCol}
            strokeWidth={line.strokeWidth}
          />
        );
      };

      const ctrl = line.controlPoint || { x: (s.x + end.x) / 2, y: (s.y + end.y) / 2 - 36 };
      const midX = (s.x + end.x) / 2;

      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible block">
          {line.lineKind === 'connector' ? (
            <>
              <path
                d={`M ${s.x} ${s.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`}
                fill="none"
                stroke={strokeCol}
                strokeWidth={line.strokeWidth}
                strokeDasharray={dash}
                strokeLinecap="round"
              />
              {renderArrowHead(ctrl, end)}
            </>
          ) : line.lineKind === 'orthogonal' ? (
            <>
              <polyline
                points={`${s.x},${s.y} ${midX},${s.y} ${midX},${end.y} ${end.x},${end.y}`}
                fill="none"
                stroke={strokeCol}
                strokeWidth={line.strokeWidth}
                strokeDasharray={dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {renderArrowHead({ x: midX, y: end.y }, end)}
            </>
          ) : (
            <>
              {line.lineKind === 'vector' && (
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={Math.max(3.5, line.strokeWidth * 1.4)}
                  fill={strokeCol}
                />
              )}
              <line
                x1={s.x}
                y1={s.y}
                x2={end.x}
                y2={end.y}
                stroke={strokeCol}
                strokeWidth={line.strokeWidth}
                strokeDasharray={dash}
                strokeLinecap="round"
              />
              {(line.lineKind === 'arrow' ||
                line.lineKind === 'double-arrow' ||
                line.lineKind === 'vector') &&
                renderArrowHead(s, end)}
              {line.lineKind === 'double-arrow' && renderArrowHead(end, s)}
              {line.lineKind === 'segment' && (
                <>
                  {renderSegmentTick(s, end)}
                  {renderSegmentTick(end, s)}
                </>
              )}
            </>
          )}
        </svg>
      );
    };

    const renderDimensionNode = (dim: DimensionObject) => {
      const w = Math.max(10, dim.width);
      const h = Math.max(10, dim.height);
      const metrics = getCachedDimensionMetrics(dim, cadConfigForDim);
      const commitOverride = (val: string) => {
        const cleaned = val.trim();
        const nextOverride =
          !cleaned || cleaned === metrics.formattedLabel ? undefined : cleaned;
        onUpdateObjects(
          [dim.id],
          (o) => ({ ...(o as DimensionObject), textOverride: nextOverride }),
          true
        );
        onSetEditingDimensionId?.(null);
      };

      return (
        <div className="relative w-full h-full">
          <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible block">
            {/* V1.11.8-2: Tipografía opcional de cota */}
            <DimensionSvgContent
              metrics={metrics}
              strokeColor={resolveDisplayStrokeColor(dim.strokeColor)}
              textColor={resolveDisplayStrokeColor(dim.textColor)}
              fontSize={dim.fontSize}
              fontFamily={dim.fontFamily}
              originX={dim.x}
              originY={dim.y}
              hideLabel={isEditingDimension}
            />
          </svg>
          {isEditingDimension && (
            <input
              autoFocus
              type="text"
              value={dimOverrideDraft}
              onChange={(e) => onDimOverrideDraftChange(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  commitOverride(dimOverrideDraft);
                } else if (e.key === 'Escape') {
                  onSetEditingDimensionId?.(null);
                }
              }}
              onBlur={() => commitOverride(dimOverrideDraft)}
              placeholder={metrics.formattedLabel}
              title="Texto personalizado de cota (dejar vacío para cálculo automático)"
              style={{
                left: metrics.textPos.x - dim.x,
                top: metrics.textPos.y - dim.y,
                transform: 'translate(-50%, -50%)',
                fontSize: `${Math.max(11, dim.fontSize)}px`,
                fontFamily: dim.fontFamily ? getTextFontCss(dim.fontFamily) : undefined,
              }}
              className="absolute z-50 w-28 px-1.5 py-0.5 text-center font-mono-tabular font-semibold bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-2 border-blue-600 rounded shadow-lg outline-none"
            />
          )}
        </div>
      );
    };

    const renderTextContent = (txt: TextObject) => {
      const defaults = getDefaultRunStyle(txt);
      const safeAlign = normalizeTextAlign(txt?.align, 'left');
      const isAuto = resolveTextWidthMode(txt) === 'auto';
      const isLegacyUntagged = txt?.widthMode === undefined && txt?.autoWidth === undefined;
      const effectiveMaxAutoWidth = isLegacyUntagged
        ? Math.max(
            TEXT_AUTO_MAX_WIDTH,
            Number.isFinite(txt.width) ? txt.width : TEXT_AUTO_MAX_WIDTH
          )
        : TEXT_AUTO_MAX_WIDTH;
      const activeLang = txt.lang ?? getRememberedTextLang(defaultSpellcheckLang);
      const paragraphs = normalizarContenidoTexto(
        Array.isArray(txt?.paragraphs) && txt.paragraphs.length > 0
          ? txt.paragraphs
          : txt?.content,
        defaults,
        safeAlign
      );
      const resolveTextColor = (color: string) =>
        txt.backgroundColor === 'transparent' ? resolveDisplayStrokeColor(color) : color;
      const resetKey = `${isEditingText ? 'edit' : 'view'}-${typeof txt.content === 'string' ? txt.content.length : 'invalid'}-${Array.isArray(txt.paragraphs) ? txt.paragraphs.length : 'none'}`;

      return (
        <TextObjectErrorBoundary
          objectId={txt.id}
          resetKey={resetKey}
          onRepair={onRepairTextBox}
        >
          {isEditingText ? (
            <RichTextEditor
              ref={activeRichTextEditorRef}
              paragraphs={paragraphs}
              defaults={defaults}
              defaultAlign={safeAlign}
              listStyle={txt.listStyle}
              backgroundColor={txt.backgroundColor}
              autoWidth={isAuto}
              maxAutoWidth={effectiveMaxAutoWidth}
              lang={activeLang}
              spellcheckEnabled={spellcheckEnabled}
              resolveColor={resolveTextColor}
              onChangeParagraphs={(nextParagraphs, recordHistory) =>
                onUpdateObjects(
                  [txt.id],
                  (o) => syncTextObjectFromParagraphs(o as TextObject, nextParagraphs),
                  recordHistory
                )
              }
              onPushParagraphsSnapshot={
                onPushTextParagraphsSnapshot
                  ? (snapParagraphs) => onPushTextParagraphsSnapshot(txt.id, snapParagraphs)
                  : undefined
              }
              onChangeListStyle={(nextListStyle) => {
                onUpdateObjects(
                  [txt.id],
                  (o) => ({ ...(o as TextObject), listStyle: nextListStyle }),
                  true
                );
                requestAnimationFrame(() => activeRichTextEditorRef?.current?.focus());
              }}
              onChangeLang={(nextLang) => {
                onUpdateObjects(
                  [txt.id],
                  (o) => ({ ...(o as TextObject), lang: nextLang }),
                  false
                );
              }}
              onSelectionSummaryChange={(summary) =>
                onRichTextSelectionSummaryChange?.(summary)
              }
              onRequestEquationEditor={
                onRequestTextEquationEditor
                  ? (req) => onRequestTextEquationEditor(txt.id, req)
                  : undefined
              }
              onActiveInlineEquationChange={
                onActiveInlineTextEquationChange
                  ? (session) => onActiveInlineTextEquationChange(txt.id, session)
                  : undefined
              }
              onAutoSizeChange={({ width, height }) => {
                const curHeight = Number.isFinite(txt.height) ? txt.height : 40;
                const curWidth = Number.isFinite(txt.width) ? txt.width : 160;
                const nextHeight = isAuto
                  ? Math.max(40, height)
                  : Math.max(curHeight, height);
                const nextWidth =
                  isAuto && width !== undefined ? Math.max(64, width) : curWidth;

                if (
                  Math.abs(nextHeight - curHeight) > 1 ||
                  (isAuto && Math.abs(nextWidth - curWidth) > 1)
                ) {
                  onUpdateObjects(
                    [txt.id],
                    (o) => ({
                      ...(o as TextObject),
                      width: isAuto && width !== undefined ? nextWidth : o.width,
                      height: nextHeight,
                    }),
                    false
                  );
                }
              }}
              onUndo={onUndo}
              onRedo={onRedo}
              onFinish={() => onSetEditingTextId(null)}
            />
          ) : (
            <RichTextViewer
              paragraphs={paragraphs}
              defaults={defaults}
              defaultAlign={safeAlign}
              listStyle={txt.listStyle}
              backgroundColor={txt.backgroundColor}
              autoWidth={isAuto}
              maxAutoWidth={effectiveMaxAutoWidth}
              resolveColor={resolveTextColor}
            />
          )}
        </TextObjectErrorBoundary>
      );
    };

    return (
      <div
        data-canvas-obj-id={obj.id}
        onPointerDown={(e) => onObjectPointerDown(e, obj)}
        onDoubleClick={(e) => onObjectDoubleClick(e, obj, locked)}
        onContextMenu={onObjectContextMenu ? (e) => onObjectContextMenu(e, obj) : undefined}
        style={{
          position: 'absolute',
          left: obj.x,
          top: obj.y,
          width:
            obj.type === 'text' && resolveTextWidthMode(obj) === 'auto'
              ? 'fit-content'
              : obj.width,
          minWidth:
            obj.type === 'text' && resolveTextWidthMode(obj) === 'auto'
              ? 64
              : undefined,
          maxWidth:
            obj.type === 'text' && resolveTextWidthMode(obj) === 'auto'
              ? obj.widthMode === undefined && obj.autoWidth === undefined
                ? Math.max(TEXT_AUTO_MAX_WIDTH, obj.width || TEXT_AUTO_MAX_WIDTH)
                : TEXT_AUTO_MAX_WIDTH
              : undefined,
          // V1.11.8-16: Tablas conservan altura exacta para permitir compactación libre hasta ~40 px
          ...(obj.type === 'text'
            ? { minHeight: obj.height, height: 'auto' }
            : { height: obj.height }),
          opacity: obj.opacity,
          transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
          transformOrigin: 'center center',
          zIndex: obj.zIndex,
          pointerEvents: disablePointerEvents || isRefBg ? 'none' : 'auto',
        }}
        className="group"
      >
        {obj.type === 'stroke' && (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${Math.max(1, obj.width)} ${Math.max(1, obj.height)}`}
            className="overflow-visible block"
            style={
              obj.isHighlighter
                ? { mixBlendMode: isDarkSurface ? 'screen' : 'multiply' }
                : undefined
            }
          >
            {/* OPT: 2.5 — Caché SVG por trazo */}
            <path
              d={getStrokeSvgPath(obj.points)}
              fill="none"
              stroke={resolveDisplayStrokeColor(obj.color)}
              strokeWidth={obj.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={
                obj.strokeStyle === 'dashed'
                  ? `${obj.strokeWidth * 2.5} ${obj.strokeWidth * 2}`
                  : obj.strokeStyle === 'dotted'
                  ? `1 ${obj.strokeWidth * 2.2}`
                  : undefined
              }
            />
          </svg>
        )}

        {obj.type === 'shape' && renderShapeSvg(obj)}

        {obj.type === 'line' && renderLineSvg(obj)}

        {obj.type === 'dimension' && renderDimensionNode(obj)}

        {obj.type === 'text' && renderTextContent(obj)}

        {obj.type === 'table' && (() => {
          const rawRows = Array.isArray((obj as Partial<TableObject>)?.cells)
            ? (obj as Partial<TableObject>).cells!.length
            : 0;
          const resetKey = `${obj.rows ?? 0}x${obj.cols ?? 0}-${rawRows}-${isSelected ? '1' : '0'}`;
          return (
            <TableErrorBoundary
              objectId={obj.id}
              resetKey={resetKey}
              onRepair={(tid) => onRepairTableObject?.(tid)}
            >
              <TableNodeView
                obj={obj}
                isSelected={isSelected}
                locked={locked}
                zoom={tableZoom}
                isDarkSurface={isDarkSurface}
                spellcheckEnabled={spellcheckEnabled}
                defaultSpellcheckLang={defaultSpellcheckLang}
                activeEditingCell={activeTableCell}
                activeCellEditorRef={activeRichTextEditorRef}
                resolveDisplayColor={resolveDisplayStrokeColor}
                onSelectObject={() => onSelectIds([obj.id])}
                onStartDragObject={(e) => onObjectPointerDown(e, obj, true)}
                onSetEditingCell={(cell) =>
                  onSetEditingTableCell?.(cell ? obj.id : null, cell)
                }
                onUpdateTable={(nextTable, recordHistory) =>
                  onUpdateObjects([obj.id], () => nextTable, recordHistory)
                }
                onCommitTableWithSnapshot={(snapshotBefore, nextTable) =>
                  onCommitTableWithSnapshot(obj.id, snapshotBefore, nextTable)
                }
                onDeleteTable={() => onDeleteObjects([obj.id])}
                onUndo={onUndo}
                onRedo={onRedo}
                dockBarBottom={tableDockBarBottom}
              />
            </TableErrorBoundary>
          );
        })()}

        {obj.type === 'sticky' && (
          <div
            className="w-full h-full rounded-md shadow-md border border-black/10 p-3 flex flex-col"
            style={{
              backgroundColor: obj.backgroundColor,
              color: obj.textColor,
            }}
          >
            {isEditingText ? (
              <textarea
                ref={editingTextareaRef}
                value={typeof obj.content === 'string' ? obj.content : ''}
                onChange={(e) =>
                  onUpdateObjects(
                    [obj.id],
                    (o) => ({ ...(o as StickyObject), content: e.target.value }),
                    false
                  )
                }
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    onUpdateObjects([obj.id], (o) => o, true);
                    onSetEditingTextId(null);
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-full h-full resize-none bg-transparent outline-none select-text cursor-text leading-snug"
                style={{ fontSize: `${obj.fontSize}px`, color: obj.textColor }}
              />
            ) : (
              <div
                className="w-full h-full whitespace-pre-wrap break-words overflow-hidden leading-snug"
                style={{ fontSize: `${obj.fontSize}px` }}
              >
                {typeof obj.content === 'string' ? obj.content : ''}
              </div>
            )}
          </div>
        )}

        {obj.type === 'equation' && (
          <EquationNodeView
            obj={
              adaptStrokeColorsToCanvasBg && obj.backgroundColor === 'transparent'
                ? { ...obj, color: resolveDisplayStrokeColor(obj.color) }
                : obj
            }
            isEditing={isEditingEquation}
            isDragging={isDragging}
            inputRef={isEditingEquation ? equationInputRef : undefined}
            cursor={equationCursor}
            selection={isEditingEquation ? equationSelection : null}
            onCursorChange={onEquationCursorChange}
            onSelectionChange={isEditingEquation ? onEquationSelectionChange : undefined}
            onChangeLatex={(latex, recordHistory) =>
              onUpdateObjects(
                [obj.id],
                (o) => ({ ...(o as EquationObject), latex }),
                Boolean(recordHistory)
              )
            }
            onUpdateMeta={(patch) =>
              onUpdateObjects(
                [obj.id],
                (o) => ({ ...(o as EquationObject), ...patch }),
                true
              )
            }
            onAutoResize={(width, height) =>
              onUpdateObjects(
                [obj.id],
                (o) => ({ ...(o as EquationObject), width, height }),
                false
              )
            }
            onFinishEditing={() => {
              onUpdateObjects([obj.id], (o) => o, true);
              onSetEditingEquationId(null);
            }}
            onOpenFullModal={() => onOpenEquationModal(obj)}
            // V1.11.8-7a: El tirador superior izquierdo inicia arrastre incluso en modo edición
            onGripPointerDown={(e) => onObjectPointerDown(e, obj, true)}
          />
        )}

        {obj.type === 'graph' && <GraphNodeView obj={obj} />}

        {obj.type === 'image' && (
          <img
            src={obj.src}
            alt={obj.name}
            draggable={false}
            className="w-full h-full object-contain select-none pointer-events-none"
          />
        )}

        {obj.type === 'document' && (
          <DocumentNodeView
            obj={obj}
            onUpdateDocument={(docId, patch) =>
              onUpdateObjects(
                [docId],
                (o) => ({ ...(o as DocumentObject), ...patch }),
                true
              )
            }
          />
        )}
      </div>
    );
  },
  (prev, next) => {
    if (!isOptEnabled('layeredRender')) return false;
    return (
      prev.obj === next.obj &&
      prev.isSelected === next.isSelected &&
      prev.isDragging === next.isDragging &&
      prev.locked === next.locked &&
      prev.disablePointerEvents === next.disablePointerEvents &&
      prev.isEditingText === next.isEditingText &&
      prev.isEditingEquation === next.isEditingEquation &&
      prev.isEditingDimension === next.isEditingDimension &&
      prev.activeTableCell === next.activeTableCell &&
      prev.equationCursor === next.equationCursor &&
      prev.equationSelection === next.equationSelection &&
      prev.dimOverrideDraft === next.dimOverrideDraft &&
      prev.tableZoom === next.tableZoom &&
      prev.tableDockBarBottom === next.tableDockBarBottom &&
      prev.cadConfigForDim === next.cadConfigForDim &&
      prev.isDarkSurface === next.isDarkSurface &&
      prev.boardBg === next.boardBg &&
      prev.adaptStrokeColorsToCanvasBg === next.adaptStrokeColorsToCanvasBg &&
      prev.spellcheckEnabled === next.spellcheckEnabled &&
      prev.defaultSpellcheckLang === next.defaultSpellcheckLang &&
      prev.onObjectPointerDown === next.onObjectPointerDown &&
      prev.onObjectDoubleClick === next.onObjectDoubleClick &&
      prev.onObjectContextMenu === next.onObjectContextMenu &&
      prev.onRequestTextEquationEditor === next.onRequestTextEquationEditor &&
      prev.onActiveInlineTextEquationChange === next.onActiveInlineTextEquationChange &&
      prev.onEquationSelectionChange === next.onEquationSelectionChange &&
      prev.onPushTextParagraphsSnapshot === next.onPushTextParagraphsSnapshot &&
      prev.onUpdateObjects === next.onUpdateObjects
    );
  }
);

CanvasObjectItem.displayName = 'CanvasObjectItem';

export interface StaticObjectsLayerProps {
  objects: CanvasObject[];
  selectedIdSet: Set<string>;
  draggingIdSet?: Set<string> | null;
  layerMap: Map<string, { visible: boolean; locked: boolean }>;
  disablePointerEvents: boolean;
  editingTextId: string | null;
  editingEquationId: string | null;
  editingDimensionId?: string | null;
  editingTableId?: string | null;
  editingTableCell?: TableCellCoord | null;
  equationCursor: MathCursor;
  equationSelection?: MathSelectionRange | null;
  dimOverrideDraft: string;
  zoom: number;
  shouldClipToFrame: boolean;
  pageFrameY: number | null;
  cadConfig: CadDraftingConfig;
  isDarkSurface: boolean;
  boardBg: string;
  adaptStrokeColorsToCanvasBg: boolean;
  spellcheckEnabled: boolean;
  defaultSpellcheckLang: SpellcheckLanguage;
  editingTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  equationInputRef: React.RefObject<HTMLInputElement | null>;
  activeRichTextEditorRef?: React.RefObject<RichTextEditorHandle | null>;
  onObjectPointerDown: (
    e: React.PointerEvent,
    obj: CanvasObject,
    forceDragEvenIfEditing?: boolean
  ) => void;
  onObjectDoubleClick: (e: React.MouseEvent, obj: CanvasObject, locked: boolean) => void;
  onObjectContextMenu?: (e: React.MouseEvent, obj: CanvasObject) => void;
  onUpdateObjects: (
    ids: string[],
    updater: (obj: CanvasObject) => CanvasObject,
    recordHistory?: boolean
  ) => void;
  onSelectIds: (ids: string[]) => void;
  onDeleteObjects: (ids: string[]) => void;
  onSetEditingTextId: (id: string | null) => void;
  onSetEditingEquationId: (id: string | null) => void;
  onSetEditingDimensionId?: (id: string | null) => void;
  onSetEditingTableCell?: (tableId: string | null, cell: TableCellCoord | null) => void;
  onEquationCursorChange: (cursor: MathCursor) => void;
  onEquationSelectionChange?: (selection: MathSelectionRange | null) => void;
  onOpenEquationModal: (obj: EquationObject) => void;
  onRequestTextEquationEditor?: (objId: string, req: InlineEquationRequest) => void;
  onActiveInlineTextEquationChange?: (
    objId: string,
    session: ActiveInlineEquationSession | null
  ) => void;
  onRichTextSelectionSummaryChange?: (summary: SelectionStyleSummary | null) => void;
  onPushTextParagraphsSnapshot?: (
    objId: string,
    snapshotParagraphs: TextObject['paragraphs']
  ) => void;
  onRepairTextBox: (id: string) => void;
  onRepairTableObject?: (id: string) => void;
  onCommitTableWithSnapshot: (
    objId: string,
    snapshotBefore: TableObject,
    nextTable: TableObject
  ) => void;
  onDimOverrideDraftChange: (val: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

// OPT: 1.5 & 2.2 — Capa de contenido estático separada de borradores y guías interactivas
export const StaticObjectsLayer = React.memo<StaticObjectsLayerProps>(
  ({
    objects,
    selectedIdSet,
    draggingIdSet = null,
    layerMap,
    disablePointerEvents,
    editingTextId,
    editingEquationId,
    editingDimensionId,
    editingTableId,
    editingTableCell,
    equationCursor,
    equationSelection = null,
    dimOverrideDraft,
    zoom,
    shouldClipToFrame,
    pageFrameY,
    cadConfig,
    isDarkSurface,
    boardBg,
    adaptStrokeColorsToCanvasBg,
    spellcheckEnabled,
    defaultSpellcheckLang,
    editingTextareaRef,
    equationInputRef,
    activeRichTextEditorRef,
    onObjectPointerDown,
    onObjectDoubleClick,
    onObjectContextMenu,
    onUpdateObjects,
    onSelectIds,
    onDeleteObjects,
    onSetEditingTextId,
    onSetEditingEquationId,
    onSetEditingDimensionId,
    onSetEditingTableCell,
    onEquationCursorChange,
    onEquationSelectionChange,
    onOpenEquationModal,
    onRequestTextEquationEditor,
    onActiveInlineTextEquationChange,
    onRichTextSelectionSummaryChange,
    onPushTextParagraphsSnapshot,
    onRepairTextBox,
    onRepairTableObject,
    onCommitTableWithSnapshot,
    onDimOverrideDraftChange,
    onUndo,
    onRedo,
  }) => {
    return (
      <>
        {objects.map((obj) => {
          const isSelected = selectedIdSet.has(obj.id);
          const isDragging = Boolean(draggingIdSet?.has(obj.id));
          const layer = layerMap.get(obj.layerId);
          const locked = obj.locked || Boolean(layer?.locked);
          const isEq = editingEquationId === obj.id;
          const isDim = editingDimensionId === obj.id;
          const isTblEditing = editingTableId === obj.id ? editingTableCell ?? null : null;

          return (
            <CanvasObjectItem
              key={obj.id}
              obj={obj}
              isSelected={isSelected}
              isDragging={isDragging}
              locked={locked}
              disablePointerEvents={disablePointerEvents}
              isEditingText={editingTextId === obj.id}
              isEditingEquation={isEq}
              isEditingDimension={isDim}
              activeTableCell={isTblEditing}
              equationCursor={isEq ? equationCursor : DEFAULT_EQ_CURSOR}
              equationSelection={isEq ? equationSelection : null}
              dimOverrideDraft={isDim ? dimOverrideDraft : ''}
              tableZoom={obj.type === 'table' ? zoom : 1}
              tableDockBarBottom={
                obj.type === 'table' &&
                Boolean(shouldClipToFrame && pageFrameY !== null && obj.y < pageFrameY + 52)
              }
              cadConfigForDim={obj.type === 'dimension' ? cadConfig : DEFAULT_CAD_CONFIG}
              isDarkSurface={isDarkSurface}
              boardBg={boardBg}
              adaptStrokeColorsToCanvasBg={adaptStrokeColorsToCanvasBg}
              spellcheckEnabled={spellcheckEnabled}
              defaultSpellcheckLang={defaultSpellcheckLang}
              editingTextareaRef={editingTextareaRef}
              equationInputRef={equationInputRef}
              activeRichTextEditorRef={activeRichTextEditorRef}
              onObjectPointerDown={onObjectPointerDown}
              onObjectDoubleClick={onObjectDoubleClick}
              onObjectContextMenu={onObjectContextMenu}
              onUpdateObjects={onUpdateObjects}
              onSelectIds={onSelectIds}
              onDeleteObjects={onDeleteObjects}
              onSetEditingTextId={onSetEditingTextId}
              onSetEditingEquationId={onSetEditingEquationId}
              onSetEditingDimensionId={onSetEditingDimensionId}
              onSetEditingTableCell={onSetEditingTableCell}
              onEquationCursorChange={onEquationCursorChange}
              onEquationSelectionChange={onEquationSelectionChange}
              onOpenEquationModal={onOpenEquationModal}
              onRequestTextEquationEditor={onRequestTextEquationEditor}
              onActiveInlineTextEquationChange={onActiveInlineTextEquationChange}
              onRichTextSelectionSummaryChange={onRichTextSelectionSummaryChange}
              onPushTextParagraphsSnapshot={onPushTextParagraphsSnapshot}
              onRepairTextBox={onRepairTextBox}
              onRepairTableObject={onRepairTableObject}
              onCommitTableWithSnapshot={onCommitTableWithSnapshot}
              onDimOverrideDraftChange={onDimOverrideDraftChange}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          );
        })}
      </>
    );
  }
);

StaticObjectsLayer.displayName = 'StaticObjectsLayer';

export { getInitialEditCursor };
