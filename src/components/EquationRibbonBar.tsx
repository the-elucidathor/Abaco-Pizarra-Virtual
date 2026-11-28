import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eraser,
  FastForward,
  Maximize2,
  Sparkles,
  X,
} from 'lucide-react';
import type { EquationObject } from '../types/whiteboard';
import {
  BUILTIN_EQUATIONS,
  STRUCTURE_CATEGORIES,
  SYMBOL_GROUPS,
  renderKatexSafe,
} from '../utils/equationCatalog';
// OPT: 1.1 — Fuerza actualización de miniaturas en cuanto KaTeX termine su carga diferida
import { useKatexReady } from '../utils/katexLoader';
import { MATH_RELATIVE_SIZE_OPTIONS } from '../utils/latexEditorEngine';
import { ColorSwatchPicker } from './ColorSwatchPicker';
import { FontSizeInput } from './FontSizeInput';

interface EquationRibbonBarProps {
  equation: EquationObject;
  placeholderCount: number;
  inlineMode?: boolean;
  displayMode?: boolean;
  hasSubselection?: boolean;
  customSwatches?: string[];
  onUpdateCustomSwatches?: (next: string[]) => void;
  onStartColorPreview?: () => void;
  onPreviewColor?: (color: string) => void;
  onCommitColor?: (color: string) => void;
  onCancelColorPreview?: () => void;
  onApplySelectionColor?: (color: string) => void;
  onApplySelectionRelativeSize?: (sizeCmd: string) => void;
  onToggleDisplayMode?: (displayMode: boolean) => void;
  onInsertSnippet: (snippet: string) => void;
  onReplaceLatex: (latex: string) => void;
  onUpdateMeta: (patch: Partial<EquationObject>) => void;
  onJumpNextPlaceholder: () => void;
  onOpenExpandedModal: () => void;
  onFinish: () => void;
}

