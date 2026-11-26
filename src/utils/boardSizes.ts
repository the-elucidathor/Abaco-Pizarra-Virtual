import type {
  BackgroundPattern,
  Board,
  BoardSheet,
  BoardSizePreset,
  BoardViewport,
  CanvasObject,
  PageOrientation,
  Point2D,
} from '../types/whiteboard';
import { clamp, uid } from './id';

export const PX_PER_INCH = 96;
export const CM_PER_INCH = 2.54;
export const MM_PER_INCH = 25.4;
export const PX_PER_CM = PX_PER_INCH / CM_PER_INCH;
export const PX_PER_MM = PX_PER_INCH / MM_PER_INCH;

export const DEFAULT_FRAME_MARGIN_MM = 10;
export const MIN_FRAME_MARGIN_MM = 0;
export const MAX_FRAME_MARGIN_MM = 25;

export const MAX_SHEETS_PER_BOARD = 30;
export const SHEET_GAP_MM = 20;
export const SHEET_GAP_PX = Math.round(SHEET_GAP_MM * PX_PER_MM);

export interface SheetFrameSettings {
  showFrame: boolean;
  frameMarginMm: number;
  clipToFrame: boolean;
}

export interface PageFrameGeometry {
  /** Posición X de la esquina superior izquierda del marco en px del mundo */
  x: number;
  /** Posición Y de la esquina superior izquierda del marco en px del mundo */
  y: number;
  /** Ancho útil exacto (múltiplo entero de stepX) */
  width: number;
  /** Alto útil exacto (múltiplo entero de stepY) */
  height: number;
  /** Margen real aplicado a ambos lados horizontales en px */
  marginX: number;
  /** Margen real aplicado arriba y abajo en px */
  marginY: number;
  /** Columnas completas que caben en el área útil */
  cols: number;
  /** Filas completas que caben en el área útil */
  rows: number;
  /** Paso horizontal de la celda del patrón en px */
  stepX: number;
  /** Paso vertical de la celda del patrón en px */
  stepY: number;
}

// Completa y valida con valores seguros los ajustes nuevos de hoja para proyectos antiguos o dañados sin lanzar excepciones
export function normalizarAjustesHoja(
  rawBoard?: Partial<Board> | null
): SheetFrameSettings {
  try {
    if (!rawBoard || typeof rawBoard !== 'object') {
      return {
        showFrame: true,
        frameMarginMm: DEFAULT_FRAME_MARGIN_MM,
        clipToFrame: true,
      };
    }

    const showFrame =
      typeof rawBoard.showFrame === 'boolean' ? rawBoard.showFrame : true;
    const clipToFrame =
      typeof rawBoard.clipToFrame === 'boolean' ? rawBoard.clipToFrame : true;

    const rawMargin = rawBoard.frameMarginMm;
    const frameMarginMm =
      typeof rawMargin === 'number' && Number.isFinite(rawMargin)
        ? Math.round(clamp(rawMargin, MIN_FRAME_MARGIN_MM, MAX_FRAME_MARGIN_MM) * 10) / 10
        : DEFAULT_FRAME_MARGIN_MM;

    return {
      showFrame,
      frameMarginMm,
      clipToFrame,
    };
  } catch {
    return {
      showFrame: true,
      frameMarginMm: DEFAULT_FRAME_MARGIN_MM,
      clipToFrame: true,
    };
  }
}

export function pxToMm(px: number): number {
  if (!Number.isFinite(px)) return 0;
  return px / PX_PER_MM;
}

