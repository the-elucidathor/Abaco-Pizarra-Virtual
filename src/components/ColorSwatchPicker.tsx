// V1.11.8-5 & V1.11.8-8: Selector reutilizable de paleta rápida (18 colores + 4 personalizados) con vista previa rAF y una sola acción de historial
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkPlus, Ban, Pipette } from 'lucide-react';
import {
  DEFAULT_CUSTOM_COLOR_SWATCHES,
  loadSettings,
  saveSettings,
} from '../services/storageService';

export const QUICK_COLOR_PALETTE_18: readonly string[] = [
  '#0f172a', // Negro pizarra
  '#475569', // Gris pizarra
  '#94a3b8', // Gris plata
  '#ffffff', // Blanco puro
  '#dc2626', // Rojo carmesí
  '#ea580c', // Naranja intenso
  '#d97706', // Ámbar cálido
  '#eab308', // Amarillo vivo
  '#65a30d', // Verde lima
  '#16a34a', // Verde esmeralda
  '#0d9488', // Turquesa profundo
  '#0891b2', // Cian intenso
  '#2563eb', // Azul cobalto
  '#4f46e5', // Índigo real
  '#7c3aed', // Violeta vivo
  '#c026d3', // Magenta brillante
  '#db2777', // Rosa frambuesa
  '#92400e', // Marrón cacao
];

const CUSTOM_SWATCH_EVENT = 'abaco:custom-swatches-updated';

