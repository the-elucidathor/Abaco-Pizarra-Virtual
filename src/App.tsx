import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { BoardTabs } from './components/BoardTabs';
import { LeftToolbar } from './components/LeftToolbar';
import { RightInspector } from './components/RightInspector';
import { BottomBar } from './components/BottomBar';
import { CanvasStage } from './components/CanvasStage';
import { EquationRibbonBar } from './components/EquationRibbonBar';
import type { ExportCropRect } from './components/modals/ExportModal';
import type {
  ArrayModalKind,
  ArrayModalSubmitPayload,
} from './components/modals/ArrayModal';
import type { NewBoardModalResult } from './components/modals/NewBoardModal';

// OPT: 1.1 — Carga diferida (code splitting) de modales pesados para reducir el bundle inicial
const EquationEditorModal = lazy(() =>
  import('./components/modals/EquationEditorModal').then((m) => ({
    default: m.EquationEditorModal,
  }))
);
const GraphEditorModal = lazy(() =>
  import('./components/modals/GraphEditorModal').then((m) => ({
    default: m.GraphEditorModal,
  }))
);
const ProjectManagerModal = lazy(() =>
  import('./components/modals/ProjectManagerModal').then((m) => ({
    default: m.ProjectManagerModal,
  }))
);
const ExportModal = lazy(() =>
  import('./components/modals/ExportModal').then((m) => ({
    default: m.ExportModal,
  }))
);
const SettingsModal = lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({
    default: m.SettingsModal,
  }))
);
const ArrayModal = lazy(() =>
  import('./components/modals/ArrayModal').then((m) => ({
    default: m.ArrayModal,
  }))
);
const NewBoardModal = lazy(() =>
  import('./components/modals/NewBoardModal').then((m) => ({
    default: m.NewBoardModal,
  }))
);
import {
  DEFAULT_TOOL_OPTIONS,
  createEmptyBoard,
  createNewProject,
  createStarterProject,
} from './data/defaultTemplates';
import {
  MAX_SHEETS_PER_BOARD,
  computeCenteredViewportForPage,
  findSheetIndexForObject,
  getSheetStridePx,
  getSheetY,
  getTotalSheetsHeight,
  isFixedSizeBoard,
  normalizarHojas,
} from './utils/boardSizes';
import {
  getLastOpenedProjectId,
  listProjectSummaries,
  loadProject,
  loadSettings,
  loadSheetWheelHintDismissed,
  saveProject,
  saveProjectDetailed,
  saveProjectViewportCacheSync,
  saveSettings,
  saveSheetWheelHintDismissed,
} from './services/storageService';
import type {
  AppSettings,
  Board,
  BoardSheet,
  CanvasObject,
  EquationObject,
  GraphObject,
  GroupRecord,
  Layer,
  Point2D,
  TextObject,
  ToolId,
  ToolOptions,
  WhiteboardProject,
} from './types/whiteboard';
import type {
  ActiveInlineEquationSession,
  InlineEquationRequest,
  RichTextEditorHandle,
} from './components/RichTextEditor';
import { SAFE_MODE_BOOT_KEY } from './components/AppErrorBoundary';
import {
  type SelectionStyleSummary,
  applyAlignToAllParagraphs,
  applyStyleToAllParagraphs,
  convertProjectToSafeMode,
  createParagraphsFromPlainText,
  ensureTextParagraphs,
  getCaretRunStyle,
  getDefaultRunStyle,
  repairCorruptedTextObject,
  replaceRangeWithMathRun,
  resolveRunStyle,
  syncTextObjectFromParagraphs,
  validateAndNormalizeProject,
} from './utils/richText';
import {
  createTableObject,
  normalizarTabla,
  type TableCellCoord,
} from './utils/tableUtils';
import { getRememberedTextLang } from './utils/spellcheck/personalDictionary';
import { clamp, formatDateTime, getObjectsBoundingBox, uid } from './utils/id';
import {
  type MathCursor,
  applySnippetAtCursor,
  getInitialEditCursor,
  jumpToNextSlotCursor,
} from './utils/latexEditorEngine';
import { CadCommandBar } from './components/CadCommandBar';
import {
  type CadCommandId,
  type CadDraftingConfig,
  type CadResolvedCursor,
  type CadSessionState,
  type CadSnapKind,
  type PathArraySessionOptions,
  DEFAULT_CAD_CONFIG,
  FEATURE_TRACKING_ENABLED,
  INITIAL_CAD_SESSION,
} from './types/cad';
import { cadDistToWorldDist } from './utils/cad/cadCoords';
import { recomputeAssociativeDimensions } from './utils/cad/cadDimensions';
import {
  addObjectsToGroup,
  cloneObjectsWithGroupTree,
  createGroupFromSelection,
  dissolveSpecificGroup,
  ensureGroupsArray,
  getGroupMemberObjects,
  pruneEmptyGroups,
  removeObjectsFromGroup,
  renameGroup,
  translateCanvasObject,
  ungroupTopLevelSelection,
} from './utils/cad/cadGroups';
import {
  type EndpointAlignMode,
  alignSelectedGeometricEndpoints,
  createPolylineFromSelectedSegments,
  getObjectsWorldBoundingBox,
  joinCompatibleSegments,
  rotateCanvasObjectAroundPivot,
} from './utils/cad/cadTransform';
import {
  extractWorldPathPoints,
  generatePathArray,
  generatePolarArray,
  generateRectangularArray,
} from './utils/cad/cadArrays';
import {
  type CadCommandEffect,
  applyCadPointPick,
  executeCadCommandText,
  finishOrCloseCadSession,
  startCadCommandSession,
} from './utils/cad/cadSessionController';
import type { CadCatalogItem } from './utils/cad/cadCommandCatalog';
import type { CanvasContextActions } from './components/CanvasContextMenu';
import { computeSweptEraserResult } from './utils/partialEraser';
import {
  getEffectiveBoardColors,
  isDarkThemePreset,
  resolveAdaptiveDrawColorForBoardBg,
} from './utils/themePalette';
import { PerfMonitorHud } from './components/PerfMonitorHud';
import { isOptEnabled } from './utils/optFlags';
import { publishCursorWorld } from './utils/cursorBus';
import { type BoardHistorySnapshot, captureBoardHistorySnapshot } from './utils/historySnapshot';

// OPT: 1.1 — Carga diferida del lanzador rápido de comandos
const QuickCommandHud = lazy(() =>
  import('./components/QuickCommandHud').then((m) => ({
    default: m.QuickCommandHud,
  }))
);

const STATIC_CURSOR_ORIGIN: Point2D = { x: 0, y: 0 }; // OPT: 2.6
const CAD_CONFIG_STORAGE_KEY = 'abaco_cad_config_v1';