// Calcula el rectángulo del área útil ajustado exactamente a múltiplos completos del paso de cuadrícula
export function computePageFrameGeometry(
  pageWidth: number,
  pageHeight: number,
  gridSize: number,
  marginMm = DEFAULT_FRAME_MARGIN_MM,
  backgroundPattern: BackgroundPattern = 'grid'
): PageFrameGeometry {
  const safeW =
    typeof pageWidth === 'number' && Number.isFinite(pageWidth) && pageWidth > 0
      ? pageWidth
      : 816;
  const safeH =
    typeof pageHeight === 'number' && Number.isFinite(pageHeight) && pageHeight > 0
      ? pageHeight
      : 1056;
  const safeGrid =
    typeof gridSize === 'number' && Number.isFinite(gridSize)
      ? Math.max(12, gridSize)
      : 28;
  const safeMarginMm = clamp(
    typeof marginMm === 'number' && Number.isFinite(marginMm)
      ? marginMm
      : DEFAULT_FRAME_MARGIN_MM,
    MIN_FRAME_MARGIN_MM,
    MAX_FRAME_MARGIN_MM
  );

  const targetMarginPx = safeMarginMm * PX_PER_MM;
  const stepY = safeGrid;
  const stepX =
    backgroundPattern === 'isometric' ? safeGrid * 1.732 : safeGrid;

  // Selecciona el entero de celdas más cercano al margen configurado sin desbordar la hoja ni cortar cuadros
  const maxCols = Math.max(1, Math.floor(safeW / stepX));
  const idealWidth = safeW - 2 * targetMarginPx;
  const cols = clamp(Math.round(idealWidth / stepX), 1, maxCols);
  const width = Math.min(safeW, cols * stepX);
  const marginX = Math.max(0, (safeW - width) / 2);

  const maxRows = Math.max(1, Math.floor(safeH / stepY));
  const idealHeight = safeH - 2 * targetMarginPx;
  const rows = clamp(Math.round(idealHeight / stepY), 1, maxRows);
  const height = Math.min(safeH, rows * stepY);
  const marginY = Math.max(0, (safeH - height) / 2);

  return {
    x: marginX,
    y: marginY,
    width,
    height,
    marginX,
    marginY,
    cols,
    rows,
    stepX,
    stepY,
  };
}

export interface BoardSizePresetInfo {
  id: BoardSizePreset;
  name: string;
  shortLabel: string;
  /** Portrait width in CSS px (96 DPI) */
  widthPx: number;
  /** Portrait height in CSS px (96 DPI) */
  heightPx: number;
  /** Portrait width in cm */
  widthCm: number;
  /** Portrait height in cm */
  heightCm: number;
  inchLabel: string;
  description: string;
}

export const BOARD_SIZE_PRESETS: BoardSizePresetInfo[] = [
  {
    id: 'infinite',
    name: 'Espacio Infinito',
    shortLabel: 'Infinito',
    widthPx: 0,
    heightPx: 0,
    widthCm: 0,
    heightCm: 0,
    inchLabel: 'Sin límites',
    description: 'Lienzo abierto e ilimitado en todas direcciones',
  },
  {
    id: 'letter',
    name: 'Carta',
    shortLabel: 'Carta',
    widthPx: 816,
    heightPx: 1056,
    widthCm: 21.6,
    heightCm: 27.9,
    inchLabel: '8.5 × 11 in',
    description: 'Hoja estándar tamaño Carta',
  },
  {
    id: 'legal',
    name: 'Oficio',
    shortLabel: 'Oficio',
    widthPx: 816,
    heightPx: 1344,
    widthCm: 21.6,
    heightCm: 35.6,
    inchLabel: '8.5 × 14 in',
    description: 'Hoja alargada tamaño Oficio / Legal',
  },
  {
    id: 'tabloid',
    name: 'Doble Carta',
    shortLabel: 'Doble Carta',
    widthPx: 1056,
    heightPx: 1632,
    widthCm: 27.9,
    heightCm: 43.2,
    inchLabel: '11 × 17 in',
    description: 'Formato amplio Doble Carta / Tabloide',
  },
  {
    id: 'half-letter',
    name: 'Media Carta',
    shortLabel: 'Media Carta',
    widthPx: 528,
    heightPx: 816,
    widthCm: 14.0,
    heightCm: 21.6,
    inchLabel: '5.5 × 8.5 in',
    description: 'Hoja compacta Media Carta',
  },
  {
    id: 'custom',
    name: 'Personalizado',
    shortLabel: 'Personalizado',
    widthPx: 1000,
    heightPx: 750,
    widthCm: 26.5,
    heightCm: 19.8,
    inchLabel: 'Medida manual',
    description: 'Define el ancho y alto exacto en px o cm',
  },
];

export function getPresetInfo(preset?: BoardSizePreset): BoardSizePresetInfo {
  return (
    BOARD_SIZE_PRESETS.find((p) => p.id === preset) || BOARD_SIZE_PRESETS[0]
  );
}

