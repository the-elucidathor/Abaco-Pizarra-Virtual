import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CornerDownLeft,
  Eraser,
  FastForward,
  Sparkles,
  X,
} from 'lucide-react';
import type { EquationObject } from '../../types/whiteboard';
import {
  BUILTIN_EQUATIONS,
  STRUCTURE_CATEGORIES,
  SYMBOL_GROUPS,
  renderKatexSafe,
} from '../../utils/equationCatalog';
// OPT: 1.1 — Re-render cuando KaTeX termine la carga diferida
import { useKatexReady } from '../../utils/katexLoader';
import { ColorSwatchPicker } from '../ColorSwatchPicker';
import { FontSizeInput } from '../FontSizeInput';

interface EquationEditorModalProps {
  initialEquation?: EquationObject | null;
  inlineMode?: boolean;
  isEditingInline?: boolean;
  initialLatex?: string;
  initialDisplayMode?: boolean;
  initialFontSize?: number;
  initialColor?: string;
  onClose: () => void;
  onConfirm: (data: {
    latex: string;
    fontSize: number;
    color: string;
    backgroundColor: string;
    displayMode?: boolean;
  }) => void;
}

export const EquationEditorModal: React.FC<EquationEditorModalProps> = ({
  initialEquation,
  inlineMode = false,
  isEditingInline = false,
  initialLatex,
  initialDisplayMode = false,
  initialFontSize,
  initialColor,
  onClose,
  onConfirm,
}) => {
  const [latex, setLatex] = useState(
    initialEquation?.latex ??
      initialLatex ??
      (inlineMode ? 'x^2 + y^2 = r^2' : 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')
  );
  // V1.11.8-7c: Ecuaciones nuevas con tamaño 12 por defecto sin afectar existentes
  const [fontSize, setFontSize] = useState(
    initialEquation?.fontSize || initialFontSize || (inlineMode ? 18 : 12)
  );
  const [color, setColor] = useState(initialEquation?.color || initialColor || '#0f172a');
  const [backgroundColor, setBackgroundColor] = useState(
    initialEquation?.backgroundColor || '#ffffff'
  );
  const [displayMode, setDisplayMode] = useState<boolean>(
    inlineMode ? Boolean(initialDisplayMode) : true
  );
  const [symbolGroupId, setSymbolGroupId] = useState<string>('basic');
  const [openStructureId, setOpenStructureId] = useState<string | null>(null);
  const [openBuiltins, setOpenBuiltins] = useState(false);
  const [slotValue, setSlotValue] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);

  const katexReady = useKatexReady();

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

  const previewHtml = useMemo(
    () =>
      renderKatexSafe(
        latex.trim() ? latex : '\\text{Escriba aquí la ecuación...}',
        inlineMode ? displayMode : true
      ),
    [latex, katexReady, inlineMode, displayMode]
  );

  const placeholderCount = useMemo(
    () => (latex.match(/\\square/g) || []).length,
    [latex]
  );

  const insertSnippet = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      setLatex((prev) => prev + snippet);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selectedText = latex.slice(start, end);

    let finalSnippet = snippet;
    // If user selected text (other than \square) and snippet has \square, wrap it into the first \square
    if (selectedText && selectedText !== '\\square' && snippet.includes('\\square')) {
      finalSnippet = snippet.replace('\\square', selectedText);
    }

    const next = latex.slice(0, start) + finalSnippet + latex.slice(end);
    setLatex(next);

    requestAnimationFrame(() => {
      const sqOffset = finalSnippet.indexOf('\\square');
      if (sqOffset !== -1) {
        const absStart = start + sqOffset;
        el.focus();
        el.setSelectionRange(absStart, absStart + '\\square'.length);
      } else {
        el.focus();
        const pos = start + finalSnippet.length;
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const selectNextPlaceholder = () => {
    const el = textareaRef.current;
    if (!el) return;
    const after = el.selectionEnd ?? 0;
    let idx = latex.indexOf('\\square', after);
    if (idx === -1) idx = latex.indexOf('\\square', 0);
    if (idx !== -1) {
      el.focus();
      el.setSelectionRange(idx, idx + '\\square'.length);
    }
  };

  const fillNextPlaceholder = () => {
    const replacement = slotValue.trim();
    if (!replacement) return;
    const idx = latex.indexOf('\\square');
    if (idx === -1) {
      insertSnippet(replacement);
      setSlotValue('');
      return;
    }
    const next = latex.slice(0, idx) + replacement + latex.slice(idx + '\\square'.length);
    setLatex(next);
    setSlotValue('');
    requestAnimationFrame(() => {
      slotInputRef.current?.focus();
    });
  };

  const currentSymbolGroup =
    SYMBOL_GROUPS.find((g) => g.id === symbolGroupId) || SYMBOL_GROUPS[0];
  const openStructure =
    STRUCTURE_CATEGORIES.find((c) => c.id === openStructureId) || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-[1px] p-3 sm:p-5">
      <div className="w-full max-w-5xl theme-surface border rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Title Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b theme-border theme-surface-alt shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 text-[11px] font-bold rounded theme-accent-btn">
              fx
            </span>
            <h2 className="text-sm font-semibold">
              {inlineMode
                ? isEditingInline
                  ? 'Ecuación en texto — Editar'
                  : 'Ecuación dentro del texto'
                : initialEquation
                ? 'Diseño de Ecuación — Editar'
                : 'Diseño de Ecuación'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Visual Math Ribbon */}
        <div
          ref={ribbonRef}
          className="relative border-b theme-border theme-surface-alt px-3 py-2 shrink-0 select-none"
        >
          <div className="flex flex-wrap lg:flex-nowrap items-stretch gap-3">
            {/* Group 1: Herramientas (Built-in Equations) */}
            <div className="flex flex-col justify-between pr-3 border-r theme-border shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenBuiltins((v) => !v);
                      setOpenStructureId(null);
                    }}
                    className="flex flex-col items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 text-[11px] font-medium h-[58px]"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="flex items-center gap-0.5 whitespace-nowrap">
                      Ecuación
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </span>
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
                          onClick={() => {
                            setLatex(eq.latex);
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
                  onClick={() => setLatex('')}
                  title="Vaciar ecuación"
                  className="flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-md border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 text-[11px] h-[58px]"
                >
                  <Eraser className="w-4 h-4 opacity-80" />
                  <span>Limpiar</span>
                </button>
              </div>
              <div className="text-[10px] text-center opacity-60 mt-1">Herramientas</div>
            </div>

            {/* Group 2: Símbolos */}
            <div className="flex flex-col justify-between pr-3 border-r theme-border min-w-[235px] max-w-[300px]">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <select
                    value={symbolGroupId}
                    onChange={(e) => setSymbolGroupId(e.target.value)}
                    className="text-[11px] font-medium rounded border theme-border theme-surface px-1.5 py-0.5 w-full"
                  >
                    {SYMBOL_GROUPS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-8 gap-0.5 max-h-[38px] overflow-y-auto panel-scroll">
                  {currentSymbolGroup.items.map((sym) => (
                    <button
                      key={sym.title}
                      type="button"
                      title={sym.title}
                      onClick={() => insertSnippet(sym.snippet)}
                      className="h-7 flex items-center justify-center text-sm rounded border border-transparent hover:border-current/20 theme-surface hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    >
                      {sym.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-center opacity-60 mt-1">Símbolos</div>
            </div>

            {/* Group 3: Estructuras (Visual KaTeX Tiles) */}
            <div className="flex flex-col justify-between flex-1 min-w-0">
              <div className="flex items-center gap-1 overflow-x-auto panel-scroll pb-0.5">
                {STRUCTURE_CATEGORIES.map((cat) => {
                  const isOpen = openStructureId === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setOpenBuiltins(false);
                        setOpenStructureId(isOpen ? null : cat.id);
                      }}
                      className={`flex flex-col items-center justify-between px-2 py-1 rounded-md border h-[58px] min-w-[62px] shrink-0 transition-colors ${
                        isOpen
                          ? 'theme-accent-soft border-current ring-1 ring-current'
                          : 'theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                      title={`Insertar estructura: ${cat.label}`}
                    >
                      <span
                        className="katex-tile h-7 flex items-center justify-center pointer-events-none"
                        dangerouslySetInnerHTML={{
                          __html: renderKatexSafe(cat.iconLatex),
                        }}
                      />
                      <span className="text-[10px] leading-tight flex items-center gap-0.5 whitespace-nowrap">
                        {cat.label}
                        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-center opacity-60 mt-1">Estructuras</div>
            </div>
          </div>

          {/* Structure Dropdown Visual Gallery */}
          {openStructure && (
            <div className="absolute left-3 right-3 top-full mt-1 theme-surface border rounded-xl shadow-2xl p-3 z-50">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b theme-border">
                <span className="text-xs font-semibold">
                  Estructuras de {openStructure.label}
                </span>
                <button
                  type="button"
                  onClick={() => setOpenStructureId(null)}
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-60 overflow-y-auto panel-scroll">
                {openStructure.items.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => {
                      insertSnippet(item.snippet);
                      setOpenStructureId(null);
                    }}
                    className="flex flex-col items-center justify-between gap-1.5 p-2 rounded-lg border theme-border hover:bg-black/5 dark:hover:bg-white/10 transition-colors min-h-[76px]"
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

        {/* Main Workspace */}
        <div className="p-4 sm:p-5 overflow-y-auto panel-scroll space-y-4">
          {/* Central Document-Style Equation Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] opacity-75">
              <span className="font-medium">Vista previa de la ecuación</span>
              {placeholderCount > 0 && (
                <span className="font-mono-tabular">
                  {placeholderCount} {placeholderCount === 1 ? 'hueco (□) pendiente' : 'huecos (□) pendientes'}
                </span>
              )}
            </div>
            <div
              className="min-h-[120px] rounded-xl border-2 border-dashed theme-border flex items-center justify-center p-5 overflow-x-auto shadow-inner"
              style={{
                backgroundColor:
                  backgroundColor === 'transparent' ? '#ffffff' : backgroundColor,
                color,
                fontSize: `${fontSize}px`,
              }}
            >
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>

            {/* Interactive Placeholder Filler Bar (No LaTeX knowledge needed) */}
            <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg theme-surface-alt border theme-border">
              <input
                ref={slotInputRef}
                type="text"
                value={slotValue}
                onChange={(e) => setSlotValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    fillNextPlaceholder();
                  }
                }}
                placeholder={
                  placeholderCount > 0
                    ? 'Escribe un valor para rellenar el siguiente hueco □ (ej. x^2 + 1)'
                    : 'Escribe una expresión para insertar en el cursor...'
                }
                className="flex-1 min-w-[220px] rounded-md border theme-border theme-surface px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-current/30"
              />
              <button
                type="button"
                onClick={fillNextPlaceholder}
                disabled={!slotValue.trim()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium theme-accent-btn disabled:opacity-40 whitespace-nowrap"
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
                {placeholderCount > 0 ? 'Rellenar □' : 'Insertar'}
              </button>
              {placeholderCount > 0 && (
                <button
                  type="button"
                  onClick={selectNextPlaceholder}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap"
                  title="Seleccionar el siguiente hueco □ en el código"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  Siguiente □
                </button>
              )}
            </div>
          </div>

          {/* Synchronized LaTeX Source */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold opacity-85">
                Expresión editable (LaTeX / formato matemático)
              </label>
              <span className="text-[11px] opacity-65">
                Consejo: selecciona texto antes de pulsar Fracción o Radical para envolverlo automáticamente
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              rows={2}
              className="w-full rounded-lg border theme-border theme-surface px-3 py-2 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-current/30"
              placeholder="Ej. \frac{d}{dx} (x^3) = 3x^2"
            />
          </div>

          {/* Style Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-xs font-medium opacity-80">
                  Tamaño (px)
                </label>
                <FontSizeInput
                  variant="inspector"
                  min={8}
                  max={96}
                  value={fontSize}
                  onCommit={setFontSize}
                  onStep={(d) => setFontSize((v) => Math.max(8, Math.min(96, v + d)))}
                  ariaLabel="Tamaño de ecuación en modal"
                />
              </div>
              <input
                type="range"
                min={8}
                max={96}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium opacity-80 mb-1">
                Color de tinta
              </label>
              <div className="flex items-center gap-2">
                <ColorSwatchPicker
                  value={color}
                  label={color.toUpperCase()}
                  onPreviewColor={setColor}
                  onCommitColor={setColor}
                  title="Color de tinta"
                />
              </div>
            </div>
            <div>
              {inlineMode ? (
                <>
                  <label className="block text-xs font-medium opacity-80 mb-1">
                    Disposición en el texto
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDisplayMode(false)}
                      className={`px-2.5 py-1 text-xs rounded border ${
                        !displayMode
                          ? 'theme-accent-soft border-current font-medium'
                          : 'theme-border'
                      }`}
                    >
                      En línea
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisplayMode(true)}
                      className={`px-2.5 py-1 text-xs rounded border ${
                        displayMode
                          ? 'theme-accent-soft border-current font-medium'
                          : 'theme-border'
                      }`}
                    >
                      En bloque
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-xs font-medium opacity-80 mb-1">
                    Fondo de la ecuación
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBackgroundColor('transparent')}
                      className={`px-2 py-1 text-xs rounded border ${
                        backgroundColor === 'transparent'
                          ? 'theme-accent-soft border-current font-medium'
                          : 'theme-border'
                      }`}
                    >
                      Transparente
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackgroundColor('#ffffff')}
                      className={`px-2 py-1 text-xs rounded border ${
                        backgroundColor === '#ffffff'
                          ? 'theme-accent-soft border-current font-medium'
                          : 'theme-border'
                      }`}
                    >
                      Blanco
                    </button>
                    <ColorSwatchPicker
                      compact
                      allowTransparent
                      value={backgroundColor}
                      onPreviewColor={setBackgroundColor}
                      onCommitColor={setBackgroundColor}
                      title="Color de fondo"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t theme-border theme-surface-alt shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap shrink-0"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({
                latex: latex.trim() || 'x',
                fontSize,
                color,
                backgroundColor,
                ...(inlineMode ? { displayMode } : {}),
              })
            }
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium theme-accent-btn rounded-lg whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            {inlineMode
              ? isEditingInline
                ? 'Actualizar ecuación'
                : 'Insertar en texto'
              : initialEquation
              ? 'Guardar cambios'
              : 'Insertar en lienzo'}
          </button>
        </div>
      </div>
    </div>
  );
};
