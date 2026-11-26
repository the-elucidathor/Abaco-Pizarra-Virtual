import React, { useEffect, useState } from 'react';
import { Crosshair, Grid, Orbit, Route, X } from 'lucide-react';
import type {
  CadDraftingConfig,
  PathArrayBasePointMode,
  PathArraySessionOptions,
} from '../../types/cad';
import type { CanvasObject, Point2D } from '../../types/whiteboard';
import {
  cadDistToWorldDist,
  cadToWorld,
  formatCadNumber,
  getUnitShortLabel,
  worldDistToCadDist,
  worldToCad,
} from '../../utils/cad/cadCoords';
import { extractWorldPathPoints } from '../../utils/cad/cadArrays';

export type ArrayModalKind = 'rect' | 'polar' | 'path';

export interface ArrayModalSubmitPayload {
  kind: ArrayModalKind;
  rows: number;
  cols: number;
  dxWorld: number;
  dyWorld: number;
  centerWorld: Point2D;
  polarCount: number;
  totalAngleDeg: number;
  rotateItems: boolean;
  pathId: string;
  pathMode: 'count' | 'spacing';
  pathCount: number;
  pathSpacingWorld: number;
  alignToPath: boolean;
  pathBasePointMode: PathArrayBasePointMode;
  pathBasePointWorld: Point2D | null;
  includeOriginalAtStart: boolean;
}

interface ArrayModalProps {
  open: boolean;
  kind: ArrayModalKind;
  selectedCount: number;
  selectionCenterWorld: Point2D;
  cadConfig: CadDraftingConfig;
  candidatePaths: CanvasObject[];
  pickedCenterWorld?: Point2D | null;
  pickedPathId?: string | null;
  pickedPathBasePointWorld?: Point2D | null;
  initialPathDraft?: Partial<PathArraySessionOptions> | null;
  onChangeKind: (kind: ArrayModalKind) => void;
  onRequestPickPolarCenter: () => void;
  onRequestPickPathObject: () => void;
  onRequestPickPathBasePoint: () => void;
  onPathDraftChange?: (draft: PathArraySessionOptions) => void;
  onClose: () => void;
  onSubmit: (payload: ArrayModalSubmitPayload) => void;
}

