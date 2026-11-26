import type { CanvasBackgroundColorMode, ThemePreset } from '../types/whiteboard';

export interface BoardThemeColors {
  boardBg: string;
  surroundingBg: string;
  gridStroke: string;
  linedStroke: string;
  dotFill: string;
  axisStroke: string;
  axisText: string;
  defaultInk: string;
  isDarkSurface: boolean;
}

// Opciones preestablecidas para el selector "Color del lienzo" (exactamente los 4 colores sugeridos)
export interface CanvasBgPresetOption {
  id: Exclude<CanvasBackgroundColorMode, 'auto' | 'custom'>;
  name: string;
  hex: string;
}

export const CANVAS_BG_SUGGESTED_COLORS: CanvasBgPresetOption[] = [
  { id: 'white', name: 'Blanco', hex: '#FFFFFF' },
  { id: 'graphite', name: 'Grafito', hex: '#1F2937' },
  { id: 'chalkboard', name: 'Verde pizarra', hex: '#1F4D3A' },
  { id: 'cream', name: 'Crema', hex: '#F5EFE0' },
];

// Indica si el tema de interfaz elegido utiliza superficie oscura
export function isDarkThemePreset(theme: ThemePreset): boolean {
  return theme === 'dark' || theme === 'blueprint' || theme === 'neon' || theme === 'aurora';
}

// Paleta visual base del tablero según el tema de interfaz
export function getThemeBoardColors(theme: ThemePreset): BoardThemeColors {
  switch (theme) {
    case 'dark':
      return {
        boardBg: '#0f172a',
        surroundingBg: '#020617',
        gridStroke: '#1e293b',
        linedStroke: '#1e3a5f',
        dotFill: '#334155',
        axisStroke: '#64748b',
        axisText: '#94a3b8',
        defaultInk: '#f8fafc',
        isDarkSurface: true,
      };
    case 'warm':
      return {
        boardBg: '#fffdf8',
        surroundingBg: '#f1e3d3',
        gridStroke: '#f2ded0',
        linedStroke: '#fde2ce',
        dotFill: '#e2c0ab',
        axisStroke: '#b4826b',
        axisText: '#8c563c',
        defaultInk: '#0f172a',
        isDarkSurface: false,
      };
    case 'cool':
      return {
        boardBg: '#f8fbff',
        surroundingBg: '#dce7f5',
        gridStroke: '#e2ecf8',
        linedStroke: '#dbeafe',
        dotFill: '#bfdbfe',
        axisStroke: '#7c93b5',
        axisText: '#4e678c',
        defaultInk: '#0f172a',
        isDarkSurface: false,
      };
    case 'nature':
      return {
        boardBg: '#fbfdf9',
        surroundingBg: '#dde9dc',
        gridStroke: '#dfece0',
        linedStroke: '#dcfce7',
        dotFill: '#bbf7d0',
        axisStroke: '#6b9478',
        axisText: '#3f6a4d',
        defaultInk: '#0f172a',
        isDarkSurface: false,
      };
    case 'blueprint':
      return {
        boardBg: '#0B2A4A',
        surroundingBg: '#071C33',
        gridStroke: 'rgba(79, 209, 232, 0.18)',
        linedStroke: 'rgba(30, 90, 140, 0.58)',
        dotFill: 'rgba(79, 209, 232, 0.36)',
        axisStroke: 'rgba(79, 209, 232, 0.72)',
        axisText: '#8CE7F5',
        defaultInk: '#E6F4FF',
        isDarkSurface: true,
      };
    case 'sepia':
      return {
        boardBg: '#F3E7D3',
        surroundingBg: '#DFCCB0',
        gridStroke: 'rgba(139, 94, 60, 0.22)',
        linedStroke: 'rgba(139, 94, 60, 0.28)',
        dotFill: 'rgba(139, 94, 60, 0.38)',
        axisStroke: 'rgba(139, 94, 60, 0.76)',
        axisText: '#5C3B24',
        defaultInk: '#3B2416',
        isDarkSurface: false,
      };
    case 'neon':
      return {
        boardBg: '#12001F',
        surroundingBg: '#090011',
        gridStroke: 'rgba(217, 70, 239, 0.22)',
        linedStroke: 'rgba(34, 211, 238, 0.22)',
        dotFill: 'rgba(34, 211, 238, 0.44)',
        axisStroke: 'rgba(34, 211, 238, 0.76)',
        axisText: '#67E8F9',
        defaultInk: '#67E8F9',
        isDarkSurface: true,
      };
    case 'aurora':
      return {
        boardBg: '#061613',
        surroundingBg: '#030A08',
        gridStroke: 'rgba(52, 211, 153, 0.17)',
        linedStroke: 'rgba(251, 191, 36, 0.18)',
        dotFill: 'rgba(52, 211, 153, 0.36)',
        axisStroke: 'rgba(251, 191, 36, 0.74)',
        axisText: '#FDE68A',
        defaultInk: '#A7F3D0',
        isDarkSurface: true,
      };
    case 'light':
    default:
      return {
        boardBg: '#ffffff',
        surroundingBg: '#e2e8f0',
        gridStroke: '#e2e8f0',
        linedStroke: '#dbeafe',
        dotFill: '#cbd5e1',
        axisStroke: '#94a3b8',
        axisText: '#64748b',
        defaultInk: '#0f172a',
        isDarkSurface: false,
      };
  }
}

