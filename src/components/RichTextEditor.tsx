import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Sigma,
  Underline,
} from 'lucide-react';
import type {
  RichTextParagraph,
  SpellcheckLanguage,
  TextAlign,
  TextFontFamily,
  TextRun,
  TextRunMath,
  TextRunStyle,
} from '../types/whiteboard';
import { TEXT_FONT_OPTIONS, getTextFontCss } from '../utils/textFonts';
import {
  INLINE_MATH_PLACEHOLDER,
  type ResolvedTextRunStyle,
  type SelectionStyleSummary,
  type TextSelectionRange,
  applyInlineStyleToRange,
  applyParagraphAlignToRange,
  flatOffsetToParagraphPos,
  getCaretRunStyle,
  getSelectionStyleSummary,
  insertParagraphsAtRange,
  insertTextAtRange,
  isMathRun,
  normalizarContenidoTexto,
  normalizeParagraphs,
  normalizeTextAlign,
  paragraphsToPlainText,
  parseSanitizedHtmlToParagraphs,
  replaceRangeWithMathRun,
  replaceWordPreservingRunStyle,
  resolveRunStyle,
  sanitizeRunMath,
  sanitizeStoredFontSize,
  stepFontSizeInRange,
  stepFontSizeValue,
} from '../utils/richText';
import {
  renderKatexToStringLazy,
  renderLatexFallbackHtml,
  useKatexReady,
} from '../utils/katexLoader';
import {
  type MathCursor,
  applyBackspaceAtCursor,
  applyDeleteAtCursor,
  applySnippetAtCursor,
  applyTextInputAtCursor,
  decodePath,
  getInitialEditCursor,
  getSeqAtPath,
  insertMathSpaceAtCursor,
  jumpToNextSlotCursor,
  parseLatexToAst,
  renderInteractiveEquationHtml,
  stepCursorLeft,
  stepCursorRight,
  stepCursorVertical,
} from '../utils/latexEditorEngine';
import {
  type DictionaryStatus,
  addWordToPersonalDictionaryAndEngine,
  applySuggestionCase,
  ensureDictionaryLoaded,
  findMisspelledTokens,
  getDictionaryStatus,
  getSpellSuggestions,
  ignoreWordForSession,
  subscribeDictionaryStatus,
} from '../utils/spellcheck/spellcheckEngine';
import {
  setRememberedTextLang,
  subscribePersonalDictionary,
} from '../utils/spellcheck/personalDictionary';
import {
  SpellcheckContextMenu,
  type SpellcheckContextMenuState,
} from './SpellcheckContextMenu';
import { FontSizeInput } from './FontSizeInput';
import { ColorSwatchPicker } from './ColorSwatchPicker';

// Ancho máximo por defecto (en coordenadas del mundo) antes de hacer salto de línea en modo automático
export const TEXT_AUTO_MAX_WIDTH = 600;

const SPELL_HIGHLIGHT_NAME = 'abaco-spell-error';

interface MisspelledDomEntry {
  word: string;
  start: number;
  end: number;
  range: Range;
}

interface FallbackWaveRect {
  left: number;
  top: number;
  width: number;
}

export interface InlineEquationRequest {
  initialLatex: string;
  displayMode: boolean;
  fontSize: number;
  color: string;
  selectionRange: TextSelectionRange;
  isEditingExisting: boolean;
}

export interface ActiveInlineEquationSession {
  latex: string;
  displayMode: boolean;
  fontSize: number;
  color: string;
  selectionRange: TextSelectionRange;
  cursor: MathCursor;
}

// Interfaz imperativa expuesta para controlar el editor desde barras externas (p. ej. Inspector, cinta de ecuaciones o celdas)
export interface RichTextEditorHandle {
  applyStyle: (
    patch: Partial<TextRunStyle>,
    options?: { restoreFocus?: boolean; recordHistory?: boolean }
  ) => void;
  stepFontSize: (delta: number, options?: { restoreFocus?: boolean }) => void;
  applyAlign: (align: TextAlign, options?: { restoreFocus?: boolean }) => void;
  insertOrUpdateMath: (
    math: TextRunMath,
    options?: {
      selectionRange?: TextSelectionRange;
      fontSize?: number;
      color?: string;
      restoreFocus?: boolean;
    }
  ) => void;
  insertInlineEquationSnippet: (snippet: string) => void;
  replaceInlineEquationLatex: (latex: string) => void;
  updateInlineEquationMeta: (patch: {
    fontSize?: number;
    color?: string;
    displayMode?: boolean;
  }) => void;
  jumpNextInlineEquationPlaceholder: () => void;
  finishInlineEquationEditing: (restoreTextCaret?: boolean) => void;
  focusInlineEquationInput: () => void;
  getSelectionSummary: () => SelectionStyleSummary;
  getSelectionRange: () => TextSelectionRange;
  focus: () => void;
}

export interface RichTextViewerProps {
  paragraphs: RichTextParagraph[];
  defaults: ResolvedTextRunStyle;
  defaultAlign: TextAlign;
  listStyle?: 'none' | 'bullet' | 'numbered';
  backgroundColor?: string;
  autoWidth?: boolean;
  maxAutoWidth?: number;
  resolveColor?: (color: string) => string;
  compactCell?: boolean;
  // V1.11.8-16: Ajustes visuales compactos cuando la celda de tabla es reducida por debajo del tamaño estándar
  compactTight?: boolean;
  compactScale?: number;
  className?: string;
}

