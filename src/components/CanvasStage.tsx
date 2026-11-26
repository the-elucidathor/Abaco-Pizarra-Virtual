import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Copy, FlipHorizontal2, FlipVertical2, Plus, Trash2 } from 'lucide-react';
import type {
  Board,
  CanvasBackgroundColorMode,
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
  StrokeObject,
  TableObject,
  TextObject,
  ThemePreset,
  ToolId,
  ToolOptions,
} from '../types/whiteboard';
import { clamp, snapValue, uid } from '../utils/id';
import { EquationNodeView } from './nodes/EquationNodeView';
import { GraphNodeView } from './nodes/GraphNodeView';
import { DocumentNodeView } from './nodes/DocumentNodeView';
import { TableErrorBoundary, TableNodeView } from './nodes/TableNodeView';
import {
  normalizarTabla,
  scaleTableToDimensions,
  type TableCellCoord,
} from '../utils/tableUtils';
import { is3DSolidShape, renderShapeSvgElement } from '../utils/shapeRenderer';
import { type MathCursor, getInitialEditCursor } from '../utils/latexEditorEngine';
import {
  type AutoTrimPreview,
  type Solid3DHandleMeta,
  buildLineObjectFromWorldEndpoints,
  buildPolylineShapeFromWorldPoints,
  buildShapeObjectFromWorldPolygon,
  computeAutoTrimAtPoint,
  computeBladeCut,
  getShapeEditableGeometry,
  localToWorld,
  worldToLocal,
} from '../utils/geometryCad';
import {
  type ActiveInlineEquationSession,
  type InlineEquationRequest,
  RichTextEditor,
  type RichTextEditorHandle,
  RichTextViewer,
  TEXT_AUTO_MAX_WIDTH,
} from './RichTextEditor';
import { TextObjectErrorBoundary } from './TextObjectErrorBoundary';
import {
  type SelectionStyleSummary,
  createParagraphsFromPlainText,
  getDefaultRunStyle,
  normalizarContenidoTexto,
  normalizeTextAlign,
  repairCorruptedTextObject,
  resolveTextWidthMode,
  syncTextObjectFromParagraphs,
} from '../utils/richText';
import { getRememberedTextLang } from '../utils/spellcheck/personalDictionary';
import {
  type CanvasCursorKind,
  getContrastCanvasCursor,
  getThemeCursorPalette,
} from '../utils/canvasCursor';
import {
  MAX_SHEETS_PER_BOARD,
  clampFixedBoardViewportPan,
  computePageFrameGeometry,
  findClosestSheetIndexForWorldY,
  findSheetIndexForObject,
  getBoardSizeSummary,
  getSheetY,
  isFixedSizeBoard,
  normalizarAjustesHoja,
  normalizarHojas,
  normalizeWheelDelta,
  pxToMm,
} from '../utils/boardSizes';
import {
  adaptStrokeColorForCanvasBg,
  getEffectiveBoardColors,
  getFrameBorderStroke,
} from '../utils/themePalette';
import {
  type CadCommandId,
  type CadDraftingConfig,
  type CadResolvedCursor,
  type CadSessionState,
  type PathArraySessionOptions,
  FEATURE_TRACKING_ENABLED,
} from '../types/cad';
import {
  type HerramientaResolucionPunto,
  type SnapHysteresisState,
  findNearestSegmentToPoint,
  findObjectNearWorldPoint,
  resolverPunto,
} from '../utils/cad/cadSnap';
import {
  type TrackingSessionState,
  clearTrackingSessionState,
  createTrackingSessionState,
} from '../utils/cad/cadTracking';
import { hasOtherObjectEndpointNearPoint, queryObjectsInWorldBox } from '../utils/cad/cadSpatialIndex';
import { cadDistToWorldDist } from '../utils/cad/cadCoords';
import { computeDimensionMetrics } from '../utils/cad/cadDimensions';
import { DimensionSvgContent } from '../utils/cad/cadDimensionsSvg';
import { expandSelectionToGroups } from '../utils/cad/cadGroups';
import {
  getObjectsWorldBoundingBox,
  rotateCanvasObjectAroundPivot,
  scaleCanvasObjectInBox,
  type WorldBoxRect,
} from '../utils/cad/cadTransform';
import { getCadBasePoint } from '../utils/cad/cadSessionController';
import { CadDynamicHud, CadWorldOverlay } from './CadCanvasOverlay';
import {
  type CanvasContextActions,
  CanvasContextMenu,
} from './CanvasContextMenu';
import { InfiniteBoardBgLayer, StaticObjectsLayer } from './CanvasStageLayers';
import { safeRunOpt } from '../utils/optFlags';
import { isPerfMonitorEnabled, recordPerfAction, setPerfCounts } from '../utils/perfMonitor';
import { filterVisibleObjectsInViewport } from '../utils/viewportCulling';
import { captureBoardHistorySnapshot } from '../utils/historySnapshot';

// Comprueba si un elemento editable (cuadro de texto, nota o celda) tiene contenido realmente desplazable
function isEditableWithScrollableContent(el: Element): boolean {
  try {
    const editableHost = el.closest('[contenteditable="true"], textarea');
    if (!editableHost) return false;
    let cur: Element | null = el;
    while (cur && cur !== document.body) {
      if (cur instanceof HTMLElement) {
        const style = window.getComputedStyle(cur);
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        const canY =
          cur.tagName === 'TEXTAREA' || overflowY === 'auto' || overflowY === 'scroll';
        const canX = overflowX === 'auto' || overflowX === 'scroll';
        if (
          (canY && cur.scrollHeight > cur.clientHeight + 1) ||
          (canX && cur.scrollWidth > cur.clientWidth + 1)
        ) {
          return true;
        }
      }
      if (cur === editableHost || cur.hasAttribute('data-canvas-obj-id')) break;
      cur = cur.parentElement;
    }
    return false;
  } catch {
    return false;
  }
}

// Determina si el evento de rueda proviene de una zona desplazable interna (p. ej. PDF/DOCX/XLSX/TXT o listas) sin Ctrl/Cmd
export function shouldIgnoreCanvasWheel(
  target: EventTarget | null,
  ctrlKey: boolean,
  metaKey: boolean
): boolean {
  // Ctrl+rueda y pellizco de touchpad (ctrlKey=true) siempre hacen zoom del lienzo
  if (ctrlKey || metaKey) return false;
  if (!target) return false;
  const el =
    typeof Element !== 'undefined' && target instanceof Element
      ? target
      : (target as { parentElement?: Element | null })?.parentElement ?? null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('[role="dialog"], [aria-modal="true"]')) return true;
  if (el.closest('[data-scrollable-content]')) return true;
  if (isEditableWithScrollableContent(el)) return true;
  return false;
}

interface CanvasStageProps {
  board: Board;
  theme: ThemePreset;
  canvasBgMode: CanvasBackgroundColorMode;
  canvasBgCustomColor: string;
  adaptStrokeColorsToCanvasBg: boolean;
  cursorSize: number;
  cursorColor: string;
  activeTool: ToolId;
  toolOptions: ToolOptions;
  selectedIds: string[];
  editingTextId: string | null;
  editingEquationId: string | null;
  editingDimensionId?: string | null;
  editingTableId?: string | null;
  editingTableCell?: TableCellCoord | null;
  pendingTableSize?: { rows: number; cols: number } | null;
  equationInputRef: React.RefObject<HTMLInputElement | null>;
  equationCursor: MathCursor;
  areaExportMode: boolean;
  arrayPickMode?: 'polar-center' | 'path-object' | 'path-base-point' | null;
  livePathArrayDraft?: PathArraySessionOptions | null;
  pressureSensitivity: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onSelectIds: (ids: string[]) => void;
  onSetEditingTextId: (id: string | null) => void;
  onSetEditingEquationId: (id: string | null) => void;
  onSetEditingDimensionId?: (id: string | null) => void;
  onSetEditingTableCell?: (tableId: string | null, cell: TableCellCoord | null) => void;
  onPlacePendingTable?: (worldPt: Point2D) => void;
  onCancelPendingTable?: () => void;
  onEquationCursorChange: (cursor: MathCursor) => void;
  onOpenEquationModal: (obj: EquationObject) => void;
  onCompleteAreaExport: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCancelAreaExport: () => void;
  onUpdateViewport: (viewport: Board['viewport']) => void;
  onAddObject: (obj: CanvasObject) => void;
  onUpdateObjects: (
    ids: string[],
    updater: (obj: CanvasObject) => CanvasObject,
    recordHistory?: boolean
  ) => void;
  onDeleteObjects: (ids: string[]) => void;
  onStartEraserPass: () => void;
  onEraserSweep: (prevWorld: Point2D, currWorld: Point2D, radiusWorld: number) => void;
  onEndEraserPass: () => void;
  onApplyCutChanges: (deleteIds: string[], addObjects: CanvasObject[]) => void;
  onCursorMove: (worldPos: Point2D) => void;
  onCanvasPointerActivity?: (overCanvas: boolean) => void;
  onDoubleClickGraph: (obj: GraphObject) => void;
  onDropFiles: (files: FileList, worldX: number, worldY: number) => void;
  onSwitchToSelect: () => void;
  cadConfig: CadDraftingConfig;
  cadSession: CadSessionState;
  onCadPickPoint: (worldPt: Point2D, pickedObjectId?: string | null) => void;
  onArrayPickCanvas?: (worldPt: Point2D, pickedObjectId: string | null) => void;
  onCadQuickStart: (cmd: CadCommandId, firstPoint: Point2D) => void;
  onCadFinishSession: (closePolyline: boolean) => void;
  onCadCancelSession: () => void;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomBarsCollapsed: boolean;
  autoTransparentPanels: boolean;
  cleanWorkMode: boolean;
  contextActions: CanvasContextActions;
  onPointerStageMove?: (stagePos: Point2D | null) => void;
  renderQuickCommandHud?: (stageSize: { width: number; height: number }) => React.ReactNode;
  activeRichTextEditorRef?: React.RefObject<RichTextEditorHandle | null>;
  onRichTextSelectionSummaryChange?: (summary: SelectionStyleSummary | null) => void;
  onRepairTextObject?: (id: string) => void;
  onRepairTableObject?: (id: string) => void;
  onPushHistorySnapshot?: (snapshotObjects: CanvasObject[]) => void;
  onRequestTextEquationEditor?: (objId: string, req: InlineEquationRequest) => void;
  onActiveInlineTextEquationChange?: (
    objId: string,
    session: ActiveInlineEquationSession | null
  ) => void;
  spellcheckEnabled?: boolean;
  defaultSpellcheckLang?: SpellcheckLanguage;
  onUndo?: () => void;
  onRedo?: () => void;
  onResolvedCursorChange?: (cursor: CadResolvedCursor | null) => void;
  onTrackingError?: (err: unknown) => void;
  onInteractionActiveChange?: (active: boolean) => void; // OPT: 1.2
  onAddSheetAfter?: (sheetIndex: number) => void;
  onDuplicateSheet?: (sheetIndex: number) => void;
  onRequestDeleteSheet?: (sheetIndex: number) => void;
  onActiveSheetChange?: (sheetIndex: number) => void;
  wheelScrollSheets?: boolean;
  hasOpenModal?: boolean;
  onFirstFixedSheetWheel?: () => void;
}

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface InteractionState {
  mode:
    | 'none'
    | 'pan'
    | 'pen'
    | 'eraser'
    | 'drag-objects'
    | 'resize'
    | 'rotate'
    | 'group-resize'
    | 'group-rotate'
    | 'marquee'
    | 'draw-shape'
    | 'draw-line'
    | 'draw-text'
    | 'drag-vertex'
    | 'drag-line-point'
    | 'draw-cut';
  startClient: Point2D;
  startWorld: Point2D;
  startViewport: Board['viewport'];
  initialObjects?: Record<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      customVertices?: Point2D[];
      customPoints?: Point2D[];
      startPoint?: Point2D;
      endPoint?: Point2D;
      controlPoint?: Point2D;
      p1?: Point2D;
      p2?: Point2D;
      p3?: Point2D;
      offsetPt?: Point2D;
      isShape?: boolean;
      flipX?: boolean;
      flipY?: boolean;
    }
  >;
  groupBox?: WorldBoxRect;
  groupFullObjects?: Record<string, CanvasObject>;
  groupPivot?: Point2D;
  groupDeltaDeg?: number;
  handleDir?: HandleDir;
  targetId?: string;
  draftPoints?: Point2D[];
  currentWorld?: Point2D;
  erasedAny?: boolean;
  shiftKey?: boolean;
  vertexIndex?: number;
  initialWorldVertices?: Point2D[];
  vertexMode?: 'polygon' | 'polyline' | 'curve' | 'ellipse-cardinal' | 'solid-3d';
  solidHandle?: Solid3DHandleMeta;
  linePointRole?: 'start' | 'end' | 'control';
  initialLinePoints?: { start: Point2D; end: Point2D; control?: Point2D };
}

