import React, { useRef } from 'react';
import { Check, Plus } from 'lucide-react';
import type { CanvasBackgroundColorMode, ThemePreset } from '../types/whiteboard';
import {
  CANVAS_BG_SUGGESTED_COLORS,
  getHexRelativeLuminance,
  getThemeBoardColors,
} from '../utils/themePalette';

interface CanvasColorPickerControlProps {
  theme: ThemePreset;
  mode: CanvasBackgroundColorMode;
  customColor: string;
  adaptStrokeColors: boolean;
  onChangeMode: (mode: CanvasBackgroundColorMode) => void;
  onChangeCustomColor: (hex: string) => void;
  onChangeAdaptStrokeColors: (adapt: boolean) => void;
  // Permite compactar la cuadrícula en el inspector lateral estrecho
  compact?: boolean;
}

// Selector reutilizable de "Color del lienzo" sincronizado entre Propiedades y Configuración
export const CanvasColorPickerControl: React.FC<CanvasColorPickerControlProps> = ({
  theme,
  mode,
  customColor,
  adaptStrokeColors,
  onChangeMode,
  onChangeCustomColor,
  onChangeAdaptStrokeColors,
  compact = false,
}) => {
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const themeDefaultBg = getThemeBoardColors(theme).boardBg;
  const customLum = getHexRelativeLuminance(customColor);
  const customIsDark = customLum !== null ? customLum < 0.179 : false;

  // Maneja la selección del color personalizado con actualización en vivo
  const handleCustomColorPick = (hex: string) => {
    onChangeCustomColor(hex);
    if (mode !== 'custom') {
      onChangeMode('custom');
    }
  };

  return (
    <div className="space-y-2.5" data-canvas-color-control="true">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
          Color del lienzo
        </span>
        <span className="text-[11px] opacity-70 truncate">
          {mode === 'auto'
            ? 'Según tema'
            : mode === 'custom'
            ? customColor.toUpperCase()
            : CANVAS_BG_SUGGESTED_COLORS.find((c) => c.id === mode)?.name}
        </span>
      </div>

      {/* Exactamente 6 opciones en cuadrícula limpia o fila única */}
      <div
        className={`grid gap-2 ${
          compact ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-6'
        }`}
      >
        {/* 1. Automático (muestra dividida en diagonal) */}
        <button
          type="button"
          onClick={() => onChangeMode('auto')}
          aria-pressed={mode === 'auto'}
          title="Automático: sigue el tema de interfaz activo"
          className="group flex flex-col items-center gap-1 text-center focus:outline-none"
        >
          <span
            className={`relative w-8 h-8 rounded-full border transition-all flex items-center justify-center ${
              mode === 'auto'
                ? 'ring-2 ring-offset-2 ring-blue-600 dark:ring-sky-400 border-blue-600 dark:border-sky-300 scale-105'
                : 'border-slate-300 dark:border-slate-600 group-hover:scale-105'
            }`}
            style={{
              background: `linear-gradient(135deg, ${themeDefaultBg} 50%, #1e293b 50%)`,
            }}
          >
            {mode === 'auto' && (
              <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </span>
            )}
          </span>
          <span
            className={`text-[10px] leading-tight ${
              mode === 'auto' ? 'font-semibold text-blue-600 dark:text-sky-300' : 'opacity-80'
            }`}
          >
            Automático
          </span>
        </button>

        {/* 2–5. Cuatro colores sugeridos: Blanco, Grafito, Verde pizarra y Crema */}
        {CANVAS_BG_SUGGESTED_COLORS.map((preset) => {
          const isSelected = mode === preset.id;
          const lum = getHexRelativeLuminance(preset.hex);
          const isDark = lum !== null ? lum < 0.179 : false;

          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChangeMode(preset.id)}
              aria-pressed={isSelected}
              title={`${preset.name} (${preset.hex})`}
              className="group flex flex-col items-center gap-1 text-center focus:outline-none"
            >
              <span
                className={`relative w-8 h-8 rounded-full border transition-all flex items-center justify-center ${
                  isSelected
                    ? 'ring-2 ring-offset-2 ring-blue-600 dark:ring-sky-400 border-blue-600 dark:border-sky-300 scale-105'
                    : 'border-slate-300 dark:border-slate-600 group-hover:scale-105'
                }`}
                style={{ backgroundColor: preset.hex }}
              >
                {isSelected && (
                  <Check
                    className="w-4 h-4 stroke-[2.5]"
                    style={{ color: isDark ? '#F8FAFC' : '#0F172A' }}
                  />
                )}
              </span>
              <span
                className={`text-[10px] leading-tight ${
                  isSelected ? 'font-semibold text-blue-600 dark:text-sky-300' : 'opacity-80'
                }`}
              >
                {preset.name}
              </span>
            </button>
          );
        })}

        {/* 6. Personalizado (+ que abre selector nativo con vista previa en vivo) */}
        <label
          title="Elegir color personalizado para el lienzo"
          className="group relative flex flex-col items-center gap-1 text-center cursor-pointer"
        >
          <span
            className={`relative w-8 h-8 rounded-full border transition-all flex items-center justify-center overflow-hidden ${
              mode === 'custom'
                ? 'ring-2 ring-offset-2 ring-blue-600 dark:ring-sky-400 border-blue-600 dark:border-sky-300 scale-105'
                : 'border-dashed border-slate-400 dark:border-slate-500 theme-surface-alt group-hover:scale-105'
            }`}
            style={
              mode === 'custom'
                ? { backgroundColor: customColor }
                : undefined
            }
          >
            {mode === 'custom' ? (
              <Check
                className="w-4 h-4 stroke-[2.5] pointer-events-none"
                style={{ color: customIsDark ? '#F8FAFC' : '#0F172A' }}
              />
            ) : (
              <Plus className="w-4 h-4 opacity-80 pointer-events-none" />
            )}

            {/* Selector nativo superpuesto para vista previa en vivo al instante */}
            <input
              ref={colorInputRef}
              type="color"
              aria-label="Selector de color personalizado del lienzo"
              value={customColor}
              onClick={() => {
                if (mode !== 'custom') {
                  onChangeMode('custom');
                }
              }}
              onInput={(e) => handleCustomColorPick((e.target as HTMLInputElement).value)}
              onChange={(e) => handleCustomColorPick(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </span>

          <span
            className={`text-[10px] leading-tight ${
              mode === 'custom' ? 'font-semibold text-blue-600 dark:text-sky-300' : 'opacity-80'
            }`}
          >
            Personalizado
          </span>
        </label>
      </div>

      {/* Opción de adaptación automática de trazos existentes con bajo contraste */}
      <label className="flex items-start justify-between gap-2 pt-1.5 border-t border-slate-200/70 dark:border-slate-700/70 cursor-pointer">
        <span className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">
          Adaptar colores de trazos al fondo
        </span>
        <input
          type="checkbox"
          checked={adaptStrokeColors}
          onChange={(e) => onChangeAdaptStrokeColors(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0 cursor-pointer"
        />
      </label>
    </div>
  );
};
