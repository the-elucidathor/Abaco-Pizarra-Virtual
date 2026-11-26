import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  FileUp,
  Hand,
  Hexagon,
  LineChart,
  Minus,
  MousePointer2,
  PenTool,
  PlusSquare,
  Scissors,
  Sigma,
  Square,
  StickyNote,
  Table2,
  Triangle,
  Type,
  X,
} from 'lucide-react';
import type { LineKind, ShapeKind, ToolId } from '../types/whiteboard';
import {
  LINE_CATALOG,
  SHAPE_CATALOG_GROUPS,
  renderLinePreviewSvg,
  renderShapeSvgElement,
} from '../utils/shapeRenderer';

interface LeftToolbarProps {
  activeTool: ToolId;
  activeShapeKind: ShapeKind;
  activeLineKind: LineKind;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTool: (tool: ToolId) => void;
  onSelectShapeKind: (kind: ShapeKind) => void;
  onSelectLineKind: (kind: LineKind) => void;
  onOpenEquationModal: () => void;
  onOpenGraphModal: () => void;
  onImportFileClick: () => void;
  onInsertTable: (rows: number, cols: number, mode?: 'center' | 'click') => void;
}

// OPT: 2.6 — Evita re-renderizar barra lateral al mover cursor o hacer zoom
export const LeftToolbar: React.FC<LeftToolbarProps> = React.memo(({
  activeTool,
  activeShapeKind,
  activeLineKind,
  collapsed,
  onToggleCollapse,
  onSelectTool,
  onSelectShapeKind,
  onSelectLineKind,
  onOpenEquationModal,
  onOpenGraphModal,
  onImportFileClick,
  onInsertTable,
}) => {
  const [openFlyout, setOpenFlyout] = useState<'shape' | 'line' | 'insert' | null>(null);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [hoverTableGrid, setHoverTableGrid] = useState<{ rows: number; cols: number } | null>(
    null
  );
  const [tableRowsInput, setTableRowsInput] = useState(3);
  const [tableColsInput, setTableColsInput] = useState(3);
  const toolbarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openFlyout) {
      setShowTablePicker(false);
      setHoverTableGrid(null);
      return;
    }
    const onOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenFlyout(null);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFlyout(null);
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, [openFlyout]);

  if (collapsed) {
    return (
      <div className="no-print w-7 theme-surface border-r flex flex-col items-center py-2 shrink-0 z-20">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Expandir barra de herramientas"
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-70"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const toolBtnCls = (isActive: boolean) =>
    `w-10 h-10 flex items-center justify-center rounded-lg transition-colors relative ${
      isActive
        ? 'theme-accent-btn shadow-xs'
        : 'hover:bg-black/5 dark:hover:bg-white/10'
    }`;

  return (
    <aside
      ref={toolbarRef}
      className="no-print w-14 theme-surface border-r flex flex-col items-center py-2.5 gap-1.5 select-none shrink-0 z-40 relative"
    >
      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onSelectTool('select');
        }}
        className={toolBtnCls(activeTool === 'select')}
        title="Selección (V)"
      >
        <MousePointer2 className="w-4.5 h-4.5" />
      </button>

      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onSelectTool('hand');
        }}
        className={toolBtnCls(activeTool === 'hand')}
        title="Mano / Desplazar lienzo (H)"
      >
        <Hand className="w-4.5 h-4.5" />
      </button>

      <div className="w-8 border-t theme-border my-0.5" />

      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onSelectTool('pen');
        }}
        className={toolBtnCls(activeTool === 'pen')}
        title="Lápiz a mano alzada (P)"
      >
        <PenTool className="w-4.5 h-4.5" />
      </button>

      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onSelectTool('eraser');
        }}
        className={toolBtnCls(activeTool === 'eraser')}
        title="Borrador de trazos (E)"
      >
        <Eraser className="w-4.5 h-4.5" />
      </button>

      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onSelectTool('text');
        }}
        className={toolBtnCls(activeTool === 'text')}
        title="Cuadro de texto (T)"
      >
        <Type className="w-4.5 h-4.5" />
      </button>

      {/* Shapes with Floating Visual Window */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            onSelectTool('shape');
            setOpenFlyout(openFlyout === 'shape' ? null : 'shape');
          }}
          className={toolBtnCls(activeTool === 'shape')}
          title="Figuras geométricas 2D y Sólidos 3D (S)"
        >
          {activeShapeKind === 'circle' || activeShapeKind === 'ellipse' ? (
            <Circle className="w-4.5 h-4.5" />
          ) : activeShapeKind === 'triangle' || activeShapeKind === 'right-triangle' ? (
            <Triangle className="w-4.5 h-4.5" />
          ) : activeShapeKind === 'hexagon' || activeShapeKind === 'polygon' ? (
            <Hexagon className="w-4.5 h-4.5" />
          ) : (
            <Square className="w-4.5 h-4.5" />
          )}
          <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 border-r border-b border-current opacity-60" />
        </button>

        {openFlyout === 'shape' && (
          <div className="fixed left-16 top-20 w-[370px] max-w-[calc(100vw-5rem)] max-h-[78vh] theme-surface border rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b theme-border theme-surface-alt shrink-0">
              <span className="text-xs font-semibold">Figuras geométricas y Sólidos 3D</span>
              <button
                type="button"
                onClick={() => setOpenFlyout(null)}
                className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                title="Cerrar ventana"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-3 overflow-y-auto panel-scroll space-y-4">
              {SHAPE_CATALOG_GROUPS.map((group) => (
                <div key={group.id}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider opacity-65 mb-2">
                    {group.title}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {group.items.map((item) => {
                      const isSel = activeShapeKind === item.kind && activeTool === 'shape';
                      return (
                        <button
                          key={item.kind}
                          type="button"
                          onClick={() => {
                            onSelectShapeKind(item.kind);
                            onSelectTool('shape');
                            setOpenFlyout(null);
                          }}
                          className={`flex flex-col items-center justify-between gap-1 p-1.5 rounded-lg border transition-colors ${
                            isSel
                              ? 'theme-accent-soft border-current ring-1 ring-current'
                              : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                          title={item.label}
                        >
                          <div className="w-10 h-9 flex items-center justify-center">
                            <svg
                              viewBox="0 0 44 36"
                              className="w-10 h-8 overflow-visible"
                            >
                              {renderShapeSvgElement(item.kind, 44, 36, {
                                strokeColor: 'currentColor',
                                fillColor: 'transparent',
                                strokeWidth: 1.7,
                                strokeStyle: 'solid',
                                cornerRadius: 2,
                                polygonSides: 6,
                                arcStartAngle: 0,
                                arcEndAngle: 220,
                              })}
                            </svg>
                          </div>
                          <span className="text-[10px] leading-tight text-center line-clamp-2 w-full">
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lines & Connectors with Floating Visual Window */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            onSelectTool('line');
            setOpenFlyout(openFlyout === 'line' ? null : 'line');
          }}
          className={toolBtnCls(activeTool === 'line')}
          title="Líneas y conectores (L)"
        >
          {activeLineKind === 'line' ||
          activeLineKind === 'segment' ||
          activeLineKind === 'dashed-line' ? (
            <Minus className="w-4.5 h-4.5 -rotate-45" />
          ) : (
            <ArrowUpRight className="w-4.5 h-4.5" />
          )}
          <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 border-r border-b border-current opacity-60" />
        </button>

        {openFlyout === 'line' && (
          <div className="fixed left-16 top-40 w-[300px] max-w-[calc(100vw-5rem)] theme-surface border rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b theme-border theme-surface-alt shrink-0">
              <span className="text-xs font-semibold">Líneas y conectores</span>
              <button
                type="button"
                onClick={() => setOpenFlyout(null)}
                className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                title="Cerrar ventana"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {LINE_CATALOG.map((item) => {
                const isSel = activeLineKind === item.kind && activeTool === 'line';
                return (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => {
                      onSelectLineKind(item.kind);
                      onSelectTool('line');
                      setOpenFlyout(null);
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                      isSel
                        ? 'theme-accent-soft border-current ring-1 ring-current'
                        : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-center">
                      {renderLinePreviewSvg(item.kind, 'currentColor')}
                    </div>
                    <span className="text-[11px] font-medium text-center leading-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onSelectTool('cut');
        }}
        className={toolBtnCls(activeTool === 'cut')}
        title="Cortar / Recortar figuras y líneas (C)"
      >
        <Scissors className="w-4.5 h-4.5" />
      </button>

      <div className="w-8 border-t theme-border my-0.5" />

      {/* Editor de ecuaciones matemáticas visible directamente en la barra */}
      <button
        type="button"
        onClick={() => {
          setOpenFlyout(null);
          onOpenEquationModal();
        }}
        className={toolBtnCls(activeTool === 'equation')}
        title="Insertar fórmula matemática en vivo (M)"
      >
        <Sigma className="w-4.5 h-4.5" />
      </button>

      {/* Grupo unificado de inserción (Gráfica, Nota, Tabla e Importar) sin sobrecargar la barra */}
      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setOpenFlyout(openFlyout === 'insert' ? null : 'insert')
          }
          className={toolBtnCls(
            activeTool === 'graph' ||
              activeTool === 'sticky' ||
              openFlyout === 'insert'
          )}
          title="Insertar elementos (Gráfica, Nota, Tabla, Importar)"
        >
          <PlusSquare className="w-4.5 h-4.5" />
          <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 border-r border-b border-current opacity-60" />
        </button>

        {openFlyout === 'insert' && (
          <div className="fixed left-16 bottom-12 w-[264px] max-w-[calc(100vw-5rem)] theme-surface border rounded-xl shadow-2xl flex flex-col z-50 overflow-visible">
            <div className="flex items-center justify-between px-3.5 py-2 border-b theme-border theme-surface-alt shrink-0 rounded-t-xl">
              <span className="text-xs font-semibold">Insertar elemento</span>
              <button
                type="button"
                onClick={() => setOpenFlyout(null)}
                className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10"
                title="Cerrar ventana"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-2 space-y-1 text-xs">

              <button
                type="button"
                onClick={() => {
                  setOpenFlyout(null);
                  onOpenGraphModal();
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                  activeTool === 'graph'
                    ? 'theme-accent-soft font-medium'
                    : 'hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <LineChart className="w-4 h-4 opacity-80" />
                  <span>Plano y gráfica</span>
                </span>
                <span className="text-[10px] opacity-55 font-mono">G</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setOpenFlyout(null);
                  onSelectTool('sticky');
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                  activeTool === 'sticky'
                    ? 'theme-accent-soft font-medium'
                    : 'hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <StickyNote className="w-4 h-4 opacity-80" />
                  <span>Nota adhesiva</span>
                </span>
                <span className="text-[10px] opacity-55 font-mono">N</span>
              </button>

              {/* Opción Tabla con popover selector visual 8x8 + tamaño numérico */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTablePicker((v) => !v)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors ${
                    showTablePicker
                      ? 'theme-accent-soft font-medium'
                      : 'hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Table2 className="w-4 h-4 opacity-80" />
                    <span>Tabla</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                </button>

                {showTablePicker && (
                  <div className="mt-1.5 sm:mt-0 sm:absolute sm:left-full sm:bottom-0 sm:ml-2 w-[238px] theme-surface border rounded-xl shadow-2xl p-3 space-y-2.5 z-50">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold">Insertar tabla</span>
                      <span className="text-[11px] font-mono opacity-75">
                        {hoverTableGrid
                          ? `${hoverTableGrid.rows} × ${hoverTableGrid.cols}`
                          : `${tableRowsInput} × ${tableColsInput}`}
                      </span>
                    </div>

                    {/* Cuadrícula interactiva 8x8 estándar */}
                    <div
                      className="grid grid-cols-8 gap-1 p-1.5 rounded-lg border theme-border theme-surface-alt"
                      onMouseLeave={() => setHoverTableGrid(null)}
                    >
                      {Array.from({ length: 8 }).map((_, rIdx) =>
                        Array.from({ length: 8 }).map((__, cIdx) => {
                          const r = rIdx + 1;
                          const c = cIdx + 1;
                          const highlighted = hoverTableGrid
                            ? r <= hoverTableGrid.rows && c <= hoverTableGrid.cols
                            : r <= tableRowsInput && c <= tableColsInput;
                          return (
                            <button
                              key={`${r}-${c}`}
                              type="button"
                              onMouseEnter={() => setHoverTableGrid({ rows: r, cols: c })}
                              onClick={() => {
                                onInsertTable(r, c, 'center');
                                setOpenFlyout(null);
                              }}
                              title={`Insertar tabla de ${r} filas × ${c} columnas`}
                              className={`w-5 h-5 rounded-[3px] border transition-colors ${
                                highlighted
                                  ? 'bg-blue-600/80 border-blue-700'
                                  : 'bg-white/80 dark:bg-slate-900/70 border-slate-300 dark:border-slate-700 hover:border-blue-500'
                              }`}
                            />
                          );
                        })
                      )}
                    </div>

                    {/* Campos numéricos exactos (1..30 filas x 1..15 columnas) */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t theme-border">
                      <label className="block">
                        <span className="block text-[10px] opacity-70 mb-0.5">Filas (1–30)</span>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={tableRowsInput}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1)));
                            setTableRowsInput(n);
                          }}
                          className="w-full rounded border theme-border bg-transparent px-2 py-1 text-xs font-mono"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[10px] opacity-70 mb-0.5">Columnas (1–15)</span>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={tableColsInput}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(15, Math.round(Number(e.target.value) || 1)));
                            setTableColsInput(n);
                          }}
                          className="w-full rounded border theme-border bg-transparent px-2 py-1 text-xs font-mono"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onInsertTable(tableRowsInput, tableColsInput, 'center');
                          setOpenFlyout(null);
                        }}
                        className="flex-1 py-1.5 px-2.5 rounded-lg theme-accent-btn text-[11px] font-semibold"
                      >
                        Insertar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onInsertTable(tableRowsInput, tableColsInput, 'click');
                          setOpenFlyout(null);
                        }}
                        title="Haz clic en un punto del lienzo para colocar la tabla ahí"
                        className="py-1.5 px-2 rounded-lg border theme-border hover:bg-black/5 dark:hover:bg-white/10 text-[10px] font-medium whitespace-nowrap"
                      >
                        Clic en lienzo
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t theme-border my-1" />

              <button
                type="button"
                onClick={() => {
                  setOpenFlyout(null);
                  onImportFileClick();
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                title="Importar imagen o documento (PNG, JPG, SVG, PDF, DOCX, XLSX, TXT)"
              >
                <span className="flex items-center gap-2.5">
                  <FileUp className="w-4 h-4 opacity-80" />
                  <span>Importar imagen o archivo</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-auto pt-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="Contraer barra izquierda"
          className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 opacity-65 hover:opacity-100"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
});

