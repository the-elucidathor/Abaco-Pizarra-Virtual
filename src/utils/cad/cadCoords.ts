import type { CadDraftingConfig, CadUnit } from '../../types/cad';
import type { Point2D } from '../../types/whiteboard';

export const PX_PER_INCH = 96;
export const MM_PER_INCH = 25.4;

export function getUnitScalePxPerUnit(unit: CadUnit): number {
  switch (unit) {
    case 'mm':
      return PX_PER_INCH / MM_PER_INCH; // ~3.779527559 px/mm
    case 'cm':
      return (PX_PER_INCH * 10) / MM_PER_INCH; // ~37.79527559 px/cm
    case 'm':
      return (PX_PER_INCH * 1000) / MM_PER_INCH; // ~3779.527559 px/m
    case 'px':
    default:
      return 1;
  }
}

export function getUnitShortLabel(unit: CadUnit): string {
  return unit === 'px' ? 'u' : unit;
}

export function worldToCad(world: Point2D, config: CadDraftingConfig): Point2D {
  const scale = getUnitScalePxPerUnit(config.unit);
  const dx = (world.x - config.originX) / scale;
  const dyRaw = (world.y - config.originY) / scale;
  return {
    x: dx,
    y: config.yAxisUp ? -dyRaw : dyRaw,
  };
}

export function cadToWorld(cad: Point2D, config: CadDraftingConfig): Point2D {
  const scale = getUnitScalePxPerUnit(config.unit);
  return {
    x: config.originX + cad.x * scale,
    y: config.originY + (config.yAxisUp ? -cad.y : cad.y) * scale,
  };
}

export function cadDeltaToWorldDelta(
  dxCad: number,
  dyCad: number,
  config: CadDraftingConfig
): Point2D {
  const scale = getUnitScalePxPerUnit(config.unit);
  return {
    x: dxCad * scale,
    y: (config.yAxisUp ? -dyCad : dyCad) * scale,
  };
}

export function cadDistToWorldDist(distCad: number, config: CadDraftingConfig): number {
  return distCad * getUnitScalePxPerUnit(config.unit);
}

export function worldDistToCadDist(distWorld: number, config: CadDraftingConfig): number {
  return distWorld / getUnitScalePxPerUnit(config.unit);
}

/**
 * Converts a CAD polar angle (in degrees, CCW from +X when yAxisUp=true)
 * into a unit direction vector in World space (+X right, +Y down).
 */
export function cadAngleDegToWorldDir(angleDeg: number, config: CadDraftingConfig): Point2D {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.cos(rad),
    y: config.yAxisUp ? -Math.sin(rad) : Math.sin(rad),
  };
}

/**
 * Converts a World displacement vector into a CAD polar angle in [0, 360) degrees.
 */
export function worldDeltaToCadAngleDeg(
  dxWorld: number,
  dyWorld: number,
  config: CadDraftingConfig
): number {
  const dyCad = config.yAxisUp ? -dyWorld : dyWorld;
  let deg = (Math.atan2(dyCad, dxWorld) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  if (Math.abs(deg - 360) < 1e-6 || Math.abs(deg) < 1e-6) return 0;
  return deg;
}

export function formatCadNumber(val: number, decimals: number): string {
  const safe = Math.abs(val) < 1e-9 ? 0 : val;
  const clampedDec = Math.max(0, Math.min(4, Math.round(decimals)));
  return safe.toFixed(clampedDec);
}
