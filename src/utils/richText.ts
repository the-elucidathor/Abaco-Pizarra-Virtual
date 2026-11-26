import type {
  Board,
  CanvasObject,
  RichTextParagraph,
  TableObject,
  TextAlign,
  TextFontFamily,
  TextObject,
  TextRun,
  TextRunMath,
  TextRunStyle,
  TextWidthMode,
  WhiteboardProject,
} from '../types/whiteboard';
import { isFixedSizeBoard, normalizarAjustesHoja, normalizarHojas } from './boardSizes';
import { getTableDefaultRunStyle, normalizarTabla } from './tableUtils';
// OPT: 1.6 — Caché WeakMap/LRU para normalización repetida de párrafos
import { getOrComputeNormalizedParagraphs } from './textMeasureCache';

// Rango de selección lineal (offsets sobre el texto plano unido con '\n')
export interface TextSelectionRange {
  start: number;
  end: number;
}

// Valor que puede ser uniforme o mixto cuando la selección abarca estilos heterogéneos
export type MixedOr<T> = T | 'mixed';

// Resumen del formato actual en el cursor o rango seleccionado (para barra flotante e inspector)
export interface SelectionStyleSummary {
  bold: MixedOr<boolean>;
  italic: MixedOr<boolean>;
  underline: MixedOr<boolean>;
  fontSize: MixedOr<number>;
  color: MixedOr<string>;
  fontFamily: MixedOr<TextFontFamily>;
  align: MixedOr<TextAlign>;
  isCollapsed: boolean;
}

// Estilo base resuelto (todos los campos definidos)
export interface ResolvedTextRunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  color: string;
  fontFamily: TextFontFamily;
}

const VALID_ALIGNS = new Set<TextAlign>(['left', 'center', 'right', 'justify']);

const VALID_FONTS = new Set<TextFontFamily>([
  'sans',
  'serif',
  'mono',
  'times',
  'arial',
  'comic-sans',
  'tahoma',
  'acme',
  'alatsi',
]);

export const MIN_TEXT_FONT_SIZE = 8;
export const MAX_TEXT_FONT_SIZE = 96;

// Redondea el tamaño de fuente a máximo 1 decimal evitando imprecisiones de punto flotante
export function roundFontSizeDecimal(size: number): number {
  if (!Number.isFinite(size)) return 18;
  return Math.round(size * 10) / 10;
}

// Conserva tamaños existentes válidos (incluidos heredados fuera de 8..96) al cargar o dibujar
export function sanitizeStoredFontSize(size: number, fallback = 18): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return fallback;
  }
  return roundFontSizeDecimal(size);
}

// Limita valores nuevos elegidos por el usuario al rango 8..96 px con máximo 1 decimal
export function clampTextFontSize(size: number): number {
  if (!Number.isFinite(size)) return 18;
  return roundFontSizeDecimal(
    Math.max(MIN_TEXT_FONT_SIZE, Math.min(MAX_TEXT_FONT_SIZE, size))
  );
}

export function stepFontSizeValue(currentSize: number, delta: number): number {
  const base = Number.isFinite(currentSize) && currentSize > 0 ? currentSize : 18;
  return clampTextFontSize(roundFontSizeDecimal(base + delta));
}

export function formatFontSizeDisplay(size: number): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '18';
  return String(roundFontSizeDecimal(size));
}

// Analiza entrada manual de tamaño de fuente (acepta '.' o ',', máx. 1 decimal, rango 8..96 px)
export function parseFontSizeInput(
  raw: string
): { valid: boolean; value?: number; clamped?: boolean } {
  if (typeof raw !== 'string') return { valid: false };
  const normalized = raw.trim().replace(/,/g, '.');
  if (!normalized || !/^[+-]?(\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return { valid: false };
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { valid: false };
  const rounded = roundFontSizeDecimal(parsed);
  if (rounded < MIN_TEXT_FONT_SIZE) {
    return { valid: true, value: MIN_TEXT_FONT_SIZE, clamped: true };
  }
  if (rounded > MAX_TEXT_FONT_SIZE) {
    return { valid: true, value: MAX_TEXT_FONT_SIZE, clamped: true };
  }
  return { valid: true, value: rounded, clamped: false };
}

// Normaliza una alineación asegurando que sea válida
export function normalizeTextAlign(align: unknown, fallback: TextAlign = 'left'): TextAlign {
  if (typeof align === 'string' && VALID_ALIGNS.has(align as TextAlign)) {
    return align as TextAlign;
  }
  return fallback;
}

const FALLBACK_DEFAULTS: ResolvedTextRunStyle = {
  bold: false,
  italic: false,
  underline: false,
  fontSize: 18,
  color: '#0f172a',
  fontFamily: 'sans',
};

// Extrae el estilo predeterminado de un objeto de texto de forma segura (acepta objetos parciales o nulos)
export function getDefaultRunStyle(
  obj:
    | Partial<
        Pick<
          TextObject,
          'bold' | 'italic' | 'underline' | 'fontSize' | 'color' | 'fontFamily'
        >
      >
    | null
    | undefined
): ResolvedTextRunStyle {
  if (!obj || typeof obj !== 'object') {
    return { ...FALLBACK_DEFAULTS };
  }
  return {
    bold: Boolean(obj.bold),
    italic: Boolean(obj.italic),
    underline: Boolean(obj.underline),
    fontSize: sanitizeStoredFontSize(
      typeof obj.fontSize === 'number' ? obj.fontSize : Number(obj.fontSize) || 18
    ),
    color:
      typeof obj.color === 'string' && obj.color.trim() ? obj.color.trim() : '#0f172a',
    fontFamily:
      typeof obj.fontFamily === 'string' && VALID_FONTS.has(obj.fontFamily as TextFontFamily)
        ? (obj.fontFamily as TextFontFamily)
        : 'sans',
  };
}

// Resuelve el estilo efectivo de un tramo heredando los valores por defecto faltantes
export function resolveRunStyle(
  run: TextRunStyle | null | undefined,
  defaults: ResolvedTextRunStyle = FALLBACK_DEFAULTS
): ResolvedTextRunStyle {
  const safeDefaults = defaults || FALLBACK_DEFAULTS;
  if (!run || typeof run !== 'object') {
    return { ...safeDefaults };
  }
  return {
    bold: run.bold ?? safeDefaults.bold,
    italic: run.italic ?? safeDefaults.italic,
    underline: run.underline ?? safeDefaults.underline,
    fontSize:
      run.fontSize !== undefined && run.fontSize !== null
        ? sanitizeStoredFontSize(Number(run.fontSize), safeDefaults.fontSize)
        : safeDefaults.fontSize,
    color:
      typeof run.color === 'string' && run.color.trim()
        ? run.color.trim()
        : safeDefaults.color,
    fontFamily:
      run.fontFamily && VALID_FONTS.has(run.fontFamily)
        ? run.fontFamily
        : safeDefaults.fontFamily,
  };
}

// Carácter atómico centinela que representa una expresión matemática embebida en el flujo de texto
export const INLINE_MATH_PLACEHOLDER = '\uFFFC';

export function sanitizeRunMath(math: unknown): TextRunMath | undefined {
  if (!math || typeof math !== 'object') return undefined;
  const raw = math as Partial<TextRunMath>;
  if (typeof raw.latex !== 'string') return undefined;
  const latex = raw.latex;
  return {
    latex,
    ...(raw.displayMode ? { displayMode: true } : {}),
  };
}

export function isMathRun(run: Partial<TextRun> | null | undefined): boolean {
  return Boolean(run && run.math && typeof run.math.latex === 'string');
}

// Compara si dos tramos comparten exactamente el mismo estilo resuelto (las ecuaciones nunca se fusionan)
export function runStylesEqual(
  a: TextRunStyle | TextRun,
  b: TextRunStyle | TextRun,
  defaults: ResolvedTextRunStyle = FALLBACK_DEFAULTS
): boolean {
  if (isMathRun(a as TextRun) || isMathRun(b as TextRun)) return false;
  const ra = resolveRunStyle(a, defaults);
  const rb = resolveRunStyle(b, defaults);
  return (
    ra.bold === rb.bold &&
    ra.italic === rb.italic &&
    ra.underline === rb.underline &&
    ra.fontSize === rb.fontSize &&
    ra.color.toLowerCase() === rb.color.toLowerCase() &&
    ra.fontFamily === rb.fontFamily
  );
}

// Construye un TextRun con estilo resuelto explícito
function makeRun(text: string, style: ResolvedTextRunStyle, math?: TextRunMath): TextRun {
  const safeMath = sanitizeRunMath(math);
  return {
    text: safeMath ? INLINE_MATH_PLACEHOLDER : typeof text === 'string' ? text : '',
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    underline: Boolean(style.underline),
    fontSize: sanitizeStoredFontSize(style.fontSize),
    color: typeof style.color === 'string' && style.color.trim() ? style.color : '#0f172a',
    fontFamily: VALID_FONTS.has(style.fontFamily) ? style.fontFamily : 'sans',
    ...(safeMath ? { math: safeMath } : {}),
  };
}

// Normaliza párrafos: fusiona tramos adyacentes idénticos y conserva un tramo vacío en líneas vacías
export function normalizeParagraphs(
  paragraphs: unknown,
  defaults: ResolvedTextRunStyle = FALLBACK_DEFAULTS,
  defaultAlign: TextAlign = 'left'
): RichTextParagraph[] {
  const safeDefaults = defaults || FALLBACK_DEFAULTS;
  const safeDefaultAlign = normalizeTextAlign(defaultAlign, 'left');

  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return [{ align: safeDefaultAlign, runs: [makeRun('', safeDefaults)] }];
  }

  return paragraphs.map((p) => {
    const pObj = p && typeof p === 'object' ? (p as Partial<RichTextParagraph>) : null;
    const align = normalizeTextAlign(pObj?.align, safeDefaultAlign);
    const rawRuns = Array.isArray(pObj?.runs) ? pObj!.runs : [];
    const merged: TextRun[] = [];
    let lastFallbackStyle = safeDefaults;

    for (const r of rawRuns) {
      if (!r || typeof r !== 'object') continue;
      const runObj = r as Partial<TextRun>;
      const safeMath = sanitizeRunMath(runObj.math);
      const txt = safeMath
        ? INLINE_MATH_PLACEHOLDER
        : typeof runObj.text === 'string'
        ? runObj.text
        : '';
      const resolved = resolveRunStyle(runObj, safeDefaults);
      lastFallbackStyle = resolved;
      if (txt.length === 0) continue;

      if (safeMath) {
        merged.push(makeRun(INLINE_MATH_PLACEHOLDER, resolved, safeMath));
        continue;
      }

      const prev = merged[merged.length - 1];
      if (prev && !prev.math && runStylesEqual(prev, resolved, safeDefaults)) {
        prev.text += txt;
      } else {
        merged.push(makeRun(txt, resolved));
      }
    }

    if (merged.length === 0) {
      merged.push(makeRun('', lastFallbackStyle));
    }

    return { align, runs: merged };
  });
}

// Convierte una lista de párrafos enriquecidos en texto plano separado por '\n'
export function paragraphsToPlainText(paragraphs: unknown): string {
  if (!Array.isArray(paragraphs)) return '';
  return paragraphs
    .map((p) => {
      if (!p || typeof p !== 'object') return '';
      const runs = (p as Partial<RichTextParagraph>).runs;
      if (!Array.isArray(runs)) return '';
      return runs.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('');
    })
    .join('\n');
}

// Genera párrafos enriquecidos a partir de texto plano y un estilo global
export function createParagraphsFromPlainText(
  content: unknown,
  style: ResolvedTextRunStyle = FALLBACK_DEFAULTS,
  align: TextAlign = 'left'
): RichTextParagraph[] {
  const safeAlign = normalizeTextAlign(align, 'left');
  const safeStyle = resolveRunStyle(style, FALLBACK_DEFAULTS);
  const safeStr = typeof content === 'string' ? content : '';
  const lines = safeStr.replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line) => ({
    align: safeAlign,
    runs: [makeRun(line, safeStyle)],
  }));
}