// Normaliza color hexadecimal (#RGB o #RRGGBB) a componentes RGB [0..255]
export function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

// Convierte RGB [0..255] a cadena hexadecimal en minúsculas (#rrggbb)
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Calcula la luminancia relativa WCAG 2.1 exacta (0 = negro, 1 = blanco)
export function getHexRelativeLuminance(hex: string): number | null {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  const toLinear = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

// Calcula la relación de contraste WCAG entre dos colores hexadecimales (1 a 21)
export function getHexContrastRatio(hexA: string, hexB: string): number | null {
  const lumA = getHexRelativeLuminance(hexA);
  const lumB = getHexRelativeLuminance(hexB);
  if (lumA === null || lumB === null) return null;
  const bright = Math.max(lumA, lumB);
  const dark = Math.min(lumA, lumB);
  return (bright + 0.05) / (dark + 0.05);
}

// Resuelve el color hexadecimal del fondo cuando no está en modo automático
export function resolveCanvasBackgroundHex(
  mode: CanvasBackgroundColorMode,
  customColor: string,
  fallbackTheme: ThemePreset
): string {
  switch (mode) {
    case 'white':
      return '#FFFFFF';
    case 'graphite':
      return '#1F2937';
    case 'chalkboard':
      return '#1F4D3A';
    case 'cream':
      return '#F5EFE0';
    case 'custom':
      return parseHexRgb(customColor) ? customColor.trim() : '#FFFFFF';
    case 'auto':
    default:
      return getThemeBoardColors(fallbackTheme).boardBg;
  }
}

// Construye la paleta completa de patrones, ejes, etiquetas y tinta por defecto a partir de un color de lienzo arbitrario
export function buildBoardColorsForCustomHex(
  bgHex: string,
  surroundingBgFallback: string
): BoardThemeColors {
  const safeHex = parseHexRgb(bgHex) ? bgHex.trim() : '#FFFFFF';
  const lum = getHexRelativeLuminance(safeHex);
  // Punto medio WCAG exacto (~0.179): debajo conviene tinta y guías claras; encima, oscuras
  const isDarkSurface = lum !== null ? lum < 0.179 : false;

  if (isDarkSurface) {
    return {
      boardBg: safeHex,
      surroundingBg: surroundingBgFallback,
      gridStroke: 'rgba(248, 250, 252, 0.16)',
      linedStroke: 'rgba(226, 232, 240, 0.22)',
      dotFill: 'rgba(248, 250, 252, 0.34)',
      axisStroke: 'rgba(248, 250, 252, 0.58)',
      axisText: '#E2E8F0',
      defaultInk: '#F8FAFC',
      isDarkSurface: true,
    };
  }

  return {
    boardBg: safeHex,
    surroundingBg: surroundingBgFallback,
    gridStroke: 'rgba(15, 23, 42, 0.14)',
    linedStroke: 'rgba(37, 99, 235, 0.20)',
    dotFill: 'rgba(15, 23, 42, 0.28)',
    axisStroke: 'rgba(15, 23, 42, 0.50)',
    axisText: '#334155',
    defaultInk: '#0F172A',
    isDarkSurface: false,
  };
}

// Obtiene la paleta visual efectiva del lienzo combinando tema de interfaz + color de lienzo independiente
export function getEffectiveBoardColors(
  theme: ThemePreset,
  canvasBgMode: CanvasBackgroundColorMode = 'auto',
  canvasBgCustomColor = '#ffffff'
): BoardThemeColors {
  const themeColors = getThemeBoardColors(theme);
  if (canvasBgMode === 'auto') {
    return themeColors;
  }
  const bgHex = resolveCanvasBackgroundHex(canvasBgMode, canvasBgCustomColor, theme);
  return buildBoardColorsForCustomHex(bgHex, themeColors.surroundingBg);
}

// Calcula un color de borde para el marco de hoja en la misma familia cromática de la cuadrícula pero más marcado y legible
export function getFrameBorderStroke(boardTheme: BoardThemeColors): string {
  const raw = (boardTheme.gridStroke || '').trim();
  const rgbaMatch = raw.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[1]))));
    const g = Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[2]))));
    const b = Math.max(0, Math.min(255, Math.round(Number(rgbaMatch[3]))));
    const a = rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1;
    const boostedAlpha = Math.max(0.32, Math.min(0.68, a * 1.9));
    return `rgba(${r}, ${g}, ${b}, ${Number(boostedAlpha.toFixed(2))})`;
  }

  const fg = parseHexRgb(raw);
  const bgHex = parseHexRgb(boardTheme.boardBg) ? boardTheme.boardBg : '#ffffff';
  if (fg) {
    const contrast = getHexContrastRatio(raw, bgHex);
    if (contrast !== null && contrast >= 1.75) {
      return raw;
    }
    // Refuerza ligeramente el tono de la cuadrícula respecto al fondo para asegurar legibilidad incluso en Blanco liso
    const hsl = rgbToHsl(fg.r, fg.g, fg.b);
    const step = boardTheme.isDarkSurface ? 0.05 : -0.05;
    let lum = hsl.l;
    for (let i = 0; i < 8; i += 1) {
      lum = Math.max(0.08, Math.min(0.92, lum + step));
      const cand = hslToRgb(hsl.h, Math.min(0.85, hsl.s), lum);
      const candHex = rgbToHex(cand.r, cand.g, cand.b);
      const nextRatio = getHexContrastRatio(candHex, bgHex);
      if (nextRatio !== null && nextRatio >= 1.65) {
        return candHex;
      }
    }
  }

  return boardTheme.isDarkSurface
    ? 'rgba(248, 250, 252, 0.34)'
    : 'rgba(15, 23, 42, 0.28)';
}

