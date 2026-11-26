import type {
  RichTextParagraph,
  SpellcheckLanguage,
  TableCellData,
  TableObject,
  TextAlign,
  TextFontFamily,
  TextRunStyle,
} from '../types/whiteboard';
import { uid } from './id';
import {
  type ResolvedTextRunStyle,
  applyAlignToAllParagraphs,
  applyStyleToAllParagraphs,
  clampTextFontSize,
  createParagraphsFromPlainText,
  normalizarContenidoTexto,
  normalizeParagraphs,
  normalizeTextAlign,
  paragraphsToPlainText,
  sanitizeStoredFontSize,
} from './richText';
import { isValidSpellcheckLanguage } from './spellcheck/personalDictionary';
import { normalizeTextFontFamily } from './textFonts';
// OPT: 1.6 — Caché WeakMap para evitar re-normalizar tablas inmutadas en cada cuadro
import { getOrComputeNormalizedTable } from './textMeasureCache';

// Límites y dimensiones base para tablas editables en coordenadas del mundo
export const TABLE_MAX_ROWS = 30;
export const TABLE_MAX_COLS = 15;
export const TABLE_MIN_COL_WIDTH = 56;
export const TABLE_MIN_ROW_HEIGHT = 34;
export const TABLE_DEFAULT_COL_WIDTH = 132;
export const TABLE_DEFAULT_ROW_HEIGHT = 40;

export interface TableCellCoord {
  r: number;
  c: number;
}

// Resuelve el estilo por defecto de una celda usando la configuración base de la tabla
export function getTableDefaultRunStyle(
  table?: Partial<Pick<TableObject, 'fontSize' | 'color' | 'fontFamily'>>,
  isHeaderCell = false
): ResolvedTextRunStyle {
  const fontSize = sanitizeStoredFontSize(
    typeof table?.fontSize === 'number' && Number.isFinite(table.fontSize)
      ? table.fontSize
      : 15,
    15
  );
  const color =
    typeof table?.color === 'string' && table.color.trim()
      ? table.color
      : '#0f172a';
  const fontFamily: TextFontFamily = normalizeTextFontFamily(table?.fontFamily);
  return {
    bold: isHeaderCell,
    italic: false,
    underline: false,
    fontSize,
    color,
    fontFamily,
  };
}

// Normaliza una celda individual garantizando contenido enriquecido válido y seguro
export function normalizeTableCell(
  rawCell: unknown,
  defaults: ResolvedTextRunStyle,
  fallbackId?: string
): TableCellData {
  const rec =
    rawCell && typeof rawCell === 'object' ? (rawCell as Partial<TableCellData>) : {};
  const align = normalizeTextAlign(rec.align, 'left');
  const source =
    Array.isArray(rec.paragraphs) && rec.paragraphs.length > 0
      ? rec.paragraphs
      : typeof rec.content === 'string'
      ? rec.content
      : '';
  const paragraphs = normalizarContenidoTexto(source, defaults, align);
  const content = paragraphsToPlainText(paragraphs);
  return {
    id: typeof rec.id === 'string' && rec.id.trim() ? rec.id : fallbackId || uid('cel'),
    content,
    paragraphs,
    align: normalizeTextAlign(paragraphs[0]?.align, align),
  };
}

// Detecta si unos datos crudos de tabla presentan corrupción estructural grave (ej. filas desiguales o celdas inválidas)
export function hasTableStructuralCorruption(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return true;
  const t = valor as Partial<TableObject>;
  if (!Array.isArray(t.cells) || t.cells.length === 0) return true;
  const expectedCols =
    typeof t.cols === 'number' && Number.isFinite(t.cols) && t.cols > 0
      ? Math.round(t.cols)
      : Array.isArray(t.cells[0])
      ? t.cells[0].length
      : 0;
  if (expectedCols <= 0) return true;
  for (const row of t.cells) {
    if (!Array.isArray(row) || row.length !== expectedCols) return true;
    for (const cell of row) {
      if (!cell || typeof cell !== 'object') return true;
    }
  }
  return false;
}