// Detecta si una cadena contiene etiquetas HTML de texto enriquecido permitidas
function looksLikeRichHtml(value: string): boolean {
  return /<\/?(b|strong|i|em|u|ins|span|p|div|br)\b[^>]*>/i.test(value);
}

// Normalizador universal a prueba de fallos: acepta string plano, HTML, arreglo de tramos, párrafos, null, undefined o cualquier objeto inválido
export function normalizarContenidoTexto(
  valor: unknown,
  defaults: ResolvedTextRunStyle = FALLBACK_DEFAULTS,
  defaultAlign: TextAlign = 'left'
): RichTextParagraph[] {
  const safeDefaults = resolveRunStyle(defaults, FALLBACK_DEFAULTS);
  const safeAlign = normalizeTextAlign(defaultAlign, 'left');

  try {
    if (valor === null || valor === undefined) {
      return [{ align: safeAlign, runs: [makeRun('', safeDefaults)] }];
    }

    if (typeof valor === 'string') {
      if (looksLikeRichHtml(valor)) {
        return parseSanitizedHtmlToParagraphs(valor, valor, safeDefaults, {
          allowSpanStyles: true,
        }).map((p) => ({
          align: normalizeTextAlign(p.align, safeAlign),
          runs: p.runs,
        }));
      }
      return createParagraphsFromPlainText(valor, safeDefaults, safeAlign);
    }

    if (Array.isArray(valor)) {
      if (valor.length === 0) {
        return [{ align: safeAlign, runs: [makeRun('', safeDefaults)] }];
      }
      const firstValid = valor.find((item) => item && typeof item === 'object');
      if (!firstValid) {
        return [{ align: safeAlign, runs: [makeRun('', safeDefaults)] }];
      }
      // Soporta tanto arreglo de párrafos ({ runs: [...] }) como arreglo plano de tramos ({ text: '...' })
      if (Array.isArray((firstValid as Partial<RichTextParagraph>).runs)) {
        return getOrComputeNormalizedParagraphs(
          valor as RichTextParagraph[],
          safeDefaults,
          safeAlign,
          () => normalizeParagraphs(valor, safeDefaults, safeAlign)
        );
      }
      if (typeof (firstValid as Partial<TextRun>).text === 'string') {
        const runs = valor
          .filter((item): item is TextRun => Boolean(item && typeof item === 'object'))
          .map((r) =>
            makeRun(
              typeof r.text === 'string' ? r.text : '',
              resolveRunStyle(r, safeDefaults),
              sanitizeRunMath(r.math)
            )
          );
        return normalizeParagraphs([{ align: safeAlign, runs }], safeDefaults, safeAlign);
      }
      return [{ align: safeAlign, runs: [makeRun('', safeDefaults)] }];
    }

    if (typeof valor === 'object') {
      const obj = valor as Record<string, unknown>;
      const objDefaults = getDefaultRunStyle(obj as Partial<TextObject>);
      const mergedDefaults =
        'bold' in obj || 'fontSize' in obj || 'color' in obj || 'fontFamily' in obj
          ? objDefaults
          : safeDefaults;
      const objAlign = normalizeTextAlign(obj.align, safeAlign);

      if (Array.isArray(obj.paragraphs) && obj.paragraphs.length > 0) {
        return normalizeParagraphs(obj.paragraphs, mergedDefaults, objAlign);
      }
      if (Array.isArray(obj.runs)) {
        return normalizeParagraphs([{ align: objAlign, runs: obj.runs }], mergedDefaults, objAlign);
      }
      if (typeof obj.html === 'string') {
        return parseSanitizedHtmlToParagraphs(obj.html, obj.html, mergedDefaults, {
          allowSpanStyles: true,
        });
      }
      if (typeof obj.content === 'string') {
        return normalizarContenidoTexto(obj.content, mergedDefaults, objAlign);
      }
      if (typeof obj.text === 'string') {
        return normalizarContenidoTexto(obj.text, mergedDefaults, objAlign);
      }
    }
  } catch {
    // Nunca propaga excepciones ante estructuras corruptas
  }

  return [{ align: safeAlign, runs: [makeRun('', safeDefaults)] }];
}

