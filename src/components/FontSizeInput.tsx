import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  MAX_TEXT_FONT_SIZE,
  MIN_TEXT_FONT_SIZE,
  formatFontSizeDisplay,
  parseFontSizeInput,
  stepFontSizeValue,
} from '../utils/richText';

export interface FontSizeInputProps {
  value: number | 'mixed';
  onCommit: (nextSize: number) => void;
  onStep?: (delta: number) => void;
  onCancelFocus?: () => void;
  variant?: 'toolbar' | 'inspector';
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export const FontSizeInput: React.FC<FontSizeInputProps> = ({
  value,
  onCommit,
  onStep,
  onCancelFocus,
  variant = 'inspector',
  min = MIN_TEXT_FONT_SIZE,
  max = MAX_TEXT_FONT_SIZE,
  step = 1,
  className = '',
  title,
  ariaLabel = 'Tamaño de fuente (px)',
}) => {
  const formatPropValue = (v: number | 'mixed') =>
    v === 'mixed' ? '' : formatFontSizeDisplay(v);

  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => formatPropValue(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatPropValue(value));
    }
  }, [value, isFocused]);

  const notifyOutOfRange = () => {
    try {
      window.dispatchEvent(
        new CustomEvent('abaco:notice', {
          detail: {
            message: `El tamaño debe estar entre ${min} y ${max} px`,
          },
        })
      );
    } catch {
      // Silencioso si el navegador restringe eventos personalizados
    }
  };

  const commitDraft = () => {
    try {
      const trimmed = draft.trim();
      if (!trimmed || trimmed === '—') {
        setDraft(formatPropValue(value));
        return;
      }
      const parsed = parseFontSizeInput(trimmed);
      if (!parsed.valid || typeof parsed.value !== 'number') {
        setDraft(formatPropValue(value));
        return;
      }
      const bounded = Math.max(min, Math.min(max, parsed.value));
      const wasClamped = parsed.clamped || bounded !== parsed.value;
      if (wasClamped) {
        notifyOutOfRange();
      }
      setDraft(formatFontSizeDisplay(bounded));
      onCommit(bounded);
    } catch (err) {
      console.error('[Ábaco] Error al aplicar tamaño de fuente:', err);
      setDraft(formatPropValue(value));
    }
  };

  const handleStep = (delta: number) => {
    try {
      if (onStep) {
        onStep(delta);
        return;
      }
      const currentNum = typeof value === 'number' && Number.isFinite(value) ? value : 18;
      const next = stepFontSizeValue(currentNum, delta);
      const bounded = Math.max(min, Math.min(max, next));
      setDraft(formatFontSizeDisplay(bounded));
      onCommit(bounded);
    } catch (err) {
      console.error('[Ábaco] Error al ajustar tamaño de fuente:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      skipNextBlurCommitRef.current = true;
      commitDraft();
      setIsFocused(false);
      inputRef.current?.blur();
      onCancelFocus?.();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      skipNextBlurCommitRef.current = true;
      setDraft(formatPropValue(value));
      setIsFocused(false);
      inputRef.current?.blur();
      onCancelFocus?.();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      handleStep(step);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      handleStep(-step);
    }
  };

  if (variant === 'toolbar') {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        placeholder={value === 'mixed' ? '—' : undefined}
        title={
          title ||
          (value === 'mixed'
            ? 'Tamaños mixtos — escribe un tamaño (8–96 px) y pulsa Enter'
            : 'Tamaño de fuente (8–96 px, admite decimales)')
        }
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onFocus={(e) => {
          setIsFocused(true);
          skipNextBlurCommitRef.current = false;
          const el = e.currentTarget;
          el.select();
          window.setTimeout(() => {
            try {
              if (document.activeElement === el) el.select();
            } catch {
              // Ignorar
            }
          }, 0);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setIsFocused(false);
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
          }
          commitDraft();
        }}
        className={`w-11 px-1 py-0.5 text-[11px] font-mono-tabular text-center rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex items-stretch rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 overflow-hidden focus-within:ring-1 focus-within:ring-blue-500 ${className}`}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        placeholder={value === 'mixed' ? '—' : undefined}
        title={
          title ||
          (value === 'mixed'
            ? 'Tamaños mixtos — escribe un valor entre 8 y 96 px'
            : 'Tamaño de fuente (8–96 px, hasta 1 decimal)')
        }
        onPointerDown={(e) => e.stopPropagation()}
        onFocus={(e) => {
          setIsFocused(true);
          skipNextBlurCommitRef.current = false;
          const el = e.currentTarget;
          el.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setIsFocused(false);
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
          }
          commitDraft();
        }}
        className="w-full min-w-0 bg-transparent px-2 py-1 text-xs font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none"
      />
      <div className="flex flex-col border-l border-slate-200 dark:border-slate-700 shrink-0">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Aumentar tamaño de fuente"
          title="Aumentar tamaño (+1 px)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleStep(step)}
          className="flex-1 px-1 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
        >
          <ChevronUp className="w-2.5 h-2.5" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Reducir tamaño de fuente"
          title="Reducir tamaño (-1 px)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleStep(-step)}
          className="flex-1 px-1 flex items-center justify-center border-t border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
        >
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};