// Normaliza cualquier entrada (null, filas irregulares, celdas rotas, tipos erróneos) y SIEMPRE devuelve una TableObject válida
export function normalizarTabla(
  valor: unknown,
  fallbackMeta?: Partial<Pick<TableObject, 'layerId' | 'x' | 'y' | 'zIndex' | 'lang'>>
): TableObject {
  if (valor && typeof valor === 'object' && !fallbackMeta) {
    return getOrComputeNormalizedTable(valor as object, () =>
      normalizarTablaUncached(valor)
    );
  }
  return normalizarTablaUncached(valor, fallbackMeta);
}

function normalizarTablaUncached(
  valor: unknown,
  fallbackMeta?: Partial<Pick<TableObject, 'layerId' | 'x' | 'y' | 'zIndex' | 'lang'>>
): TableObject {
  const raw =
    valor && typeof valor === 'object' ? (valor as Partial<TableObject>) : {};

  const rawRowsList = Array.isArray(raw.cells) ? raw.cells : [];
  const maxColsInRawRows = rawRowsList.reduce(
    (max, r) => (Array.isArray(r) ? Math.max(max, r.length) : max),
    0
  );

  const declaredRows =
    typeof raw.rows === 'number' && Number.isFinite(raw.rows) ? Math.round(raw.rows) : 0;
  const declaredCols =
    typeof raw.cols === 'number' && Number.isFinite(raw.cols) ? Math.round(raw.cols) : 0;

  const rows = Math.max(
    1,
    Math.min(TABLE_MAX_ROWS, declaredRows || rawRowsList.length || 3)
  );
  const cols = Math.max(
    1,
    Math.min(TABLE_MAX_COLS, declaredCols || maxColsInRawRows || 3)
  );

  const fontSize = sanitizeStoredFontSize(
    typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize) ? raw.fontSize : 15,
    15
  );
  const fontFamily = normalizeTextFontFamily(raw.fontFamily);
  const hasHeaderRow = typeof raw.hasHeaderRow === 'boolean' ? raw.hasHeaderRow : true;
  const color =
    typeof raw.color === 'string' && raw.color.trim() ? raw.color : undefined;
  const baseDefaults = getTableDefaultRunStyle({ fontSize, fontFamily, color }, false);

  const colWidths: number[] = Array.from({ length: cols }, (_, c) => {
    const val = Array.isArray(raw.colWidths) ? raw.colWidths[c] : undefined;
    return typeof val === 'number' && Number.isFinite(val)
      ? Math.max(TABLE_MIN_COL_WIDTH, Math.round(val))
      : TABLE_DEFAULT_COL_WIDTH;
  });

  const rowHeights: number[] = Array.from({ length: rows }, (_, r) => {
    const val = Array.isArray(raw.rowHeights) ? raw.rowHeights[r] : undefined;
    return typeof val === 'number' && Number.isFinite(val)
      ? Math.max(TABLE_MIN_ROW_HEIGHT, Math.round(val))
      : TABLE_DEFAULT_ROW_HEIGHT;
  });

  const cells: TableCellData[][] = Array.from({ length: rows }, (_, r) => {
    const srcRow = Array.isArray(rawRowsList[r]) ? rawRowsList[r] : [];
    const cellDefaults = getTableDefaultRunStyle(
      { fontSize, fontFamily, color },
      hasHeaderRow && r === 0
    );
    return Array.from({ length: cols }, (__, c) =>
      normalizeTableCell(srcRow[c], cellDefaults)
    );
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0);

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim() ? raw.id : uid('tbl'),
    type: 'table',
    layerId:
      typeof raw.layerId === 'string' && raw.layerId.trim()
        ? raw.layerId
        : fallbackMeta?.layerId || 'layer_main',
    groupId: typeof raw.groupId === 'string' ? raw.groupId : undefined,
    x:
      typeof raw.x === 'number' && Number.isFinite(raw.x)
        ? raw.x
        : fallbackMeta?.x ?? 0,
    y:
      typeof raw.y === 'number' && Number.isFinite(raw.y)
        ? raw.y
        : fallbackMeta?.y ?? 0,
    width: Math.max(TABLE_MIN_COL_WIDTH, totalWidth),
    height: Math.max(TABLE_MIN_ROW_HEIGHT, totalHeight),
    rotation:
      typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)
        ? raw.rotation
        : 0,
    opacity:
      typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)
        ? Math.max(0.05, Math.min(1, raw.opacity))
        : 1,
    locked: Boolean(raw.locked),
    zIndex:
      typeof raw.zIndex === 'number' && Number.isFinite(raw.zIndex)
        ? raw.zIndex
        : fallbackMeta?.zIndex ?? 1,
    rows,
    cols,
    colWidths,
    rowHeights,
    cells,
    hasHeaderRow,
    fontSize: baseDefaults.fontSize,
    fontFamily: baseDefaults.fontFamily,
    color,
    borderColor:
      typeof raw.borderColor === 'string' && raw.borderColor.trim()
        ? raw.borderColor
        : undefined,
    headerFillColor:
      typeof raw.headerFillColor === 'string' && raw.headerFillColor.trim()
        ? raw.headerFillColor
        : undefined,
    lang: isValidSpellcheckLanguage(raw.lang)
      ? raw.lang
      : isValidSpellcheckLanguage(fallbackMeta?.lang)
      ? fallbackMeta.lang
      : undefined,
  };
}

