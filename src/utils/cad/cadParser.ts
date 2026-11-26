import type { CadCommandId, CadDraftingConfig } from '../../types/cad';
import type { Point2D } from '../../types/whiteboard';
import {
  cadAngleDegToWorldDir,
  cadDeltaToWorldDelta,
  cadDistToWorldDist,
  cadToWorld,
} from './cadCoords';

export type CadAidToggleCommand = 'ortho' | 'polar' | 'grid' | 'snap' | 'osnap' | 'dyn' | 'origin';

export type CadOptionKey =
  | 'C'
  | 'D'
  | 'I'
  | 'E'
  | 'U'
  | 'M'
  | 'H'
  | 'V'
  | 'A'
  | 'S'
  | 'N'
  | 'F'
  | 'T'
  | 'X'
  | 'Y'
  | 'P'
  | 'B'
  | 'O';

export type CadParsedToken =
  | { kind: 'empty' }
  | { kind: 'command'; command: CadCommandId }
  | { kind: 'aid'; aid: CadAidToggleCommand; explicit?: boolean }
  | { kind: 'option'; key: CadOptionKey }
  | {
      kind: 'point';
      world: Point2D;
      mode: 'abs' | 'rel' | 'polar-rel' | 'polar-abs';
      cadDisplay: string;
    }
  | { kind: 'dimensions'; widthCad: number; heightCad: number }
  | { kind: 'number'; value: number }
  | { kind: 'invalid'; message: string };

const COMMAND_ALIASES: Record<string, CadCommandId> = {
  // Geometría básica
  LIN: 'line',
  L: 'line',
  LINEA: 'line',
  LINE: 'line',
  PL: 'pline',
  POLILINEA: 'pline',
  REC: 'rectangle',
  RECT: 'rectangle',
  RECTANG: 'rectangle',
  RECTANGULO: 'rectangle',
  CIR: 'circle',
  CIRC: 'circle',
  CIRCULO: 'circle',
  A: 'arc',
  ARC: 'arc',
  ARCO: 'arc',
  POL: 'polygon',
  POLIGONO: 'polygon',
  // Acotación
  ACL: 'dim-linear',
  COTLINEAL: 'dim-linear',
  ACOTACIONLINEAL: 'dim-linear',
  ACA: 'dim-aligned',
  COTALINEADA: 'dim-aligned',
  ACOTACIONALINEADA: 'dim-aligned',
  ANG: 'dim-angular',
  COTANGULAR: 'dim-angular',
  ANGULAR: 'dim-angular',
  RAD: 'dim-radial',
  COTRADIAL: 'dim-radial',
  RADIAL: 'dim-radial',
  DIA: 'dim-diametral',
  COTDIAMETRAL: 'dim-diametral',
  DIAMETRAL: 'dim-diametral',
  COR: 'dim-ordinate',
  COORDENADAS: 'dim-ordinate',
  ACOTACIONCOORD: 'dim-ordinate',
  // Edición geométrica
  SIM: 'mirror',
  SIMETRIA: 'mirror',
  ESPEJO: 'mirror',
  CP: 'match-points',
  COINCIDIR: 'match-points',
  COINCIDENCIA: 'match-points',
  COINCIDIRPUNTOS: 'match-points',
  UNI: 'join',
  UNIR: 'join',
  // Matrices
  MR: 'array-rect',
  MATRIZRECT: 'array-rect',
  MATRIZRECTANGULAR: 'array-rect',
  MP: 'array-polar',
  MATRIZPOLAR: 'array-polar',
  MC: 'array-path',
  MATRIZCAMINO: 'array-path',
  // Grupos
  AGR: 'group',
  AGRUPAR: 'group',
  GRUPO: 'group',
  DES: 'ungroup',
  DESAGRUPAR: 'ungroup',
};

