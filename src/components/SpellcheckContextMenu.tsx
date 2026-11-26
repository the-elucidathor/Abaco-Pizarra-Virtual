import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookPlus, EyeOff, SpellCheck } from 'lucide-react';

export interface SpellcheckContextMenuState {
  x: number;
  y: number;
  word: string;
  start: number;
  end: number;
  suggestions: string[];
}

interface SpellcheckContextMenuProps {
  menu: SpellcheckContextMenuState | null;
  onSelectSuggestion: (suggestion: string) => void;
  onIgnoreWord: (word: string) => void;
  onAddToDictionary: (word: string) => void;
  onClose: () => void;
}

// Menú contextual flotante para palabras subrayadas por el corrector ortográfico
export const SpellcheckContextMenu: React.FC<SpellcheckContextMenuProps> = ({
  menu,
  onSelectSuggestion,
  onIgnoreWord,
  onAddToDictionary,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Ajusta posición del menú para que nunca se salga de los bordes de la ventana
  useLayoutEffect(() => {
    if (!menu) return;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const el = menuRef.current;
    const rect = el ? el.getBoundingClientRect() : { width: 215, height: 220 };
    const margin = 8;
    const left = Math.max(margin, Math.min(menu.x, vw - rect.width - margin));
    const top = Math.max(margin, Math.min(menu.y, vh - rect.height - margin));
    setCoords({ left, top });
  }, [menu]);

  // Cierra el menú con Escape o al hacer clic fuera de él
  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [menu, onClose]);

  if (!menu || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      data-export-ignore="true"
      role="menu"
      aria-label="Sugerencias de ortografía"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      style={{ left: coords.left, top: coords.top }}
      className="fixed z-[120] min-w-[205px] max-w-[260px] rounded-xl theme-surface border theme-border shadow-2xl py-1.5 text-xs select-none"
    >
      <div className="px-3 py-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-70 border-b theme-border mb-1">
        <SpellCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Ortografía: {menu.word}</span>
      </div>

      {menu.suggestions.length > 0 ? (
        <div className="px-1 space-y-0.5">
          {menu.suggestions.slice(0, 5).map((sug) => (
            <button
              key={sug}
              type="button"
              role="menuitem"
              onClick={() => onSelectSuggestion(sug)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg font-bold hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none theme-accent-soft/0 hover:theme-accent-soft transition-colors truncate"
            >
              {sug}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-1.5 text-[11px] italic opacity-60">
          Sin sugerencias
        </div>
      )}

      <div className="my-1.5 border-t theme-border" />

      <div className="px-1 space-y-0.5">
        <button
          type="button"
          role="menuitem"
          onClick={() => onIgnoreWord(menu.word)}
          className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <EyeOff className="w-3.5 h-3.5 opacity-75 shrink-0" />
          <span>Ignorar</span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => onAddToDictionary(menu.word)}
          className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <BookPlus className="w-3.5 h-3.5 opacity-75 shrink-0" />
          <span>Agregar al diccionario</span>
        </button>
      </div>
    </div>,
    document.body
  );
};
