import type { Board, BoardViewport, LineObject, Point2D, ShapeObject, ToolOptions } from '../types/whiteboard';
import { buildLineObjectFromWorldEndpoints } from './geometryCad';
import { isFixedSizeBoard } from './boardSizes';
import { uid } from './id';

export interface CadPoint {
  x: number;
  y: number;
}

export type CoordinateFormatKind =
  | 'cartesian-abs'
  | 'cartesian-rel'
  | 'polar-abs'
  | 'polar-rel';

export type CoordinateParseResult =
  | {
      ok: true;
      point: CadPoint;
      format: CoordinateFormatKind;
    }
  | {
      ok: false;
      error: string;
    };

export type ScalarOrPointParseResult =
  | {
      ok: true;
      kind: 'scalar';
      value: number;
    }
  | {
      ok: true;
      kind: 'point';
      point: CadPoint;
      format: CoordinateFormatKind;
    }
  | {
      ok: false;
      error: string;
    };

export type CadCommandId = 'LINEA' | 'CIRCULO' | 'RECTANGULO';

export type CadPromptStep =
  | 'idle'
  | 'line-first'
  | 'line-next'
  | 'circle-center'
  | 'circle-radius'
  | 'rect-corner1'
  | 'rect-corner2';

export interface CadSessionState {
  command: CadCommandId | null;
  step: CadPromptStep;
  points: CadPoint[];
  lastPoint: CadPoint | null;
  /** Object IDs added during the active LINEA session (for U / Deshacer) */
  activeSegmentIds: string[];
  /** Previous lastPoint before each segment was pushed so U restores it accurately */
  pointHistoryForUndo: (CadPoint | null)[];
  hasRecordedHistoryForCmd: boolean;
}

export interface CadConsoleEntry {
  id: string;
  kind: 'prompt' | 'input' | 'info' | 'error' | 'success';
  text: string;
}

export const INITIAL_CAD_SESSION: CadSessionState = {
  command: null,
  step: 'idle',
  points: [],
  lastPoint: null,
  activeSegmentIds: [],
  pointHistoryForUndo: [],
  hasRecordedHistoryForCmd: false,
};

// Regex patterns supporting integers, decimals (.5, 5., 5.25), and +/- signs
const NUM_PATTERN = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';
const CARTESIAN_ABS_RE = new RegExp(`^\\s*(${NUM_PATTERN})\\s*,\\s*(${NUM_PATTERN})\\s*$`);
const CARTESIAN_REL_RE = new RegExp(`^\\s*@\\s*(${NUM_PATTERN})\\s*,\\s*(${NUM_PATTERN})\\s*$`);
const POLAR_ABS_RE = new RegExp(`^\\s*(${NUM_PATTERN})\\s*<\\s*(${NUM_PATTERN})\\s*$`);
const POLAR_REL_RE = new RegExp(`^\\s*@\\s*(${NUM_PATTERN})\\s*<\\s*(${NUM_PATTERN})\\s*$`);
const SCALAR_RE = new RegExp(`^\\s*(${NUM_PATTERN})\\s*$`);

function cleanFloat(n: number): number {
  if (Math.abs(n) < 1e-10) return 0;
  return Math.round(n * 1e6) / 1e6;
}

export function polarToCartesianCad(distance: number, angleDeg: number): CadPoint {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cleanFloat(distance * Math.cos(rad)),
    y: cleanFloat(distance * Math.sin(rad)),
  };
}

export function formatCadNumber(n: number, decimals = 2): string {
  const clean = cleanFloat(n);
  if (Number.isInteger(clean)) return String(clean);
  return clean.toFixed(decimals).replace(/\.?0+$/, '');
}

export function getBoardCadOriginWorld(board: Pick<Board, 'sizePreset' | 'pageWidth' | 'pageHeight'>): Point2D {
  if (isFixedSizeBoard(board) && board.pageWidth && board.pageHeight) {
    return { x: board.pageWidth / 2, y: board.pageHeight / 2 };
  }
  return { x: 0, y: 0 };
}

/**
 * Converts 2D Cartesian CAD coordinates (+X right, +Y UP) into Canvas World pixels (+Y down).
 */
export function cadToWorldPx(
  cadPt: CadPoint,
  originWorld: Point2D,
  unitPx: number
): Point2D {
  return {
    x: originWorld.x + cadPt.x * unitPx,
    y: originWorld.y - cadPt.y * unitPx,
  };
}

/**
 * Converts Canvas World pixels (+Y down) into 2D Cartesian CAD coordinates (+X right, +Y UP).
 */
export function worldPxToCad(
  worldPt: Point2D,
  originWorld: Point2D,
  unitPx: number
): CadPoint {
  const safeUnit = Math.max(1e-6, unitPx);
  return {
    x: cleanFloat((worldPt.x - originWorld.x) / safeUnit),
    y: cleanFloat(-(worldPt.y - originWorld.y) / safeUnit),
  };
}