// OPT: 2.6 — Visor memorizado de texto enriquecido por párrafos y tramos (sin edición)
export const RichTextViewer: React.FC<RichTextViewerProps> = React.memo(({
  paragraphs,
  defaults,
  defaultAlign,
  listStyle = 'none',
  backgroundColor = 'transparent',
  autoWidth = false,
  maxAutoWidth = TEXT_AUTO_MAX_WIDTH,
  resolveColor,
  compactCell = false,
  compactTight = false,
  compactScale = 1,
  className = '',
}) => {
  const katexReady = useKatexReady();
  const safeScale =
    typeof compactScale === 'number' && Number.isFinite(compactScale)
      ? Math.max(0.35, Math.min(1, compactScale))
      : 1;
  const scaledPx = (px: number) => `${Math.max(6, Math.round(px * safeScale * 10) / 10)}px`;
  const normalized = useMemo(
    () => normalizarContenidoTexto(paragraphs, defaults, defaultAlign),
    [paragraphs, defaults, defaultAlign]
  );

  const mapColor = useCallback(
    (c: string) => (resolveColor ? resolveColor(c) : c),
    [resolveColor]
  );

  const renderMathHtml = useCallback(
    (latex: string, displayMode: boolean) => {
      void katexReady;
      try {
        return (
          renderKatexToStringLazy(latex || '\\square', {
            displayMode,
            throwOnError: false,
            strict: false,
            trust: false,
          }) ?? renderLatexFallbackHtml(latex)
        );
      } catch {
        return renderLatexFallbackHtml(latex);
      }
    },
    [katexReady]
  );

  return (
    <div
      className={`w-full min-h-full ${compactCell ? '' : 'rounded'} ${className}`}
      style={{
        backgroundColor: backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
      }}
    >
      {/* El borde transparente de 2px iguala exactamente la caja del RichTextEditor para evitar saltos al entrar/salir de edición */}
      <div
        data-rt-content-measure="true"
        className={`box-border ${
          compactTight
            ? 'border border-transparent px-0.5 py-0 leading-none'
            : `border-2 border-transparent ${
                compactCell ? 'px-1.5 py-1' : 'p-1.5'
              } leading-snug`
        } overflow-visible select-none whitespace-pre-wrap break-words ${
          autoWidth ? 'min-w-[64px]' : 'w-full'
        }`}
        style={
          autoWidth
            ? {
                width: 'fit-content',
                maxWidth: `${maxAutoWidth}px`,
              }
            : undefined
        }
      >
        {normalized.map((p, pIdx) => {
          const storedAlign = normalizeTextAlign(p?.align, defaultAlign);
          // Si el ancho es automático y el texto aún no ocupa todo el ancho máximo, la justificación no se aprecia hasta fijar ancho
          const visualAlign: TextAlign =
            autoWidth && storedAlign === 'justify' ? 'left' : storedAlign;
          const safeRuns = Array.isArray(p?.runs) && p.runs.length > 0 ? p.runs : [{ text: '' }];
          const isEmpty =
            safeRuns.length === 1 && safeRuns[0].text.length === 0 && !isMathRun(safeRuns[0]);
          const firstStyle = resolveRunStyle(safeRuns[0], defaults);
          const prefix =
            listStyle === 'bullet' ? '• ' : listStyle === 'numbered' ? `${pIdx + 1}. ` : '';

          return (
            <div
              key={pIdx}
              style={{
                textAlign: visualAlign,
                textAlignLast: visualAlign === 'justify' ? 'left' : undefined,
                minHeight: compactTight ? '1em' : '1.35em',
              }}
            >
              {prefix && (
                <span
                  style={{
                    fontFamily: getTextFontCss(firstStyle.fontFamily),
                    fontSize: scaledPx(firstStyle.fontSize),
                    color: mapColor(firstStyle.color),
                  }}
                >
                  {prefix}
                </span>
              )}
              {isEmpty ? (
                <span
                  style={{
                    fontFamily: getTextFontCss(firstStyle.fontFamily),
                    fontSize: scaledPx(firstStyle.fontSize),
                  }}
                >
                  {'\u200B'}
                </span>
              ) : (
                safeRuns.map((run, rIdx) => {
                  const st = resolveRunStyle(run, defaults);
                  if (isMathRun(run) && run.math) {
                    const isBlockMath = Boolean(run.math.displayMode);
                    return (
                      <span
                        key={rIdx}
                        data-rt-math="1"
                        className={`katex-canvas-node ${
                          isBlockMath
                            ? 'flex justify-center w-full my-1'
                            : 'inline-flex align-middle mx-0.5'
                        }`}
                        style={{
                          fontFamily: getTextFontCss(st.fontFamily),
                          fontSize: scaledPx(st.fontSize),
                          color: mapColor(st.color),
                        }}
                        dangerouslySetInnerHTML={{
                          __html: renderMathHtml(run.math.latex, isBlockMath),
                        }}
                      />
                    );
                  }
                  return (
                    <span
                      key={rIdx}
                      style={{
                        fontFamily: getTextFontCss(st.fontFamily),
                        fontSize: scaledPx(st.fontSize),
                        fontWeight: st.bold ? 700 : 400,
                        fontStyle: st.italic ? 'italic' : 'normal',
                        textDecoration: st.underline ? 'underline' : 'none',
                        color: mapColor(st.color),
                      }}
                    >
                      {run.text}
                    </span>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});


export interface RichTextEditorProps {
  paragraphs: RichTextParagraph[];
  defaults: ResolvedTextRunStyle;
  defaultAlign: TextAlign;
  listStyle?: 'none' | 'bullet' | 'numbered';
  backgroundColor?: string;
  autoWidth?: boolean;
  maxAutoWidth?: number;
  lang?: SpellcheckLanguage;
  spellcheckEnabled?: boolean;
  showToolbar?: boolean;
  showListControls?: boolean;
  showDoneButton?: boolean;
  autoFocus?: boolean;
  placeholderDefaultsToSelectAll?: string[];
  resolveColor?: (color: string) => string;
  onChangeParagraphs: (nextParagraphs: RichTextParagraph[], recordHistory: boolean) => void;
  onPushParagraphsSnapshot?: (snapshotParagraphs: RichTextParagraph[]) => void;
  onChangeListStyle?: (nextListStyle: 'none' | 'bullet' | 'numbered') => void;
  onChangeLang?: (nextLang: SpellcheckLanguage) => void;
  onSelectionSummaryChange?: (summary: SelectionStyleSummary) => void;
  onAutoHeightChange?: (requiredHeight: number) => void;
  onAutoSizeChange?: (size: { width?: number; height: number }) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFinish?: () => void;
  onRequestEquationEditor?: (req: InlineEquationRequest) => void;
  onActiveInlineEquationChange?: (session: ActiveInlineEquationSession | null) => void;
  // Opciones cuando el editor corre embebido dentro de una celda de tabla
  compactCell?: boolean;
  onTableCellKeyDown?: (
    e: React.KeyboardEvent<HTMLDivElement>,
    info: {
      atStart: boolean;
      atEnd: boolean;
      hasSelection: boolean;
      flush: () => RichTextParagraph[];
    }
  ) => boolean;
  onTablePaste?: (plain: string, html: string) => boolean;
  className?: string;
}

// Compara dos resúmenes para evitar actualizaciones redundantes o bucles de render
function summariesEqual(a: SelectionStyleSummary | null, b: SelectionStyleSummary): boolean {
  if (!a) return false;
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.fontSize === b.fontSize &&
    String(a.color).toLowerCase() === String(b.color).toLowerCase() &&
    a.fontFamily === b.fontFamily &&
    a.align === b.align &&
    a.isCollapsed === b.isCollapsed
  );
}

// Genera firma estable para comparar si el contenido o formato visual cambió externamente
function buildParagraphsSignature(
  paragraphs: RichTextParagraph[],
  defaultAlign: TextAlign,
  listStyle: string,
  autoWidth: boolean
): string {
  return JSON.stringify({ paragraphs, defaultAlign, listStyle, autoWidth });
}

// Verifica de forma segura si un nodo pertenece al contenedor activo
function isNodeInsideContainer(container: HTMLElement | null, node: Node | null): boolean {
  if (!container || !node) return false;
  try {
    return container === node || container.contains(node);
  } catch {
    return false;
  }
}

// Limpia el subrayado nativo de CSS Custom Highlight API sin tocar el DOM editable
function clearCssSpellHighlight(): void {
  try {
    const cssObj =
      typeof CSS !== 'undefined'
        ? (CSS as unknown as { highlights?: Map<string, unknown> })
        : null;
    cssObj?.highlights?.delete(SPELL_HIGHLIGHT_NAME);
  } catch {
    // Ignorar si la API no existe
  }
}

// Lee nodos de texto dentro del DOM del editor y construye Ranges sobre palabras mal escritas sin modificar el DOM
function collectSpellcheckRangesFromDom(
  container: HTMLElement,
  lang: SpellcheckLanguage
): MisspelledDomEntry[] {
  const entries: MisspelledDomEntry[] = [];
  const children = Array.from(container.childNodes);
  const blockNodes: HTMLElement[] = [];

  for (const ch of children) {
    if (ch.nodeType === 1) {
      const el = ch as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (el.hasAttribute('data-rt-p') || tag === 'DIV' || tag === 'P') {
        blockNodes.push(el);
      }
    }
  }

  const blocks = blockNodes.length > 0 ? blockNodes : [container];
  let flatCursor = 0;

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const blk = blocks[bIdx];
    const textSegments: { node: Text; start: number; end: number }[] = [];
    let blkText = '';

    const walkText = (node: Node) => {
      if (node.nodeType === 3) {
        const raw = node.textContent || '';
        const cleaned = raw.replace(/\u200B/g, '').replace(/\u00a0/g, ' ');
        if (raw.length > 0) {
          textSegments.push({
            node: node as Text,
            start: blkText.length,
            end: blkText.length + cleaned.length,
          });
          blkText += cleaned;
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as HTMLElement;
      if (el.getAttribute('data-rt-br') === '1') return;
      if (el.getAttribute('data-rt-math') === '1') {
        blkText += INLINE_MATH_PLACEHOLDER;
        return;
      }
      for (let i = 0; i < el.childNodes.length; i++) {
        walkText(el.childNodes[i]);
      }
    };

    walkText(blk);

    if (blkText.length > 0) {
      const misspelled = findMisspelledTokens(blkText, lang);
      for (const tk of misspelled) {
        let startNode: Text | null = null;
        let startOffset = 0;
        let endNode: Text | null = null;
        let endOffset = 0;

        for (const seg of textSegments) {
          if (!startNode && tk.start >= seg.start && tk.start < seg.end) {
            startNode = seg.node;
            startOffset = tk.start - seg.start;
          }
          if (tk.end > seg.start && tk.end <= seg.end) {
            endNode = seg.node;
            endOffset = tk.end - seg.start;
            break;
          }
        }

        if (startNode && endNode) {
          try {
            const range = document.createRange();
            const safeStart = Math.min(startOffset, (startNode.textContent || '').length);
            const safeEnd = Math.min(endOffset, (endNode.textContent || '').length);
            range.setStart(startNode, safeStart);
            range.setEnd(endNode, safeEnd);
            if (!range.collapsed) {
              entries.push({
                word: tk.word,
                start: flatCursor + tk.start,
                end: flatCursor + tk.end,
                range,
              });
            }
          } catch {
            // Omitir rango transitorio inválido
          }
        }
      }
    }

    flatCursor += blkText.length + 1; // +1 por salto de línea entre párrafos
  }

  return entries;
}

// Lee el estilo de un elemento inline del DOM (soporta spans propios y etiquetas creadas por el navegador)
function readStyleFromElement(
  el: HTMLElement,
  parentStyle: ResolvedTextRunStyle
): ResolvedTextRunStyle {
  const tag = el.tagName.toUpperCase();
  const dataBold = el.getAttribute('data-bold');
  const dataItalic = el.getAttribute('data-italic');
  const dataUnderline = el.getAttribute('data-underline');
  const dataSize = el.getAttribute('data-font-size');
  const dataColor = el.getAttribute('data-color');
  const dataFont = el.getAttribute('data-font-family');

  let bold =
    dataBold !== null
      ? dataBold === '1'
      : parentStyle.bold || tag === 'B' || tag === 'STRONG';
  let italic =
    dataItalic !== null
      ? dataItalic === '1'
      : parentStyle.italic || tag === 'I' || tag === 'EM';
  let underline =
    dataUnderline !== null
      ? dataUnderline === '1'
      : parentStyle.underline || tag === 'U' || tag === 'INS';

  if (dataBold === null && el.style.fontWeight) {
    const fw = el.style.fontWeight.toLowerCase();
    const n = Number.parseInt(fw, 10);
    if (fw === 'bold' || (!Number.isNaN(n) && n >= 600)) bold = true;
    else if (fw === 'normal' || (!Number.isNaN(n) && n < 500)) bold = false;
  }
  if (dataItalic === null && el.style.fontStyle) {
    italic = el.style.fontStyle === 'italic' || el.style.fontStyle === 'oblique';
  }
  if (dataUnderline === null && el.style.textDecoration) {
    underline = el.style.textDecoration.includes('underline');
  }

  const fontSize =
    dataSize !== null
      ? sanitizeStoredFontSize(Number(dataSize), parentStyle.fontSize)
      : el.style.fontSize
      ? sanitizeStoredFontSize(Number.parseFloat(el.style.fontSize), parentStyle.fontSize)
      : parentStyle.fontSize;

  const color =
    dataColor && dataColor.trim()
      ? dataColor.trim()
      : parentStyle.color;

  const fontFamily =
    dataFont && dataFont.trim()
      ? (dataFont as TextFontFamily)
      : parentStyle.fontFamily;

  return resolveRunStyle(
    { bold, italic, underline, fontSize, color, fontFamily },
    parentStyle
  );
}

// Lee párrafos y tramos directamente del DOM no controlado sin perder estilo ni alineación
function readParagraphsFromEditableDom(
  container: HTMLElement,
  defaults: ResolvedTextRunStyle,
  defaultAlign: TextAlign
): RichTextParagraph[] {
  const safeDefaults = resolveRunStyle(defaults, defaults);
  const safeDefaultAlign = normalizeTextAlign(defaultAlign, 'left');
  const blockNodes: HTMLElement[] = [];
  let looseNodes: Node[] = [];

  const collectRunsFromNode = (
    node: Node,
    inherited: ResolvedTextRunStyle,
    out: TextRun[]
  ) => {
    if (node.nodeType === 3) {
      const txt = (node.textContent || '')
        .replace(/\u200B/g, '')
        .replace(/\u00a0/g, ' ');
      if (txt.length > 0) {
        out.push({ text: txt, ...inherited });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') return;

    if (el.getAttribute('data-rt-math') === '1') {
      const nextStyle = readStyleFromElement(el, inherited);
      const latex = el.getAttribute('data-latex') ?? '';
      const displayMode = el.getAttribute('data-display') === '1';
      out.push({
        text: INLINE_MATH_PLACEHOLDER,
        ...nextStyle,
        math: { latex, ...(displayMode ? { displayMode: true } : {}) },
      });
      return;
    }

    const nextStyle = readStyleFromElement(el, inherited);
    for (let i = 0; i < el.childNodes.length; i++) {
      collectRunsFromNode(el.childNodes[i], nextStyle, out);
    }
  };

  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i];
    if (child.nodeType === 1) {
      const el = child as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (el.hasAttribute('data-rt-p') || tag === 'DIV' || tag === 'P') {
        if (looseNodes.length > 0) {
          const wrapper = document.createElement('div');
          looseNodes.forEach((n) => wrapper.appendChild(n.cloneNode(true)));
          blockNodes.push(wrapper);
          looseNodes = [];
        }
        blockNodes.push(el);
        continue;
      }
    }
    looseNodes.push(child);
  }

  const parsed: RichTextParagraph[] = [];

  for (const block of blockNodes) {
    const alignAttr =
      block.getAttribute('data-rt-align') || block.style.textAlign || safeDefaultAlign;
    const align = normalizeTextAlign(alignAttr, safeDefaultAlign);
    const runs: TextRun[] = [];
    collectRunsFromNode(block, safeDefaults, runs);
    if (runs.length === 0) {
      const firstSpan = block.querySelector('[data-rt-r]') as HTMLElement | null;
      const emptyStyle = firstSpan
        ? readStyleFromElement(firstSpan, safeDefaults)
        : safeDefaults;
      runs.push({ text: '', ...emptyStyle });
    }
    parsed.push({ align, runs });
  }

  if (looseNodes.length > 0) {
    const runs: TextRun[] = [];
    for (const n of looseNodes) {
      collectRunsFromNode(n, safeDefaults, runs);
    }
    parsed.push({
      align: safeDefaultAlign,
      runs: runs.length > 0 ? runs : [{ text: '', ...safeDefaults }],
    });
  }

  return normalizeParagraphs(parsed, safeDefaults, safeDefaultAlign);
}

// Mide la longitud lógica en el modelo de un nodo DOM (tratando cada ecuación embebida como 1 carácter atómico)
function measureDomNodeLength(node: Node): number {
  if (node.nodeType === 3) {
    return (node.textContent || '').replace(/\u200B/g, '').replace(/\u00a0/g, ' ').length;
  }
  if (node.nodeType !== 1) return 0;
  const el = node as HTMLElement;
  if (el.getAttribute('data-rt-br') === '1') return 0;
  if (el.getAttribute('data-rt-math') === '1') return 1;
  let sum = 0;
  for (let i = 0; i < el.childNodes.length; i++) {
    sum += measureDomNodeLength(el.childNodes[i]);
  }
  return sum;
}

function measureOffsetBeforePoint(
  root: Node,
  targetNode: Node,
  targetOffset: number
): { found: boolean; count: number } {
  if (root === targetNode) {
    if (root.nodeType === 3) {
      const sliced = (root.textContent || '')
        .slice(0, targetOffset)
        .replace(/\u200B/g, '')
        .replace(/\u00a0/g, ' ');
      return { found: true, count: sliced.length };
    }
    if (root.nodeType === 1 && (root as HTMLElement).getAttribute('data-rt-math') === '1') {
      return { found: true, count: targetOffset > 0 ? 1 : 0 };
    }
    let acc = 0;
    const limit = Math.min(targetOffset, root.childNodes.length);
    for (let i = 0; i < limit; i++) {
      acc += measureDomNodeLength(root.childNodes[i]);
    }
    return { found: true, count: acc };
  }
  if (root.nodeType === 1) {
    const el = root as HTMLElement;
    if (el.getAttribute('data-rt-br') === '1') {
      return { found: el.contains(targetNode), count: 0 };
    }
    if (el.getAttribute('data-rt-math') === '1') {
      if (el.contains(targetNode)) {
        return { found: true, count: 1 };
      }
      return { found: false, count: 1 };
    }
  }
  let acc = 0;
  for (let i = 0; i < root.childNodes.length; i++) {
    const res = measureOffsetBeforePoint(root.childNodes[i], targetNode, targetOffset);
    acc += res.count;
    if (res.found) return { found: true, count: acc };
  }
  return { found: false, count: acc };
}

// Lee el rango lineal [start, end] de la selección de forma segura (nunca lanza aunque rangeCount sea 0 o esté fuera)
function readDomSelectionRange(
  container: HTMLElement | null,
  fallbackParagraphs: RichTextParagraph[]
): TextSelectionRange | null {
  try {
    if (!container || typeof window === 'undefined' || !window.getSelection) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (!range) return null;

    const anchorNode = sel.anchorNode || range.startContainer;
    const focusNode = sel.focusNode || range.endContainer;
    if (
      !isNodeInsideContainer(container, anchorNode) ||
      !isNodeInsideContainer(container, focusNode)
    ) {
      return null;
    }

    const getOffsetForPoint = (targetNode: Node, targetOffset: number): number => {
      const children = Array.from(container.childNodes);
      if (targetNode === container) {
        let acc = 0;
        const limit = Math.min(targetOffset, children.length);
        for (let i = 0; i < limit; i++) {
          acc += measureDomNodeLength(children[i]) + (i < limit - 1 ? 1 : 0);
        }
        if (limit > 0 && limit < children.length) acc += 1;
        return acc;
      }

      let total = 0;
      const pBlocks = Array.from(
        container.querySelectorAll(':scope > [data-rt-p], :scope > div, :scope > p')
      );
      const activeBlocks = pBlocks.length > 0 ? pBlocks : [container];

      for (let i = 0; i < activeBlocks.length; i++) {
        const blk = activeBlocks[i];
        if (i > 0) total += 1;
        if (blk === targetNode || blk.contains(targetNode)) {
          return total + measureOffsetBeforePoint(blk, targetNode, targetOffset).count;
        }
        total += measureDomNodeLength(blk);
      }

      const fallbackLen = paragraphsToPlainText(fallbackParagraphs).length;
      return Math.min(total, fallbackLen);
    };

    const a = getOffsetForPoint(anchorNode!, sel.anchorOffset);
    const f = getOffsetForPoint(focusNode!, sel.focusOffset);
    return { start: Math.min(a, f), end: Math.max(a, f) };
  } catch {
    return null;
  }
}

// Restaura la selección del navegador a partir de offsets lineales [start, end] de forma segura
function writeDomSelectionRange(
  container: HTMLElement | null,
  paragraphs: RichTextParagraph[],
  start: number,
  end: number
): void {
  try {
    if (!container || typeof window === 'undefined' || !window.getSelection) return;
    const sel = window.getSelection();
    if (!sel) return;

    const findPoint = (flatOffset: number): { node: Node; offset: number } | null => {
      const pos = flatOffsetToParagraphPos(paragraphs, flatOffset);
      const pEl = container.querySelector(`[data-rt-p="${pos.paragraphIndex}"]`);
      if (!pEl) return null;

      const spans = Array.from(pEl.querySelectorAll(':scope > [data-rt-r]')) as HTMLElement[];
      if (spans.length === 0) return { node: pEl, offset: 0 };

      let acc = 0;
      for (let sIdx = 0; sIdx < spans.length; sIdx++) {
        const sp = spans[sIdx];
        if (sp.getAttribute('data-rt-math') === '1') {
          if (pos.localOffset <= acc) {
            return { node: pEl, offset: sIdx };
          }
          if (pos.localOffset === acc + 1) {
            return { node: pEl, offset: sIdx + 1 };
          }
          acc += 1;
          continue;
        }
        const firstChild = sp.firstChild;
        if (firstChild && firstChild.nodeType === 3) {
          const len = (firstChild.textContent || '').length;
          if (pos.localOffset <= acc + len) {
            return { node: firstChild, offset: Math.max(0, pos.localOffset - acc) };
          }
          acc += len;
        } else if (pos.localOffset <= acc) {
          return { node: sp, offset: 0 };
        }
      }

      const lastSpan = spans[spans.length - 1];
      if (lastSpan?.getAttribute('data-rt-math') === '1') {
        return { node: pEl, offset: spans.length };
      }
      if (lastSpan?.firstChild && lastSpan.firstChild.nodeType === 3) {
        return {
          node: lastSpan.firstChild,
          offset: (lastSpan.firstChild.textContent || '').length,
        };
      }
      return lastSpan ? { node: lastSpan, offset: 0 } : null;
    };

    const sPt = findPoint(Math.min(start, end));
    const ePt = findPoint(Math.max(start, end));
    if (!sPt || !ePt) return;

    const range = document.createRange();
    range.setStart(sPt.node, sPt.offset);
    range.setEnd(ePt.node, ePt.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // Ignorar error transitorio si el nodo fue reemplazado
  }
}

// Renderiza el HTML KaTeX de un tramo matemático (estático o interactivo con cursor vivo)
function renderInlineMathSpanHtml(
  latex: string,
  isBlockMath: boolean,
  activeCursor: MathCursor | null
): string {
  if (activeCursor) {
    return renderInteractiveEquationHtml(latex || '\\square', activeCursor, isBlockMath);
  }
  try {
    return (
      renderKatexToStringLazy(latex || '\\square', {
        displayMode: isBlockMath,
        throwOnError: false,
        strict: false,
        trust: false,
      }) ?? renderLatexFallbackHtml(latex)
    );
  } catch {
    return renderLatexFallbackHtml(latex);
  }
}

// Sincroniza imperativamente el DOM interno del contentEditable solo en montaje o comandos externos
function syncEditableDom(
  container: HTMLElement,
  paragraphs: RichTextParagraph[],
  defaults: ResolvedTextRunStyle,
  defaultAlign: TextAlign,
  listStyle: 'none' | 'bullet' | 'numbered',
  autoWidth: boolean,
  resolveColor?: (c: string) => string,
  activeInlineMath?: ActiveInlineEquationSession | null
): void {
  const mapColor = (c: string) => (resolveColor ? resolveColor(c) : c);
  const frag = document.createDocumentFragment();
  let flatOffset = 0;

  paragraphs.forEach((p, pIdx) => {
    if (pIdx > 0) flatOffset += 1;
    const pDiv = document.createElement('div');
    pDiv.setAttribute('data-rt-p', String(pIdx));
    const storedAlign = normalizeTextAlign(p.align, defaultAlign);
    pDiv.setAttribute('data-rt-align', storedAlign);
    const visualAlign: TextAlign =
      autoWidth && storedAlign === 'justify' ? 'left' : storedAlign;

    const runs = Array.isArray(p.runs) && p.runs.length > 0 ? p.runs : [{ text: '' }];
    const isEmptyLine =
      runs.length === 1 && runs[0].text.length === 0 && !isMathRun(runs[0]);
    const firstStyle = resolveRunStyle(runs[0], defaults);

    pDiv.style.textAlign = visualAlign;
    pDiv.style.textAlignLast = visualAlign === 'justify' ? 'left' : '';
    pDiv.style.minHeight = '1.35em';

    // V1.11.8-12: Iguala tipografía, tamaño y color del prefijo de lista con RichTextViewer para evitar saltos visuales
    if (listStyle === 'bullet') {
      pDiv.setAttribute('data-list-prefix', '• ');
      pDiv.className = 'before:content-[attr(data-list-prefix)] before:select-none';
      pDiv.style.fontFamily = getTextFontCss(firstStyle.fontFamily);
      pDiv.style.fontSize = `${firstStyle.fontSize}px`;
      pDiv.style.color = mapColor(firstStyle.color);
    } else if (listStyle === 'numbered') {
      pDiv.setAttribute('data-list-prefix', `${pIdx + 1}. `);
      pDiv.className = 'before:content-[attr(data-list-prefix)] before:select-none';
      pDiv.style.fontFamily = getTextFontCss(firstStyle.fontFamily);
      pDiv.style.fontSize = `${firstStyle.fontSize}px`;
      pDiv.style.color = mapColor(firstStyle.color);
    }

    runs.forEach((run, rIdx) => {
      const span = document.createElement('span');
      span.setAttribute('data-rt-r', String(rIdx));
      const st = resolveRunStyle(run, defaults);

      span.setAttribute('data-bold', st.bold ? '1' : '0');
      span.setAttribute('data-italic', st.italic ? '1' : '0');
      span.setAttribute('data-underline', st.underline ? '1' : '0');
      span.setAttribute('data-font-size', String(st.fontSize));
      span.setAttribute('data-color', st.color);
      span.setAttribute('data-font-family', st.fontFamily);

      span.style.fontFamily = getTextFontCss(st.fontFamily);
      span.style.fontSize = `${st.fontSize}px`;
      span.style.fontWeight = st.bold ? '700' : '400';
      span.style.fontStyle = st.italic ? 'italic' : 'normal';
      span.style.textDecoration = st.underline ? 'underline' : 'none';
      span.style.color = mapColor(st.color);

      if (isMathRun(run) && run.math) {
        const isBlockMath = Boolean(run.math.displayMode);
        const isActiveInline = Boolean(
          activeInlineMath && flatOffset === activeInlineMath.selectionRange.start
        );
        span.setAttribute('data-rt-math', '1');
        span.setAttribute('data-latex', run.math.latex);
        span.setAttribute('data-display', isBlockMath ? '1' : '0');
        span.setAttribute('contenteditable', 'false');
        if (isActiveInline) {
          span.setAttribute('data-rt-active-math', '1');
        }
        span.title = isActiveInline
          ? 'Escriba directamente para editar (Esc para terminar)'
          : 'Clic para editar ecuación';
        span.className = `katex-canvas-node rt-math-chip cursor-pointer select-none ${
          isActiveInline ? 'rt-math-chip-active ' : ''
        }${
          isBlockMath ? 'flex justify-center w-full my-1' : 'inline-flex align-middle mx-0.5'
        }`;
        span.innerHTML = renderInlineMathSpanHtml(
          run.math.latex,
          isBlockMath,
          isActiveInline && activeInlineMath ? activeInlineMath.cursor : null
        );
        flatOffset += 1;
      } else if (isEmptyLine) {
        const br = document.createElement('br');
        br.setAttribute('data-rt-br', '1');
        span.appendChild(br);
      } else {
        span.appendChild(document.createTextNode(run.text));
        flatOffset += run.text.length;
      }
      pDiv.appendChild(span);
    });

    frag.appendChild(pDiv);
  });

  container.replaceChildren(frag);
}

// Editor reutilizable de texto enriquecido con ajuste automático/fijo y corrector ortográfico no intrusivo
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  (
    {
      paragraphs,
      defaults,
      defaultAlign,
      listStyle = 'none',
      backgroundColor = 'transparent',
      autoWidth = false,
      maxAutoWidth = TEXT_AUTO_MAX_WIDTH,
      lang = 'es',
      spellcheckEnabled = true,
      showToolbar = true,
      showListControls = true,
      showDoneButton = true,
      autoFocus = true,
      placeholderDefaultsToSelectAll = ['Escribe aquí...', 'Nueva nota...', 'Cuadro de texto'],
      resolveColor,
      onChangeParagraphs,
      onPushParagraphsSnapshot,
      onChangeListStyle,
      onChangeLang,
      onSelectionSummaryChange,
      onAutoHeightChange,
      onAutoSizeChange,
      onUndo,
      onRedo,
      onFinish,
      onRequestEquationEditor,
      onActiveInlineEquationChange,
      compactCell = false,
      onTableCellKeyDown,
      onTablePaste,
      className = '',
    },
    ref
  ) => {
    const katexReady = useKatexReady();
    const normalizedParagraphs = useMemo(
      () => normalizarContenidoTexto(paragraphs, defaults, defaultAlign),
      [paragraphs, defaults, defaultAlign]
    );
    const plainText = useMemo(
      () => paragraphsToPlainText(normalizedParagraphs),
      [normalizedParagraphs]
    );
    const propSignature = useMemo(
      () =>
        buildParagraphsSignature(
          normalizedParagraphs,
          defaultAlign,
          listStyle,
          autoWidth
        ) + `|kx:${katexReady ? 1 : 0}`,
      [normalizedParagraphs, defaultAlign, listStyle, autoWidth, katexReady]
    );

    const defaultsRef = useRef(defaults);
    defaultsRef.current = defaults;
    const defaultAlignRef = useRef(defaultAlign);
    defaultAlignRef.current = defaultAlign;
    const resolveColorRef = useRef(resolveColor);
    resolveColorRef.current = resolveColor;
    const onChangeParagraphsRef = useRef(onChangeParagraphs);
    onChangeParagraphsRef.current = onChangeParagraphs;
    const onSelectionSummaryChangeRef = useRef(onSelectionSummaryChange);
    onSelectionSummaryChangeRef.current = onSelectionSummaryChange;
    const onAutoHeightChangeRef = useRef(onAutoHeightChange);
    onAutoHeightChangeRef.current = onAutoHeightChange;
    const onAutoSizeChangeRef = useRef(onAutoSizeChange);
    onAutoSizeChangeRef.current = onAutoSizeChange;
    const onActiveInlineEquationChangeRef = useRef(onActiveInlineEquationChange);
    onActiveInlineEquationChangeRef.current = onActiveInlineEquationChange;

    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const editableRef = useRef<HTMLDivElement | null>(null);
    const inlineEqInputRef = useRef<HTMLInputElement | null>(null);
    const inlineEqComposingRef = useRef(false);
    const composingRef = useRef(false);
    const domInitializedRef = useRef(false);
    const lastDomSignatureRef = useRef<string>('');
    const pendingExternalSyncRef = useRef(false);
    const inputDebounceRef = useRef<number | null>(null);
    const spellDebounceRef = useRef<number | null>(null);
    const dirtyFromInputRef = useRef(false);

    const pendingStyleRef = useRef<Partial<TextRunStyle> | null>(null);
    const lastSelectionRef = useRef<TextSelectionRange>({
      start: plainText.length,
      end: plainText.length,
    });
    const desiredSelectionRef = useRef<TextSelectionRange | null>(null);
    const restoreFocusAfterSyncRef = useRef(false);
    const typingBurstRef = useRef(false);
    const initializedFocusRef = useRef(false);
    const paragraphsRef = useRef(normalizedParagraphs);
    paragraphsRef.current = normalizedParagraphs;
    const [activeInlineMath, setActiveInlineMath] =
      useState<ActiveInlineEquationSession | null>(null);
    const activeInlineMathRef = useRef<ActiveInlineEquationSession | null>(null);
    activeInlineMathRef.current = activeInlineMath;
    const colorPreviewSnapshotRef = useRef<RichTextParagraph[] | null>(null);

    // Estado del corrector ortográfico (completamente aislado en el editor)
    const misspelledEntriesRef = useRef<MisspelledDomEntry[]>([]);
    const [fallbackWaveRects, setFallbackWaveRects] = useState<FallbackWaveRect[]>([]);
    const [dictStatus, setDictStatus] = useState<DictionaryStatus>(() =>
      getDictionaryStatus(lang)
    );
    const [spellMenu, setSpellMenu] = useState<SpellcheckContextMenuState | null>(null);

    const lastMeasuredRef = useRef<{ width?: number; height: number } | null>(null);

    // OPT: 1.6 — Reporta ancho (en modo automático) y alto evitando emitir mediciones duplicadas
    const notifyMeasuredSize = useCallback(
      (el: HTMLElement | null) => {
        if (!el) return;
        try {
          const measuredHeight = Math.max(32, Math.ceil(el.scrollHeight + 4));
          const measuredWidth = autoWidth
            ? Math.max(64, Math.min(maxAutoWidth, Math.ceil(el.offsetWidth)))
            : undefined;
          const prev = lastMeasuredRef.current;
          if (prev && prev.height === measuredHeight && prev.width === measuredWidth) {
            return;
          }
          lastMeasuredRef.current = { width: measuredWidth, height: measuredHeight };
          onAutoSizeChangeRef.current?.({
            width: measuredWidth,
            height: measuredHeight,
          });
          onAutoHeightChangeRef.current?.(measuredHeight);
        } catch {
          // Nunca fallar al medir tamaño del cuadro
        }
      },
      [autoWidth, maxAutoWidth]
    );

    const computeSummary = useCallback(
      (sel: TextSelectionRange, pending: Partial<TextRunStyle> | null): SelectionStyleSummary =>
        getSelectionStyleSummary(
          paragraphsRef.current,
          sel,
          pending,
          defaultsRef.current
        ),
      []
    );

    const initialSummary = useMemo(
      () =>
        getSelectionStyleSummary(
          normalizedParagraphs,
          lastSelectionRef.current,
          pendingStyleRef.current,
          defaults
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );
    const [summary, setSummary] = useState<SelectionStyleSummary>(initialSummary);
    const lastEmittedSummaryRef = useRef<SelectionStyleSummary>(initialSummary);

    const refreshSummary = useCallback((sourceParagraphs?: RichTextParagraph[]) => {
      const next = getSelectionStyleSummary(
        sourceParagraphs ?? paragraphsRef.current,
        lastSelectionRef.current,
        pendingStyleRef.current,
        defaultsRef.current
      );
      if (summariesEqual(lastEmittedSummaryRef.current, next)) {
        return;
      }
      lastEmittedSummaryRef.current = next;
      setSummary(next);
      onSelectionSummaryChangeRef.current?.(next);
    }, []);

    // Ejecuta la comprobación ortográfica no intrusiva sobre el DOM actual del cuadro activo
    const runSpellcheckNow = useCallback(() => {
      try {
        if (!spellcheckEnabled || composingRef.current) {
          misspelledEntriesRef.current = [];
          clearCssSpellHighlight();
          setFallbackWaveRects([]);
          return;
        }
        const el = editableRef.current;
        const wrap = wrapperRef.current;
        if (!el) return;

        const entries = collectSpellcheckRangesFromDom(el, lang);
        misspelledEntriesRef.current = entries;

        if (entries.length === 0) {
          clearCssSpellHighlight();
          setFallbackWaveRects([]);
          return;
        }

        // Intenta primero CSS Custom Highlight API para cero sobrecarga de DOM
        let appliedNative = false;
        try {
          const win = window as unknown as {
            Highlight?: new (...ranges: Range[]) => unknown;
          };
          const cssObj =
            typeof CSS !== 'undefined'
              ? (CSS as unknown as { highlights?: Map<string, unknown> })
              : null;
          if (cssObj?.highlights && typeof win.Highlight === 'function') {
            const hl = new win.Highlight(...entries.map((e) => e.range));
            cssObj.highlights.set(SPELL_HIGHLIGHT_NAME, hl);
            appliedNative = true;
            setFallbackWaveRects([]);
          }
        } catch {
          appliedNative = false;
        }

        // Respaldo mediante capa superpuesta en coordenadas del mundo si no existe CSS.highlights
        if (!appliedNative && wrap) {
          clearCssSpellHighlight();
          const wrapRect = wrap.getBoundingClientRect();
          const scaleX =
            wrapRect.width > 0 ? wrapRect.width / Math.max(1, wrap.offsetWidth) : 1;
          const scaleY =
            wrapRect.height > 0 ? wrapRect.height / Math.max(1, wrap.offsetHeight) : 1;
          const rects: FallbackWaveRect[] = [];
          for (const entry of entries) {
            const clientRects = entry.range.getClientRects();
            for (let i = 0; i < clientRects.length; i++) {
              const r = clientRects[i];
              if (r.width < 1 || r.height < 1) continue;
              rects.push({
                left: (r.left - wrapRect.left) / scaleX,
                top: (r.bottom - wrapRect.top) / scaleY - 2,
                width: r.width / scaleX,
              });
            }
          }
          setFallbackWaveRects(rects);
        }
      } catch {
        // Si algo falla en el motor o resaltado, se desactiva en silencio manteniendo el editor intacto
        misspelledEntriesRef.current = [];
        clearCssSpellHighlight();
        setFallbackWaveRects([]);
      }
    }, [lang, spellcheckEnabled]);

    const scheduleSpellcheck = useCallback(
      (delayMs = 300) => {
        if (spellDebounceRef.current !== null) {
          window.clearTimeout(spellDebounceRef.current);
          spellDebounceRef.current = null;
        }
        if (!spellcheckEnabled) {
          clearCssSpellHighlight();
          setFallbackWaveRects([]);
          misspelledEntriesRef.current = [];
          return;
        }
        spellDebounceRef.current = window.setTimeout(() => {
          spellDebounceRef.current = null;
          runSpellcheckNow();
        }, delayMs);
      },
      [runSpellcheckNow, spellcheckEnabled]
    );

    // Carga diferida del diccionario Hunspell solo cuando el editor está activo y habilitado
    useEffect(() => {
      if (!spellcheckEnabled) {
        clearCssSpellHighlight();
        setFallbackWaveRects([]);
        misspelledEntriesRef.current = [];
        return;
      }
      setDictStatus(getDictionaryStatus(lang));
      let active = true;
      const unsubStatus = subscribeDictionaryStatus((changedLang, nextStatus) => {
        if (!active || changedLang !== lang) return;
        setDictStatus(nextStatus);
        if (nextStatus === 'ready' || nextStatus === 'fallback') {
          scheduleSpellcheck(60);
        }
      });
      const unsubPersonal = subscribePersonalDictionary(() => {
        if (active) scheduleSpellcheck(40);
      });

      void ensureDictionaryLoaded(lang).then((st) => {
        if (active) {
          setDictStatus(st);
          scheduleSpellcheck(60);
        }
      });

      return () => {
        active = false;
        unsubStatus();
        unsubPersonal();
      };
    }, [lang, scheduleSpellcheck, spellcheckEnabled]);

    // Limpia temporizadores, sesión matemática viva y subrayados visuales al salir de edición o desmontar
    useEffect(() => {
      return () => {
        if (inputDebounceRef.current !== null) {
          window.clearTimeout(inputDebounceRef.current);
          inputDebounceRef.current = null;
        }
        if (spellDebounceRef.current !== null) {
          window.clearTimeout(spellDebounceRef.current);
          spellDebounceRef.current = null;
        }
        onActiveInlineEquationChangeRef.current?.(null);
        clearCssSpellHighlight();
      };
    }, []);

    // Lee el DOM no controlado y lo sincroniza al estado de React sin reescribir el DOM del usuario
    const flushDomInput = useCallback(
      (forceCommit = false) => {
        if (inputDebounceRef.current !== null) {
          window.clearTimeout(inputDebounceRef.current);
          inputDebounceRef.current = null;
        }
        const el = editableRef.current;
        if (!el || (!dirtyFromInputRef.current && !forceCommit)) {
          return paragraphsRef.current;
        }
        dirtyFromInputRef.current = false;

        const domParagraphs = readParagraphsFromEditableDom(
          el,
          defaultsRef.current,
          defaultAlignRef.current
        );
        const domSig = buildParagraphsSignature(
          domParagraphs,
          defaultAlignRef.current,
          listStyle,
          autoWidth
        );
        const curSig = buildParagraphsSignature(
          paragraphsRef.current,
          defaultAlignRef.current,
          listStyle,
          autoWidth
        );

        const domSel = readDomSelectionRange(el, domParagraphs);
        if (domSel) {
          lastSelectionRef.current = domSel;
        }

        if (domSig !== curSig) {
          paragraphsRef.current = domParagraphs;
          lastDomSignatureRef.current = domSig;
          const recordHistory = !typingBurstRef.current;
          typingBurstRef.current = true;
          onChangeParagraphsRef.current(domParagraphs, recordHistory);
        }

        refreshSummary(domParagraphs);
        notifyMeasuredSize(el);
        return domParagraphs;
      },
      [autoWidth, listStyle, notifyMeasuredSize, refreshSummary]
    );

    // Selección inicial al montar el editor sobre un cuadro de texto
    useEffect(() => {
      if (!autoFocus || initializedFocusRef.current) return;
      initializedFocusRef.current = true;
      const len = plainText.length;
      const shouldSelectAll = placeholderDefaultsToSelectAll.includes(plainText);
      const initSel: TextSelectionRange = shouldSelectAll
        ? { start: 0, end: len }
        : { start: len, end: len };
      lastSelectionRef.current = initSel;
      desiredSelectionRef.current = initSel;
      restoreFocusAfterSyncRef.current = true;

      const raf = requestAnimationFrame(() => {
        const el = editableRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        writeDomSelectionRange(el, paragraphsRef.current, initSel.start, initSel.end);
        refreshSummary();
        scheduleSpellcheck(120);
      });
      return () => cancelAnimationFrame(raf);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sincroniza el DOM ÚNICAMENTE al montar o cuando llega un cambio externo (deshacer/rehacer o comando de formato)
    useLayoutEffect(() => {
      const el = editableRef.current;
      if (!el || composingRef.current) return;

      const isFocused = document.activeElement === el;
      const shouldSyncDom =
        !domInitializedRef.current ||
        (propSignature !== lastDomSignatureRef.current &&
          (!isFocused || pendingExternalSyncRef.current));

      if (shouldSyncDom) {
        syncEditableDom(
          el,
          normalizedParagraphs,
          defaultsRef.current,
          defaultAlign,
          listStyle,
          autoWidth,
          resolveColorRef.current,
          activeInlineMathRef.current
        );
        domInitializedRef.current = true;
        lastDomSignatureRef.current = propSignature;
        pendingExternalSyncRef.current = false;

        const maxLen = plainText.length;
        const targetSel = desiredSelectionRef.current;
        if (targetSel) {
          const clampedStart = Math.max(0, Math.min(maxLen, targetSel.start));
          const clampedEnd = Math.max(0, Math.min(maxLen, targetSel.end));
          lastSelectionRef.current = { start: clampedStart, end: clampedEnd };
          if (restoreFocusAfterSyncRef.current) {
            el.focus({ preventScroll: true });
          }
          if (document.activeElement === el || restoreFocusAfterSyncRef.current) {
            writeDomSelectionRange(el, normalizedParagraphs, clampedStart, clampedEnd);
          }
          desiredSelectionRef.current = null;
          restoreFocusAfterSyncRef.current = false;
        } else {
          lastSelectionRef.current = {
            start: Math.min(lastSelectionRef.current.start, maxLen),
            end: Math.min(lastSelectionRef.current.end, maxLen),
          };
          if (document.activeElement === el) {
            writeDomSelectionRange(
              el,
              normalizedParagraphs,
              lastSelectionRef.current.start,
              lastSelectionRef.current.end
            );
          }
        }
        scheduleSpellcheck(80);
      }

      refreshSummary(normalizedParagraphs);
      notifyMeasuredSize(el);
    }, [
      normalizedParagraphs,
      plainText,
      propSignature,
      defaultAlign,
      listStyle,
      autoWidth,
      notifyMeasuredSize,
      refreshSummary,
      scheduleSpellcheck,
    ]);

    // Sincroniza el cursor vivo de la ecuación activa dentro del DOM sin reconstruir todo el cuadro
    useLayoutEffect(() => {
      const el = editableRef.current;
      if (!el) return;
      const mathSpans = Array.from(el.querySelectorAll<HTMLElement>('[data-rt-math="1"]'));
      if (mathSpans.length === 0) return;

      const pBlocks = Array.from(
        el.querySelectorAll(':scope > [data-rt-p], :scope > div, :scope > p')
      );
      const activeBlocks = pBlocks.length > 0 ? pBlocks : [el];

      for (const span of mathSpans) {
        let flatStart = -1;
        let acc = 0;
        for (let i = 0; i < activeBlocks.length; i++) {
          if (i > 0) acc += 1;
          const blk = activeBlocks[i];
          if (blk.contains(span)) {
            flatStart = acc + measureOffsetBeforePoint(blk, span, 0).count;
            break;
          }
          acc += measureDomNodeLength(blk);
        }
        const isTarget = Boolean(
          activeInlineMath && flatStart === activeInlineMath.selectionRange.start
        );
        if (isTarget && activeInlineMath) {
          span.setAttribute('data-rt-active-math', '1');
          span.classList.add('rt-math-chip-active');
          span.title = 'Escriba directamente para editar (Esc para terminar)';
          span.innerHTML = renderInlineMathSpanHtml(
            activeInlineMath.latex,
            activeInlineMath.displayMode,
            activeInlineMath.cursor
          );
        } else if (span.getAttribute('data-rt-active-math') === '1') {
          span.removeAttribute('data-rt-active-math');
          span.classList.remove('rt-math-chip-active');
          span.title = 'Clic para editar ecuación';
          const latex = span.getAttribute('data-latex') || '\\square';
          const isBlockMath = span.getAttribute('data-display') === '1';
          span.innerHTML = renderInlineMathSpanHtml(latex, isBlockMath, null);
        }
      }
      notifyMeasuredSize(el);
    }, [activeInlineMath, katexReady, notifyMeasuredSize]);

    // Escucha cambios de selección nativos con validación segura dentro del editor
    useEffect(() => {
      const onSelectionChange = () => {
        if (composingRef.current) return;
        const el = editableRef.current;
        if (!el) return;
        const sel = readDomSelectionRange(el, paragraphsRef.current);
        if (!sel) return;

        const prev = lastSelectionRef.current;
        if (prev.start !== sel.start || prev.end !== sel.end) {
          pendingStyleRef.current = null;
          lastSelectionRef.current = sel;
          refreshSummary();
        }
      };

      document.addEventListener('selectionchange', onSelectionChange);
      return () => document.removeEventListener('selectionchange', onSelectionChange);
    }, [refreshSummary]);

    const captureCurrentSelection = useCallback(
      (overrideParagraphs?: RichTextParagraph[]): TextSelectionRange => {
        const el = editableRef.current;
        if (el) {
          const domSel = readDomSelectionRange(
            el,
            overrideParagraphs ?? paragraphsRef.current
          );
          if (domSel) {
            lastSelectionRef.current = domSel;
            return domSel;
          }
        }
        return lastSelectionRef.current;
      },
      []
    );

    const applyStyle = useCallback(
      (
        patch: Partial<TextRunStyle>,
        options?: { restoreFocus?: boolean; recordHistory?: boolean }
      ) => {
        const latestParagraphs = flushDomInput(false);
        const sel = captureCurrentSelection(latestParagraphs);
        const restoreFocus = options?.restoreFocus ?? true;
        const recordHistory = options?.recordHistory ?? true;

        if (sel.start === sel.end) {
          const base = getCaretRunStyle(latestParagraphs, sel.start, defaultsRef.current);
          pendingStyleRef.current = {
            ...base,
            ...(pendingStyleRef.current || {}),
            ...patch,
          };
          refreshSummary(latestParagraphs);
          if (restoreFocus) {
            const el = editableRef.current;
            if (el) {
              el.focus({ preventScroll: true });
              writeDomSelectionRange(el, latestParagraphs, sel.start, sel.end);
            }
          }
          return;
        }

        typingBurstRef.current = false;
        pendingStyleRef.current = null;
        const next = applyInlineStyleToRange(
          latestParagraphs,
          sel,
          patch,
          defaultsRef.current
        );
        pendingExternalSyncRef.current = true;
        desiredSelectionRef.current = { start: sel.start, end: sel.end };
        restoreFocusAfterSyncRef.current = restoreFocus;
        onChangeParagraphsRef.current(next, recordHistory);
      },
      [captureCurrentSelection, flushDomInput, refreshSummary]
    );

    const stepFontSize = useCallback(
      (delta: number, options?: { restoreFocus?: boolean }) => {
        const latestParagraphs = flushDomInput(false);
        const sel = captureCurrentSelection(latestParagraphs);
        const restoreFocus = options?.restoreFocus ?? true;

        if (sel.start === sel.end) {
          const base = getCaretRunStyle(latestParagraphs, sel.start, defaultsRef.current);
          const curSize = pendingStyleRef.current?.fontSize ?? base.fontSize;
          pendingStyleRef.current = {
            ...base,
            ...(pendingStyleRef.current || {}),
            fontSize: stepFontSizeValue(curSize, delta),
          };
          refreshSummary(latestParagraphs);
          if (restoreFocus) {
            const el = editableRef.current;
            if (el) {
              el.focus({ preventScroll: true });
              writeDomSelectionRange(el, latestParagraphs, sel.start, sel.end);
            }
          }
          return;
        }

        typingBurstRef.current = false;
        pendingStyleRef.current = null;
        const next = stepFontSizeInRange(
          latestParagraphs,
          sel,
          delta,
          defaultsRef.current
        );
        pendingExternalSyncRef.current = true;
        desiredSelectionRef.current = { start: sel.start, end: sel.end };
        restoreFocusAfterSyncRef.current = restoreFocus;
        onChangeParagraphsRef.current(next, true);
      },
      [captureCurrentSelection, flushDomInput, refreshSummary]
    );

    const applyAlign = useCallback(
      (align: TextAlign, options?: { restoreFocus?: boolean }) => {
        const latestParagraphs = flushDomInput(false);
        const sel = captureCurrentSelection(latestParagraphs);
        const restoreFocus = options?.restoreFocus ?? true;
        typingBurstRef.current = false;
        const next = applyParagraphAlignToRange(
          latestParagraphs,
          sel,
          align,
          defaultsRef.current
        );
        pendingExternalSyncRef.current = true;
        desiredSelectionRef.current = { start: sel.start, end: sel.end };
        restoreFocusAfterSyncRef.current = restoreFocus;
        onChangeParagraphsRef.current(next, true);
      },
      [captureCurrentSelection, flushDomInput]
    );

    const insertOrUpdateMath = useCallback(
      (
        math: TextRunMath,
        options?: {
          selectionRange?: TextSelectionRange;
          fontSize?: number;
          color?: string;
          restoreFocus?: boolean;
        }
      ) => {
        const latestParagraphs = flushDomInput(false);
        const sel = options?.selectionRange ?? captureCurrentSelection(latestParagraphs);
        const restoreFocus = options?.restoreFocus ?? true;
        const base = getCaretRunStyle(latestParagraphs, sel.start, defaultsRef.current);
        const activeStyle = resolveRunStyle(
          {
            ...base,
            ...(pendingStyleRef.current || {}),
            ...(options?.fontSize !== undefined ? { fontSize: options.fontSize } : {}),
            ...(options?.color ? { color: options.color } : {}),
          },
          defaultsRef.current
        );
        const safeMath = sanitizeRunMath(math);
        if (!safeMath) return;

        typingBurstRef.current = false;
        pendingStyleRef.current = null;
        const { paragraphs: next, caretOffset } = replaceRangeWithMathRun(
          latestParagraphs,
          sel,
          safeMath,
          activeStyle,
          defaultsRef.current
        );
        if (activeInlineMathRef.current) {
          const cur = activeInlineMathRef.current;
          const updatedSession: ActiveInlineEquationSession = {
            ...cur,
            ...(options?.fontSize !== undefined ? { fontSize: options.fontSize } : {}),
            ...(options?.color ? { color: options.color } : {}),
            latex: safeMath.latex,
            displayMode: Boolean(safeMath.displayMode),
            cursor: getInitialEditCursor(safeMath.latex),
          };
          activeInlineMathRef.current = updatedSession;
          setActiveInlineMath(updatedSession);
          onActiveInlineEquationChangeRef.current?.(updatedSession);
          pendingExternalSyncRef.current = true;
          desiredSelectionRef.current = { start: caretOffset, end: caretOffset };
          restoreFocusAfterSyncRef.current = false;
          onChangeParagraphsRef.current(next, true);
          if (restoreFocus) {
            requestAnimationFrame(() => {
              inlineEqInputRef.current?.focus({ preventScroll: true });
            });
          }
          return;
        }
        pendingExternalSyncRef.current = true;
        desiredSelectionRef.current = { start: caretOffset, end: caretOffset };
        restoreFocusAfterSyncRef.current = restoreFocus;
        onChangeParagraphsRef.current(next, true);
      },
      [captureCurrentSelection, flushDomInput]
    );

    const applyInlineEquationUpdate = useCallback(
      (
        nextSession: ActiveInlineEquationSession,
        recordHistory = false,
        syncParagraph = true
      ) => {
        activeInlineMathRef.current = nextSession;
        setActiveInlineMath(nextSession);
        onActiveInlineEquationChangeRef.current?.(nextSession);
        if (!syncParagraph) return;

        const base = getCaretRunStyle(
          paragraphsRef.current,
          nextSession.selectionRange.start,
          defaultsRef.current
        );
        const activeStyle = resolveRunStyle(
          {
            ...base,
            fontSize: nextSession.fontSize,
            color: nextSession.color,
          },
          defaultsRef.current
        );
        const safeMath: TextRunMath = {
          latex: nextSession.latex || '\\square',
          ...(nextSession.displayMode ? { displayMode: true } : {}),
        };
        const { paragraphs: next } = replaceRangeWithMathRun(
          paragraphsRef.current,
          nextSession.selectionRange,
          safeMath,
          activeStyle,
          defaultsRef.current
        );
        paragraphsRef.current = next;
        lastSelectionRef.current = nextSession.selectionRange;
        onChangeParagraphsRef.current(next, recordHistory);
      },
      []
    );

    const focusInlineEquationInput = useCallback(() => {
      inlineEqInputRef.current?.focus({ preventScroll: true });
    }, []);

    const finishInlineEquationEditing = useCallback(
      (restoreTextCaret = true) => {
        const cur = activeInlineMathRef.current;
        if (!cur) return;
        const endPos = cur.selectionRange.end;
        activeInlineMathRef.current = null;
        setActiveInlineMath(null);
        onActiveInlineEquationChangeRef.current?.(null);
        onChangeParagraphsRef.current(paragraphsRef.current, true);
        if (restoreTextCaret) {
          lastSelectionRef.current = { start: endPos, end: endPos };
          requestAnimationFrame(() => {
            const el = editableRef.current;
            if (!el) return;
            el.focus({ preventScroll: true });
            writeDomSelectionRange(el, paragraphsRef.current, endPos, endPos);
            refreshSummary();
          });
        }
      },
      [refreshSummary]
    );

    const insertInlineEquationSnippet = useCallback(
      (snippet: string) => {
        const cur = activeInlineMathRef.current;
        if (!cur) return;
        const next = applySnippetAtCursor(cur.latex, cur.cursor, snippet);
        applyInlineEquationUpdate(
          { ...cur, latex: next.latex, cursor: next.cursor },
          false,
          true
        );
        requestAnimationFrame(() => {
          inlineEqInputRef.current?.focus({ preventScroll: true });
        });
      },
      [applyInlineEquationUpdate]
    );

    const replaceInlineEquationLatex = useCallback(
      (latex: string) => {
        const cur = activeInlineMathRef.current;
        if (!cur) return;
        applyInlineEquationUpdate(
          {
            ...cur,
            latex: latex || '\\square',
            cursor: getInitialEditCursor(latex || '\\square'),
          },
          true,
          true
        );
        requestAnimationFrame(() => {
          inlineEqInputRef.current?.focus({ preventScroll: true });
        });
      },
      [applyInlineEquationUpdate]
    );

    const updateInlineEquationMeta = useCallback(
      (patch: { fontSize?: number; color?: string; displayMode?: boolean }) => {
        const cur = activeInlineMathRef.current;
        if (!cur) return;
        applyInlineEquationUpdate(
          {
            ...cur,
            ...(patch.fontSize !== undefined
              ? { fontSize: sanitizeStoredFontSize(patch.fontSize, cur.fontSize) }
              : {}),
            ...(patch.color ? { color: patch.color } : {}),
            ...(patch.displayMode !== undefined ? { displayMode: patch.displayMode } : {}),
          },
          true,
          true
        );
        requestAnimationFrame(() => {
          inlineEqInputRef.current?.focus({ preventScroll: true });
        });
      },
      [applyInlineEquationUpdate]
    );

    const jumpNextInlineEquationPlaceholder = useCallback(() => {
      const cur = activeInlineMathRef.current;
      if (!cur) return;
      const nextCursor = jumpToNextSlotCursor(cur.latex, cur.cursor, false);
      applyInlineEquationUpdate({ ...cur, cursor: nextCursor }, false, false);
      requestAnimationFrame(() => {
        inlineEqInputRef.current?.focus({ preventScroll: true });
      });
    }, [applyInlineEquationUpdate]);

    useImperativeHandle(
      ref,
      () => ({
        applyStyle,
        stepFontSize,
        applyAlign,
        insertOrUpdateMath,
        insertInlineEquationSnippet,
        replaceInlineEquationLatex,
        updateInlineEquationMeta,
        jumpNextInlineEquationPlaceholder,
        finishInlineEquationEditing,
        focusInlineEquationInput,
        getSelectionSummary: () =>
          computeSummary(lastSelectionRef.current, pendingStyleRef.current),
        getSelectionRange: () => lastSelectionRef.current,
        focus: () => {
          if (activeInlineMathRef.current && inlineEqInputRef.current) {
            inlineEqInputRef.current.focus({ preventScroll: true });
            return;
          }
          const el = editableRef.current;
          if (!el) return;
          el.focus({ preventScroll: true });
          writeDomSelectionRange(
            el,
            paragraphsRef.current,
            lastSelectionRef.current.start,
            lastSelectionRef.current.end
          );
        },
      }),
      [
        applyAlign,
        applyStyle,
        computeSummary,
        finishInlineEquationEditing,
        focusInlineEquationInput,
        insertInlineEquationSnippet,
        insertOrUpdateMath,
        jumpNextInlineEquationPlaceholder,
        replaceInlineEquationLatex,
        stepFontSize,
        updateInlineEquationMeta,
      ]
    );

    const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
      if (composingRef.current || !pendingStyleRef.current) return;
      const native = e.nativeEvent as InputEvent;
      if (
        (native.inputType === 'insertText' || native.inputType === 'insertReplacementText') &&
        typeof native.data === 'string' &&
        native.data.length > 0
      ) {
        e.preventDefault();
        const latestParagraphs = flushDomInput(false);
        const sel = captureCurrentSelection(latestParagraphs);
        const caretBase = getCaretRunStyle(latestParagraphs, sel.start, defaultsRef.current);
        const activeStyle = resolveRunStyle(
          { ...caretBase, ...(pendingStyleRef.current || {}) },
          defaultsRef.current
        );
        pendingStyleRef.current = null;

        const { paragraphs: next, caretOffset } = insertTextAtRange(
          latestParagraphs,
          sel,
          native.data,
          activeStyle,
          defaultsRef.current
        );
        pendingExternalSyncRef.current = true;
        desiredSelectionRef.current = { start: caretOffset, end: caretOffset };
        restoreFocusAfterSyncRef.current = true;
        const recordHistory = !typingBurstRef.current;
        typingBurstRef.current = true;
        onChangeParagraphsRef.current(next, recordHistory);
      }
    };

    const handleInput = () => {
      if (composingRef.current) return;
      dirtyFromInputRef.current = true;
      setSpellMenu(null);
      notifyMeasuredSize(editableRef.current);
      if (inputDebounceRef.current !== null) {
        window.clearTimeout(inputDebounceRef.current);
      }
      inputDebounceRef.current = window.setTimeout(() => {
        flushDomInput(false);
      }, 90);
      // Debounce de ~300 ms al terminar de escribir para no afectar el rendimiento de escritura
      scheduleSpellcheck(300);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (composingRef.current) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();

      if (ctrl && keyLower === 'b') {
        e.preventDefault();
        const nextBold = summary.bold === true ? false : true;
        applyStyle({ bold: nextBold }, { restoreFocus: true });
        return;
      }
      if (ctrl && keyLower === 'i') {
        e.preventDefault();
        const nextItalic = summary.italic === true ? false : true;
        applyStyle({ italic: nextItalic }, { restoreFocus: true });
        return;
      }
      if (ctrl && keyLower === 'u') {
        e.preventDefault();
        const nextUnderline = summary.underline === true ? false : true;
        applyStyle({ underline: nextUnderline }, { restoreFocus: true });
        return;
      }
      if (ctrl && keyLower === 'j') {
        e.preventDefault();
        applyAlign('justify', { restoreFocus: true });
        return;
      }
      if (ctrl && keyLower === 'z') {
        e.preventDefault();
        flushDomInput(false);
        typingBurstRef.current = false;
        pendingExternalSyncRef.current = true;
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      if (ctrl && keyLower === 'y') {
        e.preventDefault();
        flushDomInput(false);
        typingBurstRef.current = false;
        pendingExternalSyncRef.current = true;
        onRedo?.();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (spellMenu) {
          setSpellMenu(null);
          return;
        }
        flushDomInput(false);
        typingBurstRef.current = false;
        onFinish?.();
        return;
      }

      // Delega navegación entre celdas (Tab, Shift+Tab, Enter, flechas) cuando está dentro de una tabla
      if (onTableCellKeyDown) {
        const el = editableRef.current;
        const selRange = readDomSelectionRange(el, paragraphsRef.current);
        const totalLen = paragraphsToPlainText(paragraphsRef.current).length;
        const atStart = selRange ? selRange.start === 0 && selRange.end === 0 : false;
        const atEnd = selRange
          ? selRange.start >= totalLen && selRange.end >= totalLen
          : false;
        const hasSelection = selRange ? selRange.end > selRange.start : false;
        const handled = onTableCellKeyDown(e, {
          atStart,
          atEnd,
          hasSelection,
          flush: () => flushDomInput(false),
        });
        if (handled) {
          return;
        }
      }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const html = e.clipboardData?.getData('text/html') ?? '';
      const plain = e.clipboardData?.getData('text/plain') ?? '';

      // Si se pega un rango tabular desde editores externos o de hojas de cálculo dentro de una tabla, delega la expansión multicelda
      if (onTablePaste && onTablePaste(plain, html)) {
        typingBurstRef.current = false;
        pendingStyleRef.current = null;
        return;
      }

      const latestParagraphs = flushDomInput(false);
      const sel = captureCurrentSelection(latestParagraphs);
      const caretBase = getCaretRunStyle(latestParagraphs, sel.start, defaultsRef.current);
      const baseStyle = resolveRunStyle(
        { ...caretBase, ...(pendingStyleRef.current || {}) },
        defaultsRef.current
      );

      const pastedParagraphs = parseSanitizedHtmlToParagraphs(html, plain, baseStyle, {
        allowSpanStyles: false,
      });
      const { paragraphs: next, caretOffset } = insertParagraphsAtRange(
        latestParagraphs,
        sel,
        pastedParagraphs,
        defaultsRef.current
      );

      typingBurstRef.current = false;
      pendingStyleRef.current = null;
      pendingExternalSyncRef.current = true;
      desiredSelectionRef.current = { start: caretOffset, end: caretOffset };
      restoreFocusAfterSyncRef.current = true;
      onChangeParagraphsRef.current(next, true);
    };

    const handleCompositionStart = () => {
      composingRef.current = true;
    };

    const handleCompositionEnd = () => {
      composingRef.current = false;
      dirtyFromInputRef.current = true;
      handleInput();
    };

    // Detecta clic derecho sobre una palabra marcada en rojo y despliega sugerencias personalizadas
    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      try {
        if (!spellcheckEnabled) return;
        const el = editableRef.current;
        if (!el) return;

        // Asegura que el índice del DOM coincide con los últimos cambios escritos
        const freshEntries = collectSpellcheckRangesFromDom(el, lang);
        misspelledEntriesRef.current = freshEntries;
        if (freshEntries.length === 0) return;

        const cx = e.clientX;
        const cy = e.clientY;
        let hit: MisspelledDomEntry | null = null;

        if (cx > 0 || cy > 0) {
          for (const entry of freshEntries) {
            const rects = entry.range.getClientRects();
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i];
              if (
                cx >= r.left - 3 &&
                cx <= r.right + 3 &&
                cy >= r.top - 4 &&
                cy <= r.bottom + 5
              ) {
                hit = entry;
                break;
              }
            }
            if (hit) break;
          }
        }

        // Respaldo para tecla de menú contextual si el cursor está dentro de una palabra con error
        if (!hit && cx === 0 && cy === 0) {
          const sel = readDomSelectionRange(el, paragraphsRef.current);
          if (sel) {
            hit =
              freshEntries.find(
                (entry) => sel.start >= entry.start && sel.start <= entry.end
              ) ?? null;
          }
        }

        if (!hit) {
          setSpellMenu(null);
          return; // Fuera de palabra subrayada: conserva el menú normal del navegador/pizarra
        }

        e.preventDefault();
        e.stopPropagation();

        flushDomInput(false);
        const suggestions = getSpellSuggestions(hit.word, lang, 5);
        const hitRect = hit.range.getBoundingClientRect();
        setSpellMenu({
          x: cx > 0 ? cx : hitRect.left,
          y: cy > 0 ? cy : hitRect.bottom + 4,
          word: hit.word,
          start: hit.start,
          end: hit.end,
          suggestions,
        });
      } catch {
        setSpellMenu(null);
      }
    };

    // Reemplaza la palabra errónea preservando estilo de tramo y capitalización como un único paso de Deshacer
    const handleSelectSuggestion = useCallback(
      (suggestion: string) => {
        if (!spellMenu) return;
        const targetMenu = spellMenu;
        setSpellMenu(null);

        const latestParagraphs = flushDomInput(false);
        const currentPlain = paragraphsToPlainText(latestParagraphs);
        let start = targetMenu.start;
        let end = targetMenu.end;

        // Verifica si el desplazamiento sigue apuntando exactamente a la palabra marcada
        if (currentPlain.slice(start, end) !== targetMenu.word) {
          const idx = currentPlain.indexOf(targetMenu.word);
          if (idx === -1) return;
          start = idx;
          end = idx + targetMenu.word.length;
        }

        const cased = applySuggestionCase(targetMenu.word, suggestion);
        const { paragraphs: next, caretOffset } = replaceWordPreservingRunStyle(
          latestParagraphs,
          start,
          end,
          cased,
          defaultsRef.current
        );

        typingBurstRef.current = false;
        pendingStyleRef.current = null;
        pendingExternalSyncRef.current = true;
        desiredSelectionRef.current = { start: caretOffset, end: caretOffset };
        restoreFocusAfterSyncRef.current = true;
        onChangeParagraphsRef.current(next, true);
      },
      [flushDomInput, spellMenu]
    );

    const handleIgnoreWord = useCallback(
      (word: string) => {
        setSpellMenu(null);
        ignoreWordForSession(word, lang);
        runSpellcheckNow();
        editableRef.current?.focus({ preventScroll: true });
      },
      [lang, runSpellcheckNow]
    );

    const handleAddToPersonalDict = useCallback(
      (word: string) => {
        setSpellMenu(null);
        addWordToPersonalDictionaryAndEngine(word);
        runSpellcheckNow();
        editableRef.current?.focus({ preventScroll: true });
      },
      [runSpellcheckNow]
    );

    const toggleStyleButtonClass = (state: boolean | 'mixed') => {
      if (state === true) {
        return 'bg-blue-600 text-white';
      }
      if (state === 'mixed') {
        return 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-100 border border-dashed border-slate-400 dark:border-slate-500';
      }
      return 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800';
    };

    const alignButtonClass = (al: TextAlign) =>
      summary.align === al
        ? 'bg-blue-600 text-white'
        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800';

    const safeFontValue =
      summary.fontFamily === 'mixed'
        ? '__mixed__'
        : summary.fontFamily || defaults.fontFamily || 'sans';
    const safeFontSizeInput: number | 'mixed' =
      summary.fontSize === 'mixed'
        ? 'mixed'
        : sanitizeStoredFontSize(summary.fontSize || defaults.fontSize || 18);
    const safeColorValue =
      summary.color === 'mixed'
        ? defaults.color || '#0f172a'
        : summary.color || defaults.color || '#0f172a';
    const resolvedCaretColor = (resolveColor ? resolveColor(safeColorValue) : safeColorValue) || '#2563eb';

    const openEquationForCurrentSelection = () => {
      if (activeInlineMathRef.current) {
        inlineEqInputRef.current?.focus({ preventScroll: true });
        return;
      }
      const latestParagraphs = flushDomInput(false);
      const sel = captureCurrentSelection(latestParagraphs);
      const activeSummary = getSelectionStyleSummary(
        latestParagraphs,
        sel,
        pendingStyleRef.current,
        defaultsRef.current
      );
      const fontSize =
        activeSummary.fontSize === 'mixed'
          ? defaultsRef.current.fontSize
          : activeSummary.fontSize || defaultsRef.current.fontSize;
      const color =
        activeSummary.color === 'mixed'
          ? defaultsRef.current.color
          : activeSummary.color || defaultsRef.current.color;

      const base = getCaretRunStyle(latestParagraphs, sel.start, defaultsRef.current);
      const activeStyle = resolveRunStyle(
        {
          ...base,
          ...(pendingStyleRef.current || {}),
          fontSize,
          color,
        },
        defaultsRef.current
      );

      typingBurstRef.current = false;
      pendingStyleRef.current = null;
      const initialLatex = '\\square';
      const { paragraphs: next, caretOffset } = replaceRangeWithMathRun(
        latestParagraphs,
        sel,
        { latex: initialLatex },
        activeStyle,
        defaultsRef.current
      );
      const mathRange: TextSelectionRange = {
        start: Math.max(0, caretOffset - 1),
        end: caretOffset,
      };
      const session: ActiveInlineEquationSession = {
        latex: initialLatex,
        displayMode: false,
        fontSize: activeStyle.fontSize,
        color: activeStyle.color,
        selectionRange: mathRange,
        cursor: { path: [], offset: 0 },
      };

      activeInlineMathRef.current = session;
      setActiveInlineMath(session);
      onActiveInlineEquationChangeRef.current?.(session);

      paragraphsRef.current = next;
      lastSelectionRef.current = mathRange;
      pendingExternalSyncRef.current = true;
      restoreFocusAfterSyncRef.current = false;
      onChangeParagraphsRef.current(next, true);

      inlineEqInputRef.current?.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        inlineEqInputRef.current?.focus({ preventScroll: true });
      });
    };

    const resolveClickedMathCursor = (
      mathSpan: HTMLElement,
      latex: string,
      clientX: number,
      clientY: number
    ): MathCursor => {
      const htmlRoot = mathSpan.querySelector('.katex-html');
      if (!htmlRoot) return getInitialEditCursor(latex);

      let matchedEl = (
        document.elementFromPoint(clientX, clientY)?.closest?.('[data-p][data-i]') ?? null
      ) as HTMLElement | null;
      if (matchedEl && !htmlRoot.contains(matchedEl)) {
        matchedEl = null;
      }
      if (!matchedEl) {
        const atoms = Array.from(htmlRoot.querySelectorAll<HTMLElement>('[data-p][data-i]'));
        if (atoms.length === 0) return { path: [], offset: 0 };

        const rootRect = htmlRoot.getBoundingClientRect();
        if (clientX < rootRect.left - 8) return { path: [], offset: 0 };
        if (clientX > rootRect.right + 8) {
          return { path: [], offset: parseLatexToAst(latex).length };
        }
        let bestDist = Infinity;
        for (const atom of atoms) {
          const r = atom.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const dx = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
          const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
          const dist = dx + dy * 2.5;
          if (dist < bestDist) {
            bestDist = dist;
            matchedEl = atom;
          }
        }
      }
      if (!matchedEl) return getInitialEditCursor(latex);
      const path = decodePath(matchedEl.getAttribute('data-p') || 'r');
      const idx = Number(matchedEl.getAttribute('data-i') || '0');
      const isSlot = matchedEl.getAttribute('data-s') === '1';
      if (isSlot) return { path, offset: idx };
      const rect = matchedEl.getBoundingClientRect();
      const goAfter = clientX >= rect.left + rect.width / 2;
      return { path, offset: goAfter ? idx + 1 : idx };
    };

    const handleEditableMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      const mathSpan = target?.closest?.('[data-rt-math="1"]') as HTMLElement | null;
      if (mathSpan && editableRef.current?.contains(mathSpan)) {
        // Evita que contentEditable robe el foco del input oculto de ecuación
        e.preventDefault();
        e.stopPropagation();
        inlineEqInputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (activeInlineMathRef.current) {
        finishInlineEquationEditing(false);
      }
    };

    const handleEditableClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      const mathSpan = target?.closest?.('[data-rt-math="1"]') as HTMLElement | null;
      const container = editableRef.current;
      if (!mathSpan || !container || !container.contains(mathSpan)) return;
      e.preventDefault();
      e.stopPropagation();

      flushDomInput(false);
      const pBlocks = Array.from(
        container.querySelectorAll(':scope > [data-rt-p], :scope > div, :scope > p')
      );
      const activeBlocks = pBlocks.length > 0 ? pBlocks : [container];
      let flatStart = 0;
      let found = false;
      for (let i = 0; i < activeBlocks.length; i++) {
        if (i > 0) flatStart += 1;
        const blk = activeBlocks[i];
        if (blk.contains(mathSpan)) {
          const res = measureOffsetBeforePoint(blk, mathSpan, 0);
          flatStart += res.count;
          found = true;
          break;
        }
        flatStart += measureDomNodeLength(blk);
      }
      if (!found) return;

      const latex = mathSpan.getAttribute('data-latex') ?? '\\square';
      const displayMode = mathSpan.getAttribute('data-display') === '1';
      const fontSize = sanitizeStoredFontSize(
        Number(mathSpan.getAttribute('data-font-size')) || defaultsRef.current.fontSize,
        defaultsRef.current.fontSize
      );
      const color = mathSpan.getAttribute('data-color') || defaultsRef.current.color;

      const isAlreadyActive =
        activeInlineMathRef.current &&
        activeInlineMathRef.current.selectionRange.start === flatStart;
      const nextCursor = isAlreadyActive
        ? resolveClickedMathCursor(mathSpan, latex, e.clientX, e.clientY)
        : getInitialEditCursor(latex);

      const session: ActiveInlineEquationSession = {
        latex,
        displayMode,
        fontSize,
        color,
        selectionRange: { start: flatStart, end: flatStart + 1 },
        cursor: nextCursor,
      };
      activeInlineMathRef.current = session;
      setActiveInlineMath(session);
      onActiveInlineEquationChangeRef.current?.(session);
      lastSelectionRef.current = session.selectionRange;
      inlineEqInputRef.current?.focus({ preventScroll: true });
    };

    const commitInlineMathTextChunk = (raw: string) => {
      const cur = activeInlineMathRef.current;
      if (!raw || !cur) return;
      const next = applyTextInputAtCursor(cur.latex, cur.cursor, raw);
      applyInlineEquationUpdate(
        { ...cur, latex: next.latex, cursor: next.cursor },
        false,
        true
      );
    };

    const handleInlineEqKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      const cur = activeInlineMathRef.current;
      if (!cur) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();
      if (ctrl && keyLower === 'z') {
        e.preventDefault();
        finishInlineEquationEditing(false);
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      if (ctrl && keyLower === 'y') {
        e.preventDefault();
        finishInlineEquationEditing(false);
        onRedo?.();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        finishInlineEquationEditing(true);
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        const next = insertMathSpaceAtCursor(
          cur.latex,
          cur.cursor,
          e.shiftKey ? 'thin' : 'normal'
        );
        applyInlineEquationUpdate(
          { ...cur, latex: next.latex, cursor: next.cursor },
          false,
          true
        );
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        const nextCursor = jumpToNextSlotCursor(cur.latex, cur.cursor, e.shiftKey);
        applyInlineEquationUpdate({ ...cur, cursor: nextCursor }, false, false);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (cur.latex.includes('\\square') && !ctrl) {
          const nextCursor = jumpToNextSlotCursor(cur.latex, cur.cursor, false);
          applyInlineEquationUpdate({ ...cur, cursor: nextCursor }, false, false);
        } else {
          finishInlineEquationEditing(true);
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        applyInlineEquationUpdate(
          { ...cur, cursor: stepCursorLeft(cur.latex, cur.cursor) },
          false,
          false
        );
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        applyInlineEquationUpdate(
          { ...cur, cursor: stepCursorRight(cur.latex, cur.cursor) },
          false,
          false
        );
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyInlineEquationUpdate(
          { ...cur, cursor: stepCursorVertical(cur.latex, cur.cursor, 'up') },
          false,
          false
        );
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyInlineEquationUpdate(
          { ...cur, cursor: stepCursorVertical(cur.latex, cur.cursor, 'down') },
          false,
          false
        );
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        applyInlineEquationUpdate(
          {
            ...cur,
            cursor: {
              path: cur.cursor.offset === 0 ? [] : cur.cursor.path,
              offset: 0,
            },
          },
          false,
          false
        );
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        const ast = parseLatexToAst(cur.latex);
        const seq = getSeqAtPath(ast, cur.cursor.path);
        applyInlineEquationUpdate(
          {
            ...cur,
            cursor: {
              path: cur.cursor.path,
              offset: seq ? seq.length : ast.length,
            },
          },
          false,
          false
        );
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        const next = applyBackspaceAtCursor(cur.latex, cur.cursor);
        applyInlineEquationUpdate(
          { ...cur, latex: next.latex, cursor: next.cursor },
          false,
          true
        );
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        const next = applyDeleteAtCursor(cur.latex, cur.cursor);
        applyInlineEquationUpdate(
          { ...cur, latex: next.latex, cursor: next.cursor },
          false,
          true
        );
      }
    };

    return (
      <div
        ref={wrapperRef}
        className={`relative w-full min-h-full ${className}`}
      >
        {showToolbar && (
          <div
            data-export-ignore="true"
            onPointerDown={(e) => {
              e.stopPropagation();
              const target = e.target as HTMLElement;
              if (target.tagName !== 'SELECT' && target.tagName !== 'INPUT') {
                e.preventDefault();
              }
            }}
            className="absolute -top-11 left-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg z-50 whitespace-nowrap"
          >
            <select
              value={safeFontValue}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                if (e.target.value === '__mixed__') return;
                applyStyle(
                  { fontFamily: e.target.value as TextFontFamily },
                  { restoreFocus: true }
                );
              }}
              className="text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-1.5 py-0.5 text-slate-800 dark:text-slate-100 max-w-[145px]"
              title={
                summary.fontFamily === 'mixed'
                  ? 'Tipografía mixta en la selección'
                  : 'Tipografía'
              }
            >
              {summary.fontFamily === 'mixed' && (
                <option value="__mixed__" disabled>
                  Mixta
                </option>
              )}
              {TEXT_FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
                  {f.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => stepFontSize(-2, { restoreFocus: true })}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
              title="Reducir tamaño"
            >
              A-
            </button>
            <FontSizeInput
              variant="toolbar"
              value={safeFontSizeInput}
              onCommit={(nextSize) =>
                applyStyle({ fontSize: nextSize }, { restoreFocus: true })
              }
              onCancelFocus={() => {
                const el = editableRef.current;
                if (el) {
                  el.focus({ preventScroll: true });
                  const sel = lastSelectionRef.current;
                  writeDomSelectionRange(el, paragraphsRef.current, sel.start, sel.end);
                }
              }}
            />
            <button
              type="button"
              onClick={() => stepFontSize(2, { restoreFocus: true })}
              className="px-1.5 py-0.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
              title="Aumentar tamaño"
            >
              A+
            </button>

            <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

            <button
              type="button"
              onClick={() =>
                applyStyle(
                  { bold: summary.bold === true ? false : true },
                  { restoreFocus: true }
                )
              }
              className={`p-1 rounded ${toggleStyleButtonClass(summary.bold)}`}
              title={
                summary.bold === 'mixed'
                  ? 'Negrita mixta — clic para aplicar a toda la selección (Ctrl+B)'
                  : 'Negrita (Ctrl+B)'
              }
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                applyStyle(
                  { italic: summary.italic === true ? false : true },
                  { restoreFocus: true }
                )
              }
              className={`p-1 rounded ${toggleStyleButtonClass(summary.italic)}`}
              title={
                summary.italic === 'mixed'
                  ? 'Cursiva mixta — clic para aplicar a toda la selección (Ctrl+I)'
                  : 'Cursiva (Ctrl+I)'
              }
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                applyStyle(
                  { underline: summary.underline === true ? false : true },
                  { restoreFocus: true }
                )
              }
              className={`p-1 rounded ${toggleStyleButtonClass(summary.underline)}`}
              title={
                summary.underline === 'mixed'
                  ? 'Subrayado mixto — clic para aplicar a toda la selección (Ctrl+U)'
                  : 'Subrayado (Ctrl+U)'
              }
            >
              <Underline className="w-3.5 h-3.5" />
            </button>

            <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

            <button
              type="button"
              onClick={() => applyAlign('left', { restoreFocus: true })}
              className={`p-1 rounded ${alignButtonClass('left')}`}
              title="Alinear a la izquierda"
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyAlign('center', { restoreFocus: true })}
              className={`p-1 rounded ${alignButtonClass('center')}`}
              title="Centrar"
            >
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyAlign('right', { restoreFocus: true })}
              className={`p-1 rounded ${alignButtonClass('right')}`}
              title="Alinear a la derecha"
            >
              <AlignRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyAlign('justify', { restoreFocus: true })}
              className={`p-1 rounded ${alignButtonClass('justify')}`}
              title={
                autoWidth
                  ? 'Justificar (Ctrl+J) — desactiva ancho automático para ver efecto'
                  : 'Justificar (Ctrl+J)'
              }
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>

            {showListControls && onChangeListStyle && (
              <>
                <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <button
                  type="button"
                  onClick={() => {
                    flushDomInput(false);
                    pendingExternalSyncRef.current = true;
                    onChangeListStyle(listStyle === 'bullet' ? 'none' : 'bullet');
                  }}
                  className={`p-1 rounded ${
                    listStyle === 'bullet'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Viñetas"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    flushDomInput(false);
                    pendingExternalSyncRef.current = true;
                    onChangeListStyle(listStyle === 'numbered' ? 'none' : 'numbered');
                  }}
                  className={`p-1 rounded ${
                    listStyle === 'numbered'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Lista numerada"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                </button>
              </>
            )}

            {/* V1.11.8-5 & V1.11.8-8: Paleta rápida de 18 + 4 con vista previa rAF y 1 acción de historial */}
            <ColorSwatchPicker
              compact
              value={summary.color === 'mixed' ? 'mixed' : safeColorValue}
              title={
                summary.color === 'mixed'
                  ? 'Colores mixtos — selecciona un color para unificar'
                  : 'Color de texto'
              }
              onStartPreview={() => {
                colorPreviewSnapshotRef.current = flushDomInput(false);
              }}
              onPreviewColor={(hex) => {
                applyStyle({ color: hex }, { restoreFocus: false, recordHistory: false });
              }}
              onCommitColor={(hex) => {
                const snap = colorPreviewSnapshotRef.current;
                colorPreviewSnapshotRef.current = null;
                if (snap && onPushParagraphsSnapshot) {
                  try {
                    onPushParagraphsSnapshot(snap);
                  } catch {
                    // ignorar
                  }
                  applyStyle({ color: hex }, { restoreFocus: false, recordHistory: false });
                } else {
                  applyStyle({ color: hex }, { restoreFocus: false, recordHistory: true });
                }
              }}
              onCancelPreview={() => {
                const snap = colorPreviewSnapshotRef.current;
                colorPreviewSnapshotRef.current = null;
                if (snap) {
                  pendingExternalSyncRef.current = true;
                  onChangeParagraphsRef.current(snap, false);
                }
              }}
            />

            {!compactCell && (onActiveInlineEquationChange || onRequestEquationEditor) && (
              <>
                <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <button
                  type="button"
                  onClick={openEquationForCurrentSelection}
                  title="Insertar ecuación matemática en tiempo real dentro del texto"
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    activeInlineMath
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 dark:hover:text-blue-300'
                  }`}
                >
                  <Sigma className="w-3.5 h-3.5" />
                  <span>Ecuación</span>
                </button>
              </>
            )}

            {/* Selector rápido de idioma ES / MX / EN para el corrector ortográfico */}
            {onChangeLang && (
              <>
                <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
                <div
                  className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 overflow-hidden"
                  title="Idioma del corrector ortográfico"
                >
                  {(
                    [
                      ['es', 'ES', 'Español (general)'],
                      ['es-MX', 'MX', 'Español (México)'],
                      ['en-US', 'EN', 'Inglés (EE. UU.)'],
                    ] as const
                  ).map(([code, label, fullTitle]) => (
                    <button
                      key={code}
                      type="button"
                      title={fullTitle}
                      onClick={() => {
                        setRememberedTextLang(code);
                        onChangeLang(code);
                        requestAnimationFrame(() => {
                          editableRef.current?.focus({ preventScroll: true });
                        });
                      }}
                      className={`px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                        lang === code
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {spellcheckEnabled && dictStatus === 'loading' && (
              <span className="text-[10px] italic text-slate-500 dark:text-slate-400 px-1">
                Cargando diccionario…
              </span>
            )}

            {showDoneButton && onFinish && (
              <button
                type="button"
                onClick={() => {
                  flushDomInput(false);
                  onFinish();
                }}
                className="ml-1 px-2 py-0.5 text-[11px] font-medium bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Listo
              </button>
            )}
          </div>
        )}

        {/* Input oculto para capturar teclado e IME en tiempo real dentro de ecuaciones en texto */}
        <input
          ref={inlineEqInputRef}
          type="text"
          tabIndex={-1}
          aria-label="Entrada en tiempo real de ecuación dentro del texto"
          value=""
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onCompositionStart={() => {
            inlineEqComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            inlineEqComposingRef.current = false;
            const val = (e.target as HTMLInputElement).value;
            (e.target as HTMLInputElement).value = '';
            if (val) commitInlineMathTextChunk(val);
          }}
          onChange={(e) => {
            if (inlineEqComposingRef.current) return;
            const val = e.target.value;
            e.target.value = '';
            if (val) commitInlineMathTextChunk(val);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text) {
              e.preventDefault();
              commitInlineMathTextChunk(text);
            }
          }}
          onKeyDown={handleInlineEqKeyDown}
          className="opacity-0 absolute w-px h-px pointer-events-none -z-10"
        />

        {/* Área editable con fondo transparente para alinear el texto respecto al patrón del lienzo */}
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onBeforeInput={handleBeforeInput}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onMouseDown={handleEditableMouseDown}
          onClick={handleEditableClick}
          onContextMenu={handleContextMenu}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseUp={() => {
            captureCurrentSelection();
            refreshSummary();
          }}
          onKeyUp={() => {
            captureCurrentSelection();
            refreshSummary();
          }}
          onBlur={() => {
            captureCurrentSelection();
            flushDomInput(false);
          }}
          className={`rt-editable-surface box-border min-h-full outline-none select-text cursor-text leading-snug whitespace-pre-wrap break-words bg-transparent ${
            compactCell
              ? 'w-full border-2 border-blue-500 px-1.5 py-1'
              : `border-2 border-blue-600 shadow-[0_0_0_1px_rgba(37,99,235,0.2)] rounded p-1.5 ${
                  autoWidth ? 'min-w-[64px]' : 'w-full'
                }`
          }`}
          style={{
            backgroundColor:
              backgroundColor === 'transparent' ? 'transparent' : backgroundColor,
            caretColor: resolvedCaretColor,
            ...(autoWidth
              ? {
                  width: 'fit-content',
                  maxWidth: `${maxAutoWidth}px`,
                }
              : {}),
          }}
        />

        {/* Capa superpuesta de respaldo para subrayados ondulados si CSS.highlights no está disponible */}
        {fallbackWaveRects.length > 0 && (
          <div
            data-export-ignore="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
          >
            {fallbackWaveRects.map((rect, idx) => (
              <svg
                key={idx}
                width={Math.max(4, rect.width)}
                height={4}
                style={{
                  position: 'absolute',
                  left: rect.left,
                  top: rect.top,
                }}
                className="overflow-visible"
              >
                <defs>
                  <pattern
                    id={`spell-wave-${idx}`}
                    width={6}
                    height={4}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 0 2 Q 1.5 0 3 2 T 6 2"
                      fill="none"
                      stroke="#dc2626"
                      strokeWidth={1.3}
                    />
                  </pattern>
                </defs>
                <rect
                  width={Math.max(4, rect.width)}
                  height={4}
                  fill={`url(#spell-wave-${idx})`}
                />
              </svg>
            ))}
          </div>
        )}

        {/* Menú contextual personalizado con sugerencias, Ignorar y Agregar al diccionario */}
        <SpellcheckContextMenu
          menu={spellMenu}
          onSelectSuggestion={handleSelectSuggestion}
          onIgnoreWord={handleIgnoreWord}
          onAddToDictionary={handleAddToPersonalDict}
          onClose={() => setSpellMenu(null)}
        />
      </div>
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';
