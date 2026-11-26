import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Infinity as InfinityIcon, RectangleHorizontal, RectangleVertical, Sliders, X } from 'lucide-react';
import type { BackgroundPattern, BoardSizePreset, PageOrientation } from '../../types/whiteboard';
import {
  BOARD_SIZE_PRESETS,
  clampCustomDimensionPx,
  cmToPx,
  getPresetDimensionLabel,
  getPresetInfo,
  pxToCm,
} from '../../utils/boardSizes';

export interface NewBoardModalResult {
  name: string;
  sizePreset: BoardSizePreset;
  pageOrientation: PageOrientation;
  customWidthPx: number;
  customHeightPx: number;
  backgroundPattern: BackgroundPattern;
}

interface NewBoardModalProps {
  mode: 'board' | 'project';
  defaultName: string;
  defaultBackground?: BackgroundPattern;
  onConfirm: (result: NewBoardModalResult) => void;
  onClose: () => void;
}

const PATTERN_OPTIONS: { id: BackgroundPattern; label: string }[] = [
  { id: 'grid', label: 'Cuadriculado' },
  { id: 'blank', label: 'Blanco liso' },
  { id: 'lined', label: 'Rayado' },
  { id: 'dotted', label: 'Punteado' },
  { id: 'isometric', label: 'Isométrico' },
];

