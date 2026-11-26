// OPT: 2.5 — Caché sin pérdida de cadenas SVG de trazos (WeakMap por referencia del arreglo points)
import type { Point2D } from '../types/whiteboard';
import { safeRunOpt } from './optFlags';

const strokeSvgPathCache = new WeakMap<Point2D[], { len: number; d: string }>();

export function buildSmoothSvgPathUncached(points: Point2D[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${(points[0].x + 0.5).toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

export function getStrokeSvgPath(points: Point2D[]): string {
  return safeRunOpt(
    'strokePathCache',
    () => {
      const cached = strokeSvgPathCache.get(points);
      if (cached && cached.len === points.length) {
        return cached.d;
      }
      const d = buildSmoothSvgPathUncached(points);
      strokeSvgPathCache.set(points, { len: points.length, d });
      return d;
    },
    () => buildSmoothSvgPathUncached(points)
  );
}