// OPT: 2.6 — Memoriza cinta superior de ecuaciones
export const EquationRibbonBar: React.FC<EquationRibbonBarProps> = React.memo(({
  equation,
  placeholderCount,
  inlineMode = false,
  displayMode = false,
  hasSubselection = false,
  customSwatches,
  onUpdateCustomSwatches,
  onStartColorPreview,
  onPreviewColor,
  onCommitColor,
  onCancelColorPreview,
  onApplySelectionColor,
  onApplySelectionRelativeSize,
  onToggleDisplayMode,
  onInsertSnippet,
  onReplaceLatex,
  onUpdateMeta,
  onJumpNextPlaceholder,
  onOpenExpandedModal,
  onFinish,
}) => {
  const [symbolGroupId, setSymbolGroupId] = useState<string>('basic');
  const [openStructureId, setOpenStructureId] = useState<string | null>(null);
  const [openBuiltins, setOpenBuiltins] = useState(false);
  const katexReady = useKatexReady();
  void katexReady;
  const ribbonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ribbonRef.current && !ribbonRef.current.contains(e.target as Node)) {
        setOpenStructureId(null);
        setOpenBuiltins(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const currentSymbolGroup =
    SYMBOL_GROUPS.find((g) => g.id === symbolGroupId) || SYMBOL_GROUPS[0];
  const openStructure =
    STRUCTURE_CATEGORIES.find((c) => c.id === openStructureId) || null;

  return (
    <div
      ref={ribbonRef}
      data-export-ignore="true"
      onPointerDown={(e) => e.stopPropagation()}
      className="no-print relative z-30 border-b theme-border theme-surface-alt px-3 py-1.5 select-none shadow-xs"
    >
      <div className="flex flex-wrap xl:flex-nowrap items-center gap-2.5">
        {/* Group 1: Ecuaciones integradas + Limpiar */}
        <div className="flex items-center gap-1 pr-2.5 border-r theme-border shrink-0">
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpenBuiltins((v) => !v);
                setOpenStructureId(null);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 text-[11px] font-medium h-9 whitespace-nowrap"
              title="Ecuaciones integradas"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Ecuación</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openBuiltins && (
              <div className="absolute left-0 top-full mt-1 w-72 theme-surface border rounded-lg shadow-xl py-1.5 z-50 max-h-80 overflow-y-auto panel-scroll">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
                  Ecuaciones integradas
                </div>
                {BUILTIN_EQUATIONS.map((eq) => (
                  <button
                    key={eq.name}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onReplaceLatex(eq.latex);
                      setOpenBuiltins(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10 border-b last:border-b-0 theme-border flex flex-col gap-1"
                  >
                    <span className="text-[11px] font-medium">{eq.name}</span>
                    <span
                      className="katex-tile text-xs overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: renderKatexSafe(eq.latex) }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsertSnippet('\\ ')}
            title="Insertar espacio (barra espaciadora)"
            className="px-2 rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 h-9 flex items-center justify-center text-[11px] font-medium"
          >
            ⎵
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsertSnippet('\\,')}
            title="Insertar espacio fino (Shift+Espacio)"
            className="px-2 rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 h-9 flex items-center justify-center text-[11px] font-medium"
          >
            ␣
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onReplaceLatex('\\square')}
            title="Vaciar ecuación"
            className="p-1.5 rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 h-9 flex items-center justify-center"
          >
            <Eraser className="w-3.5 h-3.5 opacity-80" />
          </button>
        </div>

        {/* Group 2: Símbolos rápidos */}
        <div className="flex items-center gap-1.5 pr-2.5 border-r theme-border shrink-0">
          <select
            value={symbolGroupId}
            onChange={(e) => setSymbolGroupId(e.target.value)}
            className="text-[11px] rounded border theme-border theme-surface px-1.5 py-1 h-9 max-w-[122px]"
            title="Categoría de símbolos"
          >
            {SYMBOL_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-0.5 max-w-[230px] overflow-x-auto panel-scroll">
            {currentSymbolGroup.items.slice(0, 12).map((sym) => (
              <button
                key={sym.title}
                type="button"
                title={sym.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onInsertSnippet(sym.snippet)}
                className="w-7 h-8 shrink-0 flex items-center justify-center text-sm rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                {sym.label}
              </button>
            ))}
          </div>
        </div>

        {/* Group 3: Estructuras de cinta visual con vista KaTeX */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto panel-scroll">
          {STRUCTURE_CATEGORIES.map((cat) => {
            const isOpen = openStructureId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpenBuiltins(false);
                  setOpenStructureId(isOpen ? null : cat.id);
                }}
                className={`flex flex-col items-center justify-between px-1.5 py-0.5 rounded border h-11 min-w-[54px] shrink-0 transition-colors ${
                  isOpen
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10'
                }`}
                title={`Estructuras: ${cat.label}`}
              >
                <span
                  className="katex-tile h-5 flex items-center justify-center pointer-events-none text-[11px]"
                  dangerouslySetInnerHTML={{
                    __html: renderKatexSafe(cat.iconLatex),
                  }}
                />
                <span className="text-[9px] leading-tight flex items-center gap-0.5 whitespace-nowrap">
                  {cat.label}
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </span>
              </button>
            );
          })}
        </div>

        {/* Group 4: Formato + Siguiente hueco + Listo */}
        <div className="flex items-center gap-1.5 pl-2 border-l theme-border shrink-0">
          {inlineMode && onToggleDisplayMode && (
            <div
              className="inline-flex items-center rounded border theme-border theme-surface overflow-hidden"
              title="Modo de presentación dentro del texto"
            >
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onToggleDisplayMode(false)}
                className={`px-1.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors ${
                  !displayMode
                    ? 'theme-accent-btn'
                    : 'hover:bg-black/5 dark:hover:bg-white/10 opacity-80'
                }`}
              >
                En línea
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onToggleDisplayMode(true)}
                className={`px-1.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors ${
                  displayMode
                    ? 'theme-accent-btn'
                    : 'hover:bg-black/5 dark:hover:bg-white/10 opacity-80'
                }`}
              >
                En bloque
              </button>
            </div>
          )}

          {placeholderCount > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onJumpNextPlaceholder}
              className="flex items-center gap-1 px-2 py-1.5 rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 text-[11px] font-medium whitespace-nowrap"
              title="Saltar al siguiente hueco □ (Tab)"
            >
              <FastForward className="w-3 h-3" />
              <span>□ ({placeholderCount})</span>
            </button>
          )}

          {/* V1.11.8-7c: Control numérico unificado de tamaño (8-96 px) */}
          <div className="hidden sm:flex items-center gap-0.5 border theme-border rounded theme-surface px-1 py-0.5">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                onUpdateMeta({ fontSize: Math.max(8, equation.fontSize - 2) })
              }
              className="px-1 py-0.5 text-[11px] rounded hover:bg-black/5 dark:hover:bg-white/10"
              title="Reducir tamaño"
            >
              A-
            </button>
            <FontSizeInput
              variant="toolbar"
              min={8}
              max={96}
              value={equation.fontSize}
              onCommit={(nextSize) => onUpdateMeta({ fontSize: nextSize })}
              onStep={(delta) =>
                onUpdateMeta({ fontSize: Math.max(8, Math.min(96, equation.fontSize + delta)) })
              }
              ariaLabel="Tamaño de ecuación (px)"
              title="Tamaño de ecuación (8–96 px)"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                onUpdateMeta({ fontSize: Math.min(96, equation.fontSize + 2) })
              }
              className="px-1 py-0.5 text-[11px] rounded hover:bg-black/5 dark:hover:bg-white/10"
              title="Aumentar tamaño"
            >
              A+
            </button>
          </div>

          {/* V1.11.8-7d: Tamaño relativo KaTeX nativo para subselección parcial */}
          {!inlineMode && onApplySelectionRelativeSize && (
            <select
              value=""
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (!e.target.value) return;
                onApplySelectionRelativeSize(e.target.value);
              }}
              title={
                hasSubselection
                  ? 'Aplicar tamaño relativo KaTeX a la parte seleccionada'
                  : 'Tamaño relativo KaTeX en posición/selección actual'
              }
              className={`text-[10px] rounded border px-1.5 py-1 h-7 max-w-[96px] theme-surface ${
                hasSubselection ? 'border-blue-500 text-blue-600 dark:text-blue-300 font-medium' : 'theme-border'
              }`}
            >
              <option value="">{hasSubselection ? 'Tam. sel.' : 'Tam. KaTeX'}</option>
              {MATH_RELATIVE_SIZE_OPTIONS.map((opt) => (
                <option key={opt.cmd} value={opt.cmd}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {/* V1.11.8-5, 7d, 8: Paleta rápida de 18 + 4 personalizados (global o subselección) */}
          <ColorSwatchPicker
            compact
            value={equation.color}
            customSwatches={customSwatches}
            onUpdateCustomSwatches={onUpdateCustomSwatches}
            label={hasSubselection && onApplySelectionColor ? 'Sel.' : undefined}
            title={
              hasSubselection && onApplySelectionColor
                ? 'Color para parte seleccionada (\textcolor)'
                : 'Color de tinta de la ecuación'
            }
            onStartPreview={
              hasSubselection && onApplySelectionColor ? undefined : onStartColorPreview
            }
            onPreviewColor={
              hasSubselection && onApplySelectionColor
                ? undefined
                : onPreviewColor ?? ((c) => onUpdateMeta({ color: c }))
            }
            onCommitColor={(c) => {
              if (hasSubselection && onApplySelectionColor) {
                onApplySelectionColor(c);
              } else if (onCommitColor) {
                onCommitColor(c);
              } else {
                onUpdateMeta({ color: c });
              }
            }}
            onCancelPreview={
              hasSubselection && onApplySelectionColor ? undefined : onCancelColorPreview
            }
          />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOpenExpandedModal}
            title="Abrir editor ampliado"
            className="p-1.5 rounded border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onFinish}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium theme-accent-btn whitespace-nowrap shrink-0"
            title="Finalizar edición (Esc)"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Listo</span>
          </button>
        </div>
      </div>

      {/* Dropdown Visual Gallery for Structures */}
      {openStructure && (
        <div className="absolute left-3 right-3 top-full mt-1 theme-surface border rounded-xl shadow-2xl p-3 z-50">
          <div className="flex items-center justify-between mb-2 pb-1.5 border-b theme-border">
            <span className="text-xs font-semibold">
              Estructuras de {openStructure.label}
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpenStructureId(null)}
              className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 max-h-56 overflow-y-auto panel-scroll">
            {openStructure.items.map((item) => (
              <button
                key={item.title}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onInsertSnippet(item.snippet);
                  setOpenStructureId(null);
                }}
                className="flex flex-col items-center justify-between gap-1 p-2 rounded-lg border theme-border hover:bg-black/5 dark:hover:bg-white/10 transition-colors min-h-[70px]"
                title={item.title}
              >
                <div
                  className="katex-tile flex-1 flex items-center justify-center text-sm pointer-events-none"
                  dangerouslySetInnerHTML={{
                    __html: renderKatexSafe(item.previewLatex, true),
                  }}
                />
                <span className="text-[10px] leading-tight text-center opacity-80">
                  {item.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