function normalizeHex6(value: string | undefined | null, fallback = '#0f172a'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

export interface ColorSwatchPickerProps {
  /** Valor actual ('#rrggbb', 'transparent', 'auto' o 'mixed' / '__mixed__') */
  value: string;
  customSwatches?: string[];
  onUpdateCustomSwatches?: (next: string[]) => void;
  allowTransparent?: boolean;
  allowAuto?: boolean;
  autoLabel?: string;
  /** Llamado una vez justo antes del primer frame de vista previa en vivo */
  onStartPreview?: () => void;
  /** Llamado dentro de requestAnimationFrame durante el arrastre del selector nativo */
  onPreviewColor?: (color: string) => void;
  /** Llamado al confirmar un color (clic en paleta o cierre del selector nativo) */
  onCommitColor: (color: string) => void;
  /** Llamado si se cancela sin confirmar (p. ej. Escape sin cambio confirmado) */
  onCancelPreview?: () => void;
  compact?: boolean;
  title?: string;
  label?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export const ColorSwatchPicker: React.FC<ColorSwatchPickerProps> = ({
  value,
  customSwatches,
  onUpdateCustomSwatches,
  allowTransparent = false,
  allowAuto = false,
  autoLabel = 'Auto',
  onStartPreview,
  onPreviewColor,
  onCommitColor,
  onCancelPreview,
  compact = false,
  title,
  label,
  buttonClassName = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [localCustom, setLocalCustom] = useState<string[]>(() => {
    if (Array.isArray(customSwatches) && customSwatches.length === 4) {
      return customSwatches.map((c, idx) => normalizeHex6(c, DEFAULT_CUSTOM_COLOR_SWATCHES[idx]));
    }
    return loadSettings().customColorSwatches ?? [...DEFAULT_CUSTOM_COLOR_SWATCHES];
  });
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [draftNativeHex, setDraftNativeHex] = useState<string>(() =>
    normalizeHex6(value, '#0f172a')
  );

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);

  const rafIdRef = useRef<number | null>(null);
  const pendingPreviewHexRef = useRef<string | null>(null);
  const previewActiveRef = useRef(false);
  const lastPreviewHexRef = useRef<string | null>(null);

  const callbacksRef = useRef({
    onStartPreview,
    onPreviewColor,
    onCommitColor,
    onCancelPreview,
  });
  callbacksRef.current = {
    onStartPreview,
    onPreviewColor,
    onCommitColor,
    onCancelPreview,
  };

  useEffect(() => {
    if (Array.isArray(customSwatches) && customSwatches.length === 4) {
      setLocalCustom(
        customSwatches.map((c, idx) => normalizeHex6(c, DEFAULT_CUSTOM_COLOR_SWATCHES[idx]))
      );
    }
  }, [customSwatches]);

  useEffect(() => {
    const handleSync = (ev: Event) => {
      const detail = (ev as CustomEvent<string[] | undefined>).detail;
      if (Array.isArray(detail) && detail.length === 4) {
        setLocalCustom(detail.map((c, idx) => normalizeHex6(c, DEFAULT_CUSTOM_COLOR_SWATCHES[idx])));
      } else {
        setLocalCustom(loadSettings().customColorSwatches ?? [...DEFAULT_CUSTOM_COLOR_SWATCHES]);
      }
    };
    window.addEventListener(CUSTOM_SWATCH_EVENT, handleSync);
    return () => window.removeEventListener(CUSTOM_SWATCH_EVENT, handleSync);
  }, []);

  useEffect(() => {
    if (!previewActiveRef.current) {
      setDraftNativeHex(normalizeHex6(value, '#0f172a'));
    }
  }, [value]);

  const cancelPendingRaf = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingPreviewHexRef.current = null;
  }, []);

  const flushPreviewToCommit = useCallback(() => {
    cancelPendingRaf();
    if (!previewActiveRef.current) return;
    const finalHex = lastPreviewHexRef.current ?? draftNativeHex;
    previewActiveRef.current = false;
    lastPreviewHexRef.current = null;
    try {
      callbacksRef.current.onCommitColor(finalHex);
    } catch {
      // Protege el historial ante fallos de guardado al cerrar
    }
  }, [cancelPendingRaf, draftNativeHex]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popW = 224;
    const popH = 230;
    let left = rect.left;
    if (left + popW > window.innerWidth - 10) {
      left = Math.max(10, window.innerWidth - popW - 10);
    }
    let top = rect.bottom + 6;
    if (top + popH > window.innerHeight - 10) {
      top = Math.max(10, rect.top - popH - 6);
    }
    setPopoverPos({ left: Math.round(left), top: Math.round(top) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDownOutside = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      flushPreviewToCommit();
      setOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        cancelPendingRaf();
        if (previewActiveRef.current) {
          previewActiveRef.current = false;
          lastPreviewHexRef.current = null;
          try {
            callbacksRef.current.onCancelPreview?.();
          } catch {
            // ignorar
          }
        }
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDownOutside, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('pointerdown', onPointerDownOutside, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition, flushPreviewToCommit, cancelPendingRaf]);

  useEffect(() => {
    return () => {
      cancelPendingRaf();
    };
  }, [cancelPendingRaf]);

  // Enlazamos eventos nativos input/change al <input type="color"> para obtener vista previa rAF fluida
  // y garantizar exactamente UNA confirmación en el historial al cerrar el diálogo nativo.
  useEffect(() => {
    if (!open) return;
    const input = nativeInputRef.current;
    if (!input) return;

    const handleNativeInput = () => {
      const hex = normalizeHex6(input.value, '#0f172a');
      setDraftNativeHex(hex);
      pendingPreviewHexRef.current = hex;

      if (!previewActiveRef.current) {
        previewActiveRef.current = true;
        try {
          callbacksRef.current.onStartPreview?.();
        } catch {
          // ignorar
        }
      }

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          const nextHex = pendingPreviewHexRef.current;
          if (!nextHex) return;
          lastPreviewHexRef.current = nextHex;
          try {
            if (callbacksRef.current.onPreviewColor) {
              callbacksRef.current.onPreviewColor(nextHex);
            } else {
              callbacksRef.current.onCommitColor(nextHex);
            }
          } catch {
            // Protege la vista previa frente a objetos bloqueados o eliminados
          }
        });
      }
    };

    const handleNativeChange = () => {
      cancelPendingRaf();
      const finalHex = normalizeHex6(input.value, '#0f172a');
      setDraftNativeHex(finalHex);
      previewActiveRef.current = false;
      lastPreviewHexRef.current = null;
      try {
        callbacksRef.current.onCommitColor(finalHex);
      } catch {
        // ignorar
      }
    };

    input.addEventListener('input', handleNativeInput);
    input.addEventListener('change', handleNativeChange);
    return () => {
      input.removeEventListener('input', handleNativeInput);
      input.removeEventListener('change', handleNativeChange);
    };
  }, [open, cancelPendingRaf]);

  const handleSaveToCustomSlot = (slotIdx: number) => {
    const colorToSave =
      value === 'transparent' || value === 'auto' || value === 'mixed' || value === '__mixed__'
        ? draftNativeHex
        : normalizeHex6(value, draftNativeHex);
    const nextSlots = localCustom.map((c, idx) => (idx === slotIdx ? colorToSave : c));
    setLocalCustom(nextSlots);
    try {
      if (onUpdateCustomSwatches) {
        onUpdateCustomSwatches(nextSlots);
      } else {
        const current = loadSettings();
        saveSettings({ ...current, customColorSwatches: nextSlots });
      }
      window.dispatchEvent(new CustomEvent(CUSTOM_SWATCH_EVENT, { detail: nextSlots }));
    } catch {
      // Ignora fallo de persistencia en entornos sin almacenamiento
    }
  };

  const handleSelectQuickColor = (color: string) => {
    cancelPendingRaf();
    previewActiveRef.current = false;
    lastPreviewHexRef.current = null;
    try {
      onCommitColor(color);
    } catch {
      // ignorar
    }
    setOpen(false);
  };

  const isMixed = value === 'mixed' || value === '__mixed__';
  const isTransparent = value === 'transparent';
  const isAuto = value === 'auto' || value === '';

  const swatchVisualStyle: React.CSSProperties = isMixed
    ? { background: 'conic-gradient(#dc2626, #eab308, #16a34a, #2563eb, #dc2626)' }
    : isTransparent
    ? {
        backgroundImage:
          'linear-gradient(135deg, transparent 44%, #dc2626 44%, #dc2626 56%, transparent 56%)',
        backgroundColor: '#ffffff',
      }
    : isAuto
    ? {
        background: 'linear-gradient(135deg, #0f172a 50%, #f8fafc 50%)',
      }
    : { backgroundColor: normalizeHex6(value, '#0f172a') };

  const activeNormalized =
    !isMixed && !isTransparent && !isAuto ? normalizeHex6(value, '') : '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (disabled) return;
          if (open) {
            flushPreviewToCommit();
            setOpen(false);
          } else {
            setDraftNativeHex(normalizeHex6(value, '#0f172a'));
            setOpen(true);
          }
        }}
        title={title ?? (isMixed ? 'Valores mixtos — clic para unificar color' : 'Elegir color')}
        className={`inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-500 transition-colors disabled:opacity-40 cursor-pointer ${
          compact ? 'p-0.5' : 'px-1.5 py-1'
        } ${buttonClassName}`}
      >
        <span
          className={`${
            compact ? 'w-4 h-4' : 'w-5 h-5'
          } rounded-sm border border-slate-300/90 dark:border-slate-600 shrink-0 block`}
          style={swatchVisualStyle}
        />
        {label && (
          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
            {label}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            data-export-ignore="true"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ left: popoverPos.left, top: popoverPos.top, width: 224 }}
            className="fixed z-[1200] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-2.5 text-slate-800 dark:text-slate-100 select-none"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Paleta rápida (18)
              </span>
              {isMixed ? (
                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  Mixto
                </span>
              ) : (
                <span className="text-[10px] font-mono uppercase text-slate-400">
                  {isTransparent ? 'Sin relleno' : isAuto ? autoLabel : activeNormalized}
                </span>
              )}
            </div>

            <div className="grid grid-cols-6 gap-1.5 mb-2.5">
              {QUICK_COLOR_PALETTE_18.map((hex) => {
                const isSelected = activeNormalized === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => handleSelectQuickColor(hex)}
                    title={hex.toUpperCase()}
                    style={{ backgroundColor: hex }}
                    className={`w-7 h-6 rounded border transition-transform hover:scale-110 cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900 border-white'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  />
                );
              })}
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Personalizados (4)
                </span>
                <span className="text-[9px] text-slate-400">Guardar actual</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {localCustom.map((hex, idx) => {
                  const isSelected = activeNormalized === hex;
                  return (
                    <div key={idx} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleSelectQuickColor(hex)}
                        title={`Usar personalizado ${idx + 1}: ${hex.toUpperCase()}`}
                        style={{ backgroundColor: hex }}
                        className={`flex-1 h-6 rounded-l border cursor-pointer transition-transform hover:scale-105 ${
                          isSelected
                            ? 'ring-2 ring-blue-500 border-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveToCustomSlot(idx)}
                        title={`Guardar color actual en ranura ${idx + 1}`}
                        className="h-6 px-1 rounded-r border border-l-0 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-500 hover:text-blue-600 cursor-pointer flex items-center justify-center"
                      >
                        <BookmarkPlus className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
              <label className="relative flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-blue-500 text-[11px] font-medium cursor-pointer">
                <Pipette className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Personalizar</span>
                <input
                  ref={nativeInputRef}
                  type="color"
                  value={draftNativeHex}
                  onChange={() => {
                    // Gestionado mediante listeners nativos input/change para vista previa rAF + 1 historial
                  }}
                  className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                />
              </label>

              {allowTransparent && (
                <button
                  type="button"
                  onClick={() => handleSelectQuickColor('transparent')}
                  title="Sin relleno (transparente)"
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1 cursor-pointer ${
                    isTransparent
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Ban className="w-3 h-3 text-red-500" />
                  <span>Sin</span>
                </button>
              )}

              {allowAuto && (
                <button
                  type="button"
                  onClick={() => handleSelectQuickColor('auto')}
                  title="Color automático según tema"
                  className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                    isAuto
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {autoLabel}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
