import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type CursorStep,
  type MathCursor,
  type MathSelectionRange,
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

// V1.11.8-7e: Límites mínimo y máximo para autoajuste de ecuaciones con scroll interno
const MIN_EQ_WIDTH = 64;
const MIN_EQ_HEIGHT = 36;
const MAX_EQ_WIDTH = 680;
const MAX_EQ_HEIGHT = 420;

interface EquationNodeViewProps {
  obj: EquationObject;
  isEditing?: boolean;
  // V1.11.8-7b: Translucidez mientras se arrastra para ver ecuaciones debajo
  isDragging?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  cursor?: MathCursor;
  // V1.11.8-7d: Rango de subselección dentro de la ecuación
  selection?: MathSelectionRange | null;
  onCursorChange?: (cursor: MathCursor) => void;
  onSelectionChange?: (selection: MathSelectionRange | null) => void;
  onChangeLatex?: (latex: string, recordHistory?: boolean) => void;
  onUpdateMeta?: (patch: Partial<EquationObject>) => void;
  onAutoResize?: (width: number, height: number) => void;
  onFinishEditing?: () => void;
  onOpenFullModal?: () => void;
  onGripPointerDown?: (e: React.PointerEvent) => void;
}

const DEFAULT_CURSOR: MathCursor = { path: [], offset: 0 };

function pathsEqual(a: CursorStep[], b: CursorStep[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, idx) => s.nodeIdx === b[idx].nodeIdx && s.slot === b[idx].slot)
  );
}

