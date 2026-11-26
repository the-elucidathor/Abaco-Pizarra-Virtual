// OPT: HUD discreto de métricas en tiempo real (solo se monta con ?perf=1 o localStorage.abaco_perf=1)
import React, { useEffect, useState } from 'react';
import {
  type PerfMetricsSnapshot,
  getPerfSnapshot,
  isPerfMonitorEnabled,
  startPerfSampling,
  subscribePerfMetrics,
} from '../utils/perfMonitor';

export const PerfMonitorHud: React.FC = () => {
  const [enabled, setEnabled] = useState<boolean>(() => isPerfMonitorEnabled());
  const [snap, setSnap] = useState<PerfMetricsSnapshot>(() => getPerfSnapshot());

  useEffect(() => {
    const check = () => setEnabled(isPerfMonitorEnabled());
    check();
    if (!enabled) return;
    const stopSampling = startPerfSampling();
    const unsub = subscribePerfMetrics(setSnap);
    return () => {
      unsub();
      stopSampling();
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <aside
      data-export-ignore="true"
      className="no-print fixed bottom-10 left-16 z-50 pointer-events-none select-none rounded-lg border border-slate-700/80 bg-slate-950/90 text-slate-100 px-3 py-2 text-[10px] font-mono-tabular shadow-xl backdrop-blur-xs min-w-[230px]"
    >
      <div className="font-semibold text-violet-300 mb-1">Ábaco Perf Monitor</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span>FPS:</span>
        <span className="text-right">{snap.fps}</span>
        <span>Frame:</span>
        <span className="text-right">{snap.frameTimeMs.toFixed(2)} ms</span>
        <span>Render:</span>
        <span className="text-right">{snap.renderTimeMs.toFixed(2)} ms</span>
        <span>Objetos:</span>
        <span className="text-right">
          {snap.renderedObjectCount} / {snap.objectCount}
        </span>
        {snap.memoryMb !== null && (
          <>
            <span>Memoria JS:</span>
            <span className="text-right">{snap.memoryMb.toFixed(1)} MB</span>
          </>
        )}
      </div>
      {snap.lastActions.length > 0 && (
        <div className="mt-1.5 pt-1 border-t border-slate-800 space-y-0.5">
          {snap.lastActions.slice(0, 4).map((a, idx) => (
            <div key={`${a.name}-${a.at}-${idx}`} className="flex justify-between gap-2 text-slate-300">
              <span className="truncate">{a.name}</span>
              <span>{a.durationMs.toFixed(2)} ms</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};
