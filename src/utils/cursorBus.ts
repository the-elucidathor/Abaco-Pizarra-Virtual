// OPT: 2.6 — Canal ligero desacoplado (~30 Hz) para coordenadas del cursor sin re-renderizar App completo
import type { Point2D } from '../types/whiteboard';

let latestCursorWorld: Point2D = { x: 0, y: 0 };
const listeners = new Set<(pt: Point2D) => void>();
let throttleTimer: number | null = null;
let lastEmitMs = 0;

export function getLatestCursorWorld(): Point2D {
  return latestCursorWorld;
}

export function publishCursorWorld(pt: Point2D): void {
  latestCursorWorld = pt;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const elapsed = now - lastEmitMs;
  if (elapsed >= 32) {
    lastEmitMs = now;
    listeners.forEach((fn) => fn(pt));
    return;
  }
  if (throttleTimer === null && typeof window !== 'undefined') {
    throttleTimer = window.setTimeout(() => {
      throttleTimer = null;
      lastEmitMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      listeners.forEach((fn) => fn(latestCursorWorld));
    }, Math.max(4, 33 - elapsed));
  }
}

export function subscribeCursorWorld(listener: (pt: Point2D) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