// Garantiza que un TextObject disponga de párrafos válidos (sin mutar el original y nunca lanza)
export function ensureTextParagraphs(
  obj: TextObject | Partial<TextObject> | null | undefined
): RichTextParagraph[] {
  const defaults = getDefaultRunStyle(obj);
  const safeAlign = normalizeTextAlign(obj?.align, 'left');
  if (!obj || typeof obj !== 'object') {
    return [{ align: safeAlign, runs: [makeRun('', defaults)] }];
  }
  if (Array.isArray(obj.paragraphs) && obj.paragraphs.length > 0) {
    return normalizarContenidoTexto(obj.paragraphs, defaults, safeAlign);
  }
  return normalizarContenidoTexto(obj.content, defaults, safeAlign);
}

// Resuelve el modo de ancho de un cuadro de texto (cajas antiguas sin información se tratan como 'auto')
export function resolveTextWidthMode(
  obj: Partial<Pick<TextObject, 'widthMode' | 'autoWidth'>> | null | undefined
): TextWidthMode {
  if (obj?.widthMode === 'auto' || obj?.widthMode === 'fixed') {
    return obj.widthMode;
  }
  if (typeof obj?.autoWidth === 'boolean') {
    return obj.autoWidth ? 'auto' : 'fixed';
  }
  // Retrocompatibilidad: cajas anteriores sin widthMode ni autoWidth se tratan como 'auto'
  return 'auto';
}

// Migra un TextObject antiguo (texto plano con formato global) al modelo de párrafos y tramos
export function migrateTextObject(obj: TextObject): TextObject {
  const safeAlign = normalizeTextAlign(obj?.align, 'left');
  const defaults = getDefaultRunStyle(obj);
  const normalized = ensureTextParagraphs(obj);
  const plain = paragraphsToPlainText(normalized);
  const firstRun = resolveRunStyle(normalized[0]?.runs?.[0], defaults);
  const resolvedMode = resolveTextWidthMode(obj);

  return {
    ...obj,
    align: normalizeTextAlign(normalized[0]?.align, safeAlign),
    content: plain,
    paragraphs: normalized,
    fontSize: firstRun.fontSize,
    fontFamily: firstRun.fontFamily,
    color: firstRun.color,
    bold: firstRun.bold,
    italic: firstRun.italic,
    underline: firstRun.underline,
    backgroundColor:
      typeof obj?.backgroundColor === 'string' && obj.backgroundColor.trim()
        ? obj.backgroundColor
        : 'transparent',
    listStyle:
      obj?.listStyle === 'bullet' || obj?.listStyle === 'numbered' ? obj.listStyle : 'none',
    widthMode: resolvedMode,
    autoWidth: resolvedMode === 'auto',
    lang:
      obj?.lang === 'es' || obj?.lang === 'es-MX' || obj?.lang === 'en-US'
        ? obj.lang
        : undefined,
  };
}

// Clave de respaldo en localStorage previa a la migración 1.11.1
export function getPreMigrationBackupKey(projectId: string): string {
  return `abaco_backup_pre_1_11_1_${projectId}`;
}

// Guarda una copia de respaldo del proyecto en localStorage antes de migrar datos antiguos
export function backupPreMigrationProject(project: WhiteboardProject): void {
  if (!project || typeof project.id !== 'string' || !project.id) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const key = getPreMigrationBackupKey(project.id);
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(project));
    }
  } catch {
    // Ignorar error de cuota o entorno sin localStorage
  }
}

// Recupera la copia de respaldo previa a la migración si existe en localStorage
export function loadPreMigrationBackup(projectId: string): WhiteboardProject | null {
  if (!projectId) return null;
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(getPreMigrationBackupKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WhiteboardProject;
    if (parsed && Array.isArray(parsed.boards)) {
      return parsed;
    }
  } catch {
    // Respaldo inválido o inaccesible
  }
  return null;
}

// Repara un cuadro de texto dañado normalizando su contenido sin perder texto visible
export function repairCorruptedTextObject(obj: Partial<TextObject> & { id: string }): TextObject {
  const defaults = getDefaultRunStyle(obj);
  const safeAlign = normalizeTextAlign(obj?.align, 'left');
  const paragraphs = normalizarContenidoTexto(
    Array.isArray(obj?.paragraphs) && obj.paragraphs.length > 0 ? obj.paragraphs : obj?.content,
    defaults,
    safeAlign
  );
  const plain = paragraphsToPlainText(paragraphs);
  const safeText = plain.length > 0 ? plain : '';
  const safeParagraphs =
    safeText.length > 0
      ? paragraphs
      : [{ align: safeAlign, runs: [makeRun('', defaults)] }];

  return {
    id: obj.id,
    type: 'text',
    layerId: typeof obj.layerId === 'string' && obj.layerId ? obj.layerId : 'layer_main',
    x: typeof obj.x === 'number' && Number.isFinite(obj.x) ? obj.x : 0,
    y: typeof obj.y === 'number' && Number.isFinite(obj.y) ? obj.y : 0,
    width: typeof obj.width === 'number' && Number.isFinite(obj.width) ? Math.max(40, obj.width) : 240,
    height: typeof obj.height === 'number' && Number.isFinite(obj.height) ? Math.max(32, obj.height) : 64,
    rotation: typeof obj.rotation === 'number' && Number.isFinite(obj.rotation) ? obj.rotation : 0,
    opacity: typeof obj.opacity === 'number' && Number.isFinite(obj.opacity) ? obj.opacity : 1,
    locked: Boolean(obj.locked),
    zIndex: typeof obj.zIndex === 'number' && Number.isFinite(obj.zIndex) ? obj.zIndex : 1,
    groupId: typeof obj.groupId === 'string' ? obj.groupId : undefined,
    content: safeText,
    paragraphs: safeParagraphs,
    fontFamily: defaults.fontFamily,
    fontSize: defaults.fontSize,
    bold: defaults.bold,
    italic: defaults.italic,
    underline: defaults.underline,
    align: safeAlign,
    color: defaults.color,
    backgroundColor:
      typeof obj.backgroundColor === 'string' && obj.backgroundColor.trim()
        ? obj.backgroundColor
        : 'transparent',
    listStyle:
      obj.listStyle === 'bullet' || obj.listStyle === 'numbered' ? obj.listStyle : 'none',
    widthMode: resolveTextWidthMode(obj),
    autoWidth: resolveTextWidthMode(obj) === 'auto',
    lang:
      obj.lang === 'es' || obj.lang === 'es-MX' || obj.lang === 'en-US'
        ? obj.lang
        : undefined,
  };
}

// Migra de forma no destructiva todos los TextObject de un tablero
export function migrateBoardTextObjects(board: Board): Board {
  if (!board || !Array.isArray(board.objects)) return board;
  let changed = false;
  const nextObjects: CanvasObject[] = board.objects.map((obj) => {
    if (!obj || obj.type !== 'text') return obj;
    const textObj = obj as TextObject;
    const hasValidParagraphs =
      Array.isArray(textObj.paragraphs) &&
      textObj.paragraphs.length > 0 &&
      typeof textObj.content === 'string';
    if (hasValidParagraphs) {
      return textObj;
    }
    changed = true;
    return migrateTextObject(textObj);
  });
  return changed ? { ...board, objects: nextObjects } : board;
}

// Verifica si algún cuadro de texto en el proyecto necesita migración desde formato previo a 1.11.1
function projectNeedsTextMigration(project: WhiteboardProject): boolean {
  if (!project || !Array.isArray(project.boards)) return false;
  return project.boards.some(
    (b) =>
      Array.isArray(b?.objects) &&
      b.objects.some(
        (o) =>
          o?.type === 'text' &&
          (!Array.isArray((o as TextObject).paragraphs) ||
            (o as TextObject).paragraphs!.length === 0)
      )
  );
}

// Migra de forma no destructiva todos los TextObject de un proyecto completo tras guardar respaldo previo
export function migrateProjectTextObjects(project: WhiteboardProject): WhiteboardProject {
  if (!project || !Array.isArray(project.boards)) return project;
  if (projectNeedsTextMigration(project)) {
    backupPreMigrationProject(project);
  }
  let changed = false;
  const nextBoards = project.boards.map((board) => {
    const migrated = migrateBoardTextObjects(board);
    if (migrated !== board) changed = true;
    return migrated;
  });
  return changed ? { ...project, boards: nextBoards } : project;
}

