// OPT: 1.1 — Carga diferida de mathjs bajo demanda (evita cargar ~700 KB en el arranque)
import { useEffect, useState } from 'react';
import type { EvalFunction } from 'mathjs';
import type { GraphFunctionItem } from '../types/whiteboard';

type CompileFn = (expr: string) => EvalFunction;

let mathCompileFn: CompileFn | null = null;
let mathLoadPromise: Promise<boolean> | null = null;
const mathReadyListeners = new Set<() => void>();

export function ensureMathLoaded(): Promise<boolean> {
  if (mathCompileFn) return Promise.resolve(true);
  if (mathLoadPromise) return mathLoadPromise;

  mathLoadPromise = (async () => {
    try {
      const mod = await import('mathjs');
      if (typeof mod.compile === 'function') {
        mathCompileFn = mod.compile;
        mathReadyListeners.forEach((fn) => {
          try {
            fn();
          } catch {
            // Ignorar
          }
        });
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[Ábaco][opt] No se pudo cargar mathjs de forma diferida:', err);
      return false;
    } finally {
      mathLoadPromise = null;
    }
  })();

  return mathLoadPromise;
}

export function useMathEngineReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => mathCompileFn !== null);
  useEffect(() => {
    if (mathCompileFn) {
      setReady(true);
      return;
    }
    let active = true;
    const onReady = () => {
      if (active && mathCompileFn) setReady(true);
    };
    mathReadyListeners.add(onReady);
    void ensureMathLoaded();
    return () => {
      active = false;
      mathReadyListeners.delete(onReady);
    };
  }, []);
  return ready;
}

export interface CompiledMathFn {
  item: GraphFunctionItem;
  evalFn: EvalFunction | null;
  error?: string;
}

export interface MathIntersection {
  x: number;
  y: number;
  fnA: string;
  fnB: string;
}

export function normalizeExpression(raw: string): string {
  let expr = raw.trim();
  // Allow "y = ..." or "f(x) = ..." prefixes
  expr = expr.replace(/^(y|f\s*\(\s*x\s*\)|g\s*\(\s*x\s*\)|h\s*\(\s*x\s*\))\s*=\s*/i, '');
  // Common Spanish/math aliases
  expr = expr.replace(/sen\(/gi, 'sin(');
  expr = expr.replace(/ln\(/gi, 'log(');
  expr = expr.replace(/π/g, 'pi');
  return expr;
}

export function compileFunctionItem(item: GraphFunctionItem): CompiledMathFn {
  try {
    const normalized = normalizeExpression(item.expression);
    if (!normalized) {
      return { item, evalFn: null, error: 'Expresión vacía' };
    }
    if (!mathCompileFn) {
      void ensureMathLoaded();
      return { item, evalFn: null };
    }
    const compiled = mathCompileFn(normalized);
    // Quick smoke evaluation
    compiled.evaluate({ x: 0 });
    return { item, evalFn: compiled };
  } catch (err) {
    return {
      item,
      evalFn: null,
      error: err instanceof Error ? err.message : 'Error de sintaxis',
    };
  }
}

export function evaluateAt(compiled: EvalFunction | null, x: number): number | null {
  if (!compiled) return null;
  try {
    const res = compiled.evaluate({ x });
    if (typeof res === 'number' && Number.isFinite(res)) {
      return res;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sample function into segments separated by asymptotes / discontinuities
 */
export function sampleFunctionSegments(
  compiled: EvalFunction | null,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  samples = 360
): { x: number; y: number }[][] {
  if (!compiled || xMax <= xMin) return [];
  const yRange = Math.max(1e-6, yMax - yMin);
  const jumpThreshold = yRange * 2.5;
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];

  for (let i = 0; i <= samples; i++) {
    const x = xMin + ((xMax - xMin) * i) / samples;
    const y = evaluateAt(compiled, x);

    if (y === null || Math.abs(y) > 1e6) {
      if (current.length > 1) segments.push(current);
      current = [];
      continue;
    }

    if (current.length > 0) {
      const prev = current[current.length - 1];
      if (Math.abs(y - prev.y) > jumpThreshold) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
    }

    current.push({ x, y });
  }

  if (current.length > 1) {
    segments.push(current);
  }
  return segments;
}

/**
 * Numerically detect intersections between visible curves within [xMin, xMax] x [yMin, yMax]
 */
export function findIntersections(
  compiledList: CompiledMathFn[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): MathIntersection[] {
  const active = compiledList.filter((c) => c.item.visible && c.evalFn !== null);
  const results: MathIntersection[] = [];
  const steps = 240;

  for (let a = 0; a < active.length; a++) {
    for (let b = a + 1; b < active.length; b++) {
      const fnA = active[a];
      const fnB = active[b];

      let prevX = xMin;
      let prevDiff: number | null = null;

      for (let i = 0; i <= steps; i++) {
        const x = xMin + ((xMax - xMin) * i) / steps;
        const ya = evaluateAt(fnA.evalFn, x);
        const yb = evaluateAt(fnB.evalFn, x);
        if (ya === null || yb === null) {
          prevDiff = null;
          prevX = x;
          continue;
        }
        const diff = ya - yb;
        if (Math.abs(diff) < 1e-6) {
          if (ya >= yMin && ya <= yMax) {
            pushUniqueIntersection(results, {
              x,
              y: ya,
              fnA: fnA.item.expression,
              fnB: fnB.item.expression,
            });
          }
        } else if (prevDiff !== null && prevDiff * diff < 0 && Math.abs(diff - prevDiff) < (yMax - yMin) * 2) {
          // Bisection refinement
          let lo = prevX;
          let hi = x;
          let loDiff = prevDiff;
          for (let iter = 0; iter < 22; iter++) {
            const mid = (lo + hi) * 0.5;
            const yma = evaluateAt(fnA.evalFn, mid);
            const ymb = evaluateAt(fnB.evalFn, mid);
            if (yma === null || ymb === null) break;
            const midDiff = yma - ymb;
            if (loDiff * midDiff <= 0) {
              hi = mid;
            } else {
              lo = mid;
              loDiff = midDiff;
            }
          }
          const rx = (lo + hi) * 0.5;
          const ry = evaluateAt(fnA.evalFn, rx);
          if (ry !== null && ry >= yMin && ry <= yMax) {
            pushUniqueIntersection(results, {
              x: rx,
              y: ry,
              fnA: fnA.item.expression,
              fnB: fnB.item.expression,
            });
          }
        }
        prevDiff = diff;
        prevX = x;
      }
    }
  }

  return results.slice(0, 20);
}

function pushUniqueIntersection(list: MathIntersection[], item: MathIntersection) {
  const dup = list.some(
    (existing) => Math.hypot(existing.x - item.x, existing.y - item.y) < 0.05
  );
  if (!dup) list.push(item);
}
