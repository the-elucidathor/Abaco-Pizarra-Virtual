import React, { useState } from 'react';
import { Check, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';
import type {
  GraphFunctionItem,
  GraphObject,
  GraphPointItem,
  GraphVectorItem,
  StrokeStyle,
} from '../../types/whiteboard';
// OPT: 1.1 — Suscripción a carga diferida de mathjs
import { compileFunctionItem, useMathEngineReady } from '../../utils/mathEngine';
import { uid } from '../../utils/id';

interface GraphEditorModalProps {
  initialGraph?: GraphObject | null;
  onClose: () => void;
  onConfirm: (patch: Omit<GraphObject, 'id' | 'type' | 'layerId' | 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'locked' | 'zIndex'>) => void;
}

const CURVE_COLORS = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#d97706', '#0f172a'];

export const GraphEditorModal: React.FC<GraphEditorModalProps> = ({
  initialGraph,
  onClose,
  onConfirm,
}) => {
  const mathReady = useMathEngineReady();
  void mathReady;
  const [xMin, setXMin] = useState(initialGraph?.xMin ?? -6);
  const [xMax, setXMax] = useState(initialGraph?.xMax ?? 6);
  const [yMin, setYMin] = useState(initialGraph?.yMin ?? -4);
  const [yMax, setYMax] = useState(initialGraph?.yMax ?? 4);
  const [xStep, setXStep] = useState(initialGraph?.xStep ?? 1);
  const [yStep, setYStep] = useState(initialGraph?.yStep ?? 1);
  const [showGrid, setShowGrid] = useState(initialGraph?.showGrid ?? true);
  const [showAxes, setShowAxes] = useState(initialGraph?.showAxes ?? true);
  const [showIntersections, setShowIntersections] = useState(
    initialGraph?.showIntersections ?? true
  );
  const [backgroundColor, setBackgroundColor] = useState(
    initialGraph?.backgroundColor || '#ffffff'
  );
  const [functions, setFunctions] = useState<GraphFunctionItem[]>(
    initialGraph?.functions || [
      {
        id: uid('fn'),
        expression: 'x^2 - 2',
        color: '#2563eb',
        strokeStyle: 'solid',
        strokeWidth: 2.5,
        visible: true,
      },
      {
        id: uid('fn'),
        expression: 'x',
        color: '#dc2626',
        strokeStyle: 'solid',
        strokeWidth: 2,
        visible: true,
      },
    ]
  );
  const [points, setPoints] = useState<GraphPointItem[]>(initialGraph?.points || []);
  const [vectors, setVectors] = useState<GraphVectorItem[]>(initialGraph?.vectors || []);

  const addFunction = () => {
    const color = CURVE_COLORS[functions.length % CURVE_COLORS.length];
    setFunctions((prev) => [
      ...prev,
      {
        id: uid('fn'),
        expression: 'sin(x)',
        color,
        strokeStyle: 'solid',
        strokeWidth: 2.2,
        visible: true,
      },
    ]);
  };

  const addPoint = () => {
    setPoints((prev) => [
      ...prev,
      { id: uid('pt'), label: `P${prev.length + 1}`, x: 1, y: 1, color: '#059669' },
    ]);
  };

  const addVector = () => {
    setVectors((prev) => [
      ...prev,
      {
        id: uid('vec'),
        label: `v${prev.length + 1}`,
        x1: 0,
        y1: 0,
        x2: 2,
        y2: 2,
        color: '#7c3aed',
      },
    ]);
  };

  const handleSave = () => {
    const safeXMax = xMax > xMin ? xMax : xMin + 2;
    const safeYMax = yMax > yMin ? yMax : yMin + 2;
    onConfirm({
      xMin,
      xMax: safeXMax,
      yMin,
      yMax: safeYMax,
      xStep: Math.max(0.1, xStep),
      yStep: Math.max(0.1, yStep),
      showGrid,
      showAxes,
      showIntersections,
      functions,
      points,
      vectors,
      backgroundColor,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {initialGraph ? 'Configurar plano cartesiano y gráficas' : 'Insertar plano cartesiano'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto panel-scroll space-y-5">
          {/* Axes & Grid Limits */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                X Mín
              </label>
              <input
                type="number"
                value={xMin}
                onChange={(e) => setXMin(Number(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                X Máx
              </label>
              <input
                type="number"
                value={xMax}
                onChange={(e) => setXMax(Number(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Paso X
              </label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={xStep}
                onChange={(e) => setXStep(Number(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Y Mín
              </label>
              <input
                type="number"
                value={yMin}
                onChange={(e) => setYMin(Number(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Y Máx
              </label>
              <input
                type="number"
                value={yMax}
                onChange={(e) => setYMax(Number(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Paso Y
              </label>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={yStep}
                onChange={(e) => setYStep(Number(e.target.value))}
                className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono-tabular"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Mostrar cuadrícula</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showAxes}
                onChange={(e) => setShowAxes(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Mostrar ejes</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showIntersections}
                onChange={(e) => setShowIntersections(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Detectar intersecciones</span>
            </label>
            <label className="flex items-center gap-2 ml-auto">
              <span className="text-slate-600 dark:text-slate-400">Fondo:</span>
              <input
                type="color"
                value={backgroundColor === 'transparent' ? '#ffffff' : backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="w-6 h-6 rounded border border-slate-300 cursor-pointer"
              />
            </label>
          </div>

          {/* Functions */}
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Funciones matemáticas (ej. sin(x), x^2 - 3, sqrt(x+4), 1/x, abs(x))
              </h3>
              <button
                type="button"
                onClick={addFunction}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar función
              </button>
            </div>
            <div className="space-y-2">
              {functions.map((fn) => {
                const check = compileFunctionItem(fn);
                return (
                  <div
                    key={fn.id}
                    className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50"
                  >
                    <span className="text-xs font-mono-tabular text-slate-500">y =</span>
                    <input
                      type="text"
                      value={fn.expression}
                      onChange={(e) =>
                        setFunctions((prev) =>
                          prev.map((item) =>
                            item.id === fn.id ? { ...item, expression: e.target.value } : item
                          )
                        )
                      }
                      className="flex-1 min-w-[160px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-mono-tabular"
                    />
                    <input
                      type="color"
                      value={fn.color}
                      onChange={(e) =>
                        setFunctions((prev) =>
                          prev.map((item) =>
                            item.id === fn.id ? { ...item, color: e.target.value } : item
                          )
                        )
                      }
                      className="w-7 h-7 rounded border border-slate-300 cursor-pointer"
                    />
                    <select
                      value={fn.strokeStyle}
                      onChange={(e) =>
                        setFunctions((prev) =>
                          prev.map((item) =>
                            item.id === fn.id
                              ? { ...item, strokeStyle: e.target.value as StrokeStyle }
                              : item
                          )
                        )
                      }
                      className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                    >
                      <option value="solid">Continua</option>
                      <option value="dashed">Discontinua</option>
                      <option value="dotted">Punteada</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setFunctions((prev) =>
                          prev.map((item) =>
                            item.id === fn.id ? { ...item, visible: !item.visible } : item
                          )
                        )
                      }
                      className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                      title={fn.visible ? 'Ocultar curva' : 'Mostrar curva'}
                    >
                      {fn.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFunctions((prev) => prev.filter((item) => item.id !== fn.id))}
                      className="p-1.5 rounded hover:bg-red-100 text-red-600"
                      title="Eliminar función"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    {check.error && (
                      <span className="w-full text-[11px] text-red-600">{check.error}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Points & Vectors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-200 dark:border-slate-800 pt-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Puntos coordenados
                </h3>
                <button
                  type="button"
                  onClick={addPoint}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded"
                >
                  <Plus className="w-3 h-3" />
                  Punto
                </button>
              </div>
              <div className="space-y-1.5">
                {points.map((pt) => (
                  <div key={pt.id} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="text"
                      value={pt.label}
                      onChange={(e) =>
                        setPoints((prev) =>
                          prev.map((p) => (p.id === pt.id ? { ...p, label: e.target.value } : p))
                        )
                      }
                      className="w-14 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1"
                      placeholder="Etiq."
                    />
                    <input
                      type="number"
                      step="0.25"
                      value={pt.x}
                      onChange={(e) =>
                        setPoints((prev) =>
                          prev.map((p) =>
                            p.id === pt.id ? { ...p, x: Number(e.target.value) } : p
                          )
                        )
                      }
                      className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono-tabular"
                    />
                    <input
                      type="number"
                      step="0.25"
                      value={pt.y}
                      onChange={(e) =>
                        setPoints((prev) =>
                          prev.map((p) =>
                            p.id === pt.id ? { ...p, y: Number(e.target.value) } : p
                          )
                        )
                      }
                      className="w-16 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 font-mono-tabular"
                    />
                    <input
                      type="color"
                      value={pt.color}
                      onChange={(e) =>
                        setPoints((prev) =>
                          prev.map((p) => (p.id === pt.id ? { ...p, color: e.target.value } : p))
                        )
                      }
                      className="w-6 h-6 rounded border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => setPoints((prev) => prev.filter((p) => p.id !== pt.id))}
                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {points.length === 0 && (
                  <p className="text-[11px] text-slate-400">Sin puntos añadidos.</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Vectores (x₁,y₁ → x₂,y₂)
                </h3>
                <button
                  type="button"
                  onClick={addVector}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded"
                >
                  <Plus className="w-3 h-3" />
                  Vector
                </button>
              </div>
              <div className="space-y-1.5">
                {vectors.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-1 text-xs">
                    <input
                      type="text"
                      value={v.label}
                      onChange={(e) =>
                        setVectors((prev) =>
                          prev.map((item) =>
                            item.id === v.id ? { ...item, label: e.target.value } : item
                          )
                        )
                      }
                      className="w-10 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 py-1"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={v.x1}
                      onChange={(e) =>
                        setVectors((prev) =>
                          prev.map((item) =>
                            item.id === v.id ? { ...item, x1: Number(e.target.value) } : item
                          )
                        )
                      }
                      className="w-12 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 py-1 font-mono-tabular"
                      title="x1"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={v.y1}
                      onChange={(e) =>
                        setVectors((prev) =>
                          prev.map((item) =>
                            item.id === v.id ? { ...item, y1: Number(e.target.value) } : item
                          )
                        )
                      }
                      className="w-12 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 py-1 font-mono-tabular"
                      title="y1"
                    />
                    <span>→</span>
                    <input
                      type="number"
                      step="0.5"
                      value={v.x2}
                      onChange={(e) =>
                        setVectors((prev) =>
                          prev.map((item) =>
                            item.id === v.id ? { ...item, x2: Number(e.target.value) } : item
                          )
                        )
                      }
                      className="w-12 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 py-1 font-mono-tabular"
                      title="x2"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={v.y2}
                      onChange={(e) =>
                        setVectors((prev) =>
                          prev.map((item) =>
                            item.id === v.id ? { ...item, y2: Number(e.target.value) } : item
                          )
                        )
                      }
                      className="w-12 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1 py-1 font-mono-tabular"
                      title="y2"
                    />
                    <input
                      type="color"
                      value={v.color}
                      onChange={(e) =>
                        setVectors((prev) =>
                          prev.map((item) =>
                            item.id === v.id ? { ...item, color: e.target.value } : item
                          )
                        )
                      }
                      className="w-6 h-6 rounded border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => setVectors((prev) => prev.filter((item) => item.id !== v.id))}
                      className="p-1 text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {vectors.length === 0 && (
                  <p className="text-[11px] text-slate-400">Sin vectores añadidos.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
            {initialGraph ? 'Actualizar gráfica' : 'Insertar gráfica'}
          </button>
        </div>
      </div>
    </div>
  );
};