// Convierte un proyecto a modo seguro: reemplaza cualquier estructura compleja o dañada de texto por texto plano normalizado
export function convertProjectToSafeMode(project: WhiteboardProject): WhiteboardProject {
  if (!project || !Array.isArray(project.boards)) return project;
  return {
    ...project,
    boards: project.boards.map((board) => {
      const sheetSettings = normalizarAjustesHoja(board);
      const sheets = isFixedSizeBoard(board) ? normalizarHojas(board) : undefined;
      return {
        ...board,
        ...sheetSettings,
        ...(sheets ? { sheets } : {}),
        objects: Array.isArray(board.objects)
        ? board.objects.filter(Boolean).map((obj) => {
            if (obj.type === 'table') {
              // En modo seguro normaliza la tabla y simplifica cada celda a texto plano seguro
              const safeTable = normalizarTabla(obj);
              return {
                ...safeTable,
                cells: safeTable.cells.map((row, rIdx) =>
                  row.map((cell) => {
                    const cellDefaults = getTableDefaultRunStyle(
                      safeTable,
                      safeTable.hasHeaderRow && rIdx === 0
                    );
                    const plain = cell.content || '';
                    return {
                      ...cell,
                      content: plain,
                      paragraphs: createParagraphsFromPlainText(
                        plain,
                        cellDefaults,
                        cell.align || 'left'
                      ),
                    };
                  })
                ),
              };
            }
            if (obj.type !== 'text') return obj;
            const repaired = repairCorruptedTextObject(obj as TextObject);
            const defaults = getDefaultRunStyle(repaired);
            const plain = paragraphsToPlainText(repaired.paragraphs);
            return {
              ...repaired,
              content: plain,
              paragraphs: createParagraphsFromPlainText(plain, defaults, repaired.align),
            };
          })
        : [],
      };
    }),
  };
}

// Valida la estructura del proyecto antes de renderizar y repara cuadros inválidos; si falla gravemente recurre a modo seguro
export function validateAndNormalizeProject(
  project: WhiteboardProject
): { project: WhiteboardProject; usedSafeMode: boolean; repairedTextCount: number } {
  try {
    if (!project || !Array.isArray(project.boards) || project.boards.length === 0) {
      throw new Error('Proyecto sin tableros válidos.');
    }

    if (projectNeedsTextMigration(project)) {
      backupPreMigrationProject(project);
    }

    let repairedTextCount = 0;
    const nextBoards = project.boards.map((board) => {
      const safeLayers =
        Array.isArray(board.layers) && board.layers.length > 0
          ? board.layers
          : [{ id: 'layer_main', name: 'Capa Principal', visible: true, locked: false }];
      const fallbackLayerId = safeLayers[0].id;
      const safeObjects = Array.isArray(board.objects)
        ? board.objects
            .filter((o): o is CanvasObject => Boolean(o && typeof o === 'object' && o.type))
            .map((obj) => {
              if (obj.type === 'table') {
                // Normaliza tablas al cargar o restaurar proyectos manteniendo compatibilidad retroactiva
                return normalizarTabla(obj as TableObject, {
                  layerId: fallbackLayerId,
                });
              }
              if (obj.type !== 'text') return obj;
              const t = obj as Partial<TextObject>;
              const validContent = typeof t.content === 'string';
              const validParagraphs =
                Array.isArray(t.paragraphs) &&
                t.paragraphs.length > 0 &&
                t.paragraphs.every(
                  (p) =>
                    p &&
                    typeof p === 'object' &&
                    Array.isArray(p.runs) &&
                    p.runs.every((r) => r && typeof r === 'object' && typeof r.text === 'string')
                );
              if (!validContent || !validParagraphs) {
                repairedTextCount++;
                return repairCorruptedTextObject({
                  ...t,
                  id: typeof t.id === 'string' && t.id ? t.id : `txt_${Date.now()}`,
                  layerId:
                    typeof t.layerId === 'string' && t.layerId ? t.layerId : fallbackLayerId,
                });
              }
              return migrateTextObject(obj as TextObject);
            })
        : [];
      const sheetSettings = normalizarAjustesHoja(board);
      const sheets = isFixedSizeBoard(board) ? normalizarHojas(board) : undefined;
      return {
        ...board,
        ...sheetSettings,
        ...(sheets ? { sheets } : {}),
        layers: safeLayers,
        activeLayerId: board.activeLayerId || fallbackLayerId,
        objects: safeObjects,
      };
    });

    return {
      project: {
        ...project,
        activeBoardId: project.activeBoardId || nextBoards[0].id,
        boards: nextBoards,
      },
      usedSafeMode: false,
      repairedTextCount,
    };
  } catch (err) {
    console.error('[Ábaco] Validación fallida al cargar proyecto, activando modo seguro:', err);
    return {
      project: convertProjectToSafeMode(project),
      usedSafeMode: true,
      repairedTextCount: 1,
    };
  }
}

// Calcula los rangos [start, end] de cada párrafo en el índice plano de texto
export function getParagraphFlatRanges(
  paragraphs: RichTextParagraph[]
): { start: number; end: number; length: number }[] {
  const ranges: { start: number; end: number; length: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const length = paragraphs[i].runs.reduce((sum, r) => sum + r.text.length, 0);
    ranges.push({ start: cursor, end: cursor + length, length });
    cursor += length + 1; // +1 por el salto de línea '\n'
  }
  return ranges;
}

// Encuentra índice de párrafo y offset local dentro del párrafo dado un offset plano
export function flatOffsetToParagraphPos(
  paragraphs: RichTextParagraph[],
  flatOffset: number
): { paragraphIndex: number; localOffset: number } {
  const ranges = getParagraphFlatRanges(paragraphs);
  const maxOffset = ranges.length > 0 ? ranges[ranges.length - 1].end : 0;
  const clamped = Math.max(0, Math.min(flatOffset, maxOffset));
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (clamped <= r.end || i === ranges.length - 1) {
      return {
        paragraphIndex: i,
        localOffset: Math.max(0, Math.min(r.length, clamped - r.start)),
      };
    }
  }
  return { paragraphIndex: 0, localOffset: 0 };
}

// Devuelve qué índices de párrafo están tocados por la selección dada
export function getTouchedParagraphIndices(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange
): number[] {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  const ranges = getParagraphFlatRanges(paragraphs);

  if (start === end) {
    const pos = flatOffsetToParagraphPos(paragraphs, start);
    return [pos.paragraphIndex];
  }

  const touched: number[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start === r.end) {
      // Párrafo vacío: se considera tocado si cae estrictamente dentro o en el borde interior de una selección multilínea
      if (start <= r.start && end >= r.start) {
        // Evita incluir párrafo vacío final cuando la selección termina justo antes de su '\n' previo
        const prevEnd = i > 0 ? ranges[i - 1].end : -1;
        if (!(i > 0 && end === prevEnd)) {
          touched.push(i);
        }
      }
    } else if (Math.max(start, r.start) < Math.min(end, r.end)) {
      touched.push(i);
    }
  }

  if (touched.length === 0) {
    touched.push(flatOffsetToParagraphPos(paragraphs, start).paragraphIndex);
  }
  return touched;
}

// Obtiene el estilo en el punto del cursor (sin selección de rango)
export function getCaretRunStyle(
  paragraphs: RichTextParagraph[],
  caretOffset: number,
  defaults: ResolvedTextRunStyle
): ResolvedTextRunStyle {
  const pos = flatOffsetToParagraphPos(paragraphs, caretOffset);
  const p = paragraphs[pos.paragraphIndex];
  if (!p || p.runs.length === 0) return defaults;

  const pLen = p.runs.reduce((s, r) => s + r.text.length, 0);
  if (pLen === 0) {
    return resolveRunStyle(p.runs[0], defaults);
  }

  // Preferimos el carácter inmediatamente anterior al cursor dentro del mismo párrafo; si está al inicio, el primero
  const targetChar = pos.localOffset > 0 ? pos.localOffset - 1 : 0;
  let acc = 0;
  for (const r of p.runs) {
    const nextAcc = acc + r.text.length;
    if (targetChar < nextAcc) {
      return resolveRunStyle(r, defaults);
    }
    acc = nextAcc;
  }
  return resolveRunStyle(p.runs[p.runs.length - 1], defaults);
}