export function pxToCm(px: number): number {
  return Math.round((px / PX_PER_CM) * 10) / 10;
}

export function cmToPx(cm: number): number {
  return Math.round(cm * PX_PER_CM);
}

export function clampCustomDimensionPx(px: number): number {
  if (!Number.isFinite(px)) return 800;
  return Math.round(clamp(px, 200, 6000));
}

export interface ResolvedBoardSize {
  sizePreset: BoardSizePreset;
  pageWidth?: number;
  pageHeight?: number;
  pageOrientation?: PageOrientation;
}

export function resolveBoardDimensions(
  preset: BoardSizePreset,
  orientation: PageOrientation = 'portrait',
  customWidthPx = 1000,
  customHeightPx = 750
): ResolvedBoardSize {
  if (preset === 'infinite') {
    return {
      sizePreset: 'infinite',
      pageWidth: undefined,
      pageHeight: undefined,
      pageOrientation: undefined,
    };
  }

  if (preset === 'custom') {
    const w = clampCustomDimensionPx(customWidthPx);
    const h = clampCustomDimensionPx(customHeightPx);
    return {
      sizePreset: 'custom',
      pageWidth: w,
      pageHeight: h,
      pageOrientation: w > h ? 'landscape' : 'portrait',
    };
  }

  const info = getPresetInfo(preset);
  const w = orientation === 'landscape' ? info.heightPx : info.widthPx;
  const h = orientation === 'landscape' ? info.widthPx : info.heightPx;
  return {
    sizePreset: preset,
    pageWidth: w,
    pageHeight: h,
    pageOrientation: orientation,
  };
}

export function isFixedSizeBoard(
  board: Pick<Board, 'sizePreset' | 'pageWidth' | 'pageHeight'>
): boolean {
  return (
    Boolean(board.sizePreset) &&
    board.sizePreset !== 'infinite' &&
    typeof board.pageWidth === 'number' &&
    board.pageWidth > 0 &&
    typeof board.pageHeight === 'number' &&
    board.pageHeight > 0
  );
}

export function getBoardSizeSummary(
  board: Pick<Board, 'sizePreset' | 'pageWidth' | 'pageHeight' | 'pageOrientation'>
): string {
  if (!isFixedSizeBoard(board)) {
    return 'Espacio Infinito';
  }
  const info = getPresetInfo(board.sizePreset);
  const w = board.pageWidth!;
  const h = board.pageHeight!;
  const orientLabel = w > h ? 'Horizontal' : 'Vertical';
  return `${info.name} ${orientLabel} · ${pxToCm(w)} × ${pxToCm(h)} cm (${w} × ${h} px)`;
}

export function getPresetDimensionLabel(
  preset: BoardSizePreset,
  orientation: PageOrientation = 'portrait',
  customWidthPx = 1000,
  customHeightPx = 750
): string {
  if (preset === 'infinite') return 'Lienzo ilimitado';
  const resolved = resolveBoardDimensions(preset, orientation, customWidthPx, customHeightPx);
  const w = resolved.pageWidth!;
  const h = resolved.pageHeight!;
  return `${pxToCm(w)} × ${pxToCm(h)} cm · ${w} × ${h} px`;
}

export function computeCenteredViewportForPage(
  pageWidth: number,
  pageHeight: number,
  viewportWidth = 1000,
  viewportHeight = 700,
  targetY = 0
): BoardViewport {
  const pad = 48;
  const availW = Math.max(200, viewportWidth - pad * 2);
  const availH = Math.max(200, viewportHeight - pad * 2);
  const zoom = clamp(Math.min(availW / pageWidth, availH / pageHeight, 1), 0.2, 1.5);
  const panX = Math.round((viewportWidth - pageWidth * zoom) / 2);
  const panY = Math.round((viewportHeight - pageHeight * zoom) / 2 - targetY * zoom);
  return { panX, panY, zoom };
}

export function getSheetStridePx(pageHeight: number): number {
  const safeH =
    typeof pageHeight === 'number' && Number.isFinite(pageHeight) && pageHeight > 0
      ? pageHeight
      : 1056;
  return safeH + SHEET_GAP_PX;
}

