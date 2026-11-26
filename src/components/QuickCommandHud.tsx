import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CornerDownLeft, Terminal, X } from 'lucide-react';
import type { Point2D } from '../types/whiteboard';
import {
  type CadCatalogItem,
  searchCadCommandCatalog,
} from '../utils/cad/cadCommandCatalog';

interface QuickCommandHudProps {
  open: boolean;
  anchorStagePos: Point2D | null;
  stageSize: { width: number; height: number };
  onExecuteItem: (item: CadCatalogItem) => void;
  onClose: () => void;
}

// OPT: 2.6 — Memoriza paleta de comandos rápidos
export const QuickCommandHud: React.FC<QuickCommandHudProps> = React.memo(({
  open,
  anchorStagePos,
  stageSize,
  onExecuteItem,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = useMemo(() => searchCadCommandCatalog(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    setNotFoundMsg(null);
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
    setNotFoundMsg(null);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onOutsidePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onEscapeWindow = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    window.addEventListener('keydown', onEscapeWindow, true);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      window.removeEventListener('keydown', onEscapeWindow, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const panelW = 356;
  const maxPanelH = 328;
  const pad = 12;
  const defaultLeft = Math.round((stageSize.width - panelW) / 2);
  const defaultTop = Math.max(pad, stageSize.height - maxPanelH - 24);

  const rawLeft = anchorStagePos ? anchorStagePos.x + 12 : defaultLeft;
  const rawTop = anchorStagePos ? anchorStagePos.y + 12 : defaultTop;

  const left = Math.max(
    pad,
    Math.min(rawLeft, Math.max(pad, stageSize.width - panelW - pad))
  );
  const top = Math.max(
    pad,
    Math.min(rawTop, Math.max(pad, stageSize.height - maxPanelH - pad))
  );

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      if (suggestions.length > 0) {
        onExecuteItem(suggestions[activeIdx] || suggestions[0]);
      }
      return;
    }
    if (suggestions.length === 0) {
      setNotFoundMsg(`Comando "${trimmed.toUpperCase()}" no reconocido.`);
      return;
    }
    const target = suggestions[activeIdx] || suggestions[0];
    onExecuteItem(target);
  };

  return (
    <div
      ref={containerRef}
      data-export-ignore="true"
      data-scrollable-content="true"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => {
        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      }}
      style={{ left, top, width: panelW }}
      className="no-print absolute z-50 rounded-xl border theme-surface shadow-2xl backdrop-blur-md overflow-hidden select-none"
    >
      {/* Discreet Direct Command Input Row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b theme-border theme-surface-alt">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded theme-accent-btn text-[11px] font-mono font-bold shrink-0">
          <Terminal className="w-3 h-3" />
          ;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (suggestions.length > 0) {
                setActiveIdx((i) => (i + 1) % suggestions.length);
              }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (suggestions.length > 0) {
                setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
              }
            } else if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'Tab' && suggestions.length > 0) {
              e.preventDefault();
              const target = suggestions[activeIdx] || suggestions[0];
              setQuery(target.code);
            }
          }}
          placeholder="Escribe un comando (ej. LIN, MA, ACL, SIM)..."
          aria-label="Ejecución directa de comando"
          className="flex-1 bg-transparent text-xs font-medium placeholder:opacity-55 outline-none font-mono"
        />
        <button
          type="button"
          onClick={onClose}
          title="Cerrar lanzador (Esc)"
          className="p-1 rounded opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Discreet Unknown Command Feedback */}
      {notFoundMsg && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800 flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-200">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{notFoundMsg} Corrige el texto o pulsa Esc.</span>
        </div>
      )}

      {/* Filtered Suggestions List */}
      <div
        data-scrollable-content="true"
        style={{ overscrollBehavior: 'contain' }}
        className="max-h-60 overflow-y-auto py-1 overscroll-contain"
      >
        {suggestions.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] opacity-70">
            No hay coincidencias para <span className="font-mono font-semibold">{query.toUpperCase()}</span>
          </div>
        ) : (
          suggestions.slice(0, 10).map((item, idx) => {
            const isActive = idx === activeIdx;
            return (
              <button
                key={item.id}
                type="button"
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => onExecuteItem(item)}
                title={`${item.label}: ${item.description}`}
                className={`w-full px-3 py-1.5 text-left flex items-center justify-between gap-2.5 transition-colors ${
                  isActive
                    ? 'theme-accent-btn'
                    : 'hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${
                      isActive
                        ? 'bg-black/15 border border-current/25'
                        : 'theme-surface-alt border theme-border'
                    }`}
                  >
                    {item.code}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{item.label}</div>
                    <div className={`text-[10px] truncate ${isActive ? 'opacity-90' : 'opacity-70'}`}>
                      {item.description}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] ${isActive ? 'opacity-90' : 'opacity-65'}`}>
                    {item.category}
                  </span>
                  {isActive && <CornerDownLeft className="w-3 h-3 opacity-85" />}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Subtle Footer Hint */}
      <div className="px-3 py-1.5 border-t theme-border theme-surface-alt flex items-center justify-between text-[10px] opacity-75">
        <span>↑↓ navegar · Enter ejecutar · Esc cancelar</span>
        <span>Tab autocompletar</span>
      </div>
    </div>
  );
});