// Calcula el resumen de formato para mostrar en barra flotante o inspector (detecta valores mixtos)
export function getSelectionStyleSummary(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  pendingStyle: Partial<TextRunStyle> | null | undefined,
  defaults: ResolvedTextRunStyle
): SelectionStyleSummary {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  const isCollapsed = start === end;

  if (isCollapsed) {
    const base = getCaretRunStyle(paragraphs, start, defaults);
    const merged = resolveRunStyle({ ...base, ...(pendingStyle || {}) }, defaults);
    const pos = flatOffsetToParagraphPos(paragraphs, start);
    const pAlign = normalizeTextAlign(paragraphs[pos.paragraphIndex]?.align, 'left');
    return {
      bold: merged.bold,
      italic: merged.italic,
      underline: merged.underline,
      fontSize: merged.fontSize,
      color: merged.color,
      fontFamily: merged.fontFamily,
      align: pAlign,
      isCollapsed: true,
    };
  }

  const ranges = getParagraphFlatRanges(paragraphs);
  const collectedStyles: ResolvedTextRunStyle[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const pStart = ranges[i].start;
    const pEnd = ranges[i].end;
    if (pStart === pEnd) {
      if (start <= pStart && end >= pStart) {
        collectedStyles.push(resolveRunStyle(p.runs[0], defaults));
      }
      continue;
    }
    let acc = pStart;
    for (const r of p.runs) {
      const rStart = acc;
      const rEnd = acc + r.text.length;
      acc = rEnd;
      if (Math.max(start, rStart) < Math.min(end, rEnd)) {
        collectedStyles.push(resolveRunStyle(r, defaults));
      }
    }
  }

  if (collectedStyles.length === 0) {
    collectedStyles.push(getCaretRunStyle(paragraphs, start, defaults));
  }

  const first = collectedStyles[0];
  let bold: MixedOr<boolean> = first.bold;
  let italic: MixedOr<boolean> = first.italic;
  let underline: MixedOr<boolean> = first.underline;
  let fontSize: MixedOr<number> = first.fontSize;
  let color: MixedOr<string> = first.color;
  let fontFamily: MixedOr<TextFontFamily> = first.fontFamily;

  for (let i = 1; i < collectedStyles.length; i++) {
    const st = collectedStyles[i];
    if (st.bold !== bold) bold = 'mixed';
    if (st.italic !== italic) italic = 'mixed';
    if (st.underline !== underline) underline = 'mixed';
    if (st.fontSize !== fontSize) fontSize = 'mixed';
    if (st.color.toLowerCase() !== String(color).toLowerCase()) color = 'mixed';
    if (st.fontFamily !== fontFamily) fontFamily = 'mixed';
  }

  const touchedIdx = getTouchedParagraphIndices(paragraphs, { start, end });
  const firstAlign = normalizeTextAlign(paragraphs[touchedIdx[0]]?.align, 'left');
  let align: MixedOr<TextAlign> = firstAlign;
  for (let i = 1; i < touchedIdx.length; i++) {
    const al = normalizeTextAlign(paragraphs[touchedIdx[i]]?.align, 'left');
    if (al !== align) {
      align = 'mixed';
      break;
    }
  }

  return {
    bold,
    italic,
    underline,
    fontSize,
    color,
    fontFamily,
    align,
    isCollapsed: false,
  };
}

// Divide y aplica un parche de estilo en línea únicamente a los caracteres dentro de [start, end)
export function applyInlineStyleToRange(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  patch: Partial<TextRunStyle>,
  defaults: ResolvedTextRunStyle
): RichTextParagraph[] {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) return paragraphs;

  const ranges = getParagraphFlatRanges(paragraphs);
  const next = paragraphs.map((p, i) => {
    const pStart = ranges[i].start;
    const pEnd = ranges[i].end;

    // Párrafo vacío incluido en una selección multilínea
    if (pStart === pEnd) {
      if (start <= pStart && end >= pStart) {
        const cur = resolveRunStyle(p.runs[0], defaults);
        return {
          ...p,
          runs: [makeRun('', resolveRunStyle({ ...cur, ...patch }, defaults))],
        };
      }
      return p;
    }

    if (end <= pStart || start >= pEnd) {
      return p;
    }

    const newRuns: TextRun[] = [];
    let acc = pStart;
    for (const r of p.runs) {
      const rStart = acc;
      const rEnd = acc + r.text.length;
      acc = rEnd;
      const baseStyle = resolveRunStyle(r, defaults);

      if (rEnd <= start || rStart >= end) {
        newRuns.push(makeRun(r.text, baseStyle, r.math));
        continue;
      }

      const overlapStart = Math.max(start, rStart) - rStart;
      const overlapEnd = Math.min(end, rEnd) - rStart;

      if (overlapStart > 0) {
        newRuns.push(makeRun(r.text.slice(0, overlapStart), baseStyle));
      }
      const patchedStyle = resolveRunStyle({ ...baseStyle, ...patch }, defaults);
      newRuns.push(makeRun(r.text.slice(overlapStart, overlapEnd), patchedStyle, r.math));
      if (overlapEnd < r.text.length) {
        newRuns.push(makeRun(r.text.slice(overlapEnd), baseStyle));
      }
    }
    return { ...p, runs: newRuns };
  });

  return normalizeParagraphs(next, defaults);
}

// Aumenta o reduce el tamaño de fuente de forma relativa por cada tramo dentro de [start, end)
export function stepFontSizeInRange(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  delta: number,
  defaults: ResolvedTextRunStyle
): RichTextParagraph[] {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) return paragraphs;

  const ranges = getParagraphFlatRanges(paragraphs);
  const next = paragraphs.map((p, i) => {
    const pStart = ranges[i].start;
    const pEnd = ranges[i].end;
    if (pStart === pEnd) {
      if (start <= pStart && end >= pStart) {
        const cur = resolveRunStyle(p.runs[0], defaults);
        return {
          ...p,
          runs: [
            makeRun('', {
              ...cur,
              fontSize: stepFontSizeValue(cur.fontSize, delta),
            }),
          ],
        };
      }
      return p;
    }
    if (end <= pStart || start >= pEnd) return p;

    const newRuns: TextRun[] = [];
    let acc = pStart;
    for (const r of p.runs) {
      const rStart = acc;
      const rEnd = acc + r.text.length;
      acc = rEnd;
      const baseStyle = resolveRunStyle(r, defaults);

      if (rEnd <= start || rStart >= end) {
        newRuns.push(makeRun(r.text, baseStyle, r.math));
        continue;
      }

      const overlapStart = Math.max(start, rStart) - rStart;
      const overlapEnd = Math.min(end, rEnd) - rStart;

      if (overlapStart > 0) {
        newRuns.push(makeRun(r.text.slice(0, overlapStart), baseStyle));
      }
      newRuns.push(
        makeRun(
          r.text.slice(overlapStart, overlapEnd),
          {
            ...baseStyle,
            fontSize: stepFontSizeValue(baseStyle.fontSize, delta),
          },
          r.math
        )
      );
      if (overlapEnd < r.text.length) {
        newRuns.push(makeRun(r.text.slice(overlapEnd), baseStyle));
      }
    }
    return { ...p, runs: newRuns };
  });

  return normalizeParagraphs(next, defaults);
}

// Aplica alineación a todos los párrafos tocados por la selección o cursor
export function applyParagraphAlignToRange(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  align: TextAlign,
  defaults: ResolvedTextRunStyle
): RichTextParagraph[] {
  const safeAlign = normalizeTextAlign(align);
  const touched = new Set(getTouchedParagraphIndices(paragraphs, selection));
  const next = paragraphs.map((p, idx) =>
    touched.has(idx) ? { ...p, align: safeAlign } : p
  );
  return normalizeParagraphs(next, defaults);
}

