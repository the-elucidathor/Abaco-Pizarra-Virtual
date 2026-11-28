import React from 'react';
import type { TextFontFamily } from '../../types/whiteboard';
import { getTextFontCss } from '../textFonts';
import type { DimensionMetrics } from './cadDimensions';

interface DimensionSvgContentProps {
  metrics: DimensionMetrics;
  strokeColor: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: TextFontFamily;
  originX?: number;
  originY?: number;
  strokeWidth?: number;
  hideLabel?: boolean;
  dashedPreview?: boolean;
}

export const DimensionSvgContent: React.FC<DimensionSvgContentProps> = ({
  metrics,
  strokeColor,
  textColor,
  fontSize = 12,
  fontFamily,
  originX = 0,
  originY = 0,
  strokeWidth = 1.4,
  hideLabel = false,
  dashedPreview = false,
}) => {
  const ox = originX;
  const oy = originY;
  const effectiveTextColor = textColor || strokeColor;
  const dashAttr = dashedPreview ? '5 3' : undefined;
  const arrowLen = Math.max(7, fontSize * 0.68);
  const arrowHalfW = arrowLen * 0.34;

  return (
    <g>
      {/* Extension lines */}
      {metrics.extLines.map(([a, b], idx) => (
        <line
          key={`ext-${idx}`}
          x1={a.x - ox}
          y1={a.y - oy}
          x2={b.x - ox}
          y2={b.y - oy}
          stroke={strokeColor}
          strokeWidth={Math.max(0.9, strokeWidth * 0.78)}
          strokeOpacity={0.78}
          strokeDasharray={dashAttr}
          strokeLinecap="round"
        />
      ))}

      {/* Dimension lines */}
      {metrics.dimLines.map(([a, b], idx) => (
        <line
          key={`dim-${idx}`}
          x1={a.x - ox}
          y1={a.y - oy}
          x2={b.x - ox}
          y2={b.y - oy}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={dashAttr}
          strokeLinecap="round"
        />
      ))}

      {/* Angular dimension arc */}
      {metrics.dimArc && (() => {
        const { startPt, endPt, radius, largeArc, sweepFlag } = metrics.dimArc;
        const d = `M ${(startPt.x - ox).toFixed(2)} ${(startPt.y - oy).toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${largeArc ? 1 : 0} ${sweepFlag} ${(endPt.x - ox).toFixed(2)} ${(endPt.y - oy).toFixed(2)}`;
        return (
          <path
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={dashAttr}
            strokeLinecap="round"
          />
        );
      })()}

      {/* Center mark cross for radial/diametral */}
      {metrics.centerCross && (
        <g stroke={strokeColor} strokeWidth={Math.max(1, strokeWidth * 0.8)} strokeOpacity={0.8}>
          <line
            x1={metrics.centerCross.x - ox - 4}
            y1={metrics.centerCross.y - oy}
            x2={metrics.centerCross.x - ox + 4}
            y2={metrics.centerCross.y - oy}
          />
          <line
            x1={metrics.centerCross.x - ox}
            y1={metrics.centerCross.y - oy - 4}
            x2={metrics.centerCross.x - ox}
            y2={metrics.centerCross.y - oy + 4}
          />
        </g>
      )}

      {/* Arrowheads / origin dot */}
      {metrics.arrows.map((ar, idx) => {
        const len = Math.hypot(ar.dirX, ar.dirY);
        if (len < 1e-4) {
          return (
            <circle
              key={`dot-${idx}`}
              cx={ar.tip.x - ox}
              cy={ar.tip.y - oy}
              r={2.5}
              fill={strokeColor}
            />
          );
        }
        const ux = ar.dirX / len;
        const uy = ar.dirY / len;
        const nx = -uy;
        const ny = ux;
        const tx = ar.tip.x - ox;
        const ty = ar.tip.y - oy;
        const bx = tx + ux * arrowLen;
        const by = ty + uy * arrowLen;
        const p1x = bx + nx * arrowHalfW;
        const p1y = by + ny * arrowHalfW;
        const p2x = bx - nx * arrowHalfW;
        const p2y = by - ny * arrowHalfW;
        return (
          <polygon
            key={`arr-${idx}`}
            points={`${tx.toFixed(2)},${ty.toFixed(2)} ${p1x.toFixed(2)},${p1y.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}`}
            fill={strokeColor}
          />
        );
      })}

      {/* Measurement text with crisp contrast halo */}
      {!hideLabel && (
        <text
          x={metrics.textPos.x - ox}
          y={metrics.textPos.y - oy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fontWeight={600}
          // V1.11.8-2: Respeta tipografía opcional sin alterar cotas existentes
          fontFamily={
            fontFamily
              ? getTextFontCss(fontFamily)
              : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          }
          fill={effectiveTextColor}
          stroke="rgba(255,255,255,0.88)"
          strokeWidth={3}
          paintOrder="stroke"
          transform={
            Math.abs(metrics.textAngleDeg) > 0.5
              ? `rotate(${metrics.textAngleDeg.toFixed(2)} ${(metrics.textPos.x - ox).toFixed(2)} ${(metrics.textPos.y - oy).toFixed(2)})`
              : undefined
          }
        >
          {metrics.displayLabel}
        </text>
      )}
    </g>
  );
};
