import React, { useEffect, useState } from 'react';
import { Maximize, Minimize2, Plus, Minus, ScanSearch } from 'lucide-react';
import type { CadDraftingConfig } from '../types/cad';
import { formatCadCursorCoords } from '../utils/cad/cadSessionController';
// OPT: 2.6 — Suscripción desacoplada (~30 Hz) al cursor sin re-renderizar App completo
import { getLatestCursorWorld, subscribeCursorWorld } from '../utils/cursorBus';
import { isOptEnabled } from '../utils/optFlags';

interface BottomBarProps {
  zoom: number;
  cursorWorld: { x: number; y: number };
  cadConfig?: CadDraftingConfig;
  objectCount: number;
  selectedCount: number;
  activeLayerName: string;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  lastSavedAt: number | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitContent: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  activeSheetNumber?: number;
  totalSheets?: number;
}

export const BottomBar: React.FC<BottomBarProps> = React.memo(({
  zoom,
  cursorWorld,
  cadConfig,
  objectCount,
  selectedCount,
  activeLayerName,
  saveStatus,
  lastSavedAt,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitContent,
  onToggleFullscreen,
  isFullscreen,
  activeSheetNumber,
  totalSheets,
}) => {
  const [busCursor, setBusCursor] = useState<{ x: number; y: number }>(() =>
    getLatestCursorWorld()
  );

  useEffect(() => {
    if (!isOptEnabled('reactMemoThrottle')) return;
    return subscribeCursorWorld((pt) => {
      setBusCursor(pt);
    });
  }, []);

  const activeCursor = isOptEnabled('reactMemoThrottle') ? busCursor : cursorWorld;
  const zoomPercent = Math.round(zoom * 100);
  const formattedCoords = cadConfig
    ? formatCadCursorCoords(activeCursor, cadConfig)
    : {
        x: String(Math.round(activeCursor.x)),
        y: String(Math.round(activeCursor.y)),
        unitLabel: 'u',
      };
  const savedTimeStr = lastSavedAt
    ? new Date(lastSavedAt).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <footer className="no-print h-8 px-3 theme-surface border-t flex items-center justify-between gap-4 text-[11px] select-none shrink-0 z-20">
      {/* Document & Layer info */}
      <div className="flex items-center gap-2.5 min-w-0 opacity-85">
        <span className="truncate font-medium">
          Capa: {activeLayerName}
        </span>
        {typeof totalSheets === 'number' && totalSheets > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span
              className="tabular-nums whitespace-nowrap font-medium"
              title={`Hoja activa: ${activeSheetNumber ?? 1} de ${totalSheets}`}
            >
              Hoja {activeSheetNumber ?? 1} de {totalSheets}
            </span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="tabular-nums whitespace-nowrap">
          {objectCount} {objectCount === 1 ? 'objeto' : 'objetos'}
          {selectedCount > 0 ? ` (${selectedCount} sel.)` : ''}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">
          ·
        </span>
        <span className="hidden sm:inline whitespace-nowrap tabular-nums">
          {saveStatus === 'saving'
            ? 'Guardando en disco...'
            : saveStatus === 'unsaved'
            ? 'Sin guardar'
            : `Guardado local (${savedTimeStr})`}
        </span>
      </div>

      {/* Cursor Coordinates + Zoom Controls */}
      <div className="flex items-center gap-3 shrink-0">
        <div
          title="Coordenadas del cursor respecto al origen CAD"
          className="hidden md:flex items-center gap-2 font-mono-tabular opacity-85"
        >
          <span>X: {formattedCoords.x}</span>
          <span>Y: {formattedCoords.y}</span>
          <span className="opacity-65">{formattedCoords.unitLabel}</span>
        </div>

        <div className="flex items-center gap-1 border theme-border rounded-md px-1 py-0.5 theme-surface-alt">
          <button
            type="button"
            onClick={onZoomOut}
            title="Alejar (Ctrl+-)"
            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onZoomReset}
            title="Restablecer zoom al 100% (Ctrl+0)"
            className="px-1.5 font-mono-tabular text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10 rounded"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title="Acercar (Ctrl++)"
            className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onFitContent}
          title="Ajustar vista a todo el contenido"
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap"
        >
          <ScanSearch className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Ajustar</span>
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          title="Pantalla completa (F11)"
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        </button>
      </div>
    </footer>
  );
});