// Aplica un estilo en línea a TODO el contenido de todos los párrafos (cuando el objeto está seleccionado sin editar texto)
export function applyStyleToAllParagraphs(
  paragraphs: RichTextParagraph[],
  patch: Partial<TextRunStyle>,
  defaults: ResolvedTextRunStyle
): RichTextParagraph[] {
  const next = paragraphs.map((p) => ({
    ...p,
    runs: p.runs.map((r) => {
      const resolved = resolveRunStyle({ ...resolveRunStyle(r, defaults), ...patch }, defaults);
      return makeRun(r.text, resolved, r.math);
    }),
  }));
  return normalizeParagraphs(next, defaults);
}

// Aplica una alineación a todos los párrafos del cuadro de texto
export function applyAlignToAllParagraphs(
  paragraphs: RichTextParagraph[],
  align: TextAlign,
  defaults: ResolvedTextRunStyle
): RichTextParagraph[] {
  const safeAlign = normalizeTextAlign(align);
  return normalizeParagraphs(
    paragraphs.map((p) => ({ ...p, align: safeAlign })),
    defaults,
    safeAlign
  );
}

// Divide un párrafo en dos en un offset local conservando los estilos y la alineación
function splitParagraphAtLocalOffset(
  paragraph: RichTextParagraph,
  localOffset: number,
  defaults: ResolvedTextRunStyle
): { before: RichTextParagraph; after: RichTextParagraph } {
  const align = normalizeTextAlign(paragraph.align, 'left');
  const beforeRuns: TextRun[] = [];
  const afterRuns: TextRun[] = [];
  let acc = 0;
  let lastBeforeStyle = resolveRunStyle(paragraph.runs[0], defaults);

  for (const r of paragraph.runs) {
    const st = resolveRunStyle(r, defaults);
    const rStart = acc;
    const rEnd = acc + r.text.length;
    acc = rEnd;

    if (rEnd <= localOffset) {
      if (r.text.length > 0) {
        beforeRuns.push(makeRun(r.text, st, r.math));
        lastBeforeStyle = st;
      }
    } else if (rStart >= localOffset) {
      if (r.text.length > 0) {
        afterRuns.push(makeRun(r.text, st, r.math));
      }
    } else {
      const splitIdx = localOffset - rStart;
      const left = r.text.slice(0, splitIdx);
      const right = r.text.slice(splitIdx);
      if (left.length > 0) {
        beforeRuns.push(makeRun(left, st));
        lastBeforeStyle = st;
      }
      if (right.length > 0) {
        afterRuns.push(makeRun(right, st));
      }
    }
  }

  return {
    before: {
      align,
      runs: beforeRuns.length > 0 ? beforeRuns : [makeRun('', lastBeforeStyle)],
    },
    after: {
      align,
      runs: afterRuns.length > 0 ? afterRuns : [makeRun('', lastBeforeStyle)],
    },
  };
}

// Elimina el rango [start, end) (puede cruzar múltiples párrafos) y devuelve el nuevo arreglo y la posición del cursor
export function removeRangeFromParagraphs(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  defaults: ResolvedTextRunStyle
): { paragraphs: RichTextParagraph[]; caretOffset: number } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) {
    return { paragraphs: normalizeParagraphs(paragraphs, defaults), caretOffset: start };
  }

  const startPos = flatOffsetToParagraphPos(paragraphs, start);
  const endPos = flatOffsetToParagraphPos(paragraphs, end);

  const head = splitParagraphAtLocalOffset(
    paragraphs[startPos.paragraphIndex],
    startPos.localOffset,
    defaults
  ).before;
  const tail = splitParagraphAtLocalOffset(
    paragraphs[endPos.paragraphIndex],
    endPos.localOffset,
    defaults
  ).after;

  const headLen = head.runs.reduce((s, r) => s + r.text.length, 0);
  const tailLen = tail.runs.reduce((s, r) => s + r.text.length, 0);
  const mergedRuns =
    headLen === 0 && tailLen === 0
      ? head.runs
      : [
          ...(headLen > 0 ? head.runs : []),
          ...(tailLen > 0 ? tail.runs : []),
        ];

  const mergedParagraph: RichTextParagraph = {
    align: head.align,
    runs: mergedRuns,
  };

  const next = [
    ...paragraphs.slice(0, startPos.paragraphIndex),
    mergedParagraph,
    ...paragraphs.slice(endPos.paragraphIndex + 1),
  ];

  return {
    paragraphs: normalizeParagraphs(next, defaults),
    caretOffset: start,
  };
}

// Inserta texto plano (con posibles '\n') en la selección actual usando activeStyle
export function insertTextAtRange(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  text: string,
  activeStyle: ResolvedTextRunStyle,
  defaults: ResolvedTextRunStyle
): { paragraphs: RichTextParagraph[]; caretOffset: number } {
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const afterDelete = removeRangeFromParagraphs(paragraphs, selection, defaults);
  const pos = flatOffsetToParagraphPos(afterDelete.paragraphs, afterDelete.caretOffset);
  const targetP = afterDelete.paragraphs[pos.paragraphIndex];
  const { before, after } = splitParagraphAtLocalOffset(
    targetP,
    pos.localOffset,
    defaults
  );

  const lines = normalizedText.split('\n');
  if (lines.length === 1) {
    const insertedRun = makeRun(lines[0], activeStyle);
    const updatedP: RichTextParagraph = {
      align: targetP.align,
      runs: [...before.runs, insertedRun, ...after.runs],
    };
    const next = [
      ...afterDelete.paragraphs.slice(0, pos.paragraphIndex),
      updatedP,
      ...afterDelete.paragraphs.slice(pos.paragraphIndex + 1),
    ];
    return {
      paragraphs: normalizeParagraphs(next, defaults),
      caretOffset: afterDelete.caretOffset + lines[0].length,
    };
  }

  const insertedParagraphs: RichTextParagraph[] = lines.map((line, idx) => {
    const runs: TextRun[] = [];
    if (idx === 0) runs.push(...before.runs);
    runs.push(makeRun(line, activeStyle));
    if (idx === lines.length - 1) runs.push(...after.runs);
    return { align: targetP.align, runs };
  });

  const next = [
    ...afterDelete.paragraphs.slice(0, pos.paragraphIndex),
    ...insertedParagraphs,
    ...afterDelete.paragraphs.slice(pos.paragraphIndex + 1),
  ];
  return {
    paragraphs: normalizeParagraphs(next, defaults),
    caretOffset: afterDelete.caretOffset + normalizedText.length,
  };
}

// Obtiene el estilo resuelto exacto del primer carácter dentro de [startOffset, ...)
export function getRunStyleAtOffset(
  paragraphs: RichTextParagraph[],
  flatOffset: number,
  defaults: ResolvedTextRunStyle
): ResolvedTextRunStyle {
  const safeParagraphs = Array.isArray(paragraphs) && paragraphs.length > 0 ? paragraphs : [];
  if (safeParagraphs.length === 0) return defaults;
  const pos = flatOffsetToParagraphPos(safeParagraphs, flatOffset);
  const p = safeParagraphs[pos.paragraphIndex];
  if (!p || !Array.isArray(p.runs) || p.runs.length === 0) return defaults;

  let acc = 0;
  for (const r of p.runs) {
    const nextAcc = acc + r.text.length;
    if (pos.localOffset < nextAcc) {
      return resolveRunStyle(r, defaults);
    }
    acc = nextAcc;
  }
  return resolveRunStyle(p.runs[p.runs.length - 1], defaults);
}

// Reemplaza únicamente el rango [start, end) por `replacement` conservando el estilo del tramo original
export function replaceWordPreservingRunStyle(
  paragraphs: RichTextParagraph[],
  start: number,
  end: number,
  replacement: string,
  defaults: ResolvedTextRunStyle
): { paragraphs: RichTextParagraph[]; caretOffset: number } {
  const minPos = Math.max(0, Math.min(start, end));
  const maxPos = Math.max(minPos, Math.max(start, end));
  const wordStyle = getRunStyleAtOffset(paragraphs, minPos, defaults);
  return insertTextAtRange(
    paragraphs,
    { start: minPos, end: maxPos },
    replacement,
    wordStyle,
    defaults
  );
}