// OPT: 2.6 — Evita re-renderizar ecuaciones KaTeX cuando no cambian sus props
export const EquationNodeView: React.FC<EquationNodeViewProps> = React.memo(({
  obj,
  isEditing = false,
  isDragging = false,
  inputRef,
  cursor = DEFAULT_CURSOR,
  selection = null,
  onCursorChange,
  onSelectionChange,
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
  const dragSelectingRef = useRef(false);
  const dragAnchorRef = useRef<MathCursor | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setMenuOpen(false);
      dragSelectingRef.current = false;
      dragAnchorRef.current = null;
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
      return renderInteractiveEquationHtml(obj.latex || '\\square', cursor, true, selection);
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
  }, [obj.latex, isEditing, cursor, selection, katexReady]);

  // V1.11.8-7e: Autoajuste bidireccional dentro de límites mínimo/máximo definidos
  useLayoutEffect(() => {
    if (!isEditing || !katexWrapRef.current || !onAutoResize) return;
    const el = katexWrapRef.current;
    const rawW = Math.ceil(el.scrollWidth + 28);
    const rawH = Math.ceil(el.scrollHeight + 20);
    const neededW = Math.min(MAX_EQ_WIDTH, Math.max(MIN_EQ_WIDTH, rawW));
    const neededH = Math.min(MAX_EQ_HEIGHT, Math.max(MIN_EQ_HEIGHT, rawH));
    if (Math.abs(neededW - obj.width) > 2 || Math.abs(neededH - obj.height) > 2) {
      onAutoResize(neededW, neededH);
    }
  }, [html, isEditing, obj.fontSize, obj.width, obj.height, onAutoResize]);

  // V1.11.8-7d: Resuelve punto del AST bajo coordenadas de puntero para clic y arrastre de subselección
  const resolveAtomPoint = useCallback(
    (clientX: number, clientY: number): MathCursor | null => {
      const container = katexWrapRef.current;
      if (!container) return null;
      const htmlRoot = container.querySelector('.katex-html');
      if (!htmlRoot) return null;

      const targetEl = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      let matchedEl = targetEl?.closest('[data-p][data-i]') as HTMLElement | null;
      if (matchedEl && !htmlRoot.contains(matchedEl)) {
        matchedEl = null;
      }

      if (!matchedEl) {
        const atoms = Array.from(htmlRoot.querySelectorAll<HTMLElement>('[data-p][data-i]'));
        if (atoms.length === 0) {
          return { path: [], offset: 0 };
        }

        const rootRect = htmlRoot.getBoundingClientRect();
        if (clientX < rootRect.left - 8) {
          return { path: [], offset: 0 };
        }
        if (clientX > rootRect.right + 8) {
          const ast = parseLatexToAst(obj.latex);
          return { path: [], offset: ast.length };
        }

        let bestDist = Infinity;
        for (const atom of atoms) {
          const r = atom.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const dx =
            clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
          const dy =
            clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
          const dist = dx + dy * 2.5;
          if (dist < bestDist) {
            bestDist = dist;
            matchedEl = atom;
          }
        }
      }

      if (!matchedEl) return null;

      const path = decodePath(matchedEl.getAttribute('data-p') || 'r');
      const idx = Number(matchedEl.getAttribute('data-i') || '0');
      const isSlot = matchedEl.getAttribute('data-s') === '1';

      if (isSlot) {
        return { path, offset: idx };
      }

      const rect = matchedEl.getBoundingClientRect();
      const goAfter = clientX >= rect.left + rect.width / 2;
      return { path, offset: goAfter ? idx + 1 : idx };
    },
    [obj.latex]
  );

  // V1.11.8-7d: Arrastre de ratón dentro de la ecuación para seleccionar rango parcial
  useEffect(() => {
    if (!isEditing) return;
    const handleWindowMouseMove = (ev: MouseEvent) => {
      if (!dragSelectingRef.current || !dragAnchorRef.current) return;
      const pt = resolveAtomPoint(ev.clientX, ev.clientY);
      if (!pt) return;
      const anchor = dragAnchorRef.current;
      if (!pathsEqual(anchor.path, pt.path)) return;
      if (pt.offset !== anchor.offset) {
        onSelectionChange?.({
          path: anchor.path,
          start: Math.min(anchor.offset, pt.offset),
          end: Math.max(anchor.offset, pt.offset),
        });
        onCursorChange?.(pt);
      } else {
        onSelectionChange?.(null);
      }
    };
    const handleWindowMouseUp = () => {
      dragSelectingRef.current = false;
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isEditing, resolveAtomPoint, onCursorChange, onSelectionChange]);

  const handleSurfaceMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    inputRef?.current?.focus();
    const pt = resolveAtomPoint(e.clientX, e.clientY);
    if (!pt) return;

    if (e.shiftKey && pathsEqual(cursor.path, pt.path) && pt.offset !== cursor.offset) {
      dragAnchorRef.current = cursor;
      onSelectionChange?.({
        path: cursor.path,
        start: Math.min(cursor.offset, pt.offset),
        end: Math.max(cursor.offset, pt.offset),
      });
      onCursorChange?.(pt);
      return;
    }

    dragSelectingRef.current = true;
    dragAnchorRef.current = pt;
    onSelectionChange?.(null);
    onCursorChange?.(pt);
  };

  const commitTextChunk = (raw: string) => {
    if (!raw || !onChangeLatex || !onCursorChange) return;
    onSelectionChange?.(null);
    const next = applyTextInputAtCursor(obj.latex, cursor, raw);
    onChangeLatex(next.latex, false);
    onCursorChange(next.cursor);
  };

  const handleHiddenKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      onSelectionChange?.(null);
      onFinishEditing?.();
      return;
    }

    // V1.11.8-7d: Ctrl/Cmd+A selecciona toda la secuencia activa para aplicar estilo o color parcial
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const ast = parseLatexToAst(obj.latex);
      const seq = getSeqAtPath(ast, cursor.path);
      if (seq && seq.length > 0) {
        onSelectionChange?.({ path: cursor.path, start: 0, end: seq.length });
        onCursorChange?.({ path: cursor.path, offset: seq.length });
      }
      return;
    }

    // Espacio: espacio visible persistente (\ ); Shift+Espacio: espacio fino (\,)
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!onChangeLatex || !onCursorChange) return;
      onSelectionChange?.(null);
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
      onSelectionChange?.(null);
      onCursorChange(jumpToNextSlotCursor(obj.latex, cursor, e.shiftKey));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      onSelectionChange?.(null);
      if (obj.latex.includes('\\square') && !e.ctrlKey && !e.metaKey) {
        onCursorChange?.(jumpToNextSlotCursor(obj.latex, cursor, false));
      } else {
        onFinishEditing?.();
      }
      return;
    }

    // V1.11.8-7d: Shift+Izquierda / Shift+Derecha extiende subselección en el nivel actual
    if (e.key === 'ArrowLeft' && e.shiftKey) {
      e.preventDefault();
      const nextOffset = Math.max(0, cursor.offset - 1);
      const anchorOffset =
        selection && pathsEqual(selection.path, cursor.path)
          ? cursor.offset === selection.end
            ? selection.start
            : selection.end
          : cursor.offset;
      if (nextOffset !== anchorOffset) {
        onSelectionChange?.({
          path: cursor.path,
          start: Math.min(anchorOffset, nextOffset),
          end: Math.max(anchorOffset, nextOffset),
        });
      } else {
        onSelectionChange?.(null);
      }
      onCursorChange?.({ path: cursor.path, offset: nextOffset });
      return;
    }

    if (e.key === 'ArrowRight' && e.shiftKey) {
      e.preventDefault();
      const ast = parseLatexToAst(obj.latex);
      const seq = getSeqAtPath(ast, cursor.path);
      const maxLen = seq ? seq.length : 0;
      const nextOffset = Math.min(maxLen, cursor.offset + 1);
      const anchorOffset =
        selection && pathsEqual(selection.path, cursor.path)
          ? cursor.offset === selection.end
            ? selection.start
            : selection.end
          : cursor.offset;
      if (nextOffset !== anchorOffset) {
        onSelectionChange?.({
          path: cursor.path,
          start: Math.min(anchorOffset, nextOffset),
          end: Math.max(anchorOffset, nextOffset),
        });
      } else {
        onSelectionChange?.(null);
      }
      onCursorChange?.({ path: cursor.path, offset: nextOffset });
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSelectionChange?.(null);
      onCursorChange?.(stepCursorLeft(obj.latex, cursor));
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSelectionChange?.(null);
      onCursorChange?.(stepCursorRight(obj.latex, cursor));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onSelectionChange?.(null);
      onCursorChange?.(stepCursorVertical(obj.latex, cursor, 'up'));
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onSelectionChange?.(null);
      onCursorChange?.(stepCursorVertical(obj.latex, cursor, 'down'));
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      onSelectionChange?.(null);
      onCursorChange?.({
        path: cursor.offset === 0 ? [] : cursor.path,
        offset: 0,
      });
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      onSelectionChange?.(null);
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
      onSelectionChange?.(null);
      const next = applyBackspaceAtCursor(obj.latex, cursor);
      onChangeLatex(next.latex, false);
      onCursorChange(next.cursor);
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      if (!onChangeLatex || !onCursorChange) return;
      onSelectionChange?.(null);
      const next = applyDeleteAtCursor(obj.latex, cursor);
      onChangeLatex(next.latex, false);
      onCursorChange(next.cursor);
    }
  };

  if (!isEditing) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center px-3 py-2 rounded-md overflow-hidden select-none katex-canvas-node transition-opacity duration-75 ${
          obj.backgroundColor === 'transparent'
            ? 'border border-transparent'
            : 'border border-slate-200/80 dark:border-slate-700/80 shadow-xs'
        }`}
        style={{
          backgroundColor:
            isDragging || obj.backgroundColor === 'transparent'
              ? 'transparent'
              : obj.backgroundColor,
          color: obj.color,
          fontSize: `${obj.fontSize}px`,
          opacity: isDragging ? 0.65 : undefined,
        }}
      >
        <div
          className="max-w-full max-h-full overflow-auto panel-scroll"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // V1.11.8-7b & 7e: Edición transparente con translucidez al arrastrar y scroll interno si supera límites
  return (
    <div
      className={`relative w-full h-full flex items-center justify-center px-3 py-2 rounded-md overflow-visible select-none katex-canvas-node border border-blue-600 shadow-[0_0_0_1px_rgba(37,99,235,0.22)] transition-opacity duration-75 ${
        isDragging ? 'opacity-65' : ''
      }`}
      style={{
        backgroundColor:
          isDragging || obj.backgroundColor === 'transparent'
            ? 'transparent'
            : obj.backgroundColor,
        color: obj.color,
        fontSize: `${obj.fontSize}px`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Input oculto para capturar escritura directa e IME */}
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

      {/* V1.11.8-7a: Grip de arrastre libre funcional incluso durante edición activa */}
      <div
        data-export-ignore="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          onGripPointerDown?.(e);
        }}
        title="Arrastrar ecuación"
        className="absolute -left-5 top-0 w-5 h-6 bg-slate-200/90 hover:bg-slate-300 border border-slate-400 border-r-0 rounded-l-xs flex items-center justify-center cursor-grab active:cursor-grabbing text-slate-600"
      >
        <GripVertical className="w-3 h-3" />
      </div>

      {/* Superficie interactiva KaTeX con scroll interno cuando excede los límites */}
      <div
        data-scrollable-content="true"
        style={{ overscrollBehavior: 'contain' }}
        className="w-full h-full flex overflow-auto panel-scroll cursor-text"
        onMouseDown={handleSurfaceMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={katexWrapRef}
          className="m-auto whitespace-nowrap select-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {/* Control flotante de opciones rápidas (fuera de flujo para no tapar ecuaciones vecinas) */}
      <div ref={menuRef} data-export-ignore="true" className="absolute -right-5 top-0 z-50">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuOpen((v) => !v)}
          title="Opciones rápidas de ecuación"
          className="w-5 h-6 bg-slate-100/90 hover:bg-slate-200 border border-slate-400 border-l-0 rounded-r-xs flex items-center justify-center text-slate-700"
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
                    onSelectionChange?.(null);
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