function buildSmoothSvgPath(points: Point2D[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${(points[0].x + 0.5).toFixed(1)} ${points[0].y.toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

export const CanvasStage: React.FC<CanvasStageProps> = ({
  board,
  theme,
  canvasBgMode,
  canvasBgCustomColor,
  adaptStrokeColorsToCanvasBg,
  cursorSize,
  cursorColor,
  activeTool,
  toolOptions,
  selectedIds,
  editingTextId,
  editingEquationId,
  editingDimensionId,
  editingTableId,
  editingTableCell,
  pendingTableSize,
  equationInputRef,
  equationCursor,
  areaExportMode,
  arrayPickMode,
  livePathArrayDraft = null,
  pressureSensitivity,
  stageRef,
  onSelectIds,
  onSetEditingTextId,
  onSetEditingEquationId,
  onSetEditingDimensionId,
  onSetEditingTableCell,
  onPlacePendingTable,
  onCancelPendingTable,
  onEquationCursorChange,
  onOpenEquationModal,
  onCompleteAreaExport,
  onCancelAreaExport,
  onUpdateViewport,
  onAddObject,
  onUpdateObjects,
  onDeleteObjects,
  onStartEraserPass,
  onEraserSweep,
  onEndEraserPass,
  onApplyCutChanges,
  onCursorMove,
  onCanvasPointerActivity,
  onDoubleClickGraph,
  onDropFiles,
  onSwitchToSelect,
  cadConfig,
  cadSession,
  onCadPickPoint,
  onArrayPickCanvas,
  onCadQuickStart,
  onCadFinishSession,
  onCadCancelSession,
  leftCollapsed,
  rightCollapsed,
  bottomBarsCollapsed,
  autoTransparentPanels,
  cleanWorkMode,
  contextActions,
  onPointerStageMove,
  renderQuickCommandHud,
  activeRichTextEditorRef,
  onRichTextSelectionSummaryChange,
  onRepairTextObject,
  onRepairTableObject,
  onPushHistorySnapshot,
  onRequestTextEquationEditor,
  onActiveInlineTextEquationChange,
  spellcheckEnabled = true,
  defaultSpellcheckLang = 'es',
  onUndo,
  onRedo,
  onResolvedCursorChange,
  onTrackingError,
  onInteractionActiveChange,
  onAddSheetAfter,
  onDuplicateSheet,
  onRequestDeleteSheet,
  onActiveSheetChange,
  wheelScrollSheets = true,
  hasOpenModal = false,
  onFirstFixedSheetWheel,
}) => {
  const [interaction, setInteraction] = useState<InteractionState>({
    mode: 'none',
    startClient: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    startViewport: board.viewport,
  });
  const [spacePressed, setSpacePressed] = useState(false);
  const [eraserCursor, setEraserCursor] = useState<Point2D | null>(null);
  const [trimPreview, setTrimPreview] = useState<AutoTrimPreview | null>(null);
  const [liveCadCursor, setLiveCadCursor] = useState<CadResolvedCursor | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dimOverrideDraft, setDimOverrideDraft] = useState('');
  const [elementMenuAnchor, setElementMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [areaDrag, setAreaDrag] = useState<{
    startClient: Point2D;
    currentClient: Point2D;
  } | null>(null);

  const [stageSize, setStageSize] = useState({ width: 1200, height: 800 });
  const stageSizeRef = useRef({ width: 1200, height: 800 });
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasMovedRef = useRef(false);
  const preTransformSnapshotRef = useRef<CanvasObject[] | null>(null);
  const resizeTextMinHeightRef = useRef<number>(36);
  const hoverRefSegmentRef = useRef<[Point2D, Point2D] | null>(null);
  const eraserLastWorldRef = useRef<Point2D | null>(null);
  // Estado de histéresis para estabilizar SNAP/SP/RAS entre movimientos consecutivos
  const snapHysteresisRef = useRef<SnapHysteresisState>({});
  // Estado de rastreo de referencia (puntos adquiridos y candidato en espera)
  const trackingStateRef = useRef<TrackingSessionState>(createTrackingSessionState());
  const acquireTimerRef = useRef<number | null>(null);
  const acquireCandidateRef = useRef<string | null>(null);
  const lastPointerClientRef = useRef<{
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  } | null>(null);
  // Planificación por fotograma (rAF) para previsualización fluida sin estelas
  // OPT: 2.1 — Ciclo rAF único coalescente con buffer de muestras de lápiz
  const rafMoveRef = useRef<number | null>(null);
  const pendingPointerMoveRef = useRef<{
    clientX: number;
    clientY: number;
    shiftKey: boolean;
    pressure?: number;
  } | null>(null);
  const pendingPenSamplesRef = useRef<
    { clientX: number; clientY: number; shiftKey: boolean; pressure: number }[]
  >([]);
  const processPendingMoveRef = useRef<() => void>(() => {});
  const executeMoveForWheelRef = useRef<() => void>(() => {});
  const liveViewportRef = useRef<Board['viewport']>(board.viewport);
  const wheelAnimRef = useRef<{
    rafId: number | null;
    targetPanX: number;
    targetPanY: number;
    currentPanX: number;
    currentPanY: number;
    zoom: number;
    lastTickTime: number;
    boardId: string;
  }>({
    rafId: null,
    targetPanX: board.viewport.panX,
    targetPanY: board.viewport.panY,
    currentPanX: board.viewport.panX,
    currentPanY: board.viewport.panY,
    zoom: board.viewport.zoom,
    lastTickTime: 0,
    boardId: board.id,
  });
  const [exportOrPrintActive, setExportOrPrintActive] = useState(false); // OPT: 2.3
  const [printActive, setPrintActive] = useState(false);
  const boardObjectsRef = useRef(board.objects);
  boardObjectsRef.current = board.objects;

  // Sincroniza liveViewportRef cuando no hay interpolación activa (o si cambió externamente tablero/zoom/pan)
  const animState = wheelAnimRef.current;
  if (animState.rafId === null) {
    liveViewportRef.current = board.viewport;
  } else if (
    animState.boardId !== board.id ||
    Math.abs(board.viewport.zoom - animState.zoom) > 1e-4
  ) {
    cancelAnimationFrame(animState.rafId);
    animState.rafId = null;
    liveViewportRef.current = board.viewport;
  }

  const cancelWheelAnimation = useCallback(() => {
    const st = wheelAnimRef.current;
    if (st.rafId !== null) {
      cancelAnimationFrame(st.rafId);
      st.rafId = null;
    }
  }, []);

  const updateLiveCadCursor = (resolved: CadResolvedCursor | null) => {
    setLiveCadCursor(resolved);
    onResolvedCursorChange?.(resolved);
  };

  const clearAcquireDwellTimer = () => {
    if (acquireTimerRef.current !== null) {
      window.clearTimeout(acquireTimerRef.current);
      acquireTimerRef.current = null;
    }
    acquireCandidateRef.current = null;
  };

  // Geometría y ajustes normalizados de hoja fija y marco (protegido contra datos incompletos)
  const fixedPage = isFixedSizeBoard(board)
    ? { width: board.pageWidth!, height: board.pageHeight! }
    : null;
  const sheets = useMemo(() => {
    if (!fixedPage) return [];
    return normalizarHojas(board);
  }, [fixedPage?.width, fixedPage?.height, board.sheets]);
  const gSize = Math.max(12, Number.isFinite(board.gridSize) ? board.gridSize : 28);
  const sheetSettings = useMemo(
    () => normalizarAjustesHoja(board),
    [board.showFrame, board.frameMarginMm, board.clipToFrame]
  );
  const pageFrame = useMemo(() => {
    if (!fixedPage || !sheetSettings.showFrame) return null;
    try {
      return computePageFrameGeometry(
        fixedPage.width,
        fixedPage.height,
        gSize,
        sheetSettings.frameMarginMm,
        board.backgroundPattern
      );
    } catch (err) {
      console.error('[Ábaco] Error al calcular el marco de la hoja:', err);
      return null;
    }
  }, [
    fixedPage?.width,
    fixedPage?.height,
    sheetSettings.showFrame,
    sheetSettings.frameMarginMm,
    gSize,
    board.backgroundPattern,
  ]);
  const snapOffsetX = pageFrame ? pageFrame.x : 0;
  const snapOffsetY = pageFrame ? pageFrame.y : 0;
  const getSnapOffsetYForWorld = useCallback(
    (worldY: number) => {
      if (!fixedPage || sheets.length <= 1) return snapOffsetY;
      const idx = findClosestSheetIndexForWorldY(worldY, sheets.length, fixedPage.height);
      return getSheetY(idx, fixedPage.height) + snapOffsetY;
    },
    [fixedPage?.height, sheets.length, snapOffsetY]
  );
  const shouldClipToFrame = Boolean(
    fixedPage && sheetSettings.showFrame && sheetSettings.clipToFrame && pageFrame
  );

  useEffect(() => {
    if (!cadSession.activeCommand) {
      hoverRefSegmentRef.current = null;
    }
  }, [cadSession.activeCommand]);

  useEffect(() => {
    if (activeTool !== 'cut') {
      setTrimPreview(null);
    }
  }, [activeTool]);

  // Limpia cualquier previsualización residual, guía temporal, rastreo o histéresis al cambiar de herramienta o modo
  useEffect(() => {
    if (rafMoveRef.current !== null) {
      cancelAnimationFrame(rafMoveRef.current);
      rafMoveRef.current = null;
    }
    clearAcquireDwellTimer();
    pendingPointerMoveRef.current = null;
    pendingPenSamplesRef.current = [];
    snapHysteresisRef.current = {};
    clearTrackingSessionState(trackingStateRef.current);
    updateLiveCadCursor(null);
    setInteraction((prev) =>
      prev.mode === 'draw-shape' || prev.mode === 'draw-line' || prev.mode === 'draw-text'
        ? {
            mode: 'none',
            startClient: { x: 0, y: 0 },
            startWorld: { x: 0, y: 0 },
            startViewport: prev.startViewport,
          }
        : prev
    );
  }, [
    activeTool,
    toolOptions.shapeKind,
    cadSession.activeCommand,
    cadConfig.trackingEnabled,
    cadConfig.trackingMode,
  ]);

  // Cierra menú contextual de elemento si cambia selección, herramienta, modo de edición o interacción
  useEffect(() => {
    setElementMenuAnchor(null);
  }, [
    selectedIds,
    activeTool,
    editingTextId,
    editingEquationId,
    editingDimensionId,
    editingTableId,
    editingTableCell,
    hasOpenModal,
  ]);

  // OPT: 1.2 — Informa a App si hay interacción continua activa para diferir autoguardado
  useEffect(() => {
    onInteractionActiveChange?.(interaction.mode !== 'none');
    if (interaction.mode !== 'none') {
      setElementMenuAnchor(null);
    }
  }, [interaction.mode, onInteractionActiveChange]);

  // OPT: 2.3 — Fuerza montaje completo de elementos fuera de vista durante exportación o impresión
  useEffect(() => {
    const onExportState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ exporting?: boolean }>).detail;
      setExportOrPrintActive(Boolean(detail?.exporting));
    };
    const onBeforePrint = () => {
      flushSync(() => {
        setExportOrPrintActive(true);
        setPrintActive(true);
      });
    };
    const onAfterPrint = () => {
      setExportOrPrintActive(false);
      setPrintActive(false);
    };
    window.addEventListener('abaco:export-state', onExportState);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('abaco:export-state', onExportState);
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  useEffect(() => {
    snapHysteresisRef.current = {};
  }, [cadConfig.ortho, cadConfig.polar, cadConfig.gridSnap, board.snapToGrid]);

  useEffect(() => {
    return () => {
      if (rafMoveRef.current !== null) {
        cancelAnimationFrame(rafMoveRef.current);
        rafMoveRef.current = null;
      }
      cancelWheelAnimation();
      pendingPenSamplesRef.current = [];
      clearAcquireDwellTimer();
    };
  }, [cancelWheelAnimation]);

  useEffect(() => {
    if (!editingTextId) {
      onRichTextSelectionSummaryChange?.(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const el = editingTextareaRef.current;
      if (el) {
        el.focus();
        if (
          el.value === 'Escribe aquí...' ||
          el.value === 'Nueva nota...' ||
          el.value === 'Cuadro de texto'
        ) {
          el.select();
        } else {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [editingTextId, onRichTextSelectionSummaryChange]);

  useEffect(() => {
    if (!editingEquationId) return;
    const raf = requestAnimationFrame(() => {
      equationInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [editingEquationId, equationInputRef]);

  useEffect(() => {
    if (!areaExportMode) {
      setAreaDrag(null);
    }
  }, [areaExportMode]);

  useEffect(() => {
    const updateSize = () => {
      if (stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const next = { width: Math.max(100, rect.width), height: Math.max(100, rect.height) };
        stageSizeRef.current = next;
        setStageSize((prev) =>
          Math.abs(prev.width - next.width) < 1 && Math.abs(prev.height - next.height) < 1
            ? prev
            : next
        );
      }
    };
    updateSize();
    const ro =
      typeof ResizeObserver !== 'undefined' && stageRef.current
        ? new ResizeObserver(updateSize)
        : null;
    if (ro && stageRef.current) {
      ro.observe(stageRef.current);
    }
    window.addEventListener('resize', updateSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [stageRef]);

  const activeSheetIndex = useMemo(() => {
    if (!fixedPage || sheets.length === 0) return 0;
    const centerWorldY =
      (stageSize.height / 2 - board.viewport.panY) / Math.max(0.05, board.viewport.zoom);
    return findClosestSheetIndexForWorldY(centerWorldY, sheets.length, fixedPage.height);
  }, [fixedPage?.height, sheets.length, stageSize.height, board.viewport.panY, board.viewport.zoom]);

  useEffect(() => {
    if (!fixedPage) return;
    onActiveSheetChange?.(activeSheetIndex);
  }, [fixedPage, activeSheetIndex, onActiveSheetChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setElementMenuAnchor(null);
      }

      if (e.key === 'Escape' && areaExportMode) {
        e.preventDefault();
        setAreaDrag(null);
        onCancelAreaExport();
        return;
      }

      if (e.key === 'Escape' && pendingTableSize) {
        e.preventDefault();
        onCancelPendingTable?.();
        return;
      }

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (ctrlOrMeta && (e.key === '0' || e.key === '+' || e.key === '=' || e.key === '-')) {
        cancelWheelAnimation();
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
      }
      if (e.key === 'Enter' && cadSession.activeCommand) {
        e.preventDefault();
        onCadFinishSession(false);
      }
      if (e.key === 'Escape' && (cadSession.activeCommand || cadSession.pickingOrigin)) {
        e.preventDefault();
        onCadCancelSession();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    cadSession.activeCommand,
    cadSession.pickingOrigin,
    onCadFinishSession,
    onCadCancelSession,
    areaExportMode,
    onCancelAreaExport,
    pendingTableSize,
    onCancelPendingTable,
  ]);

  const screenToWorld = (clientX: number, clientY: number): Point2D => {
    const rect = stageRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const vp = liveViewportRef.current;
    return {
      x: (clientX - left - vp.panX) / vp.zoom,
      y: (clientY - top - vp.panY) / vp.zoom,
    };
  };

  const layerMap = useMemo(() => {
    const map = new Map<string, { visible: boolean; locked: boolean }>();
    for (const l of board.layers) {
      map.set(l.id, { visible: l.visible, locked: l.locked });
    }
    return map;
  }, [board.layers]);

  const visibleObjects = useMemo(() => {
    return [...board.objects]
      .filter((o) => {
        const layer = layerMap.get(o.layerId);
        return layer ? layer.visible : true;
      })
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [board.objects, layerMap]);

  // OPT: 2.3 — Culling por viewport + caché de BBox sin afectar selección, edición ni exportación
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pinnedVisibleIds = useMemo(() => {
    const pinned = new Set<string>(selectedIds);
    if (editingTextId) pinned.add(editingTextId);
    if (editingEquationId) pinned.add(editingEquationId);
    if (editingDimensionId) pinned.add(editingDimensionId);
    if (editingTableId) pinned.add(editingTableId);
    return pinned;
  }, [selectedIds, editingTextId, editingEquationId, editingDimensionId, editingTableId]);

  const renderedObjects = useMemo(
    () =>
      filterVisibleObjectsInViewport(
        visibleObjects,
        board.viewport,
        stageSize.width,
        stageSize.height,
        pinnedVisibleIds,
        exportOrPrintActive
      ),
    [
      visibleObjects,
      board.viewport.panX,
      board.viewport.panY,
      board.viewport.zoom,
      stageSize.width,
      stageSize.height,
      pinnedVisibleIds,
      exportOrPrintActive,
    ]
  );

  useEffect(() => {
    setPerfCounts(visibleObjects.length, renderedObjects.length);
  }, [visibleObjects.length, renderedObjects.length]);

  const nextZIndex = useMemo(() => {
    return board.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
  }, [board.objects]);

  const isObjLocked = (obj: CanvasObject) => {
    const layer = layerMap.get(obj.layerId);
    return obj.locked || Boolean(layer?.locked);
  };

  // Mapea la herramienta activa o comando CAD para determinar si aplica ORT/SP o proporción 1:1
  const getActiveHerramientaResolver = (
    interactionModeOverride?: InteractionState['mode']
  ): HerramientaResolucionPunto => {
    const mode = interactionModeOverride ?? interaction.mode;
    if (mode === 'draw-line') {
      return toolOptions.lineKind === 'arrow' || toolOptions.lineKind === 'double-arrow'
        ? 'arrow'
        : 'line';
    }
    if (mode === 'draw-shape') {
      if (
        toolOptions.shapeKind === 'rectangle' ||
        toolOptions.shapeKind === 'triangle' ||
        toolOptions.shapeKind === 'ellipse' ||
        toolOptions.shapeKind === 'polygon'
      ) {
        return toolOptions.shapeKind;
      }
      return 'shape';
    }
    if (cadSession.activeCommand) {
      if (cadSession.activeCommand === 'line' || cadSession.activeCommand === 'pline') {
        return cadSession.activeCommand;
      }
      if (
        cadSession.activeCommand === 'rectangle' ||
        cadSession.activeCommand === 'circle' ||
        cadSession.activeCommand === 'arc' ||
        cadSession.activeCommand === 'polygon'
      ) {
        return cadSession.activeCommand;
      }
      if (cadSession.activeCommand.startsWith('dim-') || cadSession.activeCommand === 'mirror') {
        return 'measure';
      }
      return 'free';
    }
    if (activeTool === 'line') {
      return toolOptions.lineKind === 'arrow' || toolOptions.lineKind === 'double-arrow'
        ? 'arrow'
        : 'line';
    }
    if (activeTool === 'shape') {
      if (
        toolOptions.shapeKind === 'rectangle' ||
        toolOptions.shapeKind === 'triangle' ||
        toolOptions.shapeKind === 'ellipse' ||
        toolOptions.shapeKind === 'polygon'
      ) {
        return toolOptions.shapeKind;
      }
      if (toolOptions.shapeKind === 'polyline') {
        return 'pline';
      }
      return 'shape';
    }
    return 'free';
  };

  // Punto único de entrada hacia resolverPunto para previsualización y confirmación final
  const resolvePointWithCad = (
    puntoEntrada: Point2D,
    baseWorld: Point2D | null,
    shiftKey = false,
    isWorldInput = true,
    herramientaOverride?: HerramientaResolucionPunto,
    excludeObjectIds?: string[]
  ): CadResolvedCursor => {
    const herramienta = herramientaOverride ?? getActiveHerramientaResolver();
    const worldHintY = isWorldInput
      ? puntoEntrada.y
      : screenToWorld(puntoEntrada.x, puntoEntrada.y).y;
    const sheetOriginY = fixedPage
      ? getSnapOffsetYForWorld(worldHintY)
      : pageFrame
      ? pageFrame.y
      : 0;
    const vpNow = liveViewportRef.current;
    return resolverPunto(puntoEntrada, baseWorld, herramienta, {
      config: cadConfig,
      viewport: vpNow,
      stageRect: stageRef.current?.getBoundingClientRect() ?? null,
      isWorldInput,
      visibleObjects,
      zoom: vpNow.zoom,
      shapeKind: toolOptions.shapeKind,
      shiftKey,
      gridSnapOverride: board.snapToGrid,
      hoverRefSegment: hoverRefSegmentRef.current,
      hysteresisState: snapHysteresisRef.current,
      gridOriginWorld: fixedPage
        ? { x: pageFrame ? pageFrame.x : 0, y: sheetOriginY }
        : pageFrame
        ? { x: pageFrame.x, y: pageFrame.y }
        : null,
      boardGridStepWorld: gSize,
      trackingState:
        FEATURE_TRACKING_ENABLED && cadConfig.trackingEnabled
          ? trackingStateRef.current
          : null,
      excludeObjectIds,
      nowMs: Date.now(),
      onTrackingError,
    });
  };

  // En modo "Por adquisición", dispara una re-evaluación automática al cumplirse los 400 ms sin requerir otro movimiento
  const scheduleAcquireDwellIfNeeded = (
    baseWorld: Point2D | null,
    herramientaOverride?: HerramientaResolucionPunto,
    excludeObjectIds?: string[]
  ) => {
    const candId = trackingStateRef.current.hoverCandidateId;
    if (
      !FEATURE_TRACKING_ENABLED ||
      !cadConfig.trackingEnabled ||
      cadConfig.trackingMode !== 'acquire' ||
      !candId ||
      !lastPointerClientRef.current
    ) {
      clearAcquireDwellTimer();
      return;
    }
    if (acquireCandidateRef.current === candId && acquireTimerRef.current !== null) {
      return;
    }
    clearAcquireDwellTimer();
    acquireCandidateRef.current = candId;
    const elapsed = Date.now() - trackingStateRef.current.hoverStartMs;
    const delay = Math.max(20, 410 - elapsed);
    acquireTimerRef.current = window.setTimeout(() => {
      acquireTimerRef.current = null;
      acquireCandidateRef.current = null;
      const last = lastPointerClientRef.current;
      if (!last) return;
      const resolved = resolvePointWithCad(
        { x: last.clientX, y: last.clientY },
        baseWorld,
        last.shiftKey,
        false,
        herramientaOverride,
        excludeObjectIds
      );
      updateLiveCadCursor(resolved);
    }, delay);
  };

  const applyLegacyWheelZoom = (e: WheelEvent, rect: DOMRect) => {
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const vp = liveViewportRef.current;
    const factor = e.deltaY < 0 ? 1.09 : 1 / 1.09;
    const oldZoom = vp.zoom;
    const newZoom = clamp(oldZoom * factor, 0.12, 6);
    const worldX = (mouseX - vp.panX) / oldZoom;
    const worldY = (mouseY - vp.panY) / oldZoom;
    const nextVp = {
      panX: mouseX - worldX * newZoom,
      panY: mouseY - worldY * newZoom,
      zoom: newZoom,
    };
    liveViewportRef.current = nextVp;
    onUpdateViewport(nextVp);
    executeMoveForWheelRef.current();
  };

  const handleNativeWheel = (e: WheelEvent) => {
    try {
      // Si hay una ventana modal abierta, la rueda no debe afectar ni interceptar la pizarra
      if (hasOpenModal) return;

      // Si el cursor está dentro de un archivo importado, diálogo o texto editable con scroll real (sin Ctrl/Cmd), solo desplaza ese contenido
      if (shouldIgnoreCanvasWheel(e.target, e.ctrlKey, e.metaKey)) {
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;

      // En Espacio infinito o cuando el usuario desactiva la opción en Configuración, conserva el zoom directo con la rueda
      if (!fixedPage || !wheelScrollSheets) {
        cancelWheelAnimation();
        applyLegacyWheelZoom(e, rect);
        return;
      }

      onFirstFixedSheetWheel?.();

      const { dx, dy } = normalizeWheelDelta(e, rect.height);
      const isZoomGesture = e.ctrlKey || e.metaKey;

      if (isZoomGesture) {
        cancelWheelAnimation();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const vp = liveViewportRef.current;
        const oldZoom = vp.zoom;
        const zoomSteps = clamp(-dy / 100, -3, 3);
        const factor = Math.pow(1.09, zoomSteps);
        const newZoom = clamp(oldZoom * factor, 0.12, 6);
        const worldX = (mouseX - vp.panX) / oldZoom;
        const worldY = (mouseY - vp.panY) / oldZoom;
        const rawPanX = mouseX - worldX * newZoom;
        const rawPanY = mouseY - worldY * newZoom;

        const clamped = clampFixedBoardViewportPan(
          rawPanX,
          rawPanY,
          newZoom,
          fixedPage.width,
          fixedPage.height,
          sheets.length,
          rect.width,
          rect.height
        );

        const nextVp = clamped
          ? { panX: clamped.panX, panY: clamped.panY, zoom: newZoom }
          : { panX: rawPanX, panY: rawPanY, zoom: newZoom };

        liveViewportRef.current = nextVp;
        onUpdateViewport(nextVp);
        executeMoveForWheelRef.current();
        return;
      }

      const st = wheelAnimRef.current;
      const isActiveAnim = st.rafId !== null && st.boardId === board.id;
      const basePanX = isActiveAnim ? st.targetPanX : liveViewportRef.current.panX;
      const basePanY = isActiveAnim ? st.targetPanY : liveViewportRef.current.panY;
      const curZoom = liveViewportRef.current.zoom;

      const clampedTarget = clampFixedBoardViewportPan(
        basePanX - dx,
        basePanY - dy,
        curZoom,
        fixedPage.width,
        fixedPage.height,
        sheets.length,
        rect.width,
        rect.height
      );

      if (!clampedTarget) {
        cancelWheelAnimation();
        applyLegacyWheelZoom(e, rect);
        return;
      }

      const startPanX = isActiveAnim ? st.currentPanX : liveViewportRef.current.panX;
      const startPanY = isActiveAnim ? st.currentPanY : liveViewportRef.current.panY;

      if (
        Math.abs(clampedTarget.panX - startPanX) < 0.25 &&
        Math.abs(clampedTarget.panY - startPanY) < 0.25
      ) {
        return;
      }

      st.boardId = board.id;
      st.zoom = curZoom;
      st.currentPanX = startPanX;
      st.currentPanY = startPanY;
      st.targetPanX = clampedTarget.panX;
      st.targetPanY = clampedTarget.panY;

      if (st.rafId === null) {
        st.lastTickTime = performance.now();
        const stepWheel = (now: number) => {
          try {
            const dt = Math.max(4, Math.min(48, now - st.lastTickTime));
            st.lastTickTime = now;
            // Interpolación suave (~90 ms) sin retraso inicial ni rebotes
            const alpha = 1 - Math.exp(-dt / 24);
            const remX = st.targetPanX - st.currentPanX;
            const remY = st.targetPanY - st.currentPanY;
            const done = Math.hypot(remX, remY) < 0.45;
            const nextPanX = done ? st.targetPanX : st.currentPanX + remX * alpha;
            const nextPanY = done ? st.targetPanY : st.currentPanY + remY * alpha;
            st.currentPanX = nextPanX;
            st.currentPanY = nextPanY;

            const nextVp = { panX: nextPanX, panY: nextPanY, zoom: st.zoom };
            liveViewportRef.current = nextVp;
            onUpdateViewport(nextVp);
            executeMoveForWheelRef.current();

            if (done) {
              st.rafId = null;
            } else {
              st.rafId = requestAnimationFrame(stepWheel);
            }
          } catch (animErr) {
            console.error('[Ábaco] Error durante desplazamiento suave con rueda:', animErr);
            st.rafId = null;
          }
        };
        st.rafId = requestAnimationFrame(stepWheel);
      }
    } catch (err) {
      console.error('[Ábaco] Error al procesar rueda del ratón, restaurando comportamiento anterior:', err);
      cancelWheelAnimation();
      try {
        const rect = stageRef.current?.getBoundingClientRect();
        if (rect && !hasOpenModal) {
          e.preventDefault();
          applyLegacyWheelZoom(e, rect);
        }
      } catch {
        // Ignorar fallo secundario
      }
    }
  };

  const nativeWheelRef = useRef(handleNativeWheel);
  nativeWheelRef.current = handleNativeWheel;

  // Registra el listener de rueda con { passive: false } para poder alternar entre scroll interno y zoom Ctrl+rueda
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const listener = (ev: WheelEvent) => nativeWheelRef.current(ev);
    el.addEventListener('wheel', listener, { passive: false });
    return () => {
      el.removeEventListener('wheel', listener);
    };
  }, [stageRef]);

  // Ejecuta el borrado parcial continuo entre la posición anterior y la actual en coordenadas del mundo
  const sweepEraserTo = (wp: Point2D, isInitialPoint = false) => {
    const threshold = toolOptions.eraserRadius / board.viewport.zoom;
    const prevWorld = isInitialPoint ? wp : eraserLastWorldRef.current ?? wp;
    eraserLastWorldRef.current = wp;
    onEraserSweep(prevWorld, wp, threshold);
  };

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setElementMenuAnchor(null);

    if (areaExportMode) {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setAreaDrag({
        startClient: { x: e.clientX, y: e.clientY },
        currentClient: { x: e.clientX, y: e.clientY },
      });
      return;
    }

    if (editingTextId) {
      onSetEditingTextId(null);
    }
    if (editingEquationId) {
      onUpdateObjects([editingEquationId], (o) => o, true);
      onSetEditingEquationId(null);
    }

    if (editingDimensionId) {
      onSetEditingDimensionId?.(null);
    }

    if (editingTableId || editingTableCell) {
      onSetEditingTableCell?.(null, null);
    }

    const world = screenToWorld(e.clientX, e.clientY);

    // Middle mouse or Hand tool or Spacebar -> Pan
    if (e.button === 1 || activeTool === 'hand' || spacePressed) {
      cancelWheelAnimation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setInteraction({
        mode: 'pan',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: world,
        startViewport: board.viewport,
      });
      return;
    }

    if (e.button !== 0) return;

    // Colocación interactiva de tabla donde el usuario haga clic
    if (pendingTableSize && onPlacePendingTable) {
      e.preventDefault();
      const sx = snapValue(world.x, gSize, board.snapToGrid, snapOffsetX);
      const sy = snapValue(world.y, gSize, board.snapToGrid, getSnapOffsetYForWorld(world.y));
      onPlacePendingTable({ x: sx, y: sy });
      return;
    }

    // Interactive Canvas Pick for Polar/Path Array Modal
    if (arrayPickMode) {
      e.preventDefault();
      const resolved = resolvePointWithCad({ x: e.clientX, y: e.clientY }, null, e.shiftKey, false);
      const pickRadius = 16 / Math.max(0.2, board.viewport.zoom);
      let pickedId: string | null = null;
      if (arrayPickMode === 'path-object') {
        const nonSelected = visibleObjects.filter((o) => !selectedIds.includes(o.id));
        pickedId =
          (resolved.snap?.objectId && !selectedIds.includes(resolved.snap.objectId)
            ? resolved.snap.objectId
            : null) ??
          findObjectNearWorldPoint(resolved.world, nonSelected, pickRadius)?.id ??
          resolved.snap?.objectId ??
          findObjectNearWorldPoint(resolved.world, visibleObjects, pickRadius)?.id ??
          null;
      } else {
        pickedId =
          resolved.snap?.objectId ??
          findObjectNearWorldPoint(resolved.world, visibleObjects, pickRadius)?.id ??
          null;
      }
      onArrayPickCanvas?.(resolved.world, pickedId);
      return;
    }

    // CAD Pick Origin Mode
    if (cadSession.pickingOrigin) {
      e.preventDefault();
      const resolved = resolvePointWithCad({ x: e.clientX, y: e.clientY }, null, e.shiftKey, false);
      onCadPickPoint(resolved.world, resolved.snap?.objectId ?? null);
      return;
    }

    // Active CAD Precision Command Mode
    if (cadSession.activeCommand) {
      e.preventDefault();
      if (
        e.detail >= 2 &&
        cadSession.activeCommand === 'pline' &&
        cadSession.points.length >= 2
      ) {
        onCadFinishSession(false);
        return;
      }
      const baseWorld = getCadBasePoint(cadSession);
      const resolved = resolvePointWithCad(
        { x: e.clientX, y: e.clientY },
        baseWorld,
        e.shiftKey,
        false
      );
      const pickedId =
        resolved.snap?.objectId ??
        findObjectNearWorldPoint(
          resolved.world,
          visibleObjects,
          16 / Math.max(0.2, board.viewport.zoom)
        )?.id ??
        null;
      snapHysteresisRef.current = {};
      onCadPickPoint(resolved.world, pickedId);
      return;
    }

    // Polyline multi-click CAD mode
    if (activeTool === 'shape' && toolOptions.shapeKind === 'polyline') {
      e.preventDefault();
      const resolved = resolvePointWithCad({ x: e.clientX, y: e.clientY }, null, e.shiftKey, false);
      snapHysteresisRef.current = {};
      onCadQuickStart('pline', resolved.world);
      return;
    }

    // Pen Tool (por defecto guías solo visuales; si trackingSnapFreehand está activo, ajusta al punto resuelto)
    if (activeTool === 'pen') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const pressure = pressureSensitivity && e.pressure > 0 ? e.pressure : 0.5;
      const resolved = resolvePointWithCad(
        { x: e.clientX, y: e.clientY },
        null,
        e.shiftKey,
        false,
        'free'
      );
      updateLiveCadCursor(resolved);
      const startPt =
        cadConfig.trackingEnabled &&
        cadConfig.trackingSnapFreehand &&
        resolved.tracking?.snappedPoint
          ? resolved.tracking.snappedPoint
          : world;
      setInteraction({
        mode: 'pen',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: startPt,
        startViewport: board.viewport,
        draftPoints: [{ x: startPt.x, y: startPt.y, pressure }],
      });
      return;
    }

    // Herramienta Borrador parcial (inicia pasada atómica para deshacer en 1 paso)
    if (activeTool === 'eraser') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onStartEraserPass();
      sweepEraserTo(world, true);
      setInteraction({
        mode: 'eraser',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: world,
        startViewport: board.viewport,
      });
      return;
    }

    // Herramienta Texto: permite clic simple (ancho automático) o arrastre (ancho fijo)
    if (activeTool === 'text') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const sx = snapValue(world.x, gSize, board.snapToGrid, snapOffsetX);
      const sy = snapValue(world.y, gSize, board.snapToGrid, getSnapOffsetYForWorld(world.y));
      setInteraction({
        mode: 'draw-text',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: { x: sx, y: sy },
        currentWorld: { x: sx, y: sy },
        startViewport: board.viewport,
      });
      return;
    }

    // Sticky Note Tool
    if (activeTool === 'sticky') {
      e.preventDefault();
      const sx = snapValue(world.x - 105, gSize, board.snapToGrid, snapOffsetX);
      const sy = snapValue(
        world.y - 80,
        gSize,
        board.snapToGrid,
        getSnapOffsetYForWorld(world.y - 80)
      );
      const stickyObj: StickyObject = {
        id: uid('stk'),
        type: 'sticky',
        layerId: board.activeLayerId,
        x: sx,
        y: sy,
        width: 210,
        height: 155,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: nextZIndex,
        content: 'Nueva nota...',
        backgroundColor: toolOptions.stickyColor,
        textColor: '#1e293b',
        fontSize: 14,
      };
      onAddObject(stickyObj);
      onSelectIds([stickyObj.id]);
      onSetEditingTextId(stickyObj.id);
      onSwitchToSelect();
      return;
    }

    // Inicio de arrastre de figuras (primer punto resuelto con la función centralizada)
    if (activeTool === 'shape') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      snapHysteresisRef.current = {};
      const resolved = resolvePointWithCad(
        { x: e.clientX, y: e.clientY },
        null,
        e.shiftKey,
        false,
        getActiveHerramientaResolver('draw-shape')
      );
      updateLiveCadCursor(resolved);
      setInteraction({
        mode: 'draw-shape',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: resolved.world,
        currentWorld: resolved.world,
        startViewport: board.viewport,
        shiftKey: e.shiftKey,
      });
      return;
    }

    // Inicio de arrastre de líneas/flechas (primer punto resuelto con la función centralizada)
    if (activeTool === 'line') {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      snapHysteresisRef.current = {};
      const resolved = resolvePointWithCad(
        { x: e.clientX, y: e.clientY },
        null,
        e.shiftKey,
        false,
        getActiveHerramientaResolver('draw-line')
      );
      updateLiveCadCursor(resolved);
      setInteraction({
        mode: 'draw-line',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: resolved.world,
        currentWorld: resolved.world,
        startViewport: board.viewport,
        shiftKey: e.shiftKey,
      });
      return;
    }

    // Equation Tool (click to place and immediately edit in real time on the board)
    if (activeTool === 'equation') {
      e.preventDefault();
      const sx = snapValue(world.x, gSize, board.snapToGrid, snapOffsetX);
      const sy = snapValue(world.y, gSize, board.snapToGrid, getSnapOffsetYForWorld(world.y));
      const eqObj: EquationObject = {
        id: uid('eq'),
        type: 'equation',
        layerId: board.activeLayerId,
        x: sx,
        y: sy,
        width: 220,
        height: 76,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: nextZIndex,
        latex: '\\square',
        fontSize: 24,
        color: toolOptions.textColor || '#0f172a',
        backgroundColor: 'transparent',
      };
      onAddObject(eqObj);
      onSelectIds([eqObj.id]);
      onEquationCursorChange({ path: [], offset: 0 });
      onSetEditingEquationId(eqObj.id);
      onSwitchToSelect();
      return;
    }

    // Cut / Trim Tool
    if (activeTool === 'cut') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setTrimPreview(null);
      setInteraction({
        mode: 'draw-cut',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentWorld: world,
        startViewport: board.viewport,
      });
      return;
    }

    // Select Tool -> Empty Canvas Marquee
    if (activeTool === 'select') {
      if (!e.shiftKey) {
        onSelectIds([]);
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setInteraction({
        mode: 'marquee',
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: world,
        currentWorld: world,
        startViewport: board.viewport,
      });
    }
  };

  // OPT: 2.1 — Procesamiento de movimiento coalescido (por defecto en rAF; síncrono si se desactiva la bandera)
  const executeImmediateInteractiveMove = (pending: {
    clientX: number;
    clientY: number;
    shiftKey: boolean;
    pressure?: number;
  }) => {
    const world = screenToWorld(pending.clientX, pending.clientY);

    if (interaction.mode === 'pan') {
      const dx = pending.clientX - interaction.startClient.x;
      const dy = pending.clientY - interaction.startClient.y;
      onUpdateViewport({
        ...interaction.startViewport,
        panX: interaction.startViewport.panX + dx,
        panY: interaction.startViewport.panY + dy,
      });
      return;
    }

    if (interaction.mode === 'pen') {
      const samples =
        pendingPenSamplesRef.current.length > 0
          ? pendingPenSamplesRef.current
          : [
              {
                clientX: pending.clientX,
                clientY: pending.clientY,
                shiftKey: pending.shiftKey,
                pressure: pending.pressure ?? 0.5,
              },
            ];
      pendingPenSamplesRef.current = [];
      const lastSample = samples[samples.length - 1];
      lastPointerClientRef.current = {
        clientX: lastSample.clientX,
        clientY: lastSample.clientY,
        shiftKey: lastSample.shiftKey,
      };
      const resolved = resolvePointWithCad(
        { x: lastSample.clientX, y: lastSample.clientY },
        null,
        lastSample.shiftKey,
        false,
        'free'
      );
      updateLiveCadCursor(resolved);
      scheduleAcquireDwellIfNeeded(null, 'free');

      const appendedPoints = samples.map((s, idx) => {
        if (
          idx === samples.length - 1 &&
          cadConfig.trackingEnabled &&
          cadConfig.trackingSnapFreehand &&
          resolved.tracking?.snappedPoint
        ) {
          return {
            x: resolved.tracking.snappedPoint.x,
            y: resolved.tracking.snappedPoint.y,
            pressure: s.pressure,
          };
        }
        const sw = screenToWorld(s.clientX, s.clientY);
        return { x: sw.x, y: sw.y, pressure: s.pressure };
      });
      setInteraction((prev) => ({
        ...prev,
        draftPoints: [...(prev.draftPoints || []), ...appendedPoints],
      }));
      return;
    }

    if (interaction.mode === 'eraser') {
      setEraserCursor(world);
      sweepEraserTo(world, false);
      return;
    }

    if (
      interaction.mode === 'none' ||
      interaction.mode === 'draw-shape' ||
      interaction.mode === 'draw-line' ||
      interaction.mode === 'draw-text' ||
      interaction.mode === 'draw-cut' ||
      interaction.mode === 'marquee'
    ) {
      const dragBase =
        interaction.mode === 'draw-line' || interaction.mode === 'draw-shape'
          ? interaction.startWorld
          : null;
      const baseWorld = cadSession.activeCommand ? getCadBasePoint(cadSession) : dragBase;

      if (
        cadConfig.osnapEnabled &&
        cadConfig.osnapModes.parallel &&
        (cadSession.activeCommand || dragBase)
      ) {
        const hoveredSeg = findNearestSegmentToPoint(
          world,
          visibleObjects,
          12 / Math.max(0.2, board.viewport.zoom)
        );
        if (hoveredSeg) {
          hoverRefSegmentRef.current = hoveredSeg;
        }
      }

      lastPointerClientRef.current = pending;

      const resolved = resolvePointWithCad(
        { x: pending.clientX, y: pending.clientY },
        baseWorld,
        pending.shiftKey,
        false,
        activeTool === 'pen' ? 'free' : undefined
      );
      updateLiveCadCursor(resolved);
      scheduleAcquireDwellIfNeeded(baseWorld, activeTool === 'pen' ? 'free' : undefined);
      onCursorMove(resolved.world);

      if (activeTool === 'eraser') {
        setEraserCursor(world);
      } else if (eraserCursor) {
        setEraserCursor(null);
      }

      if (activeTool === 'cut' && interaction.mode === 'none') {
        const unlockedVisible = visibleObjects.filter((o) => !isObjLocked(o));
        const preview = computeAutoTrimAtPoint(
          world,
          unlockedVisible,
          14 / board.viewport.zoom,
          nextZIndex
        );
        setTrimPreview(preview);
      }

      if (interaction.mode === 'draw-cut') {
        setInteraction((prev) => ({ ...prev, currentWorld: world }));
        return;
      }

      if (interaction.mode === 'draw-shape' || interaction.mode === 'draw-line') {
        setInteraction((prev) => ({
          ...prev,
          currentWorld: resolved.world,
          shiftKey: pending.shiftKey,
        }));
        return;
      }

      if (interaction.mode === 'marquee') {
        setInteraction((prev) => ({ ...prev, currentWorld: world }));
        return;
      }

      if (interaction.mode === 'draw-text') {
        const sx = snapValue(world.x, gSize, board.snapToGrid, snapOffsetX);
        const sy = snapValue(world.y, gSize, board.snapToGrid, getSnapOffsetYForWorld(world.y));
        setInteraction((prev) => ({ ...prev, currentWorld: { x: sx, y: sy } }));
      }
      return;
    }

    if (interaction.mode === 'drag-objects' && interaction.initialObjects) {
      if (
        !hasMovedRef.current &&
        Math.hypot(
          pending.clientX - interaction.startClient.x,
          pending.clientY - interaction.startClient.y
        ) < 3
      ) {
        return;
      }
      hasMovedRef.current = true;
      const ids = Object.keys(interaction.initialObjects);
      lastPointerClientRef.current = {
        clientX: pending.clientX,
        clientY: pending.clientY,
        shiftKey: pending.shiftKey,
      };
      const resolved =
        cadConfig.trackingEnabled || cadConfig.osnapEnabled || cadConfig.ortho || cadConfig.polar
          ? resolvePointWithCad(
              { x: pending.clientX, y: pending.clientY },
              interaction.startWorld,
              pending.shiftKey,
              false,
              'free',
              ids
            )
          : null;
      if (resolved) {
        updateLiveCadCursor(resolved);
        scheduleAcquireDwellIfNeeded(interaction.startWorld, 'free', ids);
      }
      const useResolvedDelta = Boolean(
        resolved && (resolved.snap || resolved.tracking?.snappedPoint || resolved.guide)
      );
      const dx =
        (useResolvedDelta && resolved ? resolved.world.x : world.x) - interaction.startWorld.x;
      const dy =
        (useResolvedDelta && resolved ? resolved.world.y : world.y) - interaction.startWorld.y;
      onUpdateObjects(
        ids,
        (obj) => {
          const init = interaction.initialObjects![obj.id];
          if (!init) return obj;
          const nx = useResolvedDelta
            ? init.x + dx
            : snapValue(init.x + dx, gSize, board.snapToGrid, snapOffsetX);
          const ny = useResolvedDelta
            ? init.y + dy
            : snapValue(init.y + dy, gSize, board.snapToGrid, getSnapOffsetYForWorld(init.y + dy));
          if (obj.type === 'dimension' && init.p1 && init.p2 && init.offsetPt) {
            const ddx = nx - init.x;
            const ddy = ny - init.y;
            return {
              ...obj,
              x: nx,
              y: ny,
              p1: { x: init.p1.x + ddx, y: init.p1.y + ddy },
              p2: { x: init.p2.x + ddx, y: init.p2.y + ddy },
              p3: init.p3 ? { x: init.p3.x + ddx, y: init.p3.y + ddy } : undefined,
              offsetPt: { x: init.offsetPt.x + ddx, y: init.offsetPt.y + ddy },
            };
          }
          return {
            ...obj,
            x: nx,
            y: ny,
          };
        },
        false
      );
      return;
    }

    if (
      interaction.mode === 'resize' &&
      interaction.targetId &&
      interaction.handleDir &&
      interaction.initialObjects
    ) {
      const init = interaction.initialObjects[interaction.targetId];
      if (!init) return;
      hasMovedRef.current = true;
      const dx = world.x - interaction.startWorld.x;
      const dy = world.y - interaction.startWorld.y;
      const dir = interaction.handleDir;
      let nextX = init.x;
      let nextY = init.y;
      let nextW = init.width;
      let nextH = init.height;
      let flippedX = false;
      let flippedY = false;

      if (dir.includes('e')) {
        const rawW = init.width + dx;
        if (init.isShape && rawW < 0) {
          flippedX = true;
          nextW = Math.max(20, -rawW);
          nextX = init.x - nextW;
        } else {
          nextW = Math.max(20, rawW);
        }
      }
      if (dir.includes('s')) {
        const rawH = init.height + dy;
        if (init.isShape && rawH < 0) {
          flippedY = true;
          nextH = Math.max(20, -rawH);
          nextY = init.y - nextH;
        } else {
          nextH = Math.max(20, rawH);
        }
      }
      if (dir.includes('w')) {
        const rawW = init.width - dx;
        if (init.isShape && rawW < 0) {
          flippedX = true;
          nextW = Math.max(20, -rawW);
          nextX = init.x + init.width;
        } else {
          const candW = Math.max(20, rawW);
          nextX = init.x + (init.width - candW);
          nextW = candW;
        }
      }
      if (dir.includes('n')) {
        const rawH = init.height - dy;
        if (init.isShape && rawH < 0) {
          flippedY = true;
          nextH = Math.max(20, -rawH);
          nextY = init.y + init.height;
        } else {
          const candH = Math.max(20, rawH);
          nextY = init.y + (init.height - candH);
          nextH = candH;
        }
      }

      if (
        pending.shiftKey &&
        (dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw')
      ) {
        const ratio = init.height / Math.max(1, init.width);
        nextH = Math.max(20, Math.round(nextW * ratio));
        if (dir.includes('n') && !flippedY) {
          nextY = init.y + (init.height - nextH);
        } else if (dir.includes('s') && flippedY) {
          nextY = init.y - nextH;
        }
      }

      let enforcedMinTextHeight = resizeTextMinHeightRef.current;
      const objHost = stageRef.current?.querySelector(
        `[data-canvas-obj-id="${interaction.targetId}"]`
      ) as HTMLElement | null;
      const measureEl = objHost?.querySelector(
        '[data-rt-content-measure="true"]'
      ) as HTMLElement | null;
      if (measureEl) {
        enforcedMinTextHeight = Math.max(36, Math.ceil(measureEl.offsetHeight + 4));
      }

      onUpdateObjects(
        [interaction.targetId],
        (obj) => {
          const sx = nextW / Math.max(1, init.width);
          const sy = nextH / Math.max(1, init.height);
          const updatedBase = {
            ...obj,
            x: snapValue(nextX, gSize, board.snapToGrid, snapOffsetX),
            y: snapValue(nextY, gSize, board.snapToGrid, getSnapOffsetYForWorld(nextY)),
            width: nextW,
            height: nextH,
          };
          if (updatedBase.type === 'shape') {
            return {
              ...updatedBase,
              customVertices: init.customVertices?.map((p) => ({ x: p.x * sx, y: p.y * sy })),
              customPoints: init.customPoints?.map((p) => ({ x: p.x * sx, y: p.y * sy })),
              flipX: flippedX ? !init.flipX : init.flipX,
              flipY: flippedY ? !init.flipY : init.flipY,
            };
          }
          if (updatedBase.type === 'line') {
            return {
              ...updatedBase,
              startPoint: init.startPoint
                ? { x: init.startPoint.x * sx, y: init.startPoint.y * sy }
                : updatedBase.startPoint,
              endPoint: init.endPoint
                ? { x: init.endPoint.x * sx, y: init.endPoint.y * sy }
                : updatedBase.endPoint,
              controlPoint: init.controlPoint
                ? { x: init.controlPoint.x * sx, y: init.controlPoint.y * sy }
                : updatedBase.controlPoint,
            };
          }
          if (updatedBase.type === 'text') {
            const clampedW = Math.max(64, nextW);
            const clampedH = Math.max(enforcedMinTextHeight, nextH);
            const adjustedY =
              dir.includes('n') && clampedH > nextH
                ? init.y + (init.height - clampedH)
                : nextY;
            const adjustedX =
              dir.includes('w') && clampedW > nextW
                ? init.x + (init.width - clampedW)
                : nextX;
            const touchedWidth = dir.includes('e') || dir.includes('w');
            const nextMode = touchedWidth ? 'fixed' : resolveTextWidthMode(updatedBase);
            return {
              ...updatedBase,
              x: snapValue(adjustedX, gSize, board.snapToGrid, snapOffsetX),
              y: snapValue(adjustedY, gSize, board.snapToGrid, getSnapOffsetYForWorld(adjustedY)),
              width: clampedW,
              height: clampedH,
              widthMode: nextMode,
              autoWidth: nextMode === 'auto',
            };
          }
          if (updatedBase.type === 'table') {
            const scaled = scaleTableToDimensions(updatedBase as TableObject, nextW, nextH);
            return {
              ...scaled,
              x: dir.includes('w') ? init.x + (init.width - scaled.width) : scaled.x,
              y: dir.includes('n') ? init.y + (init.height - scaled.height) : scaled.y,
            };
          }
          return updatedBase;
        },
        false
      );
      return;
    }

    if (
      interaction.mode === 'drag-vertex' &&
      interaction.targetId &&
      interaction.vertexIndex !== undefined &&
      interaction.initialWorldVertices
    ) {
      hasMovedRef.current = true;
      const targetVertIdx = interaction.vertexIndex;
      const baseVtx =
        interaction.vertexMode === 'polyline' && targetVertIdx > 0
          ? interaction.initialWorldVertices[targetVertIdx - 1]
          : interaction.initialWorldVertices[targetVertIdx];
      const vtxTool: HerramientaResolucionPunto =
        interaction.vertexMode === 'polyline' ? 'pline' : 'free';
      lastPointerClientRef.current = {
        clientX: pending.clientX,
        clientY: pending.clientY,
        shiftKey: pending.shiftKey,
      };
      const resolvedVtx = resolvePointWithCad(
        { x: pending.clientX, y: pending.clientY },
        baseVtx,
        pending.shiftKey,
        false,
        vtxTool,
        [interaction.targetId]
      );
      updateLiveCadCursor(resolvedVtx);
      scheduleAcquireDwellIfNeeded(baseVtx, vtxTool, [interaction.targetId]);
      const sx = resolvedVtx.world.x;
      const sy = resolvedVtx.world.y;
      const updatedVerts = interaction.initialWorldVertices.map((pt, i) =>
        i === targetVertIdx ? { x: sx, y: sy } : pt
      );

      onUpdateObjects(
        [interaction.targetId],
        (obj) => {
          if (obj.type !== 'shape') return obj;
          if (
            interaction.vertexMode === 'solid-3d' &&
            interaction.solidHandle &&
            interaction.initialObjects?.[obj.id]
          ) {
            const init = interaction.initialObjects[obj.id];
            const hMeta = interaction.solidHandle;
            const pad = obj.strokeWidth / 2 + 2;
            const minIW = Math.max(8, 24 - pad * 2);
            const minIH = Math.max(8, 24 - pad * 2);
            const isRotated = Math.abs(init.rotation || 0) >= 1e-4;
            const targetPt = isRotated
              ? (() => {
                  const lp = worldToLocal({ x: sx, y: sy }, init);
                  return { x: init.x + lp.x, y: init.y + lp.y };
                })()
              : { x: sx, y: sy };

            let nx = init.x;
            let ny = init.y;
            let nw = init.width;
            let nh = init.height;
            let nextFlipX = Boolean(init.flipX);
            let nextFlipY = Boolean(init.flipY);

            if (hMeta.roleX === 'left') {
              const rightEdge = init.x + init.width;
              const innerRight = rightEdge - pad;
              const denomX = Math.max(0.15, 1 - hMeta.alphaX);
              const signedIW = (innerRight - targetPt.x) / denomX;
              if (signedIW < 0) {
                nextFlipX = !init.flipX;
                const nextIW = Math.max(minIW, (targetPt.x - innerRight) / denomX);
                nw = nextIW + pad * 2;
                nx = innerRight - pad;
              } else {
                const nextIW = Math.max(minIW, signedIW);
                nw = nextIW + pad * 2;
                nx = rightEdge - nw;
              }
            } else if (hMeta.roleX === 'right') {
              const innerLeft = init.x + pad;
              const denomX = Math.max(0.15, hMeta.alphaX);
              const signedIW = (targetPt.x - innerLeft) / denomX;
              if (signedIW < 0) {
                nextFlipX = !init.flipX;
                const nextIW = Math.max(minIW, (innerLeft - targetPt.x) / denomX);
                nw = nextIW + pad * 2;
                nx = innerLeft + pad - nw;
              } else {
                const nextIW = Math.max(minIW, signedIW);
                nw = nextIW + pad * 2;
              }
            }

            if (hMeta.roleY === 'top') {
              const bottomEdge = init.y + init.height;
              const innerBottom = bottomEdge - pad;
              const denomY = Math.max(0.15, 1 - hMeta.alphaY);
              const signedIH = (innerBottom - targetPt.y) / denomY;
              if (signedIH < 0) {
                nextFlipY = !init.flipY;
                const nextIH = Math.max(minIH, (targetPt.y - innerBottom) / denomY);
                nh = nextIH + pad * 2;
                ny = innerBottom - pad;
              } else {
                const nextIH = Math.max(minIH, signedIH);
                nh = nextIH + pad * 2;
                ny = bottomEdge - nh;
              }
            } else if (hMeta.roleY === 'bottom') {
              const innerTop = init.y + pad;
              const denomY = Math.max(0.15, hMeta.alphaY);
              const signedIH = (targetPt.y - innerTop) / denomY;
              if (signedIH < 0) {
                nextFlipY = !init.flipY;
                const nextIH = Math.max(minIH, (innerTop - targetPt.y) / denomY);
                nh = nextIH + pad * 2;
                ny = innerTop + pad - nh;
              } else {
                const nextIH = Math.max(minIH, signedIH);
                nh = nextIH + pad * 2;
              }
            }

            let finalX = nx;
            let finalY = ny;
            if (isRotated) {
              const rad = ((init.rotation || 0) * Math.PI) / 180;
              const cos = Math.cos(rad);
              const sin = Math.sin(rad);
              const dCx = nx + nw / 2 - (init.x + init.width / 2);
              const dCy = ny + nh / 2 - (init.y + init.height / 2);
              const wCx = init.x + init.width / 2 + (dCx * cos - dCy * sin);
              const wCy = init.y + init.height / 2 + (dCx * sin + dCy * cos);
              finalX = wCx - nw / 2;
              finalY = wCy - nh / 2;
            }

            return {
              ...obj,
              x: finalX,
              y: finalY,
              width: nw,
              height: nh,
              flipX: nextFlipX,
              flipY: nextFlipY,
            };
          }
          if (interaction.vertexMode === 'ellipse-cardinal' && interaction.initialObjects?.[obj.id]) {
            const init = interaction.initialObjects[obj.id];
            const pad = obj.strokeWidth / 2 + 2;
            let nx = init.x;
            let ny = init.y;
            let nw = init.width;
            let nh = init.height;
            if (targetVertIdx === 0) {
              const bot = init.y + init.height;
              ny = Math.min(bot - 20, sy - pad);
              nh = bot - ny;
            } else if (targetVertIdx === 1) {
              nw = Math.max(20, sx + pad - init.x);
            } else if (targetVertIdx === 2) {
              nh = Math.max(20, sy + pad - init.y);
            } else if (targetVertIdx === 3) {
              const right = init.x + init.width;
              nx = Math.min(right - 20, sx - pad);
              nw = right - nx;
            }
            return { ...obj, x: nx, y: ny, width: nw, height: nh };
          }
          if (interaction.vertexMode === 'polyline') {
            return buildPolylineShapeFromWorldPoints(obj, updatedVerts, obj.id, obj.zIndex);
          }
          if (interaction.vertexMode === 'curve') {
            const pad = obj.strokeWidth / 2 + 2;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const p of updatedVerts) {
              minX = Math.min(minX, p.x);
              minY = Math.min(minY, p.y);
              maxX = Math.max(maxX, p.x);
              maxY = Math.max(maxY, p.y);
            }
            const x = minX - pad;
            const y = minY - pad;
            return {
              ...obj,
              shapeKind: 'curve',
              x,
              y,
              width: Math.max(16, maxX - minX + pad * 2),
              height: Math.max(16, maxY - minY + pad * 2),
              rotation: 0,
              customPoints: updatedVerts.map((p) => ({ x: p.x - x, y: p.y - y })),
            };
          }
          return buildShapeObjectFromWorldPolygon(obj, updatedVerts, obj.id, obj.zIndex);
        },
        false
      );
      return;
    }

    if (
      interaction.mode === 'drag-line-point' &&
      interaction.targetId &&
      interaction.linePointRole &&
      interaction.initialLinePoints
    ) {
      hasMovedRef.current = true;
      const initPts = interaction.initialLinePoints;
      const anchor =
        interaction.linePointRole === 'start'
          ? initPts.end
          : interaction.linePointRole === 'end'
          ? initPts.start
          : null;
      const lpTool: HerramientaResolucionPunto =
        interaction.linePointRole === 'control' ? 'free' : 'line';
      lastPointerClientRef.current = {
        clientX: pending.clientX,
        clientY: pending.clientY,
        shiftKey: pending.shiftKey,
      };
      const resolvedLp = resolvePointWithCad(
        { x: pending.clientX, y: pending.clientY },
        anchor,
        pending.shiftKey,
        false,
        lpTool,
        [interaction.targetId]
      );
      updateLiveCadCursor(resolvedLp);
      scheduleAcquireDwellIfNeeded(anchor, lpTool, [interaction.targetId]);

      let nextX = resolvedLp.world.x;
      let nextY = resolvedLp.world.y;

      if (
        pending.shiftKey &&
        anchor &&
        interaction.linePointRole !== 'control' &&
        !resolvedLp.snap &&
        !resolvedLp.tracking?.snappedPoint
      ) {
        const dx = nextX - anchor.x;
        const dy = nextY - anchor.y;
        const len = Math.hypot(dx, dy);
        if (len > 4) {
          const snapAng = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * (Math.PI / 12);
          nextX = anchor.x + len * Math.cos(snapAng);
          nextY = anchor.y + len * Math.sin(snapAng);
        }
      }

      const movedPt = { x: nextX, y: nextY };
      const s = interaction.linePointRole === 'start' ? movedPt : initPts.start;
      const end = interaction.linePointRole === 'end' ? movedPt : initPts.end;
      const ctrl = interaction.linePointRole === 'control' ? movedPt : initPts.control;

      onUpdateObjects(
        [interaction.targetId],
        (obj) => {
          if (obj.type !== 'line') return obj;
          return buildLineObjectFromWorldEndpoints(obj, s, end, obj.id, obj.zIndex, ctrl);
        },
        false
      );
      return;
    }

    if (interaction.mode === 'rotate' && interaction.targetId && interaction.initialObjects) {
      const init = interaction.initialObjects[interaction.targetId];
      if (!init) return;
      hasMovedRef.current = true;
      const cx = init.x + init.width / 2;
      const cy = init.y + init.height / 2;
      const angleRad = Math.atan2(world.y - cy, world.x - cx);
      let deg = (angleRad * 180) / Math.PI + 90;
      if (pending.shiftKey) {
        deg = Math.round(deg / 15) * 15;
      }
      onUpdateObjects(
        [interaction.targetId],
        (obj) => ({ ...obj, rotation: Math.round(deg) }),
        false
      );
      return;
    }

    if (
      interaction.mode === 'group-resize' &&
      interaction.handleDir &&
      interaction.groupBox &&
      interaction.groupFullObjects
    ) {
      hasMovedRef.current = true;
      const initBox = interaction.groupBox;
      const dx = world.x - interaction.startWorld.x;
      const dy = world.y - interaction.startWorld.y;
      const dir = interaction.handleDir;
      let nextX = initBox.x;
      let nextY = initBox.y;
      let nextW = initBox.width;
      let nextH = initBox.height;

      if (dir.includes('e')) {
        nextW = Math.max(20, initBox.width + dx);
      }
      if (dir.includes('s')) {
        nextH = Math.max(20, initBox.height + dy);
      }
      if (dir.includes('w')) {
        const candW = Math.max(20, initBox.width - dx);
        nextX = initBox.x + (initBox.width - candW);
        nextW = candW;
      }
      if (dir.includes('n')) {
        const candH = Math.max(20, initBox.height - dy);
        nextY = initBox.y + (initBox.height - candH);
        nextH = candH;
      }

      if (
        pending.shiftKey &&
        (dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw')
      ) {
        const ratio = initBox.height / Math.max(1, initBox.width);
        nextH = Math.max(20, nextW * ratio);
        if (dir.includes('n')) {
          nextY = initBox.y + (initBox.height - nextH);
        }
      }

      const nextBox: WorldBoxRect = {
        x: nextX,
        y: nextY,
        width: nextW,
        height: nextH,
      };
      const ids = Object.keys(interaction.groupFullObjects);
      onUpdateObjects(
        ids,
        (obj) => {
          const initObj = interaction.groupFullObjects![obj.id];
          if (!initObj) return obj;
          return scaleCanvasObjectInBox(initObj, initBox, nextBox, cadConfig, true);
        },
        false
      );
      return;
    }

    if (
      interaction.mode === 'group-rotate' &&
      interaction.groupPivot &&
      interaction.groupFullObjects
    ) {
      hasMovedRef.current = true;
      const pivot = interaction.groupPivot;
      const startAng = Math.atan2(
        interaction.startWorld.y - pivot.y,
        interaction.startWorld.x - pivot.x
      );
      const currAng = Math.atan2(world.y - pivot.y, world.x - pivot.x);
      let deltaDeg = ((currAng - startAng) * 180) / Math.PI;
      while (deltaDeg > 180) deltaDeg -= 360;
      while (deltaDeg < -180) deltaDeg += 360;
      if (pending.shiftKey) {
        deltaDeg = Math.round(deltaDeg / 15) * 15;
      } else {
        deltaDeg = Math.round(deltaDeg * 10) / 10;
      }
      setInteraction((prev) =>
        prev.mode === 'group-rotate' ? { ...prev, groupDeltaDeg: deltaDeg } : prev
      );
      const ids = Object.keys(interaction.groupFullObjects);
      onUpdateObjects(
        ids,
        (obj) => {
          const initObj = interaction.groupFullObjects![obj.id];
          if (!initObj) return obj;
          return rotateCanvasObjectAroundPivot(initObj, pivot, deltaDeg, cadConfig);
        },
        false
      );
    }
  };

  // Procesa la previsualización o arrastre agrupado por fotograma (rAF)
  processPendingMoveRef.current = () => {
    const pending = pendingPointerMoveRef.current;
    if (!pending) return;
    pendingPointerMoveRef.current = null;
    if (isPerfMonitorEnabled()) {
      const t0 = performance.now();
      executeImmediateInteractiveMove(pending);
      recordPerfAction('canvasRender', performance.now() - t0);
    } else {
      executeImmediateInteractiveMove(pending);
    }
  };

  // Recalcula previsualización, arrastre y rastreo RAS cuando la rueda desplaza o hace zoom sin mover el ratón
  executeMoveForWheelRef.current = () => {
    const last = lastPointerClientRef.current;
    if (!last || interaction.mode === 'pan') return;
    if (
      interaction.mode !== 'none' ||
      Boolean(cadSession.activeCommand) ||
      activeTool === 'cut' ||
      activeTool === 'eraser'
    ) {
      executeImmediateInteractiveMove({
        clientX: last.clientX,
        clientY: last.clientY,
        shiftKey: last.shiftKey,
      });
    } else {
      const resolved = resolvePointWithCad(
        { x: last.clientX, y: last.clientY },
        null,
        last.shiftKey,
        false,
        activeTool === 'pen' ? 'free' : undefined
      );
      onCursorMove(resolved.world);
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) {
      onPointerStageMove?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    if (areaExportMode && areaDrag) {
      setAreaDrag((prev) =>
        prev ? { ...prev, currentClient: { x: e.clientX, y: e.clientY } } : prev
      );
      return;
    }

    const pressure =
      interaction.mode === 'pen'
        ? pressureSensitivity && e.pressure > 0
          ? e.pressure
          : 0.5
        : undefined;
    const sample = {
      clientX: e.clientX,
      clientY: e.clientY,
      shiftKey: e.shiftKey,
      pressure,
    };

    const scheduleSingleRaf = () => {
      if (interaction.mode === 'pen') {
        pendingPenSamplesRef.current.push({
          clientX: sample.clientX,
          clientY: sample.clientY,
          shiftKey: sample.shiftKey,
          pressure: sample.pressure ?? 0.5,
        });
      }
      pendingPointerMoveRef.current = sample;
      if (rafMoveRef.current === null) {
        rafMoveRef.current = requestAnimationFrame(() => {
          rafMoveRef.current = null;
          processPendingMoveRef.current();
        });
      }
    };

    const legacyMoveFallback = () => {
      if (
        interaction.mode === 'none' ||
        interaction.mode === 'draw-shape' ||
        interaction.mode === 'draw-line' ||
        interaction.mode === 'draw-text' ||
        interaction.mode === 'draw-cut' ||
        interaction.mode === 'marquee'
      ) {
        pendingPointerMoveRef.current = sample;
        if (rafMoveRef.current === null) {
          rafMoveRef.current = requestAnimationFrame(() => {
            rafMoveRef.current = null;
            processPendingMoveRef.current();
          });
        }
        return;
      }
      executeImmediateInteractiveMove(sample);
    };

    // OPT: 2.1 — Coalescencia en un único ciclo requestAnimationFrame con respaldo automático
    safeRunOpt('rafCycle', scheduleSingleRaf, legacyMoveFallback);
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // Cancela cualquier rAF pendiente para resolver el punto final de forma síncrona y exacta
    const pendingBeforeUp = pendingPointerMoveRef.current;
    const pendingPenTail = pendingPenSamplesRef.current;
    if (rafMoveRef.current !== null) {
      cancelAnimationFrame(rafMoveRef.current);
      rafMoveRef.current = null;
    }
    pendingPointerMoveRef.current = null;
    pendingPenSamplesRef.current = [];

    if (areaExportMode && areaDrag) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const stageRect = stageRef.current?.getBoundingClientRect();
      const x1 = Math.min(areaDrag.startClient.x, areaDrag.currentClient.x);
      const y1 = Math.min(areaDrag.startClient.y, areaDrag.currentClient.y);
      const x2 = Math.max(areaDrag.startClient.x, areaDrag.currentClient.x);
      const y2 = Math.max(areaDrag.startClient.y, areaDrag.currentClient.y);
      setAreaDrag(null);
      if (stageRect && x2 - x1 >= 10 && y2 - y1 >= 10) {
        onCompleteAreaExport({
          x: Math.max(0, x1 - stageRect.left),
          y: Math.max(0, y1 - stageRect.top),
          width: Math.min(stageRect.width, x2 - stageRect.left) - Math.max(0, x1 - stageRect.left),
          height: Math.min(stageRect.height, y2 - stageRect.top) - Math.max(0, y1 - stageRect.top),
        });
      }
      return;
    }

    if (interaction.mode === 'none') return;

    if (interaction.mode === 'pen' && interaction.draftPoints && interaction.draftPoints.length > 0) {
      // OPT: 2.1 — Incorpora muestras finales del búfer antes de cerrar el trazo
      const flushedTail = pendingPenTail.map((s) => {
        const w = screenToWorld(s.clientX, s.clientY);
        return { x: w.x, y: w.y, pressure: s.pressure };
      });
      const pts =
        flushedTail.length > 0 ? [...interaction.draftPoints, ...flushedTail] : interaction.draftPoints;
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
      const w = Math.max(8, maxX - minX);
      const h = Math.max(8, maxY - minY);
      const localPts = pts.map((p) => ({
        x: p.x - minX,
        y: p.y - minY,
        pressure: p.pressure,
      }));
      const strokeObj: StrokeObject = {
        id: uid('str'),
        type: 'stroke',
        layerId: board.activeLayerId,
        x: minX,
        y: minY,
        width: w,
        height: h,
        rotation: 0,
        opacity: toolOptions.penOpacity,
        locked: false,
        zIndex: nextZIndex,
        points: localPts,
        color: toolOptions.penColor,
        strokeWidth: toolOptions.penWidth,
        strokeStyle: toolOptions.penStyle,
        isHighlighter: toolOptions.penHighlighter,
      };
      onAddObject(strokeObj);
    }

    if (interaction.mode === 'draw-shape') {
      const p1 = interaction.startWorld;
      const finalResolved = resolvePointWithCad(
        { x: e.clientX, y: e.clientY },
        p1,
        e.shiftKey,
        false,
        getActiveHerramientaResolver('draw-shape')
      );
      const p2 = finalResolved.world;
      const x = Math.min(p1.x, p2.x);
      const y = Math.min(p1.y, p2.y);
      const width = Math.abs(p2.x - p1.x);
      const height = Math.abs(p2.y - p1.y);

      // Tolerancia mínima para descartar figuras degeneradas (clic sin arrastre o lado ≈ 0)
      const stepWorld = cadDistToWorldDist(Math.max(0.01, cadConfig.snapStep || 10), cadConfig);
      const snapOn = cadConfig.gridSnap || board.snapToGrid;
      const minDegenerateTol = Math.max(3, snapOn ? Math.min(stepWorld * 0.5, 6) : 3);

      if (width >= minDegenerateTol && height >= minDegenerateTol) {
        const shapeObj: ShapeObject = {
          id: uid('shp'),
          type: 'shape',
          shapeKind: toolOptions.shapeKind,
          layerId: board.activeLayerId,
          x,
          y,
          width,
          height,
          rotation: 0,
          opacity: 1,
          locked: false,
          zIndex: nextZIndex,
          strokeColor: toolOptions.shapeStrokeColor,
          fillColor: toolOptions.shapeFillColor,
          strokeWidth: toolOptions.shapeStrokeWidth,
          strokeStyle: toolOptions.shapeStrokeStyle,
          cornerRadius: 0,
          polygonSides: toolOptions.polygonSides,
          arcStartAngle: 0,
          arcEndAngle: 220,
        };
        onAddObject(shapeObj);
        onSelectIds([shapeObj.id]);
        onSwitchToSelect();
      }
    }

    if (interaction.mode === 'draw-line') {
      const p1 = interaction.startWorld;
      const finalResolved = resolvePointWithCad(
        { x: e.clientX, y: e.clientY },
        p1,
        e.shiftKey,
        false,
        getActiveHerramientaResolver('draw-line')
      );
      const p2 = finalResolved.world;
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 3) {
        onCadQuickStart('line', p1);
        snapHysteresisRef.current = {};
        updateLiveCadCursor(null);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        setInteraction({
          mode: 'none',
          startClient: { x: 0, y: 0 },
          startWorld: { x: 0, y: 0 },
          startViewport: board.viewport,
        });
        return;
      }
      const minX = Math.min(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const width = Math.max(16, Math.abs(p2.x - p1.x));
      const height = Math.max(16, Math.abs(p2.y - p1.y));
      const startPt = { x: p1.x - minX, y: p1.y - minY };
      const endPt = { x: p2.x - minX, y: p2.y - minY };

      const lineObj: LineObject = {
        id: uid('line'),
        type: 'line',
        lineKind: toolOptions.lineKind,
        layerId: board.activeLayerId,
        x: minX,
        y: minY,
        width,
        height,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: nextZIndex,
        startPoint: startPt,
        endPoint: endPt,
        controlPoint:
          toolOptions.lineKind === 'connector'
            ? { x: (startPt.x + endPt.x) / 2, y: Math.min(startPt.y, endPt.y) - 40 }
            : undefined,
        strokeColor: toolOptions.shapeStrokeColor,
        strokeWidth: toolOptions.shapeStrokeWidth,
        strokeStyle:
          toolOptions.lineKind === 'dashed-line' ? 'dashed' : toolOptions.shapeStrokeStyle,
      };
      onAddObject(lineObj);
      onSelectIds([lineObj.id]);
      onSwitchToSelect();
    }

    if (interaction.mode === 'marquee') {
      const curW =
        interaction.currentWorld ??
        (pendingBeforeUp ? screenToWorld(pendingBeforeUp.clientX, pendingBeforeUp.clientY) : null);
      if (curW) {
        const x1 = Math.min(interaction.startWorld.x, curW.x);
        const y1 = Math.min(interaction.startWorld.y, curW.y);
        const x2 = Math.max(interaction.startWorld.x, curW.x);
        const y2 = Math.max(interaction.startWorld.y, curW.y);

        if (x2 - x1 > 4 || y2 - y1 > 4) {
          const hitSet = new Set<string>();
          const groups = board.groups ?? [];
          // OPT: 2.4 — Consulta espacial uniforme previa para lazo de selección
          const candidates = safeRunOpt(
            'spatialIndex',
            () => queryObjectsInWorldBox(visibleObjects, x1, y1, x2, y2),
            () => visibleObjects
          );
          for (const obj of candidates) {
            if (isObjLocked(obj)) continue;
            if (
              obj.x <= x2 &&
              obj.x + obj.width >= x1 &&
              obj.y <= y2 &&
              obj.y + obj.height >= y1
            ) {
              for (const gid of expandSelectionToGroups(obj, visibleObjects, groups)) {
                hitSet.add(gid);
              }
            }
          }
          onSelectIds(Array.from(hitSet));
        }
      }
    }

    if (interaction.mode === 'draw-cut' && interaction.currentWorld) {
      const p1 = interaction.startWorld;
      const p2 = interaction.currentWorld;
      const unlockedVisible = visibleObjects.filter((o) => !isObjLocked(o));
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) >= 8) {
        const plan = computeBladeCut(p1, p2, unlockedVisible, nextZIndex);
        if (plan.deleteIds.length > 0) {
          onApplyCutChanges(plan.deleteIds, plan.addObjects);
          onSwitchToSelect();
        }
      } else {
        const trim = computeAutoTrimAtPoint(
          p1,
          unlockedVisible,
          14 / board.viewport.zoom,
          nextZIndex
        );
        if (trim) {
          onApplyCutChanges([trim.targetId], trim.replacements);
          onSwitchToSelect();
        }
      }
    }

    if (interaction.mode === 'eraser') {
      sweepEraserTo(screenToWorld(e.clientX, e.clientY), false);
      eraserLastWorldRef.current = null;
      onEndEraserPass();
    }

    if (interaction.mode === 'draw-text') {
      const p1 = interaction.startWorld;
      const p2 = interaction.currentWorld ?? screenToWorld(e.clientX, e.clientY);
      const sx2 = snapValue(p2.x, gSize, board.snapToGrid, snapOffsetX);
      const sy2 = snapValue(p2.y, gSize, board.snapToGrid, getSnapOffsetYForWorld(p2.y));
      const dragDistScreen = Math.hypot(
        e.clientX - interaction.startClient.x,
        e.clientY - interaction.startClient.y
      );
      const rawW = Math.abs(sx2 - p1.x);
      const rawH = Math.abs(sy2 - p1.y);
      const isDragBox = dragDistScreen >= 8 && rawW >= 24;
      const defaultAutoHeight = Math.max(40, Math.round(toolOptions.textFontSize * 1.45 + 18));

      const textObj: TextObject = {
        id: uid('txt'),
        type: 'text',
        layerId: board.activeLayerId,
        x: isDragBox ? Math.min(p1.x, sx2) : p1.x,
        y: isDragBox ? Math.min(p1.y, sy2) : p1.y,
        width: isDragBox ? Math.max(80, Math.round(rawW)) : 160,
        height: isDragBox ? Math.max(defaultAutoHeight, Math.round(rawH)) : defaultAutoHeight,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: nextZIndex,
        content: 'Escribe aquí...',
        fontFamily: 'sans',
        fontSize: toolOptions.textFontSize,
        bold: false,
        italic: false,
        underline: false,
        align: 'left',
        color: toolOptions.textColor,
        backgroundColor: 'transparent',
        listStyle: 'none',
        widthMode: isDragBox ? 'fixed' : 'auto',
        autoWidth: !isDragBox,
        lang: getRememberedTextLang(defaultSpellcheckLang),
        paragraphs: createParagraphsFromPlainText(
          'Escribe aquí...',
          {
            bold: false,
            italic: false,
            underline: false,
            fontSize: toolOptions.textFontSize,
            color: toolOptions.textColor,
            fontFamily: 'sans',
          },
          'left'
        ),
      };
      onAddObject(textObj);
      onSelectIds([textObj.id]);
      onSetEditingTextId(textObj.id);
      onSwitchToSelect();
    }

    // Confirma historial atómico tras mover, redimensionar, rotar o editar vértices
    if (
      (interaction.mode === 'resize' || interaction.mode === 'group-resize') &&
      hasMovedRef.current &&
      (interaction.initialObjects || interaction.groupFullObjects)
    ) {
      const ids = interaction.initialObjects
        ? Object.keys(interaction.initialObjects)
        : Object.keys(interaction.groupFullObjects || {});
      const targetId = interaction.targetId;
      const preSnap = preTransformSnapshotRef.current;
      preTransformSnapshotRef.current = null;

      if (interaction.mode === 'resize' && targetId) {
        const objHost = stageRef.current?.querySelector(
          `[data-canvas-obj-id="${targetId}"]`
        ) as HTMLElement | null;
        const measureEl = objHost?.querySelector(
          '[data-rt-content-measure="true"]'
        ) as HTMLElement | null;
        if (measureEl) {
          const finalMinH = Math.max(36, Math.ceil(measureEl.offsetHeight + 4));
          onUpdateObjects(
            [targetId],
            (o) =>
              o.type === 'text' && o.height < finalMinH
                ? { ...o, height: finalMinH }
                : o,
            false
          );
        }
      }

      if (preSnap && onPushHistorySnapshot) {
        onPushHistorySnapshot(preSnap);
        onUpdateObjects(ids, (o) => o, false);
      } else {
        onUpdateObjects(ids, (o) => o, true);
      }
    } else if (
      ((interaction.mode === 'drag-objects' && hasMovedRef.current) ||
        (interaction.mode === 'rotate' && hasMovedRef.current) ||
        (interaction.mode === 'group-rotate' && hasMovedRef.current) ||
        (interaction.mode === 'drag-vertex' && hasMovedRef.current) ||
        (interaction.mode === 'drag-line-point' && hasMovedRef.current)) &&
      (interaction.initialObjects || interaction.groupFullObjects)
    ) {
      const ids = interaction.initialObjects
        ? Object.keys(interaction.initialObjects)
        : Object.keys(interaction.groupFullObjects || {});
      const preSnap = preTransformSnapshotRef.current;
      preTransformSnapshotRef.current = null;
      if (preSnap && onPushHistorySnapshot) {
        onPushHistorySnapshot(preSnap);
        onUpdateObjects(ids, (o) => o, false);
      } else {
        onUpdateObjects(ids, (o) => o, true);
      }
    }

    preTransformSnapshotRef.current = null;

    hasMovedRef.current = false;
    snapHysteresisRef.current = {};
    clearAcquireDwellTimer();
    if (
      interaction.mode === 'pen' ||
      interaction.mode === 'draw-shape' ||
      interaction.mode === 'draw-line' ||
      interaction.mode === 'drag-objects' ||
      interaction.mode === 'drag-vertex' ||
      interaction.mode === 'drag-line-point'
    ) {
      clearTrackingSessionState(trackingStateRef.current);
      updateLiveCadCursor(null);
    } else {
      setLiveCadCursor((prev) => {
        const next = prev ? { ...prev, guide: null } : null;
        onResolvedCursorChange?.(next);
        return next;
      });
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore if not captured
    }

    setInteraction({
      mode: 'none',
      startClient: { x: 0, y: 0 },
      startWorld: { x: 0, y: 0 },
      startViewport: board.viewport,
    });
  };

  const handleObjectPointerDown = (
    e: React.PointerEvent,
    obj: CanvasObject,
    forceDragEvenIfEditing = false
  ) => {
    if (areaExportMode) return;
    if (cadSession.activeCommand || cadSession.pickingOrigin || arrayPickMode) return;
    if (activeTool !== 'select' || spacePressed) return;

    // Let active inline textarea, equation editor, cell editor, or dimension input handle clicks/selection natively
    if (
      !forceDragEvenIfEditing &&
      (editingTextId === obj.id ||
        editingEquationId === obj.id ||
        editingDimensionId === obj.id ||
        (editingTableId === obj.id && Boolean(editingTableCell)))
    ) {
      e.stopPropagation();
      return;
    }

    if (editingTextId && editingTextId !== obj.id) {
      onSetEditingTextId(null);
    }
    if (editingEquationId && editingEquationId !== obj.id) {
      onUpdateObjects([editingEquationId], (o) => o, true);
      onSetEditingEquationId(null);
    }
    if (editingDimensionId && editingDimensionId !== obj.id) {
      onSetEditingDimensionId?.(null);
    }
    if (editingTableId && (editingTableId !== obj.id || forceDragEvenIfEditing)) {
      onSetEditingTableCell?.(null, null);
    }

    // Reference locked background lets clicks pass through to canvas unless Shift-clicked
    if (
      (obj.type === 'image' || obj.type === 'document') &&
      obj.isReferenceBackground &&
      !e.shiftKey
    ) {
      return;
    }

    // El clic derecho abre menú contextual únicamente si el elemento ya estaba seleccionado
    if (e.button === 2) {
      e.stopPropagation();
      return;
    }
    if (e.button !== 0) return;

    setElementMenuAnchor(null);
    e.stopPropagation();

    let nextSelected: string[];
    const groupMembers = expandSelectionToGroups(obj, visibleObjects, board.groups ?? []);

    if (e.shiftKey) {
      const already = selectedIds.includes(obj.id);
      nextSelected = already
        ? selectedIds.filter((id) => !groupMembers.includes(id))
        : Array.from(new Set([...selectedIds, ...groupMembers]));
    } else if (selectedIds.includes(obj.id)) {
      nextSelected = selectedIds;
    } else {
      nextSelected = groupMembers;
    }

    onSelectIds(nextSelected);

    if (isObjLocked(obj)) return;

    const world = screenToWorld(e.clientX, e.clientY);
    const initialObjects: NonNullable<InteractionState['initialObjects']> = {};
    for (const o of visibleObjects) {
      if (nextSelected.includes(o.id) && !isObjLocked(o)) {
        initialObjects[o.id] = {
          x: o.x,
          y: o.y,
          width: o.width,
          height: o.height,
          rotation: o.rotation,
          p1: o.type === 'dimension' ? { ...o.p1 } : undefined,
          p2: o.type === 'dimension' ? { ...o.p2 } : undefined,
          p3: o.type === 'dimension' && o.p3 ? { ...o.p3 } : undefined,
          offsetPt: o.type === 'dimension' ? { ...o.offsetPt } : undefined,
        };
      }
    }

    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;
    hasMovedRef.current = false;
    setInteraction({
      mode: 'drag-objects',
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      initialObjects,
    });
  };

  // Regla de prioridad entre manejadores y extremos cercanos de otros objetos (<10 px / <5 px)
  const tryYieldCloseHandleClick = (
    e: React.PointerEvent,
    handleWorld: Point2D,
    obj: CanvasObject,
    siblingHandlesWorld: Point2D[] = []
  ): boolean => {
    if (e.altKey || activeTool !== 'select' || cadSession.activeCommand || cadSession.pickingOrigin) {
      return false;
    }
    const clickWorld = screenToWorld(e.clientX, e.clientY);
    const zoom = Math.max(0.1, board.viewport.zoom);
    const distToHandlePx =
      Math.hypot(clickWorld.x - handleWorld.x, clickWorld.y - handleWorld.y) * zoom;
    // Si el cursor está a menos de 5 px del centro del manejador, el manejador mantiene prioridad absoluta
    if (distToHandlePx < 5) return false;

    const tol10World = 10 / zoom;
    const nearSibling = siblingHandlesWorld.some(
      (other) => Math.hypot(other.x - handleWorld.x, other.y - handleWorld.y) < tol10World
    );
    const nearOtherEndpoint = hasOtherObjectEndpointNearPoint(
      handleWorld,
      visibleObjects,
      obj.id,
      tol10World
    );
    if (!nearSibling && !nearOtherEndpoint) return false;

    // Permite seleccionar/arrastrar el otro objeto subyacente si hay uno cercano distinto al actual
    if (nearOtherEndpoint) {
      const otherObjs = visibleObjects.filter((o) => o.id !== obj.id && !isObjLocked(o));
      const underlying = findObjectNearWorldPoint(clickWorld, otherObjs, 12 / zoom);
      if (underlying) {
        handleObjectPointerDown(e, underlying);
        return true;
      }
    }
    if (nearSibling) {
      handleObjectPointerDown(e, obj);
      return true;
    }
    return false;
  };

  const handleResizeHandleDown = (
    e: React.PointerEvent,
    obj: CanvasObject,
    dir: HandleDir,
    handleWorld?: Point2D,
    siblingHandlesWorld?: Point2D[]
  ) => {
    if (handleWorld && tryYieldCloseHandleClick(e, handleWorld, obj, siblingHandlesWorld)) {
      return;
    }
    e.stopPropagation();
    if (isObjLocked(obj)) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture(e.pointerId);
    hasMovedRef.current = false;
    // OPT: 2.7 — Captura incremental/compartida al iniciar redimensionamiento sin clonar buffers pesados
    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;

    const hostEl = e.currentTarget.closest('[data-canvas-obj-id]') as HTMLElement | null;
    const measureEl = hostEl?.querySelector(
      '[data-rt-content-measure="true"]'
    ) as HTMLElement | null;
    resizeTextMinHeightRef.current =
      obj.type === 'text' && measureEl
        ? Math.max(36, Math.ceil(measureEl.offsetHeight + 4))
        : 20;

    const measuredWidth =
      obj.type === 'text' && resolveTextWidthMode(obj) === 'auto'
        ? Math.max(64, hostEl?.offsetWidth ?? obj.width)
        : obj.width;
    const measuredHeight =
      obj.type === 'text'
        ? Math.max(obj.height, hostEl?.offsetHeight ?? obj.height)
        : obj.height;

    setInteraction({
      mode: 'resize',
      handleDir: dir,
      targetId: obj.id,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      initialObjects: {
        [obj.id]: {
          x: obj.x,
          y: obj.y,
          width: measuredWidth,
          height: measuredHeight,
          rotation: obj.rotation,
          customVertices: obj.type === 'shape' ? obj.customVertices : undefined,
          customPoints: obj.type === 'shape' ? obj.customPoints : undefined,
          startPoint: obj.type === 'line' ? obj.startPoint : undefined,
          endPoint: obj.type === 'line' ? obj.endPoint : undefined,
          controlPoint: obj.type === 'line' ? obj.controlPoint : undefined,
          isShape: obj.type === 'shape',
          flipX: obj.type === 'shape' ? Boolean(obj.flipX) : undefined,
          flipY: obj.type === 'shape' ? Boolean(obj.flipY) : undefined,
        },
      },
    });
  };

  const handleRotateHandleDown = (e: React.PointerEvent, obj: CanvasObject) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setElementMenuAnchor(null);
    if (isObjLocked(obj)) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture(e.pointerId);
    hasMovedRef.current = false;
    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;
    setInteraction({
      mode: 'rotate',
      targetId: obj.id,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      initialObjects: {
        [obj.id]: {
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          rotation: obj.rotation,
        },
      },
    });
  };

  const handleGroupResizeHandleDown = (
    e: React.PointerEvent,
    dir: HandleDir,
    box: WorldBoxRect
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setElementMenuAnchor(null);
    const unlockedMembers = selectedVisibleObjects.filter((o) => !isObjLocked(o));
    if (unlockedMembers.length === 0) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture(e.pointerId);
    hasMovedRef.current = false;
    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;
    const groupFullObjects: Record<string, CanvasObject> = {};
    for (const o of unlockedMembers) {
      groupFullObjects[o.id] = { ...o };
    }
    setInteraction({
      mode: 'group-resize',
      handleDir: dir,
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      groupBox: { ...box },
      groupFullObjects,
    });
  };

  const handleGroupRotateHandleDown = (e: React.PointerEvent, box: WorldBoxRect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setElementMenuAnchor(null);
    const unlockedMembers = selectedVisibleObjects.filter((o) => !isObjLocked(o));
    if (unlockedMembers.length === 0) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture(e.pointerId);
    hasMovedRef.current = false;
    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;
    const groupFullObjects: Record<string, CanvasObject> = {};
    for (const o of unlockedMembers) {
      groupFullObjects[o.id] = { ...o };
    }
    setInteraction({
      mode: 'group-rotate',
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      groupBox: { ...box },
      groupPivot: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      groupDeltaDeg: 0,
      groupFullObjects,
    });
  };

  const handleVertexHandleDown = (
    e: React.PointerEvent,
    obj: ShapeObject,
    vertexIndex: number,
    isEdgeMidpoint = false
  ) => {
    const geom = getShapeEditableGeometry(obj);
    if (!geom) return;
    const preWorldVerts = geom.vertices.map((p) => localToWorld(p, obj));
    if (!isEdgeMidpoint && preWorldVerts[vertexIndex]) {
      const others = preWorldVerts.filter((_, idx) => idx !== vertexIndex);
      if (tryYieldCloseHandleClick(e, preWorldVerts[vertexIndex], obj, others)) {
        return;
      }
    }
    e.stopPropagation();
    if (isObjLocked(obj)) return;

    // Alt + Click on a vertex deletes that vertex when above minimum count
    if (e.altKey && !isEdgeMidpoint) {
      const minVerts = geom.mode === 'polyline' ? 2 : 3;
      if (
        (geom.mode === 'polygon' || geom.mode === 'polyline') &&
        geom.vertices.length > minVerts
      ) {
        const remainingWorld = geom.vertices
          .filter((_, idx) => idx !== vertexIndex)
          .map((p) => localToWorld(p, obj));
        onUpdateObjects(
          [obj.id],
          (cur) => {
            const sObj = cur as ShapeObject;
            return geom.mode === 'polyline'
              ? buildPolylineShapeFromWorldPoints(sObj, remainingWorld, sObj.id, sObj.zIndex)
              : buildShapeObjectFromWorldPolygon(sObj, remainingWorld, sObj.id, sObj.zIndex);
          },
          true
        );
      }
      return;
    }

    let worldVerts = preWorldVerts;
    let activeIdx = vertexIndex;

    if (isEdgeMidpoint) {
      const a = worldVerts[vertexIndex];
      const b = worldVerts[(vertexIndex + 1) % worldVerts.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      worldVerts = [
        ...worldVerts.slice(0, vertexIndex + 1),
        mid,
        ...worldVerts.slice(vertexIndex + 1),
      ];
      activeIdx = vertexIndex + 1;
    }

    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture(e.pointerId);
    hasMovedRef.current = isEdgeMidpoint;
    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;

    setInteraction({
      mode: 'drag-vertex',
      targetId: obj.id,
      vertexIndex: activeIdx,
      initialWorldVertices: worldVerts,
      vertexMode: geom.mode,
      solidHandle: geom.solidHandles?.[activeIdx],
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      initialObjects: {
        [obj.id]: {
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          rotation: obj.rotation,
          isShape: true,
          flipX: Boolean(obj.flipX),
          flipY: Boolean(obj.flipY),
        },
      },
    });
  };

  const handleLinePointDown = (
    e: React.PointerEvent,
    obj: LineObject,
    role: 'start' | 'end' | 'control'
  ) => {
    const startW = localToWorld(obj.startPoint, obj);
    const endW = localToWorld(obj.endPoint, obj);
    const defaultCtrl = {
      x: (obj.startPoint.x + obj.endPoint.x) / 2,
      y: (obj.startPoint.y + obj.endPoint.y) / 2 - 36,
    };
    const ctrlW =
      obj.lineKind === 'connector'
        ? localToWorld(obj.controlPoint || defaultCtrl, obj)
        : undefined;
    const handlePt = role === 'start' ? startW : role === 'end' ? endW : ctrlW ?? startW;
    const siblings = [startW, endW, ...(ctrlW ? [ctrlW] : [])].filter(
      (pt) => pt !== handlePt
    );
    if (tryYieldCloseHandleClick(e, handlePt, obj, siblings)) {
      return;
    }
    e.stopPropagation();
    if (isObjLocked(obj)) return;
    const world = screenToWorld(e.clientX, e.clientY);
    stageRef.current?.setPointerCapture(e.pointerId);
    hasMovedRef.current = false;
    preTransformSnapshotRef.current = captureBoardHistorySnapshot(
      board.objects,
      board.groups ?? []
    ).objects;

    setInteraction({
      mode: 'drag-line-point',
      targetId: obj.id,
      linePointRole: role,
      initialLinePoints: { start: startW, end: endW, control: ctrlW },
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: world,
      startViewport: board.viewport,
      initialObjects: {
        [obj.id]: {
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          rotation: obj.rotation,
        },
      },
    });
  };

  const renderShapeSvg = (obj: ShapeObject) => {
    const w = Math.max(10, obj.width);
    const h = Math.max(10, obj.height);
    const strokeColor = resolveDisplayStrokeColor(obj.strokeColor);
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible block">
        {renderShapeSvgElement(obj.shapeKind, w, h, {
          strokeColor,
          fillColor: obj.fillColor,
          strokeWidth: obj.strokeWidth,
          strokeStyle: obj.strokeStyle,
          cornerRadius: obj.cornerRadius,
          polygonSides: obj.polygonSides,
          arcStartAngle: obj.arcStartAngle,
          arcEndAngle: obj.arcEndAngle,
          customPoints: obj.customPoints,
          customVertices: obj.customVertices,
          flipX: obj.flipX,
          flipY: obj.flipY,
        })}
      </svg>
    );
  };

  const renderLineSvg = (obj: LineObject) => {
    const w = Math.max(10, obj.width);
    const h = Math.max(10, obj.height);
    const { startPoint: s, endPoint: end } = obj;
    const strokeCol = resolveDisplayStrokeColor(obj.strokeColor);
    const baseDash =
      obj.strokeStyle === 'dashed' ? '8 5' : obj.strokeStyle === 'dotted' ? '2 5' : undefined;
    const dash = obj.lineKind === 'dashed-line' ? baseDash || '8 5' : baseDash;
    const headLen = Math.max(9, obj.strokeWidth * 3.2);

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
          strokeWidth={obj.strokeWidth}
        />
      );
    };

    const ctrl = obj.controlPoint || { x: (s.x + end.x) / 2, y: (s.y + end.y) / 2 - 36 };
    const midX = (s.x + end.x) / 2;

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible block">
        {obj.lineKind === 'connector' ? (
          <>
            <path
              d={`M ${s.x} ${s.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`}
              fill="none"
              stroke={strokeCol}
              strokeWidth={obj.strokeWidth}
              strokeDasharray={dash}
              strokeLinecap="round"
            />
            {renderArrowHead(ctrl, end)}
          </>
        ) : obj.lineKind === 'orthogonal' ? (
          <>
            <polyline
              points={`${s.x},${s.y} ${midX},${s.y} ${midX},${end.y} ${end.x},${end.y}`}
              fill="none"
              stroke={strokeCol}
              strokeWidth={obj.strokeWidth}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {renderArrowHead({ x: midX, y: end.y }, end)}
          </>
        ) : (
          <>
            {obj.lineKind === 'vector' && (
              <circle
                cx={s.x}
                cy={s.y}
                r={Math.max(3.5, obj.strokeWidth * 1.4)}
                fill={strokeCol}
              />
            )}
            <line
              x1={s.x}
              y1={s.y}
              x2={end.x}
              y2={end.y}
              stroke={strokeCol}
              strokeWidth={obj.strokeWidth}
              strokeDasharray={dash}
              strokeLinecap="round"
            />
            {(obj.lineKind === 'arrow' ||
              obj.lineKind === 'double-arrow' ||
              obj.lineKind === 'vector') &&
              renderArrowHead(s, end)}
            {obj.lineKind === 'double-arrow' && renderArrowHead(end, s)}
            {obj.lineKind === 'segment' && (
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

  const renderDimensionNode = (obj: DimensionObject) => {
    const w = Math.max(10, obj.width);
    const h = Math.max(10, obj.height);
    const metrics = computeDimensionMetrics(obj, cadConfig);
    const isEditing = editingDimensionId === obj.id;
    const commitOverride = (val: string) => {
      const cleaned = val.trim();
      const nextOverride =
        !cleaned || cleaned === metrics.formattedLabel ? undefined : cleaned;
      onUpdateObjects(
        [obj.id],
        (o) => ({ ...(o as DimensionObject), textOverride: nextOverride }),
        true
      );
      onSetEditingDimensionId?.(null);
    };

    return (
      <div className="relative w-full h-full">
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} className="overflow-visible block">
          <DimensionSvgContent
            metrics={metrics}
            strokeColor={resolveDisplayStrokeColor(obj.strokeColor)}
            textColor={resolveDisplayStrokeColor(obj.textColor)}
            fontSize={obj.fontSize}
            originX={obj.x}
            originY={obj.y}
            hideLabel={isEditing}
          />
        </svg>
        {isEditing && (
          <input
            autoFocus
            type="text"
            value={dimOverrideDraft}
            onChange={(e) => setDimOverrideDraft(e.target.value)}
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
              left: metrics.textPos.x - obj.x,
              top: metrics.textPos.y - obj.y,
              transform: 'translate(-50%, -50%)',
              fontSize: `${Math.max(11, obj.fontSize)}px`,
            }}
            className="absolute z-50 w-28 px-1.5 py-0.5 text-center font-mono-tabular font-semibold bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-2 border-blue-600 rounded shadow-lg outline-none"
          />
        )}
      </div>
    );
  };

  const handleRepairTextBox = (objectId: string) => {
    if (onRepairTextObject) {
      onRepairTextObject(objectId);
      return;
    }
    onUpdateObjects([objectId], (o) => repairCorruptedTextObject(o as TextObject), true);
  };

  // OPT: 2.6 — Manejadores estables para preservar memoización React.memo de cada elemento en StaticObjectsLayer
  const handleObjectDoubleClick = (
    e: React.MouseEvent,
    obj: CanvasObject,
    locked: boolean
  ) => {
    e.stopPropagation();
    if (cadSession.activeCommand || cadSession.pickingOrigin || arrayPickMode) return;
    if (obj.type === 'text' || obj.type === 'sticky') {
      if (!locked) onSetEditingTextId(obj.id);
    } else if (obj.type === 'equation') {
      if (!locked) {
        onSelectIds([obj.id]);
        onEquationCursorChange(getInitialEditCursor(obj.latex));
        onSetEditingEquationId(obj.id);
      }
    } else if (obj.type === 'dimension') {
      if (!locked) {
        const m = computeDimensionMetrics(obj, cadConfig);
        setDimOverrideDraft(obj.textOverride ?? m.formattedLabel);
        onSelectIds([obj.id]);
        onSetEditingDimensionId?.(obj.id);
      }
    } else if (obj.type === 'graph') {
      onDoubleClickGraph(obj);
    }
  };

  const handleObjectContextMenu = (e: React.MouseEvent, obj: CanvasObject) => {
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest('[contenteditable="true"], textarea, input, select')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const isPointCommandActive = Boolean(
      cadSession.activeCommand ||
        cadSession.pickingOrigin ||
        arrayPickMode ||
        pendingTableSize ||
        areaExportMode ||
        activeTool !== 'select'
    );
    if (
      isPointCommandActive ||
      interaction.mode !== 'none' ||
      !selectedIdSet.has(obj.id)
    ) {
      setElementMenuAnchor(null);
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setElementMenuAnchor({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const itemHandlersRef = useRef({
    pointerDown: handleObjectPointerDown,
    doubleClick: handleObjectDoubleClick,
    contextMenu: handleObjectContextMenu,
    repairText: handleRepairTextBox,
  });
  itemHandlersRef.current = {
    pointerDown: handleObjectPointerDown,
    doubleClick: handleObjectDoubleClick,
    contextMenu: handleObjectContextMenu,
    repairText: handleRepairTextBox,
  };

  const stableObjectPointerDown = useCallback(
    (e: React.PointerEvent, obj: CanvasObject, forceDragEvenIfEditing?: boolean) =>
      itemHandlersRef.current.pointerDown(e, obj, forceDragEvenIfEditing),
    []
  );
  const stableObjectDoubleClick = useCallback(
    (e: React.MouseEvent, obj: CanvasObject, locked: boolean) =>
      itemHandlersRef.current.doubleClick(e, obj, locked),
    []
  );
  const stableObjectContextMenu = useCallback(
    (e: React.MouseEvent, obj: CanvasObject) =>
      itemHandlersRef.current.contextMenu(e, obj),
    []
  );
  const stableRepairTextBox = useCallback(
    (id: string) => itemHandlersRef.current.repairText(id),
    []
  );
  const stableCommitTableWithSnapshot = useCallback(
    (objId: string, snapshotBefore: TableObject, nextTable: TableObject) => {
      if (onPushHistorySnapshot) {
        const preObjects = boardObjectsRef.current.map((item) =>
          item.id === objId ? snapshotBefore : item
        );
        onPushHistorySnapshot(preObjects);
        onUpdateObjects([objId], () => nextTable, false);
      } else {
        onUpdateObjects([objId], () => nextTable, true);
      }
    },
    [onPushHistorySnapshot, onUpdateObjects]
  );

  const renderTextContent = (obj: TextObject) => {
    const defaults = getDefaultRunStyle(obj);
    const safeAlign = normalizeTextAlign(obj?.align, 'left');
    const isAuto = resolveTextWidthMode(obj) === 'auto';
    const isLegacyUntagged = obj?.widthMode === undefined && obj?.autoWidth === undefined;
    const effectiveMaxAutoWidth = isLegacyUntagged
      ? Math.max(TEXT_AUTO_MAX_WIDTH, Number.isFinite(obj.width) ? obj.width : TEXT_AUTO_MAX_WIDTH)
      : TEXT_AUTO_MAX_WIDTH;
    const activeLang = obj.lang ?? getRememberedTextLang(defaultSpellcheckLang);
    const paragraphs = normalizarContenidoTexto(
      Array.isArray(obj?.paragraphs) && obj.paragraphs.length > 0
        ? obj.paragraphs
        : obj?.content,
      defaults,
      safeAlign
    );
    const resolveTextColor = (color: string) =>
      obj.backgroundColor === 'transparent' ? resolveDisplayStrokeColor(color) : color;
    const isEditingThis = editingTextId === obj.id;
    const resetKey = `${isEditingThis ? 'edit' : 'view'}-${typeof obj.content === 'string' ? obj.content.length : 'invalid'}-${Array.isArray(obj.paragraphs) ? obj.paragraphs.length : 'none'}`;

    return (
      <TextObjectErrorBoundary
        objectId={obj.id}
        resetKey={resetKey}
        onRepair={handleRepairTextBox}
      >
        {isEditingThis ? (
          <RichTextEditor
            ref={activeRichTextEditorRef}
            paragraphs={paragraphs}
            defaults={defaults}
            defaultAlign={safeAlign}
            listStyle={obj.listStyle}
            backgroundColor={obj.backgroundColor}
            autoWidth={isAuto}
            maxAutoWidth={effectiveMaxAutoWidth}
            lang={activeLang}
            spellcheckEnabled={spellcheckEnabled}
            resolveColor={resolveTextColor}
            onChangeParagraphs={(nextParagraphs, recordHistory) =>
              onUpdateObjects(
                [obj.id],
                (o) => syncTextObjectFromParagraphs(o as TextObject, nextParagraphs),
                recordHistory
              )
            }
            onChangeListStyle={(nextListStyle) => {
              onUpdateObjects(
                [obj.id],
                (o) => ({ ...(o as TextObject), listStyle: nextListStyle }),
                true
              );
              requestAnimationFrame(() => activeRichTextEditorRef?.current?.focus());
            }}
            onChangeLang={(nextLang) => {
              onUpdateObjects(
                [obj.id],
                (o) => ({ ...(o as TextObject), lang: nextLang }),
                false
              );
            }}
            onSelectionSummaryChange={(summary) =>
              onRichTextSelectionSummaryChange?.(summary)
            }
            onAutoSizeChange={({ width, height }) => {
              const curHeight = Number.isFinite(obj.height) ? obj.height : 40;
              const curWidth = Number.isFinite(obj.width) ? obj.width : 160;
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
                  [obj.id],
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
            listStyle={obj.listStyle}
            backgroundColor={obj.backgroundColor}
            autoWidth={isAuto}
            maxAutoWidth={effectiveMaxAutoWidth}
            resolveColor={resolveTextColor}
          />
        )}
      </TextObjectErrorBoundary>
    );
  };

  // Identificadores de patrón SVG de fondo (las variables fixedPage/gSize ya fueron inicializadas arriba)
  const patternId = `bg-pattern-${board.id}-${board.backgroundPattern}`;
  const pagePatternId = `page-bg-pattern-${board.id}-${board.backgroundPattern}`;

  const cursorKind: CanvasCursorKind =
    areaExportMode ||
    arrayPickMode ||
    pendingTableSize ||
    cadSession.activeCommand ||
    cadSession.pickingOrigin
      ? 'crosshair'
      : interaction.mode === 'pan'
      ? 'grabbing'
      : spacePressed || activeTool === 'hand'
      ? 'grab'
      : activeTool === 'pen' ||
        activeTool === 'shape' ||
        activeTool === 'line' ||
        activeTool === 'cut'
      ? 'crosshair'
      : activeTool === 'eraser'
      ? 'eraser'
      : activeTool === 'text' || activeTool === 'equation'
      ? 'text'
      : 'default';

  // Paleta efectiva del lienzo (independiente del tema salvo cuando el modo es 'auto')
  const boardTheme = useMemo(
    () => getEffectiveBoardColors(theme, canvasBgMode, canvasBgCustomColor),
    [theme, canvasBgMode, canvasBgCustomColor]
  );
  const frameBorderStroke = useMemo(
    () => getFrameBorderStroke(boardTheme),
    [boardTheme]
  );

  // Memoriza el generador SVG de papel y marco por hoja (con ID único por hoja para evitar colisiones de patrón)
  const renderFixedSheetSvgLayer = useCallback(
    (sheetIndex: number) => {
      if (!fixedPage) return null;
      try {
        const hasFrame = Boolean(sheetSettings.showFrame && pageFrame);
        const areaX = hasFrame && pageFrame ? pageFrame.x : 0;
        const areaY = hasFrame && pageFrame ? pageFrame.y : 0;
        const areaW = hasFrame && pageFrame ? pageFrame.width : fixedPage.width;
        const areaH = hasFrame && pageFrame ? pageFrame.height : fixedPage.height;
        const patId = `${pagePatternId}-s${sheetIndex}`;

        return (
          <svg
            width={fixedPage.width}
            height={fixedPage.height}
            className="block pointer-events-none"
          >
            {board.backgroundPattern !== 'blank' && (
              <>
                <defs>
                  {board.backgroundPattern === 'grid' && (
                    <pattern
                      id={patId}
                      x={areaX}
                      y={areaY}
                      width={gSize}
                      height={gSize}
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        data-export-role="grid-stroke"
                        d={`M ${gSize} 0 L 0 0 0 ${gSize}`}
                        fill="none"
                        stroke={boardTheme.gridStroke}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    </pattern>
                  )}
                  {board.backgroundPattern === 'lined' && (
                    <pattern
                      id={patId}
                      x={areaX}
                      y={areaY}
                      width={gSize}
                      height={gSize}
                      patternUnits="userSpaceOnUse"
                    >
                      <line
                        data-export-role="lined-stroke"
                        x1={0}
                        y1={gSize}
                        x2={gSize}
                        y2={gSize}
                        stroke={boardTheme.linedStroke}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    </pattern>
                  )}
                  {board.backgroundPattern === 'dotted' && (
                    <pattern
                      id={patId}
                      x={areaX}
                      y={areaY}
                      width={gSize}
                      height={gSize}
                      patternUnits="userSpaceOnUse"
                    >
                      <circle
                        data-export-role="dot-fill"
                        cx={1.5}
                        cy={1.5}
                        r={1.25}
                        fill={boardTheme.dotFill}
                      />
                    </pattern>
                  )}
                  {board.backgroundPattern === 'isometric' && (
                    <pattern
                      id={patId}
                      x={areaX}
                      y={areaY}
                      width={gSize * 1.732}
                      height={gSize}
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        data-export-role="grid-stroke"
                        d={`M 0 0 L ${gSize * 1.732} ${gSize} M ${gSize * 1.732} 0 L 0 ${gSize} M ${(gSize * 1.732) / 2} 0 L ${(gSize * 1.732) / 2} ${gSize}`}
                        fill="none"
                        stroke={boardTheme.gridStroke}
                        strokeWidth={0.85}
                        vectorEffect="non-scaling-stroke"
                      />
                    </pattern>
                  )}
                </defs>
                <rect
                  x={areaX}
                  y={areaY}
                  width={areaW}
                  height={areaH}
                  fill={`url(#${patId})`}
                />
              </>
            )}

            {hasFrame && pageFrame && (
              <rect
                data-board-frame="true"
                data-export-role="frame-stroke"
                x={pageFrame.x}
                y={pageFrame.y}
                width={pageFrame.width}
                height={pageFrame.height}
                fill="none"
                stroke={frameBorderStroke}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                shapeRendering="crispEdges"
              />
            )}
          </svg>
        );
      } catch (err) {
        // Protección contra fallos en dibujo del marco: muestra la hoja sin marco sin romper la pizarra
        console.error('[Ábaco] Error al renderizar el marco de hoja:', err);
        return null;
      }
    },
    [
      fixedPage?.width,
      fixedPage?.height,
      sheetSettings.showFrame,
      pageFrame,
      gSize,
      board.backgroundPattern,
      pagePatternId,
      boardTheme.gridStroke,
      boardTheme.linedStroke,
      boardTheme.dotFill,
      frameBorderStroke,
    ]
  );

  // Particiona los elementos por hoja cuando "Recortar dibujo al marco" está activo con múltiples hojas
  const clippedSheetBuckets = useMemo(() => {
    if (!fixedPage || !shouldClipToFrame || !pageFrame || sheets.length <= 1) {
      return null;
    }
    const bySheet: CanvasObject[][] = Array.from({ length: sheets.length }, () => []);
    const unowned: CanvasObject[] = [];
    for (const obj of renderedObjects) {
      const idx = findSheetIndexForObject(obj, sheets.length, fixedPage.width, fixedPage.height);
      if (idx >= 0 && idx < sheets.length) {
        bySheet[idx].push(obj);
      } else {
        unowned.push(obj);
      }
    }
    return { bySheet, unowned };
  }, [fixedPage?.width, fixedPage?.height, shouldClipToFrame, pageFrame, sheets.length, renderedObjects]);

  // Si el usuario activó "Adaptar colores de trazos al fondo", ajusta dinámicamente solo los trazos con bajo contraste
  const resolveDisplayStrokeColor = (color: string): string =>
    adaptStrokeColorsToCanvasBg
      ? adaptStrokeColorForCanvasBg(color, boardTheme.boardBg)
      : color;

  const stageCursorCss = useMemo(
    () =>
      getContrastCanvasCursor(
        theme,
        cursorKind,
        cursorSize,
        cursorColor,
        boardTheme.isDarkSurface
      ),
    [theme, cursorKind, cursorSize, cursorColor, boardTheme.isDarkSurface]
  );
  const cursorPalette = useMemo(
    () => getThemeCursorPalette(theme, cursorColor, boardTheme.isDarkSurface),
    [theme, cursorColor, boardTheme.isDarkSurface]
  );

  const selectedVisibleObjects = useMemo(() => {
    const selSet = new Set(selectedIds);
    return visibleObjects.filter((o) => selSet.has(o.id));
  }, [visibleObjects, selectedIds]);

  const groupWorldBox = useMemo(() => {
    if (selectedVisibleObjects.length <= 1) return null;
    return getObjectsWorldBoundingBox(selectedVisibleObjects);
  }, [selectedVisibleObjects]);

  const singleSelected =
    selectedIds.length === 1 ? visibleObjects.find((o) => o.id === selectedIds[0]) : null;

  const bladePreview = useMemo(() => {
    if (interaction.mode !== 'draw-cut' || !interaction.currentWorld) return null;
    const unlocked = visibleObjects.filter((o) => !isObjLocked(o));
    return computeBladeCut(interaction.startWorld, interaction.currentWorld, unlocked, nextZIndex);
  }, [interaction, visibleObjects, nextZIndex]);

  const areaOverlayRect = (() => {
    if (!areaDrag || !stageRef.current) return null;
    const sr = stageRef.current.getBoundingClientRect();
    const x1 = Math.max(0, Math.min(areaDrag.startClient.x, areaDrag.currentClient.x) - sr.left);
    const y1 = Math.max(0, Math.min(areaDrag.startClient.y, areaDrag.currentClient.y) - sr.top);
    const x2 = Math.min(sr.width, Math.max(areaDrag.startClient.x, areaDrag.currentClient.x) - sr.left);
    const y2 = Math.min(sr.height, Math.max(areaDrag.startClient.y, areaDrag.currentClient.y) - sr.top);
    return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
  })();

  return (
    <div
      ref={stageRef}
      onPointerDown={handleStagePointerDown}
      onPointerMove={handleStagePointerMove}
      onPointerUp={handleStagePointerUp}
      onPointerCancel={handleStagePointerUp}
      onContextMenu={(e) => {
        const targetEl = e.target as HTMLElement | null;
        if (targetEl?.closest('[contenteditable="true"], textarea, input, select')) {
          return;
        }
        e.preventDefault();
        setElementMenuAnchor(null);
      }}
      onPointerEnter={() => onCanvasPointerActivity?.(true)}
        onPointerLeave={() => {
        if (rafMoveRef.current !== null) {
          cancelAnimationFrame(rafMoveRef.current);
          rafMoveRef.current = null;
        }
        clearAcquireDwellTimer();
        pendingPointerMoveRef.current = null;
        pendingPenSamplesRef.current = [];
        if (interaction.mode === 'none') {
          updateLiveCadCursor(null);
        }
        onCanvasPointerActivity?.(false);
        onPointerStageMove?.(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const w = screenToWorld(e.clientX, e.clientY);
          onDropFiles(e.dataTransfer.files, w.x, w.y);
        }
      }}
      data-print-stage="true"
      data-fixed-page={fixedPage ? 'true' : undefined}
      style={{
        cursor: stageCursorCss,
        backgroundColor: fixedPage ? boardTheme.surroundingBg : boardTheme.boardBg,
      }}
      className="relative flex-1 overflow-hidden select-none touch-none"
    >
      {/* Regla de impresión exacta 1:1 para hojas de tamaño fijo sin escalado ni recorte de margen */}
      {fixedPage && (
        <style>{`
          @media print {
            @page {
              size: ${pxToMm(fixedPage.width).toFixed(2)}mm ${pxToMm(fixedPage.height).toFixed(2)}mm;
              margin: 0;
            }
            ${
              sheets.length > 1
                ? `
            [data-print-stage="true"][data-fixed-page="true"] {
              position: static !important;
              width: ${fixedPage.width}px !important;
              height: auto !important;
              overflow: visible !important;
              background: transparent !important;
              flex: none !important;
            }
            [data-print-stage="true"][data-fixed-page="true"] > [data-world-layer="true"] {
              position: static !important;
              transform: none !important;
              width: ${fixedPage.width}px !important;
              height: auto !important;
            }
            `
                : `
            [data-print-stage="true"][data-fixed-page="true"] {
              position: fixed !important;
              left: 0 !important;
              top: 0 !important;
              width: ${fixedPage.width}px !important;
              height: ${fixedPage.height}px !important;
              overflow: hidden !important;
              background: transparent !important;
            }
            [data-print-stage="true"][data-fixed-page="true"] > [data-world-layer="true"] {
              transform: none !important;
              left: 0 !important;
              top: 0 !important;
              width: ${fixedPage.width}px !important;
              height: ${fixedPage.height}px !important;
            }
            `
            }
            [data-board-background="true"] {
              box-shadow: none !important;
            }
          }
        `}</style>
      )}
      {/* OPT: 1.5 & 2.2 — Capa memoizada de fondo infinito y ejes */}
      <InfiniteBoardBgLayer
        hasFixedPage={Boolean(fixedPage)}
        backgroundPattern={board.backgroundPattern}
        showCoordinates={board.showCoordinates}
        patternId={patternId}
        gSize={gSize}
        panX={board.viewport.panX}
        panY={board.viewport.panY}
        zoom={board.viewport.zoom}
        gridStroke={boardTheme.gridStroke}
        linedStroke={boardTheme.linedStroke}
        dotFill={boardTheme.dotFill}
        axisStroke={boardTheme.axisStroke}
        axisText={boardTheme.axisText}
      />

      {/* World Transform Layer */}
      <div
        data-world-layer="true"
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${board.viewport.panX}px, ${board.viewport.panY}px) scale(${board.viewport.zoom})`,
        }}
      >
        <div data-world-sheet-root="true" className="relative">
        {printActive && fixedPage && sheets.length > 1 ? (
          <>
            {sheets.map((sheet, sheetIdx) => {
              const sheetY = getSheetY(sheetIdx, fixedPage.height);
              return (
                <div
                  key={`print-sheet-${sheet.id}`}
                  className={`print-sheet-page ${
                    sheetIdx < sheets.length - 1 ? 'print-sheet-page-break' : ''
                  }`}
                  style={{
                    position: 'relative',
                    width: fixedPage.width,
                    height: fixedPage.height,
                    overflow: 'hidden',
                    backgroundColor: boardTheme.boardBg,
                  }}
                >
                  <div
                    data-board-background="true"
                    data-export-role="sheet-bg"
                    className="absolute inset-0 pointer-events-none overflow-hidden"
                    style={{ backgroundColor: boardTheme.boardBg }}
                  >
                    {renderFixedSheetSvgLayer(sheetIdx)}
                    {sheetIdx === 0 && board.showCoordinates && (
                      <svg
                        width={fixedPage.width}
                        height={fixedPage.height}
                        className="absolute inset-0 pointer-events-none"
                      >
                        <line
                          data-export-role="axis-stroke"
                          x1={0}
                          y1={fixedPage.height / 2}
                          x2={fixedPage.width}
                          y2={fixedPage.height / 2}
                          stroke={boardTheme.axisStroke}
                          strokeWidth={1.2}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          data-export-role="axis-stroke"
                          x1={fixedPage.width / 2}
                          y1={0}
                          x2={fixedPage.width / 2}
                          y2={fixedPage.height}
                          stroke={boardTheme.axisStroke}
                          strokeWidth={1.2}
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          data-export-role="axis-text"
                          x={fixedPage.width / 2 + 6}
                          y={fixedPage.height / 2 - 6}
                          fill={boardTheme.axisText}
                          fontSize={10}
                          fontFamily="var(--font-mono)"
                        >
                          (0,0)
                        </text>
                      </svg>
                    )}
                  </div>
                  <div
                    style={
                      shouldClipToFrame && pageFrame
                        ? {
                            position: 'absolute',
                            left: pageFrame.x,
                            top: pageFrame.y,
                            width: pageFrame.width,
                            height: pageFrame.height,
                            overflow: 'hidden',
                            pointerEvents: 'none',
                          }
                        : {
                            position: 'absolute',
                            inset: 0,
                            overflow: 'hidden',
                            pointerEvents: 'none',
                          }
                    }
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: shouldClipToFrame && pageFrame ? -pageFrame.x : 0,
                        top: shouldClipToFrame && pageFrame ? -(sheetY + pageFrame.y) : -sheetY,
                        pointerEvents: 'none',
                      }}
                    >
                      <StaticObjectsLayer
                        objects={visibleObjects}
                        selectedIdSet={selectedIdSet}
                        layerMap={layerMap}
                        disablePointerEvents={true}
                        editingTextId={null}
                        editingEquationId={null}
                        editingDimensionId={null}
                        editingTableId={null}
                        editingTableCell={null}
                        equationCursor={equationCursor}
                        dimOverrideDraft=""
                        zoom={1}
                        shouldClipToFrame={shouldClipToFrame}
                        pageFrameY={sheetY + (pageFrame ? pageFrame.y : 0)}
                        cadConfig={cadConfig}
                        isDarkSurface={boardTheme.isDarkSurface}
                        boardBg={boardTheme.boardBg}
                        adaptStrokeColorsToCanvasBg={adaptStrokeColorsToCanvasBg}
                        spellcheckEnabled={false}
                        defaultSpellcheckLang={defaultSpellcheckLang}
                        editingTextareaRef={editingTextareaRef}
                        equationInputRef={equationInputRef}
                        activeRichTextEditorRef={activeRichTextEditorRef}
                        onObjectPointerDown={stableObjectPointerDown}
                        onObjectDoubleClick={stableObjectDoubleClick}
                        onUpdateObjects={onUpdateObjects}
                        onSelectIds={onSelectIds}
                        onDeleteObjects={onDeleteObjects}
                        onSetEditingTextId={onSetEditingTextId}
                        onSetEditingEquationId={onSetEditingEquationId}
                        onSetEditingDimensionId={onSetEditingDimensionId}
                        onSetEditingTableCell={onSetEditingTableCell}
                        onEquationCursorChange={onEquationCursorChange}
                        onOpenEquationModal={onOpenEquationModal}
                        onRichTextSelectionSummaryChange={onRichTextSelectionSummaryChange}
                        onRepairTextBox={stableRepairTextBox}
                        onRepairTableObject={onRepairTableObject}
                        onCommitTableWithSnapshot={stableCommitTableWithSnapshot}
                        onDimOverrideDraftChange={setDimOverrideDraft}
                        onUndo={onUndo}
                        onRedo={onRedo}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
        {/* Fixed-Size Page Sheets & Action Bars */}
        {fixedPage &&
          sheets.map((sheet, sheetIdx) => {
            const sheetY = getSheetY(sheetIdx, fixedPage.height);
            const invScreenScale = 1 / Math.max(0.2, board.viewport.zoom);
            const atSheetLimit = sheets.length >= MAX_SHEETS_PER_BOARD;
            const onlyOneSheet = sheets.length <= 1;
            return (
              <React.Fragment key={sheet.id}>
                {sheetIdx === 0 && (
                  <div
                    data-export-ignore="true"
                    className="no-print absolute left-0 pointer-events-none text-[11px] font-medium font-mono-tabular whitespace-nowrap select-none"
                    style={{
                      color: boardTheme.axisText,
                      top: sheetY - 22 * invScreenScale,
                      transform: `scale(${invScreenScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    {getBoardSizeSummary(board)}
                  </div>
                )}

                <div
                  data-export-ignore="true"
                  className="no-print absolute pointer-events-none text-[11px] font-medium font-mono-tabular whitespace-nowrap select-none"
                  style={{
                    color: boardTheme.axisText,
                    left: fixedPage.width,
                    top: sheetY - 22 * invScreenScale,
                    transform: `translateX(-100%) scale(${invScreenScale})`,
                    transformOrigin: 'top right',
                  }}
                >
                  Hoja {sheetIdx + 1}
                </div>

                <div
                  data-board-background="true"
                  data-export-role="sheet-bg"
                  data-sheet-index={sheetIdx}
                  className="absolute left-0 shadow-[0_10px_34px_rgba(15,23,42,0.18)] ring-1 ring-black/20 pointer-events-none overflow-hidden"
                  style={{
                    top: sheetY,
                    width: fixedPage.width,
                    height: fixedPage.height,
                    backgroundColor: boardTheme.boardBg,
                  }}
                >
                  {renderFixedSheetSvgLayer(sheetIdx)}

                  {sheetIdx === 0 && board.showCoordinates && (
                    <svg
                      width={fixedPage.width}
                      height={fixedPage.height}
                      className="absolute inset-0 pointer-events-none"
                    >
                      <line
                        data-export-role="axis-stroke"
                        x1={0}
                        y1={fixedPage.height / 2}
                        x2={fixedPage.width}
                        y2={fixedPage.height / 2}
                        stroke={boardTheme.axisStroke}
                        strokeWidth={1.2}
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        data-export-role="axis-stroke"
                        x1={fixedPage.width / 2}
                        y1={0}
                        x2={fixedPage.width / 2}
                        y2={fixedPage.height}
                        stroke={boardTheme.axisStroke}
                        strokeWidth={1.2}
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        data-export-role="axis-text"
                        x={fixedPage.width / 2 + 6}
                        y={fixedPage.height / 2 - 6}
                        fill={boardTheme.axisText}
                        fontSize={10}
                        fontFamily="var(--font-mono)"
                      >
                        (0,0)
                      </text>
                    </svg>
                  )}
                </div>

                {/* Barra discreta de acciones por hoja (tamaño constante sin importar zoom, no exportable/imprimible) */}
                {!exportOrPrintActive && (
                  <div
                    data-export-ignore="true"
                    data-sheet-toolbar={sheetIdx}
                    role="toolbar"
                    aria-label={`Acciones de hoja ${sheetIdx + 1}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="no-print pointer-events-auto absolute z-30 flex items-center gap-1 rounded-lg border px-1.5 py-1 whitespace-nowrap select-none"
                    style={{
                      left: fixedPage.width / 2,
                      top: sheetY + fixedPage.height + 10 * invScreenScale,
                      transform: `translateX(-50%) scale(${invScreenScale})`,
                      transformOrigin: 'top center',
                      backgroundColor: '#ffffff',
                      borderColor: '#cbd5e1',
                      color: '#1e293b',
                      boxShadow: '0 4px 14px rgba(15, 23, 42, 0.14)',
                    }}
                  >
                    <button
                      type="button"
                      disabled={atSheetLimit}
                      onClick={() => onAddSheetAfter?.(sheetIdx)}
                      title={
                        atSheetLimit
                          ? `Límite máximo de ${MAX_SHEETS_PER_BOARD} hojas alcanzado`
                          : 'Agregar una hoja en blanco después de esta'
                      }
                      aria-label={`Agregar hoja después de la hoja ${sheetIdx + 1}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Hoja</span>
                    </button>
                    <span className="w-px h-3.5 bg-slate-200" aria-hidden="true" />
                    <button
                      type="button"
                      disabled={atSheetLimit}
                      onClick={() => onDuplicateSheet?.(sheetIdx)}
                      title={
                        atSheetLimit
                          ? `Límite máximo de ${MAX_SHEETS_PER_BOARD} hojas alcanzado`
                          : 'Duplicar esta hoja con todo su contenido'
                      }
                      aria-label={`Duplicar hoja ${sheetIdx + 1}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Duplicar</span>
                    </button>
                    <span className="w-px h-3.5 bg-slate-200" aria-hidden="true" />
                    <button
                      type="button"
                      disabled={onlyOneSheet}
                      onClick={() => onRequestDeleteSheet?.(sheetIdx)}
                      title={
                        onlyOneSheet
                          ? 'No se puede eliminar la única hoja del pizarrón'
                          : `Eliminar hoja ${sheetIdx + 1} y su contenido`
                      }
                      aria-label={`Eliminar hoja ${sheetIdx + 1}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar</span>
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}

        {/* Capa de elementos con recorte opcional al área útil del marco (por hoja en pizarrones multihoja) */}
        {clippedSheetBuckets && fixedPage && pageFrame ? (
          <>
            {clippedSheetBuckets.unowned.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 0,
                  height: 0,
                  overflow: 'visible',
                  pointerEvents: 'none',
                }}
              >
                <StaticObjectsLayer
                  objects={clippedSheetBuckets.unowned}
                  selectedIdSet={selectedIdSet}
                  layerMap={layerMap}
                  disablePointerEvents={
                    activeTool === 'pen' || activeTool === 'eraser' || activeTool === 'cut'
                  }
                  editingTextId={editingTextId}
                  editingEquationId={editingEquationId}
                  editingDimensionId={editingDimensionId}
                  editingTableId={editingTableId}
                  editingTableCell={editingTableCell}
                  equationCursor={equationCursor}
                  dimOverrideDraft={dimOverrideDraft}
                  zoom={board.viewport.zoom}
                  shouldClipToFrame={false}
                  pageFrameY={null}
                  cadConfig={cadConfig}
                  isDarkSurface={boardTheme.isDarkSurface}
                  boardBg={boardTheme.boardBg}
                  adaptStrokeColorsToCanvasBg={adaptStrokeColorsToCanvasBg}
                  spellcheckEnabled={spellcheckEnabled}
                  defaultSpellcheckLang={defaultSpellcheckLang}
                  editingTextareaRef={editingTextareaRef}
                  equationInputRef={equationInputRef}
                  activeRichTextEditorRef={activeRichTextEditorRef}
                  onObjectPointerDown={stableObjectPointerDown}
                  onObjectDoubleClick={stableObjectDoubleClick}
                  onObjectContextMenu={stableObjectContextMenu}
                  onUpdateObjects={onUpdateObjects}
                  onSelectIds={onSelectIds}
                  onDeleteObjects={onDeleteObjects}
                  onSetEditingTextId={onSetEditingTextId}
                  onSetEditingEquationId={onSetEditingEquationId}
                  onSetEditingDimensionId={onSetEditingDimensionId}
                  onSetEditingTableCell={onSetEditingTableCell}
                  onEquationCursorChange={onEquationCursorChange}
                  onOpenEquationModal={onOpenEquationModal}
                  onRequestTextEquationEditor={onRequestTextEquationEditor}
                  onActiveInlineTextEquationChange={onActiveInlineTextEquationChange}
                  onRichTextSelectionSummaryChange={onRichTextSelectionSummaryChange}
                  onRepairTextBox={stableRepairTextBox}
                  onRepairTableObject={onRepairTableObject}
                  onCommitTableWithSnapshot={stableCommitTableWithSnapshot}
                  onDimOverrideDraftChange={setDimOverrideDraft}
                  onUndo={onUndo}
                  onRedo={onRedo}
                />
              </div>
            )}
            {sheets.map((sheet, sheetIdx) => {
              const sheetY = getSheetY(sheetIdx, fixedPage.height);
              const sheetObjs = clippedSheetBuckets.bySheet[sheetIdx] || [];
              if (sheetObjs.length === 0) return null;
              return (
                <div
                  key={`clip-sheet-${sheet.id}`}
                  data-frame-clip-layer="true"
                  style={{
                    position: 'absolute',
                    left: pageFrame.x,
                    top: sheetY + pageFrame.y,
                    width: pageFrame.width,
                    height: pageFrame.height,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: -pageFrame.x,
                      top: -(sheetY + pageFrame.y),
                      pointerEvents: 'none',
                    }}
                  >
                    <StaticObjectsLayer
                      objects={sheetObjs}
                      selectedIdSet={selectedIdSet}
                      layerMap={layerMap}
                      disablePointerEvents={
                        activeTool === 'pen' || activeTool === 'eraser' || activeTool === 'cut'
                      }
                      editingTextId={editingTextId}
                      editingEquationId={editingEquationId}
                      editingDimensionId={editingDimensionId}
                      editingTableId={editingTableId}
                      editingTableCell={editingTableCell}
                      equationCursor={equationCursor}
                      dimOverrideDraft={dimOverrideDraft}
                      zoom={board.viewport.zoom}
                      shouldClipToFrame={shouldClipToFrame}
                      pageFrameY={sheetY + pageFrame.y}
                      cadConfig={cadConfig}
                      isDarkSurface={boardTheme.isDarkSurface}
                      boardBg={boardTheme.boardBg}
                      adaptStrokeColorsToCanvasBg={adaptStrokeColorsToCanvasBg}
                      spellcheckEnabled={spellcheckEnabled}
                      defaultSpellcheckLang={defaultSpellcheckLang}
                      editingTextareaRef={editingTextareaRef}
                      equationInputRef={equationInputRef}
                      activeRichTextEditorRef={activeRichTextEditorRef}
                      onObjectPointerDown={stableObjectPointerDown}
                      onObjectDoubleClick={stableObjectDoubleClick}
                      onObjectContextMenu={stableObjectContextMenu}
                      onUpdateObjects={onUpdateObjects}
                      onSelectIds={onSelectIds}
                      onDeleteObjects={onDeleteObjects}
                      onSetEditingTextId={onSetEditingTextId}
                      onSetEditingEquationId={onSetEditingEquationId}
                      onSetEditingDimensionId={onSetEditingDimensionId}
                      onSetEditingTableCell={onSetEditingTableCell}
                      onEquationCursorChange={onEquationCursorChange}
                      onOpenEquationModal={onOpenEquationModal}
                      onRequestTextEquationEditor={onRequestTextEquationEditor}
                      onActiveInlineTextEquationChange={onActiveInlineTextEquationChange}
                      onRichTextSelectionSummaryChange={onRichTextSelectionSummaryChange}
                      onRepairTextBox={stableRepairTextBox}
                      onRepairTableObject={onRepairTableObject}
                      onCommitTableWithSnapshot={stableCommitTableWithSnapshot}
                      onDimOverrideDraftChange={setDimOverrideDraft}
                      onUndo={onUndo}
                      onRedo={onRedo}
                    />
                  </div>
                </div>
              );
            })}
            {/* Previsualización de trazo/figura/línea activa sin recorte entre hojas */}
            {interaction.mode === 'pen' && interaction.draftPoints && (
              <svg className="overflow-visible pointer-events-none absolute top-0 left-0" width={1} height={1}>
                <path
                  d={buildSmoothSvgPath(interaction.draftPoints)}
                  fill="none"
                  stroke={resolveDisplayStrokeColor(toolOptions.penColor)}
                  strokeWidth={toolOptions.penWidth}
                  strokeOpacity={toolOptions.penOpacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {interaction.mode === 'draw-shape' &&
              interaction.currentWorld &&
              (() => {
                const p1 = interaction.startWorld;
                const p2 = interaction.currentWorld;
                const x = Math.min(p1.x, p2.x);
                const y = Math.min(p1.y, p2.y);
                const w = Math.abs(p2.x - p1.x);
                const h = Math.abs(p2.y - p1.y);
                if (w < 1 && h < 1) return null;
                const safeW = Math.max(1, w);
                const safeH = Math.max(1, h);
                return (
                  <svg
                    data-export-ignore="true"
                    shapeRendering="geometricPrecision"
                    className="overflow-visible pointer-events-none absolute top-0 left-0 z-30"
                    style={{ left: x, top: y }}
                    width={safeW}
                    height={safeH}
                    viewBox={`0 0 ${safeW} ${safeH}`}
                  >
                    {renderShapeSvgElement(toolOptions.shapeKind, safeW, safeH, {
                      strokeColor: resolveDisplayStrokeColor(toolOptions.shapeStrokeColor),
                      fillColor: toolOptions.shapeFillColor,
                      strokeWidth: toolOptions.shapeStrokeWidth,
                      strokeStyle: toolOptions.shapeStrokeStyle,
                      polygonSides: toolOptions.polygonSides,
                      arcStartAngle: 0,
                      arcEndAngle: 220,
                    })}
                  </svg>
                );
              })()}
            {interaction.mode === 'draw-line' && interaction.currentWorld && (
              <svg
                data-export-ignore="true"
                shapeRendering="geometricPrecision"
                className="overflow-visible pointer-events-none absolute top-0 left-0 z-30"
                width={1}
                height={1}
              >
                <line
                  x1={interaction.startWorld.x}
                  y1={interaction.startWorld.y}
                  x2={interaction.currentWorld.x}
                  y2={interaction.currentWorld.y}
                  stroke={resolveDisplayStrokeColor(toolOptions.shapeStrokeColor)}
                  strokeWidth={toolOptions.shapeStrokeWidth}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </>
        ) : (
        <div
          data-frame-clip-layer="true"
          style={
            shouldClipToFrame && pageFrame
              ? {
                  position: 'absolute',
                  left: pageFrame.x,
                  top: pageFrame.y,
                  width: pageFrame.width,
                  height: pageFrame.height,
                  overflow: 'hidden',
                  pointerEvents: 'none',
                }
              : {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 0,
                  height: 0,
                  overflow: 'visible',
                  pointerEvents: 'none',
                }
          }
        >
          <div
            style={{
              position: 'absolute',
              left: shouldClipToFrame && pageFrame ? -pageFrame.x : 0,
              top: shouldClipToFrame && pageFrame ? -pageFrame.y : 0,
              pointerEvents: 'none',
            }}
          >
        {/* OPT: 1.5, 2.2, 2.3, 2.5, 2.6 — Capa memoizada de contenido estático con culling */}
        <StaticObjectsLayer
          objects={renderedObjects}
          selectedIdSet={selectedIdSet}
          layerMap={layerMap}
          disablePointerEvents={
            activeTool === 'pen' || activeTool === 'eraser' || activeTool === 'cut'
          }
          editingTextId={editingTextId}
          editingEquationId={editingEquationId}
          editingDimensionId={editingDimensionId}
          editingTableId={editingTableId}
          editingTableCell={editingTableCell}
          equationCursor={equationCursor}
          dimOverrideDraft={dimOverrideDraft}
          zoom={board.viewport.zoom}
          shouldClipToFrame={shouldClipToFrame}
          pageFrameY={pageFrame ? pageFrame.y : null}
          cadConfig={cadConfig}
          isDarkSurface={boardTheme.isDarkSurface}
          boardBg={boardTheme.boardBg}
          adaptStrokeColorsToCanvasBg={adaptStrokeColorsToCanvasBg}
          spellcheckEnabled={spellcheckEnabled}
          defaultSpellcheckLang={defaultSpellcheckLang}
          editingTextareaRef={editingTextareaRef}
          equationInputRef={equationInputRef}
          activeRichTextEditorRef={activeRichTextEditorRef}
          onObjectPointerDown={stableObjectPointerDown}
          onObjectDoubleClick={stableObjectDoubleClick}
          onObjectContextMenu={stableObjectContextMenu}
          onUpdateObjects={onUpdateObjects}
          onSelectIds={onSelectIds}
          onDeleteObjects={onDeleteObjects}
          onSetEditingTextId={onSetEditingTextId}
          onSetEditingEquationId={onSetEditingEquationId}
          onSetEditingDimensionId={onSetEditingDimensionId}
          onSetEditingTableCell={onSetEditingTableCell}
          onEquationCursorChange={onEquationCursorChange}
          onOpenEquationModal={onOpenEquationModal}
          onRequestTextEquationEditor={onRequestTextEquationEditor}
          onActiveInlineTextEquationChange={onActiveInlineTextEquationChange}
          onRichTextSelectionSummaryChange={onRichTextSelectionSummaryChange}
          onRepairTextBox={stableRepairTextBox}
          onRepairTableObject={onRepairTableObject}
          onCommitTableWithSnapshot={stableCommitTableWithSnapshot}
          onDimOverrideDraftChange={setDimOverrideDraft}
          onUndo={onUndo}
          onRedo={onRedo}
        />

        {interaction.mode === 'pen' && interaction.draftPoints && (
          <svg className="overflow-visible pointer-events-none absolute top-0 left-0" width={1} height={1}>
            <path
              d={buildSmoothSvgPath(interaction.draftPoints)}
              fill="none"
              stroke={resolveDisplayStrokeColor(toolOptions.penColor)}
              strokeWidth={toolOptions.penWidth}
              strokeOpacity={toolOptions.penOpacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {interaction.mode === 'draw-shape' &&
          interaction.currentWorld &&
          (() => {
            const p1 = interaction.startWorld;
            const p2 = interaction.currentWorld;
            const x = Math.min(p1.x, p2.x);
            const y = Math.min(p1.y, p2.y);
            const w = Math.abs(p2.x - p1.x);
            const h = Math.abs(p2.y - p1.y);
            if (w < 1 && h < 1) return null;
            const safeW = Math.max(1, w);
            const safeH = Math.max(1, h);
            return (
              <svg
                data-export-ignore="true"
                shapeRendering="geometricPrecision"
                className="overflow-visible pointer-events-none absolute top-0 left-0 z-30"
                style={{ left: x, top: y }}
                width={safeW}
                height={safeH}
                viewBox={`0 0 ${safeW} ${safeH}`}
              >
                {renderShapeSvgElement(toolOptions.shapeKind, safeW, safeH, {
                  strokeColor: resolveDisplayStrokeColor(toolOptions.shapeStrokeColor),
                  fillColor: toolOptions.shapeFillColor,
                  strokeWidth: toolOptions.shapeStrokeWidth,
                  strokeStyle: toolOptions.shapeStrokeStyle,
                  polygonSides: toolOptions.polygonSides,
                  arcStartAngle: 0,
                  arcEndAngle: 220,
                })}
              </svg>
            );
          })()}

        {interaction.mode === 'draw-line' && interaction.currentWorld && (
          <svg
            data-export-ignore="true"
            shapeRendering="geometricPrecision"
            className="overflow-visible pointer-events-none absolute top-0 left-0 z-30"
            width={1}
            height={1}
          >
            <line
              x1={interaction.startWorld.x}
              y1={interaction.startWorld.y}
              x2={interaction.currentWorld.x}
              y2={interaction.currentWorld.y}
              stroke={resolveDisplayStrokeColor(toolOptions.shapeStrokeColor)}
              strokeWidth={toolOptions.shapeStrokeWidth}
              strokeDasharray="6 4"
              strokeLinecap="round"
            />
          </svg>
        )}
          </div>
        </div>
        )}
        </>
        )}

        {/* OPT: 2.2 — Contornos y manejadores solo sobre los objetos seleccionados (evita recorrer todo visibleObjects) */}
        {selectedVisibleObjects.map((obj) => {
          const locked = isObjLocked(obj);
          const zoomNow = Math.max(0.1, board.viewport.zoom);
          const invZ = 1 / zoomNow;
          // Oculta y desactiva por completo los manejadores cuando hay comando CAD/selección de puntos o herramienta distinta de Selección
          const isPointCommandActive = Boolean(
            cadSession.activeCommand ||
              cadSession.pickingOrigin ||
              arrayPickMode ||
              pendingTableSize ||
              areaExportMode ||
              activeTool !== 'select'
          );
          const showSelectionOutline =
            editingEquationId !== obj.id &&
            editingDimensionId !== obj.id &&
            !(editingTableId === obj.id && Boolean(editingTableCell));
          const handlesEnabled = !isPointCommandActive && !locked && singleSelected?.id === obj.id;
          const showSolidMirrorBar =
            handlesEnabled &&
            interaction.mode === 'none' &&
            obj.type === 'shape' &&
            is3DSolidShape(obj.shapeKind);
          const showShapeVertices = handlesEnabled && obj.type === 'shape';
          const showLineHandles = handlesEnabled && obj.type === 'line';

          // Detección de líneas o cajas muy delgadas (< 14 px en pantalla) para no amontonar cuadros de redimensionamiento
          const isThinLine =
            obj.type === 'line' &&
            (Math.abs(obj.endPoint.x - obj.startPoint.x) * zoomNow < 14 ||
              Math.abs(obj.endPoint.y - obj.startPoint.y) * zoomNow < 14 ||
              obj.width * zoomNow <= 17 ||
              obj.height * zoomNow <= 17);
          const isThinWidth = obj.width * zoomNow < 14;
          const isThinHeight = obj.height * zoomNow < 14;

          if (!showSelectionOutline && !showSolidMirrorBar && !showShapeVertices && !showLineHandles) {
            return null;
          }

          const resizePositions: [HandleDir, string, number, number][] = [
            ['nw', 'cursor-nwse-resize', 0, 0],
            ['n', 'cursor-ns-resize', obj.width / 2, 0],
            ['ne', 'cursor-nesw-resize', obj.width, 0],
            ['e', 'cursor-ew-resize', obj.width, obj.height / 2],
            ['se', 'cursor-nwse-resize', obj.width, obj.height],
            ['s', 'cursor-ns-resize', obj.width / 2, obj.height],
            ['sw', 'cursor-nesw-resize', 0, obj.height],
            ['w', 'cursor-ew-resize', 0, obj.height / 2],
          ];
          const visibleResizeDirs = isThinLine
            ? []
            : resizePositions.filter(([dir]) => {
                if (isThinWidth && isThinHeight) return dir === 'se';
                if (isThinHeight && (dir === 'e' || dir === 'w')) return false;
                if (isThinWidth && (dir === 'n' || dir === 's')) return false;
                return true;
              });
          const resizeWorldPts = visibleResizeDirs.map(([, , lx, ly]) =>
            localToWorld({ x: lx, y: ly }, obj)
          );

          return (
            <div
              key={`sel-${obj.id}`}
              data-export-ignore="true"
              style={{
                position: 'absolute',
                left: obj.x,
                top: obj.y,
                width: obj.width,
                height: obj.height,
                transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                zIndex: obj.zIndex + 1000,
                pointerEvents: 'none',
              }}
            >
              {showSelectionOutline && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderStyle:
                      selectedVisibleObjects.length > 1 || locked || obj.type === 'dimension'
                        ? 'dashed'
                        : 'solid',
                    borderWidth: `${(selectedVisibleObjects.length > 1 ? 1 : 1.5) * invZ}px`,
                    borderColor: locked
                      ? '#f59e0b'
                      : obj.type === 'dimension'
                      ? '#0ea5e9'
                      : selectedVisibleObjects.length > 1
                      ? 'rgba(37, 99, 235, 0.45)'
                      : '#2563eb',
                  }}
                >
                  {handlesEnabled && obj.type !== 'dimension' && (
                    <>
                      {/* Manejador de rotación (tamaño constante 10 px con zona de clic de 16 px) */}
                      <div
                        style={{
                          left: obj.width / 2,
                          top: -22 * invZ,
                          width: `${1.5 * invZ}px`,
                          height: `${22 * invZ}px`,
                          transform: 'translateX(-50%)',
                        }}
                        className="absolute bg-blue-600 pointer-events-none"
                      />
                      <div
                        onPointerDown={(e) => handleRotateHandleDown(e, obj)}
                        title="Rotar objeto (Shift: múltiplos de 15°)"
                        style={{
                          left: obj.width / 2,
                          top: -24 * invZ,
                          width: 16,
                          height: 16,
                          transform: `translate(-50%, -50%) scale(${invZ})`,
                        }}
                        className="pointer-events-auto absolute flex items-center justify-center cursor-grab group/hdl"
                      >
                        <span
                          className="w-[10px] h-[10px] rounded-full bg-white border-[1.5px] border-blue-600 transition-transform group-hover/hdl:scale-115"
                          style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.28)' }}
                        />
                      </div>

                      {visibleResizeDirs.map(([dir, cursorCls, lx, ly], rIdx) => {
                        const thisWorld = resizeWorldPts[rIdx];
                        const siblings = resizeWorldPts.filter((_, j) => j !== rIdx);
                        return (
                          <div
                            key={dir}
                            onPointerDown={(e) =>
                              handleResizeHandleDown(e, obj, dir, thisWorld, siblings)
                            }
                            style={{
                              left: lx,
                              top: ly,
                              width: 16,
                              height: 16,
                              transform: `translate(-50%, -50%) scale(${invZ})`,
                            }}
                            className={`pointer-events-auto absolute flex items-center justify-center group/hdl ${cursorCls}`}
                          >
                            <span
                              className="w-[8px] h-[8px] rounded-[1.5px] bg-white border-[1.5px] border-blue-600 transition-transform group-hover/hdl:scale-115"
                              style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.7), 0 1px 2px rgba(15,23,42,0.25)' }}
                            />
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {showSolidMirrorBar && obj.type === 'shape' && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    left: obj.width / 2,
                    top: obj.height + 10 * invZ,
                    transform: `translateX(-50%) scale(${invZ})`,
                    transformOrigin: 'top center',
                  }}
                  className="pointer-events-auto absolute flex items-center gap-1 px-1.5 py-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-700 shadow-lg z-40 whitespace-nowrap"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObjects(
                        [obj.id],
                        (o) => ({ ...(o as ShapeObject), flipX: !(o as ShapeObject).flipX }),
                        true
                      )
                    }
                    title="Invertir horizontalmente (espejo)"
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      obj.flipX
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <FlipHorizontal2 className="w-3.5 h-3.5" />
                    <span>H</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObjects(
                        [obj.id],
                        (o) => ({ ...(o as ShapeObject), flipY: !(o as ShapeObject).flipY }),
                        true
                      )
                    }
                    title="Invertir verticalmente (espejo)"
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      obj.flipY
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <FlipVertical2 className="w-3.5 h-3.5" />
                    <span>V</span>
                  </button>
                </div>
              )}

              {showShapeVertices &&
                obj.type === 'shape' &&
                (() => {
                  const geom = getShapeEditableGeometry(obj);
                  if (!geom) return null;
                  const edgeCount = geom.closed ? geom.vertices.length : geom.vertices.length - 1;
                  return (
                    <div className="absolute inset-0 pointer-events-none">
                      {geom.canInsertEdgeMidpoints &&
                        Array.from({ length: edgeCount }).map((_, idx) => {
                          const a = geom.vertices[idx];
                          const b = geom.vertices[(idx + 1) % geom.vertices.length];
                          const screenEdgeLen = Math.hypot(b.x - a.x, b.y - a.y) * zoomNow;
                          if (screenEdgeLen < 22) return null;
                          const mx = (a.x + b.x) / 2;
                          const my = (a.y + b.y) / 2;
                          return (
                            <div
                              key={`mid-${idx}`}
                              onPointerDown={(e) => handleVertexHandleDown(e, obj, idx, true)}
                              title="Arrastrar arista para añadir y mover un nuevo vértice"
                              style={{
                                left: mx,
                                top: my,
                                width: 16,
                                height: 16,
                                transform: `translate(-50%, -50%) scale(${invZ})`,
                              }}
                              className="pointer-events-auto absolute flex items-center justify-center opacity-85 hover:opacity-100 cursor-copy group/hdl"
                            >
                              <span
                                className="w-[7px] h-[7px] rounded-full bg-white border-[1.5px] border-pink-600 transition-transform group-hover/hdl:scale-115"
                                style={{ boxShadow: '0 0 0 1px rgba(15,23,42,0.35)' }}
                              />
                            </div>
                          );
                        })}
                      {geom.vertices.map((pt, idx) => (
                        <div
                          key={`vtx-${idx}`}
                          onPointerDown={(e) => handleVertexHandleDown(e, obj, idx, false)}
                          title={
                            geom.mode === 'ellipse-cardinal'
                              ? 'Arrastrar punto de arista para ajustar dimensión'
                              : geom.mode === 'solid-3d'
                              ? 'Arrastrar punto de arista 3D para cambiar tamaño manteniendo profundidad'
                              : 'Arrastrar vértice para deformar figura (Alt+clic para eliminar)'
                          }
                          style={{
                            left: pt.x,
                            top: pt.y,
                            width: 16,
                            height: 16,
                            transform: `translate(-50%, -50%) scale(${invZ})`,
                          }}
                          className="pointer-events-auto absolute flex items-center justify-center cursor-move group/hdl"
                        >
                          <span
                            className="w-[9px] h-[9px] rounded-full bg-[#e11d74] border-[1.5px] border-white transition-transform group-hover/hdl:scale-115"
                            style={{ boxShadow: '0 0 0 1px #0f172a, 0 1px 2px rgba(0,0,0,0.28)' }}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}

              {showLineHandles && obj.type === 'line' && (
                <div className="absolute inset-0 pointer-events-none">
                  <div
                    onPointerDown={(e) => handleLinePointDown(e, obj, 'start')}
                    title="Arrastrar extremo inicial (Shift: ángulos cada 15°)"
                    style={{
                      left: obj.startPoint.x,
                      top: obj.startPoint.y,
                      width: 16,
                      height: 16,
                      transform: `translate(-50%, -50%) scale(${invZ})`,
                    }}
                    className="pointer-events-auto absolute flex items-center justify-center cursor-move group/hdl"
                  >
                    <span
                      className="w-[9px] h-[9px] rounded-full bg-[#e11d74] border-[1.5px] border-white transition-transform group-hover/hdl:scale-115"
                      style={{ boxShadow: '0 0 0 1px #0f172a, 0 1px 2px rgba(0,0,0,0.28)' }}
                    />
                  </div>
                  <div
                    onPointerDown={(e) => handleLinePointDown(e, obj, 'end')}
                    title="Arrastrar extremo final (Shift: ángulos cada 15°)"
                    style={{
                      left: obj.endPoint.x,
                      top: obj.endPoint.y,
                      width: 16,
                      height: 16,
                      transform: `translate(-50%, -50%) scale(${invZ})`,
                    }}
                    className="pointer-events-auto absolute flex items-center justify-center cursor-move group/hdl"
                  >
                    <span
                      className="w-[9px] h-[9px] rounded-full bg-[#e11d74] border-[1.5px] border-white transition-transform group-hover/hdl:scale-115"
                      style={{ boxShadow: '0 0 0 1px #0f172a, 0 1px 2px rgba(0,0,0,0.28)' }}
                    />
                  </div>
                  {obj.lineKind === 'connector' && (
                    <div
                      onPointerDown={(e) => handleLinePointDown(e, obj, 'control')}
                      title="Arrastrar punto de curvatura"
                      style={{
                        left:
                          obj.controlPoint?.x ??
                          (obj.startPoint.x + obj.endPoint.x) / 2,
                        top:
                          obj.controlPoint?.y ??
                          (obj.startPoint.y + obj.endPoint.y) / 2 - 36,
                        width: 16,
                        height: 16,
                        transform: `translate(-50%, -50%) scale(${invZ})`,
                      }}
                      className="pointer-events-auto absolute flex items-center justify-center cursor-move group/hdl"
                    >
                      <span
                        className="w-[9px] h-[9px] rounded-full bg-amber-400 border-[1.5px] border-white transition-transform group-hover/hdl:scale-115"
                        style={{ boxShadow: '0 0 0 1px #0f172a, 0 1px 2px rgba(0,0,0,0.28)' }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Marco unificado y manejadores solidarios de escala/rotación para grupos o selección múltiple */}
        {selectedVisibleObjects.length > 1 &&
          (() => {
            const frameBox =
              interaction.mode === 'group-rotate' && interaction.groupBox
                ? interaction.groupBox
                : groupWorldBox;
            if (!frameBox) return null;
            const frameRotation =
              interaction.mode === 'group-rotate' ? interaction.groupDeltaDeg ?? 0 : 0;
            const zoomNow = Math.max(0.1, board.viewport.zoom);
            const invZ = 1 / zoomNow;
            const isPointCommandActive = Boolean(
              cadSession.activeCommand ||
                cadSession.pickingOrigin ||
                arrayPickMode ||
                pendingTableSize ||
                areaExportMode ||
                activeTool !== 'select'
            );
            const unlockedCount = selectedVisibleObjects.filter((o) => !isObjLocked(o)).length;
            const groupHandlesEnabled = !isPointCommandActive && unlockedCount > 0;
            const maxZ = selectedVisibleObjects.reduce((m, o) => Math.max(m, o.zIndex), 0);
            const groupResizeDirs: [HandleDir, string, number, number][] = [
              ['nw', 'cursor-nwse-resize', 0, 0],
              ['n', 'cursor-ns-resize', frameBox.width / 2, 0],
              ['ne', 'cursor-nesw-resize', frameBox.width, 0],
              ['e', 'cursor-ew-resize', frameBox.width, frameBox.height / 2],
              ['se', 'cursor-nwse-resize', frameBox.width, frameBox.height],
              ['s', 'cursor-ns-resize', frameBox.width / 2, frameBox.height],
              ['sw', 'cursor-nesw-resize', 0, frameBox.height],
              ['w', 'cursor-ew-resize', 0, frameBox.height / 2],
            ];
            return (
              <div
                key="group-selection-frame"
                data-export-ignore="true"
                style={{
                  position: 'absolute',
                  left: frameBox.x,
                  top: frameBox.y,
                  width: frameBox.width,
                  height: frameBox.height,
                  transform: frameRotation ? `rotate(${frameRotation}deg)` : undefined,
                  transformOrigin: 'center center',
                  zIndex: maxZ + 1005,
                  pointerEvents: 'none',
                }}
              >
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderStyle: 'solid',
                    borderWidth: `${1.5 * invZ}px`,
                    borderColor: unlockedCount > 0 ? '#2563eb' : '#f59e0b',
                  }}
                >
                  {groupHandlesEnabled && (
                    <>
                      <div
                        style={{
                          left: frameBox.width / 2,
                          top: -22 * invZ,
                          width: `${1.5 * invZ}px`,
                          height: `${22 * invZ}px`,
                          transform: 'translateX(-50%)',
                        }}
                        className="absolute bg-blue-600 pointer-events-none"
                      />
                      <div
                        onPointerDown={(e) => handleGroupRotateHandleDown(e, frameBox)}
                        title="Rotar grupo solidariamente (Shift: múltiplos de 15°)"
                        style={{
                          left: frameBox.width / 2,
                          top: -24 * invZ,
                          width: 16,
                          height: 16,
                          transform: `translate(-50%, -50%) scale(${invZ})`,
                        }}
                        className="pointer-events-auto absolute flex items-center justify-center cursor-grab group/hdl"
                      >
                        <span
                          className="w-[10px] h-[10px] rounded-full bg-white border-[1.5px] border-blue-600 transition-transform group-hover/hdl:scale-115"
                          style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.28)' }}
                        />
                      </div>

                      {groupResizeDirs.map(([dir, cursorCls, lx, ly]) => (
                        <div
                          key={dir}
                          onPointerDown={(e) => handleGroupResizeHandleDown(e, dir, frameBox)}
                          style={{
                            left: lx,
                            top: ly,
                            width: 16,
                            height: 16,
                            transform: `translate(-50%, -50%) scale(${invZ})`,
                          }}
                          className={`pointer-events-auto absolute flex items-center justify-center group/hdl ${cursorCls}`}
                        >
                          <span
                            className="w-[8px] h-[8px] rounded-[1.5px] bg-white border-[1.5px] border-blue-600 transition-transform group-hover/hdl:scale-115"
                            style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.7), 0 1px 2px rgba(15,23,42,0.25)' }}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })()}

        {/* Live Draft Previews */}
        <CadWorldOverlay
          viewport={board.viewport}
          cadConfig={cadConfig}
          cadSession={cadSession}
          resolvedCursor={liveCadCursor}
          toolOptions={toolOptions}
          layerId={board.activeLayerId}
          objects={visibleObjects}
          groups={board.groups ?? []}
          selectedIds={selectedIds}
          livePathArrayDraft={livePathArrayDraft}
          arrayPickMode={arrayPickMode}
          boardTheme={boardTheme}
          stageSize={stageSize}
          onTrackingError={onTrackingError}
        />

        {interaction.mode === 'marquee' && interaction.currentWorld && (
          <div
            className="absolute border border-blue-600 bg-blue-500/10 pointer-events-none"
            style={{
              left: Math.min(interaction.startWorld.x, interaction.currentWorld.x),
              top: Math.min(interaction.startWorld.y, interaction.currentWorld.y),
              width: Math.abs(interaction.currentWorld.x - interaction.startWorld.x),
              height: Math.abs(interaction.currentWorld.y - interaction.startWorld.y),
            }}
          />
        )}

        {interaction.mode === 'draw-text' &&
          interaction.currentWorld &&
          Math.abs(interaction.currentWorld.x - interaction.startWorld.x) >= 6 && (
            <div
              data-export-ignore="true"
              className="absolute border-2 border-dashed border-blue-600 bg-blue-500/5 rounded pointer-events-none"
              style={{
                left: Math.min(interaction.startWorld.x, interaction.currentWorld.x),
                top: Math.min(interaction.startWorld.y, interaction.currentWorld.y),
                width: Math.abs(interaction.currentWorld.x - interaction.startWorld.x),
                height: Math.max(
                  40,
                  Math.abs(interaction.currentWorld.y - interaction.startWorld.y)
                ),
              }}
            />
          )}

        {activeTool === 'eraser' && eraserCursor && (
          <div
            data-export-ignore="true"
            className="absolute rounded-full pointer-events-none"
            style={{
              left: eraserCursor.x - toolOptions.eraserRadius / board.viewport.zoom,
              top: eraserCursor.y - toolOptions.eraserRadius / board.viewport.zoom,
              width: (toolOptions.eraserRadius * 2) / board.viewport.zoom,
              height: (toolOptions.eraserRadius * 2) / board.viewport.zoom,
              border: `2px solid ${cursorPalette.fill}`,
              boxShadow: `0 0 0 1.5px ${cursorPalette.halo}, inset 0 0 0 1px ${cursorPalette.halo}`,
              backgroundColor: boardTheme.isDarkSurface
                ? 'rgba(255, 255, 255, 0.16)'
                : 'rgba(255, 255, 255, 0.35)',
            }}
          />
        )}

        {/* CAD Cutting Blade Preview (drag cut) */}
        {interaction.mode === 'draw-cut' && interaction.currentWorld && (
          <svg
            data-export-ignore="true"
            className="overflow-visible pointer-events-none absolute top-0 left-0 z-40"
            width={1}
            height={1}
          >
            <line
              x1={interaction.startWorld.x}
              y1={interaction.startWorld.y}
              x2={interaction.currentWorld.x}
              y2={interaction.currentWorld.y}
              stroke="#ef4444"
              strokeWidth={2.2 / board.viewport.zoom}
              strokeDasharray={`${6 / board.viewport.zoom} ${4 / board.viewport.zoom}`}
              strokeLinecap="round"
            />
            {bladePreview?.intersections.map((pt, i) => (
              <g key={i}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={5 / board.viewport.zoom}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={1.5 / board.viewport.zoom}
                />
              </g>
            ))}
          </svg>
        )}

        {/* Trim Hover Preview */}
        {activeTool === 'cut' && interaction.mode === 'none' && trimPreview && (
          <svg
            data-export-ignore="true"
            className="overflow-visible pointer-events-none absolute top-0 left-0 z-40"
            width={1}
            height={1}
          >
            {trimPreview.highlightPolygon && (
              <polygon
                points={trimPreview.highlightPolygon
                  .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                  .join(' ')}
                fill="rgba(239, 68, 68, 0.22)"
                stroke="#ef4444"
                strokeWidth={2.5 / board.viewport.zoom}
                strokeDasharray={`${6 / board.viewport.zoom} ${4 / board.viewport.zoom}`}
              />
            )}
            {trimPreview.highlightSegments.map(([a, b], i) => (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#ef4444"
                strokeWidth={3.5 / board.viewport.zoom}
                strokeLinecap="round"
              />
            ))}
            {trimPreview.intersectionPoints.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={5 / board.viewport.zoom}
                fill="#f97316"
                stroke="#ffffff"
                strokeWidth={1.5 / board.viewport.zoom}
              />
            ))}
          </svg>
        )}
        </div>
      </div>

      {/* Dynamic CAD Coordinate & Dimension HUD near Cursor */}
      <CadDynamicHud
        viewport={board.viewport}
        stageSize={stageSizeRef.current}
        cadConfig={cadConfig}
        cadSession={cadSession}
        resolvedCursor={liveCadCursor}
        dragBaseWorld={
          interaction.mode === 'draw-line' || interaction.mode === 'draw-shape'
            ? interaction.startWorld
            : interaction.mode === 'drag-line-point' && interaction.initialLinePoints
            ? interaction.linePointRole === 'start'
              ? interaction.initialLinePoints.end
              : interaction.linePointRole === 'end'
              ? interaction.initialLinePoints.start
              : null
            : null
        }
      />

      {/* Interactive Array Canvas Pick Hint */}
      {arrayPickMode && (
        <div
          data-export-ignore="true"
          className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900/95 text-white text-xs px-3.5 py-1.5 rounded-lg shadow-lg flex items-center gap-3 z-30 border border-slate-700 pointer-events-none whitespace-nowrap"
        >
          <span>
            {arrayPickMode === 'polar-center'
              ? 'Haz clic en la pizarra para fijar el centro de la matriz polar'
              : arrayPickMode === 'path-base-point'
              ? 'Haz clic en la pizarra (usa RG □ △ ○ ◇) para marcar el punto base de los objetos'
              : 'Haz clic sobre una línea, trazo libre o figura para usarla como camino'}
          </span>
        </div>
      )}

      {/* CAD Cut Tool Hint */}
      {activeTool === 'cut' && !areaExportMode && !arrayPickMode && (
        <div
          data-export-ignore="true"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-900/95 text-white text-xs px-3.5 py-1.5 rounded-lg shadow-lg flex items-center gap-3 z-30 border border-slate-700 pointer-events-none whitespace-nowrap"
        >
          <span>
            Herramienta Cortar: arrastra una línea sobre figuras o líneas para dividirlas · Clic sobre un tramo entre intersecciones para recortar
          </span>
        </div>
      )}

      {/* Area Export Interactive Crop Overlay */}
      {areaExportMode && (
        <div
          data-export-ignore="true"
          className="absolute inset-0 z-40 pointer-events-none"
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900/95 text-white text-xs px-3.5 py-2 rounded-lg shadow-xl flex items-center gap-3 z-50 border border-slate-700"
          >
            <span>
              Arrastra sobre la pizarra para marcar el área a exportar · Esc para cancelar
            </span>
            <button
              type="button"
              onClick={() => {
                setAreaDrag(null);
                onCancelAreaExport();
              }}
              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded text-[11px] font-medium"
            >
              Cancelar
            </button>
          </div>

          {areaOverlayRect && (
            <div
              className="absolute border-2 border-blue-500 border-dashed pointer-events-none"
              style={{
                left: areaOverlayRect.x,
                top: areaOverlayRect.y,
                width: areaOverlayRect.width,
                height: areaOverlayRect.height,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.42)',
              }}
            >
              <div className="absolute -bottom-6 right-0 px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-mono-tabular whitespace-nowrap shadow">
                {Math.round(areaOverlayRect.width)} × {Math.round(areaOverlayRect.height)} px
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drag & Drop File Overlay */}
      {isDragOver && (
        <div
          data-export-ignore="true"
          className="absolute inset-0 bg-blue-600/15 border-4 border-dashed border-blue-600 flex items-center justify-center z-40 pointer-events-none"
        >
          <div className="bg-white dark:bg-slate-900 px-6 py-4 rounded-xl shadow-xl text-sm font-semibold text-blue-700 dark:text-blue-300">
            Suelta aquí imágenes (PNG, JPG, SVG) o documentos (PDF, DOCX, XLSX, TXT)
          </div>
        </div>
      )}

      {/* Aviso de colocación interactiva de tabla por clic en el lienzo */}
      {pendingTableSize && (
        <div
          data-export-ignore="true"
          className="no-print absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900/95 text-white text-xs px-3.5 py-1.5 rounded-lg shadow-lg flex items-center gap-3 z-30 border border-slate-700"
        >
          <span>
            Haz clic en la pizarra para colocar la tabla ({pendingTableSize.rows}×
            {pendingTableSize.cols}) · Esc para cancelar
          </span>
          <button
            type="button"
            onClick={() => onCancelPendingTable?.()}
            className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[11px]"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Right-Click Contextual Menu for Selected Elements + Empty-Canvas Quick Menu */}
      <CanvasContextMenu
        selectedObjects={selectedVisibleObjects}
        elementMenuAnchor={elementMenuAnchor}
        onCloseElementMenu={() => setElementMenuAnchor(null)}
        stageSize={stageSize}
        hidden={
          interaction.mode !== 'none' ||
          Boolean(
            editingTextId ||
              editingEquationId ||
              editingDimensionId ||
              (editingTableId && editingTableCell)
          ) ||
          areaExportMode ||
          Boolean(pendingTableSize) ||
          Boolean(arrayPickMode) ||
          Boolean(cadSession.activeCommand || cadSession.pickingOrigin) ||
          (selectedVisibleObjects.length > 0 && activeTool !== 'select')
        }
        backgroundPattern={board.backgroundPattern}
        showCoordinates={board.showCoordinates}
        snapToGrid={board.snapToGrid}
        cadConfig={cadConfig}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        bottomBarsCollapsed={bottomBarsCollapsed}
        autoTransparentPanels={autoTransparentPanels}
        cleanWorkMode={cleanWorkMode}
        actions={contextActions}
      />

      {/* Direct ; Quick Command Execution HUD */}
      {renderQuickCommandHud?.(stageSize)}
    </div>
  );
};
