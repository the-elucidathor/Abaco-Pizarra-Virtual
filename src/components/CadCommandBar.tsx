import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  Crosshair,
  Grid,
  Magnet,
  SlidersHorizontal,
  Terminal,
  X,
} from 'lucide-react';
import {
  type CadCommandId,
  type CadDraftingConfig,
  type CadSessionState,
  type CadSnapKind,
  type CadTrackingMode,
  type CadUnit,
  FEATURE_TRACKING_ENABLED,
} from '../types/cad';
import { getCadPromptInfo } from '../utils/cad/cadSessionController';
import { getUnitShortLabel } from '../utils/cad/cadCoords';

interface CadCommandBarProps {
  session: CadSessionState;
  config: CadDraftingConfig;
  gridVisible: boolean;
  selectedCount?: number;
  inputValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInputChange: (val: string) => void;
  onSubmitCommand: (raw: string) => void;
  onCancelCommand: () => void;
  onTriggerOption: (code: string) => void;
  onStartCommand: (cmd: CadCommandId) => void;
  onToggleGridVisible: () => void;
  onUpdateConfig: (patch: Partial<CadDraftingConfig>) => void;
  onToggleOsnapMode: (mode: CadSnapKind) => void;
  onStartPickOrigin: () => void;
}

const RG_LABELS: { key: CadSnapKind; label: string; symbol: string }[] = [
  { key: 'endpoint', label: 'Extremo', symbol: '□' },
  { key: 'midpoint', label: 'Punto medio', symbol: '△' },
  { key: 'center', label: 'Centro', symbol: '○' },
  { key: 'quadrant', label: 'Cuadrante', symbol: '◇' },
  { key: 'intersection', label: 'Intersección', symbol: '✕' },
  { key: 'perpendicular', label: 'Perpendicular', symbol: '∟' },
  { key: 'parallel', label: 'Paralelo', symbol: '//' },
];

const QUICK_COMMANDS: { id: CadCommandId; label: string; title: string }[] = [
  { id: 'line', label: 'LIN', title: 'Línea por coordenadas (LIN)' },
  { id: 'pline', label: 'PL', title: 'Polilínea editable (PL)' },
  { id: 'rectangle', label: 'REC', title: 'Rectángulo preciso (REC)' },
  { id: 'circle', label: 'CIR', title: 'Círculo centro/radio/diámetro (CIR)' },
  { id: 'arc', label: 'ARC', title: 'Arco 3 puntos o centro-ángulo (ARC)' },
  { id: 'polygon', label: 'POL', title: 'Polígono N lados inscrito/circunscrito (POL)' },
  { id: 'dim-linear', label: 'ACL', title: 'Acotación lineal H/V/Alineada (ACL)' },
  { id: 'dim-aligned', label: 'ACA', title: 'Acotación alineada en dirección del elemento (ACA)' },
  { id: 'mirror', label: 'SIM', title: 'Simetría geométrica (SIM)' },
  { id: 'match-points', label: 'CP', title: 'Coincidencia de puntos (CP)' },
];