// Color de trazo predeterminado visible sobre el fondo de cada tema
export function getThemeDefaultDrawColor(theme: ThemePreset): string {
  return getThemeBoardColors(theme).defaultInk;
}

const KNOWN_AUTO_INKS = new Set([
  '#0f172a',
  '#f8fafc',
  '#e6f4ff',
  '#3b2416',
  '#67e8f9',
  '#a7f3d0',
  '#ffffff',
  '#000000',
]);

// Determina si conviene actualizar el color de herramienta al cambiar tema o color de lienzo para asegurar legibilidad
export function resolveAdaptiveDrawColorForBoardBg(
  currentColor: string,
  prevDefaultInk: string,
  nextBoardColors: BoardThemeColors
): string {
  const nextDefault = nextBoardColors.defaultInk;
  const norm = currentColor.trim().toLowerCase();

  if (norm === prevDefaultInk.trim().toLowerCase() || KNOWN_AUTO_INKS.has(norm)) {
    return nextDefault;
  }

  const ratio = getHexContrastRatio(currentColor, nextBoardColors.boardBg);
  if (ratio !== null && ratio < 2.2) {
    return nextDefault;
  }

  return currentColor;
}

// Mantiene compatibilidad con llamadas que reciben solo tema previo y siguiente
export function resolveAdaptiveDrawColor(
  currentColor: string,
  prevTheme: ThemePreset,
  nextTheme: ThemePreset
): string {
  const prevDefault = getThemeDefaultDrawColor(prevTheme);
  const nextBoardColors = getThemeBoardColors(nextTheme);
  return resolveAdaptiveDrawColorForBoardBg(currentColor, prevDefault, nextBoardColors);
}