export function getSheetY(sheetIndex: number, pageHeight: number): number {
  if (!Number.isFinite(sheetIndex) || sheetIndex <= 0) return 0;
  return Math.round(sheetIndex * getSheetStridePx(pageHeight));
}

export function getTotalSheetsHeight(sheetCount: number, pageHeight: number): number {
  const count = Math.max(1, Math.min(MAX_SHEETS_PER_BOARD, Math.round(sheetCount || 1)));
  const safeH =
    typeof pageHeight === 'number' && Number.isFinite(pageHeight) && pageHeight > 0
      ? pageHeight
      : 1056;
  return count * safeH + (count - 1) * SHEET_GAP_PX;
}

// Completa y valida la lista de hojas de un pizarrón fijo sin lanzar errores (proyectos antiguos = 1 hoja)
export function normalizarHojas(rawBoard?: Partial<Board> | null): BoardSheet[] {
  try {
    if (!rawBoard || typeof rawBoard !== 'object') {
      return [{ id: 'sheet_1', yOffset: 0 }];
    }
    if (!isFixedSizeBoard(rawBoard as Board)) {
      return [];
    }
    const pageH =
      typeof rawBoard.pageHeight === 'number' &&
      Number.isFinite(rawBoard.pageHeight) &&
      rawBoard.pageHeight > 0
        ? rawBoard.pageHeight
        : 1056;
    const rawList = Array.isArray(rawBoard.sheets) ? rawBoard.sheets : [];
    if (rawList.length === 0) {
      return [{ id: 'sheet_1', yOffset: 0 }];
    }
    const capped = rawList.slice(0, MAX_SHEETS_PER_BOARD);
    const seenIds = new Set<string>();
    return capped.map((item, idx) => {
      let safeId =
        item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : idx === 0
          ? 'sheet_1'
          : uid('sheet');
      if (seenIds.has(safeId)) {
        safeId = `${safeId}_${idx + 1}`;
      }
      seenIds.add(safeId);
      return {
        id: safeId,
        yOffset: getSheetY(idx, pageH),
      };
    });
  } catch (err) {
    console.error('[Ábaco] Error al normalizar hojas del pizarrón:', err);
    return [{ id: 'sheet_1', yOffset: 0 }];
  }
}

export interface SheetRect {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getSheetRect(
  sheetIndex: number,
  pageWidth: number,
  pageHeight: number
): SheetRect {
  return {
    index: sheetIndex,
    x: 0,
    y: getSheetY(sheetIndex, pageHeight),
    width: pageWidth,
    height: pageHeight,
  };
}

export function getObjectBoundingCenter(obj: CanvasObject): Point2D {
  const x = typeof obj.x === 'number' && Number.isFinite(obj.x) ? obj.x : 0;
  const y = typeof obj.y === 'number' && Number.isFinite(obj.y) ? obj.y : 0;
  const w = typeof obj.width === 'number' && Number.isFinite(obj.width) ? obj.width : 0;
  const h = typeof obj.height === 'number' && Number.isFinite(obj.height) ? obj.height : 0;
  return { x: x + w * 0.5, y: y + h * 0.5 };
}

// Determina a qué hoja pertenece un objeto según el centro de su caja delimitadora (-1 si queda fuera de todas)
export function findSheetIndexForObject(
  obj: CanvasObject,
  sheetCount: number,
  pageWidth: number,
  pageHeight: number
): number {
  try {
    if (sheetCount <= 0 || pageWidth <= 0 || pageHeight <= 0) return -1;
    const center = getObjectBoundingCenter(obj);
    if (center.x < 0 || center.x > pageWidth) return -1;
    for (let i = 0; i < sheetCount; i++) {
      const top = getSheetY(i, pageHeight);
      if (center.y >= top && center.y <= top + pageHeight) {
        return i;
      }
    }
    return -1;
  } catch (err) {
    console.error('[Ábaco] Error al determinar hoja del elemento:', err);
    return -1;
  }
}

// Encuentra la hoja visible/activa más cercana al centro vertical del viewport en coordenadas del mundo
export function findClosestSheetIndexForWorldY(
  worldY: number,
  sheetCount: number,
  pageHeight: number
): number {
  if (sheetCount <= 1 || pageHeight <= 0 || !Number.isFinite(worldY)) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < sheetCount; i++) {
    const top = getSheetY(i, pageHeight);
    const bottom = top + pageHeight;
    const dist = worldY < top ? top - worldY : worldY > bottom ? worldY - bottom : 0;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      if (dist === 0) break;
    }
  }
  return bestIdx;
}