// OPT: 2.6 — Evita re-renderizar la barra CAD al mover puntero o cambiar zoom
export const CadCommandBar: React.FC<CadCommandBarProps> = React.memo(({
  session,
  config,
  gridVisible,
  selectedCount = 0,
  inputValue,
  inputRef,
  onInputChange,
  onSubmitCommand,
  onCancelCommand,
  onTriggerOption,
  onStartCommand,
  onToggleGridVisible,
  onUpdateConfig,
  onToggleOsnapMode,
  onStartPickOrigin,
}) => {
  const [openPopover, setOpenPopover] = useState<'rg' | 'ras' | 'settings' | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openPopover) return;
    const onOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopover(null);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null);
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, [openPopover]);

  const promptInfo = getCadPromptInfo(session, config, selectedCount);
  const isActive = Boolean(session.activeCommand || session.pickingOrigin);

  const aidBtnCls = (active: boolean) =>
    `px-1.5 py-0.5 rounded text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
      active
        ? 'theme-accent-soft border-current font-semibold'
        : 'theme-border opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
    }`;

  return (
    <div
      ref={popoverRef}
      className="no-print relative h-9 px-2.5 theme-surface border-t theme-border flex items-center justify-between gap-2 text-[11px] select-none shrink-0 z-20"
    >
      {/* Left: Command Input & Contextual Prompt */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono-tabular font-semibold text-[10px] tracking-wide shrink-0 ${
            isActive
              ? 'theme-accent-btn'
              : 'theme-surface-alt border theme-border opacity-85'
          }`}
        >
          <Terminal className="w-3 h-3" />
          {promptInfo.commandLabel}
        </span>

        {!isActive && (
          <div className="hidden xl:flex items-center gap-0.5 shrink-0">
            {QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                title={cmd.title}
                onClick={() => {
                  onStartCommand(cmd.id);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className="px-1.5 py-0.5 rounded font-mono-tabular text-[10.5px] font-semibold hover:bg-black/5 dark:hover:bg-white/10 opacity-80 hover:opacity-100 whitespace-nowrap"
              >
                {cmd.label}
              </button>
            ))}
          </div>
        )}

        <span
          title={promptInfo.prompt}
          className="hidden sm:inline truncate opacity-80 text-[11px] max-w-[340px]"
        >
          {promptInfo.prompt}
        </span>

        <form
          className="flex items-center gap-1 min-w-[135px] flex-1 max-w-[260px]"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitCommand(inputValue);
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (inputValue) {
                  onInputChange('');
                } else {
                  onCancelCommand();
                }
              }
            }}
            placeholder={
              isActive
                ? 'X,Y · @dX,dY · @dist<áng'
                : 'Comando (LIN, PL, REC, CIR, ARC, POL, ACL, ACA, SIM, MR)...'
            }
            aria-label="Barra de comandos de dibujo técnico"
            className="w-full h-6 px-2 rounded border theme-border theme-surface-alt font-mono-tabular text-[11px] outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>

        {/* Contextual sub-options */}
        {isActive && (
          <div className="flex items-center gap-1 shrink-0">
            {promptInfo.options.map((opt) => (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  if (opt.code === 'ESC') onCancelCommand();
                  else if (opt.code === 'ENTER') onSubmitCommand('');
                  else onTriggerOption(opt.code);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className={`px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap transition-colors ${
                  opt.active
                    ? 'theme-accent-soft border-current'
                    : 'theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {promptInfo.options.every((o) => o.code !== 'ESC') && (
              <button
                type="button"
                onClick={onCancelCommand}
                title="Cancelar comando (Esc)"
                className="p-0.5 rounded border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {session.statusMessage && (
          <span className="hidden lg:inline text-[10px] opacity-70 truncate max-w-[210px]">
            {session.statusMessage}
          </span>
        )}
      </div>

      {/* Right: Technical Drafting Aids */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onToggleGridVisible}
          title="GRID: Mostrar u ocultar cuadrícula de referencia (F7)"
          className={aidBtnCls(gridVisible)}
        >
          <Grid className="w-3 h-3" />
          <span className="hidden md:inline">GRID</span>
        </button>

        <button
          type="button"
          onClick={() => onUpdateConfig({ gridSnap: !config.gridSnap })}
          title={`SNAP: Ajuste a incrementos de ${config.snapStep} ${getUnitShortLabel(config.unit)} (F9)`}
          className={aidBtnCls(config.gridSnap)}
        >
          <span>SNAP</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              ortho: !config.ortho,
              polar: !config.ortho ? false : config.polar,
            })
          }
          title="Líneas: horizontal/vertical. Figuras: proporción 1:1 (F8)"
          className={aidBtnCls(config.ortho)}
        >
          <span>ORT</span>
        </button>

        <button
          type="button"
          onClick={() =>
            onUpdateConfig({
              polar: !config.polar,
              ortho: !config.polar ? false : config.ortho,
            })
          }
          title={`SP: Seguimiento polar cada ${config.polarAngle}° (F10)`}
          className={aidBtnCls(config.polar)}
        >
          <span>SP {config.polarAngle}°</span>
        </button>

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => onUpdateConfig({ osnapEnabled: !config.osnapEnabled })}
            title="RG: Referencias geométricas (Extremo, Medio, Centro, Cuadrante, Intersección, Perpendicular, Paralelo) (F3)"
            className={`${aidBtnCls(config.osnapEnabled)} rounded-r-none border-r-0`}
          >
            <Magnet className="w-3 h-3" />
            <span>RG</span>
          </button>
          <button
            type="button"
            onClick={() => setOpenPopover(openPopover === 'rg' ? null : 'rg')}
            title="Configurar modos de Referencias geométricas (RG)"
            className={`px-1 py-0.5 rounded-r border text-[11px] transition-colors ${
              config.osnapEnabled
                ? 'theme-accent-soft border-current'
                : 'theme-border opacity-75 hover:opacity-100'
            }`}
          >
            <ChevronUp className="w-3 h-3" />
          </button>
        </div>

        {FEATURE_TRACKING_ENABLED && (
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => onUpdateConfig({ trackingEnabled: !config.trackingEnabled })}
              title="Rastreo de referencia: líneas guía desde puntos de otros objetos (Shift+F11)"
              className={`${aidBtnCls(config.trackingEnabled)} rounded-r-none border-r-0`}
            >
              <span>RAS</span>
            </button>
            <button
              type="button"
              onClick={() => setOpenPopover(openPopover === 'ras' ? null : 'ras')}
              title="Configurar Rastreo de referencia (RAS)"
              className={`px-1 py-0.5 rounded-r border text-[11px] transition-colors ${
                config.trackingEnabled
                  ? 'theme-accent-soft border-current'
                  : 'theme-border opacity-75 hover:opacity-100'
              }`}
            >
              <ChevronUp className="w-3 h-3" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => onUpdateConfig({ dynInput: !config.dynInput })}
          title="DIN: Entrada dinámica junto al cursor (F12)"
          className={aidBtnCls(config.dynInput)}
        >
          <span>DIN</span>
        </button>

        <button
          type="button"
          onClick={() => setOpenPopover(openPopover === 'settings' ? null : 'settings')}
          title="Configuración de coordenadas, origen, unidades y precisión"
          className={aidBtnCls(openPopover === 'settings')}
        >
          <SlidersHorizontal className="w-3 h-3" />
          <span className="hidden sm:inline font-mono-tabular">
            {getUnitShortLabel(config.unit)}
          </span>
        </button>
      </div>

      {/* RG (Referencias geométricas) Modes Popover */}
      {openPopover === 'rg' && (
        <div className="absolute right-16 bottom-10 w-64 theme-surface border theme-border rounded-lg shadow-xl p-2.5 z-50 space-y-1.5">
          <div className="flex items-center justify-between pb-1 border-b theme-border">
            <span className="text-[11px] font-semibold">Referencias geométricas (RG)</span>
            <button
              type="button"
              onClick={() => setOpenPopover(null)}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {RG_LABELS.map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer text-[11px]"
            >
              <span className="flex items-center gap-2">
                <span className="w-4 text-center font-mono-tabular font-bold text-amber-500">
                  {item.symbol}
                </span>
                <span>{item.label}</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(config.osnapModes[item.key])}
                onChange={() => onToggleOsnapMode(item.key)}
                className="rounded border-slate-400"
              />
            </label>
          ))}
        </div>
      )}

      {/* RAS (Rastreo de referencia) Popover */}
      {FEATURE_TRACKING_ENABLED && openPopover === 'ras' && (
        <div className="absolute right-10 bottom-10 w-72 theme-surface border theme-border rounded-lg shadow-xl p-3 z-50 space-y-2.5 text-[11px]">
          <div className="flex items-center justify-between pb-1 border-b theme-border">
            <span className="font-semibold">Rastreo de referencia (RAS)</span>
            <button
              type="button"
              onClick={() => setOpenPopover(null)}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1">
            <span className="opacity-75 block">Modo de adquisición</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['auto', 'Automático'],
                  ['acquire', 'Por adquisición'],
                ] as [CadTrackingMode, string][]
              ).map(([modeKey, label]) => (
                <button
                  key={modeKey}
                  type="button"
                  onClick={() => {
                    const nextMax =
                      modeKey === 'acquire' && config.trackingMaxPoints === 3
                        ? 5
                        : modeKey === 'auto' && config.trackingMaxPoints === 5
                        ? 3
                        : config.trackingMaxPoints;
                    onUpdateConfig({
                      trackingMode: modeKey,
                      trackingMaxPoints: nextMax,
                    });
                  }}
                  className={`h-7 px-2 rounded border text-[11px] font-medium transition-colors ${
                    config.trackingMode === modeKey
                      ? 'theme-accent-soft border-current font-semibold'
                      : 'theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] opacity-70 leading-snug">
              {config.trackingMode === 'auto'
                ? 'Adquiere automáticamente los puntos más cercanos al cursor.'
                : 'Mantén el cursor 0.4 s sobre un punto para marcarlo (+) o liberarlo.'}
            </p>
          </div>

          <label className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
            <span>Mostrar ángulos polares (SP {config.polarAngle}°)</span>
            <input
              type="checkbox"
              checked={Boolean(config.trackingShowPolarAngles)}
              onChange={(e) => onUpdateConfig({ trackingShowPolarAngles: e.target.checked })}
              className="rounded border-slate-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="opacity-75 block">Máx. de puntos</span>
              <select
                value={config.trackingMaxPoints}
                onChange={(e) =>
                  onUpdateConfig({ trackingMaxPoints: Number(e.target.value) })
                }
                className="w-full h-7 px-1.5 rounded border theme-border theme-surface-alt font-mono-tabular"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'punto' : 'puntos'}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="opacity-75 block">Tolerancia ({config.trackingTolerancePx} px)</span>
              <input
                type="range"
                min={4}
                max={20}
                step={1}
                value={config.trackingTolerancePx}
                onChange={(e) =>
                  onUpdateConfig({ trackingTolerancePx: Number(e.target.value) })
                }
                className="w-full h-7 accent-blue-600 cursor-pointer"
              />
            </label>
          </div>

          <label className="flex items-center justify-between gap-2 pt-1 border-t theme-border cursor-pointer">
            <span>Ajustar trazos a mano alzada a las guías</span>
            <input
              type="checkbox"
              checked={Boolean(config.trackingSnapFreehand)}
              onChange={(e) => onUpdateConfig({ trackingSnapFreehand: e.target.checked })}
              className="rounded border-slate-400"
            />
          </label>
        </div>
      )}

      {/* Coordinates & Precision Settings Popover */}
      {openPopover === 'settings' && (
        <div className="absolute right-2 bottom-10 w-72 theme-surface border theme-border rounded-lg shadow-xl p-3 z-50 space-y-2.5 text-[11px]">
          <div className="flex items-center justify-between pb-1 border-b theme-border">
            <span className="font-semibold">Sistema de coordenadas y precisión</span>
            <button
              type="button"
              onClick={() => setOpenPopover(null)}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="opacity-75 block">Unidades</span>
              <select
                value={config.unit}
                onChange={(e) => onUpdateConfig({ unit: e.target.value as CadUnit })}
                className="w-full h-7 px-1.5 rounded border theme-border theme-surface-alt"
              >
                <option value="px">Unidades / px (1:1)</option>
                <option value="mm">Milímetros (mm)</option>
                <option value="cm">Centímetros (cm)</option>
                <option value="m">Metros (m)</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="opacity-75 block">Decimales</span>
              <select
                value={config.decimals}
                onChange={(e) => onUpdateConfig({ decimals: Number(e.target.value) })}
                className="w-full h-7 px-1.5 rounded border theme-border theme-surface-alt font-mono-tabular"
              >
                <option value={0}>0 (Enteros)</option>
                <option value={1}>1 decimal</option>
                <option value={2}>2 decimales</option>
                <option value={3}>3 decimales</option>
                <option value={4}>4 decimales</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="opacity-75 block">Paso SNAP ({getUnitShortLabel(config.unit)})</span>
              <input
                type="number"
                min={0.1}
                step={config.unit === 'm' ? 0.1 : 1}
                value={config.snapStep}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) onUpdateConfig({ snapStep: v });
                }}
                className="w-full h-7 px-1.5 rounded border theme-border theme-surface-alt font-mono-tabular"
              />
            </label>

            <label className="space-y-1">
              <span className="opacity-75 block">Ángulo SP</span>
              <select
                value={config.polarAngle}
                onChange={(e) => onUpdateConfig({ polarAngle: Number(e.target.value) })}
                className="w-full h-7 px-1.5 rounded border theme-border theme-surface-alt font-mono-tabular"
              >
                <option value={15}>15°</option>
                <option value={30}>30°</option>
                <option value={45}>45°</option>
                <option value={90}>90°</option>
              </select>
            </label>
          </div>

          <label className="flex items-center justify-between gap-2 py-0.5 cursor-pointer">
            <span>Eje +Y hacia arriba (Cartesiano)</span>
            <input
              type="checkbox"
              checked={config.yAxisUp}
              onChange={(e) => onUpdateConfig({ yAxisUp: e.target.checked })}
            />
          </label>

          <div className="pt-1.5 border-t theme-border space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="opacity-75">Origen de referencia (px mundo)</span>
              <span className="font-mono-tabular font-medium">
                ({Math.round(config.originX)}, {Math.round(config.originY)})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpenPopover(null);
                  onStartPickOrigin();
                }}
                className="flex-1 h-7 px-2 rounded border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center gap-1 font-medium"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Fijar origen en pizarra
              </button>
              <button
                type="button"
                onClick={() => onUpdateConfig({ originX: 0, originY: 0 })}
                className="h-7 px-2 rounded border theme-border theme-surface-alt hover:bg-black/5 dark:hover:bg-white/10"
              >
                (0,0)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

