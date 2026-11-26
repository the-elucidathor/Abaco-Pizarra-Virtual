import React, { useEffect, useState } from 'react';
import {
  Copy,
  Crop,
  Download,
  FileCode,
  FileImage,
  FileText,
  Grid,
  Layers,
  Printer,
  Square,
  X,
} from 'lucide-react';
import type { Board, CanvasObject, WhiteboardProject } from '../../types/whiteboard';
import {
  type ExportBackgroundMode,
  copyElementAsPngToClipboard,
  copyFixedPageAsPngToClipboard,
  downloadProjectFile,
  exportCroppedRegionToPng,
  exportElementToPdf,
  exportElementToPng,
  exportFixedPageToPng,
  exportFixedSheetsToPdf,
  exportFixedSheetsToPng,
} from '../../utils/exportEngine';
import {
  getPresetInfo,
  getSheetY,
  isFixedSizeBoard,
  normalizarHojas,
} from '../../utils/boardSizes';
import { getObjectsBoundingBox } from '../../utils/id';

export interface ExportCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExportModalProps {
  project: WhiteboardProject;
  board: Board;
  activeSheetIndex?: number;
  selectedIds: string[];
  stageElement: HTMLElement | null;
  areaRect: ExportCropRect | null;
  onStartAreaSelection: () => void;
  onClearAreaRect: () => void;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  board,
  activeSheetIndex = 0,
  selectedIds,
  stageElement,
  areaRect,
  onStartAreaSelection,
  onClearAreaRect,
  onClose,
}) => {
  const isFixedPage = isFixedSizeBoard(board);
  const sheets = isFixedPage ? normalizarHojas(board) : [];
  const totalSheets = sheets.length;
  const safeActiveSheetIdx =
    totalSheets > 0 ? Math.max(0, Math.min(totalSheets - 1, activeSheetIndex)) : 0;
  const presetInfo = getPresetInfo(board.sizePreset);
  const [scale, setScale] = useState<1 | 2 | 3>(2);
  const [bgMode, setBgMode] = useState<ExportBackgroundMode>('board');
  const [scope, setScope] = useState<'full' | 'area' | 'selection'>(
    areaRect ? 'area' : 'full'
  );
  const [pngSheetScope, setPngSheetScope] = useState<'all' | 'current'>('all');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (areaRect) {
      setScope('area');
    }
  }, [areaRect]);

  const selectedObjects: CanvasObject[] = board.objects.filter((o) =>
    selectedIds.includes(o.id)
  );
  const hasSelection = selectedObjects.length > 0;
  const safeBaseName = `${project.name}-${board.name}`
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '_')
    .slice(0, 64);

  const getSelectionViewportRect = (): ExportCropRect | undefined => {
    if (!stageElement || selectedObjects.length === 0) return undefined;
    const bbox = getObjectsBoundingBox(selectedObjects);
    if (!bbox) return undefined;
    const pad = 24;
    const { panX, panY, zoom } = board.viewport;
    return {
      x: (bbox.x - pad) * zoom + panX,
      y: (bbox.y - pad) * zoom + panY,
      width: (bbox.width + pad * 2) * zoom,
      height: (bbox.height + pad * 2) * zoom,
    };
  };

  const resolveActiveCropRect = (): ExportCropRect | undefined => {
    if (scope === 'area') return areaRect || undefined;
    if (scope === 'selection') return getSelectionViewportRect();
    return undefined;
  };

  const canRunImageExport =
    Boolean(stageElement) &&
    (scope === 'full' ||
      (scope === 'area' && Boolean(areaRect)) ||
      (scope === 'selection' && hasSelection));

  const suffix =
    scope === 'area' ? '-area' : scope === 'selection' ? '-seleccion' : '';

  const sheetYs =
    isFixedPage && board.pageHeight
      ? sheets.map((_, idx) => getSheetY(idx, board.pageHeight!))
      : [0];
  const activeSheetY = sheetYs[safeActiveSheetIdx] ?? 0;

  const handleExportPng = async () => {
    if (!stageElement || !canRunImageExport) return;
    setBusy(true);
    try {
      const cropRect = resolveActiveCropRect();
      const captureOpts = { excludeFrame: scope === 'selection' };
      if (cropRect) {
        await exportCroppedRegionToPng(
          stageElement,
          cropRect,
          `${safeBaseName}${suffix}.png`,
          scale,
          bgMode,
          captureOpts
        );
      } else if (isFixedPage && board.pageWidth && board.pageHeight) {
        if (totalSheets > 1 && pngSheetScope === 'all') {
          await exportFixedSheetsToPng(
            stageElement,
            board.pageWidth,
            board.pageHeight,
            sheetYs,
            `${safeBaseName}-hojas.png`,
            scale,
            bgMode
          );
        } else {
          const pageSuffix = totalSheets > 1 ? `-hoja-${safeActiveSheetIdx + 1}` : '';
          await exportFixedPageToPng(
            stageElement,
            board.pageWidth,
            board.pageHeight,
            `${safeBaseName}${pageSuffix}.png`,
            scale,
            bgMode,
            activeSheetY
          );
        }
      } else {
        await exportElementToPng(stageElement, `${safeBaseName}.png`, scale, bgMode, captureOpts);
      }
      setFeedback(
        bgMode === 'transparent'
          ? 'PNG con fondo transparente descargado correctamente.'
          : bgMode === 'board'
          ? 'PNG con diseño de pizarra descargado correctamente.'
          : 'PNG con fondo blanco sólido descargado correctamente.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleExportPdf = async () => {
    if (!stageElement || !canRunImageExport) return;
    setBusy(true);
    try {
      const cropRect = resolveActiveCropRect();
      const captureOpts = { excludeFrame: scope === 'selection' };
      if (!cropRect && isFixedPage && board.pageWidth && board.pageHeight) {
        await exportFixedSheetsToPdf(
          stageElement,
          board.pageWidth,
          board.pageHeight,
          sheetYs,
          `${safeBaseName}.pdf`,
          bgMode,
          scale
        );
      } else {
        await exportElementToPdf(
          stageElement,
          `${safeBaseName}${suffix}.pdf`,
          cropRect,
          bgMode,
          scale,
          captureOpts
        );
      }
      setFeedback(
        !cropRect && isFixedPage && totalSheets > 1
          ? `PDF de ${totalSheets} hojas exportado correctamente.`
          : 'Documento PDF exportado correctamente.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCopyClipboard = async () => {
    if (!stageElement || !canRunImageExport) return;
    setBusy(true);
    try {
      const cropRect = resolveActiveCropRect();
      const captureOpts = { excludeFrame: scope === 'selection' };
      const ok =
        !cropRect && isFixedPage && board.pageWidth && board.pageHeight
          ? await copyFixedPageAsPngToClipboard(
              stageElement,
              board.pageWidth,
              board.pageHeight,
              scale,
              bgMode,
              activeSheetY
            )
          : await copyElementAsPngToClipboard(
              stageElement,
              cropRect,
              scale,
              bgMode,
              captureOpts
            );
      setFeedback(
        ok
          ? 'Imagen copiada al portapapeles.'
          : 'El navegador bloqueó el acceso directo al portapapeles; usa Descargar PNG.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = () => {
    onClose();
    setTimeout(() => window.print(), 150);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-2xl theme-surface border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b theme-border">
          <h2 className="text-base font-semibold">Exportar e imprimir pizarra</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto panel-scroll">
          {feedback && (
            <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
              {feedback}
            </div>
          )}

          {/* 1. Alcance: Tablero completo / Área específica / Selección */}
          <div className="space-y-2">
            <div className="text-xs font-semibold opacity-80">1. Área a exportar</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setScope('full')}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  scope === 'full'
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <div className="text-xs font-semibold">
                  {isFixedPage
                    ? totalSheets > 1
                      ? `Pizarrón completo (${totalSheets} hojas)`
                      : 'Hoja completa'
                    : 'Tablero completo'}
                </div>
                <div className="text-[11px] opacity-70 font-mono-tabular">
                  {isFixedPage
                    ? `${presetInfo.name} · ${board.pageWidth} × ${board.pageHeight} px`
                    : 'Toda la vista visible'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setScope('area')}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  scope === 'area'
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <div className="text-xs font-semibold flex items-center gap-1.5">
                  <Crop className="w-3.5 h-3.5" />
                  Área específica
                </div>
                <div className="text-[11px] opacity-70">
                  {areaRect
                    ? `${Math.round(areaRect.width)} × ${Math.round(areaRect.height)} px`
                    : 'Recorte libre en pizarra'}
                </div>
              </button>

              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => setScope('selection')}
                className={`p-2.5 rounded-lg border text-left transition-colors disabled:opacity-45 disabled:pointer-events-none ${
                  scope === 'selection'
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <div className="text-xs font-semibold">Selección actual</div>
                <div className="text-[11px] opacity-70">
                  {hasSelection
                    ? `${selectedObjects.length} objeto(s)`
                    : 'Sin objetos seleccionados'}
                </div>
              </button>
            </div>

            {isFixedPage && scope === 'full' && totalSheets > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg theme-surface-alt border theme-border text-xs">
                <span className="font-medium opacity-85">Hojas en PNG:</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPngSheetScope('all')}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      pngSheetScope === 'all'
                        ? 'theme-accent-soft ring-1 ring-current'
                        : 'hover:bg-black/5 dark:hover:bg-white/10 opacity-80'
                    }`}
                  >
                    Todas las hojas ({totalSheets})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPngSheetScope('current')}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                      pngSheetScope === 'current'
                        ? 'theme-accent-soft ring-1 ring-current'
                        : 'hover:bg-black/5 dark:hover:bg-white/10 opacity-80'
                    }`}
                  >
                    Hoja actual ({safeActiveSheetIdx + 1} de {totalSheets})
                  </button>
                </div>
              </div>
            )}

            {scope === 'area' && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg theme-surface-alt border theme-border text-xs">
                <div>
                  {areaRect ? (
                    <span>
                      Sección marcada:{' '}
                      <strong className="font-mono-tabular">
                        {Math.round(areaRect.width)} × {Math.round(areaRect.height)} px
                      </strong>
                    </span>
                  ) : (
                    <span className="opacity-75">
                      Dibuja un recuadro sobre la pizarra para definir la sección exacta.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {areaRect && (
                    <button
                      type="button"
                      onClick={onClearAreaRect}
                      className="px-2.5 py-1 rounded border theme-border hover:bg-black/5 dark:hover:bg-white/10 text-[11px]"
                    >
                      Limpiar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onStartAreaSelection}
                    className="flex items-center gap-1.5 px-3 py-1 rounded theme-accent-btn text-[11px] font-medium whitespace-nowrap"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    {areaRect ? 'Volver a seleccionar área' : 'Seleccionar área en pizarra'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2. Fondo de exportación */}
          <div className="space-y-2">
            <div className="text-xs font-semibold opacity-80">2. Fondo de exportación</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setBgMode('board')}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                  bgMode === 'board'
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <span className="w-7 h-7 rounded border border-slate-300 bg-white flex items-center justify-center shrink-0 text-slate-600">
                  <Grid className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-xs font-semibold">Diseño de la pizarra</div>
                  <div className="text-[11px] opacity-70">Conserva cuadrícula y ejes</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBgMode('transparent')}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                  bgMode === 'transparent'
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <span
                  className="w-7 h-7 rounded border border-slate-300 shrink-0 flex items-center justify-center"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, #cbd5e1 25%, transparent 25%), linear-gradient(-45deg, #cbd5e1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #cbd5e1 75%), linear-gradient(-45deg, transparent 75%, #cbd5e1 75%)',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                  }}
                >
                  <Layers className="w-3.5 h-3.5 text-slate-800" />
                </span>
                <div>
                  <div className="text-xs font-semibold">Exportar con fondo transparente</div>
                  <div className="text-[11px] opacity-70">Sin color de fondo, marco ni cuadrícula</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBgMode('white')}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                  bgMode === 'white'
                    ? 'theme-accent-soft border-current ring-1 ring-current'
                    : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <span className="w-7 h-7 rounded border border-slate-300 bg-white flex items-center justify-center shrink-0 text-slate-500">
                  <Square className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-xs font-semibold">Fondo blanco sólido</div>
                  <div className="text-[11px] opacity-70">
                    {isFixedPage ? 'Marco y patrón sobre blanco' : 'Patrón y trazos sobre blanco'}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. Calidad */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-semibold opacity-80">3. Calidad de imagen (escala)</span>
            <div className="flex items-center gap-1 p-1 theme-surface-alt rounded-lg">
              {([1, 2, 3] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScale(s)}
                  className={`px-3 py-1 text-xs font-medium rounded-md tabular-nums ${
                    scale === s ? 'theme-surface shadow-xs' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>

          {/* 4. Formatos de salida */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={busy || !canRunImageExport}
              onClick={handleExportPng}
              className="flex items-center gap-2.5 p-3 rounded-lg border theme-border hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 text-left transition-colors disabled:opacity-45 disabled:pointer-events-none"
            >
              <FileImage className="w-5 h-5 text-blue-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold">
                  Descargar PNG {scope === 'area' ? '(área)' : scope === 'selection' ? '(selección)' : ''}
                </div>
                <div className="text-[11px] opacity-70">
                  {bgMode === 'transparent'
                    ? 'Imagen con transparencia alfa'
                    : bgMode === 'board'
                    ? 'Incluye el diseño actual de pizarra'
                    : 'Fondo blanco limpio'}
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy || !canRunImageExport}
              onClick={handleExportPdf}
              className="flex items-center gap-2.5 p-3 rounded-lg border theme-border hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 text-left transition-colors disabled:opacity-45 disabled:pointer-events-none"
            >
              <FileText className="w-5 h-5 text-red-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold">
                  Descargar PDF {scope === 'area' ? '(área)' : scope === 'selection' ? '(selección)' : ''}
                </div>
                <div className="text-[11px] opacity-70">
                  {bgMode === 'transparent'
                    ? 'Hoja limpia sin color de fondo ni marco'
                    : bgMode === 'white'
                    ? isFixedPage
                      ? 'Marco y patrón sobre fondo blanco'
                      : 'Patrón y trazos sobre fondo blanco'
                    : 'Hoja con diseño de pizarra'}
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy || !canRunImageExport}
              onClick={handleCopyClipboard}
              className="flex items-center gap-2.5 p-3 rounded-lg border theme-border hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 text-left transition-colors disabled:opacity-45 disabled:pointer-events-none"
            >
              <Copy className="w-5 h-5 opacity-80 shrink-0" />
              <div>
                <div className="text-xs font-semibold">Copiar imagen al portapapeles</div>
                <div className="text-[11px] opacity-70">Listo para pegar en editores de documentos o presentaciones</div>
              </div>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => downloadProjectFile(project)}
              className="flex items-center gap-2.5 p-3 rounded-lg border theme-border hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 text-left transition-colors"
            >
              <FileCode className="w-5 h-5 text-indigo-600 shrink-0" />
              <div>
                <div className="text-xs font-semibold">Archivo editable (.pizarra)</div>
                <div className="text-[11px] opacity-70">Conserva capas, fórmulas y tableros</div>
              </div>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t theme-border theme-surface-alt">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Imprimir tablero
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium theme-accent-btn rounded-lg whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