export const ArrayModal: React.FC<ArrayModalProps> = ({
  open,
  kind,
  selectedCount,
  selectionCenterWorld,
  cadConfig,
  candidatePaths,
  pickedCenterWorld,
  pickedPathId,
  pickedPathBasePointWorld,
  initialPathDraft,
  onChangeKind,
  onRequestPickPolarCenter,
  onRequestPickPathObject,
  onRequestPickPathBasePoint,
  onPathDraftChange,
  onClose,
  onSubmit,
}) => {
  const unit = getUnitShortLabel(cadConfig.unit);
  const dec = Math.min(2, cadConfig.decimals);

  // Estado para Matriz Rectangular (MR)
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(4);
  const [dxCad, setDxCad] = useState(() =>
    Number(formatCadNumber(worldDistToCadDist(120, cadConfig), dec))
  );
  const [dyCad, setDyCad] = useState(() =>
    Number(formatCadNumber(worldDistToCadDist(100, cadConfig), dec))
  );

  // Estado para Matriz Polar (MP)
  const initialCenterCad = worldToCad(selectionCenterWorld, cadConfig);
  const [centerXCad, setCenterXCad] = useState(() =>
    Number(formatCadNumber(initialCenterCad.x, dec))
  );
  const [centerYCad, setCenterYCad] = useState(() =>
    Number(formatCadNumber(initialCenterCad.y, dec))
  );
  const [polarCount, setPolarCount] = useState(6);
  const [totalAngleDeg, setTotalAngleDeg] = useState(360);
  const [rotateItems, setRotateItems] = useState(true);

  // Estado para Matriz por Camino (MC)
  const [pathId, setPathId] = useState<string>(() => initialPathDraft?.pathObjectId ?? '');
  const [pathBasePointMode, setPathBasePointMode] = useState<PathArrayBasePointMode>(
    () => initialPathDraft?.basePointMode ?? 'closest'
  );
  const initialCustomBaseCad = worldToCad(
    initialPathDraft?.customBasePointWorld ?? selectionCenterWorld,
    cadConfig
  );
  const [customBaseXCad, setCustomBaseXCad] = useState<number>(() =>
    Number(formatCadNumber(initialCustomBaseCad.x, dec))
  );
  const [customBaseYCad, setCustomBaseYCad] = useState<number>(() =>
    Number(formatCadNumber(initialCustomBaseCad.y, dec))
  );
  const [pathMode, setPathMode] = useState<'count' | 'spacing'>(
    () => initialPathDraft?.mode ?? 'count'
  );
  const [pathCount, setPathCount] = useState(() => initialPathDraft?.count ?? 6);
  const [pathSpacingCad, setPathSpacingCad] = useState(() =>
    Number(
      formatCadNumber(
        worldDistToCadDist(initialPathDraft?.spacingWorld ?? 80, cadConfig),
        dec
      )
    )
  );
  // Predeterminado "No" para alinear elementos según requerimiento
  const [alignToPath, setAlignToPath] = useState(() => initialPathDraft?.alignToPath ?? false);
  const [includeOriginalAtStart, setIncludeOriginalAtStart] = useState(
    () => initialPathDraft?.includeOriginalAtStart ?? false
  );

  useEffect(() => {
    if (!open) return;
    if (pickedCenterWorld) {
      const c = worldToCad(pickedCenterWorld, cadConfig);
      setCenterXCad(Number(c.x.toFixed(dec)));
      setCenterYCad(Number(c.y.toFixed(dec)));
    }
  }, [pickedCenterWorld, cadConfig, dec, open]);

  useEffect(() => {
    if (!open) return;
    if (pickedPathBasePointWorld) {
      const c = worldToCad(pickedPathBasePointWorld, cadConfig);
      setCustomBaseXCad(Number(c.x.toFixed(dec)));
      setCustomBaseYCad(Number(c.y.toFixed(dec)));
      setPathBasePointMode('custom');
    }
  }, [pickedPathBasePointWorld, cadConfig, dec, open]);

  useEffect(() => {
    if (!open) return;
    if (pickedPathId) {
      setPathId(pickedPathId);
    } else if (initialPathDraft?.pathObjectId) {
      setPathId(initialPathDraft.pathObjectId);
    } else if (!pathId && candidatePaths.length > 0) {
      setPathId(candidatePaths[0].id);
    }
  }, [pickedPathId, initialPathDraft?.pathObjectId, candidatePaths, pathId, open]);

  // Sincroniza previsualización en vivo cuando el modal está en modo Camino (MC)
  useEffect(() => {
    if (!open || kind !== 'path' || !onPathDraftChange) return;
    const customBaseWorld =
      pathBasePointMode === 'custom'
        ? cadToWorld({ x: customBaseXCad, y: customBaseYCad }, cadConfig)
        : null;
    const spacingWorld = cadDistToWorldDist(Math.max(1, pathSpacingCad || 1), cadConfig);
    onPathDraftChange({
      basePointMode: pathBasePointMode,
      customBasePointWorld: customBaseWorld,
      pathObjectId: pathId || null,
      mode: pathMode,
      count: pathCount,
      spacingWorld,
      alignToPath,
      includeOriginalAtStart,
    });
  }, [
    open,
    kind,
    pathBasePointMode,
    customBaseXCad,
    customBaseYCad,
    pathId,
    pathMode,
    pathCount,
    pathSpacingCad,
    alignToPath,
    includeOriginalAtStart,
    cadConfig,
    onPathDraftChange,
  ]);

  if (!open) return null;

  const describePath = (obj: CanvasObject) => {
    const label =
      obj.type === 'line'
        ? 'Línea'
        : obj.type === 'stroke'
        ? 'Trazo libre'
        : obj.type === 'shape'
        ? `Figura (${obj.shapeKind})`
        : 'Elemento';
    const data = extractWorldPathPoints(obj);
    if (!data) return label;
    let total = 0;
    for (let i = 1; i < data.pts.length; i++) {
      total += Math.hypot(data.pts[i].x - data.pts[i - 1].x, data.pts[i].y - data.pts[i - 1].y);
    }
    return `${label} · ${formatCadNumber(worldDistToCadDist(total, cadConfig), 1)} ${unit}`;
  };

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    const dxWorld = cadDistToWorldDist(dxCad, cadConfig);
    const dyWorld = cadConfig.yAxisUp
      ? -cadDistToWorldDist(dyCad, cadConfig)
      : cadDistToWorldDist(dyCad, cadConfig);
    const centerWorld = cadToWorld({ x: centerXCad, y: centerYCad }, cadConfig);
    const pathSpacingWorld = cadDistToWorldDist(Math.max(1, pathSpacingCad), cadConfig);
    const pathBasePointWorld =
      pathBasePointMode === 'custom'
        ? cadToWorld({ x: customBaseXCad, y: customBaseYCad }, cadConfig)
        : null;

    onSubmit({
      kind,
      rows,
      cols,
      dxWorld,
      dyWorld,
      centerWorld,
      polarCount,
      totalAngleDeg,
      rotateItems,
      pathId,
      pathMode,
      pathCount,
      pathSpacingWorld,
      alignToPath,
      pathBasePointMode,
      pathBasePointWorld,
      includeOriginalAtStart,
    });
  };

  const tabCls = (active: boolean) =>
    `flex-1 py-1.5 px-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 border transition-colors ${
      active
        ? 'theme-accent-soft border-current font-semibold'
        : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
    }`;

  const isPathPreviewLayout = kind === 'path';

  return (
    <div
      className={`fixed inset-0 z-50 flex p-4 ${
        isPathPreviewLayout
          ? 'bg-transparent items-start justify-end pointer-events-none pt-14'
          : 'bg-black/45 items-center justify-center'
      }`}
    >
      <form
        onSubmit={handleApply}
        className="pointer-events-auto w-full max-w-md theme-surface border theme-border rounded-xl shadow-2xl overflow-hidden text-xs max-h-[86vh] flex flex-col"
      >
        <div className="px-4 py-3 border-b theme-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold">Generar matriz de objetos</h2>
            <p className="text-[11px] opacity-75">
              {selectedCount > 0
                ? `${selectedCount} elemento(s) seleccionado(s) · copias editables independientes`
                : 'Selecciona primero al menos un objeto en la pizarra'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 overflow-y-auto">
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => onChangeKind('rect')}
              className={tabCls(kind === 'rect')}
            >
              <Grid className="w-3.5 h-3.5" />
              Rectangular (MR)
            </button>
            <button
              type="button"
              onClick={() => onChangeKind('polar')}
              className={tabCls(kind === 'polar')}
            >
              <Orbit className="w-3.5 h-3.5" />
              Polar (MP)
            </button>
            <button
              type="button"
              onClick={() => onChangeKind('path')}
              className={tabCls(kind === 'path')}
            >
              <Route className="w-3.5 h-3.5" />
              Camino (MC)
            </button>
          </div>

          {kind === 'rect' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="opacity-75 block">Filas</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={rows}
                    onChange={(e) => setRows(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
                <label className="space-y-1">
                  <span className="opacity-75 block">Columnas</span>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={cols}
                    onChange={(e) => setCols(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="opacity-75 block">Espaciado X ({unit})</span>
                  <input
                    type="number"
                    step="any"
                    value={dxCad}
                    onChange={(e) => setDxCad(Number(e.target.value))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
                <label className="space-y-1">
                  <span className="opacity-75 block">Espaciado Y ({unit})</span>
                  <input
                    type="number"
                    step="any"
                    value={dyCad}
                    onChange={(e) => setDyCad(Number(e.target.value))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
              </div>
              <p className="text-[11px] opacity-75">
                Generará {Math.max(0, rows * cols - 1)} nueva(s) copia(s) editables.
              </p>
            </div>
          )}

          {kind === 'polar' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="opacity-75 block">Centro X ({unit})</span>
                  <input
                    type="number"
                    step="any"
                    value={centerXCad}
                    onChange={(e) => setCenterXCad(Number(e.target.value))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
                <label className="space-y-1">
                  <span className="opacity-75 block">Centro Y ({unit})</span>
                  <input
                    type="number"
                    step="any"
                    value={centerYCad}
                    onChange={(e) => setCenterYCad(Number(e.target.value))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={onRequestPickPolarCenter}
                className="w-full h-8 px-2.5 rounded border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center gap-1.5 font-medium"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Elegir centro de rotación en la pizarra
              </button>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="opacity-75 block">Cantidad total de elementos</span>
                  <input
                    type="number"
                    min={2}
                    max={120}
                    value={polarCount}
                    onChange={(e) =>
                      setPolarCount(Math.max(2, Math.min(120, Number(e.target.value) || 2)))
                    }
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
                <label className="space-y-1">
                  <span className="opacity-75 block">Ángulo total (°)</span>
                  <input
                    type="number"
                    min={-360}
                    max={360}
                    step="any"
                    value={totalAngleDeg}
                    onChange={(e) => setTotalAngleDeg(Number(e.target.value))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
              </div>
              <label className="flex items-center justify-between py-1 cursor-pointer">
                <span>Rotar orientación de objetos alrededor del centro</span>
                <input
                  type="checkbox"
                  checked={rotateItems}
                  onChange={(e) => setRotateItems(e.target.checked)}
                />
              </label>
            </div>
          )}

          {kind === 'path' && (
            <div className="space-y-3">
              {/* 1. Punto base */}
              <div className="space-y-1.5">
                <span className="opacity-75 block">Punto base que se coloca sobre el camino</span>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPathBasePointMode('closest')}
                    className={tabCls(pathBasePointMode === 'closest')}
                  >
                    Extremo (auto)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPathBasePointMode('center')}
                    className={tabCls(pathBasePointMode === 'center')}
                  >
                    Centro
                  </button>
                  <button
                    type="button"
                    onClick={() => setPathBasePointMode('custom')}
                    className={tabCls(pathBasePointMode === 'custom')}
                  >
                    Personalizado
                  </button>
                </div>

                {pathBasePointMode === 'custom' && (
                  <div className="space-y-1.5 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
                        <span className="opacity-70 text-[10.5px] block">Base X ({unit})</span>
                        <input
                          type="number"
                          step="any"
                          value={customBaseXCad}
                          onChange={(e) => setCustomBaseXCad(Number(e.target.value))}
                          className="w-full h-7 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="opacity-70 text-[10.5px] block">Base Y ({unit})</span>
                        <input
                          type="number"
                          step="any"
                          value={customBaseYCad}
                          onChange={(e) => setCustomBaseYCad(Number(e.target.value))}
                          className="w-full h-7 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={onRequestPickPathBasePoint}
                      className="w-full h-7 px-2.5 rounded border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center gap-1.5 font-medium"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                      Marcar punto base en la pizarra (RG)
                    </button>
                  </div>
                )}
              </div>

              {/* 2. Camino */}
              <div className="space-y-1">
                <span className="opacity-75 block">Trayectoria / Camino de distribución</span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={pathId}
                    onChange={(e) => setPathId(e.target.value)}
                    className="flex-1 h-8 px-2 rounded border theme-border theme-surface-alt"
                  >
                    {candidatePaths.length === 0 ? (
                      <option value="">No hay líneas, polilíneas, arcos ni círculos</option>
                    ) : (
                      candidatePaths.map((p) => (
                        <option key={p.id} value={p.id}>
                          {describePath(p)}
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={onRequestPickPathObject}
                    title="Hacer clic sobre una línea, polilínea, arco, círculo o trazo"
                    className="h-8 px-2.5 rounded border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-1 shrink-0"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    Elegir
                  </button>
                </div>
              </div>

              {/* 3. Distribución */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPathMode('count')}
                  className={tabCls(pathMode === 'count')}
                >
                  Por cantidad (Dividir)
                </button>
                <button
                  type="button"
                  onClick={() => setPathMode('spacing')}
                  className={tabCls(pathMode === 'spacing')}
                >
                  Por distancia (Medir)
                </button>
              </div>

              {pathMode === 'count' ? (
                <label className="space-y-1 block">
                  <span className="opacity-75 block">Cantidad de elementos sobre el camino</span>
                  <input
                    type="number"
                    min={2}
                    max={80}
                    value={pathCount}
                    onChange={(e) =>
                      setPathCount(Math.max(2, Math.min(80, Number(e.target.value) || 2)))
                    }
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
              ) : (
                <label className="space-y-1 block">
                  <span className="opacity-75 block">Separación a lo largo del camino ({unit})</span>
                  <input
                    type="number"
                    min={1}
                    step="any"
                    value={pathSpacingCad}
                    onChange={(e) => setPathSpacingCad(Number(e.target.value))}
                    className="w-full h-8 px-2 rounded border theme-border theme-surface-alt font-mono-tabular"
                  />
                </label>
              )}

              {/* 4. Orientación */}
              <div className="space-y-1">
                <span className="opacity-75 block">Alinear elementos según tangente del camino</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAlignToPath(false)}
                    className={tabCls(!alignToPath)}
                  >
                    No (mantener orientación)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAlignToPath(true)}
                    className={tabCls(alignToPath)}
                  >
                    Sí (seguir tangente)
                  </button>
                </div>
              </div>

              {/* 5. Incluir original en el inicio */}
              <div className="space-y-1">
                <span className="opacity-75 block">Incluir original en el inicio</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIncludeOriginalAtStart(false)}
                    className={tabCls(!includeOriginalAtStart)}
                  >
                    No (colocar copia inicial)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncludeOriginalAtStart(true)}
                    className={tabCls(includeOriginalAtStart)}
                  >
                    Sí (evitar duplicado)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t theme-border flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-lg border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={selectedCount === 0 || (kind === 'path' && !pathId)}
            className="h-8 px-4 rounded-lg theme-accent-btn font-medium disabled:opacity-45"
          >
            Generar matriz
          </button>
        </div>
      </form>
    </div>
  );
};