export const FIXED_SHEET_VERTICAL_MARGIN_MM = 40;
export const FIXED_SHEET_HORIZONTAL_MARGIN_MM = 20;

// Normaliza deltaX/deltaY según event.deltaMode (píxeles, líneas o páginas) para ratón y touchpad
export function normalizeWheelDelta(
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  stageHeight = 700
): { dx: number; dy: number } {
  try {
    const mode = e.deltaMode;
    const scale =
      mode === 1
        ? 20
        : mode === 2
        ? Math.max(300, (Number.isFinite(stageHeight) && stageHeight > 0 ? stageHeight : 700) * 0.85)
        : 1;
    let dx = (Number.isFinite(e.deltaX) ? e.deltaX : 0) * scale;
    let dy = (Number.isFinite(e.deltaY) ? e.deltaY : 0) * scale;

    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Shift + rueda desplaza horizontalmente tanto si el navegador lo reporta en deltaY como en deltaX
      if (Math.abs(dx) < 0.01 && Math.abs(dy) > 0) {
        dx = dy;
      }
      dy = 0;
    }

    return { dx, dy };
  } catch {
    return { dx: 0, dy: 0 };
  }
}

// Limita el desplazamiento de hojas de tamaño fijo manteniendo centrado horizontal si cabe y márgenes cómodos (40 mm vertical)
export function clampFixedBoardViewportPan(
  panX: number,
  panY: number,
  zoom: number,
  pageWidth: number,
  pageHeight: number,
  sheetCount: number,
  stageWidth: number,
  stageHeight: number
): { panX: number; panY: number } | null {
  try {
    if (
      !Number.isFinite(panX) ||
      !Number.isFinite(panY) ||
      !Number.isFinite(zoom) ||
      zoom <= 0 ||
      !Number.isFinite(pageWidth) ||
      pageWidth <= 0 ||
      !Number.isFinite(pageHeight) ||
      pageHeight <= 0 ||
      !Number.isFinite(stageWidth) ||
      stageWidth <= 0 ||
      !Number.isFinite(stageHeight) ||
      stageHeight <= 0
    ) {
      return null;
    }

    const scaledPageW = pageWidth * zoom;
    let clampedX: number;
    if (scaledPageW <= stageWidth) {
      // Si la hoja es más estrecha que el área visible, permanece centrada horizontalmente
      clampedX = (stageWidth - scaledPageW) / 2;
    } else {
      const hMarginPx = Math.max(
        48,
        Math.min(110, FIXED_SHEET_HORIZONTAL_MARGIN_MM * PX_PER_MM * zoom)
      );
      const minPanX = stageWidth - scaledPageW - hMarginPx;
      const maxPanX = hMarginPx;
      clampedX = clamp(panX, minPanX, maxPanX);
    }

    const totalWorldH = getTotalSheetsHeight(sheetCount, pageHeight);
    const totalScaledH = totalWorldH * zoom;
    const verticalPaperMarginPx = FIXED_SHEET_VERTICAL_MARGIN_MM * PX_PER_MM * zoom;
    const topMarginPx = Math.max(verticalPaperMarginPx, 36);
    const bottomMarginPx = Math.max(verticalPaperMarginPx, 52);

    let clampedY: number;
    if (totalScaledH + topMarginPx + bottomMarginPx <= stageHeight) {
      clampedY = (stageHeight - totalScaledH) / 2;
    } else {
      const minPanY = stageHeight - totalScaledH - bottomMarginPx;
      const maxPanY = topMarginPx;
      clampedY = clamp(panY, minPanY, maxPanY);
    }

    return { panX: clampedX, panY: clampedY };
  } catch (err) {
    console.error('[Ábaco] Error al calcular límites de desplazamiento de hojas:', err);
    return null;
  }
}