// Crea una nueva tabla vacía centrada o en posición explícita con dimensiones seguras
export function createTableObject(opts: {
  x: number;
  y: number;
  rows: number;
  cols: number;
  layerId: string;
  zIndex: number;
  hasHeaderRow?: boolean;
  fontSize?: number;
  fontFamily?: TextFontFamily;
  color?: string;
  lang?: SpellcheckLanguage;
}): TableObject {
  const safeRows = Math.max(1, Math.min(TABLE_MAX_ROWS, Math.round(opts.rows)));
  const safeCols = Math.max(1, Math.min(TABLE_MAX_COLS, Math.round(opts.cols)));
  const hasHeaderRow = opts.hasHeaderRow ?? true;
  const fontSize = clampTextFontSize(opts.fontSize ?? 15);
  const fontFamily = normalizeTextFontFamily(opts.fontFamily);
  const colWidths = Array.from({ length: safeCols }, () => TABLE_DEFAULT_COL_WIDTH);
  const rowHeights = Array.from({ length: safeRows }, () => TABLE_DEFAULT_ROW_HEIGHT);

  const cells: TableCellData[][] = Array.from({ length: safeRows }, (_, r) => {
    const defaults = getTableDefaultRunStyle(
      { fontSize, fontFamily, color: opts.color },
      hasHeaderRow && r === 0
    );
    return Array.from({ length: safeCols }, () => ({
      id: uid('cel'),
      content: '',
      paragraphs: createParagraphsFromPlainText('', defaults, 'left'),
      align: 'left' as TextAlign,
    }));
  });

  const width = colWidths.reduce((a, b) => a + b, 0);
  const height = rowHeights.reduce((a, b) => a + b, 0);

  return {
    id: uid('tbl'),
    type: 'table',
    layerId: opts.layerId,
    x: opts.x,
    y: opts.y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: opts.zIndex,
    rows: safeRows,
    cols: safeCols,
    colWidths,
    rowHeights,
    cells,
    hasHeaderRow,
    fontSize,
    fontFamily,
    color: opts.color,
    lang: opts.lang,
  };
}

// Recalcula width y height de la tabla a partir de sus colWidths y rowHeights
export function recomputeTableOuterSize(table: TableObject): TableObject {
  const width = table.colWidths.reduce(
    (sum, w) => sum + Math.max(TABLE_MIN_COL_WIDTH, w),
    0
  );
  const height = table.rowHeights.reduce(
    (sum, h) => sum + Math.max(TABLE_MIN_ROW_HEIGHT, h),
    0
  );
  return {
    ...table,
    width: Math.max(TABLE_MIN_COL_WIDTH, Math.round(width)),
    height: Math.max(TABLE_MIN_ROW_HEIGHT, Math.round(height)),
  };
}

