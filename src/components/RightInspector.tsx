import React, { useState } from 'react';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bold,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Italic,
  Layers,
  List,
  ListOrdered,
  Lock,
  Plus,
  Sliders,
  Trash2,
  Underline,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type {
  AppSettings,
  BackgroundPattern,
  Board,
  BoardSizePreset,
  CanvasObject,
  DimensionObject,
  DocumentObject,
  EquationObject,
  GraphObject,
  GroupRecord,
  ImageObject,
  Layer,
  LineKind,
  LineObject,
  PageOrientation,
  ShapeObject,
  StickyObject,
  StrokeObject,
  StrokeStyle,
  TableObject,
  TextObject,
  ToolId,
  ToolOptions,
} from '../types/whiteboard';
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  addTableCol,
  addTableRow,
  normalizarTabla,
  removeTableCol,
  removeTableRow,
} from '../utils/tableUtils';
import type { CadDraftingConfig, CadLinearDimAxis } from '../types/cad';
import { computeDimensionMetrics } from '../utils/cad/cadDimensions';
import {
  ensureGroupsArray,
  getGroupMemberObjects,
  translateCanvasObject,
} from '../utils/cad/cadGroups';
import {
  getObjectsWorldBoundingBox,
  rotateCanvasObjectAroundPivot,
  scaleCanvasObjectInBox,
} from '../utils/cad/cadTransform';
import { TEXT_FONT_OPTIONS } from '../utils/textFonts';
import {
  BOARD_SIZE_PRESETS,
  MAX_FRAME_MARGIN_MM,
  MIN_FRAME_MARGIN_MM,
  clampCustomDimensionPx,
  getBoardSizeSummary,
  isFixedSizeBoard,
  normalizarAjustesHoja,
  resolveBoardDimensions,
} from '../utils/boardSizes';
import { CanvasColorPickerControl } from './CanvasColorPickerControl';
import { FontSizeInput } from './FontSizeInput';
import type { RichTextEditorHandle } from './RichTextEditor';
import type { SpellcheckLanguage, TextAlign } from '../types/whiteboard';
import {
  type SelectionStyleSummary,
  applyAlignToAllParagraphs,
  applyStyleToAllParagraphs,
  clampTextFontSize,
  createParagraphsFromPlainText,
  ensureTextParagraphs,
  formatFontSizeDisplay,
  getDefaultRunStyle,
  getSelectionStyleSummary,
  normalizarContenidoTexto,
  paragraphsToPlainText,
  resolveTextWidthMode,
  sanitizeStoredFontSize,
  stepFontSizeValue,
  syncTextObjectFromParagraphs,
} from '../utils/richText';
import { setRememberedTextLang } from '../utils/spellcheck/personalDictionary';

