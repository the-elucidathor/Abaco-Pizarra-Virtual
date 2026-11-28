import type { CustomThemeColors, ThemePreset } from '../types/whiteboard';
import { deriveCustomThemeTokens, isDarkThemePreset } from './themePalette';

export type CanvasCursorKind = 'default' | 'crosshair' | 'text' | 'grab' | 'grabbing' | 'eraser';

export interface ThemeCursorPalette {
  fill: string;
  halo: string;
  outer: string;
  accent: string;
}

function getRelativeLuminance(hex: string): number | null {
  const clean = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Resuelve los colores del cursor adaptándose al fondo efectivo del lienzo o al tema activo
export function getThemeCursorPalette(
  theme: ThemePreset,
  customColor?: string,
  boardIsDarkOverride?: boolean,
  customThemeColors?: CustomThemeColors
): ThemeCursorPalette {
  if (customColor && customColor !== 'auto') {
    const lum = getRelativeLuminance(customColor);
    const isLightColor = lum !== null && lum > 0.62;
    return {
      fill: customColor,
      halo: isLightColor ? '#0f172a' : '#ffffff',
      outer: isLightColor ? '#ffffff' : '#0f172a',
      accent: isLightColor ? '#0f172a' : '#ffffff',
    };
  }

  // Si el color del lienzo contradice el modo claro/oscuro del tema, prioriza legibilidad sobre el lienzo
  if (typeof boardIsDarkOverride === 'boolean') {
    const themeIsDark = isDarkThemePreset(theme, customThemeColors);
    if (boardIsDarkOverride !== themeIsDark) {
      return boardIsDarkOverride
        ? {
            fill: '#facc15',
            halo: '#0f172a',
            outer: '#ffffff',
            accent: '#38bdf8',
          }
        : {
            fill: '#1d4ed8',
            halo: '#ffffff',
            outer: '#0f172a',
            accent: '#e11d48',
          };
    }
  }

  switch (theme) {
    case 'dark':
      return {
        fill: '#facc15',
        halo: '#020617',
        outer: '#ffffff',
        accent: '#38bdf8',
      };
    case 'blueprint':
      return {
        fill: '#4fd1e8',
        halo: '#0b2a4a',
        outer: '#ffffff',
        accent: '#facc15',
      };
    case 'sepia':
      return {
        fill: '#c2410c',
        halo: '#f3e7d3',
        outer: '#3b2416',
        accent: '#8b5e3c',
      };
    case 'neon':
      return {
        fill: '#22d3ee',
        halo: '#12001f',
        outer: '#d946ef',
        accent: '#f0abfc',
      };
    case 'custom': {
      // V1.11.8-14: Cursor con contraste derivado del tema Personalizado
      const derived = deriveCustomThemeTokens(customThemeColors);
      return {
        fill: derived.cssVars['--ui-accent'],
        halo: derived.cssVars['--ui-bg'],
        outer: derived.cssVars['--ui-text'],
        accent: derived.cssVars['--ui-accent-text'],
      };
    }
    case 'warm':
      return {
        fill: '#0f766e',
        halo: '#ffffff',
        outer: '#451a03',
        accent: '#06b6d4',
      };
    case 'cool':
      return {
        fill: '#ea580c',
        halo: '#ffffff',
        outer: '#1e1b4b',
        accent: '#f59e0b',
      };
    case 'nature':
      return {
        fill: '#db2777',
        halo: '#ffffff',
        outer: '#052e16',
        accent: '#f43f5e',
      };
    case 'light':
    default:
      return {
        fill: '#1d4ed8',
        halo: '#ffffff',
        outer: '#0f172a',
        accent: '#e11d48',
      };
  }
}

export function buildCursorSvg(
  theme: ThemePreset,
  kind: Exclude<CanvasCursorKind, 'eraser'>,
  size = 28,
  customColor = 'auto',
  boardIsDarkOverride?: boolean,
  customThemeColors?: CustomThemeColors
): { svg: string; hotX: number; hotY: number } {
  const s = Math.max(20, Math.min(48, Math.round(size)));
  const p = getThemeCursorPalette(theme, customColor, boardIsDarkOverride, customThemeColors);
  const scaleCoord = (v: number, base: number) => Math.round((v * s) / base);

  switch (kind) {
    case 'crosshair': {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 28 28">
          <g stroke-linecap="round">
            <line x1="14" y1="2" x2="14" y2="10" stroke="${p.halo}" stroke-width="4.5"/>
            <line x1="14" y1="18" x2="14" y2="26" stroke="${p.halo}" stroke-width="4.5"/>
            <line x1="2" y1="14" x2="10" y2="14" stroke="${p.halo}" stroke-width="4.5"/>
            <line x1="18" y1="14" x2="26" y2="14" stroke="${p.halo}" stroke-width="4.5"/>
            <circle cx="14" cy="14" r="3" fill="${p.halo}"/>
            <line x1="14" y1="2" x2="14" y2="10" stroke="${p.fill}" stroke-width="2.2"/>
            <line x1="14" y1="18" x2="14" y2="26" stroke="${p.fill}" stroke-width="2.2"/>
            <line x1="2" y1="14" x2="10" y2="14" stroke="${p.fill}" stroke-width="2.2"/>
            <line x1="18" y1="14" x2="26" y2="14" stroke="${p.fill}" stroke-width="2.2"/>
            <circle cx="14" cy="14" r="2.1" fill="${p.accent}" stroke="${p.outer}" stroke-width="0.9"/>
          </g>
        </svg>
      `;
      return { svg, hotX: scaleCoord(14, 28), hotY: scaleCoord(14, 28) };
    }

    case 'text': {
      const w = Math.max(18, Math.round((s * 24) / 28));
      const h = Math.max(20, Math.round((s * 26) / 28));
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 26">
          <g stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 4 H16 M12 4 V22 M8 22 H16" fill="none" stroke="${p.halo}" stroke-width="4.5"/>
            <path d="M8 4 H16 M12 4 V22 M8 22 H16" fill="none" stroke="${p.outer}" stroke-width="3"/>
            <path d="M8 4 H16 M12 4 V22 M8 22 H16" fill="none" stroke="${p.fill}" stroke-width="1.8"/>
          </g>
        </svg>
      `;
      return {
        svg,
        hotX: Math.round(w / 2),
        hotY: Math.round(h / 2),
      };
    }

    case 'grab':
    case 'grabbing': {
      const h = s;
      const svg =
        kind === 'grabbing'
          ? `
        <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${h}" viewBox="0 0 26 26">
          <path d="M7 11 C7 9 9 8 10 9 L10 8 C10 6.5 12.5 6.5 13 8 L13 7.5 C13 6 15.5 6 16 7.5 L16 8.5 C16 7.5 18.5 7.5 18.5 9.5 V15 C18.5 18.5 16 21 12.5 21 C9.5 21 7 18.5 7 15 Z"
            fill="${p.fill}" stroke="${p.halo}" stroke-width="3.2" paint-order="stroke"/>
          <path d="M7 11 C7 9 9 8 10 9 L10 8 C10 6.5 12.5 6.5 13 8 L13 7.5 C13 6 15.5 6 16 7.5 L16 8.5 C16 7.5 18.5 7.5 18.5 9.5 V15 C18.5 18.5 16 21 12.5 21 C9.5 21 7 18.5 7 15 Z"
            fill="${p.fill}" stroke="${p.outer}" stroke-width="1.2"/>
        </svg>
      `
          : `
        <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${h}" viewBox="0 0 26 26">
          <path d="M8 12 V6.5 C8 5.4 9.6 5.4 9.6 6.5 V11 H10.6 V4.5 C10.6 3.4 12.2 3.4 12.2 4.5 V11 H13.2 V4 C13.2 2.9 14.8 2.9 14.8 4 V11 H15.8 V5.5 C15.8 4.4 17.4 4.4 17.4 5.5 V15.5 C17.4 19 15 21.5 11.8 21.5 C8.8 21.5 6.5 19 6.5 15.5 V13 C6.5 11.8 8 11.8 8 13 Z"
            fill="${p.fill}" stroke="${p.halo}" stroke-width="3" paint-order="stroke"/>
          <path d="M8 12 V6.5 C8 5.4 9.6 5.4 9.6 6.5 V11 H10.6 V4.5 C10.6 3.4 12.2 3.4 12.2 4.5 V11 H13.2 V4 C13.2 2.9 14.8 2.9 14.8 4 V11 H15.8 V5.5 C15.8 4.4 17.4 4.4 17.4 5.5 V15.5 C17.4 19 15 21.5 11.8 21.5 C8.8 21.5 6.5 19 6.5 15.5 V13 C6.5 11.8 8 11.8 8 13 Z"
            fill="${p.fill}" stroke="${p.outer}" stroke-width="1.1"/>
        </svg>
      `;
      return { svg, hotX: scaleCoord(13, 26), hotY: scaleCoord(13, 26) };
    }

    case 'default':
    default: {
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 28 28">
          <path d="M4 3 L4 22 L9.5 16.8 L13.5 24.5 L16.3 23.1 L12.3 15.4 L19.5 15.4 Z"
            fill="${p.halo}" stroke="${p.halo}" stroke-width="3.2" stroke-linejoin="round"/>
          <path d="M4 3 L4 22 L9.5 16.8 L13.5 24.5 L16.3 23.1 L12.3 15.4 L19.5 15.4 Z"
            fill="${p.fill}" stroke="${p.outer}" stroke-width="1.35" stroke-linejoin="round"/>
          <circle cx="5.4" cy="5.6" r="1.3" fill="${p.accent}"/>
        </svg>
      `;
      return { svg, hotX: scaleCoord(4, 28), hotY: scaleCoord(3, 28) };
    }
  }
}

export function getContrastCanvasCursor(
  theme: ThemePreset,
  kind: CanvasCursorKind,
  size = 28,
  customColor = 'auto',
  boardIsDarkOverride?: boolean,
  customThemeColors?: CustomThemeColors
): string {
  if (kind === 'eraser') {
    return 'none';
  }
  const { svg, hotX, hotY } = buildCursorSvg(
    theme,
    kind,
    size,
    customColor,
    boardIsDarkOverride,
    customThemeColors
  );
  const encoded = encodeURIComponent(svg.trim().replace(/\s+/g, ' '));
  return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}, ${kind}`;
}