// Inserta una fila vacía en la posición indicada (por defecto al final)
export function addTableRow(tableInput: TableObject, atIndex?: number): TableObject {
  const table = normalizarTabla(tableInput);
  if (table.rows >= TABLE_MAX_ROWS) return table;
  const insertIdx =
    typeof atIndex === 'number' && Number.isFinite(atIndex)
      ? Math.max(0, Math.min(table.rows, Math.round(atIndex)))
      : table.rows;
  const defaults = getTableDefaultRunStyle(
    table,
    table.hasHeaderRow && insertIdx === 0
  );
  const newRow: TableCellData[] = Array.from({ length: table.cols }, () => ({
    id: uid('cel'),
    content: '',
    paragraphs: createParagraphsFromPlainText('', defaults, 'left'),
    align: 'left',
  }));
  const cells = [
    ...table.cells.slice(0, insertIdx),
    newRow,
    ...table.cells.slice(insertIdx),
  ];
  const rowHeights = [
    ...table.rowHeights.slice(0, insertIdx),
    TABLE_DEFAULT_ROW_HEIGHT,
    ...table.rowHeights.slice(insertIdx),
  ];
  return recomputeTableOuterSize({
    ...table,
    rows: cells.length,
    cells,
    rowHeights,
  });
}

// Elimina la fila indicada (siempre conserva al menos 1 fila)
export function removeTableRow(tableInput: TableObject, rowIndex: number): TableObject {
  const table = normalizarTabla(tableInput);
  if (table.rows <= 1) return table;
  const idx = Math.max(0, Math.min(table.rows - 1, Math.round(rowIndex)));
  const cells = table.cells.filter((_, r) => r !== idx);
  const rowHeights = table.rowHeights.filter((_, r) => r !== idx);
  return recomputeTableOuterSize({
    ...table,
    rows: cells.length,
    cells,
    rowHeights,
  });
}

// Inserta una columna vacía en la posición indicada (por defecto al final)
export function addTableCol(tableInput: TableObject, atIndex?: number): TableObject {
  const table = normalizarTabla(tableInput);
  if (table.cols >= TABLE_MAX_COLS) return table;
  const insertIdx =
    typeof atIndex === 'number' && Number.isFinite(atIndex)
      ? Math.max(0, Math.min(table.cols, Math.round(atIndex)))
      : table.cols;
  const cells = table.cells.map((row, r) => {
    const defaults = getTableDefaultRunStyle(table, table.hasHeaderRow && r === 0);
    const newCell: TableCellData = {
      id: uid('cel'),
      content: '',
      paragraphs: createParagraphsFromPlainText('', defaults, 'left'),
      align: 'left',
    };
    return [...row.slice(0, insertIdx), newCell, ...row.slice(insertIdx)];
  });
  const colWidths = [
    ...table.colWidths.slice(0, insertIdx),
    TABLE_DEFAULT_COL_WIDTH,
    ...table.colWidths.slice(insertIdx),
  ];
  return recomputeTableOuterSize({
    ...table,
    cols: colWidths.length,
    cells,
    colWidths,
  });
}

// Elimina la columna indicada (siempre conserva al menos 1 columna)
export function removeTableCol(tableInput: TableObject, colIndex: number): TableObject {
  const table = normalizarTabla(tableInput);
  if (table.cols <= 1) return table;
  const idx = Math.max(0, Math.min(table.cols - 1, Math.round(colIndex)));
  const cells = table.cells.map((row) => row.filter((_, c) => c !== idx));
  const colWidths = table.colWidths.filter((_, c) => c !== idx);
  return recomputeTableOuterSize({
    ...table,
    cols: colWidths.length,
    cells,
    colWidths,
  });
}

