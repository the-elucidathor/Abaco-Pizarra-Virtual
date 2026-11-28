import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Compass,
  Copy,
  CopyPlus,
  Crosshair,
  Eye,
  FileUp,
  FlipHorizontal2,
  Grid3X3,
  GripVertical,
  Group,
  Layers,
  LayoutGrid,
  LineChart,
  Link2,
  Lock,
  Menu,
  Minus,
  Palette,
  PenTool,
  PlusSquare,
  RotateCw,
  Ruler,
  Scissors,
  Settings,
  Shapes,
  Sigma,
  Sliders,
  Spline,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Ungroup,
  Unlock,
  Wrench,
} from 'lucide-react';
import type {
  BackgroundPattern,
  CanvasObject,
  ShapeKind,
} from '../types/whiteboard';
import type { CadCommandId, CadDraftingConfig } from '../types/cad';
import type { EndpointAlignMode } from '../utils/cad/cadTransform';
import { getSelectionContextCapabilities } from '../utils/cad/cadContextActions';
import { is3DSolidShape } from '../utils/shapeRenderer';

export interface SelectionScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasContextActions {
  onCopy: () => void;
  onPaste?: () => void;
  onDuplicate: () => void;
  onCut: () => void;
  onDelete: () => void;
  onRotateBy: (deltaDeg: number) => void;
  onToggleLockSelection: (lock: boolean) => void;
  onSetCommonColor: (color: string) => void;
  onSetCommonStrokeWidth: (width: number) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onAlign: (axis: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;
  onDistribute: (dir: 'horizontal' | 'vertical') => void;
  onJoinSegments: () => void;
  onCreatePolylineFromSelection: () => void;
  onAlignEndpoints: (mode: EndpointAlignMode) => void;
  onStartCadCommand: (cmd: CadCommandId) => void;
  onSelectShapeAndDraw: (shapeKind: ShapeKind) => void;
  onInsertText: () => void;
  onInsertSticky: () => void;
  onInsertEquation: () => void;
  onInsertGraph: () => void;
  onInsertTable?: (rows: number, cols: number) => void;
  onImportExternalFile: () => void;
  onToggleGridVisible: () => void;
  onToggleSnapToGrid: () => void;
  onToggleOsnap: () => void;
  onToggleCoordinates: () => void;
  onToggleOrtho: () => void;
  onTogglePolar: () => void;
  onOpenSettings: () => void;
  onOpenInspectorTab: (tab: 'props' | 'layers') => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleBottomBars: () => void;
  onToggleAutoTransparentPanels: () => void;
  onToggleCleanWorkMode: () => void;
}

interface CanvasContextMenuProps {
  selectedObjects: CanvasObject[];
  elementMenuAnchor: { x: number; y: number } | null;
  onCloseElementMenu?: () => void;
  stageSize: { width: number; height: number };
  hidden: boolean;
  backgroundPattern: BackgroundPattern;
  showCoordinates: boolean;
  snapToGrid: boolean;
  cadConfig: CadDraftingConfig;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomBarsCollapsed: boolean;
  autoTransparentPanels: boolean;
  cleanWorkMode: boolean;
  canPaste?: boolean;
  actions: CanvasContextActions;
}

const QUICK_COLORS = [
  '#0f172a',
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0284c7',
  '#475569',
  '#ffffff',
];

const QUICK_WIDTHS = [1, 2, 3, 4, 6, 8];

const GEOMETRIC_INSERT_ITEMS: { kind: ShapeKind; label: string }[] = [
  { kind: 'rectangle', label: 'Rectángulo' },
  { kind: 'circle', label: 'Círculo' },
  { kind: 'triangle', label: 'Triángulo' },
  { kind: 'hexagon', label: 'Hexágono' },
  { kind: 'polygon', label: 'Polígono regular' },
  { kind: 'cube', label: 'Cubo 3D' },
  { kind: 'cylinder', label: 'Cilindro 3D' },
  { kind: 'cone', label: 'Cono 3D' },
  { kind: 'sphere', label: 'Esfera 3D' },
];

export interface QuickMenuPos {
  x: number;
  y: number;
}

export interface QuickMenuPlacement {
  left: number;
  top: number;
  openUp: boolean;
  menuAlignRight: boolean;
  subFlipLeft: boolean;
  subAlignBottom: boolean;
}

const QUICK_MENU_POS_STORAGE_KEY = 'abaco_quick_menu_pos_v1';

// Calcula la posición fija dentro del lienzo y la dirección óptima de despliegue del menú rápido y sus submenús
export function computeQuickMenuPlacement(
  pos: QuickMenuPos,
  stageSize: { width: number; height: number },
  triggerSize: { width: number; height: number } = { width: 148, height: 34 },
  boardMenuW = 220,
  estMenuH = 198,
  estSubW = 248,
  estSubH = 330
): QuickMenuPlacement {
  const pad = 8;
  const stageW = Math.max(triggerSize.width + pad * 2, stageSize.width || 800);
  const stageH = Math.max(triggerSize.height + pad * 2, stageSize.height || 600);

  const maxLeft = Math.max(pad, stageW - triggerSize.width - pad);
  const maxTop = Math.max(pad, stageH - triggerSize.height - pad);
  const left = Math.max(pad, Math.min(Math.round(pos.x), maxLeft));
  const top = Math.max(pad, Math.min(Math.round(pos.y), maxTop));

  const spaceBelow = stageH - (top + triggerSize.height + 12);
  const spaceAbove = top - 12;
  const openUp = spaceBelow < estMenuH && spaceAbove > spaceBelow;

  const candidateRightLeft = left + triggerSize.width - boardMenuW;
  const menuAlignRight =
    left + boardMenuW > stageW - pad && candidateRightLeft >= pad;
  const menuLeft = menuAlignRight ? candidateRightLeft : left;

  const spaceRight = stageW - (menuLeft + boardMenuW + 8);
  const spaceLeft = menuLeft - 8;
  const subFlipLeft = spaceRight < estSubW && spaceLeft >= spaceRight;

  const menuTop = openUp
    ? Math.max(pad, top - estMenuH - 8)
    : top + triggerSize.height + 8;
  const subAlignBottom = openUp || menuTop + estSubH > stageH - 12;

  return {
    left,
    top,
    openUp,
    menuAlignRight,
    subFlipLeft,
    subAlignBottom,
  };
}

export interface SelectionBarPlacement {
  mode: 'top' | 'side-right' | 'side-left';
  barLeft: number;
  barTop: number;
  menuLeft: number;
  menuTop: number;
  subFlipLeft: boolean;
  subAlignBottom: boolean;
}

// Detecta si la selección ya muestra barras flotantes propias arriba o abajo (tablas, sólidos 3D, etc.)
export function selectionNeedsSideBar(selectedObjects: CanvasObject[]): boolean {
  if (selectedObjects.length === 0) return false;
  // Las tablas desbloqueadas muestran su propia barra de edición arriba (-top-11)
  if (selectedObjects.some((o) => o.type === 'table' && !o.locked)) {
    return true;
  }
  // Los sólidos 3D desbloqueados seleccionados muestran su barra de espejo debajo (-bottom-10)
  if (
    selectedObjects.length === 1 &&
    !selectedObjects[0].locked &&
    selectedObjects[0].type === 'shape' &&
    is3DSolidShape(selectedObjects[0].shapeKind)
  ) {
    return true;
  }
  return false;
}

// Calcula la posición de la barra rápida de selección (arriba por defecto o a un costado para no empalmarse)
export function computeSelectionBarPlacement(
  selectedObjects: CanvasObject[],
  selectionScreenRect: SelectionScreenRect,
  stageSize: { width: number; height: number },
  estMenuH: number,
  menuW = 246
): SelectionBarPlacement {
  const pad = 10;
  const stageW = Math.max(320, stageSize.width || 800);
  const stageH = Math.max(240, stageSize.height || 600);

  if (selectionNeedsSideBar(selectedObjects)) {
    const sideBarW = 46;
    const sideBarH = 224;
    const hasUnlockedTable = selectedObjects.some(
      (o) => o.type === 'table' && !o.locked
    );
    const rightGap = 14;
    // Dejar margen extra a la izquierda si la tabla muestra su asidero (-left-6)
    const leftGap = hasUnlockedTable ? 30 : 14;

    const rightCandidate = Math.round(selectionScreenRect.right + rightGap);
    const leftCandidate = Math.round(selectionScreenRect.left - sideBarW - leftGap);
    const fitsRight = rightCandidate + sideBarW <= stageW - pad;
    const fitsLeft = leftCandidate >= pad;

    let mode: 'side-right' | 'side-left' = 'side-right';
    let barLeft = rightCandidate;

    if (fitsRight) {
      mode = 'side-right';
      barLeft = rightCandidate;
    } else if (fitsLeft) {
      mode = 'side-left';
      barLeft = leftCandidate;
    } else {
      const spaceRight = stageW - selectionScreenRect.right;
      const spaceLeft = selectionScreenRect.left;
      if (spaceLeft > spaceRight) {
        mode = 'side-left';
        barLeft = pad;
      } else {
        mode = 'side-right';
        barLeft = Math.max(pad, stageW - sideBarW - pad);
      }
    }

    const barTop = Math.max(
      pad,
      Math.min(Math.round(selectionScreenRect.top), Math.max(pad, stageH - sideBarH - pad))
    );

    const canMenuGoRight = barLeft + sideBarW + 8 + menuW <= stageW - 8;
    const canMenuGoLeft = barLeft - 8 - menuW >= 8;
    let menuLeft: number;
    if (mode === 'side-right') {
      menuLeft = canMenuGoRight
        ? barLeft + sideBarW + 8
        : Math.max(8, barLeft - menuW - 8);
    } else {
      menuLeft = canMenuGoLeft
        ? barLeft - menuW - 8
        : Math.min(Math.max(8, stageW - menuW - 8), barLeft + sideBarW + 8);
    }

    const menuTop = Math.max(
      8,
      Math.min(barTop, Math.max(8, stageH - estMenuH - 8))
    );
    const subFlipLeft = menuLeft + menuW + 225 > stageW - 8;
    const subAlignBottom = menuTop + estMenuH > stageH * 0.72;

    return {
      mode,
      barLeft,
      barTop,
      menuLeft,
      menuTop,
      subFlipLeft,
      subAlignBottom,
    };
  }

  const barEstW = 248;
  const barH = 36;
  const selCenterX = (selectionScreenRect.left + selectionScreenRect.right) / 2;
  let barLeft = Math.round(selCenterX - barEstW / 2);
  barLeft = Math.max(pad, Math.min(barLeft, Math.max(pad, stageW - barEstW - pad)));

  let barTop = Math.round(selectionScreenRect.top - barH - 12);
  if (barTop < 10) {
    barTop = Math.round(selectionScreenRect.bottom + 12);
  }
  barTop = Math.max(pad, Math.min(barTop, Math.max(pad, stageH - barH - pad)));

  const menuLeft = Math.max(8, Math.min(barLeft, Math.max(8, stageW - menuW - 8)));
  const openUp =
    barTop + barH + 8 + estMenuH > stageH - 8 && barTop > estMenuH * 0.6;
  const menuTop = openUp
    ? Math.max(8, barTop - estMenuH - 6)
    : Math.min(barTop + barH + 6, Math.max(8, stageH - estMenuH - 8));

  const subFlipLeft = menuLeft + menuW + 225 > stageW - 8;
  const subAlignBottom = menuTop + estMenuH > stageH * 0.72;

  return {
    mode: 'top',
    barLeft,
    barTop,
    menuLeft,
    menuTop,
    subFlipLeft,
    subAlignBottom,
  };
}

// OPT: 2.6 — Memoriza menús contextuales para evitar trabajo cuando la selección/estado está oculto
export const CanvasContextMenu: React.FC<CanvasContextMenuProps> = React.memo(({
  selectedObjects,
  elementMenuAnchor,
  onCloseElementMenu,
  stageSize,
  hidden,
  backgroundPattern,
  showCoordinates,
  snapToGrid,
  cadConfig,
  leftCollapsed,
  rightCollapsed,
  bottomBarsCollapsed,
  autoTransparentPanels,
  cleanWorkMode,
  canPaste = false,
  actions,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [quickMenuPos, setQuickMenuPos] = useState<QuickMenuPos>(() => {
    // Por defecto arriba a la izquierda para no empalmarse con los menús de inserción inferiores
    try {
      const raw = localStorage.getItem(QUICK_MENU_POS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<QuickMenuPos>;
        if (
          typeof parsed.x === 'number' &&
          Number.isFinite(parsed.x) &&
          typeof parsed.y === 'number' &&
          Number.isFinite(parsed.y)
        ) {
          return { x: parsed.x, y: parsed.y };
        }
      }
    } catch {
      // Ignorar errores de lectura de almacenamiento local
    }
    return { x: 14, y: 14 };
  });
  const [isDraggingTrigger, setIsDraggingTrigger] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const quickTriggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const dragJustEndedRef = useRef(false);

  const selectionSignature = useMemo(
    () => selectedObjects.map((o) => o.id).join(','),
    [selectedObjects]
  );

  // Close open menus automatically when selection changes or menu is hidden
  useEffect(() => {
    setMenuOpen(false);
    setActiveSubmenu(null);
  }, [selectionSignature, hidden]);

  useEffect(() => {
    setActiveSubmenu(null);
  }, [elementMenuAnchor]);

  const isElementContextOpen = selectedObjects.length > 0 && Boolean(elementMenuAnchor);

  // Outside pointerdown & Escape close
  useEffect(() => {
    if (!menuOpen && !isElementContextOpen) return;
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setActiveSubmenu(null);
        onCloseElementMenu?.();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setActiveSubmenu(null);
        onCloseElementMenu?.();
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menuOpen, isElementContextOpen, onCloseElementMenu]);

  const caps = useMemo(
    () => getSelectionContextCapabilities(selectedObjects),
    [selectedObjects]
  );

  if (hidden) return null;

  const closeMenu = () => {
    setMenuOpen(false);
    setActiveSubmenu(null);
    onCloseElementMenu?.();
  };

  const runAction = (fn: () => void) => {
    closeMenu();
    fn();
  };

  const itemBtnCls =
    'w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-3 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap';
  const submenuRowCls = (key: string) =>
    `w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-3 rounded-md transition-colors whitespace-nowrap ${
      activeSubmenu === key
        ? 'theme-accent-soft font-medium'
        : 'hover:bg-black/5 dark:hover:bg-white/10'
    }`;

  const renderSubmenu = (
    key: string,
    flipLeft: boolean,
    alignBottom: boolean,
    content: React.ReactNode
  ) => {
    if (activeSubmenu !== key) return null;
    return (
      <div
        data-scrollable-content="true"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ overscrollBehavior: 'contain' }}
        className={`absolute ${
          flipLeft ? 'right-full mr-1.5' : 'left-full ml-1.5'
        } ${
          alignBottom ? 'bottom-0' : 'top-0'
        } min-w-[205px] max-w-[248px] max-h-[calc(100vh-6rem)] overflow-y-auto panel-scroll overscroll-contain p-1.5 rounded-xl border theme-surface shadow-xl backdrop-blur-md z-50`}
      >
        {content}
      </div>
    );
  };

  // =====================================================================
  // MODE A: ELEMENTO(S) SELECCIONADO(S) -> Menú contextual ÚNICAMENTE con clic derecho
  // =====================================================================
  if (selectedObjects.length > 0) {
    if (!elementMenuAnchor) return null;

    const menuW = 246;
    const estMenuH = caps.isMultiple ? 410 : 350;
    const pad = 8;
    const stageW = Math.max(320, stageSize.width || 800);
    const stageH = Math.max(240, stageSize.height || 600);
    const menuLeft = Math.max(
      pad,
      Math.min(Math.round(elementMenuAnchor.x), Math.max(pad, stageW - menuW - pad))
    );
    const menuTop = Math.max(
      pad,
      Math.min(Math.round(elementMenuAnchor.y), Math.max(pad, stageH - estMenuH - pad))
    );
    const subFlipLeft = menuLeft + menuW + 225 > stageW - pad;
    const subAlignBottom = menuTop + estMenuH > stageH * 0.72;

    return (
      <div
        ref={rootRef}
        data-export-ignore="true"
        onContextMenu={(e) => e.preventDefault()}
        className="no-print absolute inset-0 pointer-events-none z-40"
      >
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{ left: menuLeft, top: menuTop, width: menuW }}
          className="pointer-events-auto absolute p-1.5 rounded-xl border theme-surface shadow-2xl backdrop-blur-md select-none space-y-0.5"
        >
            {/* Group / Ungroup */}
            {caps.canGroup && (
              <button
                type="button"
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => runAction(actions.onGroup)}
                title="Agrupar los elementos seleccionados como una unidad"
                className={itemBtnCls}
              >
                <span className="flex items-center gap-2">
                  <Group className="w-3.5 h-3.5 text-blue-600" />
                  <span>Agrupar</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">AGR</span>
              </button>
            )}
            {caps.canUngroup && (
              <button
                type="button"
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => runAction(actions.onUngroup)}
                title="Separar los elementos del grupo"
                className={itemBtnCls}
              >
                <span className="flex items-center gap-2">
                  <Ungroup className="w-3.5 h-3.5 text-amber-600" />
                  <span>Desagrupar</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">DES</span>
              </button>
            )}
            {(caps.canGroup || caps.canUngroup) && (
              <div className="my-1 border-t theme-border" />
            )}