// Inserta o actualiza una expresión matemática LaTeX atómica en el rango [start, end)
export function replaceRangeWithMathRun(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  math: TextRunMath,
  activeStyle: ResolvedTextRunStyle,
  defaults: ResolvedTextRunStyle
): { paragraphs: RichTextParagraph[]; caretOffset: number } {
  const safeMath = sanitizeRunMath(math) || { latex: '\\square' };
  const afterDelete = removeRangeFromParagraphs(paragraphs, selection, defaults);
  const pos = flatOffsetToParagraphPos(afterDelete.paragraphs, afterDelete.caretOffset);
  const targetP = afterDelete.paragraphs[pos.paragraphIndex];
  const { before, after } = splitParagraphAtLocalOffset(
    targetP,
    pos.localOffset,
    defaults
  );
  const mathRun = makeRun(INLINE_MATH_PLACEHOLDER, resolveRunStyle(activeStyle, defaults), safeMath);
  const updatedP: RichTextParagraph = {
    align: targetP.align,
    runs: [...before.runs, mathRun, ...after.runs],
  };
  const next = [
    ...afterDelete.paragraphs.slice(0, pos.paragraphIndex),
    updatedP,
    ...afterDelete.paragraphs.slice(pos.paragraphIndex + 1),
  ];
  return {
    paragraphs: normalizeParagraphs(next, defaults),
    caretOffset: afterDelete.caretOffset + 1,
  };
}

// Inserta párrafos enriquecidos (por ejemplo desde pegado HTML sanitizado) preservando la alineación del párrafo destino
export function insertParagraphsAtRange(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  inserted: RichTextParagraph[],
  defaults: ResolvedTextRunStyle
): { paragraphs: RichTextParagraph[]; caretOffset: number } {
  if (inserted.length === 0) {
    return removeRangeFromParagraphs(paragraphs, selection, defaults);
  }

  const afterDelete = removeRangeFromParagraphs(paragraphs, selection, defaults);
  const pos = flatOffsetToParagraphPos(afterDelete.paragraphs, afterDelete.caretOffset);
  const targetP = afterDelete.paragraphs[pos.paragraphIndex];
  const { before, after } = splitParagraphAtLocalOffset(
    targetP,
    pos.localOffset,
    defaults
  );

  const plainInsertedLen = paragraphsToPlainText(inserted).length;

  if (inserted.length === 1) {
    const updatedP: RichTextParagraph = {
      align: targetP.align,
      runs: [...before.runs, ...inserted[0].runs, ...after.runs],
    };
    const next = [
      ...afterDelete.paragraphs.slice(0, pos.paragraphIndex),
      updatedP,
      ...afterDelete.paragraphs.slice(pos.paragraphIndex + 1),
    ];
    return {
      paragraphs: normalizeParagraphs(next, defaults),
      caretOffset: afterDelete.caretOffset + plainInsertedLen,
    };
  }

  const built: RichTextParagraph[] = inserted.map((p, idx) => {
    const runs: TextRun[] = [];
    if (idx === 0) runs.push(...before.runs);
    runs.push(...p.runs);
    if (idx === inserted.length - 1) runs.push(...after.runs);
    return {
      align: targetP.align,
      runs,
    };
  });

  const next = [
    ...afterDelete.paragraphs.slice(0, pos.paragraphIndex),
    ...built,
    ...afterDelete.paragraphs.slice(pos.paragraphIndex + 1),
  ];

  return {
    paragraphs: normalizeParagraphs(next, defaults),
    caretOffset: afterDelete.caretOffset + plainInsertedLen,
  };
}

// Ejecuta borrado hacia atrás (Backspace) o hacia adelante (Delete) respetando límites de párrafo y estilos
export function deleteTextInRange(
  paragraphs: RichTextParagraph[],
  selection: TextSelectionRange,
  direction: 'backward' | 'forward',
  defaults: ResolvedTextRunStyle
): { paragraphs: RichTextParagraph[]; caretOffset: number } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start !== end) {
    return removeRangeFromParagraphs(paragraphs, { start, end }, defaults);
  }

  const totalLen = paragraphsToPlainText(paragraphs).length;
  if (direction === 'backward') {
    if (start <= 0) {
      return { paragraphs: normalizeParagraphs(paragraphs, defaults), caretOffset: 0 };
    }
    return removeRangeFromParagraphs(
      paragraphs,
      { start: start - 1, end: start },
      defaults
    );
  }

  if (start >= totalLen) {
    return { paragraphs: normalizeParagraphs(paragraphs, defaults), caretOffset: totalLen };
  }
  return removeRangeFromParagraphs(
    paragraphs,
    { start, end: start + 1 },
    defaults
  );
}

// Etiquetas HTML de bloque que generan salto de párrafo al pegar contenido externo
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'TR',
]);

// Etiquetas inseguras o no textuales que deben descartarse por completo al pegar HTML
const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'SVG',
  'HEAD',
  'META',
  'LINK',
  'TITLE',
]);

interface PasteInlineStyleState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  color: string;
  fontFamily: TextFontFamily;
}

export interface SanitizedHtmlParseOptions {
  allowSpanStyles?: boolean;
}

// Valida un color CSS permitido (#hex o rgb/rgba) evitando valores arbitrarios o inyección
function sanitizeCssColor(raw: string): string | null {
  const v = raw.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(v)) {
    return v;
  }
  return null;
}

// Mapea una familia CSS externa al catálogo de fuentes soportadas por la pizarra
function mapCssFontFamily(raw: string): TextFontFamily | null {
  const v = raw.toLowerCase();
  if (v.includes('comic')) return 'comic-sans';
  if (v.includes('times')) return 'times';
  if (v.includes('tahoma')) return 'tahoma';
  if (v.includes('arial')) return 'arial';
  if (v.includes('acme')) return 'acme';
  if (v.includes('alatsi')) return 'alatsi';
  if (v.includes('mono') || v.includes('courier') || v.includes('consolas')) return 'mono';
  if (v.includes('georgia') || v.includes('serif')) return 'serif';
  if (v.includes('sans')) return 'sans';
  return null;
}

// Extrae únicamente propiedades seguras de un atributo style inline
function extractInlineStylePatch(
  inlineStyle: string,
  prev: PasteInlineStyleState,
  tag: string,
  allowSpanStyles: boolean
): PasteInlineStyleState {
  const styleWeightMatch = inlineStyle.match(/font-weight\s*:\s*([^;]+)/i);
  const weightVal = styleWeightMatch?.[1]?.trim().toLowerCase() ?? '';
  const numericWeight = Number.parseInt(weightVal, 10);
  const isStyleBold =
    weightVal === 'bold' ||
    weightVal === 'bolder' ||
    (!Number.isNaN(numericWeight) && numericWeight >= 600);
  const isStyleItalic = /font-style\s*:\s*(italic|oblique)/i.test(inlineStyle);
  const isStyleUnderline = /text-decoration(?:-line)?\s*:[^;]*underline/i.test(inlineStyle);

  let nextFontSize = prev.fontSize;
  let nextColor = prev.color;
  let nextFontFamily = prev.fontFamily;

  if (allowSpanStyles && (tag === 'SPAN' || tag === 'P' || tag === 'DIV')) {
    const sizeMatch = inlineStyle.match(/font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px/i);
    if (sizeMatch) {
      nextFontSize = clampTextFontSize(Number.parseFloat(sizeMatch[1]));
    }
    const colorMatch = inlineStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (colorMatch) {
      const safeColor = sanitizeCssColor(colorMatch[1]);
      if (safeColor) nextColor = safeColor;
    }
    const fontMatch = inlineStyle.match(/font-family\s*:\s*([^;]+)/i);
    if (fontMatch) {
      const mapped = mapCssFontFamily(fontMatch[1]);
      if (mapped) nextFontFamily = mapped;
    }
  }

  return {
    bold: prev.bold || tag === 'B' || tag === 'STRONG' || isStyleBold,
    italic: prev.italic || tag === 'I' || tag === 'EM' || tag === 'CITE' || isStyleItalic,
    underline: prev.underline || tag === 'U' || tag === 'INS' || isStyleUnderline,
    fontSize: nextFontSize,
    color: nextColor,
    fontFamily: nextFontFamily,
  };
}