// Actualiza los párrafos de una celda concreta manteniendo sincronizado su texto plano y alineación
export function updateTableCellParagraphs(
  tableInput: TableObject,
  r: number,
  c: number,
  paragraphs: RichTextParagraph[],
  cellDefaults?: ResolvedTextRunStyle
): TableObject {
  const table = normalizarTabla(tableInput);
  if (r < 0 || r >= table.rows || c < 0 || c >= table.cols) return table;
  const defaults =
    cellDefaults || getTableDefaultRunStyle(table, table.hasHeaderRow && r === 0);
  const existing = table.cells[r][c];
  const normalized = normalizeParagraphs(
    paragraphs,
    defaults,
    existing?.align || 'left'
  );
  const plain = paragraphsToPlainText(normalized);
  const nextAlign = normalizeTextAlign(normalized[0]?.align, existing?.align || 'left');

  const nextCells = table.cells.map((row, rIdx) =>
    rIdx !== r
      ? row
      : row.map((cell, cIdx) =>
          cIdx !== c
            ? cell
            : {
                ...cell,
                content: plain,
                paragraphs: normalized,
                align: nextAlign,
              }
        )
  );
  return {
    ...table,
    cells: nextCells,
  };
}

// Vacía el contenido de las celdas especificadas en una sola operación atómica
export function clearTableCellsContent(
  tableInput: TableObject,
  coords: TableCellCoord[]
): TableObject {
  const table = normalizarTabla(tableInput);
  const keySet = new Set(coords.map((pt) => `${pt.r}:${pt.c}`));
  if (keySet.size === 0) return table;
  const nextCells = table.cells.map((row, r) =>
    row.map((cell, c) => {
      if (!keySet.has(`${r}:${c}`)) return cell;
      const defaults = getTableDefaultRunStyle(table, table.hasHeaderRow && r === 0);
      const align = cell.align || 'left';
      return {
        ...cell,
        content: '',
        paragraphs: createParagraphsFromPlainText('', defaults, align),
      };
    })
  );
  return {
    ...table,
    cells: nextCells,
  };
}

// Aplica estilo en línea y/o alineación sobre un conjunto de celdas seleccionadas
export function applyFormattingToTableCells(
  tableInput: TableObject,
  coords: TableCellCoord[],
  opts: { stylePatch?: Partial<TextRunStyle>; align?: TextAlign }
): TableObject {
  const table = normalizarTabla(tableInput);
  const keySet = new Set(coords.map((pt) => `${pt.r}:${pt.c}`));
  if (keySet.size === 0) return table;

  const nextCells = table.cells.map((row, r) =>
    row.map((cell, c) => {
      if (!keySet.has(`${r}:${c}`)) return cell;
      const defaults = getTableDefaultRunStyle(table, table.hasHeaderRow && r === 0);
      let paras = normalizarContenidoTexto(cell.paragraphs, defaults, cell.align || 'left');
      if (opts.stylePatch) {
        paras = applyStyleToAllParagraphs(paras, opts.stylePatch, defaults);
      }
      if (opts.align) {
        paras = applyAlignToAllParagraphs(paras, opts.align, defaults);
      }
      return {
        ...cell,
        content: paragraphsToPlainText(paras),
        paragraphs: paras,
        align: opts.align || normalizeTextAlign(paras[0]?.align, cell.align || 'left'),
      };
    })
  );

  return {
    ...table,
    cells: nextCells,
  };
}

// Escala proporcionalmente colWidths y rowHeights al redimensionar la tabla desde los manejadores exteriores
export function scaleTableToDimensions(
  tableInput: TableObject,
  targetWidth: number,
  targetHeight: number
): TableObject {
  const table = normalizarTabla(tableInput);
  const safeTargetW = Math.max(table.cols * TABLE_MIN_COL_WIDTH, targetWidth);
  const safeTargetH = Math.max(table.rows * TABLE_MIN_ROW_HEIGHT, targetHeight);
  const curW = Math.max(1, table.colWidths.reduce((a, b) => a + b, 0));
  const curH = Math.max(1, table.rowHeights.reduce((a, b) => a + b, 0));
  const sx = safeTargetW / curW;
  const sy = safeTargetH / curH;

  const colWidths = table.colWidths.map((w) =>
    Math.max(TABLE_MIN_COL_WIDTH, Math.round(w * sx))
  );
  const rowHeights = table.rowHeights.map((h) =>
    Math.max(TABLE_MIN_ROW_HEIGHT, Math.round(h * sy))
  );

  return recomputeTableOuterSize({
    ...table,
    colWidths,
    rowHeights,
  });
}