export const NewBoardModal: React.FC<NewBoardModalProps> = ({
  mode,
  defaultName,
  defaultBackground = 'grid',
  onConfirm,
  onClose,
}) => {
  const [name, setName] = useState(defaultName);
  const [sizePreset, setSizePreset] = useState<BoardSizePreset>('infinite');
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const [customUnit, setCustomUnit] = useState<'px' | 'cm'>('px');
  const [customWidthPx, setCustomWidthPx] = useState(1000);
  const [customHeightPx, setCustomHeightPx] = useState(750);
  const [backgroundPattern, setBackgroundPattern] = useState<BackgroundPattern>(defaultBackground);

  const selectedInfo = getPresetInfo(sizePreset);

  const summaryDimensionText = useMemo(
    () => getPresetDimensionLabel(sizePreset, orientation, customWidthPx, customHeightPx),
    [sizePreset, orientation, customWidthPx, customHeightPx]
  );

  const displayCustomW = customUnit === 'cm' ? pxToCm(customWidthPx) : customWidthPx;
  const displayCustomH = customUnit === 'cm' ? pxToCm(customHeightPx) : customHeightPx;

  const handleCustomWidthChange = (raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val)) return;
    const px = customUnit === 'cm' ? cmToPx(val) : Math.round(val);
    setCustomWidthPx(clampCustomDimensionPx(px));
  };

  const handleCustomHeightChange = (raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val)) return;
    const px = customUnit === 'cm' ? cmToPx(val) : Math.round(val);
    setCustomHeightPx(clampCustomDimensionPx(px));
  };

  const handleSwapCustom = () => {
    setCustomWidthPx(customHeightPx);
    setCustomHeightPx(customWidthPx);
  };

  const handleOrientationChange = (next: PageOrientation) => {
    setOrientation(next);
    if (sizePreset === 'custom') {
      if (next === 'landscape' && customHeightPx > customWidthPx) {
        setCustomWidthPx(customHeightPx);
        setCustomHeightPx(customWidthPx);
      } else if (next === 'portrait' && customWidthPx > customHeightPx) {
        setCustomWidthPx(customHeightPx);
        setCustomHeightPx(customWidthPx);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim() || defaultName;
    onConfirm({
      name: trimmed,
      sizePreset,
      pageOrientation: orientation,
      customWidthPx: clampCustomDimensionPx(customWidthPx),
      customHeightPx: clampCustomDimensionPx(customHeightPx),
      backgroundPattern,
    });
  };

  const renderPresetPreview = (presetId: BoardSizePreset) => {
    if (presetId === 'infinite') {
      return (
        <div className="w-11 h-11 rounded-md border border-dashed border-current/40 flex items-center justify-center shrink-0">
          <InfinityIcon className="w-5 h-5 opacity-80" />
        </div>
      );
    }

    if (presetId === 'custom') {
      const ratio = customWidthPx / Math.max(1, customHeightPx);
      const maxDim = 34;
      const rw = ratio >= 1 ? maxDim : Math.max(14, Math.round(maxDim * ratio));
      const rh = ratio >= 1 ? Math.max(14, Math.round(maxDim / ratio)) : maxDim;
      return (
        <div className="w-11 h-11 flex items-center justify-center shrink-0">
          <div
            style={{ width: rw, height: rh }}
            className="rounded-[2px] border-2 border-dashed border-current/60 bg-white/70 dark:bg-slate-800/70 flex items-center justify-center"
          >
            <Sliders className="w-3 h-3 opacity-75" />
          </div>
        </div>
      );
    }

    const info = getPresetInfo(presetId);
    const w = orientation === 'landscape' ? info.heightPx : info.widthPx;
    const h = orientation === 'landscape' ? info.widthPx : info.heightPx;
    // Scale proportionally relative to Doble Carta max edge (1632px -> 36px)
    const scale = 36 / 1632;
    const boxW = Math.max(13, Math.round(w * scale));
    const boxH = Math.max(13, Math.round(h * scale));

    return (
      <div className="w-11 h-11 flex items-center justify-center shrink-0">
        <div
          style={{ width: boxW, height: boxH }}
          className="rounded-[2px] border border-current/55 bg-white dark:bg-slate-100 shadow-xs"
        />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-[1px] p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl theme-surface border theme-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b theme-border shrink-0">
          <div>
            <h2 className="text-base font-semibold">
              {mode === 'project' ? 'Nuevo proyecto y pizarrón' : 'Abrir nuevo pizarrón'}
            </h2>
            <p className="text-xs opacity-70 mt-0.5">
              Elige el tamaño de hoja o trabaja con un espacio infinito
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto panel-scroll">
          {/* Board / Project Name & Background Pattern */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div className="sm:col-span-3">
              <label className="block text-xs font-semibold opacity-80 mb-1">
                {mode === 'project' ? 'Nombre del proyecto' : 'Nombre del pizarrón'}
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName}
                className="w-full rounded-lg border theme-border theme-surface px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold opacity-80 mb-1">
                Diseño de fondo
              </label>
              <select
                value={backgroundPattern}
                onChange={(e) => setBackgroundPattern(e.target.value as BackgroundPattern)}
                className="w-full rounded-lg border theme-border theme-surface px-2.5 py-2 text-xs font-medium"
              >
                {PATTERN_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Size Presets Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold opacity-80">Tamaño del pizarrón</span>
              <span className="text-[11px] opacity-70 font-mono-tabular">
                {selectedInfo.name} · {summaryDimensionText}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {BOARD_SIZE_PRESETS.map((preset) => {
                const isSelected = sizePreset === preset.id;
                const dimText =
                  preset.id === 'infinite'
                    ? preset.inchLabel
                    : getPresetDimensionLabel(
                        preset.id,
                        orientation,
                        customWidthPx,
                        customHeightPx
                      );
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSizePreset(preset.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      isSelected
                        ? 'theme-accent-soft border-current ring-1 ring-current'
                        : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    {renderPresetPreview(preset.id)}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate">{preset.name}</div>
                      <div className="text-[11px] opacity-75 font-mono-tabular truncate mt-0.5">
                        {dimText}
                      </div>
                      <div className="text-[10px] opacity-60 truncate mt-0.5">
                        {preset.id === 'infinite' || preset.id === 'custom'
                          ? preset.description
                          : preset.inchLabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Orientation & Custom Size Controls */}
          {sizePreset !== 'infinite' && (
            <div className="p-3.5 rounded-lg theme-surface-alt border theme-border space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold">Orientación de la hoja</div>
                  <div className="text-[11px] opacity-70">
                    Aplica a Carta, Oficio, Doble Carta, Media Carta o medida personalizada
                  </div>
                </div>
                <div className="flex items-center gap-1 p-1 theme-surface border theme-border rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleOrientationChange('portrait')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                      orientation === 'portrait'
                        ? 'theme-accent-btn'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <RectangleVertical className="w-3.5 h-3.5" />
                    Vertical
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOrientationChange('landscape')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                      orientation === 'landscape'
                        ? 'theme-accent-btn'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    <RectangleHorizontal className="w-3.5 h-3.5" />
                    Horizontal
                  </button>
                </div>
              </div>

              {sizePreset === 'custom' && (
                <div className="pt-3 border-t theme-border space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Medidas personalizadas</span>
                    <div className="flex items-center gap-1 p-0.5 theme-surface border theme-border rounded-md">
                      <button
                        type="button"
                        onClick={() => setCustomUnit('px')}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                          customUnit === 'px' ? 'theme-accent-btn' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        Píxeles (px)
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomUnit('cm')}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                          customUnit === 'cm' ? 'theme-accent-btn' : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        Centímetros (cm)
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-2.5">
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-[11px] opacity-75 mb-1">
                        Ancho ({customUnit})
                      </label>
                      <input
                        type="number"
                        step={customUnit === 'cm' ? 0.5 : 10}
                        min={customUnit === 'cm' ? 5.3 : 200}
                        max={customUnit === 'cm' ? 158 : 6000}
                        value={displayCustomW}
                        onChange={(e) => handleCustomWidthChange(e.target.value)}
                        className="w-full rounded-md border theme-border theme-surface px-2.5 py-1.5 text-xs font-mono-tabular"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleSwapCustom}
                      title="Intercambiar ancho y alto"
                      className="p-2 rounded-md border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-[11px] opacity-75 mb-1">
                        Alto ({customUnit})
                      </label>
                      <input
                        type="number"
                        step={customUnit === 'cm' ? 0.5 : 10}
                        min={customUnit === 'cm' ? 5.3 : 200}
                        max={customUnit === 'cm' ? 158 : 6000}
                        value={displayCustomH}
                        onChange={(e) => handleCustomHeightChange(e.target.value)}
                        className="w-full rounded-md border theme-border theme-surface px-2.5 py-1.5 text-xs font-mono-tabular"
                      />
                    </div>
                  </div>

                  <div className="text-[11px] opacity-70 font-mono-tabular">
                    Equivalencia exacta: {customWidthPx} × {customHeightPx} px · {pxToCm(customWidthPx)} × {pxToCm(customHeightPx)} cm
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t theme-border theme-surface-alt shrink-0">
          <div className="text-[11px] opacity-70 truncate font-mono-tabular">
            {selectedInfo.name} · {summaryDimensionText}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap shrink-0"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium theme-accent-btn rounded-lg whitespace-nowrap shrink-0"
            >
              {mode === 'project' ? 'Crear proyecto' : 'Crear pizarrón'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