// Analiza HTML sanitizado: limita a etiquetas seguras (negrita, cursiva, subrayado, spans con estilo opcional y saltos de párrafo)
export function parseSanitizedHtmlToParagraphs(
  html: string,
  plainFallback: string,
  baseStyle: ResolvedTextRunStyle = FALLBACK_DEFAULTS,
  options?: SanitizedHtmlParseOptions
): RichTextParagraph[] {
  const safeBase = resolveRunStyle(baseStyle, FALLBACK_DEFAULTS);
  const allowSpanStyles = Boolean(options?.allowSpanStyles);
  const trimmedHtml = typeof html === 'string' ? html.trim() : '';
  if (!trimmedHtml) {
    return createParagraphsFromPlainText(plainFallback, safeBase);
  }

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmedHtml, 'text/html');
      const resultParagraphs: RichTextParagraph[] = [{ runs: [] }];

      const pushNewLine = () => {
        resultParagraphs.push({ runs: [] });
      };

      const appendText = (text: string, st: PasteInlineStyleState) => {
        if (!text) return;
        const normalized = text.replace(/\r\n?/g, '\n');
        const parts = normalized.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) pushNewLine();
          const segment = parts[i];
          if (segment.length > 0) {
            resultParagraphs[resultParagraphs.length - 1].runs.push({
              text: segment,
              bold: st.bold,
              italic: st.italic,
              underline: st.underline,
              fontSize: st.fontSize,
              color: st.color,
              fontFamily: st.fontFamily,
            });
          }
        }
      };

      const walk = (node: Node, st: PasteInlineStyleState) => {
        if (node.nodeType === 3) {
          appendText(node.textContent || '', st);
          return;
        }
        if (node.nodeType !== 1) return;

        const el = node as HTMLElement;
        const tag = el.tagName.toUpperCase();
        if (IGNORED_TAGS.has(tag)) return;

        if (el.getAttribute('data-rt-math') === '1' && el.hasAttribute('data-latex')) {
          const inlineStyle = el.getAttribute('style') || '';
          const mathStyle = extractInlineStylePatch(inlineStyle, st, tag, allowSpanStyles);
          const latexAttr = el.getAttribute('data-latex') || '\\square';
          const displayMode = el.getAttribute('data-display') === '1';
          resultParagraphs[resultParagraphs.length - 1].runs.push(
            makeRun(
              INLINE_MATH_PLACEHOLDER,
              resolveRunStyle(mathStyle, safeBase),
              { latex: latexAttr, ...(displayMode ? { displayMode: true } : {}) }
            )
          );
          return;
        }

        if (tag === 'BR') {
          pushNewLine();
          return;
        }

        const inlineStyle = el.getAttribute('style') || '';
        const nextState = extractInlineStylePatch(inlineStyle, st, tag, allowSpanStyles);

        const isBlock = BLOCK_TAGS.has(tag);
        const currentP = resultParagraphs[resultParagraphs.length - 1];
        if (isBlock && currentP.runs.length > 0) {
          pushNewLine();
        }

        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i], nextState);
        }

        if (isBlock && resultParagraphs[resultParagraphs.length - 1].runs.length > 0) {
          pushNewLine();
        }
      };

      walk(doc.body, {
        bold: safeBase.bold,
        italic: safeBase.italic,
        underline: safeBase.underline,
        fontSize: safeBase.fontSize,
        color: safeBase.color,
        fontFamily: safeBase.fontFamily,
      });

      while (
        resultParagraphs.length > 1 &&
        resultParagraphs[resultParagraphs.length - 1].runs.length === 0
      ) {
        resultParagraphs.pop();
      }

      const normalized = normalizeParagraphs(resultParagraphs, safeBase);
      const plain = paragraphsToPlainText(normalized);
      if (plain.length === 0 && plainFallback) {
        return createParagraphsFromPlainText(plainFallback, safeBase);
      }
      return normalized;
    } catch {
      // Continúa con el respaldo ligero
    }
  }

  return parseSanitizedHtmlLightweight(trimmedHtml, plainFallback, safeBase, allowSpanStyles);
}

// Analizador ligero sin dependencias del DOM para entornos sin DOMParser
function parseSanitizedHtmlLightweight(
  html: string,
  plainFallback: string,
  baseStyle: ResolvedTextRunStyle,
  allowSpanStyles: boolean
): RichTextParagraph[] {
  const cleaned = html
    .replace(/<(script|style|noscript|iframe|object|embed|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const paragraphs: RichTextParagraph[] = [{ runs: [] }];
  const stack: PasteInlineStyleState[] = [
    {
      bold: baseStyle.bold,
      italic: baseStyle.italic,
      underline: baseStyle.underline,
      fontSize: baseStyle.fontSize,
      color: baseStyle.color,
      fontFamily: baseStyle.fontFamily,
    },
  ];

  const tokenRegex = /(<\/?[a-zA-Z0-9]+(?:\s[^>]*)?>)|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(cleaned)) !== null) {
    const tagToken = match[1];
    const textToken = match[2];

    if (textToken !== undefined) {
      const decoded = textToken
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\r\n?/g, '\n');

      const cur = stack[stack.length - 1];
      const parts = decoded.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) paragraphs.push({ runs: [] });
        if (parts[i].length > 0) {
          paragraphs[paragraphs.length - 1].runs.push({
            text: parts[i],
            bold: cur.bold,
            italic: cur.italic,
            underline: cur.underline,
            fontSize: cur.fontSize,
            color: cur.color,
            fontFamily: cur.fontFamily,
          });
        }
      }
      continue;
    }

    if (tagToken) {
      const isClosing = tagToken.startsWith('</');
      const isSelfClosing = tagToken.endsWith('/>');
      const tagNameMatch = tagToken.match(/^<\/?([a-zA-Z0-9]+)/);
      const tag = tagNameMatch ? tagNameMatch[1].toUpperCase() : '';
      if (!tag) continue;

      if (tag === 'BR') {
        paragraphs.push({ runs: [] });
        continue;
      }

      if (isClosing) {
        if (BLOCK_TAGS.has(tag) && paragraphs[paragraphs.length - 1].runs.length > 0) {
          paragraphs.push({ runs: [] });
        }
        if (stack.length > 1) stack.pop();
        continue;
      }

      const prev = stack[stack.length - 1];
      const styleMatch = tagToken.match(/style\s*=\s*(['"])([\s\S]*?)\1/i);
      const inlineStyle = styleMatch?.[2] || '';

      if (BLOCK_TAGS.has(tag) && paragraphs[paragraphs.length - 1].runs.length > 0) {
        paragraphs.push({ runs: [] });
      }

      if (!isSelfClosing) {
        stack.push(extractInlineStylePatch(inlineStyle, prev, tag, allowSpanStyles));
      }
    }
  }

  while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1].runs.length === 0) {
    paragraphs.pop();
  }

  const normalized = normalizeParagraphs(paragraphs, baseStyle);
  if (paragraphsToPlainText(normalized).length === 0 && plainFallback) {
    return createParagraphsFromPlainText(plainFallback, baseStyle);
  }
  return normalized;
}

// Sincroniza un TextObject con su arreglo actualizado de párrafos y propiedades de respaldo
export function syncTextObjectFromParagraphs(
  obj: TextObject,
  paragraphs: RichTextParagraph[],
  extraPatch?: Partial<TextObject>
): TextObject {
  const defaults = getDefaultRunStyle(obj);
  const normalized = normalizeParagraphs(paragraphs, defaults, obj.align);
  const plain = paragraphsToPlainText(normalized);
  const firstRun = resolveRunStyle(normalized[0]?.runs[0], defaults);
  const firstAlign = normalizeTextAlign(normalized[0]?.align, obj.align);

  return {
    ...obj,
    ...extraPatch,
    content: plain,
    paragraphs: normalized,
    bold: firstRun.bold,
    italic: firstRun.italic,
    underline: firstRun.underline,
    fontSize: firstRun.fontSize,
    color: firstRun.color,
    fontFamily: firstRun.fontFamily,
    align: firstAlign,
  };
}