// Analiza texto tabular proveniente de editores de texto u hojas de cálculo externas (tabuladores, saltos de línea o HTML <table>)
export function parseClipboardTabularMatrix(
  plainText: string,
  htmlText?: string
): string[][] | null {
  const safeHtml = typeof htmlText === 'string' ? htmlText : '';
  const safePlain = typeof plainText === 'string' ? plainText : '';

  // 1) Si el portapapeles incluye un <table> HTML válido lo decodificamos con DOMParser
  if (
    safeHtml.includes('<table') &&
    typeof DOMParser !== 'undefined'
  ) {
    try {
      const doc = new DOMParser().parseFromString(safeHtml, 'text/html');
      const tableEl = doc.querySelector('table');
      if (tableEl) {
        const rows: string[][] = [];
        tableEl.querySelectorAll('tr').forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll('th, td')).map((td) =>
            (td.textContent || '').replace(/\u00a0/g, ' ').trim()
          );
          if (cells.length > 0) rows.push(cells);
        });
        if (
          rows.length > 1 ||
          (rows.length === 1 && rows[0].length > 1)
        ) {
          return rows;
        }
      }
    } catch {
      // Continuar con el analizador de texto plano TSV
    }
  }

  // 2) Análisis TSV estándar (tabuladores + saltos de línea, respetando comillas de hojas de cálculo)
  const normalized = safePlain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.includes('\t') && !normalized.includes('\n')) {
    return null;
  }

  // Quita únicamente el salto de línea final que las hojas de cálculo suelen anexar al copiar un rango
  const trimmedTrailingNl = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;
  if (!trimmedTrailingNl) return null;

  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < trimmedTrailingNl.length; i++) {
    const ch = trimmedTrailingNl[i];
    const next = trimmedTrailingNl[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
      continue;
    }
    if (ch === '\t') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      matrix.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  matrix.push(row);

  const isMultiCell =
    matrix.length > 1 || matrix.some((r) => r.length > 1);
  return isMultiCell ? matrix : null;
}

// Pega una matriz tabular a partir de la celda (startR, startC), expandiendo filas y columnas si hace falta
export function pasteTabularTextIntoTable(
  tableInput: TableObject,
  startR: number,
  startC: number,
  plainText: string,
  htmlText?: string
): { table: TableObject; matrix: string[][] } | null {
  const matrix = parseClipboardTabularMatrix(plainText, htmlText);
  if (!matrix || matrix.length === 0) return null;

  let table = normalizarTabla(tableInput);
  const safeR = Math.max(0, Math.min(table.rows - 1, startR));
  const safeC = Math.max(0, Math.min(table.cols - 1, startC));

  const matrixMaxCols = matrix.reduce((m, r) => Math.max(m, r.length), 1);
  const neededRows = Math.min(TABLE_MAX_ROWS, safeR + matrix.length);
  const neededCols = Math.min(TABLE_MAX_COLS, safeC + matrixMaxCols);

  while (table.rows < neededRows) {
    table = addTableRow(table);
  }
  while (table.cols < neededCols) {
    table = addTableCol(table);
  }

  let nextTable = table;
  for (let mr = 0; mr < matrix.length; mr++) {
    const tr = safeR + mr;
    if (tr >= nextTable.rows) break;
    const mRow = matrix[mr];
    for (let mc = 0; mc < mRow.length; mc++) {
      const tc = safeC + mc;
      if (tc >= nextTable.cols) break;
      const defaults = getTableDefaultRunStyle(
        nextTable,
        nextTable.hasHeaderRow && tr === 0
      );
      const existingAlign = nextTable.cells[tr]?.[tc]?.align || 'left';
      const valText = mRow[mc] ?? '';
      const paras = createParagraphsFromPlainText(valText, defaults, existingAlign);
      nextTable = updateTableCellParagraphs(nextTable, tr, tc, paras, defaults);
    }
  }

  return { table: nextTable, matrix };
}