function loadCadConfig(): CadDraftingConfig {
  try {
    const raw = localStorage.getItem(CAD_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CAD_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CadDraftingConfig>;
    const rawMaxPts = Number(parsed.trackingMaxPoints);
    const rawTolPx = Number(parsed.trackingTolerancePx);
    return {
      ...DEFAULT_CAD_CONFIG,
      ...parsed,
      trackingEnabled:
        typeof parsed.trackingEnabled === 'boolean'
          ? parsed.trackingEnabled
          : DEFAULT_CAD_CONFIG.trackingEnabled,
      trackingMode:
        parsed.trackingMode === 'acquire' || parsed.trackingMode === 'auto'
          ? parsed.trackingMode
          : DEFAULT_CAD_CONFIG.trackingMode,
      trackingShowPolarAngles:
        typeof parsed.trackingShowPolarAngles === 'boolean'
          ? parsed.trackingShowPolarAngles
          : DEFAULT_CAD_CONFIG.trackingShowPolarAngles,
      trackingMaxPoints: Number.isFinite(rawMaxPts)
        ? Math.min(5, Math.max(1, Math.round(rawMaxPts)))
        : DEFAULT_CAD_CONFIG.trackingMaxPoints,
      trackingTolerancePx: Number.isFinite(rawTolPx)
        ? Math.min(20, Math.max(4, Math.round(rawTolPx)))
        : DEFAULT_CAD_CONFIG.trackingTolerancePx,
      trackingSnapFreehand:
        typeof parsed.trackingSnapFreehand === 'boolean'
          ? parsed.trackingSnapFreehand
          : DEFAULT_CAD_CONFIG.trackingSnapFreehand,
      osnapModes: {
        ...DEFAULT_CAD_CONFIG.osnapModes,
        ...(parsed.osnapModes || {}),
      },
    };
  } catch {
    return DEFAULT_CAD_CONFIG;
  }
}

async function computeImageBlobDigest(blob: Blob): Promise<string> {
  try {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let hash = 2166136261;
    const step = Math.max(1, Math.floor(bytes.length / 4096));
    for (let i = 0; i < bytes.length; i += step) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return `${blob.size}:${(hash >>> 0).toString(16)}`;
  } catch {
    return `${blob.size}:${blob.type}`;
  }
}

export default function App() {
  const [project, setProject] = useState<WhiteboardProject>(() =>
    validateAndNormalizeProject(createStarterProject()).project
  );
  const [loadingInit, setLoadingInit] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [toolOptions, setToolOptions] = useState<ToolOptions>(() => {
    const initSettings = loadSettings();
    const initialInk = getEffectiveBoardColors(
      initSettings.theme,
      initSettings.canvasBgMode,
      initSettings.canvasBgCustomColor
    ).defaultInk;
    return {
      ...DEFAULT_TOOL_OPTIONS,
      penColor: initialInk,
      shapeStrokeColor: initialInk,
      textColor: initialInk,
    };
  });
  const [cadConfig, setCadConfig] = useState<CadDraftingConfig>(() => loadCadConfig());
  const [cadSession, setCadSession] = useState<CadSessionState>(INITIAL_CAD_SESSION);
  const [cadInputValue, setCadInputValue] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<{
    objects: CanvasObject[];
    groups: GroupRecord[];
  }>({ objects: [], groups: [] });
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  const clipSeqRef = useRef(0);
  const internalClipboardMetaRef = useRef<{
    token: string;
    copiedAt: number;
    osCleared: boolean;
    preferInternal: boolean;
    blurredSinceCopy: boolean;
  }>({
    token: '',
    copiedAt: 0,
    osCleared: false,
    preferInternal: false,
    blurredSinceCopy: false,
  });
  const lastSeenImageDigestRef = useRef<{ digest: string; seenAt: number } | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(Date.now());
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [bottomBarsCollapsed, setBottomBarsCollapsed] = useState(false);
  const [autoTransparentPanels, setAutoTransparentPanels] = useState(false);
  const [cleanWorkMode, setCleanWorkMode] = useState(false);
  const [pointerOverCanvas, setPointerOverCanvas] = useState(false);
  const [panelHovered, setPanelHovered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [noticeToast, setNoticeToast] = useState<string | null>(null);
  const [sheetWheelHintVisible, setSheetWheelHintVisible] = useState(false);
  const sheetWheelHintTriggeredRef = useRef(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingEquationId, setEditingEquationId] = useState<string | null>(null);
  const [activeInlineEquation, setActiveInlineEquation] = useState<{
    objId: string;
    session: ActiveInlineEquationSession;
  } | null>(null);
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(null);
  const [editingTableCell, setEditingTableCell] = useState<{
    objectId: string;
    r: number;
    c: number;
  } | null>(null);
  const [pendingTableSize, setPendingTableSize] = useState<{
    rows: number;
    cols: number;
  } | null>(null);
  const [equationCursor, setEquationCursor] = useState<MathCursor>({ path: [], offset: 0 });
  const [areaExportMode, setAreaExportMode] = useState(false);
  const [exportAreaRect, setExportAreaRect] = useState<ExportCropRect | null>(null);
  const [arrayModal, setArrayModal] = useState<{
    open: boolean;
    kind: ArrayModalKind;
  }>({ open: false, kind: 'rect' });
  const [arrayPickMode, setArrayPickMode] = useState<
    'polar-center' | 'path-object' | 'path-base-point' | null
  >(null);
  const [pickedPolarCenterWorld, setPickedPolarCenterWorld] = useState<Point2D | null>(null);
  const [pickedPathId, setPickedPathId] = useState<string | null>(null);
  const [pickedPathBasePointWorld, setPickedPathBasePointWorld] = useState<Point2D | null>(null);
  const [livePathArrayDraft, setLivePathArrayDraft] = useState<PathArraySessionOptions | null>(
    null
  );

  // Multi-sheet state (v1.11.2)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [deleteSheetConfirm, setDeleteSheetConfirm] = useState<{
    sheetIndex: number;
    sheetNumber: number;
    ownedCount: number;
  } | null>(null);

  // History per board (objects + nested groups + sheets atomically)
  const [undoStack, setUndoStack] = useState<BoardHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BoardHistorySnapshot[]>([]);

  // Modals
  const [equationModal, setEquationModal] = useState<{
    open: boolean;
    editing?: EquationObject | null;
  }>({ open: false });
  const [inlineTextEquationModal, setInlineTextEquationModal] = useState<{
    objId: string;
    req: InlineEquationRequest;
  } | null>(null);
  const [graphModal, setGraphModal] = useState<{
    open: boolean;
    editing?: GraphObject | null;
  }>({ open: false });
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [newBoardModal, setNewBoardModal] = useState<{
    open: boolean;
    mode: 'board' | 'project';
    folderId?: string;
  }>({ open: false, mode: 'board' });

  const [inspectorTab, setInspectorTab] = useState<'props' | 'layers' | 'arrange'>('props');
  const [quickCmdOpen, setQuickCmdOpen] = useState(false);
  const [quickCmdAnchor, setQuickCmdAnchor] = useState<Point2D | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const equationInputRef = useRef<HTMLInputElement | null>(null);
  const activeRichTextEditorRef = useRef<RichTextEditorHandle | null>(null);
  const [richTextSummary, setRichTextSummary] = useState<SelectionStyleSummary | null>(null);
  const cadInputRef = useRef<HTMLInputElement | null>(null);
  const savedGridPatternRef = useRef<Board['backgroundPattern']>('grid');
  const fileImportInputRef = useRef<HTMLInputElement | null>(null);
  const pizarraOpenInputRef = useRef<HTMLInputElement | null>(null);
  const lastPointerStageRef = useRef<Point2D | null>(null);
  const lastResolvedCursorRef = useRef<CadResolvedCursor | null>(null);
  const cursorWorldRef = useRef<Point2D>({ x: 0, y: 0 }); // OPT: 2.6
  const projectRef = useRef(project);
  projectRef.current = project;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const dirtyRef = useRef(false);
  const viewportDirtyRef = useRef(false);
  const isCanvasInteractingRef = useRef(false); // OPT: 1.2
  const autoSaveDebounceTimerRef = useRef<number | null>(null); // OPT: 1.2
  const viewportPersistTimerRef = useRef<number | null>(null);
  const viewportAnimRafRef = useRef<number | null>(null);
  const prevEffectiveBoardRef = useRef({
    key: `${settings.theme}|${settings.canvasBgMode}|${settings.canvasBgCustomColor}`,
    defaultInk: getEffectiveBoardColors(
      settings.theme,
      settings.canvasBgMode,
      settings.canvasBgCustomColor
    ).defaultInk,
  });
  const eraserSnapshotRef = useRef<{
    objects: CanvasObject[];
    groups: GroupRecord[];
  } | null>(null);
  const eraserModifiedRef = useRef(false);

  // Sincroniza tema de interfaz, color efectivo del lienzo y tintas predeterminadas con contraste automático
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.classList.toggle('dark', isDarkThemePreset(settings.theme));
    saveSettings(settings);

    const nextKey = `${settings.theme}|${settings.canvasBgMode}|${settings.canvasBgCustomColor}`;
    if (prevEffectiveBoardRef.current.key !== nextKey) {
      const prevInk = prevEffectiveBoardRef.current.defaultInk;
      const nextBoardColors = getEffectiveBoardColors(
        settings.theme,
        settings.canvasBgMode,
        settings.canvasBgCustomColor
      );
      prevEffectiveBoardRef.current = {
        key: nextKey,
        defaultInk: nextBoardColors.defaultInk,
      };
      setToolOptions((prev) => ({
        ...prev,
        penColor: resolveAdaptiveDrawColorForBoardBg(prev.penColor, prevInk, nextBoardColors),
        shapeStrokeColor: resolveAdaptiveDrawColorForBoardBg(
          prev.shapeStrokeColor,
          prevInk,
          nextBoardColors
        ),
        textColor: resolveAdaptiveDrawColorForBoardBg(
          prev.textColor,
          prevInk,
          nextBoardColors
        ),
      }));
    }
  }, [settings]);

  // Persist CAD configuration
  useEffect(() => {
    try {
      localStorage.setItem(CAD_CONFIG_STORAGE_KEY, JSON.stringify(cadConfig));
    } catch {
      // ignore storage quota
    }
  }, [cadConfig]);

  // Validación previa al renderizado y recuperación automática en arranque (incluye modo seguro)
  const applyProjectValidation = useCallback((candidate: WhiteboardProject) => {
    let forceSafeMode = false;
    try {
      forceSafeMode = sessionStorage.getItem(SAFE_MODE_BOOT_KEY) === '1';
      if (forceSafeMode) sessionStorage.removeItem(SAFE_MODE_BOOT_KEY);
    } catch {
      forceSafeMode = false;
    }

    if (forceSafeMode) {
      const safeProj = convertProjectToSafeMode(candidate);
      setErrorToast('Proyecto abierto en modo seguro para proteger tu trabajo.');
      return safeProj;
    }

    const res = validateAndNormalizeProject(candidate);
    if (res.usedSafeMode) {
      setErrorToast('Se detectó un problema en el proyecto y se abrió en modo seguro.');
    } else if (res.repairedTextCount > 0) {
      setErrorToast(
        `Se normalizó el formato de ${res.repairedTextCount} cuadro(s) de texto automáticamente.`
      );
    }
    return res.project;
  }, []);

  // Manejadores globales para errores no capturados y promesas rechazadas sin derribar la interfaz
  useEffect(() => {
    const isViteHmrWsError = (msg: string, err: unknown): boolean => {
      if (/WebSocket closed without opened/i.test(msg)) return true;
      const stack = err instanceof Error ? err.stack || '' : '';
      return stack.includes('@vite/client') && /WebSocket/i.test(msg);
    };
    const onWindowError = (event: ErrorEvent) => {
      const msg = event.message || 'Error inesperado de ejecución';
      if (/ResizeObserver loop/i.test(msg) || isViteHmrWsError(msg, event.error)) return;
      console.error('[Ábaco] Error global capturado:', event.error || msg);
      setErrorToast(`Ocurrió un error (${msg}). Tus cambios recientes siguen a salvo.`);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === 'string'
          ? event.reason
          : 'Operación asíncrona interrumpida';
      if (isViteHmrWsError(reason, event.reason)) {
        event.preventDefault();
        return;
      }
      console.error('[Ábaco] Promesa rechazada sin capturar:', event.reason);
      setErrorToast(`Aviso: ${reason}`);
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  // Initial local session recovery
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const lastId = getLastOpenedProjectId();
        let loaded: WhiteboardProject | null = null;
        if (lastId) {
          loaded = await loadProject(lastId);
        }
        if (!loaded) {
          const summaries = await listProjectSummaries();
          if (summaries.length > 0) {
            loaded = await loadProject(summaries[0].id);
          }
        }
        if (!loaded) {
          const starter = createStarterProject();
          await saveProject(starter, true);
          loaded = starter;
        }
        if (active && loaded) {
          const validated = applyProjectValidation(loaded);
          setProject(validated);
          setLastSavedAt(validated.updatedAt);
          setSaveStatus('saved');
        }
      } catch (err) {
        console.error('[Ábaco] Error al cargar sesión inicial:', err);
        if (active) {
          const starter = validateAndNormalizeProject(createStarterProject()).project;
          setProject(starter);
          setErrorToast('Se cargó un tablero de respaldo tras un error al leer el almacenamiento.');
        }
      } finally {
        if (active) setLoadingInit(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyProjectValidation]);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const activeBoard: Board = useMemo(() => {
    return (
      project.boards.find((b) => b.id === project.activeBoardId) || project.boards[0]
    );
  }, [project]);

  const selectedObjects = useMemo(() => {
    return activeBoard.objects.filter((o) => selectedIds.includes(o.id));
  }, [activeBoard.objects, selectedIds]);

  const editingEquation = useMemo(() => {
    if (!editingEquationId) return null;
    return (
      activeBoard.objects.find(
        (o): o is EquationObject => o.id === editingEquationId && o.type === 'equation'
      ) || null
    );
  }, [activeBoard.objects, editingEquationId]);

  useEffect(() => {
    if (activeInlineEquation && editingTextId !== activeInlineEquation.objId) {
      setActiveInlineEquation(null);
    }
  }, [activeInlineEquation, editingTextId]);

  const inlineRibbonEquation = useMemo<EquationObject | null>(() => {
    if (!activeInlineEquation || editingEquation) return null;
    return {
      id: `inline_${activeInlineEquation.objId}`,
      type: 'equation',
      layerId: activeBoard.activeLayerId,
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: 0,
      latex: activeInlineEquation.session.latex,
      fontSize: activeInlineEquation.session.fontSize,
      color: activeInlineEquation.session.color,
      backgroundColor: 'transparent',
    };
  }, [activeInlineEquation, editingEquation, activeBoard.activeLayerId]);

  const activeLayerName = useMemo(() => {
    return (
      activeBoard.layers.find((l) => l.id === activeBoard.activeLayerId)?.name ||
      'Capa Principal'
    );
  }, [activeBoard.layers, activeBoard.activeLayerId]);

  // OPT: 1.2 — Autoguardado con debounce solo cuando dirtyRef=true y fuera de interacciones continuas
  const clearScheduledAutosave = useCallback(() => {
    if (autoSaveDebounceTimerRef.current !== null) {
      window.clearTimeout(autoSaveDebounceTimerRef.current);
      autoSaveDebounceTimerRef.current = null;
    }
  }, []);

  const clearScheduledViewportPersist = useCallback(() => {
    if (viewportPersistTimerRef.current !== null) {
      window.clearTimeout(viewportPersistTimerRef.current);
      viewportPersistTimerRef.current = null;
    }
  }, []);

  const persistViewportIfNeeded = useCallback(async () => {
    saveProjectViewportCacheSync(projectRef.current);
    if (!viewportDirtyRef.current || isCanvasInteractingRef.current) return;
    if (dirtyRef.current && !settingsRef.current.autoSaveEnabled) return;

    const alsoFlushingDirty = dirtyRef.current && settingsRef.current.autoSaveEnabled;
    viewportDirtyRef.current = false;
    if (alsoFlushingDirty) {
      dirtyRef.current = false;
    }

    try {
      const res = await saveProjectDetailed(projectRef.current, false, {
        skipVersionTrim: true,
      });
      if (!res.storageError) {
        setLastSavedAt(res.project.updatedAt);
        if (alsoFlushingDirty) {
          setSaveStatus(dirtyRef.current ? 'unsaved' : 'saved');
        }
      } else {
        viewportDirtyRef.current = true;
        if (alsoFlushingDirty) {
          dirtyRef.current = true;
          setSaveStatus('unsaved');
        }
      }
    } catch {
      viewportDirtyRef.current = true;
      if (alsoFlushingDirty) {
        dirtyRef.current = true;
      }
    }
  }, []);

  const scheduleViewportPersist = useCallback(() => {
    viewportDirtyRef.current = true;
    clearScheduledViewportPersist();
    viewportPersistTimerRef.current = window.setTimeout(() => {
      viewportPersistTimerRef.current = null;
      void persistViewportIfNeeded();
    }, 280);
  }, [clearScheduledViewportPersist, persistViewportIfNeeded]);

  const performAutosaveIfNeeded = useCallback(async () => {
    if (!settingsRef.current.autoSaveEnabled || !dirtyRef.current) return;
    if (isCanvasInteractingRef.current) return;
    setSaveStatus('saving');
    dirtyRef.current = false;
    viewportDirtyRef.current = false;
    clearScheduledViewportPersist();
    try {
      const res = await saveProjectDetailed(projectRef.current, false, {
        skipVersionTrim: true,
      });
      if (res.storageError) {
        setErrorToast(res.storageError);
        dirtyRef.current = true;
        setSaveStatus('unsaved');
      } else {
        setLastSavedAt(res.project.updatedAt);
        setSaveStatus(dirtyRef.current ? 'unsaved' : 'saved');
      }
    } catch {
      dirtyRef.current = true;
      setSaveStatus('unsaved');
    }
  }, [clearScheduledViewportPersist]);

  const flushProjectPersistence = useCallback(async () => {
    saveProjectViewportCacheSync(projectRef.current);
    clearScheduledAutosave();
    clearScheduledViewportPersist();

    if (dirtyRef.current && settingsRef.current.autoSaveEnabled) {
      dirtyRef.current = false;
      viewportDirtyRef.current = false;
      try {
        const res = await saveProjectDetailed(projectRef.current, false, {
          skipVersionTrim: true,
        });
        if (!res.storageError) {
          setLastSavedAt(res.project.updatedAt);
          setSaveStatus(dirtyRef.current ? 'unsaved' : 'saved');
        } else {
          dirtyRef.current = true;
        }
      } catch {
        dirtyRef.current = true;
      }
      return;
    }

    if (viewportDirtyRef.current && (!dirtyRef.current || settingsRef.current.autoSaveEnabled)) {
      viewportDirtyRef.current = false;
      try {
        const res = await saveProjectDetailed(projectRef.current, false, {
          skipVersionTrim: true,
        });
        if (!res.storageError) {
          setLastSavedAt(res.project.updatedAt);
        } else {
          viewportDirtyRef.current = true;
        }
      } catch {
        viewportDirtyRef.current = true;
      }
    }
  }, [clearScheduledAutosave, clearScheduledViewportPersist]);

  const scheduleDebouncedAutosave = useCallback(() => {
    clearScheduledAutosave();
    if (!settingsRef.current.autoSaveEnabled || !dirtyRef.current) return;
    const delayMs = Math.max(
      900,
      Math.min(4000, settingsRef.current.autoSaveIntervalSec * 350)
    );
    autoSaveDebounceTimerRef.current = window.setTimeout(() => {
      autoSaveDebounceTimerRef.current = null;
      void performAutosaveIfNeeded();
    }, delayMs);
  }, [clearScheduledAutosave, performAutosaveIfNeeded]);

  const markProjectDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveStatus('unsaved');
    scheduleDebouncedAutosave();
  }, [scheduleDebouncedAutosave]);

  const handleCanvasInteractionActiveChange = useCallback(
    (active: boolean) => {
      isCanvasInteractingRef.current = active;
      if (!active) {
        if (dirtyRef.current) {
          scheduleDebouncedAutosave();
        } else if (viewportDirtyRef.current) {
          scheduleViewportPersist();
        }
      }
    },
    [scheduleDebouncedAutosave, scheduleViewportPersist]
  );

  // OPT: 2.6 — Canal desacoplado de cursor (~30 Hz) sin provocar re-renders en App
  const handleCanvasCursorMove = useCallback((pt: Point2D) => {
    cursorWorldRef.current = pt;
    if (isOptEnabled('reactMemoThrottle')) {
      publishCursorWorld(pt);
    } else {
      setCursorWorld(pt);
    }
  }, []);

  const mutateActiveBoard = useCallback(
    (
      updater: (board: Board) => Board,
      markDirty = true,
      options?: { persistViewport?: boolean }
    ) => {
      setProject((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        boards: prev.boards.map((b) => (b.id === prev.activeBoardId ? updater(b) : b)),
      }));
      if (markDirty) {
        markProjectDirty();
      } else if (options?.persistViewport) {
        scheduleViewportPersist();
      }
    },
    [markProjectDirty, scheduleViewportPersist]
  );

  const pushHistory = useCallback(
    (
      snapshotObjects: CanvasObject[],
      snapshotGroups?: GroupRecord[],
      snapshotSheets?: BoardSheet[]
    ) => {
      // OPT: 2.7 — Captura estructural segura para evitar JSON.stringify/parse en cada trazo
      const clonedSnap = captureBoardHistorySnapshot(
        snapshotObjects,
        snapshotGroups ?? ensureGroupsArray(activeBoard.groups),
        snapshotSheets ?? activeBoard.sheets
      );
      setUndoStack((prev) => [...prev.slice(-59), clonedSnap]);
      setRedoStack([]);
    },
    [activeBoard.groups, activeBoard.sheets]
  );

  // Auto-oculta los avisos discretos después de unos segundos
  useEffect(() => {
    if (!noticeToast) return;
    const t = setTimeout(() => setNoticeToast(null), 5000);
    return () => clearTimeout(t);
  }, [noticeToast]);

  // Escucha avisos discretos emitidos por controles tipográficos u otros subcomponentes
  useEffect(() => {
    const onAbacoNotice = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) {
        setNoticeToast(detail.message);
      }
    };
    window.addEventListener('abaco:notice', onAbacoNotice);
    return () => {
      window.removeEventListener('abaco:notice', onAbacoNotice);
      if (viewportAnimRafRef.current !== null) {
        window.cancelAnimationFrame(viewportAnimRafRef.current);
        viewportAnimRafRef.current = null;
      }
    };
  }, []);

  // OPT: 1.2 — Al activar autoguardado o cambiar de pestaña/visibilidad, programa o vacía respaldo pendiente
  useEffect(() => {
    if (!settings.autoSaveEnabled) {
      clearScheduledAutosave();
      return;
    }
    if (dirtyRef.current) {
      scheduleDebouncedAutosave();
    }
  }, [settings.autoSaveEnabled, settings.autoSaveIntervalSec, clearScheduledAutosave, scheduleDebouncedAutosave]);

  // Mantiene sincronizada la caché síncrona de zoom/pan ante cualquier cambio del proyecto
  useEffect(() => {
    if (loadingInit) return;
    saveProjectViewportCacheSync(project);
  }, [project, loadingInit]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushProjectPersistence();
      }
    };
    const onPageExit = () => {
      void flushProjectPersistence();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageExit);
    window.addEventListener('beforeunload', onPageExit);
    return () => {
      clearScheduledAutosave();
      clearScheduledViewportPersist();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageExit);
      window.removeEventListener('beforeunload', onPageExit);
    };
  }, [clearScheduledAutosave, clearScheduledViewportPersist, flushProjectPersistence]);

  const handleSaveNow = useCallback(async () => {
    clearScheduledAutosave();
    clearScheduledViewportPersist();
    setSaveStatus('saving');
    dirtyRef.current = false;
    viewportDirtyRef.current = false;
    try {
      const res = await saveProjectDetailed(projectRef.current, true);
      if (res.storageError) {
        setErrorToast(res.storageError);
        setSaveStatus('unsaved');
        return;
      }
      setLastSavedAt(res.project.updatedAt);
      setSaveStatus('saved');
      if (res.snapshotError) {
        setErrorToast(res.snapshotError);
      } else if (res.evictedSnapshots.length > 0) {
        const oldest = res.evictedSnapshots[0];
        const dateLabel =
          oldest.savedAt > 0 ? formatDateTime(oldest.savedAt) : 'fecha desconocida';
        setNoticeToast(`Se eliminó la versión más antigua (${dateLabel})`);
      }
    } catch {
      setSaveStatus('unsaved');
      setErrorToast(
        'No se pudo guardar la nueva versión en el historial. Las versiones anteriores siguen intactas.'
      );
    }
  }, [clearScheduledAutosave, clearScheduledViewportPersist]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    // OPT: 2.7
    const currentSnap = captureBoardHistorySnapshot(
      activeBoard.objects,
      ensureGroupsArray(activeBoard.groups),
      activeBoard.sheets
    );
    setRedoStack((prev) => [...prev, currentSnap]);
    setUndoStack((prev) => prev.slice(0, -1));
    mutateActiveBoard((b) => ({
      ...b,
      objects: previous.objects,
      groups: previous.groups,
      ...(previous.sheets !== undefined ? { sheets: previous.sheets } : {}),
    }));
    if (editingTextId && previous.objects.some((o) => o.id === editingTextId)) {
      setSelectedIds([editingTextId]);
    } else {
      setEditingTextId(null);
      setSelectedIds([]);
    }
    setEditingTableCell((prev) =>
      prev && previous.objects.some((o) => o.id === prev.objectId) ? prev : null
    );
    setEditingDimensionId(null);
  }, [undoStack, activeBoard.objects, activeBoard.groups, activeBoard.sheets, mutateActiveBoard, editingTextId]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    // OPT: 2.7
    const currentSnap = captureBoardHistorySnapshot(
      activeBoard.objects,
      ensureGroupsArray(activeBoard.groups),
      activeBoard.sheets
    );
    setUndoStack((prev) => [...prev, currentSnap]);
    setRedoStack((prev) => prev.slice(0, -1));
    mutateActiveBoard((b) => ({
      ...b,
      objects: next.objects,
      groups: next.groups,
      ...(next.sheets !== undefined ? { sheets: next.sheets } : {}),
    }));
    if (editingTextId && next.objects.some((o) => o.id === editingTextId)) {
      setSelectedIds([editingTextId]);
    } else {
      setEditingTextId(null);
      setSelectedIds([]);
    }
    setEditingTableCell((prev) =>
      prev && next.objects.some((o) => o.id === prev.objectId) ? prev : null
    );
    setEditingDimensionId(null);
  }, [redoStack, activeBoard.objects, activeBoard.groups, activeBoard.sheets, mutateActiveBoard, editingTextId]);

  const handleAddObject = useCallback(
    (obj: CanvasObject) => {
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => ({
        ...b,
        objects: recomputeAssociativeDimensions([...b.objects, obj], cadConfig),
      }));
    },
    [activeBoard.objects, activeBoard.groups, cadConfig, mutateActiveBoard, pushHistory]
  );

  const handleUpdateObjects = useCallback(
    (ids: string[], updater: (obj: CanvasObject) => CanvasObject, recordHistory = true) => {
      if (ids.length === 0) return;
      if (recordHistory) {
        pushHistory(activeBoard.objects, activeBoard.groups);
      }
      const idSet = new Set(ids);
      mutateActiveBoard((b) => ({
        ...b,
        objects: recomputeAssociativeDimensions(
          b.objects.map((o) => (idSet.has(o.id) ? updater(o) : o)),
          cadConfig
        ),
      }));
    },
    [activeBoard.objects, activeBoard.groups, cadConfig, mutateActiveBoard, pushHistory]
  );

  const handleDeleteObjects = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const lockedMap = new Map(activeBoard.layers.map((l) => [l.id, l.locked]));
      const removable = activeBoard.objects.filter(
        (o) => idSet.has(o.id) && !o.locked && !lockedMap.get(o.layerId)
      );
      if (removable.length === 0) return;
      const removeSet = new Set(removable.map((r) => r.id));
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => {
        const remaining = recomputeAssociativeDimensions(
          b.objects.filter((o) => !removeSet.has(o.id)),
          cadConfig
        );
        return {
          ...b,
          objects: remaining,
          groups: pruneEmptyGroups(remaining, ensureGroupsArray(b.groups)),
        };
      });
      setSelectedIds((prev) => prev.filter((id) => !removeSet.has(id)));
      setEditingTextId((prev) => (prev && removeSet.has(prev) ? null : prev));
      setEditingEquationId((prev) => (prev && removeSet.has(prev) ? null : prev));
      setEditingDimensionId((prev) => (prev && removeSet.has(prev) ? null : prev));
      setEditingTableCell((prev) => (prev && removeSet.has(prev.objectId) ? null : prev));
    },
    [activeBoard.layers, activeBoard.objects, activeBoard.groups, cadConfig, mutateActiveBoard, pushHistory]
  );

  // Callback estable para actualizar el resumen de selección sin provocar bucles de renderizado
  const handleRichTextSelectionSummaryChange = useCallback(
    (summary: SelectionStyleSummary | null) => {
      setRichTextSummary((prev) => (prev === null && summary === null ? prev : summary));
    },
    []
  );

  // Repara un cuadro de texto dañado de forma aislada sin perder el resto del tablero
  const handleRepairTextObject = useCallback(
    (id: string) => {
      handleUpdateObjects([id], (o) => repairCorruptedTextObject(o as TextObject), true);
      setEditingTextId((prev) => (prev === id ? null : prev));
      setErrorToast('Cuadro de texto reparado correctamente.');
    },
    [handleUpdateObjects]
  );

  // Repara una tabla dañada normalizando filas/celdas sin afectar el resto del tablero
  const handleRepairTableObject = useCallback(
    (id: string) => {
      handleUpdateObjects([id], (o) => normalizarTabla(o), true);
      setEditingTableCell((prev) => (prev && prev.objectId === id ? null : prev));
      setErrorToast('Tabla reparada correctamente.');
    },
    [handleUpdateObjects]
  );

  const handleApplyCutChanges = useCallback(
    (deleteIds: string[], addObjects: CanvasObject[]) => {
      if (deleteIds.length === 0 && addObjects.length === 0) return;
      const removeSet = new Set(deleteIds);
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => {
        const nextObjs = recomputeAssociativeDimensions(
          [...b.objects.filter((o) => !removeSet.has(o.id)), ...addObjects],
          cadConfig
        );
        return {
          ...b,
          objects: nextObjs,
          groups: pruneEmptyGroups(nextObjs, ensureGroupsArray(b.groups)),
        };
      });
      setSelectedIds(addObjects.map((o) => o.id));
    },
    [activeBoard.objects, activeBoard.groups, cadConfig, mutateActiveBoard, pushHistory]
  );

  // Inicio de pasada completa de borrado parcial: guarda la instantánea previa al arrastre
  const handleStartEraserPass = useCallback(() => {
    // OPT: 2.7
    eraserSnapshotRef.current = captureBoardHistorySnapshot(
      activeBoard.objects,
      ensureGroupsArray(activeBoard.groups)
    );
    eraserModifiedRef.current = false;
  }, [activeBoard.objects, activeBoard.groups]);

  // Paso continuo del borrador parcial entre dos posiciones del mundo sin duplicar historial
  const handleEraserSweep = useCallback(
    (prevWorld: Point2D, currWorld: Point2D, radiusWorld: number) => {
      setProject((prev) => {
        const board = prev.boards.find((b) => b.id === prev.activeBoardId);
        if (!board) return prev;
        const layerMap = new Map(board.layers.map((l) => [l.id, l]));
        const nextZ = board.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
        const res = computeSweptEraserResult(
          prevWorld,
          currWorld,
          radiusWorld,
          board.objects,
          nextZ,
          (obj) => {
            const l = layerMap.get(obj.layerId);
            const visible = l ? l.visible : true;
            const locked = obj.locked || Boolean(l?.locked);
            return visible && !locked;
          }
        );
        if (!res.changed) return prev;
        eraserModifiedRef.current = true;
        const removeSet = new Set(res.deleteIds);
        const nextObjects = [
          ...board.objects.filter((o) => !removeSet.has(o.id)),
          ...res.addObjects,
        ];
        return {
          ...prev,
          updatedAt: Date.now(),
          boards: prev.boards.map((b) =>
            b.id === prev.activeBoardId ? { ...b, objects: nextObjects } : b
          ),
        };
      });
    },
    []
  );

  // Cierre de pasada de borrado: registra un único paso en el historial de deshacer/rehacer
  const handleEndEraserPass = useCallback(() => {
    const snap = eraserSnapshotRef.current;
    const didModify = eraserModifiedRef.current;
    eraserSnapshotRef.current = null;
    eraserModifiedRef.current = false;
    if (!didModify || !snap) return;

    pushHistory(snap.objects, snap.groups);
    mutateActiveBoard((b) => {
      const recomputed = recomputeAssociativeDimensions(b.objects, cadConfig);
      return {
        ...b,
        objects: recomputed,
        groups: pruneEmptyGroups(recomputed, ensureGroupsArray(b.groups)),
      };
    }, true);
    setSelectedIds([]);
  }, [cadConfig, mutateActiveBoard, pushHistory]);

  // CAD Command & Coordinate Engine Callbacks
  const updateCadConfig = useCallback(
    (patch: Partial<CadDraftingConfig>) => {
      setCadConfig((prev) => ({ ...prev, ...patch }));
      if (patch.gridSnap !== undefined) {
        mutateActiveBoard((b) => ({ ...b, snapToGrid: Boolean(patch.gridSnap) }), false);
      }
    },
    [mutateActiveBoard]
  );

  const toggleGridVisible = useCallback(
    (explicit?: boolean) => {
      mutateActiveBoard((b) => {
        const currentlyVisible = b.backgroundPattern !== 'blank';
        const nextVisible = explicit !== undefined ? explicit : !currentlyVisible;
        if (currentlyVisible) {
          savedGridPatternRef.current = b.backgroundPattern;
        }
        return {
          ...b,
          backgroundPattern: nextVisible
            ? savedGridPatternRef.current === 'blank'
              ? 'grid'
              : savedGridPatternRef.current
            : 'blank',
        };
      });
    },
    [mutateActiveBoard]
  );

  const syncInternalClipboardState = useCallback(
    (snap: { objects: CanvasObject[]; groups: GroupRecord[] }) => {
      clipboardRef.current = snap;
      setClipboard(snap);
      const token = `__ABACO_CLIP_V1__:${++clipSeqRef.current}:${Date.now()}`;
      internalClipboardMetaRef.current = {
        token,
        copiedAt: Date.now(),
        osCleared: false,
        preferInternal: true,
        blurredSinceCopy: false,
      };
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(token)
          .then(() => {
            if (internalClipboardMetaRef.current.token === token) {
              internalClipboardMetaRef.current.osCleared = true;
            }
          })
          .catch(() => {
            // Si el entorno bloquea writeText, preferInternal + control de foco/digest resuelve el pegado
          });
      }
    },
    []
  );

  const handleCopy = useCallback(() => {
    if (selectedObjects.length === 0) return;
    // OPT: 2.7
    syncInternalClipboardState(
      captureBoardHistorySnapshot(selectedObjects, ensureGroupsArray(activeBoard.groups))
    );
  }, [selectedObjects, activeBoard.groups, syncInternalClipboardState]);

  const handleCut = useCallback(() => {
    if (selectedObjects.length === 0) return;
    // OPT: 2.7
    syncInternalClipboardState(
      captureBoardHistorySnapshot(selectedObjects, ensureGroupsArray(activeBoard.groups))
    );
    handleDeleteObjects(selectedObjects.map((o) => o.id));
  }, [selectedObjects, activeBoard.groups, handleDeleteObjects, syncInternalClipboardState]);

  const handlePaste = useCallback(
    (customSource?: { objects: CanvasObject[]; groups: GroupRecord[] }) => {
      const src = customSource || clipboardRef.current;
      if (src.objects.length === 0) return;
      pushHistory(activeBoard.objects, activeBoard.groups);
      const maxZ = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0);
      const { clones, newGroups } = cloneObjectsWithGroupTree(
        src.objects,
        src.groups,
        24,
        24,
        activeBoard.activeLayerId,
        maxZ + 1
      );
      const normalizedClones = clones.map((c) =>
        c.type === 'table' ? normalizarTabla(c) : c
      );
      mutateActiveBoard((b) => ({
        ...b,
        objects: recomputeAssociativeDimensions([...b.objects, ...normalizedClones], cadConfig),
        groups: [...ensureGroupsArray(b.groups), ...newGroups],
      }));
      setSelectedIds(normalizedClones.map((c) => c.id));
    },
    [
      activeBoard.activeLayerId,
      activeBoard.objects,
      activeBoard.groups,
      cadConfig,
      mutateActiveBoard,
      pushHistory,
    ]
  );

  const handleDuplicate = useCallback(() => {
    if (selectedObjects.length === 0) return;
    handlePaste({
      objects: selectedObjects,
      groups: ensureGroupsArray(activeBoard.groups),
    });
  }, [selectedObjects, activeBoard.groups, handlePaste]);

  const handleSelectAll = useCallback(() => {
    const visibleLayerSet = new Set(
      activeBoard.layers.filter((l) => l.visible && !l.locked).map((l) => l.id)
    );
    setSelectedIds(
      activeBoard.objects
        .filter((o) => !o.locked && visibleLayerSet.has(o.layerId))
        .map((o) => o.id)
    );
  }, [activeBoard.layers, activeBoard.objects]);

  const handleGroup = useCallback(() => {
    if (selectedIds.length < 2) return;
    const res = createGroupFromSelection(
      selectedIds,
      activeBoard.objects,
      ensureGroupsArray(activeBoard.groups)
    );
    if (!res.createdGroup) return;
    pushHistory(activeBoard.objects, activeBoard.groups);
    mutateActiveBoard((b) => ({
      ...b,
      objects: res.objects,
      groups: res.groups,
    }));
    setCadSession((prev) => ({
      ...prev,
      statusMessage: `Grupo "${res.createdGroup!.name}" creado`,
    }));
  }, [selectedIds, activeBoard.objects, activeBoard.groups, mutateActiveBoard, pushHistory]);

  const handleUngroup = useCallback(() => {
    if (selectedIds.length === 0) return;
    const res = ungroupTopLevelSelection(
      selectedIds,
      activeBoard.objects,
      ensureGroupsArray(activeBoard.groups)
    );
    if (res.ungroupedCount === 0) return;
    pushHistory(activeBoard.objects, activeBoard.groups);
    mutateActiveBoard((b) => ({
      ...b,
      objects: res.objects,
      groups: res.groups,
    }));
    setCadSession((prev) => ({
      ...prev,
      statusMessage: 'Grupo desagrupado',
    }));
  }, [selectedIds, activeBoard.objects, activeBoard.groups, mutateActiveBoard, pushHistory]);

  const handleRenameGroup = useCallback(
    (groupId: string, name: string) => {
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => ({
        ...b,
        groups: renameGroup(groupId, name, ensureGroupsArray(b.groups)),
      }));
    },
    [activeBoard.objects, activeBoard.groups, mutateActiveBoard, pushHistory]
  );

  const handleDissolveGroup = useCallback(
    (groupId: string) => {
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => {
        const res = dissolveSpecificGroup(
          groupId,
          b.objects,
          ensureGroupsArray(b.groups)
        );
        return {
          ...b,
          objects: res.objects,
          groups: res.groups,
        };
      });
    },
    [activeBoard.objects, activeBoard.groups, mutateActiveBoard, pushHistory]
  );

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      const members = getGroupMemberObjects(
        groupId,
        activeBoard.objects,
        ensureGroupsArray(activeBoard.groups)
      );
      setSelectedIds(members.map((m) => m.id));
    },
    [activeBoard.objects, activeBoard.groups]
  );

  const handleAddSelectionToGroup = useCallback(
    (groupId: string) => {
      if (selectedIds.length === 0) return;
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => {
        const res = addObjectsToGroup(
          selectedIds,
          groupId,
          b.objects,
          ensureGroupsArray(b.groups)
        );
        return { ...b, objects: res.objects, groups: res.groups };
      });
    },
    [selectedIds, activeBoard.objects, activeBoard.groups, mutateActiveBoard, pushHistory]
  );

  const handleRemoveFromGroup = useCallback(
    (objectIds: string[]) => {
      if (objectIds.length === 0) return;
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => {
        const res = removeObjectsFromGroup(
          objectIds,
          b.objects,
          ensureGroupsArray(b.groups)
        );
        return { ...b, objects: res.objects, groups: res.groups };
      });
    },
    [activeBoard.objects, activeBoard.groups, mutateActiveBoard, pushHistory]
  );

  const handleJoinSegments = useCallback(() => {
    const tolWorld = cadDistToWorldDist(cadSession.joinToleranceCad, cadConfig) || 8;
    const maxZ = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
    const res = joinCompatibleSegments(
      selectedIds.length >= 2 ? selectedIds : null,
      activeBoard.objects,
      tolWorld,
      activeBoard.activeLayerId,
      maxZ
    );
    if (res.joinedIds.length === 0) {
      setCadSession((prev) => ({
        ...prev,
        statusMessage: 'No se encontraron segmentos contiguos dentro de la tolerancia.',
      }));
      return;
    }
    pushHistory(activeBoard.objects, activeBoard.groups);
    mutateActiveBoard((b) => {
      const nextObjs = recomputeAssociativeDimensions(res.objects, cadConfig);
      return {
        ...b,
        objects: nextObjs,
        groups: pruneEmptyGroups(nextObjs, ensureGroupsArray(b.groups)),
      };
    });
    setSelectedIds(res.joinedIds);
    setCadSession((prev) => ({
      ...prev,
      statusMessage: `${res.consumedCount} segmentos unidos en ${res.joinedIds.length} polilínea(s)`,
    }));
  }, [
    activeBoard.activeLayerId,
    activeBoard.groups,
    activeBoard.objects,
    cadConfig,
    cadSession.joinToleranceCad,
    mutateActiveBoard,
    pushHistory,
    selectedIds,
  ]);

  const syncToolbarToCadCommand = useCallback((cmd: CadCommandId) => {
    setEditingTextId(null);
    setEditingEquationId(null);
    setEditingDimensionId(null);
    setAreaExportMode(false);
    if (cmd === 'line') {
      setActiveTool('line');
    } else if (cmd === 'pline') {
      setToolOptions((p) => ({ ...p, shapeKind: 'polyline' }));
      setActiveTool('shape');
    } else if (
      cmd === 'rectangle' ||
      cmd === 'circle' ||
      cmd === 'arc' ||
      cmd === 'polygon'
    ) {
      setToolOptions((p) => ({ ...p, shapeKind: cmd }));
      setActiveTool('shape');
    } else {
      setActiveTool('select');
    }
  }, []);

  const buildCadCtx = useCallback(
    () => ({
      layerId: activeBoard.activeLayerId,
      zIndex: activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1,
      toolOptions,
    }),
    [activeBoard.activeLayerId, activeBoard.objects, toolOptions]
  );

  const openArrayModalForKind = useCallback(
    (kind: ArrayModalKind) => {
      if (selectedIds.length === 0) {
        setCadSession((prev) => ({
          ...prev,
          statusMessage: 'Selecciona al menos un objeto antes de generar una matriz.',
        }));
        return;
      }
      setPickedPolarCenterWorld(null);
      setPickedPathId(null);
      setPickedPathBasePointWorld(null);
      setLivePathArrayDraft(null);
      setArrayPickMode(null);
      setArrayModal({ open: true, kind });
    },
    [selectedIds.length]
  );

  const applyCadEffect = useCallback(
    (effect: CadCommandEffect) => {
      setCadSession(effect.nextSession);

      if (effect.replaceObjects) {
        pushHistory(activeBoard.objects, activeBoard.groups);
        mutateActiveBoard((b) => ({
          ...b,
          objects: recomputeAssociativeDimensions(effect.replaceObjects!, cadConfig),
          groups: effect.updateGroups ?? ensureGroupsArray(b.groups),
        }));
      } else if (effect.addObjects && effect.addObjects.length > 0) {
        pushHistory(activeBoard.objects, activeBoard.groups);
        mutateActiveBoard((b) => ({
          ...b,
          objects: recomputeAssociativeDimensions(
            [...b.objects, ...effect.addObjects!],
            cadConfig
          ),
          groups: effect.updateGroups ?? ensureGroupsArray(b.groups),
        }));
      } else if (effect.updateGroups) {
        pushHistory(activeBoard.objects, activeBoard.groups);
        mutateActiveBoard((b) => ({
          ...b,
          groups: effect.updateGroups,
        }));
      }

      if (effect.deleteIds && effect.deleteIds.length > 0) {
        handleDeleteObjects(effect.deleteIds);
      }
      if (effect.selectIds) {
        setSelectedIds(effect.selectIds);
      }
      if (effect.startCommand) {
        syncToolbarToCadCommand(effect.startCommand);
      }
      if (effect.switchToSelect) {
        setActiveTool('select');
      }
      if (effect.updateOriginWorld) {
        setCadConfig((prev) => ({
          ...prev,
          originX: effect.updateOriginWorld!.x,
          originY: effect.updateOriginWorld!.y,
        }));
      }
      if (effect.openArrayModal) {
        openArrayModalForKind(effect.openArrayModal);
      }
      if (effect.errorNotice) {
        setErrorToast(effect.errorNotice);
      }
      if (effect.triggerAction === 'group') {
        handleGroup();
      } else if (effect.triggerAction === 'ungroup') {
        handleUngroup();
      } else if (effect.triggerAction === 'join') {
        handleJoinSegments();
      }
      if (effect.toggleAid) {
        const { aid, explicit } = effect.toggleAid;
        if (aid === 'grid') {
          toggleGridVisible(explicit);
        } else if (aid === 'ortho') {
          setCadConfig((prev) => {
            const next = explicit !== undefined ? explicit : !prev.ortho;
            return { ...prev, ortho: next, polar: next ? false : prev.polar };
          });
        } else if (aid === 'polar') {
          setCadConfig((prev) => {
            const next = explicit !== undefined ? explicit : !prev.polar;
            return { ...prev, polar: next, ortho: next ? false : prev.ortho };
          });
        } else if (aid === 'snap') {
          const next = explicit !== undefined ? explicit : !cadConfig.gridSnap;
          updateCadConfig({ gridSnap: next });
        } else if (aid === 'osnap') {
          setCadConfig((prev) => ({
            ...prev,
            osnapEnabled: explicit !== undefined ? explicit : !prev.osnapEnabled,
          }));
        } else if (aid === 'dyn') {
          setCadConfig((prev) => ({
            ...prev,
            dynInput: explicit !== undefined ? explicit : !prev.dynInput,
          }));
        }
      }
    },
    [
      activeBoard.objects,
      activeBoard.groups,
      cadConfig,
      handleDeleteObjects,
      handleGroup,
      handleJoinSegments,
      handleUngroup,
      mutateActiveBoard,
      openArrayModalForKind,
      pushHistory,
      syncToolbarToCadCommand,
      toggleGridVisible,
      updateCadConfig,
    ]
  );

  const handleCadStartCommand = useCallback(
    (cmd: CadCommandId) => {
      setCadInputValue('');
      if (cmd === 'array-rect') {
        openArrayModalForKind('rect');
        return;
      }
      if (cmd === 'array-polar') {
        openArrayModalForKind('polar');
        return;
      }
      if (cmd === 'array-path') {
        if (selectedIds.length === 0) {
          setCadSession((prev) => ({
            ...prev,
            statusMessage: 'Selecciona al menos un objeto antes de generar una matriz.',
          }));
          return;
        }
        syncToolbarToCadCommand(cmd);
        setCadSession(startCadCommandSession(cmd, toolOptions.polygonSides));
        return;
      }
      if (cmd === 'group') {
        handleGroup();
        return;
      }
      if (cmd === 'ungroup') {
        handleUngroup();
        return;
      }
      if (cmd === 'join' && selectedIds.length >= 2) {
        handleJoinSegments();
        return;
      }
      syncToolbarToCadCommand(cmd);
      setCadSession(startCadCommandSession(cmd, toolOptions.polygonSides));
    },
    [
      handleGroup,
      handleJoinSegments,
      handleUngroup,
      openArrayModalForKind,
      selectedIds.length,
      syncToolbarToCadCommand,
      toolOptions.polygonSides,
    ]
  );

  const handleCadQuickStart = useCallback(
    (cmd: CadCommandId, firstPoint: Point2D) => {
      const init = startCadCommandSession(cmd, toolOptions.polygonSides);
      const effect = applyCadPointPick(
        init,
        firstPoint,
        cadConfig,
        buildCadCtx(),
        activeBoard.objects,
        ensureGroupsArray(activeBoard.groups),
        selectedIds
      );
      applyCadEffect(effect);
    },
    [
      activeBoard.objects,
      activeBoard.groups,
      applyCadEffect,
      buildCadCtx,
      cadConfig,
      selectedIds,
      toolOptions.polygonSides,
    ]
  );

  const handleCadPickPoint = useCallback(
    (worldPt: Point2D, pickedObjectId?: string | null) => {
      const effect = applyCadPointPick(
        cadSession,
        worldPt,
        cadConfig,
        buildCadCtx(),
        activeBoard.objects,
        ensureGroupsArray(activeBoard.groups),
        selectedIds,
        pickedObjectId
      );
      setCadInputValue('');
      applyCadEffect(effect);
    },
    [
      activeBoard.objects,
      activeBoard.groups,
      applyCadEffect,
      buildCadCtx,
      cadConfig,
      cadSession,
      selectedIds,
    ]
  );

  const handleCadSubmitCommand = useCallback(
    (raw: string) => {
      const activeGuide =
        lastResolvedCursorRef.current?.tracking?.activeGuides[0] ?? null;
      const effect = executeCadCommandText(
        raw,
        cadSession,
        cursorWorldRef.current,
        cadConfig,
        buildCadCtx(),
        activeBoard.objects,
        ensureGroupsArray(activeBoard.groups),
        selectedIds,
        activeGuide
      );
      setCadInputValue('');
      applyCadEffect(effect);
    },
    [
      activeBoard.objects,
      activeBoard.groups,
      applyCadEffect,
      buildCadCtx,
      cadConfig,
      cadSession,
      selectedIds,
    ]
  );

  const handleCadFinishSession = useCallback(
    (closePolyline: boolean) => {
      const effect = finishOrCloseCadSession(
        cadSession,
        closePolyline,
        buildCadCtx(),
        activeBoard.objects,
        selectedIds,
        cadConfig,
        ensureGroupsArray(activeBoard.groups)
      );
      setCadInputValue('');
      applyCadEffect(effect);
    },
    [
      activeBoard.objects,
      activeBoard.groups,
      applyCadEffect,
      buildCadCtx,
      cadConfig,
      cadSession,
      selectedIds,
    ]
  );

  const handleCadCancelSession = useCallback(() => {
    setCadInputValue('');
    setCadSession(INITIAL_CAD_SESSION);
    setActiveTool('select');
  }, []);

  const handleTrackingError = useCallback((err: unknown) => {
    console.error('[Ábaco] Error en rastreo de referencia (RAS):', err);
    setCadConfig((prev) => {
      if (!prev.trackingEnabled) return prev;
      return { ...prev, trackingEnabled: false };
    });
    setNoticeToast('Rastreo de referencia (RAS) desactivado tras un error inesperado.');
  }, []);

  const handleZOrder = useCallback(
    (action: 'front' | 'back' | 'forward' | 'backward') => {
      if (selectedIds.length === 0) return;
      pushHistory(activeBoard.objects);
      const selSet = new Set(selectedIds);
      const sorted = [...activeBoard.objects].sort((a, b) => a.zIndex - b.zIndex);
      if (action === 'front') {
        const maxZ = sorted[sorted.length - 1]?.zIndex ?? 0;
        let offset = 1;
        mutateActiveBoard((b) => ({
          ...b,
          objects: b.objects.map((o) => (selSet.has(o.id) ? { ...o, zIndex: maxZ + offset++ } : o)),
        }));
      } else if (action === 'back') {
        const minZ = sorted[0]?.zIndex ?? 1;
        let offset = 1;
        mutateActiveBoard((b) => ({
          ...b,
          objects: b.objects.map((o) =>
            selSet.has(o.id) ? { ...o, zIndex: minZ - selectedIds.length + offset++ - 1 } : o
          ),
        }));
      } else if (action === 'forward') {
        handleUpdateObjects(selectedIds, (o) => ({ ...o, zIndex: o.zIndex + 2 }), false);
      } else {
        handleUpdateObjects(selectedIds, (o) => ({ ...o, zIndex: o.zIndex - 2 }), false);
      }
    },
    [selectedIds, activeBoard.objects, mutateActiveBoard, pushHistory, handleUpdateObjects]
  );

  const handleAlign = useCallback(
    (axis: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => {
      if (selectedObjects.length < 2) return;
      const bbox = getObjectsBoundingBox(selectedObjects);
      if (!bbox) return;
      handleUpdateObjects(
        selectedObjects.map((o) => o.id),
        (o) => {
          switch (axis) {
            case 'left':
              return { ...o, x: bbox.x };
            case 'center-h':
              return { ...o, x: bbox.x + bbox.width / 2 - o.width / 2 };
            case 'right':
              return { ...o, x: bbox.x + bbox.width - o.width };
            case 'top':
              return { ...o, y: bbox.y };
            case 'center-v':
              return { ...o, y: bbox.y + bbox.height / 2 - o.height / 2 };
            case 'bottom':
              return { ...o, y: bbox.y + bbox.height - o.height };
          }
        },
        true
      );
    },
    [selectedObjects, handleUpdateObjects]
  );

  const handleDistribute = useCallback(
    (dir: 'horizontal' | 'vertical') => {
      if (selectedObjects.length < 3) return;
      const sorted = [...selectedObjects].sort((a, b) =>
        dir === 'horizontal' ? a.x - b.x : a.y - b.y
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (dir === 'horizontal') {
        const totalWidth = sorted.reduce((acc, o) => acc + o.width, 0);
        const span = last.x + last.width - first.x;
        const gap = (span - totalWidth) / (sorted.length - 1);
        let curX = first.x;
        const nextPositions = new Map<string, number>();
        for (const o of sorted) {
          nextPositions.set(o.id, curX);
          curX += o.width + gap;
        }
        handleUpdateObjects(
          sorted.map((o) => o.id),
          (o) => ({ ...o, x: nextPositions.get(o.id) ?? o.x }),
          true
        );
      } else {
        const totalHeight = sorted.reduce((acc, o) => acc + o.height, 0);
        const span = last.y + last.height - first.y;
        const gap = (span - totalHeight) / (sorted.length - 1);
        let curY = first.y;
        const nextPositions = new Map<string, number>();
        for (const o of sorted) {
          nextPositions.set(o.id, curY);
          curY += o.height + gap;
        }
        handleUpdateObjects(
          sorted.map((o) => o.id),
          (o) => ({ ...o, y: nextPositions.get(o.id) ?? o.y }),
          true
        );
      }
    },
    [selectedObjects, handleUpdateObjects]
  );

  // Viewport helpers
  const zoomBy = useCallback(
    (factor: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const cx = (rect?.width ?? 900) / 2;
      const cy = (rect?.height ?? 600) / 2;
      const oldZoom = activeBoard.viewport.zoom;
      const newZoom = clamp(oldZoom * factor, 0.12, 6);
      const wx = (cx - activeBoard.viewport.panX) / oldZoom;
      const wy = (cy - activeBoard.viewport.panY) / oldZoom;
      mutateActiveBoard(
        (b) => ({
          ...b,
          viewport: { panX: cx - wx * newZoom, panY: cy - wy * newZoom, zoom: newZoom },
        }),
        false,
        { persistViewport: true }
      );
    },
    [activeBoard.viewport, mutateActiveBoard]
  );

  // OPT: 2.6 — Callbacks estables en nivel superior (cumplen Rules of Hooks)
  const handleZoomIn = useCallback(() => zoomBy(1.15), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(1 / 1.15), [zoomBy]);

  const zoomReset = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    mutateActiveBoard(
      (b) => {
        if (isFixedSizeBoard(b) && b.pageWidth && b.pageHeight) {
          const sheets = normalizarHojas(b);
          const targetIdx = Math.max(0, Math.min(sheets.length - 1, activeSheetIndex));
          return {
            ...b,
            viewport: computeCenteredViewportForPage(
              b.pageWidth,
              b.pageHeight,
              rect?.width ?? 1000,
              rect?.height ?? 700,
              getSheetY(targetIdx, b.pageHeight)
            ),
          };
        }
        return { ...b, viewport: { panX: 80, panY: 60, zoom: 1 } };
      },
      false,
      { persistViewport: true }
    );
  }, [activeSheetIndex, mutateActiveBoard]);

  const fitContent = useCallback(() => {
    const objBbox = getObjectsBoundingBox(activeBoard.objects);
    const rect = stageRef.current?.getBoundingClientRect();
    const viewW = rect?.width ?? 1000;
    const viewH = rect?.height ?? 700;
    let bbox = objBbox;
    if (isFixedSizeBoard(activeBoard) && activeBoard.pageWidth && activeBoard.pageHeight) {
      const sheets = normalizarHojas(activeBoard);
      if (sheets.length > 1 || !objBbox) {
        const sheetsBox = {
          x: 0,
          y: 0,
          width: activeBoard.pageWidth,
          height: getTotalSheetsHeight(sheets.length, activeBoard.pageHeight),
        };
        if (!bbox) {
          bbox = sheetsBox;
        } else {
          const minX = Math.min(bbox.x, sheetsBox.x);
          const minY = Math.min(bbox.y, sheetsBox.y);
          const maxX = Math.max(bbox.x + bbox.width, sheetsBox.x + sheetsBox.width);
          const maxY = Math.max(bbox.y + bbox.height, sheetsBox.y + sheetsBox.height);
          bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        }
      }
    }
    if (!bbox) {
      zoomReset();
      return;
    }
    const pad = 60;
    const nextZoom = clamp(
      Math.min((viewW - pad * 2) / bbox.width, (viewH - pad * 2) / bbox.height),
      0.15,
      2.2
    );
    const panX = viewW / 2 - (bbox.x + bbox.width / 2) * nextZoom;
    const panY = viewH / 2 - (bbox.y + bbox.height / 2) * nextZoom;
    mutateActiveBoard(
      (b) => ({ ...b, viewport: { panX, panY, zoom: nextZoom } }),
      false,
      { persistViewport: true }
    );
  }, [activeBoard, mutateActiveBoard, zoomReset]);

  const smoothCenterViewportOnSheet = useCallback(
    (sheetIdx: number, pageW: number, pageH: number) => {
      try {
        if (viewportAnimRafRef.current !== null) {
          window.cancelAnimationFrame(viewportAnimRafRef.current);
          viewportAnimRafRef.current = null;
        }
        const rect = stageRef.current?.getBoundingClientRect();
        const targetVp = computeCenteredViewportForPage(
          pageW,
          pageH,
          rect?.width ?? 1000,
          rect?.height ?? 700,
          getSheetY(sheetIdx, pageH)
        );
        const curBoard =
          projectRef.current.boards.find((b) => b.id === projectRef.current.activeBoardId) ||
          projectRef.current.boards[0];
        const startVp = curBoard?.viewport ?? targetVp;
        const startTime = performance.now();
        const duration = 220;

        const step = (now: number) => {
          try {
            const elapsed = now - startTime;
            const t = Math.min(1, elapsed / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            const nextVp = {
              panX: startVp.panX + (targetVp.panX - startVp.panX) * eased,
              panY: startVp.panY + (targetVp.panY - startVp.panY) * eased,
              zoom: startVp.zoom + (targetVp.zoom - startVp.zoom) * eased,
            };
            mutateActiveBoard((b) => ({ ...b, viewport: nextVp }), false, {
              persistViewport: true,
            });
            if (t < 1) {
              viewportAnimRafRef.current = window.requestAnimationFrame(step);
            } else {
              viewportAnimRafRef.current = null;
            }
          } catch {
            viewportAnimRafRef.current = null;
          }
        };
        viewportAnimRafRef.current = window.requestAnimationFrame(step);
      } catch {
        try {
          const rect = stageRef.current?.getBoundingClientRect();
          const fallbackVp = computeCenteredViewportForPage(
            pageW,
            pageH,
            rect?.width ?? 1000,
            rect?.height ?? 700,
            getSheetY(sheetIdx, pageH)
          );
          mutateActiveBoard((b) => ({ ...b, viewport: fallbackVp }), false, {
            persistViewport: true,
          });
        } catch {
          // ignore
        }
      }
    },
    [mutateActiveBoard]
  );

  const handleAddSheetAfter = useCallback(
    (sheetIndex: number) => {
      try {
        if (!isFixedSizeBoard(activeBoard)) return;
        const sheets = normalizarHojas(activeBoard);
        if (sheets.length >= MAX_SHEETS_PER_BOARD) {
          setNoticeToast(`Máximo ${MAX_SHEETS_PER_BOARD} hojas por pizarrón.`);
          return;
        }
        const safeIdx = Math.max(0, Math.min(sheets.length - 1, sheetIndex));
        const pageW = activeBoard.pageWidth ?? 816;
        const pageH = activeBoard.pageHeight ?? 1056;
        const stride = getSheetStridePx(pageH);

        pushHistory(activeBoard.objects, activeBoard.groups, sheets);
        const newSheet: BoardSheet = { id: uid('sheet') };
        const nextSheets = [
          ...sheets.slice(0, safeIdx + 1),
          newSheet,
          ...sheets.slice(safeIdx + 1),
        ];

        mutateActiveBoard((b) => {
          const shifted = b.objects.map((obj) => {
            const owner = findSheetIndexForObject(obj, sheets.length, pageW, pageH);
            return owner > safeIdx ? translateCanvasObject(obj, 0, stride) : obj;
          });
          return {
            ...b,
            sheets: nextSheets,
            objects: recomputeAssociativeDimensions(shifted, cadConfig),
          };
        });

        setSelectedIds([]);
        setEditingTextId(null);
        setEditingEquationId(null);
        setEditingDimensionId(null);
        setEditingTableCell(null);
        setActiveSheetIndex(safeIdx + 1);
        smoothCenterViewportOnSheet(safeIdx + 1, pageW, pageH);
      } catch (err) {
        console.error('[Ábaco] Error al agregar hoja:', err);
        setErrorToast('No se pudo agregar la nueva hoja.');
      }
    },
    [
      activeBoard,
      cadConfig,
      mutateActiveBoard,
      pushHistory,
      smoothCenterViewportOnSheet,
    ]
  );

  const handleDuplicateSheet = useCallback(
    (sheetIndex: number) => {
      try {
        if (!isFixedSizeBoard(activeBoard)) return;
        const sheets = normalizarHojas(activeBoard);
        if (sheets.length >= MAX_SHEETS_PER_BOARD) {
          setNoticeToast(`Máximo ${MAX_SHEETS_PER_BOARD} hojas por pizarrón.`);
          return;
        }
        const safeIdx = Math.max(0, Math.min(sheets.length - 1, sheetIndex));
        const pageW = activeBoard.pageWidth ?? 816;
        const pageH = activeBoard.pageHeight ?? 1056;
        const stride = getSheetStridePx(pageH);

        pushHistory(activeBoard.objects, activeBoard.groups, sheets);
        const newSheet: BoardSheet = { id: uid('sheet') };
        const nextSheets = [
          ...sheets.slice(0, safeIdx + 1),
          newSheet,
          ...sheets.slice(safeIdx + 1),
        ];

        const curGroups = ensureGroupsArray(activeBoard.groups);
        const ownedSorted = activeBoard.objects
          .filter((obj) => findSheetIndexForObject(obj, sheets.length, pageW, pageH) === safeIdx)
          .sort((a, b) => a.zIndex - b.zIndex);
        const maxZ = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0);
        const { clones, newGroups } = cloneObjectsWithGroupTree(
          ownedSorted,
          curGroups,
          0,
          stride,
          activeBoard.activeLayerId,
          maxZ + 1,
          { preserveLayerAndLock: true, keepGroupNames: true }
        );
        const normalizedClones = clones.map((c) =>
          c.type === 'table' ? normalizarTabla(c) : c
        );

        mutateActiveBoard((b) => {
          const shifted = b.objects.map((obj) => {
            const owner = findSheetIndexForObject(obj, sheets.length, pageW, pageH);
            return owner > safeIdx ? translateCanvasObject(obj, 0, stride) : obj;
          });
          return {
            ...b,
            sheets: nextSheets,
            objects: recomputeAssociativeDimensions(
              [...shifted, ...normalizedClones],
              cadConfig
            ),
            groups: [...ensureGroupsArray(b.groups), ...newGroups],
          };
        });

        setSelectedIds([]);
        setEditingTextId(null);
        setEditingEquationId(null);
        setEditingDimensionId(null);
        setEditingTableCell(null);
        setActiveSheetIndex(safeIdx + 1);
        smoothCenterViewportOnSheet(safeIdx + 1, pageW, pageH);
      } catch (err) {
        console.error('[Ábaco] Error al duplicar hoja:', err);
        setErrorToast('No se pudo duplicar la hoja.');
      }
    },
    [
      activeBoard,
      cadConfig,
      mutateActiveBoard,
      pushHistory,
      smoothCenterViewportOnSheet,
    ]
  );

  const handleRequestDeleteSheet = useCallback(
    (sheetIndex: number) => {
      try {
        if (!isFixedSizeBoard(activeBoard)) return;
        const sheets = normalizarHojas(activeBoard);
        if (sheets.length <= 1) return;
        const safeIdx = Math.max(0, Math.min(sheets.length - 1, sheetIndex));
        const pageW = activeBoard.pageWidth ?? 816;
        const pageH = activeBoard.pageHeight ?? 1056;
        const ownedCount = activeBoard.objects.filter(
          (obj) => findSheetIndexForObject(obj, sheets.length, pageW, pageH) === safeIdx
        ).length;
        setDeleteSheetConfirm({
          sheetIndex: safeIdx,
          sheetNumber: safeIdx + 1,
          ownedCount,
        });
      } catch (err) {
        console.error('[Ábaco] Error al preparar eliminación de hoja:', err);
      }
    },
    [activeBoard]
  );

  const confirmDeleteSheet = useCallback(() => {
    if (!deleteSheetConfirm) return;
    try {
      if (!isFixedSizeBoard(activeBoard)) {
        setDeleteSheetConfirm(null);
        return;
      }
      const sheets = normalizarHojas(activeBoard);
      const targetIdx = deleteSheetConfirm.sheetIndex;
      if (sheets.length <= 1 || targetIdx < 0 || targetIdx >= sheets.length) {
        setDeleteSheetConfirm(null);
        return;
      }
      const pageW = activeBoard.pageWidth ?? 816;
      const pageH = activeBoard.pageHeight ?? 1056;
      const stride = getSheetStridePx(pageH);

      pushHistory(activeBoard.objects, activeBoard.groups, sheets);
      const nextSheets = sheets.filter((_, idx) => idx !== targetIdx);
      const removedIds = new Set<string>();

      mutateActiveBoard((b) => {
        const remaining: CanvasObject[] = [];
        for (const obj of b.objects) {
          const owner = findSheetIndexForObject(obj, sheets.length, pageW, pageH);
          if (owner === targetIdx) {
            removedIds.add(obj.id);
          } else if (owner > targetIdx) {
            remaining.push(translateCanvasObject(obj, 0, -stride));
          } else {
            // Incluye elementos de hojas anteriores (owner < targetIdx) y elementos fuera de todas las hojas (owner === -1)
            remaining.push(obj);
          }
        }
        const recomputed = recomputeAssociativeDimensions(remaining, cadConfig);
        return {
          ...b,
          sheets: nextSheets,
          objects: recomputed,
          groups: pruneEmptyGroups(recomputed, ensureGroupsArray(b.groups)),
        };
      });

      setSelectedIds((prev) => prev.filter((id) => !removedIds.has(id)));
      setEditingTextId((prev) => (prev && removedIds.has(prev) ? null : prev));
      setEditingEquationId((prev) => (prev && removedIds.has(prev) ? null : prev));
      setEditingDimensionId((prev) => (prev && removedIds.has(prev) ? null : prev));
      setEditingTableCell((prev) => (prev && removedIds.has(prev.objectId) ? null : prev));

      const focusIdx = Math.max(0, targetIdx - 1);
      setActiveSheetIndex(focusIdx);
      setDeleteSheetConfirm(null);
      smoothCenterViewportOnSheet(focusIdx, pageW, pageH);
    } catch (err) {
      console.error('[Ábaco] Error al eliminar hoja:', err);
      setDeleteSheetConfirm(null);
      setErrorToast('No se pudo eliminar la hoja.');
    }
  }, [
    activeBoard,
    cadConfig,
    deleteSheetConfirm,
    mutateActiveBoard,
    pushHistory,
    smoothCenterViewportOnSheet,
  ]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const getViewportCenterWorld = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    const cx = (rect?.width ?? 900) / 2;
    const cy = (rect?.height ?? 600) / 2;
    return {
      x: (cx - activeBoard.viewport.panX) / activeBoard.viewport.zoom,
      y: (cy - activeBoard.viewport.panY) / activeBoard.viewport.zoom,
    };
  }, [activeBoard.viewport]);

  const startLiveEquation = useCallback(() => {
    const c = getViewportCenterWorld();
    const newEq: EquationObject = {
      id: uid('eq'),
      type: 'equation',
      layerId: activeBoard.activeLayerId,
      x: c.x - 110,
      y: c.y - 38,
      width: 220,
      height: 76,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1,
      latex: '\\square',
      fontSize: 24,
      color: toolOptions.textColor || '#0f172a',
      backgroundColor: 'transparent',
    };
    handleAddObject(newEq);
    setSelectedIds([newEq.id]);
    setEditingTextId(null);
    setAreaExportMode(false);
    setEquationCursor({ path: [], offset: 0 });
    setEditingEquationId(newEq.id);
    setActiveTool('select');
  }, [
    activeBoard.activeLayerId,
    activeBoard.objects,
    getViewportCenterWorld,
    handleAddObject,
    toolOptions.textColor,
  ]);

  const handleInsertTextObject = useCallback(() => {
    const c = getViewportCenterWorld();
    const obj: TextObject = {
      id: uid('txt'),
      type: 'text',
      layerId: activeBoard.activeLayerId,
      x: c.x - 120,
      y: c.y - 32,
      width: 240,
      height: 64,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1,
      content: 'Cuadro de texto',
      fontFamily: 'sans',
      fontSize: toolOptions.textFontSize,
      bold: false,
      italic: false,
      underline: false,
      align: 'left',
      color: toolOptions.textColor,
      backgroundColor: 'transparent',
      listStyle: 'none',
      widthMode: 'fixed',
      autoWidth: false,
      lang: getRememberedTextLang(settings.spellcheckDefaultLang),
      paragraphs: createParagraphsFromPlainText(
        'Cuadro de texto',
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
    handleAddObject(obj);
    setSelectedIds([obj.id]);
    setEditingTextId(obj.id);
    setActiveTool('select');
  }, [
    activeBoard.activeLayerId,
    activeBoard.objects,
    getViewportCenterWorld,
    handleAddObject,
    settings.spellcheckDefaultLang,
    toolOptions.textColor,
    toolOptions.textFontSize,
  ]);

  const handleInsertStickyObject = useCallback(() => {
    const c = getViewportCenterWorld();
    const obj = {
      id: uid('stk'),
      type: 'sticky' as const,
      layerId: activeBoard.activeLayerId,
      x: c.x - 105,
      y: c.y - 78,
      width: 210,
      height: 155,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1,
      content: 'Nota rápida...',
      backgroundColor: toolOptions.stickyColor,
      textColor: '#1e293b',
      fontSize: 14,
    };
    handleAddObject(obj);
    setSelectedIds([obj.id]);
    setEditingTextId(obj.id);
    setActiveTool('select');
  }, [
    activeBoard.activeLayerId,
    activeBoard.objects,
    getViewportCenterWorld,
    handleAddObject,
    toolOptions.stickyColor,
  ]);

  // Inserta una nueva tabla editable (en el centro de la vista o en una posición clicada del lienzo)
  const handleInsertTable = useCallback(
    (rows: number, cols: number, mode: 'center' | 'click' = 'center', worldPos?: Point2D) => {
      const safeR = Math.max(1, Math.min(30, Math.round(rows || 3)));
      const safeC = Math.max(1, Math.min(15, Math.round(cols || 3)));
      if (mode === 'click' && !worldPos) {
        setPendingTableSize({ rows: safeR, cols: safeC });
        setCadSession(INITIAL_CAD_SESSION);
        setCadInputValue('');
        setActiveTool('select');
        return;
      }
      const center = worldPos ?? getViewportCenterWorld();
      const maxZ = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
      const tbl = createTableObject({
        rows: safeR,
        cols: safeC,
        layerId: activeBoard.activeLayerId,
        x: center.x,
        y: center.y,
        zIndex: maxZ,
        fontSize: toolOptions.textFontSize,
        color: toolOptions.textColor,
        lang: getRememberedTextLang(settings.spellcheckDefaultLang),
      });
      // Si se inserta en el centro de pantalla, centra horizontal y verticalmente respecto a getViewportCenterWorld()
      const finalTbl = worldPos
        ? tbl
        : {
            ...tbl,
            x: Math.round(center.x - tbl.width / 2),
            y: Math.round(center.y - tbl.height / 2),
          };
      handleAddObject(finalTbl);
      setPendingTableSize(null);
      setSelectedIds([finalTbl.id]);
      setEditingTextId(null);
      setEditingEquationId(null);
      setEditingDimensionId(null);
      setEditingTableCell({ objectId: finalTbl.id, r: 0, c: 0 });
      setActiveTool('select');
    },
    [
      activeBoard.activeLayerId,
      activeBoard.objects,
      getViewportCenterWorld,
      handleAddObject,
      settings.spellcheckDefaultLang,
      toolOptions.textColor,
      toolOptions.textFontSize,
    ]
  );

  const handleCreatePolylineFromSelection = useCallback(() => {
    if (selectedIds.length < 2) return;
    const tolWorld = cadDistToWorldDist(cadSession.joinToleranceCad, cadConfig) || 8;
    const maxZ = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;
    const res = createPolylineFromSelectedSegments(
      selectedIds,
      activeBoard.objects,
      tolWorld,
      activeBoard.activeLayerId,
      maxZ
    );
    if (!res.polylineId) {
      setCadSession((prev) => ({
        ...prev,
        statusMessage: 'Selecciona al menos dos líneas o polilíneas abiertas.',
      }));
      return;
    }
    pushHistory(activeBoard.objects, activeBoard.groups);
    mutateActiveBoard((b) => {
      const nextObjs = recomputeAssociativeDimensions(res.objects, cadConfig);
      return {
        ...b,
        objects: nextObjs,
        groups: pruneEmptyGroups(nextObjs, ensureGroupsArray(b.groups)),
      };
    });
    setSelectedIds([res.polylineId]);
    setCadSession((prev) => ({
      ...prev,
      statusMessage: `Polilínea creada a partir de ${res.consumedCount} segmento(s)`,
    }));
  }, [
    activeBoard.activeLayerId,
    activeBoard.groups,
    activeBoard.objects,
    cadConfig,
    cadSession.joinToleranceCad,
    mutateActiveBoard,
    pushHistory,
    selectedIds,
  ]);

  const handleAlignEndpoints = useCallback(
    (mode: EndpointAlignMode) => {
      if (selectedIds.length < 2) return;
      const res = alignSelectedGeometricEndpoints(selectedIds, activeBoard.objects, mode);
      if (res.alignedCount === 0) return;
      pushHistory(activeBoard.objects, activeBoard.groups);
      mutateActiveBoard((b) => ({
        ...b,
        objects: recomputeAssociativeDimensions(res.objects, cadConfig),
      }));
      setCadSession((prev) => ({
        ...prev,
        statusMessage: `Extremos alineados (${res.alignedCount} elemento(s))`,
      }));
    },
    [
      activeBoard.groups,
      activeBoard.objects,
      cadConfig,
      mutateActiveBoard,
      pushHistory,
      selectedIds,
    ]
  );

  const handleExecuteQuickCatalogItem = useCallback(
    (item: CadCatalogItem) => {
      setQuickCmdOpen(false);
      const exec = item.execution;
      if (exec.kind === 'cad') {
        handleCadSubmitCommand(exec.commandText);
        return;
      }
      if (exec.kind === 'shape-tool') {
        setCadSession(INITIAL_CAD_SESSION);
        setCadInputValue('');
        setToolOptions((p) => ({ ...p, shapeKind: exec.shapeKind }));
        setActiveTool('shape');
        return;
      }
      setCadSession(INITIAL_CAD_SESSION);
      setCadInputValue('');
      switch (exec.actionId) {
        case 'select':
          setActiveTool('select');
          break;
        case 'hand':
          setActiveTool('hand');
          break;
        case 'pen':
          setActiveTool('pen');
          break;
        case 'eraser':
          setActiveTool('eraser');
          break;
        case 'cut':
          setActiveTool('cut');
          break;
        case 'text':
          handleInsertTextObject();
          break;
        case 'sticky':
          handleInsertStickyObject();
          break;
        case 'equation':
          startLiveEquation();
          break;
        case 'graph':
          setGraphModal({ open: true, editing: null });
          break;
        case 'import-file':
          fileImportInputRef.current?.click();
          break;
        case 'export':
          setShowExportModal(true);
          break;
        case 'settings':
          setShowSettingsModal(true);
          break;
      }
    },
    [
      handleCadSubmitCommand,
      handleInsertStickyObject,
      handleInsertTextObject,
      startLiveEquation,
    ]
  );

  const insertEquationSnippet = useCallback(
    (snippet: string) => {
      if (!editingEquation) return;
      const next = applySnippetAtCursor(editingEquation.latex, equationCursor, snippet);
      handleUpdateObjects(
        [editingEquation.id],
        (o) => ({ ...(o as EquationObject), latex: next.latex }),
        false
      );
      setEquationCursor(next.cursor);
      requestAnimationFrame(() => {
        equationInputRef.current?.focus();
      });
    },
    [editingEquation, equationCursor, handleUpdateObjects]
  );

  const jumpNextEquationPlaceholder = useCallback(() => {
    if (!editingEquation) return;
    setEquationCursor(jumpToNextSlotCursor(editingEquation.latex, equationCursor, false));
    requestAnimationFrame(() => {
      equationInputRef.current?.focus();
    });
  }, [editingEquation, equationCursor]);

  // Import external files (via drop, button, or clipboard image paste)
  const processIncomingFiles = useCallback(
    async (files: FileList | File[], worldX?: number, worldY?: number) => {
      // OPT: 1.1 — Carga diferida del importador de archivos solo al importar
      const { importExternalFile } = await import('./utils/documentImporter');
      const center =
        worldX !== undefined && worldY !== undefined
          ? { x: worldX, y: worldY }
          : getViewportCenterWorld();
      let z = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1;

      const list = Array.from(files);
      for (let i = 0; i < list.length; i++) {
        try {
          const obj = await importExternalFile(
            list[i],
            center.x + i * 32,
            center.y + i * 32,
            activeBoard.activeLayerId,
            z++
          );
          handleAddObject(obj);
          setSelectedIds([obj.id]);
        } catch (err) {
          setErrorToast(
            `No se pudo importar "${list[i].name}": ${err instanceof Error ? err.message : 'formato no compatible'}`
          );
        }
      }
    },
    [activeBoard.activeLayerId, activeBoard.objects, getViewportCenterWorld, handleAddObject]
  );

  // Sincronización de eventos externos del portapapeles (capturas PNG internas o cambio de ventana)
  useEffect(() => {
    const onWindowBlur = () => {
      internalClipboardMetaRef.current.blurredSinceCopy = true;
    };
    const onSystemClipboardUpdated = () => {
      internalClipboardMetaRef.current.preferInternal = false;
      internalClipboardMetaRef.current.osCleared = false;
    };
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('abaco:system-clipboard-updated', onSystemClipboardUpdated);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('abaco:system-clipboard-updated', onSystemClipboardUpdated);
    };
  }, []);

  // Paste images/screenshots or internal whiteboard elements prioritizing the most recent copy source
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        editingTableCell ||
        (target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
      ) {
        return;
      }

      const meta = internalClipboardMetaRef.current;
      const internalClip = clipboardRef.current;
      const plainText = (e.clipboardData?.getData('text/plain') || '').trim();

      if (plainText && meta.token && plainText === meta.token && internalClip.objects.length > 0) {
        e.preventDefault();
        handlePaste(internalClip);
        return;
      }

      const items = e.clipboardData?.items;
      const imageFiles: File[] = [];
      if (items) {
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        // IMPORTANTE: Leer sincrónicamente preventDefault antes de esperar promesas si existe posibilidad de pegado
        e.preventDefault();
        const digest = await computeImageBlobDigest(imageFiles[0]);
        const seenBeforeCopy =
          lastSeenImageDigestRef.current !== null &&
          lastSeenImageDigestRef.current.digest === digest &&
          lastSeenImageDigestRef.current.seenAt < meta.copiedAt;
        const shouldPreferInternalOverStaleScreenshot =
          internalClip.objects.length > 0 &&
          meta.preferInternal &&
          ((!meta.osCleared && !meta.blurredSinceCopy) || seenBeforeCopy);

        if (shouldPreferInternalOverStaleScreenshot) {
          handlePaste(internalClip);
          return;
        }

        lastSeenImageDigestRef.current = { digest, seenAt: Date.now() };
        internalClipboardMetaRef.current.preferInternal = false;
        internalClipboardMetaRef.current.osCleared = false;
        await processIncomingFiles(imageFiles);
        return;
      }

      if (internalClip.objects.length > 0 && (meta.preferInternal || !plainText)) {
        e.preventDefault();
        handlePaste(internalClip);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [editingTableCell, handlePaste, processIncomingFiles]);

  // Cierra la edición de celda si la tabla deja de estar seleccionada
  useEffect(() => {
    if (editingTableCell && !selectedIds.includes(editingTableCell.objectId)) {
      setEditingTableCell(null);
    }
  }, [editingTableCell, selectedIds]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        setCleanWorkMode((v) => !v);
        return;
      }

      if (e.key === 'Escape' && deleteSheetConfirm) {
        e.preventDefault();
        setDeleteSheetConfirm(null);
        return;
      }

      if (e.key === 'Escape' && arrayPickMode) {
        e.preventDefault();
        setArrayPickMode(null);
        return;
      }

      // Function-key drafting toggles work globally even when CAD command bar is focused
      if (e.key === 'F3') {
        e.preventDefault();
        setCadConfig((prev) => ({ ...prev, osnapEnabled: !prev.osnapEnabled }));
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        toggleGridVisible();
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setCadConfig((prev) => ({
          ...prev,
          ortho: !prev.ortho,
          polar: !prev.ortho ? false : prev.polar,
        }));
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        updateCadConfig({ gridSnap: !cadConfig.gridSnap });
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        setCadConfig((prev) => ({
          ...prev,
          polar: !prev.polar,
          ortho: !prev.polar ? false : prev.ortho,
        }));
        return;
      }
      if (
        FEATURE_TRACKING_ENABLED &&
        e.key === 'F11' &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        setCadConfig((prev) => ({ ...prev, trackingEnabled: !prev.trackingEnabled }));
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        setCadConfig((prev) => ({ ...prev, dynInput: !prev.dynInput }));
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      if (quickCmdOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setQuickCmdOpen(false);
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      const anyBlockingModal =
        showSettingsModal ||
        showExportModal ||
        showProjectManager ||
        newBoardModal.open ||
        equationModal.open ||
        Boolean(inlineTextEquationModal) ||
        graphModal.open ||
        arrayModal.open ||
        Boolean(deleteSheetConfirm) ||
        Boolean(editingTextId || editingEquationId || editingDimensionId || editingTableCell);
      const typingCoordinate =
        (cadSession.activeCommand || cadSession.pickingOrigin) &&
        cadInputValue.trim().length > 0 &&
        /^[0-9@+-]/.test(cadInputValue.trim());

      // Direct `;` Quick Command Launcher from drawing area (protected from modals/inputs/coordinate typing)
      if (!ctrl && !e.altKey && e.key === ';' && !anyBlockingModal && !typingCoordinate) {
        e.preventDefault();
        setQuickCmdAnchor(lastPointerStageRef.current);
        setQuickCmdOpen(true);
        return;
      }

      // Forward direct CAD numeric/coordinate/option typing to command bar when CAD tool is active
      if ((cadSession.activeCommand || cadSession.pickingOrigin) && !ctrl && !e.altKey) {
        if (e.key === 'Backspace') {
          e.preventDefault();
          setCadInputValue((v) => v.slice(0, -1));
          cadInputRef.current?.focus();
          return;
        }
        if (e.key.length === 1 && /^[0-9a-zA-Z@<.,;+\-*]$/.test(e.key)) {
          e.preventDefault();
          setCadInputValue((v) => v + e.key);
          cadInputRef.current?.focus();
          return;
        }
      }

      if (!ctrl && !e.altKey && (e.key === '/' || e.key === ':')) {
        e.preventDefault();
        cadInputRef.current?.focus();
        return;
      }

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveNow();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCut();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) handleUngroup();
        else handleGroup();
        return;
      }
      // Atajos de formato de texto cuando hay cuadros de texto seleccionados como objeto (fuera de edición)
      if (
        ctrl &&
        !anyBlockingModal &&
        (e.key.toLowerCase() === 'b' ||
          e.key.toLowerCase() === 'i' ||
          e.key.toLowerCase() === 'u' ||
          e.key.toLowerCase() === 'j')
      ) {
        const editableTexts = selectedObjects.filter(
          (o): o is TextObject => o.type === 'text' && !o.locked
        );
        if (editableTexts.length > 0) {
          e.preventDefault();
          const keyL = e.key.toLowerCase();
          if (keyL === 'j') {
            handleUpdateObjects(
              editableTexts.map((t) => t.id),
              (o) => {
                const t = o as TextObject;
                return syncTextObjectFromParagraphs(
                  t,
                  applyAlignToAllParagraphs(
                    ensureTextParagraphs(t),
                    'justify',
                    getDefaultRunStyle(t)
                  )
                );
              },
              true
            );
          } else {
            const prop =
              keyL === 'b' ? 'bold' : keyL === 'i' ? 'italic' : 'underline';
            const allActive = editableTexts.every((t) =>
              ensureTextParagraphs(t).every((p) =>
                p.runs.every((r) => Boolean(r[prop] ?? t[prop]))
              )
            );
            handleUpdateObjects(
              editableTexts.map((t) => t.id),
              (o) => {
                const t = o as TextObject;
                return syncTextObjectFromParagraphs(
                  t,
                  applyStyleToAllParagraphs(
                    ensureTextParagraphs(t),
                    { [prop]: !allActive },
                    getDefaultRunStyle(t)
                  )
                );
              },
              true
            );
          }
          return;
        }
      }
      if (ctrl && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomBy(1.15);
        return;
      }
      if (ctrl && e.key === '-') {
        e.preventDefault();
        zoomBy(1 / 1.15);
        return;
      }
      if (ctrl && e.key === '0') {
        e.preventDefault();
        zoomReset();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteObjects(selectedIds);
        }
        return;
      }

      if (!ctrl && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('select');
            break;
          case 'h':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('hand');
            break;
          case 'p':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('pen');
            break;
          case 'e':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('eraser');
            break;
          case 't':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('text');
            break;
          case 's':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('shape');
            break;
          case 'l':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('line');
            break;
          case 'c':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('cut');
            break;
          case 'n':
            setCadSession(INITIAL_CAD_SESSION);
            setActiveTool('sticky');
            break;
          case 'm':
            setCadSession(INITIAL_CAD_SESSION);
            startLiveEquation();
            break;
          case 'g':
            setCadSession(INITIAL_CAD_SESSION);
            setGraphModal({ open: true, editing: null });
            break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    arrayPickMode,
    cadConfig.gridSnap,
    cadSession.activeCommand,
    cadSession.pickingOrigin,
    toggleGridVisible,
    updateCadConfig,
    handleUndo,
    handleRedo,
    handleSaveNow,
    handleCopy,
    handleCut,
    handleDuplicate,
    handleSelectAll,
    handleGroup,
    handleUngroup,
    zoomBy,
    zoomReset,
    selectedIds,
    selectedObjects,
    handleUpdateObjects,
    handleDeleteObjects,
    startLiveEquation,
    quickCmdOpen,
    showSettingsModal,
    showExportModal,
    showProjectManager,
    newBoardModal.open,
    equationModal.open,
    inlineTextEquationModal,
    graphModal.open,
    arrayModal.open,
    editingTextId,
    editingEquationId,
    editingDimensionId,
    editingTableCell,
    deleteSheetConfirm,
    cadInputValue,
  ]);

  const handleOpenPizarraFile = async () => {
    const win = window as unknown as {
      electronDesktop?: {
        isDesktop: boolean;
        openPizarraFile: () => Promise<{ canceled: boolean; content?: string }>;
      };
    };
    if (win.electronDesktop?.isDesktop) {
      const res = await win.electronDesktop.openPizarraFile();
      if (!res.canceled && res.content) {
        try {
          const parsed = JSON.parse(res.content) as WhiteboardProject;
          if (parsed && Array.isArray(parsed.boards)) {
            await flushProjectPersistence();
            const loaded = applyProjectValidation({
              ...parsed,
              id: uid('proj'),
              updatedAt: Date.now(),
            });
            await saveProject(loaded, true);
            setProject(loaded);
            setUndoStack([]);
            setRedoStack([]);
            setSelectedIds([]);
            setActiveSheetIndex(0);
            dirtyRef.current = false;
            viewportDirtyRef.current = false;
            clearScheduledAutosave();
            clearScheduledViewportPersist();
            setSaveStatus('saved');
            setLastSavedAt(loaded.updatedAt);
          }
        } catch {
          setErrorToast('El archivo seleccionado no es un proyecto .pizarra válido.');
        }
      }
      return;
    }
    void flushProjectPersistence();
    pizarraOpenInputRef.current?.click();
  };

  const selectionCenterWorld = useMemo(() => {
    const bbox = getObjectsBoundingBox(selectedObjects);
    if (!bbox) return getViewportCenterWorld();
    return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  }, [selectedObjects, getViewportCenterWorld]);

  const candidateArrayPaths = useMemo(
    () => activeBoard.objects.filter((o) => extractWorldPathPoints(o) !== null),
    [activeBoard.objects]
  );

  const contextActions: CanvasContextActions = useMemo(
    () => ({
      onCopy: handleCopy,
      onDuplicate: handleDuplicate,
      onCut: handleCut,
      onDelete: () => handleDeleteObjects(selectedIds),
      onRotateBy: (deltaDeg: number) => {
        if (selectedIds.length === 0) return;
        const targets = selectedObjects.filter((o) => !o.locked && o.type !== 'dimension');
        if (targets.length === 0) return;
        if (targets.length === 1) {
          handleUpdateObjects(
            [targets[0].id],
            (o) => ({ ...o, rotation: ((o.rotation || 0) + deltaDeg) % 360 }),
            true
          );
          return;
        }
        const box = getObjectsWorldBoundingBox(targets);
        if (!box) return;
        const pivot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        handleUpdateObjects(
          targets.map((t) => t.id),
          (o) => rotateCanvasObjectAroundPivot(o, pivot, deltaDeg, cadConfig),
          true
        );
      },
      onToggleLockSelection: (lock: boolean) => {
        if (selectedIds.length === 0) return;
        handleUpdateObjects(selectedIds, (o) => ({ ...o, locked: lock }), true);
      },
      onSetCommonColor: (color: string) => {
        if (selectedIds.length === 0) return;
        handleUpdateObjects(
          selectedIds,
          (o) => {
            if (o.locked) return o;
            if (o.type === 'text') {
              return syncTextObjectFromParagraphs(
                o,
                applyStyleToAllParagraphs(
                  ensureTextParagraphs(o),
                  { color },
                  getDefaultRunStyle(o)
                )
              );
            }
            if (o.type === 'stroke' || o.type === 'equation' || o.type === 'dimension') {
              return { ...o, color };
            }
            if (o.type === 'shape' || o.type === 'line') {
              return { ...o, strokeColor: color };
            }
            if (o.type === 'sticky') {
              return { ...o, textColor: color };
            }
            return o;
          },
          true
        );
      },
      onSetCommonStrokeWidth: (width: number) => {
        if (selectedIds.length === 0) return;
        handleUpdateObjects(
          selectedIds,
          (o) => {
            if (o.locked) return o;
            if (o.type === 'stroke' || o.type === 'shape' || o.type === 'line') {
              return { ...o, strokeWidth: width };
            }
            return o;
          },
          true
        );
      },
      onGroup: handleGroup,
      onUngroup: handleUngroup,
      onAlign: handleAlign,
      onDistribute: handleDistribute,
      onJoinSegments: handleJoinSegments,
      onCreatePolylineFromSelection: handleCreatePolylineFromSelection,
      onAlignEndpoints: handleAlignEndpoints,
      onStartCadCommand: handleCadStartCommand,
      onSelectShapeAndDraw: (shapeKind) => {
        setCadSession(INITIAL_CAD_SESSION);
        setCadInputValue('');
        setToolOptions((p) => ({ ...p, shapeKind }));
        setActiveTool('shape');
      },
      onInsertText: handleInsertTextObject,
      onInsertSticky: handleInsertStickyObject,
      onInsertEquation: startLiveEquation,
      onInsertGraph: () => setGraphModal({ open: true, editing: null }),
      onInsertTable: (rows, cols) => handleInsertTable(rows, cols, 'center'),
      onImportExternalFile: () => fileImportInputRef.current?.click(),
      onToggleGridVisible: () => toggleGridVisible(),
      onToggleSnapToGrid: () => updateCadConfig({ gridSnap: !activeBoard.snapToGrid }),
      onToggleOsnap: () =>
        setCadConfig((prev) => ({ ...prev, osnapEnabled: !prev.osnapEnabled })),
      onToggleCoordinates: () =>
        mutateActiveBoard((b) => ({ ...b, showCoordinates: !b.showCoordinates })),
      onToggleOrtho: () =>
        setCadConfig((prev) => ({
          ...prev,
          ortho: !prev.ortho,
          polar: !prev.ortho ? false : prev.polar,
        })),
      onTogglePolar: () =>
        setCadConfig((prev) => ({
          ...prev,
          polar: !prev.polar,
          ortho: !prev.polar ? false : prev.ortho,
        })),
      onOpenSettings: () => setShowSettingsModal(true),
      onOpenInspectorTab: (tab) => {
        setCleanWorkMode(false);
        setRightCollapsed(false);
        setInspectorTab(tab);
      },
      onToggleLeftPanel: () => setLeftCollapsed((v) => !v),
      onToggleRightPanel: () => setRightCollapsed((v) => !v),
      onToggleBottomBars: () => setBottomBarsCollapsed((v) => !v),
      onToggleAutoTransparentPanels: () => setAutoTransparentPanels((v) => !v),
      onToggleCleanWorkMode: () => setCleanWorkMode((v) => !v),
    }),
    [
      activeBoard.snapToGrid,
      cadConfig,
      handleAlign,
      handleAlignEndpoints,
      handleCadStartCommand,
      handleCopy,
      handleCreatePolylineFromSelection,
      handleCut,
      handleDeleteObjects,
      handleDistribute,
      handleDuplicate,
      handleGroup,
      handleInsertStickyObject,
      handleInsertTable,
      handleInsertTextObject,
      handleJoinSegments,
      handleUngroup,
      handleUpdateObjects,
      mutateActiveBoard,
      selectedIds,
      selectedObjects,
      startLiveEquation,
      toggleGridVisible,
      updateCadConfig,
    ]
  );

  const shouldFadePanels =
    !cleanWorkMode && autoTransparentPanels && pointerOverCanvas && !panelHovered;
  const panelFadeCls = shouldFadePanels
    ? 'opacity-25 transition-opacity duration-200'
    : 'opacity-100 transition-opacity duration-200';

  if (loadingInit) {
    return (
      <div className="h-screen w-screen flex items-center justify-center theme-bg text-sm">
        Cargando espacio de trabajo local...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden theme-bg relative">
      {/* Top Menu & Action Bar */}
      {!cleanWorkMode && (
        <TopBar
          projectName={project.name}
          onRenameProject={(name) => {
            setProject((prev) => ({ ...prev, name, updatedAt: Date.now() }));
            markProjectDirty();
          }}
          saveStatus={saveStatus}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          backgroundPattern={activeBoard.backgroundPattern}
          showCoordinates={activeBoard.showCoordinates}
          snapToGrid={activeBoard.snapToGrid}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          bottomBarsCollapsed={bottomBarsCollapsed}
          autoTransparentPanels={autoTransparentPanels}
          cleanWorkMode={cleanWorkMode}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onSaveNow={handleSaveNow}
          onNewProject={() =>
            setNewBoardModal({ open: true, mode: 'project', folderId: 'general' })
          }
          onOpenProjectManager={() => {
            void flushProjectPersistence().finally(() => {
              setShowProjectManager(true);
            });
          }}
          onOpenFilePizarra={handleOpenPizarraFile}
          onDownloadPizarra={() => {
            void import('./utils/exportEngine')
              .then((m) => m.downloadProjectFile(projectRef.current))
              .catch(() => setErrorToast('No se pudo preparar la descarga .pizarra.'));
          }}
          onImportExternalFile={() => fileImportInputRef.current?.click()}
          onOpenExport={() => setShowExportModal(true)}
          onStartAreaExport={() => {
            setEditingTextId(null);
            setEditingEquationId(null);
            setEditingDimensionId(null);
            setShowExportModal(false);
            setAreaExportMode(true);
          }}
          onDownloadManual={() => {
            void import('./utils/userManualPdf')
              .then((m) => m.downloadUserManualPdf())
              .catch(() => setErrorToast('No se pudo generar el manual en PDF.'));
          }}
          onOpenSettings={() => setShowSettingsModal(true)}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={() => handlePaste()}
          onDuplicate={handleDuplicate}
          onSelectAll={handleSelectAll}
          onDeleteSelection={() => handleDeleteObjects(selectedIds)}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          onZoomIn={() => zoomBy(1.15)}
          onZoomOut={() => zoomBy(1 / 1.15)}
          onZoomReset={zoomReset}
          onFitContent={fitContent}
          onToggleFullscreen={toggleFullscreen}
          onSetBackground={(pattern) => {
            if (pattern !== 'blank') {
              savedGridPatternRef.current = pattern;
            }
            mutateActiveBoard((b) => ({ ...b, backgroundPattern: pattern }));
          }}
          onToggleCoordinates={() =>
            mutateActiveBoard((b) => ({ ...b, showCoordinates: !b.showCoordinates }))
          }
          onToggleSnapToGrid={() => updateCadConfig({ gridSnap: !activeBoard.snapToGrid })}
          onToggleLeftPanel={() => setLeftCollapsed((v) => !v)}
          onToggleRightPanel={() => setRightCollapsed((v) => !v)}
          onToggleBottomBars={() => setBottomBarsCollapsed((v) => !v)}
          onToggleAutoTransparentPanels={() => setAutoTransparentPanels((v) => !v)}
          onToggleCleanWorkMode={() => setCleanWorkMode((v) => !v)}
          onSelectTool={(t) => {
            setEditingTextId(null);
            setEditingEquationId(null);
            setEditingDimensionId(null);
            setEditingTableCell(null);
            setPendingTableSize(null);
            setAreaExportMode(false);
            setCadSession(INITIAL_CAD_SESSION);
            setCadInputValue('');
            setActiveTool(t);
          }}
          onStartCadCommand={handleCadStartCommand}
          onJoinSegments={handleJoinSegments}
          onInsertEquation={startLiveEquation}
          onInsertGraph={() => setGraphModal({ open: true, editing: null })}
          onInsertSticky={handleInsertStickyObject}
          onInsertText={handleInsertTextObject}
        />
      )}

      {/* Multi-Board Tabs */}
      {!cleanWorkMode && (
        <BoardTabs
          boards={project.boards}
          activeBoardId={activeBoard.id}
          onSelectBoard={(boardId) => {
            setProject((prev) => ({
              ...prev,
              activeBoardId: boardId,
              updatedAt: Date.now(),
            }));
            scheduleViewportPersist();
            setSelectedIds([]);
            setEditingTextId(null);
            setEditingEquationId(null);
            setEditingDimensionId(null);
            setEditingTableCell(null);
            setPendingTableSize(null);
            setAreaExportMode(false);
            setExportAreaRect(null);
            setCadSession(INITIAL_CAD_SESSION);
            setCadInputValue('');
            setUndoStack([]);
            setRedoStack([]);
            setActiveSheetIndex(0);
          }}
          onAddBoard={() => setNewBoardModal({ open: true, mode: 'board' })}
          onDuplicateBoard={(boardId) => {
            const src = project.boards.find((b) => b.id === boardId);
            if (!src) return;
            const copy: Board = {
              ...JSON.parse(JSON.stringify(src)),
              id: uid('board'),
              name: `${src.name} (Copia)`,
            };
            setProject((prev) => ({
              ...prev,
              activeBoardId: copy.id,
              boards: [...prev.boards, copy],
              updatedAt: Date.now(),
            }));
            dirtyRef.current = false;
            setActiveSheetIndex(0);
            markProjectDirty();
          }}
          onRenameBoard={(boardId, name) => {
            setProject((prev) => ({
              ...prev,
              boards: prev.boards.map((b) => (b.id === boardId ? { ...b, name } : b)),
              updatedAt: Date.now(),
            }));
            markProjectDirty();
          }}
          onDeleteBoard={(boardId) => {
            if (project.boards.length <= 1) return;
            setProject((prev) => {
              const remaining = prev.boards.filter((b) => b.id !== boardId);
              const nextActive =
                prev.activeBoardId === boardId ? remaining[0].id : prev.activeBoardId;
              return {
                ...prev,
                activeBoardId: nextActive,
                boards: remaining,
                updatedAt: Date.now(),
              };
            });
            setSelectedIds([]);
            setActiveSheetIndex(0);
            markProjectDirty();
          }}
        />
      )}

      {/* Clean Work Mode Restore Button */}
      {cleanWorkMode && (
        <button
          type="button"
          data-export-ignore="true"
          onClick={() => setCleanWorkMode(false)}
          className="no-print fixed top-3 right-3 z-50 px-3 py-1.5 rounded-lg bg-slate-900/85 hover:bg-slate-900 text-white text-xs font-medium shadow-lg border border-slate-700 backdrop-blur-xs"
          title="Restaurar barras y paneles (Ctrl+.)"
        >
          Restaurar interfaz (Ctrl+.)
        </button>
      )}

      {/* Error Toast */}
      {errorToast && (
        <div className="no-print px-4 py-2 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-200 flex items-center justify-between">
          <span>{errorToast}</span>
          <button type="button" onClick={() => setErrorToast(null)} className="underline ml-4">
            Cerrar
          </button>
        </div>
      )}

      {/* Aviso discreto (toast) de historial de versiones */}
      {noticeToast && (
        <div
          role="status"
          className="no-print fixed bottom-10 right-4 z-[60] max-w-sm px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-900/95 text-white text-xs shadow-xl flex items-center gap-3 backdrop-blur-md"
        >
          <span className="leading-snug">{noticeToast}</span>
          <button
            type="button"
            onClick={() => setNoticeToast(null)}
            className="text-slate-300 hover:text-white underline shrink-0"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Sugerencia discreta de primer uso de la rueda en hojas de tamaño fijo */}
      {sheetWheelHintVisible && (
        <div
          role="status"
          data-sheet-wheel-hint="true"
          className="no-print fixed bottom-10 left-1/2 -translate-x-1/2 z-[55] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-900/95 text-white text-xs shadow-xl flex items-center gap-3 backdrop-blur-md whitespace-nowrap"
        >
          <span>Rueda: desplazar · Ctrl + rueda: zoom</span>
          <button
            type="button"
            aria-label="Cerrar sugerencia"
            onClick={() => {
              setSheetWheelHintVisible(false);
              sheetWheelHintTriggeredRef.current = true;
              saveSheetWheelHintDismissed();
            }}
            className="text-slate-300 hover:text-white underline shrink-0"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Main 3-Column Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!cleanWorkMode && (
          <div
            className={`flex shrink-0 relative z-40 ${panelFadeCls}`}
            onMouseEnter={() => setPanelHovered(true)}
            onMouseLeave={() => setPanelHovered(false)}
            onFocusCapture={() => setPanelHovered(true)}
            onBlurCapture={() => setPanelHovered(false)}
          >
            <LeftToolbar
              activeTool={activeTool}
              activeShapeKind={toolOptions.shapeKind}
              activeLineKind={toolOptions.lineKind}
              collapsed={leftCollapsed}
              onToggleCollapse={() => setLeftCollapsed((v) => !v)}
              onSelectTool={(t) => {
                setEditingTextId(null);
                setEditingEquationId(null);
                setEditingDimensionId(null);
                setEditingTableCell(null);
                setPendingTableSize(null);
                setAreaExportMode(false);
                setCadSession(INITIAL_CAD_SESSION);
                setCadInputValue('');
                setActiveTool(t);
              }}
              onSelectShapeKind={(kind) => {
                setCadSession(INITIAL_CAD_SESSION);
                setCadInputValue('');
                setToolOptions((p) => ({ ...p, shapeKind: kind }));
              }}
              onSelectLineKind={(kind) => {
                setCadSession(INITIAL_CAD_SESSION);
                setCadInputValue('');
                setToolOptions((p) => ({ ...p, lineKind: kind }));
              }}
              onOpenEquationModal={startLiveEquation}
              onOpenGraphModal={() => setGraphModal({ open: true, editing: null })}
              onImportFileClick={() => fileImportInputRef.current?.click()}
              onInsertTable={(rows, cols, mode) => handleInsertTable(rows, cols, mode)}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {editingEquation ? (
            <EquationRibbonBar
              equation={editingEquation}
              placeholderCount={(editingEquation.latex.match(/\\square/g) || []).length}
              onInsertSnippet={insertEquationSnippet}
              onReplaceLatex={(latex) => {
                handleUpdateObjects(
                  [editingEquation.id],
                  (o) => ({ ...(o as EquationObject), latex }),
                  true
                );
                setEquationCursor(getInitialEditCursor(latex));
                requestAnimationFrame(() => {
                  equationInputRef.current?.focus();
                });
              }}
              onUpdateMeta={(patch) => {
                handleUpdateObjects(
                  [editingEquation.id],
                  (o) => ({ ...(o as EquationObject), ...patch }),
                  true
                );
                requestAnimationFrame(() => {
                  equationInputRef.current?.focus();
                });
              }}
              onJumpNextPlaceholder={jumpNextEquationPlaceholder}
              onOpenExpandedModal={() => {
                const eq = editingEquation;
                setEditingEquationId(null);
                setEquationModal({ open: true, editing: eq });
              }}
              onFinish={() => {
                handleUpdateObjects([editingEquation.id], (o) => o, true);
                setEditingEquationId(null);
              }}
            />
          ) : (
            inlineRibbonEquation &&
            activeInlineEquation && (
              <EquationRibbonBar
                equation={inlineRibbonEquation}
                placeholderCount={(inlineRibbonEquation.latex.match(/\\square/g) || []).length}
                inlineMode
                displayMode={activeInlineEquation.session.displayMode}
                onToggleDisplayMode={(displayMode) => {
                  activeRichTextEditorRef.current?.updateInlineEquationMeta({ displayMode });
                }}
                onInsertSnippet={(snippet) => {
                  activeRichTextEditorRef.current?.insertInlineEquationSnippet(snippet);
                }}
                onReplaceLatex={(latex) => {
                  activeRichTextEditorRef.current?.replaceInlineEquationLatex(latex);
                }}
                onUpdateMeta={(patch) => {
                  activeRichTextEditorRef.current?.updateInlineEquationMeta({
                    ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
                    ...(patch.color ? { color: patch.color } : {}),
                  });
                }}
                onJumpNextPlaceholder={() => {
                  activeRichTextEditorRef.current?.jumpNextInlineEquationPlaceholder();
                }}
                onOpenExpandedModal={() => {
                  const { objId, session } = activeInlineEquation;
                  setInlineTextEquationModal({
                    objId,
                    req: {
                      initialLatex: session.latex,
                      displayMode: session.displayMode,
                      fontSize: session.fontSize,
                      color: session.color,
                      selectionRange: session.selectionRange,
                      isEditingExisting: true,
                    },
                  });
                }}
                onFinish={() => {
                  activeRichTextEditorRef.current?.finishInlineEquationEditing(true);
                }}
              />
            )
          )}

          <CanvasStage
            board={activeBoard}
            theme={settings.theme}
            canvasBgMode={settings.canvasBgMode}
            canvasBgCustomColor={settings.canvasBgCustomColor}
            adaptStrokeColorsToCanvasBg={settings.adaptStrokeColorsToCanvasBg}
            cursorSize={settings.cursorSize}
            cursorColor={settings.cursorColor}
            activeTool={activeTool}
            toolOptions={toolOptions}
            selectedIds={selectedIds}
            editingTextId={editingTextId}
            editingEquationId={editingEquationId}
            editingDimensionId={editingDimensionId}
            editingTableId={editingTableCell?.objectId ?? null}
            editingTableCell={
              editingTableCell
                ? { r: editingTableCell.r, c: editingTableCell.c }
                : null
            }
            pendingTableSize={pendingTableSize}
            equationInputRef={equationInputRef}
            equationCursor={equationCursor}
            areaExportMode={areaExportMode}
            arrayPickMode={arrayPickMode}
            livePathArrayDraft={livePathArrayDraft}
            pressureSensitivity={settings.pressureSensitivity}
            stageRef={stageRef}
            onSelectIds={setSelectedIds}
            onSetEditingTextId={setEditingTextId}
            onSetEditingEquationId={setEditingEquationId}
            onSetEditingDimensionId={setEditingDimensionId}
            onSetEditingTableCell={(tableId, cell: TableCellCoord | null) => {
              setEditingTableCell(
                tableId && cell ? { objectId: tableId, r: cell.r, c: cell.c } : null
              );
            }}
            onPlacePendingTable={(worldPt) => {
              if (!pendingTableSize) return;
              handleInsertTable(pendingTableSize.rows, pendingTableSize.cols, 'center', worldPt);
            }}
            onCancelPendingTable={() => setPendingTableSize(null)}
            onEquationCursorChange={setEquationCursor}
            onOpenEquationModal={(eq) => {
              setEditingEquationId(null);
              setEquationModal({ open: true, editing: eq });
            }}
            onCompleteAreaExport={(rect) => {
              setExportAreaRect(rect);
              setAreaExportMode(false);
              setShowExportModal(true);
            }}
            onCancelAreaExport={() => setAreaExportMode(false)}
            onUpdateViewport={(vp) =>
              mutateActiveBoard((b) => ({ ...b, viewport: vp }), false, {
                persistViewport: true,
              })
            }
            onAddObject={handleAddObject}
            onUpdateObjects={handleUpdateObjects}
            onDeleteObjects={handleDeleteObjects}
            onStartEraserPass={handleStartEraserPass}
            onEraserSweep={handleEraserSweep}
            onEndEraserPass={handleEndEraserPass}
            onApplyCutChanges={handleApplyCutChanges}
            onCursorMove={handleCanvasCursorMove}
            onInteractionActiveChange={handleCanvasInteractionActiveChange}
            onCanvasPointerActivity={setPointerOverCanvas}
            onDoubleClickGraph={(gr) => setGraphModal({ open: true, editing: gr })}
            onDropFiles={(files, wx, wy) => processIncomingFiles(files, wx, wy)}
            onSwitchToSelect={() => setActiveTool('select')}
            cadConfig={cadConfig}
            cadSession={cadSession}
            onCadPickPoint={handleCadPickPoint}
            onArrayPickCanvas={(worldPt, pickedObjId) => {
              if (arrayPickMode === 'polar-center') {
                setPickedPolarCenterWorld(worldPt);
                setArrayPickMode(null);
              } else if (arrayPickMode === 'path-base-point') {
                setPickedPathBasePointWorld(worldPt);
                setArrayPickMode(null);
              } else if (arrayPickMode === 'path-object') {
                const isPath =
                  pickedObjId &&
                  candidateArrayPaths.some((p) => p.id === pickedObjId);
                if (isPath && pickedObjId) {
                  setPickedPathId(pickedObjId);
                  setArrayPickMode(null);
                } else {
                  setErrorToast(
                    'Haz clic sobre una línea, polilínea, arco, círculo o trazo válido.'
                  );
                }
              }
            }}
            onCadQuickStart={handleCadQuickStart}
            onCadFinishSession={handleCadFinishSession}
            onCadCancelSession={handleCadCancelSession}
            leftCollapsed={leftCollapsed}
            rightCollapsed={rightCollapsed}
            bottomBarsCollapsed={bottomBarsCollapsed}
            autoTransparentPanels={autoTransparentPanels}
            cleanWorkMode={cleanWorkMode}
            contextActions={contextActions}
            onPointerStageMove={(pos) => {
              lastPointerStageRef.current = pos;
            }}
            renderQuickCommandHud={(stageSize) =>
              quickCmdOpen ? (
                <Suspense fallback={null}>
                  <QuickCommandHud
                    open={quickCmdOpen}
                    anchorStagePos={quickCmdAnchor}
                    stageSize={stageSize}
                    onExecuteItem={handleExecuteQuickCatalogItem}
                    onClose={() => setQuickCmdOpen(false)}
                  />
                </Suspense>
              ) : null
            }
            activeRichTextEditorRef={activeRichTextEditorRef}
            onRichTextSelectionSummaryChange={handleRichTextSelectionSummaryChange}
            onRequestTextEquationEditor={(objId, req) =>
              setInlineTextEquationModal({ objId, req })
            }
            onActiveInlineTextEquationChange={(objId, session) => {
              setActiveInlineEquation(session ? { objId, session } : null);
            }}
            onRepairTextObject={handleRepairTextObject}
            onRepairTableObject={handleRepairTableObject}
            spellcheckEnabled={settings.spellcheckEnabled}
            defaultSpellcheckLang={settings.spellcheckDefaultLang}
            onPushHistorySnapshot={(snapshotObjects) =>
              pushHistory(snapshotObjects, activeBoard.groups)
            }
            onUndo={handleUndo}
            onRedo={handleRedo}
            onResolvedCursorChange={(cursor) => {
              lastResolvedCursorRef.current = cursor;
            }}
            onTrackingError={handleTrackingError}
            onAddSheetAfter={handleAddSheetAfter}
            onDuplicateSheet={handleDuplicateSheet}
            onRequestDeleteSheet={handleRequestDeleteSheet}
            onActiveSheetChange={setActiveSheetIndex}
            wheelScrollSheets={settings.wheelScrollSheets ?? true}
            hasOpenModal={Boolean(
              showSettingsModal ||
                showExportModal ||
                showProjectManager ||
                newBoardModal.open ||
                equationModal.open ||
                inlineTextEquationModal ||
                graphModal.open ||
                arrayModal.open ||
                deleteSheetConfirm ||
                quickCmdOpen
            )}
            onFirstFixedSheetWheel={() => {
              try {
                if (sheetWheelHintTriggeredRef.current) return;
                sheetWheelHintTriggeredRef.current = true;
                if (!loadSheetWheelHintDismissed()) {
                  setSheetWheelHintVisible(true);
                }
              } catch {
                // Ignorar error de almacenamiento local
              }
            }}
          />

          {!cleanWorkMode && !bottomBarsCollapsed && (
            <div
              className={`shrink-0 ${panelFadeCls}`}
              onMouseEnter={() => setPanelHovered(true)}
              onMouseLeave={() => setPanelHovered(false)}
              onFocusCapture={() => setPanelHovered(true)}
              onBlurCapture={() => setPanelHovered(false)}
            >
              <CadCommandBar
                session={cadSession}
                config={cadConfig}
                gridVisible={activeBoard.backgroundPattern !== 'blank'}
                selectedCount={selectedIds.length}
                inputValue={cadInputValue}
                inputRef={cadInputRef}
                onInputChange={setCadInputValue}
                onSubmitCommand={handleCadSubmitCommand}
                onCancelCommand={handleCadCancelSession}
                onTriggerOption={(code) => handleCadSubmitCommand(code)}
                onStartCommand={handleCadStartCommand}
                onToggleGridVisible={() => toggleGridVisible()}
                onUpdateConfig={updateCadConfig}
                onToggleOsnapMode={(mode: CadSnapKind) =>
                  setCadConfig((prev) => ({
                    ...prev,
                    osnapModes: {
                      ...prev.osnapModes,
                      [mode]: !prev.osnapModes[mode],
                    },
                  }))
                }
                onStartPickOrigin={() => {
                  setCadInputValue('');
                  setCadSession({
                    ...INITIAL_CAD_SESSION,
                    pickingOrigin: true,
                  });
                }}
              />
            </div>
          )}
        </div>

        {!cleanWorkMode && (
          <div
            className={`flex shrink-0 ${panelFadeCls}`}
            onMouseEnter={() => setPanelHovered(true)}
            onMouseLeave={() => setPanelHovered(false)}
            onFocusCapture={() => setPanelHovered(true)}
            onBlurCapture={() => setPanelHovered(false)}
          >
            <RightInspector
              board={activeBoard}
              settings={settings}
              cadConfig={cadConfig}
              activeTool={activeTool}
              toolOptions={toolOptions}
              selectedObjects={selectedObjects}
              collapsed={rightCollapsed}
              activeTab={inspectorTab}
              onChangeTab={setInspectorTab}
              onToggleCollapse={() => setRightCollapsed((v) => !v)}
              onUpdateSettings={setSettings}
              onUpdateToolOptions={(patch) => setToolOptions((prev) => ({ ...prev, ...patch }))}
              onUpdateBoardMeta={(patch) => {
                // Sincroniza el interruptor de SNAP entre Propiedades y la barra inferior CAD
                if (patch.snapToGrid !== undefined) {
                  setCadConfig((prev) => ({
                    ...prev,
                    gridSnap: Boolean(patch.snapToGrid),
                  }));
                }
                const rect = stageRef.current?.getBoundingClientRect();
                mutateActiveBoard((b) => {
                  const prevFixed = isFixedSizeBoard(b);
                  const prevPageW = b.pageWidth ?? 816;
                  const prevPageH = b.pageHeight ?? 1056;
                  const next: Board = { ...b, ...patch };
                  const nextFixed = isFixedSizeBoard(next);
                  const sheets = nextFixed ? normalizarHojas(next) : undefined;
                  if (sheets) {
                    next.sheets = sheets;
                  }
                  if (
                    prevFixed &&
                    nextFixed &&
                    next.pageHeight &&
                    next.pageHeight !== prevPageH &&
                    sheets &&
                    sheets.length > 1
                  ) {
                    const nextPageH = next.pageHeight;
                    const shifted = b.objects.map((obj) => {
                      const owner = findSheetIndexForObject(
                        obj,
                        sheets.length,
                        prevPageW,
                        prevPageH
                      );
                      if (owner >= 1) {
                        const deltaY = getSheetY(owner, nextPageH) - getSheetY(owner, prevPageH);
                        return deltaY !== 0 ? translateCanvasObject(obj, 0, deltaY) : obj;
                      }
                      return obj;
                    });
                    next.objects = recomputeAssociativeDimensions(shifted, cadConfig);
                  }
                  if (
                    b.objects.length === 0 &&
                    (patch.sizePreset !== undefined ||
                      patch.pageWidth !== undefined ||
                      patch.pageHeight !== undefined) &&
                    nextFixed &&
                    next.pageWidth &&
                    next.pageHeight
                  ) {
                    const focusIdx = sheets
                      ? Math.max(0, Math.min(sheets.length - 1, activeSheetIndex))
                      : 0;
                    next.viewport = computeCenteredViewportForPage(
                      next.pageWidth,
                      next.pageHeight,
                      rect?.width ?? 1000,
                      rect?.height ?? 700,
                      getSheetY(focusIdx, next.pageHeight)
                    );
                  }
                  return next;
                });
              }}
              onUpdateObjects={(ids, updater) => handleUpdateObjects(ids, updater, true)}
              onSelectIds={setSelectedIds}
              onStartEditingText={(id) => {
                setSelectedIds([id]);
                setEditingEquationId(null);
                setEditingDimensionId(null);
                setEditingTextId(id);
                setActiveTool('select');
              }}
              onDeleteSelected={() => handleDeleteObjects(selectedIds)}
              onDuplicateSelected={handleDuplicate}
              onGroupSelected={handleGroup}
              onUngroupSelected={handleUngroup}
              onRenameGroup={handleRenameGroup}
              onDissolveGroup={handleDissolveGroup}
              onSelectGroup={handleSelectGroup}
              onAddSelectionToGroup={handleAddSelectionToGroup}
              onRemoveFromGroup={handleRemoveFromGroup}
              onZOrder={handleZOrder}
              onAlign={handleAlign}
              onDistribute={handleDistribute}
              onOpenEquationEditor={(eq) => {
                setEditingEquationId(null);
                setEquationModal({ open: true, editing: eq });
              }}
              onStartEditingEquation={(id) => {
                const eq = activeBoard.objects.find(
                  (o): o is EquationObject => o.id === id && o.type === 'equation'
                );
                setSelectedIds([id]);
                setEditingTextId(null);
                setEditingDimensionId(null);
                if (eq) {
                  setEquationCursor(getInitialEditCursor(eq.latex));
                }
                setEditingEquationId(id);
                setActiveTool('select');
              }}
              onOpenGraphEditor={(gr) => setGraphModal({ open: true, editing: gr })}
              onLayerAdd={() => {
                const newLayer: Layer = {
                  id: uid('layer'),
                  name: `Capa ${activeBoard.layers.length + 1}`,
                  visible: true,
                  locked: false,
                };
                mutateActiveBoard((b) => ({
                  ...b,
                  layers: [...b.layers, newLayer],
                  activeLayerId: newLayer.id,
                }));
              }}
              onLayerUpdate={(layerId, patch) => {
                mutateActiveBoard((b) => ({
                  ...b,
                  layers: b.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
                }));
              }}
              onLayerDelete={(layerId) => {
                if (activeBoard.layers.length <= 1) return;
                const remaining = activeBoard.layers.filter((l) => l.id !== layerId);
                const fallbackId = remaining[0].id;
                pushHistory(activeBoard.objects, activeBoard.groups);
                mutateActiveBoard((b) => ({
                  ...b,
                  layers: remaining,
                  activeLayerId: b.activeLayerId === layerId ? fallbackId : b.activeLayerId,
                  objects: b.objects.map((o) =>
                    o.layerId === layerId ? { ...o, layerId: fallbackId } : o
                  ),
                }));
              }}
              onLayerSelect={(layerId) =>
                mutateActiveBoard((b) => ({ ...b, activeLayerId: layerId }), false)
              }
              onAssignToLayer={(layerId) => {
                handleUpdateObjects(selectedIds, (o) => ({ ...o, layerId }), true);
              }}
              editingTextId={editingTextId}
              activeRichTextEditorRef={activeRichTextEditorRef}
              richTextSummary={richTextSummary}
            />
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      {!cleanWorkMode && !bottomBarsCollapsed && (
        <div
          className={`shrink-0 ${panelFadeCls}`}
          onMouseEnter={() => setPanelHovered(true)}
          onMouseLeave={() => setPanelHovered(false)}
          onFocusCapture={() => setPanelHovered(true)}
          onBlurCapture={() => setPanelHovered(false)}
        >
          <BottomBar
            zoom={activeBoard.viewport.zoom}
            cursorWorld={
              isOptEnabled('reactMemoThrottle') ? STATIC_CURSOR_ORIGIN : cursorWorld
            }
            cadConfig={cadConfig}
            objectCount={activeBoard.objects.length}
            selectedCount={selectedIds.length}
            activeLayerName={activeLayerName}
            activeSheetNumber={isFixedSizeBoard(activeBoard) ? activeSheetIndex + 1 : undefined}
            totalSheets={
              isFixedSizeBoard(activeBoard) ? normalizarHojas(activeBoard).length : undefined
            }
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomReset={zoomReset}
            onFitContent={fitContent}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={fileImportInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.svg,.webp,.pdf,.docx,.xlsx,.xls,.csv,.txt,.md"
        className="hidden"
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await processIncomingFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={pizarraOpenInputRef}
        type="file"
        accept=".pizarra,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const parsed = JSON.parse(text) as WhiteboardProject;
            if (parsed && Array.isArray(parsed.boards)) {
              await flushProjectPersistence();
              const loaded = applyProjectValidation({
                ...parsed,
                id: uid('proj'),
                updatedAt: Date.now(),
              });
              await saveProject(loaded, true);
              setProject(loaded);
              setUndoStack([]);
              setRedoStack([]);
              setSelectedIds([]);
              setActiveSheetIndex(0);
              dirtyRef.current = false;
              viewportDirtyRef.current = false;
              clearScheduledAutosave();
              clearScheduledViewportPersist();
              setSaveStatus('saved');
              setLastSavedAt(loaded.updatedAt);
            }
          } catch {
            setErrorToast('El archivo seleccionado no es un proyecto .pizarra válido.');
          }
          e.target.value = '';
        }}
      />

      {/* OPT: 1.1 — Modales cargados de forma diferida dentro de Suspense */}
      <Suspense fallback={null}>
        {equationModal.open && (
          <EquationEditorModal
            initialEquation={equationModal.editing}
            onClose={() => setEquationModal({ open: false })}
            onConfirm={(data) => {
              if (equationModal.editing) {
                handleUpdateObjects(
                  [equationModal.editing.id],
                  (o) => ({ ...(o as EquationObject), ...data }),
                  true
                );
              } else {
                const center = getViewportCenterWorld();
                const newEq: EquationObject = {
                  id: uid('eq'),
                  type: 'equation',
                  layerId: activeBoard.activeLayerId,
                  x: center.x - 170,
                  y: center.y - 45,
                  width: 340,
                  height: 90,
                  rotation: 0,
                  opacity: 1,
                  locked: false,
                  zIndex: activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1,
                  ...data,
                };
                handleAddObject(newEq);
                setSelectedIds([newEq.id]);
                setActiveTool('select');
              }
              setEquationModal({ open: false });
            }}
          />
        )}

        {inlineTextEquationModal && (
          <EquationEditorModal
            inlineMode
            isEditingInline={inlineTextEquationModal.req.isEditingExisting}
            initialLatex={inlineTextEquationModal.req.initialLatex}
            initialDisplayMode={inlineTextEquationModal.req.displayMode}
            initialFontSize={inlineTextEquationModal.req.fontSize}
            initialColor={inlineTextEquationModal.req.color}
            onClose={() => {
              setInlineTextEquationModal(null);
              window.requestAnimationFrame(() => {
                activeRichTextEditorRef.current?.focus();
              });
            }}
            onConfirm={(data) => {
              const targetModal = inlineTextEquationModal;
              const mathPayload = {
                latex: data.latex,
                ...(data.displayMode ? { displayMode: true } : {}),
              };
              if (editingTextId === targetModal.objId && activeRichTextEditorRef.current) {
                activeRichTextEditorRef.current.insertOrUpdateMath(mathPayload, {
                  selectionRange: targetModal.req.selectionRange,
                  fontSize: data.fontSize,
                  color: data.color,
                  restoreFocus: true,
                });
              } else {
                handleUpdateObjects(
                  [targetModal.objId],
                  (o) => {
                    if (o.type !== 'text') return o;
                    const t = o as TextObject;
                    const defaults = getDefaultRunStyle(t);
                    const paras = ensureTextParagraphs(t);
                    const caretStyle = getCaretRunStyle(
                      paras,
                      targetModal.req.selectionRange.start,
                      defaults
                    );
                    const activeStyle = resolveRunStyle(
                      { ...caretStyle, fontSize: data.fontSize, color: data.color },
                      defaults
                    );
                    const { paragraphs: next } = replaceRangeWithMathRun(
                      paras,
                      targetModal.req.selectionRange,
                      mathPayload,
                      activeStyle,
                      defaults
                    );
                    return syncTextObjectFromParagraphs(t, next);
                  },
                  true
                );
              }
              setInlineTextEquationModal(null);
            }}
          />
        )}

        {graphModal.open && (
          <GraphEditorModal
            initialGraph={graphModal.editing}
            onClose={() => setGraphModal({ open: false })}
            onConfirm={(data) => {
              if (graphModal.editing) {
                handleUpdateObjects(
                  [graphModal.editing.id],
                  (o) => ({ ...(o as GraphObject), ...data }),
                  true
                );
              } else {
                const center = getViewportCenterWorld();
                const newGraph: GraphObject = {
                  id: uid('graph'),
                  type: 'graph',
                  layerId: activeBoard.activeLayerId,
                  x: center.x - 240,
                  y: center.y - 180,
                  width: 480,
                  height: 360,
                  rotation: 0,
                  opacity: 1,
                  locked: false,
                  zIndex: activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0) + 1,
                  ...data,
                };
                handleAddObject(newGraph);
                setSelectedIds([newGraph.id]);
                setActiveTool('select');
              }
              setGraphModal({ open: false });
            }}
          />
        )}

        {showProjectManager && (
          <ProjectManagerModal
            currentProject={project}
            onBeforeSwitchProject={flushProjectPersistence}
            onSelectProject={(loaded) => {
              const validated = applyProjectValidation(loaded);
              setProject(validated);
              setUndoStack([]);
              setRedoStack([]);
              setSelectedIds([]);
              setEditingTextId(null);
              setActiveSheetIndex(0);
              dirtyRef.current = false;
              viewportDirtyRef.current = false;
              clearScheduledAutosave();
              clearScheduledViewportPersist();
              setSaveStatus('saved');
              setLastSavedAt(validated.updatedAt);
            }}
            onRequestNewProject={(folderId) =>
              setNewBoardModal({ open: true, mode: 'project', folderId })
            }
            onNotifyToast={(msg, kind) => {
              if (kind === 'error') {
                setErrorToast(msg);
              } else {
                setNoticeToast(msg);
              }
            }}
            onClose={() => setShowProjectManager(false)}
          />
        )}

        {showExportModal && (
          <ExportModal
            project={project}
            board={activeBoard}
            activeSheetIndex={activeSheetIndex}
            selectedIds={selectedIds}
            stageElement={stageRef.current}
            areaRect={exportAreaRect}
            onStartAreaSelection={() => {
              setShowExportModal(false);
              setEditingTextId(null);
              setEditingEquationId(null);
              setAreaExportMode(true);
            }}
            onClearAreaRect={() => setExportAreaRect(null)}
            onClose={() => setShowExportModal(false)}
          />
        )}

        {showSettingsModal && (
          <SettingsModal
            settings={settings}
            onUpdateSettings={setSettings}
            onClose={() => setShowSettingsModal(false)}
          />
        )}

        {arrayModal.open && !arrayPickMode && (
          <ArrayModal
            open={true}
            kind={arrayModal.kind}
            selectedCount={selectedIds.length}
            selectionCenterWorld={selectionCenterWorld}
            cadConfig={cadConfig}
            candidatePaths={candidateArrayPaths}
            pickedCenterWorld={pickedPolarCenterWorld}
            pickedPathId={pickedPathId}
            pickedPathBasePointWorld={pickedPathBasePointWorld}
            initialPathDraft={
              livePathArrayDraft ??
              (cadSession.activeCommand === 'array-path' ? cadSession.pathArray : null)
            }
            onChangeKind={(k) => {
              if (k !== 'path') setLivePathArrayDraft(null);
              setArrayModal({ open: true, kind: k });
            }}
            onRequestPickPolarCenter={() => setArrayPickMode('polar-center')}
            onRequestPickPathObject={() => setArrayPickMode('path-object')}
            onRequestPickPathBasePoint={() => setArrayPickMode('path-base-point')}
            onPathDraftChange={setLivePathArrayDraft}
            onClose={() => {
              setArrayPickMode(null);
              setLivePathArrayDraft(null);
              setArrayModal({ open: false, kind: 'rect' });
            }}
            onSubmit={(payload: ArrayModalSubmitPayload) => {
              const maxZ = activeBoard.objects.reduce((m, o) => Math.max(m, o.zIndex), 0);
              const curGroups = ensureGroupsArray(activeBoard.groups);
              let res: {
                addObjects: CanvasObject[];
                addGroups: GroupRecord[];
                createdIds: string[];
                error?: string;
              } = { addObjects: [], addGroups: [], createdIds: [] };

              if (payload.kind === 'rect') {
                res = generateRectangularArray(
                  selectedObjects,
                  curGroups,
                  {
                    rows: payload.rows,
                    cols: payload.cols,
                    dxWorld: payload.dxWorld,
                    dyWorld: payload.dyWorld,
                  },
                  activeBoard.activeLayerId,
                  maxZ + 1
                );
              } else if (payload.kind === 'polar') {
                res = generatePolarArray(
                  selectedObjects,
                  curGroups,
                  {
                    centerWorld: payload.centerWorld,
                    count: payload.polarCount,
                    totalAngleDeg: payload.totalAngleDeg,
                    rotateItems: payload.rotateItems,
                  },
                  cadConfig,
                  activeBoard.activeLayerId,
                  maxZ + 1
                );
              } else if (payload.kind === 'path') {
                const pathObj = activeBoard.objects.find((o) => o.id === payload.pathId);
                if (!pathObj) {
                  res = {
                    addObjects: [],
                    addGroups: [],
                    createdIds: [],
                    error: 'Selecciona un camino válido antes de aplicar la matriz.',
                  };
                } else {
                  res = generatePathArray(
                    selectedObjects,
                    curGroups,
                    pathObj,
                    {
                      mode: payload.pathMode,
                      count: payload.pathCount,
                      spacingWorld: payload.pathSpacingWorld,
                      alignToPath: payload.alignToPath,
                      basePointMode: payload.pathBasePointMode,
                      basePointWorld: payload.pathBasePointWorld,
                      includeOriginalAtStart: payload.includeOriginalAtStart,
                    },
                    cadConfig,
                    activeBoard.activeLayerId,
                    maxZ + 1
                  );
                }
              }

              if (res.error) {
                setErrorToast(res.error);
              } else if (res.createdIds.length > 0) {
                pushHistory(activeBoard.objects, activeBoard.groups);
                mutateActiveBoard((b) => ({
                  ...b,
                  objects: recomputeAssociativeDimensions(
                    [...b.objects, ...res.addObjects],
                    cadConfig
                  ),
                  groups: [...ensureGroupsArray(b.groups), ...res.addGroups],
                }));
                setSelectedIds(res.createdIds);
                if (cadSession.activeCommand === 'array-path') {
                  setCadSession({
                    ...INITIAL_CAD_SESSION,
                    statusMessage: `Matriz por camino aplicada (${res.createdIds.length} copia(s))`,
                  });
                  setActiveTool('select');
                } else {
                  setCadSession((prev) => ({
                    ...prev,
                    statusMessage: `Matriz generada (${res.createdIds.length} copia(s))`,
                  }));
                }
              }
              setArrayPickMode(null);
              setLivePathArrayDraft(null);
              setArrayModal({ open: false, kind: 'rect' });
            }}
          />
        )}

        {newBoardModal.open && (
          <NewBoardModal
            mode={newBoardModal.mode}
            defaultName={
              newBoardModal.mode === 'project'
                ? 'Nuevo Proyecto'
                : `Tablero ${project.boards.length + 1}`
            }
            defaultBackground={activeBoard.backgroundPattern}
            onConfirm={async (res: NewBoardModalResult) => {
              const rect = stageRef.current?.getBoundingClientRect();
              const boardOpts = {
                sizePreset: res.sizePreset,
                pageOrientation: res.pageOrientation,
                customWidthPx: res.customWidthPx,
                customHeightPx: res.customHeightPx,
                backgroundPattern: res.backgroundPattern,
                viewportWidth: rect?.width ?? 1000,
                viewportHeight: rect?.height ?? 700,
              };

              if (newBoardModal.mode === 'project') {
                await flushProjectPersistence();
                const proj = createNewProject(
                  res.name,
                  newBoardModal.folderId || 'general',
                  'Tablero 1',
                  settings.defaultGridSize,
                  boardOpts
                );
                await saveProject(proj, true);
                setProject(proj);
                setUndoStack([]);
                setRedoStack([]);
                setSelectedIds([]);
                setEditingTextId(null);
                setEditingEquationId(null);
                setEditingDimensionId(null);
                setAreaExportMode(false);
                setExportAreaRect(null);
                setActiveSheetIndex(0);
                dirtyRef.current = false;
                viewportDirtyRef.current = false;
                clearScheduledAutosave();
                clearScheduledViewportPersist();
                setSaveStatus('saved');
                setLastSavedAt(proj.updatedAt);
              } else {
                const nb = createEmptyBoard(res.name, settings.defaultGridSize, boardOpts);
                setProject((prev) => ({
                  ...prev,
                  activeBoardId: nb.id,
                  boards: [...prev.boards, nb],
                  updatedAt: Date.now(),
                }));
                setSelectedIds([]);
                setEditingTextId(null);
                setEditingEquationId(null);
                setEditingDimensionId(null);
                setAreaExportMode(false);
                setExportAreaRect(null);
                setUndoStack([]);
                setRedoStack([]);
                setActiveSheetIndex(0);
                markProjectDirty();
              }
              setNewBoardModal({ open: false, mode: 'board' });
            }}
            onClose={() => setNewBoardModal({ open: false, mode: 'board' })}
          />
        )}
      </Suspense>

      {/* Confirmación discreta para eliminar hoja */}
      {deleteSheetConfirm && (
        <div
          className="no-print fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-sheet-dialog-title"
          onClick={() => setDeleteSheetConfirm(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl theme-panel border shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-sheet-dialog-title"
              className="text-sm font-semibold theme-text"
            >
              Eliminar hoja {deleteSheetConfirm.sheetNumber}
            </h3>
            <p className="mt-2 text-xs theme-muted leading-relaxed">
              Se eliminará la hoja {deleteSheetConfirm.sheetNumber} y su contenido. Puedes deshacer con Ctrl+Z.
            </p>
            {deleteSheetConfirm.ownedCount > 0 && (
              <p className="mt-1.5 text-[11px] theme-muted">
                Elementos en esta hoja: {deleteSheetConfirm.ownedCount}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteSheetConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-xs border theme-border theme-text hover:bg-slate-500/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteSheet}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
              >
                Eliminar hoja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Medidor interno opcional (?perf=1 o localStorage abaco_perf=1; oculto por defecto) */}
      <PerfMonitorHud />
    </div>
  );
}