/**
 * Converts 2D Cartesian CAD coordinates directly to viewport Screen pixels (applying pan & zoom).
 */
export function cadToScreenPx(
  cadPt: CadPoint,
  viewport: BoardViewport,
  originWorld: Point2D,
  unitPx: number
): Point2D {
  const world = cadToWorldPx(cadPt, originWorld, unitPx);
  return {
    x: world.x * viewport.zoom + viewport.panX,
    y: world.y * viewport.zoom + viewport.panY,
  };
}

/**
 * Converts viewport Screen pixels directly into 2D Cartesian CAD coordinates (inverting pan, zoom & Y axis).
 */
export function screenPxToCad(
  screenPt: Point2D,
  viewport: BoardViewport,
  originWorld: Point2D,
  unitPx: number
): CadPoint {
  const world = {
    x: (screenPt.x - viewport.panX) / viewport.zoom,
    y: (screenPt.y - viewport.panY) / viewport.zoom,
  };
  return worldPxToCad(world, originWorld, unitPx);
}

export function parseCoordinateInput(
  raw: string,
  lastPoint: CadPoint | null
): CoordinateParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Entrada vacía. Ingresa una coordenada (ej. 5,3 · @4,2 · 10<45 · @10<90).',
    };
  }

  let m = trimmed.match(CARTESIAN_REL_RE);
  if (m) {
    const dx = Number(m[1]);
    const dy = Number(m[2]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      return { ok: false, error: 'Valores numéricos inválidos en coordenada relativa.' };
    }
    if (!lastPoint) {
      return {
        ok: false,
        error:
          'No hay un punto previo para coordenada relativa (@X,Y). Ingresa primero un punto absoluto o haz clic en la pizarra.',
      };
    }
    return {
      ok: true,
      format: 'cartesian-rel',
      point: { x: cleanFloat(lastPoint.x + dx), y: cleanFloat(lastPoint.y + dy) },
    };
  }

  m = trimmed.match(POLAR_REL_RE);
  if (m) {
    const dist = Number(m[1]);
    const angle = Number(m[2]);
    if (!Number.isFinite(dist) || !Number.isFinite(angle)) {
      return { ok: false, error: 'Valores numéricos inválidos en coordenada polar relativa.' };
    }
    if (!lastPoint) {
      return {
        ok: false,
        error:
          'No hay un punto previo para coordenada polar relativa (@dist<áng). Ingresa primero un punto base.',
      };
    }
    const delta = polarToCartesianCad(dist, angle);
    return {
      ok: true,
      format: 'polar-rel',
      point: { x: cleanFloat(lastPoint.x + delta.x), y: cleanFloat(lastPoint.y + delta.y) },
    };
  }

  m = trimmed.match(CARTESIAN_ABS_RE);
  if (m) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'Valores numéricos inválidos en coordenada cartesiana.' };
    }
    return {
      ok: true,
      format: 'cartesian-abs',
      point: { x: cleanFloat(x), y: cleanFloat(y) },
    };
  }

  m = trimmed.match(POLAR_ABS_RE);
  if (m) {
    const dist = Number(m[1]);
    const angle = Number(m[2]);
    if (!Number.isFinite(dist) || !Number.isFinite(angle)) {
      return { ok: false, error: 'Valores numéricos inválidos en coordenada polar.' };
    }
    return {
      ok: true,
      format: 'polar-abs',
      point: polarToCartesianCad(dist, angle),
    };
  }

  return {
    ok: false,
    error: `Formato no válido: "${trimmed}". Usa X,Y · @X,Y · distancia<ángulo · @distancia<ángulo`,
  };
}

export function parseScalarOrPointInput(
  raw: string,
  lastPoint: CadPoint | null
): ScalarOrPointParseResult {
  const trimmed = raw.trim();
  const scalarMatch = trimmed.match(SCALAR_RE);
  if (scalarMatch) {
    const val = Number(scalarMatch[1]);
    if (!Number.isFinite(val) || val <= 0) {
      return { ok: false, error: 'El radio debe ser un número positivo mayor que 0.' };
    }
    return { ok: true, kind: 'scalar', value: cleanFloat(val) };
  }

  const coord = parseCoordinateInput(trimmed, lastPoint);
  if (!coord.ok) {
    return {
      ok: false,
      error: `Entrada inválida: "${trimmed}". Ingresa un radio numérico (ej. 5) o un punto (ej. @5<0).`,
    };
  }
  return { ok: true, kind: 'point', point: coord.point, format: coord.format };
}