// Convierte RGB [0..255] a HSL ([0..1], [0..1], [0..1])
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

// Convierte HSL ([0..1]) de vuelta a RGB [0..255]
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

// Adapta dinámicamente un color existente cuando la opción "Adaptar colores de trazos al fondo" está activa
export function adaptStrokeColorForCanvasBg(
  color: string,
  boardBgHex: string,
  minContrastRatio = 3.2
): string {
  if (!color || color === 'transparent' || color === 'none') return color;
  const fgRgb = parseHexRgb(color);
  const bgLum = getHexRelativeLuminance(boardBgHex);
  if (!fgRgb || bgLum === null) return color;

  const currentRatio = getHexContrastRatio(color, boardBgHex);
  if (currentRatio !== null && currentRatio >= minContrastRatio) {
    return color;
  }

  const isDarkBg = bgLum < 0.179;
  const hsl = rgbToHsl(fgRgb.r, fgRgb.g, fgRgb.b);
  const normLower = color.trim().toLowerCase();

  // Si es neutro (negro, blanco, grises o tintas base del sistema), alterna a tinta de máximo contraste
  if (
    hsl.s < 0.12 ||
    KNOWN_AUTO_INKS.has(normLower) ||
    hsl.l <= 0.13 ||
    hsl.l >= 0.92
  ) {
    return isDarkBg ? '#F8FAFC' : '#0F172A';
  }

  // Si es cromático, ajusta la luminosidad preservando el tono hacia claro u oscuro según el fondo
  const step = isDarkBg ? 0.06 : -0.06;
  let candidateL = hsl.l;
  for (let i = 0; i < 16; i += 1) {
    candidateL = Math.max(0.08, Math.min(0.94, candidateL + step));
    const candRgb = hslToRgb(hsl.h, Math.min(0.92, hsl.s), candidateL);
    const candHex = rgbToHex(candRgb.r, candRgb.g, candRgb.b);
    const ratio = getHexContrastRatio(candHex, boardBgHex);
    if (ratio !== null && ratio >= minContrastRatio) {
      return candHex;
    }
  }

  return isDarkBg ? '#F8FAFC' : '#0F172A';
}

export interface TrackingVisualPalette {
  guideStroke: string;
  intersectionStroke: string;
  acquiredPlusStroke: string;
  haloStroke: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
}

// Calcula colores de alto contraste para líneas de rastreo y etiquetas en los 9 temas y 5 colores de lienzo
export function getTrackingVisualPalette(boardTheme: BoardThemeColors): TrackingVisualPalette {
  const bgHex = parseHexRgb(boardTheme.boardBg) ? boardTheme.boardBg : '#ffffff';
  const candidates = boardTheme.isDarkSurface
    ? ['#fbbf24', '#fb923c', '#f472b6', '#4ade80', '#f8fafc']
    : ['#c2410c', '#0f766e', '#be185d', '#b45309', '#0f172a'];

  let guideStroke = candidates[0];
  for (const cand of candidates) {
    const ratio = getHexContrastRatio(cand, bgHex);
    if (ratio !== null && ratio >= 3.8) {
      guideStroke = cand;
      break;
    }
  }

  const intersectionStroke = boardTheme.isDarkSurface ? '#f87171' : '#dc2626';
  const acquiredPlusStroke = guideStroke;
  const haloStroke = boardTheme.isDarkSurface
    ? 'rgba(2, 6, 23, 0.85)'
    : 'rgba(255, 255, 255, 0.9)';

  return {
    guideStroke,
    intersectionStroke,
    acquiredPlusStroke,
    haloStroke,
    badgeBg: boardTheme.isDarkSurface
      ? 'rgba(15, 23, 42, 0.92)'
      : 'rgba(255, 255, 255, 0.94)',
    badgeBorder: guideStroke,
    badgeText: boardTheme.isDarkSurface ? '#fef3c7' : '#1e293b',
  };
}

