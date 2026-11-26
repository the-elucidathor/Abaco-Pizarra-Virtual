// OPT: 1.6 — Caché LRU y WeakMap para normalización y medición de texto enriquecido y celdas de tabla
import type { RichTextParagraph, TableObject, TextAlign } from '../types/whiteboard';
import type { ResolvedTextRunStyle } from './richText';

const MAX_MEASURE_LRU = 400;

export interface CachedTextMeasure {
  width: number;
  height: number;
}

const textMeasureLru = new Map<string, CachedTextMeasure>();

export function buildTextMeasureKey(
  contentSig: string,
  font: string,
  fontSize: number,
  width: number,
  mode: string
): string {
  return `${mode}|${font}|${fontSize}|${Math.round(width * 10)}|${contentSig}`;
}

export function getCachedTextMeasurement(
  key: string,
  compute: () => CachedTextMeasure
): CachedTextMeasure {
  const existing = textMeasureLru.get(key);
  if (existing !== undefined) {
    // Promueve al final (LRU)
    textMeasureLru.delete(key);
    textMeasureLru.set(key, existing);
    return existing;
  }
  const value = compute();
  textMeasureLru.set(key, value);
  if (textMeasureLru.size > MAX_MEASURE_LRU) {
    const oldestKey = textMeasureLru.keys().next().value;
    if (oldestKey !== undefined) {
      textMeasureLru.delete(oldestKey);
    }
  }
  return value;
}

export function computeParagraphsFingerprint(paragraphs: RichTextParagraph[]): string {
  let acc = `${paragraphs.length}:`;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p || !Array.isArray(p.runs)) {
      acc += 'x;';
      continue;
    }
    acc += `${p.align || ''},${p.runs.length},`;
    for (let j = 0; j < p.runs.length; j++) {
      const r = p.runs[j];
      const mathSig = r?.math ? `m:${r.math.displayMode ? 1 : 0}:${r.math.latex}` : '';
      acc += r
        ? `${r.text?.length || 0}:${r.bold ? 1 : 0}${r.italic ? 1 : 0}${r.underline ? 1 : 0}${r.fontSize || ''}${r.color || ''}:${mathSig}|`
        : 'n|';
    }
    acc += ';';
  }
  return acc;
}

interface ParagraphNormEntry {
  sig: string;
  fp: string;
  result: RichTextParagraph[];
}

const paragraphNormCache = new WeakMap<object, ParagraphNormEntry>();

export function getOrComputeNormalizedParagraphs(
  valor: RichTextParagraph[],
  defaults: ResolvedTextRunStyle,
  defaultAlign: TextAlign,
  compute: () => RichTextParagraph[]
): RichTextParagraph[] {
  try {
    const sig = `${defaultAlign}|${defaults.fontFamily}|${defaults.fontSize}|${defaults.color}|${defaults.bold ? 1 : 0}${defaults.italic ? 1 : 0}${defaults.underline ? 1 : 0}`;
    const fp = computeParagraphsFingerprint(valor);
    const cached = paragraphNormCache.get(valor);
    if (cached && cached.sig === sig && cached.fp === fp) {
      return cached.result;
    }
    const result = compute();
    paragraphNormCache.set(valor, { sig, fp, result });
    return result;
  } catch {
    return compute();
  }
}

interface TableNormEntry {
  fp: string;
  srcCellsRef: unknown;
  result: TableObject;
}

const tableNormCache = new WeakMap<object, TableNormEntry>();

export function getOrComputeNormalizedTable(
  valor: object,
  compute: () => TableObject
): TableObject {
  try {
    const raw = valor as Partial<TableObject>;
    const fp = `${raw.id || ''}|${raw.rows || 0}x${raw.cols || 0}|${raw.fontSize || ''}|${raw.fontFamily || ''}|${raw.hasHeaderRow ? 1 : 0}|${raw.color || ''}|${raw.headerFillColor || ''}|${raw.borderColor || ''}|${Array.isArray(raw.cells) ? raw.cells.length : 0}|${Array.isArray(raw.colWidths) ? raw.colWidths.join(',') : ''}|${Array.isArray(raw.rowHeights) ? raw.rowHeights.join(',') : ''}`;
    const cached = tableNormCache.get(valor);
    if (cached && cached.fp === fp && cached.srcCellsRef === raw.cells) {
      return cached.result;
    }
    const result = compute();
    if (result.cells && Array.isArray(raw.cells) && result.rows === raw.rows && result.cols === raw.cols) {
      tableNormCache.set(valor, { fp, srcCellsRef: raw.cells, result });
    }
    return result;
  } catch {
    return compute();
  }
}

export function clearTextMeasureCache(): void {
  textMeasureLru.clear();
}