export function normalizeCommandToken(raw: string):
  | { type: 'command'; command: CadCommandId }
  | { type: 'subcommand'; action: 'close' | 'undo' | 'help' }
  | null {
  const upper = raw
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (upper === 'LINEA' || upper === 'L' || upper === 'LINE') {
    return { type: 'command', command: 'LINEA' };
  }
  if (upper === 'CIRCULO' || upper === 'CIRCLE' || upper === 'CI') {
    return { type: 'command', command: 'CIRCULO' };
  }
  if (upper === 'RECTANGULO' || upper === 'RECT' || upper === 'REC' || upper === 'RECTANGLE') {
    return { type: 'command', command: 'RECTANGULO' };
  }
  if (upper === 'C' || upper === 'CERRAR' || upper === 'CLOSE') {
    return { type: 'subcommand', action: 'close' };
  }
  if (upper === 'U' || upper === 'DESHACER' || upper === 'UNDO') {
    return { type: 'subcommand', action: 'undo' };
  }
  if (upper === 'AYUDA' || upper === 'HELP' || upper === '?') {
    return { type: 'subcommand', action: 'help' };
  }
  return null;
}

export function getCadPromptText(session: CadSessionState): string {
  switch (session.step) {
    case 'line-first':
      return 'LINEA — Especifique primer punto:';
    case 'line-next':
      return 'LINEA — Especifique siguiente punto o [Cerrar/Deshacer]:';
    case 'circle-center':
      return 'CIRCULO — Especifique centro del círculo:';
    case 'circle-radius':
      return 'CIRCULO — Especifique radio del círculo (o punto del perímetro):';
    case 'rect-corner1':
      return 'RECTANGULO — Especifique primera esquina:';
    case 'rect-corner2':
      return 'RECTANGULO — Especifique esquina opuesta (ej. @8,5):';
    default:
      return 'Comando (LINEA, CIRCULO, RECTANGULO) o coordenada:';
  }
}

export function buildCadLineSegmentObject(
  cadStart: CadPoint,
  cadEnd: CadPoint,
  originWorld: Point2D,
  unitPx: number,
  layerId: string,
  zIndex: number,
  toolOptions: ToolOptions
): LineObject {
  const worldStart = cadToWorldPx(cadStart, originWorld, unitPx);
  const worldEnd = cadToWorldPx(cadEnd, originWorld, unitPx);
  const template: LineObject = {
    id: '',
    type: 'line',
    lineKind: 'line',
    layerId,
    x: 0,
    y: 0,
    width: 16,
    height: 16,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex,
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 16, y: 0 },
    strokeColor: toolOptions.shapeStrokeColor || '#1e293b',
    strokeWidth: toolOptions.shapeStrokeWidth || 2,
    strokeStyle: toolOptions.shapeStrokeStyle || 'solid',
  };
  return buildLineObjectFromWorldEndpoints(template, worldStart, worldEnd, uid('line'), zIndex);
}

export function buildCadCircleObject(
  cadCenter: CadPoint,
  radiusUnits: number,
  originWorld: Point2D,
  unitPx: number,
  layerId: string,
  zIndex: number,
  toolOptions: ToolOptions
): ShapeObject {
  const sw = toolOptions.shapeStrokeWidth || 2;
  const pad = sw / 2 + 2;
  const centerWorld = cadToWorldPx(cadCenter, originWorld, unitPx);
  const radiusPx = Math.max(2, radiusUnits * unitPx);
  const diameterPx = radiusPx * 2;
  const width = diameterPx + pad * 2;
  const height = diameterPx + pad * 2;

  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'circle',
    layerId,
    x: centerWorld.x - width / 2,
    y: centerWorld.y - height / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex,
    strokeColor: toolOptions.shapeStrokeColor || '#1e293b',
    fillColor: toolOptions.shapeFillColor || 'transparent',
    strokeWidth: sw,
    strokeStyle: toolOptions.shapeStrokeStyle || 'solid',
  };
}

export function buildCadRectangleObject(
  cadCorner1: CadPoint,
  cadCorner2: CadPoint,
  originWorld: Point2D,
  unitPx: number,
  layerId: string,
  zIndex: number,
  toolOptions: ToolOptions
): ShapeObject {
  const sw = toolOptions.shapeStrokeWidth || 2;
  const pad = sw / 2 + 2;
  const w1 = cadToWorldPx(cadCorner1, originWorld, unitPx);
  const w2 = cadToWorldPx(cadCorner2, originWorld, unitPx);
  const minX = Math.min(w1.x, w2.x);
  const maxX = Math.max(w1.x, w2.x);
  const minY = Math.min(w1.y, w2.y);
  const maxY = Math.max(w1.y, w2.y);

  return {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'rectangle',
    layerId,
    x: minX - pad,
    y: minY - pad,
    width: Math.max(8, maxX - minX) + pad * 2,
    height: Math.max(8, maxY - minY) + pad * 2,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex,
    strokeColor: toolOptions.shapeStrokeColor || '#1e293b',
    fillColor: toolOptions.shapeFillColor || 'transparent',
    strokeWidth: sw,
    strokeStyle: toolOptions.shapeStrokeStyle || 'solid',
    cornerRadius: 0,
  };
}