interface RightInspectorProps {
  board: Board;
  settings: AppSettings;
  cadConfig: CadDraftingConfig;
  activeTool: ToolId;
  toolOptions: ToolOptions;
  selectedObjects: CanvasObject[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onUpdateSettings: (next: AppSettings) => void;
  onUpdateToolOptions: (patch: Partial<ToolOptions>) => void;
  onUpdateBoardMeta: (patch: Partial<Board>) => void;
  onUpdateObjects: (ids: string[], updater: (obj: CanvasObject) => CanvasObject) => void;
  onSelectIds: (ids: string[]) => void;
  onStartEditingText: (id: string) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onGroupSelected: () => void;
  onUngroupSelected: () => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onDissolveGroup: (groupId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onAddSelectionToGroup: (groupId: string) => void;
  onRemoveFromGroup: (objectIds: string[]) => void;
  onZOrder: (action: 'front' | 'back' | 'forward' | 'backward') => void;
  onAlign: (axis: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') => void;
  onDistribute: (dir: 'horizontal' | 'vertical') => void;
  onOpenEquationEditor: (obj: EquationObject) => void;
  onStartEditingEquation: (id: string) => void;
  onOpenGraphEditor: (obj: GraphObject) => void;
  onLayerAdd: () => void;
  onLayerUpdate: (layerId: string, patch: Partial<Layer>) => void;
  onLayerDelete: (layerId: string) => void;
  onLayerSelect: (layerId: string) => void;
  onAssignToLayer: (layerId: string) => void;
  activeTab?: 'props' | 'layers' | 'arrange';
  onChangeTab?: (tab: 'props' | 'layers' | 'arrange') => void;
  editingTextId?: string | null;
  activeRichTextEditorRef?: React.RefObject<RichTextEditorHandle | null>;
  richTextSummary?: SelectionStyleSummary | null;
}

const COLOR_SWATCHES = [
  '#0f172a',
  '#2563eb',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0284c7',
  '#ffffff',
];

const STICKY_COLORS = [
  { name: 'Amarillo', bg: '#fef08a' },
  { name: 'Celeste', bg: '#bae6fd' },
  { name: 'Menta', bg: '#bbf7d0' },
  { name: 'Rosa', bg: '#fecdd3' },
  { name: 'Lavanda', bg: '#e9d5ff' },
  { name: 'Marfil', bg: '#f1f5f9' },
];

// OPT: 2.6 — Evita re-renderizar el inspector ante cambios ajenos (movimiento de cursor, zoom)
export const RightInspector: React.FC<RightInspectorProps> = React.memo((props) => {
  const [localTab, setLocalTab] = useState<'props' | 'layers' | 'arrange'>('props');
  const tab = props.activeTab ?? localTab;
  const setTab = (next: 'props' | 'layers' | 'arrange') => {
    setLocalTab(next);
    props.onChangeTab?.(next);
  };
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [layerNameDraft, setLayerNameDraft] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupRotInput, setGroupRotInput] = useState('15');
  const [marginDraft, setMarginDraft] = useState<string | null>(null);

  if (props.collapsed) {
    return (
      <div className="no-print w-7 theme-surface border-l flex flex-col items-center py-2 shrink-0 z-20">
        <button
          type="button"
          onClick={props.onToggleCollapse}
          title="Expandir panel derecho"
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-70"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const single = props.selectedObjects.length === 1 ? props.selectedObjects[0] : null;
  const groupBox =
    !single && props.selectedObjects.length > 1
      ? getObjectsWorldBoundingBox(props.selectedObjects)
      : null;
  const anyLocked = props.selectedObjects.some((o) => o.locked);
  const hasGroup = props.selectedObjects.some((o) => Boolean(o.groupId));
  const selectedIds = props.selectedObjects.map((o) => o.id);
  const unlockedSelectedIds = props.selectedObjects.filter((o) => !o.locked).map((o) => o.id);

  const objectTypeLabel = (obj: CanvasObject) => {
    switch (obj.type) {
      case 'stroke':
        return 'Trazo libre';
      case 'shape':
        return obj.shapeKind === 'custom-polygon'
          ? 'Figura (Polígono editado)'
          : `Figura (${obj.shapeKind})`;
      case 'line':
        return `Línea (${obj.lineKind})`;
      case 'text':
        return 'Cuadro de texto';
      case 'sticky':
        return 'Nota adhesiva';
      case 'equation':
        return 'Ecuación matemática';
      case 'graph':
        return 'Gráfica cartesiana';
      case 'image':
        return `Imagen: ${obj.name}`;
      case 'document':
        return `Documento ${obj.docKind.toUpperCase()}: ${obj.fileName}`;
      case 'dimension':
        return `Cota (${obj.dimKind})`;
      case 'table':
        return `Tabla (${obj.rows}×${obj.cols})`;
    }
  };

  return (
    <aside className="no-print w-72 theme-surface border-l flex flex-col shrink-0 z-20 select-none">
      {/* Header & Tabs */}
      <div className="px-2.5 py-2 border-b theme-border flex items-center justify-between gap-1">
        <div className="flex items-center gap-0.5 p-0.5 theme-surface-alt rounded-lg flex-1">
          <button
            type="button"
            onClick={() => setTab('props')}
            className={`flex-1 flex items-center justify-center gap-1 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
              tab === 'props'
                ? 'theme-surface shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            <Sliders className="w-3 h-3" />
            Propiedades
          </button>
          <button
            type="button"
            onClick={() => setTab('layers')}
            className={`flex-1 flex items-center justify-center gap-1 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
              tab === 'layers'
                ? 'theme-surface shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            <Layers className="w-3 h-3" />
            Capas
          </button>
          <button
            type="button"
            onClick={() => setTab('arrange')}
            className={`flex-1 flex items-center justify-center gap-1 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
              tab === 'arrange'
                ? 'theme-surface shadow-xs'
                : 'opacity-70 hover:opacity-100'
            }`}
          >
            Orden
          </button>
        </div>
        <button
          type="button"
          onClick={props.onToggleCollapse}
          title="Contraer panel derecho"
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-65 hover:opacity-100 shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto panel-scroll p-3.5 space-y-4 text-xs">
        {tab === 'props' && (
          <>
            {/* Active Tool Config when Pen / Eraser / Shape / Line / Sticky / Text */}
            {(props.activeTool === 'pen' || props.activeTool === 'eraser') && (
              <div className="space-y-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {props.activeTool === 'pen' ? 'Herramienta Lápiz' : 'Herramienta Borrador'}
                </div>

                {props.activeTool === 'eraser' ? (
                  <div>
                    <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                      <span>Radio del borrador</span>
                      <span className="font-mono-tabular">{props.toolOptions.eraserRadius} px</span>
                    </label>
                    <input
                      type="range"
                      min={6}
                      max={60}
                      value={props.toolOptions.eraserRadius}
                      onChange={(e) =>
                        props.onUpdateToolOptions({ eraserRadius: Number(e.target.value) })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-slate-600 dark:text-slate-400 mb-1.5">
                        Color del trazo
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {COLOR_SWATCHES.slice(0, 7).map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => props.onUpdateToolOptions({ penColor: c })}
                            className={`w-6 h-6 rounded-full border-2 ${
                              props.toolOptions.penColor === c
                                ? 'border-blue-600 scale-110'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <input
                          type="color"
                          value={props.toolOptions.penColor}
                          onChange={(e) => props.onUpdateToolOptions({ penColor: e.target.value })}
                          className="w-6 h-6 rounded border border-slate-300 cursor-pointer"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                        <span>Grosor</span>
                        <span className="font-mono-tabular">{props.toolOptions.penWidth} px</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={36}
                        value={props.toolOptions.penWidth}
                        onChange={(e) =>
                          props.onUpdateToolOptions({ penWidth: Number(e.target.value) })
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>

                    <div>
                      <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                        <span>Opacidad</span>
                        <span className="font-mono-tabular">
                          {Math.round(props.toolOptions.penOpacity * 100)}%
                        </span>
                      </label>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={props.toolOptions.penOpacity}
                        onChange={(e) =>
                          props.onUpdateToolOptions({ penOpacity: Number(e.target.value) })
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600 dark:text-slate-400">Estilo</span>
                      <select
                        value={props.toolOptions.penStyle}
                        onChange={(e) =>
                          props.onUpdateToolOptions({ penStyle: e.target.value as StrokeStyle })
                        }
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="solid">Sólido</option>
                        <option value="dashed">Discontinuo</option>
                        <option value="dotted">Punteado</option>
                      </select>
                    </div>

                    <label className="flex items-center justify-between cursor-pointer pt-1">
                      <span className="text-slate-600 dark:text-slate-400">Modo marcador resaltador</span>
                      <input
                        type="checkbox"
                        checked={props.toolOptions.penHighlighter}
                        onChange={(e) =>
                          props.onUpdateToolOptions({
                            penHighlighter: e.target.checked,
                            penOpacity: e.target.checked ? 0.38 : 1,
                            penWidth: e.target.checked ? 14 : 3,
                          })
                        }
                        className="accent-blue-600"
                      />
                    </label>
                  </>
                )}
              </div>
            )}

            {props.activeTool === 'cut' && (
              <div className="space-y-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Herramienta Cortar / Recortar
                </div>
                <p className="text-[11px] opacity-80 leading-relaxed">
                  <strong>1. Corte por línea:</strong> Arrastra de lado a lado sobre una figura o línea para dividirla en partes independientes.
                </p>
                <p className="text-[11px] opacity-80 leading-relaxed">
                  <strong>2. Recorte en intersección:</strong> Haz clic sobre un tramo de línea o mitad de figura cruzada por otra línea para recortarla al instante.
                </p>
              </div>
            )}

            {(props.activeTool === 'shape' || props.activeTool === 'line') && !single && (
              <div className="space-y-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Estilo de creación
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Color de contorno</span>
                  <input
                    type="color"
                    value={props.toolOptions.shapeStrokeColor}
                    onChange={(e) =>
                      props.onUpdateToolOptions({ shapeStrokeColor: e.target.value })
                    }
                    className="w-7 h-7 rounded border border-slate-300 cursor-pointer"
                  />
                </div>
                {props.activeTool === 'shape' && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Relleno</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            props.onUpdateToolOptions({ shapeFillColor: 'transparent' })
                          }
                          className={`px-2 py-0.5 rounded border text-[11px] ${
                            props.toolOptions.shapeFillColor === 'transparent'
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-slate-300 text-slate-600'
                          }`}
                        >
                          Sin relleno
                        </button>
                        <input
                          type="color"
                          value={
                            props.toolOptions.shapeFillColor === 'transparent'
                              ? '#e0f2fe'
                              : props.toolOptions.shapeFillColor
                          }
                          onChange={(e) =>
                            props.onUpdateToolOptions({ shapeFillColor: e.target.value })
                          }
                          className="w-7 h-7 rounded border border-slate-300 cursor-pointer"
                        />
                      </div>
                    </div>
                    {props.toolOptions.shapeKind === 'polygon' && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Lados del polígono</span>
                        <input
                          type="number"
                          min={3}
                          max={24}
                          value={props.toolOptions.polygonSides}
                          onChange={(e) =>
                            props.onUpdateToolOptions({
                              polygonSides: Math.max(3, Math.min(24, Number(e.target.value))),
                            })
                          }
                          className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                        />
                      </div>
                    )}
                  </>
                )}
                <div>
                  <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                    <span>Grosor</span>
                    <span className="font-mono-tabular">{props.toolOptions.shapeStrokeWidth} px</span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={16}
                    value={props.toolOptions.shapeStrokeWidth}
                    onChange={(e) =>
                      props.onUpdateToolOptions({ shapeStrokeWidth: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            )}

            {/* Selected Object Properties */}
            {props.selectedObjects.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {single
                      ? objectTypeLabel(single)
                      : `${props.selectedObjects.length} elementos seleccionados`}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        props.onUpdateObjects(selectedIds, (o) => ({ ...o, locked: !anyLocked }))
                      }
                      title={anyLocked ? 'Desbloquear' : 'Bloquear'}
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                    >
                      {anyLocked ? <Lock className="w-3.5 h-3.5 text-amber-600" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={props.onDuplicateSelected}
                      title="Duplicar (Ctrl+D)"
                      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={props.onDeleteSelected}
                      title="Eliminar (Supr)"
                      className="p-1 rounded hover:bg-red-100 text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Single Object Geometry */}
                {single && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Posición X</label>
                      <input
                        type="number"
                        value={Math.round(single.x)}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            x: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Posición Y</label>
                      <input
                        type="number"
                        value={Math.round(single.y)}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            y: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Ancho</label>
                      <input
                        type="number"
                        min={10}
                        value={Math.round(single.width)}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            width: Math.max(10, Number(e.target.value)),
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Alto</label>
                      <input
                        type="number"
                        min={10}
                        value={Math.round(single.height)}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            height: Math.max(10, Number(e.target.value)),
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Rotación (°)</label>
                      <input
                        type="number"
                        value={Math.round(single.rotation)}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            rotation: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Opacidad (%)</label>
                      <input
                        type="number"
                        min={10}
                        max={100}
                        value={Math.round(single.opacity * 100)}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            opacity: Math.max(0.1, Math.min(1, Number(e.target.value) / 100)),
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                      />
                    </div>
                  </div>
                )}

                {/* Multi-Object / Group Joint Geometry */}
                {!single && groupBox && (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Posición X</label>
                        <input
                          type="number"
                          disabled={unlockedSelectedIds.length === 0}
                          value={Math.round(groupBox.x)}
                          onChange={(e) => {
                            const nextX = Number(e.target.value);
                            if (!Number.isFinite(nextX)) return;
                            const dx = nextX - groupBox.x;
                            if (Math.abs(dx) < 1e-4) return;
                            props.onUpdateObjects(unlockedSelectedIds, (o) =>
                              translateCanvasObject(o, dx, 0)
                            );
                          }}
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Posición Y</label>
                        <input
                          type="number"
                          disabled={unlockedSelectedIds.length === 0}
                          value={Math.round(groupBox.y)}
                          onChange={(e) => {
                            const nextY = Number(e.target.value);
                            if (!Number.isFinite(nextY)) return;
                            const dy = nextY - groupBox.y;
                            if (Math.abs(dy) < 1e-4) return;
                            props.onUpdateObjects(unlockedSelectedIds, (o) =>
                              translateCanvasObject(o, 0, dy)
                            );
                          }}
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Ancho total</label>
                        <input
                          type="number"
                          min={20}
                          disabled={unlockedSelectedIds.length === 0}
                          value={Math.round(groupBox.width)}
                          onChange={(e) => {
                            const nextW = Math.max(20, Number(e.target.value));
                            if (!Number.isFinite(nextW)) return;
                            const nextBox = { ...groupBox, width: nextW };
                            props.onUpdateObjects(unlockedSelectedIds, (o) =>
                              scaleCanvasObjectInBox(o, groupBox, nextBox, props.cadConfig, true)
                            );
                          }}
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular disabled:opacity-50"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Alto total</label>
                        <input
                          type="number"
                          min={20}
                          disabled={unlockedSelectedIds.length === 0}
                          value={Math.round(groupBox.height)}
                          onChange={(e) => {
                            const nextH = Math.max(20, Number(e.target.value));
                            if (!Number.isFinite(nextH)) return;
                            const nextBox = { ...groupBox, height: nextH };
                            props.onUpdateObjects(unlockedSelectedIds, (o) =>
                              scaleCanvasObjectInBox(o, groupBox, nextBox, props.cadConfig, true)
                            );
                          }}
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
                      <label className="block text-[10px] text-slate-500">
                        Rotación solidaria alrededor del pivote del grupo
                      </label>
                      <div className="grid grid-cols-4 gap-1">
                        {[-90, -15, 15, 90].map((deg) => (
                          <button
                            key={deg}
                            type="button"
                            disabled={unlockedSelectedIds.length === 0}
                            onClick={() => {
                              const pivot = {
                                x: groupBox.x + groupBox.width / 2,
                                y: groupBox.y + groupBox.height / 2,
                              };
                              props.onUpdateObjects(unlockedSelectedIds, (o) =>
                                rotateCanvasObjectAroundPivot(o, pivot, deg, props.cadConfig)
                              );
                            }}
                            className="py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] font-mono-tabular"
                          >
                            {deg > 0 ? `+${deg}°` : `${deg}°`}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={groupRotInput}
                          onChange={(e) => setGroupRotInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const deg = Number(groupRotInput);
                              if (!Number.isFinite(deg) || deg === 0 || unlockedSelectedIds.length === 0) return;
                              const pivot = {
                                x: groupBox.x + groupBox.width / 2,
                                y: groupBox.y + groupBox.height / 2,
                              };
                              props.onUpdateObjects(unlockedSelectedIds, (o) =>
                                rotateCanvasObjectAroundPivot(o, pivot, deg, props.cadConfig)
                              );
                            }
                          }}
                          className="flex-1 min-w-0 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                          placeholder="Ángulo (°)"
                        />
                        <button
                          type="button"
                          disabled={unlockedSelectedIds.length === 0}
                          onClick={() => {
                            const deg = Number(groupRotInput);
                            if (!Number.isFinite(deg) || deg === 0) return;
                            const pivot = {
                              x: groupBox.x + groupBox.width / 2,
                              y: groupBox.y + groupBox.height / 2,
                            };
                            props.onUpdateObjects(unlockedSelectedIds, (o) =>
                              rotateCanvasObjectAroundPivot(o, pivot, deg, props.cadConfig)
                            );
                          }}
                          className="px-2.5 py-1 rounded theme-accent-btn text-[11px] font-medium disabled:opacity-40"
                        >
                          Rotar
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={props.onGroupSelected}
                        className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                      >
                        <Group className="w-3.5 h-3.5" />
                        Agrupar
                      </button>
                      <button
                        type="button"
                        disabled={!hasGroup}
                        onClick={props.onUngroupSelected}
                        className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] font-medium"
                      >
                        <Ungroup className="w-3.5 h-3.5" />
                        Desagrupar
                      </button>
                    </div>
                  </div>
                )}

                {/* Specific: Shape */}
                {single?.type === 'shape' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Color de borde</span>
                      <input
                        type="color"
                        value={single.strokeColor}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as ShapeObject),
                            strokeColor: e.target.value,
                          }))
                        }
                        className="w-7 h-7 rounded border border-slate-300"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Relleno</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as ShapeObject),
                              fillColor: 'transparent',
                            }))
                          }
                          className={`px-2 py-0.5 rounded border text-[11px] ${
                            single.fillColor === 'transparent'
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-slate-300 text-slate-600'
                          }`}
                        >
                          Ninguno
                        </button>
                        <input
                          type="color"
                          value={
                            single.fillColor === 'transparent' ? '#e0f2fe' : single.fillColor
                          }
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as ShapeObject),
                              fillColor: e.target.value,
                            }))
                          }
                          className="w-7 h-7 rounded border border-slate-300"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                        <span>Grosor</span>
                        <span className="font-mono-tabular">{single.strokeWidth} px</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={16}
                        value={single.strokeWidth}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as ShapeObject),
                            strokeWidth: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Estilo</span>
                      <select
                        value={single.strokeStyle}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as ShapeObject),
                            strokeStyle: e.target.value as StrokeStyle,
                          }))
                        }
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="solid">Sólido</option>
                        <option value="dashed">Discontinuo</option>
                        <option value="dotted">Punteado</option>
                      </select>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      <span className="block text-slate-600 dark:text-slate-400">
                        Reflejar / Invertir (espejo)
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as ShapeObject),
                              flipX: !(o as ShapeObject).flipX,
                            }))
                          }
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border text-[11px] font-medium transition-colors ${
                            single.flipX
                              ? 'theme-accent-soft border-current ring-1 ring-current/40'
                              : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <FlipHorizontal2 className="w-3.5 h-3.5" />
                          <span>Horizontal</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as ShapeObject),
                              flipY: !(o as ShapeObject).flipY,
                            }))
                          }
                          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border text-[11px] font-medium transition-colors ${
                            single.flipY
                              ? 'theme-accent-soft border-current ring-1 ring-current/40'
                              : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <FlipVertical2 className="w-3.5 h-3.5" />
                          <span>Vertical</span>
                        </button>
                      </div>
                    </div>
                    {single.shapeKind === 'polygon' && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Número de lados</span>
                        <input
                          type="number"
                          min={3}
                          max={24}
                          value={single.polygonSides || 6}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as ShapeObject),
                              polygonSides: Math.max(3, Math.min(24, Number(e.target.value))),
                            }))
                          }
                          className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                        />
                      </div>
                    )}
                    {single.shapeKind === 'arc' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-500">Ángulo inicio (°)</label>
                          <input
                            type="number"
                            value={single.arcStartAngle ?? 0}
                            onChange={(e) =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as ShapeObject),
                                arcStartAngle: Number(e.target.value),
                              }))
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500">Ángulo fin (°)</label>
                          <input
                            type="number"
                            value={single.arcEndAngle ?? 220}
                            onChange={(e) =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as ShapeObject),
                                arcEndAngle: Number(e.target.value),
                              }))
                            }
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Specific: Line */}
                {single?.type === 'line' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Tipo</span>
                      <select
                        value={single.lineKind}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as LineObject),
                            lineKind: e.target.value as LineKind,
                          }))
                        }
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="line">Línea recta</option>
                        <option value="segment">Segmento acotado</option>
                        <option value="dashed-line">Línea discontinua</option>
                        <option value="arrow">Flecha simple</option>
                        <option value="double-arrow">Flecha doble</option>
                        <option value="vector">Vector dirigido</option>
                        <option value="connector">Conector curvo</option>
                        <option value="orthogonal">Conector ortogonal</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Color</span>
                      <input
                        type="color"
                        value={single.strokeColor}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as LineObject),
                            strokeColor: e.target.value,
                          }))
                        }
                        className="w-7 h-7 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                        <span>Grosor</span>
                        <span className="font-mono-tabular">{single.strokeWidth} px</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={14}
                        value={single.strokeWidth}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as LineObject),
                            strokeWidth: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Estilo</span>
                      <select
                        value={single.strokeStyle}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as LineObject),
                            strokeStyle: e.target.value as StrokeStyle,
                          }))
                        }
                        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="solid">Sólido</option>
                        <option value="dashed">Discontinuo</option>
                        <option value="dotted">Punteado</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Specific: Stroke */}
                {single?.type === 'stroke' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Color de trazo</span>
                      <input
                        type="color"
                        value={single.color}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as StrokeObject),
                            color: e.target.value,
                          }))
                        }
                        className="w-7 h-7 rounded border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                        <span>Grosor</span>
                        <span className="font-mono-tabular">{single.strokeWidth} px</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={36}
                        value={single.strokeWidth}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as StrokeObject),
                            strokeWidth: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>
                )}

                {/* Specific: Text */}
                {single?.type === 'text' && (() => {
                  const isEditingThisText = props.editingTextId === single.id;
                  const textDefaults = getDefaultRunStyle(single);
                  const textParagraphs = normalizarContenidoTexto(
                    Array.isArray(single.paragraphs) && single.paragraphs.length > 0
                      ? single.paragraphs
                      : single.content,
                    textDefaults,
                    single.align || 'left'
                  );
                  const safeContent =
                    typeof single.content === 'string'
                      ? single.content
                      : paragraphsToPlainText(textParagraphs);
                  const textSummary: SelectionStyleSummary =
                    isEditingThisText && props.richTextSummary
                      ? props.richTextSummary
                      : getSelectionStyleSummary(
                          textParagraphs,
                          { start: 0, end: safeContent.length },
                          null,
                          textDefaults
                        );
                  const safeFontValue =
                    textSummary.fontFamily === 'mixed'
                      ? '__mixed__'
                      : textSummary.fontFamily || textDefaults.fontFamily || 'sans';
                  const safeFontSizeValue: number | 'mixed' =
                    textSummary.fontSize === 'mixed'
                      ? 'mixed'
                      : sanitizeStoredFontSize(
                          typeof textSummary.fontSize === 'number' &&
                            Number.isFinite(textSummary.fontSize)
                            ? textSummary.fontSize
                            : textDefaults.fontSize
                        );
                  const safeColorDisplay =
                    textSummary.color === 'mixed'
                      ? 'conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #ef4444)'
                      : textSummary.color || textDefaults.color || '#0f172a';
                  const safeColorInputValue =
                    textSummary.color === 'mixed'
                      ? textDefaults.color || '#0f172a'
                      : textSummary.color || textDefaults.color || '#0f172a';

                  // Aplica formato sobre la selección activa si se edita en lienzo, o sobre todo el texto si está seleccionado como objeto
                  const applyTextInline = (
                    patch: Parameters<typeof applyStyleToAllParagraphs>[1],
                    restoreFocus = false
                  ) => {
                    if (isEditingThisText && props.activeRichTextEditorRef?.current) {
                      props.activeRichTextEditorRef.current.applyStyle(patch, {
                        restoreFocus,
                      });
                      return;
                    }
                    props.onUpdateObjects([single.id], (o) => {
                      const t = o as TextObject;
                      const nextP = applyStyleToAllParagraphs(
                        ensureTextParagraphs(t),
                        patch,
                        getDefaultRunStyle(t)
                      );
                      return syncTextObjectFromParagraphs(t, nextP);
                    });
                  };

                  const applyTextAlign = (al: TextAlign, restoreFocus = false) => {
                    if (isEditingThisText && props.activeRichTextEditorRef?.current) {
                      props.activeRichTextEditorRef.current.applyAlign(al, {
                        restoreFocus,
                      });
                      return;
                    }
                    props.onUpdateObjects([single.id], (o) => {
                      const t = o as TextObject;
                      const nextP = applyAlignToAllParagraphs(
                        ensureTextParagraphs(t),
                        al,
                        getDefaultRunStyle(t)
                      );
                      return syncTextObjectFromParagraphs(t, nextP);
                    });
                  };

                  const styleBtnCls = (val: boolean | 'mixed') => {
                    if (val === true) return 'bg-blue-600 text-white border-blue-600';
                    if (val === 'mixed') {
                      return 'bg-slate-200 dark:bg-slate-700 border-dashed border-slate-400 dark:border-slate-500 text-slate-700 dark:text-slate-100';
                    }
                    return 'border-slate-300 dark:border-slate-700';
                  };

                  return (
                    <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                            Contenido
                          </label>
                          <button
                            type="button"
                            onClick={() => props.onStartEditingText(single.id)}
                            className="text-[11px] font-medium text-blue-600 hover:underline"
                          >
                            {isEditingThisText ? 'Editando en lienzo' : 'Editar en lienzo'}
                          </button>
                        </div>
                        <textarea
                          rows={3}
                          value={safeContent}
                          disabled={isEditingThisText}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => {
                              const t = o as TextObject;
                              const nextParagraphs = createParagraphsFromPlainText(
                                e.target.value,
                                getDefaultRunStyle(t),
                                t.align
                              );
                              return syncTextObjectFromParagraphs(t, nextParagraphs);
                            })
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 text-xs disabled:opacity-60"
                          placeholder="Escribe el texto..."
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Tipografía
                          </label>
                          <select
                            value={safeFontValue}
                            onChange={(e) => {
                              if (e.target.value === '__mixed__') return;
                              applyTextInline(
                                {
                                  fontFamily: e.target.value as TextObject['fontFamily'],
                                },
                                false
                              );
                            }}
                            className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                          >
                            {textSummary.fontFamily === 'mixed' && (
                              <option value="__mixed__" disabled>
                                Mixta
                              </option>
                            )}
                            {TEXT_FONT_OPTIONS.map((f) => (
                              <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Tamaño (px)
                          </label>
                          <FontSizeInput
                            variant="inspector"
                            value={safeFontSizeValue}
                            onCommit={(nextSize) =>
                              applyTextInline({ fontSize: nextSize }, isEditingThisText)
                            }
                            onStep={(delta) => {
                              if (isEditingThisText && props.activeRichTextEditorRef?.current) {
                                props.activeRichTextEditorRef.current.stepFontSize(delta, {
                                  restoreFocus: true,
                                });
                                return;
                              }
                              const base =
                                typeof safeFontSizeValue === 'number'
                                  ? safeFontSizeValue
                                  : textDefaults.fontSize;
                              applyTextInline(
                                { fontSize: stepFontSizeValue(base, delta) },
                                false
                              );
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() =>
                              applyTextInline(
                                { bold: textSummary.bold === true ? false : true },
                                isEditingThisText
                              )
                            }
                            className={`p-1.5 rounded border ${styleBtnCls(textSummary.bold)}`}
                            title={
                              textSummary.bold === 'mixed'
                                ? 'Negrita mixta — clic para unificar (Ctrl+B)'
                                : 'Negrita (Ctrl+B)'
                            }
                          >
                            <Bold className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() =>
                              applyTextInline(
                                { italic: textSummary.italic === true ? false : true },
                                isEditingThisText
                              )
                            }
                            className={`p-1.5 rounded border ${styleBtnCls(textSummary.italic)}`}
                            title={
                              textSummary.italic === 'mixed'
                                ? 'Cursiva mixta — clic para unificar (Ctrl+I)'
                                : 'Cursiva (Ctrl+I)'
                            }
                          >
                            <Italic className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() =>
                              applyTextInline(
                                {
                                  underline: textSummary.underline === true ? false : true,
                                },
                                isEditingThisText
                              )
                            }
                            className={`p-1.5 rounded border ${styleBtnCls(
                              textSummary.underline
                            )}`}
                            title={
                              textSummary.underline === 'mixed'
                                ? 'Subrayado mixto — clic para unificar (Ctrl+U)'
                                : 'Subrayado (Ctrl+U)'
                            }
                          >
                            <Underline className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as TextObject),
                                listStyle:
                                  (o as TextObject).listStyle === 'bullet' ? 'none' : 'bullet',
                              }))
                            }
                            className={`p-1.5 rounded border ${
                              single.listStyle === 'bullet'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-700'
                            }`}
                            title="Viñetas"
                          >
                            <List className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as TextObject),
                                listStyle:
                                  (o as TextObject).listStyle === 'numbered'
                                    ? 'none'
                                    : 'numbered',
                              }))
                            }
                            className={`p-1.5 rounded border ${
                              single.listStyle === 'numbered'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-300 dark:border-slate-700'
                            }`}
                            title="Lista numerada"
                          >
                            <ListOrdered className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Alineación</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              ['left', 'Izquierda', AlignLeft],
                              ['center', 'Centrar', AlignCenter],
                              ['right', 'Derecha', AlignRight],
                              ['justify', 'Justificar (Ctrl+J)', AlignJustify],
                            ] as const
                          ).map(([al, label, Icon]) => (
                            <button
                              key={al}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyTextAlign(al, isEditingThisText)}
                              title={
                                al === 'justify' && resolveTextWidthMode(single) === 'auto'
                                  ? 'Justificar (Ctrl+J) — desactiva ancho automático para ver efecto'
                                  : label
                              }
                              className={`p-1.5 rounded border ${
                                textSummary.align === al
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'border-slate-300 dark:border-slate-700'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Modo de ancho: automático ('auto') frente a fijo ('fixed') */}
                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-slate-600 dark:text-slate-400">
                          Ancho automático
                        </span>
                        <input
                          type="checkbox"
                          checked={resolveTextWidthMode(single) === 'auto'}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            props.onUpdateObjects([single.id], (o) => {
                              const prev = o as TextObject;
                              return {
                                ...prev,
                                widthMode: checked ? 'auto' : 'fixed',
                                autoWidth: checked,
                                width: Math.max(64, prev.width || 240),
                              };
                            });
                          }}
                          className="accent-blue-600 rounded"
                        />
                      </label>

                      {/* Idioma del corrector ortográfico por cuadro de texto */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">
                          Idioma (ortografía)
                        </span>
                        <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden">
                          {(
                            [
                              ['es', 'ES', 'Español (general)'],
                              ['es-MX', 'MX', 'Español (México)'],
                              ['en-US', 'EN', 'Inglés (EE. UU.)'],
                            ] as const
                          ).map(([langCode, shortLabel, titleLabel]) => {
                            const activeLang: SpellcheckLanguage =
                              single.lang === 'en-US' ||
                              single.lang === 'es-MX' ||
                              single.lang === 'es'
                                ? single.lang
                                : props.settings.spellcheckDefaultLang;
                            const isActive = activeLang === langCode;
                            return (
                              <button
                                key={langCode}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setRememberedTextLang(langCode);
                                  props.onUpdateObjects([single.id], (o) => ({
                                    ...(o as TextObject),
                                    lang: langCode,
                                  }));
                                }}
                                title={`Idioma de corrector: ${titleLabel}`}
                                className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                  isActive
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                {shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">
                          Color de texto
                        </span>
                        <label
                          className="relative w-7 h-7 rounded border border-slate-300 dark:border-slate-700 cursor-pointer overflow-hidden"
                          title={
                            textSummary.color === 'mixed'
                              ? 'Colores mixtos — clic para unificar'
                              : 'Color de texto'
                          }
                          style={{
                            background: safeColorDisplay,
                          }}
                        >
                          <input
                            type="color"
                            value={safeColorInputValue}
                            onChange={(e) =>
                              applyTextInline({ color: e.target.value }, false)
                            }
                            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })()}

                {/* Specific: Table */}
                {single?.type === 'table' && (() => {
                  const safeTable = normalizarTabla(single);
                  const activeLang: SpellcheckLanguage =
                    safeTable.lang === 'en-US' ||
                    safeTable.lang === 'es-MX' ||
                    safeTable.lang === 'es'
                      ? safeTable.lang
                      : props.settings.spellcheckDefaultLang;
                  return (
                    <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={safeTable.rows >= TABLE_MAX_ROWS}
                          onClick={() =>
                            props.onUpdateObjects([single.id], () => addTableRow(safeTable))
                          }
                          className="py-1 px-2 rounded border theme-border hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 text-[11px] font-medium"
                        >
                          + Fila
                        </button>
                        <button
                          type="button"
                          disabled={safeTable.rows <= 1}
                          onClick={() =>
                            props.onUpdateObjects([single.id], () =>
                              removeTableRow(safeTable, safeTable.rows - 1)
                            )
                          }
                          className="py-1 px-2 rounded border theme-border hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 disabled:opacity-40 text-[11px] font-medium"
                        >
                          - Fila
                        </button>
                        <button
                          type="button"
                          disabled={safeTable.cols >= TABLE_MAX_COLS}
                          onClick={() =>
                            props.onUpdateObjects([single.id], () => addTableCol(safeTable))
                          }
                          className="py-1 px-2 rounded border theme-border hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 text-[11px] font-medium"
                        >
                          + Columna
                        </button>
                        <button
                          type="button"
                          disabled={safeTable.cols <= 1}
                          onClick={() =>
                            props.onUpdateObjects([single.id], () =>
                              removeTableCol(safeTable, safeTable.cols - 1)
                            )
                          }
                          className="py-1 px-2 rounded border theme-border hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 disabled:opacity-40 text-[11px] font-medium"
                        >
                          - Columna
                        </button>
                      </div>

                      <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-slate-600 dark:text-slate-400">
                          Fila de encabezado
                        </span>
                        <input
                          type="checkbox"
                          checked={safeTable.hasHeaderRow}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as TableObject),
                              hasHeaderRow: e.target.checked,
                            }))
                          }
                          className="accent-blue-600 rounded"
                        />
                      </label>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Tipografía</span>
                        <select
                          value={safeTable.fontFamily}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as TableObject),
                              fontFamily: e.target.value as TableObject['fontFamily'],
                            }))
                          }
                          className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                        >
                          {TEXT_FONT_OPTIONS.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400 mb-1">
                          <span>Tamaño base (px)</span>
                          <div className="w-20">
                            <FontSizeInput
                              variant="inspector"
                              value={sanitizeStoredFontSize(safeTable.fontSize, 15)}
                              onCommit={(nextSize) =>
                                props.onUpdateObjects([single.id], (o) => ({
                                  ...(o as TableObject),
                                  fontSize: nextSize,
                                }))
                              }
                            />
                          </div>
                        </div>
                        <input
                          type="range"
                          min={8}
                          max={96}
                          step={0.5}
                          value={Math.max(8, Math.min(96, safeTable.fontSize))}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as TableObject),
                              fontSize: clampTextFontSize(Number(e.target.value)),
                            }))
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Color de texto base</span>
                        <input
                          type="color"
                          value={safeTable.color || '#0f172a'}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as TableObject),
                              color: e.target.value,
                            }))
                          }
                          className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Fondo encabezado</span>
                        <div className="flex items-center gap-1.5">
                          {safeTable.headerFillColor && (
                            <button
                              type="button"
                              onClick={() =>
                                props.onUpdateObjects([single.id], (o) => ({
                                  ...(o as TableObject),
                                  headerFillColor: undefined,
                                }))
                              }
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              Auto
                            </button>
                          )}
                          <input
                            type="color"
                            value={safeTable.headerFillColor || '#e2e8f0'}
                            onChange={(e) =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as TableObject),
                                headerFillColor: e.target.value,
                              }))
                            }
                            className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">
                          Idioma (ortografía)
                        </span>
                        <div className="inline-flex rounded border border-slate-300 dark:border-slate-700 overflow-hidden">
                          {(
                            [
                              ['es', 'ES', 'Español (general)'],
                              ['es-MX', 'MX', 'Español (México)'],
                              ['en-US', 'EN', 'Inglés (EE. UU.)'],
                            ] as const
                          ).map(([langCode, shortLabel, titleLabel]) => (
                            <button
                              key={langCode}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setRememberedTextLang(langCode);
                                props.onUpdateObjects([single.id], (o) => ({
                                  ...(o as TableObject),
                                  lang: langCode,
                                }));
                              }}
                              title={`Idioma de corrector: ${titleLabel}`}
                              className={`px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                activeLang === langCode
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {shortLabel}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Specific: Sticky Note */}
                {single?.type === 'sticky' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Contenido de nota
                        </label>
                        <button
                          type="button"
                          onClick={() => props.onStartEditingText(single.id)}
                          className="text-[11px] font-medium text-blue-600 hover:underline"
                        >
                          Editar en lienzo
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={typeof single.content === 'string' ? single.content : ''}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as StickyObject),
                            content: e.target.value,
                          }))
                        }
                        className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 dark:text-slate-400 mb-1.5">
                        Color de nota
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {STICKY_COLORS.map((sc) => (
                          <button
                            key={sc.bg}
                            type="button"
                            title={sc.name}
                            onClick={() =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as StickyObject),
                                backgroundColor: sc.bg,
                              }))
                            }
                            className={`w-6 h-6 rounded border-2 ${
                              single.backgroundColor === sc.bg
                                ? 'border-blue-600 scale-110'
                                : 'border-slate-300'
                            }`}
                            style={{ backgroundColor: sc.bg }}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400 mb-1">
                        <span>Tamaño de fuente (px)</span>
                        <div className="w-20">
                          <FontSizeInput
                            variant="inspector"
                            value={sanitizeStoredFontSize(single.fontSize, 14)}
                            onCommit={(nextSize) =>
                              props.onUpdateObjects([single.id], (o) => ({
                                ...(o as StickyObject),
                                fontSize: nextSize,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <input
                        type="range"
                        min={8}
                        max={96}
                        step={0.5}
                        value={Math.max(8, Math.min(96, single.fontSize))}
                        onChange={(e) =>
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as StickyObject),
                            fontSize: clampTextFontSize(Number(e.target.value)),
                          }))
                        }
                        className="w-full accent-blue-600"
                      />
                      <span className="sr-only">{formatFontSizeDisplay(single.fontSize)} px</span>
                    </div>
                  </div>
                )}

                {/* Specific: Equation */}
                {single?.type === 'equation' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <label className="block text-slate-600 dark:text-slate-400">
                      Expresión LaTeX
                    </label>
                    <textarea
                      rows={3}
                      value={single.latex}
                      onChange={(e) =>
                        props.onUpdateObjects([single.id], (o) => ({
                          ...(o as EquationObject),
                          latex: e.target.value,
                        }))
                      }
                      className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 font-mono-tabular text-xs"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Fondo</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as EquationObject),
                              backgroundColor: 'transparent',
                            }))
                          }
                          className={`px-2 py-0.5 rounded border text-[11px] ${
                            single.backgroundColor === 'transparent'
                              ? 'theme-accent-soft border-current font-medium'
                              : 'theme-border'
                          }`}
                        >
                          Transparente
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as EquationObject),
                              backgroundColor: '#ffffff',
                            }))
                          }
                          className={`px-2 py-0.5 rounded border text-[11px] ${
                            single.backgroundColor === '#ffffff'
                              ? 'theme-accent-soft border-current font-medium'
                              : 'theme-border'
                          }`}
                        >
                          Blanco
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => props.onStartEditingEquation(single.id)}
                        className="py-2 px-2.5 rounded-lg theme-accent-btn font-medium text-[11px]"
                      >
                        Editar en pizarra
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onOpenEquationEditor(single)}
                        className="py-2 px-2.5 rounded-lg border theme-border hover:bg-black/5 dark:hover:bg-white/10 font-medium text-[11px]"
                      >
                        Editor ampliado
                      </button>
                    </div>
                  </div>
                )}

                {/* Specific: Graph */}
                {single?.type === 'graph' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500">X Mín</label>
                        <input
                          type="number"
                          value={single.xMin}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as GraphObject),
                              xMin: Number(e.target.value),
                            }))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500">X Máx</label>
                        <input
                          type="number"
                          value={single.xMax}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as GraphObject),
                              xMax: Number(e.target.value),
                            }))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500">Y Mín</label>
                        <input
                          type="number"
                          value={single.yMin}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as GraphObject),
                              yMin: Number(e.target.value),
                            }))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500">Y Máx</label>
                        <input
                          type="number"
                          value={single.yMax}
                          onChange={(e) =>
                            props.onUpdateObjects([single.id], (o) => ({
                              ...(o as GraphObject),
                              yMax: Number(e.target.value),
                            }))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => props.onOpenGraphEditor(single)}
                      className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    >
                      Editar funciones, puntos y vectores
                    </button>
                  </div>
                )}

                {/* Specific: Image / Document */}
                {(single?.type === 'image' || single?.type === 'document') && (
                  <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-slate-700 dark:text-slate-300">
                        Bloquear como fondo de referencia
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(single.isReferenceBackground)}
                        onChange={(e) => {
                          const lockAsBg = e.target.checked;
                          props.onUpdateObjects([single.id], (o) => ({
                            ...(o as ImageObject | DocumentObject),
                            isReferenceBackground: lockAsBg,
                            locked: lockAsBg,
                            zIndex: lockAsBg ? 0 : o.zIndex,
                          }));
                        }}
                        className="accent-blue-600"
                      />
                    </label>
                    {single.type === 'image' && (
                      <button
                        type="button"
                        onClick={() => {
                          const ratio = single.naturalHeight / Math.max(1, single.naturalWidth);
                          props.onUpdateObjects([single.id], (o) => ({
                            ...o,
                            height: Math.round(o.width * ratio),
                          }));
                        }}
                        className="w-full py-1.5 px-3 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Restablecer proporción original
                      </button>
                    )}
                  </div>
                )}

                {/* Specific: Dimension */}
                {single?.type === 'dimension' && (() => {
                  const dim = single as DimensionObject;
                  const metrics = computeDimensionMetrics(dim, props.cadConfig);
                  const kindNames: Record<DimensionObject['dimKind'], string> = {
                    linear: 'Lineal (ACL)',
                    aligned: 'Alineada (ACA)',
                    angular: 'Angular (ANG)',
                    radial: 'Radial (RAD)',
                    diametral: 'Diametral (DIA)',
                    ordinate: 'Por coordenadas (COR)',
                  };
                  return (
                    <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Tipo de cota</span>
                        <span className="px-2 py-0.5 rounded theme-accent-soft text-[11px] font-semibold">
                          {kindNames[dim.dimKind]}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-400">Medida calculada</span>
                        <span className="font-mono-tabular font-semibold">{metrics.formattedLabel}</span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] text-slate-600 dark:text-slate-400">
                            Texto personalizado
                          </label>
                          {dim.textOverride && (
                            <button
                              type="button"
                              onClick={() =>
                                props.onUpdateObjects([dim.id], (o) => ({
                                  ...(o as DimensionObject),
                                  textOverride: undefined,
                                }))
                              }
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              Restablecer automático
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={dim.textOverride ?? ''}
                          placeholder={metrics.formattedLabel}
                          onChange={(e) =>
                            props.onUpdateObjects([dim.id], (o) => ({
                              ...(o as DimensionObject),
                              textOverride: e.target.value,
                            }))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 font-mono-tabular text-xs"
                        />
                        <p className="text-[10px] opacity-65">
                          También puedes hacer doble clic sobre la cota en la pizarra para editar el texto.
                        </p>
                      </div>

                      {dim.dimKind === 'linear' && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Eje</span>
                          <select
                            value={dim.linearAxis ?? 'auto'}
                            onChange={(e) =>
                              props.onUpdateObjects([dim.id], (o) => ({
                                ...(o as DimensionObject),
                                linearAxis: e.target.value as CadLinearDimAxis,
                              }))
                            }
                            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                          >
                            <option value="auto">Automático</option>
                            <option value="horizontal">Horizontal</option>
                            <option value="vertical">Vertical</option>
                          </select>
                        </div>
                      )}

                      {dim.dimKind === 'ordinate' && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Coordenada</span>
                          <select
                            value={dim.ordinateAxis ?? 'x'}
                            onChange={(e) =>
                              props.onUpdateObjects([dim.id], (o) => ({
                                ...(o as DimensionObject),
                                ordinateAxis: e.target.value as 'x' | 'y',
                              }))
                            }
                            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                          >
                            <option value="x">Coordenada X</option>
                            <option value="y">Coordenada Y</option>
                          </select>
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-slate-600 dark:text-slate-400">Color de cota</span>
                        <input
                          type="color"
                          value={dim.strokeColor}
                          onChange={(e) =>
                            props.onUpdateObjects([dim.id], (o) => ({
                              ...(o as DimensionObject),
                              strokeColor: e.target.value,
                              textColor: e.target.value,
                            }))
                          }
                          className="w-7 h-7 rounded border border-slate-300"
                        />
                      </div>

                      <div>
                        <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                          <span>Tamaño de etiqueta</span>
                          <span className="font-mono-tabular">{dim.fontSize} px</span>
                        </label>
                        <input
                          type="range"
                          min={9}
                          max={24}
                          value={dim.fontSize}
                          onChange={(e) =>
                            props.onUpdateObjects([dim.id], (o) => ({
                              ...(o as DimensionObject),
                              fontSize: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-blue-600"
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Propiedades del tablero
                </div>

                {/* Page Size Preset & Orientation */}
                <div className="space-y-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
                  <label className="block text-slate-600 dark:text-slate-400">
                    Tamaño de la pizarra
                  </label>
                  <select
                    value={props.board.sizePreset ?? 'infinite'}
                    onChange={(e) => {
                      const nextPreset = e.target.value as BoardSizePreset;
                      const resolved = resolveBoardDimensions(
                        nextPreset,
                        props.board.pageOrientation ?? 'portrait',
                        props.board.pageWidth ?? 1000,
                        props.board.pageHeight ?? 750
                      );
                      props.onUpdateBoardMeta(resolved);
                    }}
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                  >
                    {BOARD_SIZE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {isFixedSizeBoard(props.board) && (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(
                          [
                            ['portrait', 'Vertical'],
                            ['landscape', 'Horizontal'],
                          ] as [PageOrientation, string][]
                        ).map(([ori, label]) => {
                          const activeOri =
                            (props.board.pageOrientation ??
                              ((props.board.pageWidth ?? 0) > (props.board.pageHeight ?? 0)
                                ? 'landscape'
                                : 'portrait')) === ori;
                          return (
                            <button
                              key={ori}
                              type="button"
                              onClick={() => {
                                const preset = props.board.sizePreset ?? 'letter';
                                if (preset === 'custom') {
                                  const w = props.board.pageWidth ?? 1000;
                                  const h = props.board.pageHeight ?? 750;
                                  const nextW = ori === 'landscape' ? Math.max(w, h) : Math.min(w, h);
                                  const nextH = ori === 'landscape' ? Math.min(w, h) : Math.max(w, h);
                                  props.onUpdateBoardMeta({
                                    pageWidth: nextW,
                                    pageHeight: nextH,
                                    pageOrientation: ori,
                                  });
                                } else {
                                  props.onUpdateBoardMeta(resolveBoardDimensions(preset, ori));
                                }
                              }}
                              className={`py-1 px-2 rounded border text-[11px] font-medium ${
                                activeOri
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      {props.board.sizePreset === 'custom' && (
                        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                          <div>
                            <label className="block text-[10px] text-slate-500">Ancho (px)</label>
                            <input
                              type="number"
                              min={200}
                              max={6000}
                              value={props.board.pageWidth ?? 1000}
                              onChange={(e) => {
                                const w = clampCustomDimensionPx(Number(e.target.value));
                                const h = props.board.pageHeight ?? 750;
                                props.onUpdateBoardMeta({
                                  pageWidth: w,
                                  pageOrientation: w > h ? 'landscape' : 'portrait',
                                });
                              }}
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-mono-tabular"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-500">Alto (px)</label>
                            <input
                              type="number"
                              min={200}
                              max={6000}
                              value={props.board.pageHeight ?? 750}
                              onChange={(e) => {
                                const h = clampCustomDimensionPx(Number(e.target.value));
                                const w = props.board.pageWidth ?? 1000;
                                props.onUpdateBoardMeta({
                                  pageHeight: h,
                                  pageOrientation: w > h ? 'landscape' : 'portrait',
                                });
                              }}
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-mono-tabular"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="text-[10px] text-slate-500 font-mono-tabular">
                    {getBoardSizeSummary(props.board)}
                  </div>

                  {isFixedSizeBoard(props.board) && (() => {
                    const sheetCfg = normalizarAjustesHoja(props.board);
                    return (
                      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="text-slate-600 dark:text-slate-400">
                            Mostrar marco
                          </span>
                          <input
                            type="checkbox"
                            checked={sheetCfg.showFrame}
                            onChange={(e) =>
                              props.onUpdateBoardMeta({ showFrame: e.target.checked })
                            }
                            className="accent-blue-600"
                          />
                        </label>

                        <div className={sheetCfg.showFrame ? '' : 'opacity-50 pointer-events-none'}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <label
                              htmlFor="board-frame-margin-mm"
                              className="text-slate-600 dark:text-slate-400"
                            >
                              Margen (mm)
                            </label>
                            <input
                              id="board-frame-margin-mm"
                              type="number"
                              min={MIN_FRAME_MARGIN_MM}
                              max={MAX_FRAME_MARGIN_MM}
                              step={1}
                              value={marginDraft ?? String(sheetCfg.frameMarginMm)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setMarginDraft(raw);
                                if (raw.trim() === '') return;
                                const v = Number(raw);
                                if (!Number.isFinite(v)) return;
                                const nextMargin = normalizarAjustesHoja({
                                  frameMarginMm: v,
                                }).frameMarginMm;
                                props.onUpdateBoardMeta({ frameMarginMm: nextMargin });
                              }}
                              onBlur={() => setMarginDraft(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                              className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-0.5 text-xs font-mono-tabular text-right"
                            />
                          </div>
                          <input
                            type="range"
                            min={MIN_FRAME_MARGIN_MM}
                            max={MAX_FRAME_MARGIN_MM}
                            step={1}
                            value={sheetCfg.frameMarginMm}
                            onChange={(e) =>
                              props.onUpdateBoardMeta({
                                frameMarginMm: normalizarAjustesHoja({
                                  frameMarginMm: Number(e.target.value),
                                }).frameMarginMm,
                              })
                            }
                            className="w-full accent-blue-600"
                          />
                        </div>

                        <label
                          className={`flex items-center justify-between cursor-pointer ${
                            sheetCfg.showFrame ? '' : 'opacity-50 pointer-events-none'
                          }`}
                          title="Oculta trazos, figuras y textos fuera del área útil sin eliminarlos"
                        >
                          <span className="text-slate-600 dark:text-slate-400">
                            Recortar dibujo al marco
                          </span>
                          <input
                            type="checkbox"
                            checked={sheetCfg.clipToFrame}
                            onChange={(e) =>
                              props.onUpdateBoardMeta({ clipToFrame: e.target.checked })
                            }
                            className="accent-blue-600"
                          />
                        </label>
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">
                    Fondo del lienzo
                  </label>
                  <select
                    value={props.board.backgroundPattern}
                    onChange={(e) =>
                      props.onUpdateBoardMeta({
                        backgroundPattern: e.target.value as BackgroundPattern,
                      })
                    }
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                  >
                    <option value="blank">Blanco liso</option>
                    <option value="grid">Cuadriculado</option>
                    <option value="lined">Rayado</option>
                    <option value="dotted">Punteado</option>
                    <option value="isometric">Isométrico</option>
                  </select>
                </div>

                {/* Nuevo selector independiente para el color de fondo del lienzo */}
                <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
                  <CanvasColorPickerControl
                    compact
                    theme={props.settings.theme}
                    mode={props.settings.canvasBgMode}
                    customColor={props.settings.canvasBgCustomColor}
                    adaptStrokeColors={props.settings.adaptStrokeColorsToCanvasBg}
                    onChangeMode={(canvasBgMode) =>
                      props.onUpdateSettings({ ...props.settings, canvasBgMode })
                    }
                    onChangeCustomColor={(canvasBgCustomColor) =>
                      props.onUpdateSettings({
                        ...props.settings,
                        canvasBgMode: 'custom',
                        canvasBgCustomColor,
                      })
                    }
                    onChangeAdaptStrokeColors={(adaptStrokeColorsToCanvasBg) =>
                      props.onUpdateSettings({
                        ...props.settings,
                        adaptStrokeColorsToCanvasBg,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="flex justify-between text-slate-600 dark:text-slate-400 mb-1">
                    <span>Tamaño de cuadrícula</span>
                    <span className="font-mono-tabular">{props.board.gridSize} px</span>
                  </label>
                  <input
                    type="range"
                    min={12}
                    max={72}
                    value={props.board.gridSize}
                    onChange={(e) =>
                      props.onUpdateBoardMeta({ gridSize: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-slate-600 dark:text-slate-400">
                    Mostrar sistema de coordenadas
                  </span>
                  <input
                    type="checkbox"
                    checked={props.board.showCoordinates}
                    onChange={(e) =>
                      props.onUpdateBoardMeta({ showCoordinates: e.target.checked })
                    }
                    className="accent-blue-600"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-slate-600 dark:text-slate-400">
                    Ajustar objetos a la cuadrícula
                  </span>
                  <input
                    type="checkbox"
                    checked={props.board.snapToGrid}
                    onChange={(e) =>
                      props.onUpdateBoardMeta({ snapToGrid: e.target.checked })
                    }
                    className="accent-blue-600"
                  />
                </label>
                <p className="text-[11px] text-slate-400 pt-2">
                  Selecciona cualquier objeto del lienzo para inspeccionar y editar sus propiedades aquí.
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'layers' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Capas del tablero
              </span>
              <button
                type="button"
                onClick={props.onLayerAdd}
                className="flex items-center gap-1 px-2 py-1 rounded theme-accent-btn text-[11px] font-medium"
              >
                <Plus className="w-3 h-3" />
                Nueva capa
              </button>
            </div>

            {selectedIds.length > 0 && (
              <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                <label className="block text-[11px] text-blue-800 dark:text-blue-200 mb-1">
                  Mover selección ({selectedIds.length}) a capa:
                </label>
                <select
                  value={props.selectedObjects[0]?.layerId || props.board.activeLayerId}
                  onChange={(e) => props.onAssignToLayer(e.target.value)}
                  className="w-full rounded border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                >
                  {props.board.layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              {[...props.board.layers].reverse().map((layer) => {
                const isActive = layer.id === props.board.activeLayerId;
                const layerObjects = props.board.objects.filter((o) => o.layerId === layer.id);
                return (
                  <div
                    key={layer.id}
                    className={`rounded-lg border p-2 ${
                      isActive
                        ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      {editingLayerId === layer.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={layerNameDraft}
                          onChange={(e) => setLayerNameDraft(e.target.value)}
                          onBlur={() => {
                            if (layerNameDraft.trim()) {
                              props.onLayerUpdate(layer.id, { name: layerNameDraft.trim() });
                            }
                            setEditingLayerId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (layerNameDraft.trim()) {
                                props.onLayerUpdate(layer.id, { name: layerNameDraft.trim() });
                              }
                              setEditingLayerId(null);
                            }
                          }}
                          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-blue-500 rounded bg-white dark:bg-slate-900"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => props.onLayerSelect(layer.id)}
                          onDoubleClick={() => {
                            setEditingLayerId(layer.id);
                            setLayerNameDraft(layer.name);
                          }}
                          className="flex-1 text-left font-medium text-slate-800 dark:text-slate-100 truncate"
                          title="Clic para activar, doble clic para renombrar"
                        >
                          {layer.name}{' '}
                          <span className="text-[10px] text-slate-400 tabular-nums">
                            ({layerObjects.length})
                          </span>
                        </button>
                      )}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            props.onLayerUpdate(layer.id, { visible: !layer.visible })
                          }
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800"
                          title={layer.visible ? 'Ocultar capa' : 'Mostrar capa'}
                        >
                          {layer.visible ? (
                            <Eye className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => props.onLayerUpdate(layer.id, { locked: !layer.locked })}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800"
                          title={layer.locked ? 'Desbloquear capa' : 'Bloquear capa'}
                        >
                          {layer.locked ? (
                            <Lock className="w-3.5 h-3.5 text-amber-600" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </button>
                        {props.board.layers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => props.onLayerDelete(layer.id)}
                            className="p-1 rounded hover:bg-red-100 text-red-500"
                            title="Eliminar capa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {layerObjects.length > 0 && (
                      <div className="mt-1.5 pl-2 space-y-0.5 max-h-32 overflow-y-auto panel-scroll">
                        {layerObjects.map((o) => {
                          const isSel = selectedIds.includes(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => props.onSelectIds([o.id])}
                              className={`w-full text-left px-2 py-1 rounded text-[11px] truncate flex items-center justify-between ${
                                isSel
                                  ? 'bg-blue-600 text-white'
                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span className="truncate">{objectTypeLabel(o)}</span>
                              {o.locked && <Lock className="w-2.5 h-2.5 shrink-0 ml-1" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Administración de grupos (incluye grupos anidados) */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Grupos de objetos
                </span>
                {selectedIds.length >= 2 && (
                  <button
                    type="button"
                    onClick={props.onGroupSelected}
                    className="flex items-center gap-1 px-2 py-0.5 rounded theme-accent-soft text-[11px] font-medium"
                  >
                    <Group className="w-3 h-3" />
                    Agrupar sel.
                  </button>
                )}
              </div>

              {(() => {
                const groupsList = ensureGroupsArray(props.board.groups);
                if (groupsList.length === 0) {
                  return (
                    <p className="text-[11px] opacity-65">
                      No hay grupos creados. Selecciona 2 o más objetos y pulsa Agrupar (Ctrl+G).
                    </p>
                  );
                }

                const renderGroupNode = (grp: GroupRecord, depth: number): React.ReactNode => {
                  const childGroups = groupsList.filter((g) => g.parentGroupId === grp.id);
                  const directMembers = props.board.objects.filter((o) => o.groupId === grp.id);
                  const allMembers = getGroupMemberObjects(grp.id, props.board.objects, groupsList);
                  const isGrpSelected =
                    allMembers.length > 0 && allMembers.every((m) => selectedIds.includes(m.id));

                  return (
                    <div
                      key={grp.id}
                      style={{ marginLeft: depth * 10 }}
                      className={`rounded-lg border p-2 space-y-1.5 ${
                        isGrpSelected
                          ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        {editingGroupId === grp.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={groupNameDraft}
                            onChange={(e) => setGroupNameDraft(e.target.value)}
                            onBlur={() => {
                              if (groupNameDraft.trim()) {
                                props.onRenameGroup(grp.id, groupNameDraft.trim());
                              }
                              setEditingGroupId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (groupNameDraft.trim()) {
                                  props.onRenameGroup(grp.id, groupNameDraft.trim());
                                }
                                setEditingGroupId(null);
                              }
                            }}
                            className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border border-blue-500 rounded bg-white dark:bg-slate-900"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => props.onSelectGroup(grp.id)}
                            onDoubleClick={() => {
                              setEditingGroupId(grp.id);
                              setGroupNameDraft(grp.name);
                            }}
                            title="Clic para seleccionar grupo, doble clic para renombrar"
                            className="flex-1 text-left font-medium truncate flex items-center gap-1.5"
                          >
                            <Group className="w-3 h-3 shrink-0 opacity-75" />
                            <span className="truncate">{grp.name}</span>
                            <span className="text-[10px] opacity-60 tabular-nums shrink-0">
                              ({allMembers.length})
                            </span>
                          </button>
                        )}
                        <div className="flex items-center gap-0.5 shrink-0">
                          {selectedIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => props.onAddSelectionToGroup(grp.id)}
                              title="Agregar objetos seleccionados a este grupo"
                              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-blue-600"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => props.onDissolveGroup(grp.id)}
                            title="Desagrupar este grupo"
                            className="p-1 rounded hover:bg-red-100 text-red-500"
                          >
                            <Ungroup className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {directMembers.length > 0 && (
                        <div className="pl-2 space-y-0.5 max-h-24 overflow-y-auto panel-scroll">
                          {directMembers.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
                            >
                              <button
                                type="button"
                                onClick={() => props.onSelectIds([m.id])}
                                className="truncate text-left flex-1 opacity-80 hover:opacity-100"
                              >
                                {objectTypeLabel(m)}
                              </button>
                              <button
                                type="button"
                                onClick={() => props.onRemoveFromGroup([m.id])}
                                title="Retirar del grupo"
                                className="px-1 rounded text-red-500 hover:bg-red-100 shrink-0"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {childGroups.map((cg) => renderGroupNode(cg, depth + 1))}
                    </div>
                  );
                };

                const rootGroups = groupsList.filter(
                  (g) => !g.parentGroupId || !groupsList.some((p) => p.id === g.parentGroupId)
                );
                return <div className="space-y-1.5">{rootGroups.map((g) => renderGroupNode(g, 0))}</div>;
              })()}
            </div>
          </div>
        )}

        {tab === 'arrange' && (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Orden de apilamiento
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => props.onZOrder('front')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowUpToLine className="w-3.5 h-3.5" />
                  Al frente
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => props.onZOrder('back')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Al fondo
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => props.onZOrder('forward')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  Adelantar
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => props.onZOrder('backward')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  Atrasar
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Agrupación
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={props.onGroupSelected}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <Group className="w-3.5 h-3.5" />
                  Agrupar
                </button>
                <button
                  type="button"
                  disabled={!hasGroup}
                  onClick={props.onUngroupSelected}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <Ungroup className="w-3.5 h-3.5" />
                  Desagrupar
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Alinear selección (≥ 2 objetos)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={() => props.onAlign('left')}
                  title="Alinear izquierda"
                  className="p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex justify-center"
                >
                  <AlignStartHorizontal className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={() => props.onAlign('center-h')}
                  title="Centrar horizontalmente"
                  className="p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex justify-center"
                >
                  <AlignCenterHorizontal className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={() => props.onAlign('right')}
                  title="Alinear derecha"
                  className="p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex justify-center"
                >
                  <AlignEndHorizontal className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={() => props.onAlign('top')}
                  title="Alinear arriba"
                  className="p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex justify-center"
                >
                  <AlignStartVertical className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={() => props.onAlign('center-v')}
                  title="Centrar verticalmente"
                  className="p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex justify-center"
                >
                  <AlignCenterVertical className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 2}
                  onClick={() => props.onAlign('bottom')}
                  title="Alinear abajo"
                  className="p-2 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 flex justify-center"
                >
                  <AlignEndVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Distribuir uniformemente (≥ 3 objetos)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={selectedIds.length < 3}
                  onClick={() => props.onDistribute('horizontal')}
                  className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  Horizontalmente
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length < 3}
                  onClick={() => props.onDistribute('vertical')}
                  className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  Verticalmente
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});

