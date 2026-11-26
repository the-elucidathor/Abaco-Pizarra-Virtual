import React, { useMemo } from 'react';
import type { GraphObject } from '../../types/whiteboard';
import {
  compileFunctionItem,
  findIntersections,
  sampleFunctionSegments,
  useMathEngineReady,
} from '../../utils/mathEngine';

interface GraphNodeViewProps {
  obj: GraphObject;
}

// OPT: 2.6 — Evita recalcular curvas matemáticas si el grafo no cambió
export const GraphNodeView: React.FC<GraphNodeViewProps> = React.memo(({ obj }) => {
  // OPT: 1.1 — Re-render cuando mathjs termina su carga diferida
  const mathReady = useMathEngineReady();
  const padLeft = 36;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const svgW = Math.max(180, obj.width);
  const svgH = Math.max(140, obj.height);
  const plotW = Math.max(40, svgW - padLeft - padRight);
  const plotH = Math.max(40, svgH - padTop - padBottom);

  const xMin = obj.xMin;
  const xMax = obj.xMax > obj.xMin ? obj.xMax : obj.xMin + 1;
  const yMin = obj.yMin;
  const yMax = obj.yMax > obj.yMin ? obj.yMax : obj.yMin + 1;

  const toPxX = (x: number) => padLeft + ((x - xMin) / (xMax - xMin)) * plotW;
  const toPxY = (y: number) => padTop + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  const xTicks = useMemo(() => {
    const step = obj.xStep > 0 ? obj.xStep : (xMax - xMin) / 6;
    const ticks: number[] = [];
    const start = Math.ceil(xMin / step) * step;
    for (let x = start; x <= xMax + 1e-9 && ticks.length < 40; x += step) {
      ticks.push(Number(x.toFixed(4)));
    }
    return ticks;
  }, [xMin, xMax, obj.xStep]);

  const yTicks = useMemo(() => {
    const step = obj.yStep > 0 ? obj.yStep : (yMax - yMin) / 6;
    const ticks: number[] = [];
    const start = Math.ceil(yMin / step) * step;
    for (let y = start; y <= yMax + 1e-9 && ticks.length < 40; y += step) {
      ticks.push(Number(y.toFixed(4)));
    }
    return ticks;
  }, [yMin, yMax, obj.yStep]);

  const compiled = useMemo(
    () => obj.functions.map((f) => compileFunctionItem(f)),
    [obj.functions, mathReady]
  );

  const curves = useMemo(() => {
    return compiled
      .filter((c) => c.item.visible && c.evalFn)
      .map((c) => {
        const segs = sampleFunctionSegments(c.evalFn, xMin, xMax, yMin, yMax, 320);
        const pathData = segs
          .map((seg) =>
            seg
              .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${toPxX(pt.x).toFixed(2)} ${toPxY(pt.y).toFixed(2)}`)
              .join(' ')
          )
          .join(' ');
        return { item: c.item, pathData };
      });
  }, [compiled, xMin, xMax, yMin, yMax, plotW, plotH]);

  const intersections = useMemo(() => {
    if (!obj.showIntersections) return [];
    return findIntersections(compiled, xMin, xMax, yMin, yMax);
  }, [compiled, obj.showIntersections, xMin, xMax, yMin, yMax]);

  const axisXZeroInView = yMin <= 0 && yMax >= 0;
  const axisYZeroInView = xMin <= 0 && xMax >= 0;
  const zeroPxY = toPxY(0);
  const zeroPxX = toPxX(0);
  const clipId = `graph-clip-${obj.id}`;

  return (
    <div
      className="w-full h-full rounded-md border border-slate-300 dark:border-slate-700 shadow-xs overflow-hidden select-none relative"
      style={{ backgroundColor: obj.backgroundColor || '#ffffff' }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="block"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padLeft} y={padTop} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Plot Area Background */}
        <rect
          x={padLeft}
          y={padTop}
          width={plotW}
          height={plotH}
          fill={obj.backgroundColor === 'transparent' ? 'none' : obj.backgroundColor || '#ffffff'}
          stroke="#cbd5e1"
          strokeWidth={1}
        />

        {/* Grid Lines */}
        {obj.showGrid && (
          <g stroke="#e2e8f0" strokeWidth={1}>
            {xTicks.map((tx) => (
              <line key={`gx-${tx}`} x1={toPxX(tx)} y1={padTop} x2={toPxX(tx)} y2={padTop + plotH} />
            ))}
            {yTicks.map((ty) => (
              <line key={`gy-${ty}`} x1={padLeft} y1={toPxY(ty)} x2={padLeft + plotW} y2={toPxY(ty)} />
            ))}
          </g>
        )}

        {/* Axes */}
        {obj.showAxes && (
          <g stroke="#475569" strokeWidth={1.4}>
            {axisXZeroInView && (
              <line x1={padLeft} y1={zeroPxY} x2={padLeft + plotW} y2={zeroPxY} />
            )}
            {axisYZeroInView && (
              <line x1={zeroPxX} y1={padTop} x2={zeroPxX} y2={padTop + plotH} />
            )}
          </g>
        )}

        {/* Tick Labels */}
        <g fill="#64748b" fontSize={10} fontFamily="var(--font-mono)">
          {xTicks.map((tx) => {
            const px = toPxX(tx);
            return (
              <text key={`tx-${tx}`} x={px} y={padTop + plotH + 14} textAnchor="middle">
                {Number.isInteger(tx) ? tx : tx.toFixed(1)}
              </text>
            );
          })}
          {yTicks.map((ty) => {
            const py = toPxY(ty);
            return (
              <text key={`ty-${ty}`} x={padLeft - 6} y={py + 3} textAnchor="end">
                {Number.isInteger(ty) ? ty : ty.toFixed(1)}
              </text>
            );
          })}
        </g>

        {/* Function Curves */}
        <g clipPath={`url(#${clipId})`}>
          {curves.map(({ item, pathData }) => {
            const dash =
              item.strokeStyle === 'dashed'
                ? '6 4'
                : item.strokeStyle === 'dotted'
                ? '2 4'
                : undefined;
            return (
              <path
                key={item.id}
                d={pathData}
                fill="none"
                stroke={item.color}
                strokeWidth={item.strokeWidth}
                strokeDasharray={dash}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Vectors */}
          {obj.vectors.map((v) => {
            const x1 = toPxX(v.x1);
            const y1 = toPxY(v.y1);
            const x2 = toPxX(v.x2);
            const y2 = toPxY(v.y2);
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = 9;
            const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
            const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
            const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
            const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
            return (
              <g key={v.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={v.color} strokeWidth={2.2} />
                <polygon points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={v.color} />
                {v.label && (
                  <text
                    x={(x1 + x2) / 2 + 6}
                    y={(y1 + y2) / 2 - 6}
                    fill={v.color}
                    fontSize={11}
                    fontWeight={600}
                  >
                    {v.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Custom Points */}
          {obj.points.map((pt) => {
            const px = toPxX(pt.x);
            const py = toPxY(pt.y);
            return (
              <g key={pt.id}>
                <circle cx={px} cy={py} r={4.5} fill={pt.color} stroke="#ffffff" strokeWidth={1.5} />
                <text
                  x={px + 7}
                  y={py - 6}
                  fill="#0f172a"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fontWeight={600}
                >
                  {pt.label ? `${pt.label} (${pt.x}, ${pt.y})` : `(${pt.x}, ${pt.y})`}
                </text>
              </g>
            );
          })}

          {/* Intersections */}
          {intersections.map((inter, idx) => {
            const px = toPxX(inter.x);
            const py = toPxY(inter.y);
            return (
              <g key={`inter-${idx}`}>
                <circle cx={px} cy={py} r={4.5} fill="#f59e0b" stroke="#0f172a" strokeWidth={1.2} />
                <rect
                  x={px + 6}
                  y={py - 16}
                  width={76}
                  height={16}
                  rx={3}
                  fill="rgba(15,23,42,0.86)"
                />
                <text
                  x={px + 10}
                  y={py - 5}
                  fill="#ffffff"
                  fontSize={9.5}
                  fontFamily="var(--font-mono)"
                >
                  ({inter.x.toFixed(2)}, {inter.y.toFixed(2)})
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      {obj.functions.filter((f) => f.visible).length > 0 && (
        <div className="absolute top-2.5 right-3 flex flex-col gap-0.5 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-[10px] font-mono-tabular pointer-events-none">
          {obj.functions
            .filter((f) => f.visible)
            .map((f) => (
              <div key={f.id} className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <span className="inline-block w-3 h-0.5" style={{ backgroundColor: f.color }} />
                <span>y = {f.expression}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
});