const AID_ALIASES: Record<string, CadAidToggleCommand> = {
  ORT: 'ortho',
  ORTO: 'ortho',
  ORTOGONAL: 'ortho',
  SP: 'polar',
  POLAR: 'polar',
  SEGUIMIENTOPOLAR: 'polar',
  GRID: 'grid',
  REJILLA: 'grid',
  CUADRICULA: 'grid',
  SNAP: 'snap',
  AJUSTE: 'snap',
  RG: 'osnap',
  REFERENCIAS: 'osnap',
  DIN: 'dyn',
  DINAMICO: 'dyn',
  ORIGEN: 'origin',
  ORIGIN: 'origin',
};

function stripAccentsUpper(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function resolveCadPointInput(
  raw: string,
  baseWorld: Point2D | null,
  config: CadDraftingConfig
): { world: Point2D; mode: 'abs' | 'rel' | 'polar-rel' | 'polar-abs'; cadDisplay: string } | null {
  const s = raw.trim();
  if (!s) return null;

  // 1. Polar coordinate: @dist<angle or dist<angle
  const polarMatch = s.match(
    /^(@)?\s*([+-]?\d+(?:\.\d+)?)\s*<\s*([+-]?\d+(?:\.\d+)?)$/
  );
  if (polarMatch) {
    const isRel = Boolean(polarMatch[1]) || Boolean(baseWorld);
    const distCad = Number(polarMatch[2]);
    const angleDeg = Number(polarMatch[3]);
    if (!Number.isFinite(distCad) || !Number.isFinite(angleDeg)) return null;

    const dir = cadAngleDegToWorldDir(angleDeg, config);
    const distWorld = cadDistToWorldDist(distCad, config);
    const anchor = isRel && baseWorld ? baseWorld : { x: config.originX, y: config.originY };
    return {
      world: {
        x: anchor.x + dir.x * distWorld,
        y: anchor.y + dir.y * distWorld,
      },
      mode: isRel && baseWorld ? 'polar-rel' : 'polar-abs',
      cadDisplay: `${polarMatch[1] ? '@' : ''}${distCad}<${angleDeg}°`,
    };
  }

  // 2. Cartesian coordinate: @dx,dy or x,y (also accept semicolon separator x;y)
  const cartMatch = s.match(
    /^(@)?\s*([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)$/
  );
  if (cartMatch) {
    const hasAt = Boolean(cartMatch[1]);
    const xVal = Number(cartMatch[2]);
    const yVal = Number(cartMatch[3]);
    if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) return null;

    if (hasAt) {
      if (!baseWorld) {
        return {
          world: cadToWorld({ x: xVal, y: yVal }, config),
          mode: 'rel',
          cadDisplay: `@${xVal},${yVal}`,
        };
      }
      const delta = cadDeltaToWorldDelta(xVal, yVal, config);
      return {
        world: {
          x: baseWorld.x + delta.x,
          y: baseWorld.y + delta.y,
        },
        mode: 'rel',
        cadDisplay: `@${xVal},${yVal}`,
      };
    }

    return {
      world: cadToWorld({ x: xVal, y: yVal }, config),
      mode: 'abs',
      cadDisplay: `${xVal},${yVal}`,
    };
  }

  return null;
}

export function parseCadInput(
  rawInput: string,
  hasActiveCommand: boolean,
  baseWorld: Point2D | null,
  config: CadDraftingConfig
): CadParsedToken {
  const trimmed = rawInput.trim();
  if (!trimmed) return { kind: 'empty' };

  const upper = stripAccentsUpper(trimmed);

  // Check active-command single-letter or keyword sub-options first
  if (hasActiveCommand) {
    if (upper === 'C' || upper === 'CERRAR' || upper === 'CLOSE' || upper === 'CENTRO') {
      return { kind: 'option', key: 'C' };
    }
    if (upper === 'D' || upper === 'DIAMETRO' || upper === 'DIMENSIONES' || upper === 'DISTANCIA') {
      return { kind: 'option', key: 'D' };
    }
    if (upper === 'I' || upper === 'INSC' || upper === 'INSCRITO' || upper === 'INICIO' || upper === 'ORIGINAL') {
      return { kind: 'option', key: 'I' };
    }
    if (upper === 'E' || upper === 'CIRCUNSCRITO' || upper === 'EXTREMO') {
      return { kind: 'option', key: 'E' };
    }
    if (upper === 'P' || upper === 'PERSONALIZADO' || upper === 'PERS') {
      return { kind: 'option', key: 'P' };
    }
    if (upper === 'B' || upper === 'BASE' || upper === 'PUNTOBASE') {
      return { kind: 'option', key: 'B' };
    }
    if (upper === 'O' || upper === 'OPCIONES' || upper === 'PANEL') {
      return { kind: 'option', key: 'O' };
    }
    if (upper === 'U' || upper === 'DESHACER') {
      return { kind: 'option', key: 'U' };
    }
    if (upper === 'M' || upper === 'METODO') {
      return { kind: 'option', key: 'M' };
    }
    if (upper === 'H' || upper === 'HORIZONTAL') {
      return { kind: 'option', key: 'H' };
    }
    if (upper === 'V' || upper === 'VERTICAL') {
      return { kind: 'option', key: 'V' };
    }
    if (upper === 'A' || upper === 'AUTO' || upper === 'ALINEAR') {
      return { kind: 'option', key: 'A' };
    }
    if (upper === 'S' || upper === 'SI' || upper === 'CONSERVAR') {
      return { kind: 'option', key: 'S' };
    }
    if (upper === 'N' || upper === 'NO' || upper === 'ELIMINAR') {
      return { kind: 'option', key: 'N' };
    }
    if (upper === 'F' || upper === 'FIJO') {
      return { kind: 'option', key: 'F' };
    }
    if (upper === 'T' || upper === 'TOLERANCIA') {
      return { kind: 'option', key: 'T' };
    }
    if (upper === 'X' || upper === 'EJEX') {
      return { kind: 'option', key: 'X' };
    }
    if (upper === 'Y' || upper === 'EJEY') {
      return { kind: 'option', key: 'Y' };
    }
  }

  // Global commands
  if (COMMAND_ALIASES[upper]) {
    return { kind: 'command', command: COMMAND_ALIASES[upper] };
  }
  if (!hasActiveCommand && upper === 'C') {
    return { kind: 'command', command: 'circle' };
  }

  // Aid toggles: e.g. "ORT", "ORT ON", "ORT OFF"
  const aidParts = upper.split(/\s+/);
  if (AID_ALIASES[aidParts[0]]) {
    const aid = AID_ALIASES[aidParts[0]];
    const arg = aidParts[1];
    const explicit =
      arg === 'ON' || arg === '1' || arg === 'SI'
        ? true
        : arg === 'OFF' || arg === '0' || arg === 'NO'
        ? false
        : undefined;
    return { kind: 'aid', aid, explicit };
  }

  // Coordinate pair or polar coordinate
  const pt = resolveCadPointInput(trimmed, baseWorld, config);
  if (pt) {
    return {
      kind: 'point',
      world: pt.world,
      mode: pt.mode,
      cadDisplay: pt.cadDisplay,
    };
  }

  // Dimensions pattern (e.g. 120x80 or 120*80)
  const dimMatch = trimmed.match(
    /^([+-]?\d+(?:\.\d+)?)\s*[xX*]\s*([+-]?\d+(?:\.\d+)?)$/
  );
  if (dimMatch) {
    const widthCad = Number(dimMatch[1]);
    const heightCad = Number(dimMatch[2]);
    if (Number.isFinite(widthCad) && Number.isFinite(heightCad)) {
      return { kind: 'dimensions', widthCad, heightCad };
    }
  }

  // Direct numeric value (radius, diameter, sides, tolerance, distance along cursor)
  const numMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const value = Number(numMatch[1]);
    if (Number.isFinite(value)) {
      return { kind: 'number', value };
    }
  }

  return {
    kind: 'invalid',
    message: `Entrada no reconocida: "${trimmed}". Usa X,Y · @dX,dY · @dist<áng o un comando (LIN, PL, REC, CIR, ARC, POL, ACL, SIM, MR).`,
  };
}
