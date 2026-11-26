import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
// OPT: 1.1 — Carga diferida de KaTeX bajo demanda
import {
  renderKatexToStringLazy,
  renderLatexFallbackHtml,
  useKatexReady,
} from '../../utils/katexLoader';
import { Check, ChevronDown, GripVertical, Maximize2 } from 'lucide-react';
import type { EquationObject } from '../../types/whiteboard';
import { BUILTIN_EQUATIONS } from '../../utils/equationCatalog';
import {
  type MathCursor,
  applyBackspaceAtCursor,
  applyDeleteAtCursor,
  applyTextInputAtCursor,
  decodePath,
  getInitialEditCursor,
  getSeqAtPath,
  insertMathSpaceAtCursor,
  jumpToNextSlotCursor,
  parseLatexToAst,
  renderInteractiveEquationHtml,
  stepCursorLeft,
  stepCursorRight,
  stepCursorVertical,
} from '../../utils/latexEditorEngine';

interface EquationNodeViewProps {
  obj: EquationObject;
  isEditing?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  cursor?: MathCursor;
  onCursorChange?: (cursor: MathCursor) => void;
  onChangeLatex?: (latex: string, recordHistory?: boolean) => void;
  onUpdateMeta?: (patch: Partial<EquationObject>) => void;
  onAutoResize?: (width: number, height: number) => void;
  onFinishEditing?: () => void;
  onOpenFullModal?: () => void;
  onGripPointerDown?: (e: React.PointerEvent) => void;
}

const DEFAULT_CURSOR: MathCursor = { path: [], offset: 0 };