            {/* Clipboard & Delete */}
            <button
              type="button"
              onMouseEnter={() => setActiveSubmenu(null)}
              onClick={() => runAction(actions.onCopy)}
              title="Copiar al portapapeles"
              className={itemBtnCls}
            >
              <span className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 opacity-75" />
                <span>Copiar</span>
              </span>
              <span className="text-[10px] text-slate-400">Ctrl+C</span>
            </button>
            <button
              type="button"
              onMouseEnter={() => setActiveSubmenu(null)}
              onClick={() => runAction(actions.onDuplicate)}
              title="Duplicar selección"
              className={itemBtnCls}
            >
              <span className="flex items-center gap-2">
                <CopyPlus className="w-3.5 h-3.5 opacity-75" />
                <span>Duplicar</span>
              </span>
              <span className="text-[10px] text-slate-400">Ctrl+D</span>
            </button>
            <button
              type="button"
              onMouseEnter={() => setActiveSubmenu(null)}
              onClick={() => runAction(actions.onCut)}
              title="Cortar selección"
              className={itemBtnCls}
            >
              <span className="flex items-center gap-2">
                <Scissors className="w-3.5 h-3.5 opacity-75" />
                <span>Cortar</span>
              </span>
              <span className="text-[10px] text-slate-400">Ctrl+X</span>
            </button>
            {canPaste && actions.onPaste && (
              <button
                type="button"
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => runAction(() => actions.onPaste?.())}
                title="Pegar aquí"
                className={itemBtnCls}
              >
                <span className="flex items-center gap-2">
                  <ClipboardPaste className="w-3.5 h-3.5 opacity-75" />
                  <span>Pegar aquí</span>
                </span>
                <span className="text-[10px] text-slate-400">Ctrl+V</span>
              </button>
            )}
            <button
              type="button"
              onMouseEnter={() => setActiveSubmenu(null)}
              onClick={() => runAction(actions.onDelete)}
              title="Eliminar objetos seleccionados"
              className="w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-3 rounded-md hover:bg-red-50 dark:hover:bg-red-950/60 text-red-600 dark:text-red-400 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar</span>
              </span>
              <span className="text-[10px] opacity-70">Supr</span>
            </button>

            <div className="my-1 border-t theme-border" />

            {/* Multi-object Alignment & Distribution */}
            {caps.isMultiple && caps.canAlign && (
              <>
                <div
                  className="relative"
                  onMouseEnter={() => setActiveSubmenu('align-h')}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setActiveSubmenu((cur) => (cur === 'align-h' ? null : 'align-h'))
                    }
                    className={submenuRowCls('align-h')}
                  >
                    <span className="flex items-center gap-2">
                      <AlignCenterHorizontal className="w-3.5 h-3.5 opacity-75" />
                      <span>Alinear horizontalmente</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  </button>
                  {renderSubmenu(
                    'align-h',
                    subFlipLeft,
                    subAlignBottom,
                    <div className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => runAction(() => actions.onAlign('left'))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2">
                          <AlignStartVertical className="w-3.5 h-3.5" />
                          <span>Borde izquierdo</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(() => actions.onAlign('center-h'))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2">
                          <AlignCenterVertical className="w-3.5 h-3.5" />
                          <span>Centro horizontal</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(() => actions.onAlign('right'))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2">
                          <AlignEndVertical className="w-3.5 h-3.5" />
                          <span>Borde derecho</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className="relative"
                  onMouseEnter={() => setActiveSubmenu('align-v')}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setActiveSubmenu((cur) => (cur === 'align-v' ? null : 'align-v'))
                    }
                    className={submenuRowCls('align-v')}
                  >
                    <span className="flex items-center gap-2">
                      <AlignCenterVertical className="w-3.5 h-3.5 opacity-75" />
                      <span>Alinear verticalmente</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  </button>
                  {renderSubmenu(
                    'align-v',
                    subFlipLeft,
                    subAlignBottom,
                    <div className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => runAction(() => actions.onAlign('top'))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2">
                          <AlignStartHorizontal className="w-3.5 h-3.5" />
                          <span>Borde superior</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(() => actions.onAlign('center-v'))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2">
                          <AlignCenterHorizontal className="w-3.5 h-3.5" />
                          <span>Centro vertical</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(() => actions.onAlign('bottom'))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2">
                          <AlignEndHorizontal className="w-3.5 h-3.5" />
                          <span>Borde inferior</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {caps.isMultiple && caps.canDistribute && (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('distribute')}
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveSubmenu((cur) => (cur === 'distribute' ? null : 'distribute'))
                  }
                  className={submenuRowCls('distribute')}
                >
                  <span className="flex items-center gap-2">
                    <LayoutGrid className="w-3.5 h-3.5 opacity-75" />
                    <span>Distribuir uniformemente</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                {renderSubmenu(
                  'distribute',
                  subFlipLeft,
                  subAlignBottom,
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onDistribute('horizontal'))}
                      className={itemBtnCls}
                    >
                      <span>Espaciado horizontal</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onDistribute('vertical'))}
                      className={itemBtnCls}
                    >
                      <span>Espaciado vertical</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Rotate, Mirror, Matrix, Dimension */}
            {caps.canRotate && (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('rotate')}
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveSubmenu((cur) => (cur === 'rotate' ? null : 'rotate'))
                  }
                  className={submenuRowCls('rotate')}
                >
                  <span className="flex items-center gap-2">
                    <RotateCw className="w-3.5 h-3.5 opacity-75" />
                    <span>Girar</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                {renderSubmenu(
                  'rotate',
                  subFlipLeft,
                  subAlignBottom,
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onRotateBy(90))}
                      className={itemBtnCls}
                    >
                      <span>Girar +90° (horario)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onRotateBy(-90))}
                      className={itemBtnCls}
                    >
                      <span>Girar -90° (antihorario)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onRotateBy(15))}
                      className={itemBtnCls}
                    >
                      <span>Girar +15°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onRotateBy(-15))}
                      className={itemBtnCls}
                    >
                      <span>Girar -15°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onRotateBy(180))}
                      className={itemBtnCls}
                    >
                      <span>Girar 180°</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {caps.canMirror && (
              <button
                type="button"
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => runAction(() => actions.onStartCadCommand('mirror'))}
                title="Reflejar la selección respecto a un eje"
                className={itemBtnCls}
              >
                <span className="flex items-center gap-2">
                  <FlipHorizontal2 className="w-3.5 h-3.5 opacity-75" />
                  <span>Simetría</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">SIM</span>
              </button>
            )}

            {caps.isMultiple && caps.canArray && (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('array')}
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveSubmenu((cur) => (cur === 'array' ? null : 'array'))
                  }
                  className={submenuRowCls('array')}
                >
                  <span className="flex items-center gap-2">
                    <LayoutGrid className="w-3.5 h-3.5 opacity-75" />
                    <span>Matriz</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                {renderSubmenu(
                  'array',
                  subFlipLeft,
                  subAlignBottom,
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('array-rect'))}
                      className={itemBtnCls}
                    >
                      <span>Matriz rectangular</span>
                      <span className="text-[10px] text-slate-400 font-mono">MR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('array-polar'))}
                      className={itemBtnCls}
                    >
                      <span>Matriz polar</span>
                      <span className="text-[10px] text-slate-400 font-mono">MP</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('array-path'))}
                      className={itemBtnCls}
                    >
                      <span>Matriz de camino</span>
                      <span className="text-[10px] text-slate-400 font-mono">MC</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {caps.canDimension && (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('dimension')}
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveSubmenu((cur) => (cur === 'dimension' ? null : 'dimension'))
                  }
                  className={submenuRowCls('dimension')}
                >
                  <span className="flex items-center gap-2">
                    <Ruler className="w-3.5 h-3.5 opacity-75" />
                    <span>Acotar</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                {renderSubmenu(
                  'dimension',
                  subFlipLeft,
                  subAlignBottom,
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('dim-linear'))}
                      className={itemBtnCls}
                    >
                      <span>Cota lineal</span>
                      <span className="text-[10px] text-slate-400 font-mono">ACL</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('dim-aligned'))}
                      className={itemBtnCls}
                    >
                      <span>Cota alineada</span>
                      <span className="text-[10px] text-slate-400 font-mono">ACA</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('dim-angular'))}
                      className={itemBtnCls}
                    >
                      <span>Cota angular</span>
                      <span className="text-[10px] text-slate-400 font-mono">ANG</span>
                    </button>
                    {caps.canRadialDim && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() => actions.onStartCadCommand('dim-radial'))
                          }
                          className={itemBtnCls}
                        >
                          <span>Cota radial</span>
                          <span className="text-[10px] text-slate-400 font-mono">RAD</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() => actions.onStartCadCommand('dim-diametral'))
                          }
                          className={itemBtnCls}
                        >
                          <span>Cota diametral</span>
                          <span className="text-[10px] text-slate-400 font-mono">DIA</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onStartCadCommand('dim-ordinate'))}
                      className={itemBtnCls}
                    >
                      <span>Por coordenadas</span>
                      <span className="text-[10px] text-slate-400 font-mono">COR</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Compatible Geometric Elements (Example C) */}
            {caps.isCompatibleGeometryPair && (
              <>
                <div className="my-1 border-t theme-border" />
                <div className="px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Operaciones geométricas
                </div>

                {caps.canJoinSegments && (
                  <button
                    type="button"
                    onMouseEnter={() => setActiveSubmenu(null)}
                    onClick={() => runAction(actions.onJoinSegments)}
                    title="Unir segmentos contiguos dentro de la tolerancia"
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Link2 className="w-3.5 h-3.5 text-blue-600" />
                      <span>Unir segmentos</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">UNI</span>
                  </button>
                )}

                {caps.canMatchPoints && (
                  <button
                    type="button"
                    onMouseEnter={() => setActiveSubmenu(null)}
                    onClick={() => runAction(() => actions.onStartCadCommand('match-points'))}
                    title="Hacer coincidir exactamente un punto de referencia con otro"
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Crosshair className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Hacer coincidir puntos</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">CP</span>
                  </button>
                )}

                {caps.canCreatePolyline && (
                  <button
                    type="button"
                    onMouseEnter={() => setActiveSubmenu(null)}
                    onClick={() => runAction(actions.onCreatePolylineFromSelection)}
                    title="Convertir los segmentos seleccionados en una polilínea continua"
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Spline className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Crear polilínea</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">PL</span>
                  </button>
                )}

                {caps.canAlignEndpoints && (
                  <div
                    className="relative"
                    onMouseEnter={() => setActiveSubmenu('align-endpoints')}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setActiveSubmenu((cur) =>
                          cur === 'align-endpoints' ? null : 'align-endpoints'
                        )
                      }
                      className={submenuRowCls('align-endpoints')}
                    >
                      <span className="flex items-center gap-2">
                        <Compass className="w-3.5 h-3.5 opacity-75" />
                        <span>Alinear extremos</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                    </button>
                    {renderSubmenu(
                      'align-endpoints',
                      subFlipLeft,
                      true,
                      <div className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => runAction(() => actions.onAlignEndpoints('start-x'))}
                          className={itemBtnCls}
                        >
                          <span>Extremos iniciales en X</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => runAction(() => actions.onAlignEndpoints('end-x'))}
                          className={itemBtnCls}
                        >
                          <span>Extremos finales en X</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => runAction(() => actions.onAlignEndpoints('start-y'))}
                          className={itemBtnCls}
                        >
                          <span>Extremos iniciales en Y</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => runAction(() => actions.onAlignEndpoints('end-y'))}
                          className={itemBtnCls}
                        >
                          <span>Extremos finales en Y</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="my-1 border-t theme-border" />

            {/* Properties, Color, Stroke Width, Lock */}
            <button
              type="button"
              onMouseEnter={() => setActiveSubmenu(null)}
              onClick={() => runAction(() => actions.onOpenInspectorTab('props'))}
              title="Abrir panel de propiedades del objeto"
              className={itemBtnCls}
            >
              <span className="flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 opacity-75" />
                <span>
                  {caps.isMultiple ? 'Cambiar propiedades comunes' : 'Cambiar propiedades'}
                </span>
              </span>
            </button>

            {caps.canStyleColor && (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('color')}
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveSubmenu((cur) => (cur === 'color' ? null : 'color'))
                  }
                  className={submenuRowCls('color')}
                >
                  <span className="flex items-center gap-2">
                    <Palette className="w-3.5 h-3.5 opacity-75" />
                    <span>{caps.isMultiple ? 'Cambiar color común' : 'Cambiar color'}</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                {renderSubmenu(
                  'color',
                  subFlipLeft,
                  true,
                  <div className="p-1.5">
                    <div className="text-[10px] font-semibold text-slate-500 mb-1.5 px-0.5">
                      Color rápido
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {QUICK_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => runAction(() => actions.onSetCommonColor(c))}
                          title={`Aplicar color ${c}`}
                          style={{ backgroundColor: c }}
                          className="w-7 h-7 rounded-md border border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform shadow-xs"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {caps.canStyleStrokeWidth && (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('width')}
              >
                <button
                  type="button"
                  onClick={() =>
                    setActiveSubmenu((cur) => (cur === 'width' ? null : 'width'))
                  }
                  className={submenuRowCls('width')}
                >
                  <span className="flex items-center gap-2">
                    <Minus className="w-3.5 h-3.5 opacity-75" />
                    <span>{caps.isMultiple ? 'Cambiar grosor común' : 'Cambiar grosor'}</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>
                {renderSubmenu(
                  'width',
                  subFlipLeft,
                  true,
                  <div className="space-y-0.5">
                    {QUICK_WIDTHS.map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => runAction(() => actions.onSetCommonStrokeWidth(w))}
                        className={itemBtnCls}
                      >
                        <span className="flex items-center gap-2.5 flex-1">
                          <span className="w-10 flex items-center">
                            <span
                              className="w-full rounded-full bg-slate-800 dark:bg-slate-200 block"
                              style={{ height: Math.max(1, w) }}
                            />
                          </span>
                          <span>{w} px</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onMouseEnter={() => setActiveSubmenu(null)}
              onClick={() => runAction(() => actions.onToggleLockSelection(!caps.allLocked))}
              title={caps.allLocked ? 'Permitir edición de la selección' : 'Bloquear posición y edición'}
              className={itemBtnCls}
            >
              <span className="flex items-center gap-2">
                {caps.allLocked ? (
                  <Unlock className="w-3.5 h-3.5 opacity-75" />
                ) : (
                  <Lock className="w-3.5 h-3.5 opacity-75" />
                )}
                <span>{caps.allLocked ? 'Desbloquear' : 'Bloquear'}</span>
              </span>
            </button>
          </div>
      </div>
    );
  }

  // =====================================================================
  // MODE B: NO SELECTION -> Menú rápido movible y adaptable al cuadrante
  // =====================================================================
  const gridVisible = backgroundPattern !== 'blank';
  const boardMenuW = 220;
  const triggerRect = quickTriggerBtnRef.current?.getBoundingClientRect();
  const triggerSize = {
    width: triggerRect?.width || 148,
    height: triggerRect?.height || 34,
  };
  const quickPlacement = computeQuickMenuPlacement(
    quickMenuPos,
    stageSize,
    triggerSize,
    boardMenuW
  );
  const { subFlipLeft, subAlignBottom } = quickPlacement;

  const handleQuickTriggerPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const rect = quickTriggerBtnRef.current?.getBoundingClientRect();
    const trigW = rect?.width || triggerSize.width;
    const trigH = rect?.height || triggerSize.height;
    const startLeft = quickPlacement.left;
    const startTop = quickPlacement.top;
    let moved = false;
    let latestPos: QuickMenuPos = { x: startLeft, y: startTop };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (!moved && Math.hypot(dx, dy) >= 5) {
        moved = true;
        setIsDraggingTrigger(true);
        setMenuOpen(false);
        setActiveSubmenu(null);
      }
      if (moved) {
        const maxX = Math.max(8, stageSize.width - trigW - 8);
        const maxY = Math.max(8, stageSize.height - trigH - 8);
        latestPos = {
          x: Math.max(8, Math.min(Math.round(startLeft + dx), maxX)),
          y: Math.max(8, Math.min(Math.round(startTop + dy), maxY)),
        };
        setQuickMenuPos(latestPos);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (moved) {
        dragJustEndedRef.current = true;
        setIsDraggingTrigger(false);
        try {
          localStorage.setItem(QUICK_MENU_POS_STORAGE_KEY, JSON.stringify(latestPos));
        } catch {
          // Ignorar errores al guardar posición en almacenamiento local
        }
        requestAnimationFrame(() => {
          dragJustEndedRef.current = false;
        });
      }
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  return (
    <div
      ref={rootRef}
      data-export-ignore="true"
      className="no-print absolute inset-0 pointer-events-none z-30"
    >
      {/* Disparador desplazable del menú contextual rápido */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ left: quickPlacement.left, top: quickPlacement.top }}
        className="pointer-events-auto absolute select-none"
      >
        <button
          ref={quickTriggerBtnRef}
          type="button"
          onPointerDown={handleQuickTriggerPointerDown}
          onClick={() => {
            if (dragJustEndedRef.current) {
              dragJustEndedRef.current = false;
              return;
            }
            setMenuOpen((v) => !v);
            setActiveSubmenu(null);
          }}
          title="Clic para abrir menú rápido · Arrastra para mover de lugar"
          aria-expanded={menuOpen}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium shadow-md backdrop-blur-md transition-colors ${
            isDraggingTrigger ? 'cursor-grabbing opacity-90' : 'cursor-grab'
          } ${
            menuOpen
              ? 'theme-accent-btn border-transparent'
              : 'theme-surface hover:brightness-95'
          }`}
        >
          <GripVertical className="w-3 h-3 opacity-45 shrink-0" />
          <Menu className="w-3.5 h-3.5 shrink-0" />
          <span>Menú rápido</span>
          <ChevronDown className={`w-3 h-3 transition-transform shrink-0 ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{ width: boardMenuW }}
            className={`absolute ${
              quickPlacement.openUp ? 'bottom-full mb-2' : 'top-full mt-2'
            } ${
              quickPlacement.menuAlignRight ? 'right-0' : 'left-0'
            } p-1.5 rounded-xl border theme-surface shadow-2xl backdrop-blur-md space-y-0.5`}
          >
            {canPaste && actions.onPaste && (
              <>
                <button
                  type="button"
                  onMouseEnter={() => setActiveSubmenu(null)}
                  onClick={() => runAction(() => actions.onPaste?.())}
                  className={itemBtnCls}
                >
                  <span className="flex items-center gap-2">
                    <ClipboardPaste className="w-3.5 h-3.5 opacity-75" />
                    <span>Pegar aquí</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Ctrl+V</span>
                </button>
                <div className="my-1 border-t theme-border" />
              </>
            )}
            {/* 1. Dibujo */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-draw')}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveSubmenu((c) => (c === 'board-draw' ? null : 'board-draw'))
                }
                className={submenuRowCls('board-draw')}
              >
                <span className="flex items-center gap-2">
                  <PenTool className="w-3.5 h-3.5 opacity-75" />
                  <span>Dibujo</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
              {renderSubmenu(
                'board-draw',
                subFlipLeft,
                subAlignBottom,
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('line'))}
                    className={itemBtnCls}
                  >
                    <span>Línea</span>
                    <span className="text-[10px] text-slate-400 font-mono">LIN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('pline'))}
                    className={itemBtnCls}
                  >
                    <span>Polilínea</span>
                    <span className="text-[10px] text-slate-400 font-mono">PL</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('rectangle'))}
                    className={itemBtnCls}
                  >
                    <span>Rectángulo</span>
                    <span className="text-[10px] text-slate-400 font-mono">REC</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('circle'))}
                    className={itemBtnCls}
                  >
                    <span>Círculo</span>
                    <span className="text-[10px] text-slate-400 font-mono">CIR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('arc'))}
                    className={itemBtnCls}
                  >
                    <span>Arco</span>
                    <span className="text-[10px] text-slate-400 font-mono">ARC</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('polygon'))}
                    className={itemBtnCls}
                  >
                    <span>Polígono</span>
                    <span className="text-[10px] text-slate-400 font-mono">POL</span>
                  </button>
                </div>
              )}
            </div>

            {/* 2. Inserción */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-insert')}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveSubmenu((c) => (c === 'board-insert' ? null : 'board-insert'))
                }
                className={submenuRowCls('board-insert')}
              >
                <span className="flex items-center gap-2">
                  <PlusSquare className="w-3.5 h-3.5 opacity-75" />
                  <span>Inserción</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
              {renderSubmenu(
                'board-insert',
                subFlipLeft,
                subAlignBottom,
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => runAction(actions.onInsertText)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Type className="w-3.5 h-3.5 opacity-75" />
                      <span>Texto</span>
                    </span>
                    <span className="text-[10px] text-slate-400">T</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onInsertSticky)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <StickyNote className="w-3.5 h-3.5 opacity-75" />
                      <span>Nota rápida</span>
                    </span>
                    <span className="text-[10px] text-slate-400">N</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onImportExternalFile)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <FileUp className="w-3.5 h-3.5 opacity-75" />
                      <span>Imagen / Archivo...</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onInsertEquation)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Sigma className="w-3.5 h-3.5 opacity-75" />
                      <span>Ecuación</span>
                    </span>
                    <span className="text-[10px] text-slate-400">M</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onInsertGraph)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <LineChart className="w-3.5 h-3.5 opacity-75" />
                      <span>Gráfica</span>
                    </span>
                    <span className="text-[10px] text-slate-400">G</span>
                  </button>
                  {actions.onInsertTable && (
                    <button
                      type="button"
                      onClick={() => runAction(() => actions.onInsertTable?.(3, 3))}
                      className={itemBtnCls}
                    >
                      <span className="flex items-center gap-2">
                        <Table2 className="w-3.5 h-3.5 opacity-75" />
                        <span>Tabla (3×3)</span>
                      </span>
                    </button>
                  )}
                  <div className="my-1 border-t theme-border" />
                  <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Shapes className="w-3 h-3" />
                    <span>Elementos geométricos</span>
                  </div>
                  <div className="grid grid-cols-2 gap-0.5 px-1">
                    {GEOMETRIC_INSERT_ITEMS.map((g) => (
                      <button
                        key={g.kind}
                        type="button"
                        onClick={() => runAction(() => actions.onSelectShapeAndDraw(g.kind))}
                        className="px-2 py-1 text-left text-[11px] rounded hover:bg-black/5 dark:hover:bg-white/10 truncate"
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Herramientas */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-tools')}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveSubmenu((c) => (c === 'board-tools' ? null : 'board-tools'))
                }
                className={submenuRowCls('board-tools')}
              >
                <span className="flex items-center gap-2">
                  <Wrench className="w-3.5 h-3.5 opacity-75" />
                  <span>Herramientas</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
              {renderSubmenu(
                'board-tools',
                subFlipLeft,
                subAlignBottom,
                <div className="space-y-0.5">
                  <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Acotación
                  </div>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('dim-linear'))}
                    className={itemBtnCls}
                  >
                    <span>Cota lineal</span>
                    <span className="text-[10px] text-slate-400 font-mono">ACL</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('dim-aligned'))}
                    className={itemBtnCls}
                  >
                    <span>Cota alineada</span>
                    <span className="text-[10px] text-slate-400 font-mono">ACA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('dim-angular'))}
                    className={itemBtnCls}
                  >
                    <span>Cota angular</span>
                    <span className="text-[10px] text-slate-400 font-mono">ANG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('dim-radial'))}
                    className={itemBtnCls}
                  >
                    <span>Cota radial</span>
                    <span className="text-[10px] text-slate-400 font-mono">RAD</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('dim-diametral'))}
                    className={itemBtnCls}
                  >
                    <span>Cota diametral</span>
                    <span className="text-[10px] text-slate-400 font-mono">DIA</span>
                  </button>
                  <div className="my-1 border-t theme-border" />
                  <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Transformación y medición
                  </div>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('array-rect'))}
                    className={itemBtnCls}
                  >
                    <span>Matriz rectangular</span>
                    <span className="text-[10px] text-slate-400 font-mono">MR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('array-polar'))}
                    className={itemBtnCls}
                  >
                    <span>Matriz polar</span>
                    <span className="text-[10px] text-slate-400 font-mono">MP</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('mirror'))}
                    className={itemBtnCls}
                  >
                    <span>Simetría</span>
                    <span className="text-[10px] text-slate-400 font-mono">SIM</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('dim-aligned'))}
                    title="Medir distancia precisa entre dos puntos"
                    className={itemBtnCls}
                  >
                    <span>Medición de distancia</span>
                    <span className="text-[10px] text-slate-400 font-mono">MED</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onStartCadCommand('match-points'))}
                    className={itemBtnCls}
                  >
                    <span>Hacer coincidir puntos</span>
                    <span className="text-[10px] text-slate-400 font-mono">CP</span>
                  </button>
                </div>
              )}
            </div>

            {/* 4. Visualización */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-view')}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveSubmenu((c) => (c === 'board-view' ? null : 'board-view'))
                }
                className={submenuRowCls('board-view')}
              >
                <span className="flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5 opacity-75" />
                  <span>Visualización</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
              {renderSubmenu(
                'board-view',
                subFlipLeft,
                subAlignBottom,
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleGridVisible)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Grid3X3 className="w-3.5 h-3.5 opacity-75" />
                      <span>Cuadrícula</span>
                    </span>
                    {gridVisible && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleSnapToGrid)}
                    className={itemBtnCls}
                  >
                    <span>Ajuste a cuadrícula</span>
                    {snapToGrid && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleOsnap)}
                    className={itemBtnCls}
                  >
                    <span>Referencias geométricas</span>
                    {cadConfig.osnapEnabled && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleCoordinates)}
                    className={itemBtnCls}
                  >
                    <span>Sistema de coordenadas</span>
                    {showCoordinates && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <div className="my-1 border-t theme-border" />
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleOrtho)}
                    className={itemBtnCls}
                  >
                    <span>Modo ortogonal (ORT)</span>
                    {cadConfig.ortho && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onTogglePolar)}
                    className={itemBtnCls}
                  >
                    <span>Seguimiento polar (SP)</span>
                    {cadConfig.polar && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                </div>
              )}
            </div>

            {/* 5. Tablero */}
            <div
              className="relative"
              onMouseEnter={() => setActiveSubmenu('board-settings')}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveSubmenu((c) => (c === 'board-settings' ? null : 'board-settings'))
                }
                className={submenuRowCls('board-settings')}
              >
                <span className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 opacity-75" />
                  <span>Tablero</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              </button>
              {renderSubmenu(
                'board-settings',
                subFlipLeft,
                subAlignBottom,
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onOpenInspectorTab('props'))}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Sliders className="w-3.5 h-3.5 opacity-75" />
                      <span>Propiedades</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(() => actions.onOpenInspectorTab('layers'))}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 opacity-75" />
                      <span>Capas</span>
                    </span>
                  </button>
                  <div className="my-1 border-t theme-border" />
                  <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Ajustes de visualización
                  </div>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleLeftPanel)}
                    className={itemBtnCls}
                  >
                    <span>Barra lateral izquierda</span>
                    {!leftCollapsed && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleRightPanel)}
                    className={itemBtnCls}
                  >
                    <span>Panel de propiedades</span>
                    {!rightCollapsed && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleBottomBars)}
                    className={itemBtnCls}
                  >
                    <span>Barras inferiores</span>
                    {!bottomBarsCollapsed && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleAutoTransparentPanels)}
                    className={itemBtnCls}
                  >
                    <span>Transparencia automática</span>
                    {autoTransparentPanels && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => runAction(actions.onToggleCleanWorkMode)}
                    className={itemBtnCls}
                  >
                    <span>Modo limpio (Ctrl+.)</span>
                    {cleanWorkMode && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                  <div className="my-1 border-t theme-border" />
                  <button
                    type="button"
                    onClick={() => runAction(actions.onOpenSettings)}
                    className={itemBtnCls}
                  >
                    <span className="flex items-center gap-2">
                      <Settings className="w-3.5 h-3.5 opacity-75" />
                      <span>Configuración...</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

