// OPT: Medidor interno de rendimiento (apagado por defecto; se activa con ?perf=1 o localStorage abaco_perf=1)

export interface PerfActionSample {
  name: string;
  durationMs: number;
  at: number;
}

export interface PerfMetricsSnapshot {
  fps: number;
  frameTimeMs: number;
  renderTimeMs: number;
  objectCount: number;
  renderedObjectCount: number;
  memoryMb: number | null;
  lastActions: PerfActionSample[];
}

const PERF_STORAGE_KEY = 'abaco_perf';

let metricsState: PerfMetricsSnapshot = {
  fps: 0,
  frameTimeMs: 0,
  renderTimeMs: 0,
  objectCount: 0,
  renderedObjectCount: 0,
  memoryMb: null,
  lastActions: [],
};

const actionHistory: PerfActionSample[] = [];
const listeners = new Set<(snap: PerfMetricsSnapshot) => void>();

export function isPerfMonitorEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const win = window as unknown as { __ABACO_PERF__?: boolean };
      if (win.__ABACO_PERF__ === true) return true;
      if (typeof window.location?.search === 'string') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('perf') === '1') return true;
      }
    }
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem(PERF_STORAGE_KEY) === '1') return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function setPerfCounts(objectCount: number, renderedObjectCount: number): void {
  if (!isPerfMonitorEnabled()) return;
  metricsState = {
    ...metricsState,
    objectCount,
    renderedObjectCount,
  };
}

export function recordPerfAction(name: string, durationMs: number): void {
  if (!isPerfMonitorEnabled()) return;
  const sample: PerfActionSample = {
    name,
    durationMs: Math.round(durationMs * 100) / 100,
    at: Date.now(),
  };
  actionHistory.unshift(sample);
  if (actionHistory.length > 8) actionHistory.length = 8;
  metricsState = {
    ...metricsState,
    renderTimeMs: name === 'canvasRender' ? sample.durationMs : metricsState.renderTimeMs,
    lastActions: [...actionHistory],
  };
}

export function measurePerfAction<T>(name: string, fn: () => T): T {
  if (!isPerfMonitorEnabled() || typeof performance === 'undefined') {
    return fn();
  }
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    recordPerfAction(name, performance.now() - t0);
  }
}

export function subscribePerfMetrics(
  listener: (snap: PerfMetricsSnapshot) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPerfSnapshot(): PerfMetricsSnapshot {
  return metricsState;
}

let loopRaf: number | null = null;
let subscriberCount = 0;

export function startPerfSampling(): () => void {
  subscriberCount += 1;
  if (loopRaf === null && typeof requestAnimationFrame === 'function') {
    let frames = 0;
    let lastReport = performance.now();
    let lastFrame = lastReport;
    let avgFrameMs = 0;

    const tick = (now: number) => {
      const dt = now - lastFrame;
      lastFrame = now;
      avgFrameMs = avgFrameMs === 0 ? dt : avgFrameMs * 0.9 + dt * 0.1;
      frames += 1;

      if (now - lastReport >= 500) {
        const elapsedSec = (now - lastReport) / 1000;
        const fps = Math.round(frames / Math.max(0.1, elapsedSec));
        const perfMem = (
          performance as unknown as { memory?: { usedJSHeapSize?: number } }
        ).memory;
        const memoryMb =
          typeof perfMem?.usedJSHeapSize === 'number'
            ? Math.round((perfMem.usedJSHeapSize / (1024 * 1024)) * 10) / 10
            : null;
        metricsState = {
          ...metricsState,
          fps,
          frameTimeMs: Math.round(avgFrameMs * 100) / 100,
          memoryMb,
          lastActions: [...actionHistory],
        };
        listeners.forEach((fn) => fn(metricsState));
        frames = 0;
        lastReport = now;
      }

      if (subscriberCount > 0) {
        loopRaf = requestAnimationFrame(tick);
      } else {
        loopRaf = null;
      }
    };

    loopRaf = requestAnimationFrame(tick);
  }

  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0 && loopRaf !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(loopRaf);
      loopRaf = null;
    }
  };
}