// OPT: 2.6 — Evita re-renderizar ecuaciones KaTeX cuando no cambian sus props
export const EquationNodeView: React.FC<EquationNodeViewProps> = React.memo(({
  obj,
  isEditing = false,
  inputRef,
  cursor = DEFAULT_CURSOR,
  onCursorChange,
  onChangeLatex,
  onUpdateMeta,
  onAutoResize,
  onFinishEditing,
  onOpenFullModal,
  onGripPointerDown,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const katexReady = useKatexReady();
  const katexWrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setMenuOpen(false);
    }
  }, [isEditing]);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [menuOpen]);

  const html = useMemo(() => {
    if (isEditing) {
      return renderInteractiveEquationHtml(obj.latex || '\\square', cursor);
    }
    try {
      const rendered = renderKatexToStringLazy(obj.latex || '\\text{Ecuación}', {
        displayMode: true,
        throwOnError: false,
        strict: false,
      });
      if (rendered !== null) return rendered;
      return renderLatexFallbackHtml(obj.latex || '');
    } catch {
      return renderLatexFallbackHtml(obj.latex || '');
    }
  }, [obj.latex, isEditing, cursor, katexReady]);

  // Auto-grow container dimensions when live editing so complex expressions never clip
  useLayoutEffect(() => {
    if (!isEditing || !katexWrapRef.current || !onAutoResize) return;
    const el = katexWrapRef.current;
    const neededW = Math.max(220, Math.ceil(el.scrollWidth + 58));
    const neededH = Math.max(76, Math.ceil(el.scrollHeight + 28));
    if (neededW > obj.width + 4 || neededH > obj.height + 4) {
      onAutoResize(Math.max(obj.width, neededW), Math.max(obj.height, neededH));
    }
  }, [html, isEditing, obj.fontSize, obj.width, obj.height, onAutoResize]);

  const handleEquationClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    inputRef?.current?.focus();
    if (!onCursorChange || !katexWrapRef.current) return;

    const container = katexWrapRef.current;
    const htmlRoot = container.querySelector('.katex-html');
    if (!htmlRoot) return;

    const target = e.target as HTMLElement | null;
    let matchedEl = target?.closest('[data-p][data-i]') as HTMLElement | null;
    if (matchedEl && !htmlRoot.contains(matchedEl)) {
      matchedEl = null;
    }

    if (!matchedEl) {
      const atoms = Array.from(htmlRoot.querySelectorAll<HTMLElement>('[data-p][data-i]'));
      if (atoms.length === 0) {
        onCursorChange({ path: [], offset: 0 });
        return;
      }

      // Check if click was far to the left or right of the entire root equation
      const rootRect = htmlRoot.getBoundingClientRect();
      if (e.clientX < rootRect.left - 8) {
        onCursorChange({ path: [], offset: 0 });
        return;
      }
      if (e.clientX > rootRect.right + 8) {
        const ast = parseLatexToAst(obj.latex);
        onCursorChange({ path: [], offset: ast.length });
        return;
      }

      let bestDist = Infinity;
      for (const atom of atoms) {
        const r = atom.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const dx =
          e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0;
        const dy =
          e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
        const dist = dx + dy * 2.5;
        if (dist < bestDist) {
          bestDist = dist;
          matchedEl = atom;
        }
      }
    }

    if (!matchedEl) return;

    const path = decodePath(matchedEl.getAttribute('data-p') || 'r');
    const idx = Number(matchedEl.getAttribute('data-i') || '0');
    const isSlot = matchedEl.getAttribute('data-s') === '1';

    if (isSlot) {
      onCursorChange({ path, offset: idx });
      return;
    }

    const rect = matchedEl.getBoundingClientRect();
    const goAfter = e.clientX >= rect.left + rect.width / 2;
    onCursorChange({ path, offset: goAfter ? idx + 1 : idx });
  };

  const commitTextChunk = (raw: string) => {
    if (!raw || !onChangeLatex || !onCursorChange) return;
    const next = applyTextInputAtCursor(obj.latex, cursor, raw);
    onChangeLatex(next.latex, false);
    onCursorChange(next.cursor);
  };

  const handleHiddenKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      onFinishEditing?.();
      return;
    }

    // Espacio: espacio visible persistente (\ ); Shift+Espacio: espacio fino (\,)
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!onChangeLatex || !onCursorChange) return;
      const next = insertMathSpaceAtCursor(
        obj.latex,
        cursor,
        e.shiftKey ? 'thin' : 'normal'
      );
      onChangeLatex(next.latex, false);
      onCursorChange(next.cursor);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!onCursorChange) return;
      onCursorChange(jumpToNextSlotCursor(obj.latex, cursor, e.shiftKey));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (obj.latex.includes('\\square') && !e.ctrlKey && !e.metaKey) {
        onCursorChange?.(jumpToNextSlotCursor(obj.latex, cursor, false));
      } else {
        onFinishEditing?.();
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onCursorChange?.(stepCursorLeft(obj.latex, cursor));
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onCursorChange?.(stepCursorRight(obj.latex, cursor));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onCursorChange?.(stepCursorVertical(obj.latex, cursor, 'up'));
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onCursorChange?.(stepCursorVertical(obj.latex, cursor, 'down'));
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      onCursorChange?.({
        path: cursor.offset === 0 ? [] : cursor.path,
        offset: 0,
      });
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      const ast = parseLatexToAst(obj.latex);
      const seq = getSeqAtPath(ast, cursor.path);
      onCursorChange?.({
        path: cursor.path,
        offset: seq ? seq.length : ast.length,
      });
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      if (!onChangeLatex || !onCursorChange) return;
      const next = applyBackspaceAtCursor(obj.latex, cursor);
      onChangeLatex(next.latex, false);
      onCursorChange(next.cursor);
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      if (!onChangeLatex || !onCursorChange) return;
      const next = applyDeleteAtCursor(obj.latex, cursor);
      onChangeLatex(next.latex, false);
      onCursorChange(next.cursor);
    }
  };

  if (!isEditing) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center px-3 py-2 rounded-md overflow-hidden select-none katex-canvas-node ${
          obj.backgroundColor === 'transparent'
            ? 'border border-transparent'
            : 'border border-slate-200/80 dark:border-slate-700/80 shadow-xs'
        }`}
        style={{
          backgroundColor:
            obj.backgroundColor === 'transparent' ? 'transparent' : obj.backgroundColor,
          color: obj.color,
          fontSize: `${obj.fontSize}px`,
        }}
      >
        <div
          className="max-w-full overflow-hidden"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full flex items-stretch bg-white border border-slate-400 shadow-lg rounded-xs katex-canvas-node"
      style={{
        backgroundColor:
          obj.backgroundColor === 'transparent' ? '#ffffff' : obj.backgroundColor,
        color: obj.color,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Hidden input that captures direct keyboard & IME input inside the equation without any visible text bar */}
      <input
        ref={inputRef}
        type="text"
        aria-label="Entrada directa de ecuación"
        value=""
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          isComposingRef.current = false;
          const val = (e.target as HTMLInputElement).value;
          (e.target as HTMLInputElement).value = '';
          if (val) commitTextChunk(val);
        }}
        onChange={(e) => {
          if (isComposingRef.current) return;
          const val = e.target.value;
          e.target.value = '';
          if (val) commitTextChunk(val);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text) {
            e.preventDefault();
            commitTextChunk(text);
          }
        }}
        onKeyDown={handleHiddenKeyDown}
        className="opacity-0 absolute w-px h-px pointer-events-none -z-10"
      />

      {/* Top-left editor-style drag grip */}
      <div
        data-export-ignore="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          onGripPointerDown?.(e);
        }}
        title="Arrastrar ecuación"
        className="absolute -left-5 top-0 w-5 h-7 bg-slate-200 hover:bg-slate-300 border border-slate-400 border-r-0 rounded-l-xs flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-600"
      >
        <GripVertical className="w-3 h-3" />
      </div>

      {/* Live interactive KaTeX equation surface — click & type directly inside */}
      <div
        className="flex-1 flex items-center justify-center px-4 py-2 overflow-visible cursor-text"
        style={{ fontSize: `${obj.fontSize}px` }}
        onMouseDown={(e) => {
          // Keep focus inside hidden input instead of losing it to non-focusable div
          e.preventDefault();
          inputRef?.current?.focus();
        }}
        onClick={handleEquationClick}
      >
        <div
          ref={katexWrapRef}
          className="whitespace-nowrap select-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {/* Editor-style right dropdown strip */}
      <div ref={menuRef} data-export-ignore="true" className="relative flex">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuOpen((v) => !v)}
          title="Opciones rápidas de ecuación"
          className="w-6 bg-slate-100 hover:bg-slate-200 border-l border-slate-300 flex items-end justify-center pb-1.5 text-slate-700"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-56 theme-surface border rounded-lg shadow-xl py-1 z-50 text-xs text-slate-800 dark:text-slate-100">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase opacity-60">
              Fondo de ecuación
            </div>
            <div className="px-3 pb-1.5 flex gap-1.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onUpdateMeta?.({ backgroundColor: 'transparent' });
                  setMenuOpen(false);
                }}
                className={`flex-1 py-1 rounded border text-[11px] ${
                  obj.backgroundColor === 'transparent'
                    ? 'theme-accent-soft border-current font-medium'
                    : 'theme-border'
                }`}
              >
                Transparente
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onUpdateMeta?.({ backgroundColor: '#ffffff' });
                  setMenuOpen(false);
                }}
                className={`flex-1 py-1 rounded border text-[11px] ${
                  obj.backgroundColor === '#ffffff'
                    ? 'theme-accent-soft border-current font-medium'
                    : 'theme-border'
                }`}
              >
                Blanco
              </button>
            </div>
            <div className="my-1 border-t theme-border" />
            <div className="px-3 py-1 text-[10px] font-semibold uppercase opacity-60">
              Ecuaciones rápidas
            </div>
            <div
              data-scrollable-content="true"
              style={{ overscrollBehavior: 'contain' }}
              className="max-h-36 overflow-y-auto panel-scroll overscroll-contain"
            >
              {BUILTIN_EQUATIONS.slice(0, 6).map((eq) => (
                <button
                  key={eq.name}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChangeLatex?.(eq.latex, true);
                    onCursorChange?.(getInitialEditCursor(eq.latex));
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10 truncate"
                >
                  {eq.name}
                </button>
              ))}
            </div>
            <div className="my-1 border-t theme-border" />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenuOpen(false);
                onOpenFullModal?.();
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1.5"
            >
              <Maximize2 className="w-3 h-3" />
              Editor LaTeX ampliado...
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenuOpen(false);
                onFinishEditing?.();
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1.5"
            >
              <Check className="w-3 h-3" />
              Finalizar edición (Esc)
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

