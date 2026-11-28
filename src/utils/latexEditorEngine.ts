// OPT: 1.1 — Carga diferida de KaTeX bajo demanda
import { renderKatexToStringLazy, renderLatexFallbackHtml } from './katexLoader';

export interface CursorStep {
  nodeIdx: number;
  slot: string;
}

export interface MathCursor {
  path: CursorStep[];
  offset: number;
}

// V1.11.8-7: Rango de subselección dentro de una misma secuencia del AST de ecuación
export interface MathSelectionRange {
  path: CursorStep[];
  start: number;
  end: number;
}

export const MATH_RELATIVE_SIZE_OPTIONS = [
  { cmd: '\\tiny', label: 'Muy pequeño' },
  { cmd: '\\scriptsize', label: 'Subíndice' },
  { cmd: '\\footnotesize', label: 'Nota' },
  { cmd: '\\small', label: 'Pequeño' },
  { cmd: '\\normalsize', label: 'Normal' },
  { cmd: '\\large', label: 'Grande' },
  { cmd: '\\Large', label: 'Más grande' },
  { cmd: '\\LARGE', label: 'Enorme' },
  { cmd: '\\huge', label: 'Gigante' },
  { cmd: '\\Huge', label: 'Máximo' },
] as const;

const MATH_RELATIVE_SIZE_SET = new Set<string>(
  MATH_RELATIVE_SIZE_OPTIONS.map((o) => o.cmd)
);

export type MathNode =
  | { kind: 'char'; value: string }
  | { kind: 'cmd'; tex: string }
  | { kind: 'slot' }
  | { kind: 'frac'; num: MathNode[]; den: MathNode[] }
  | { kind: 'binom'; top: MathNode[]; bot: MathNode[] }
  | { kind: 'sqrt'; deg?: MathNode[]; rad: MathNode[] }
  | { kind: 'supsub'; sub?: MathNode[]; sup?: MathNode[] }
  | { kind: 'accent'; cmd: string; body: MathNode[] }
  | { kind: 'oversub'; cmd: string; a: MathNode[]; b: MathNode[] }
  | { kind: 'delim'; left: string; right: string; body: MathNode[] }
  | { kind: 'env'; env: string; rows: MathNode[][][] }
  | { kind: 'styled'; styleKind: 'color' | 'size'; cmd: string; body: MathNode[] }
  | { kind: 'raw'; tex: string };

const LARGE_OP_CMDS = new Set([
  '\\sum',
  '\\prod',
  '\\coprod',
  '\\int',
  '\\iint',
  '\\iiint',
  '\\oint',
  '\\bigcup',
  '\\bigcap',
  '\\lim',
  '\\max',
  '\\min',
]);

const ACCENT_CMDS = new Set([
  '\\vec',
  '\\overrightarrow',
  '\\hat',
  '\\overline',
  '\\dot',
  '\\ddot',
  '\\xrightarrow',
]);

const RAW_ARG_CMDS = new Set([
  '\\mathbb',
  '\\mathbf',
  '\\mathrm',
  '\\mathcal',
  '\\text',
  '\\textbf',
  '\\textit',
]);

export function cursorsEqual(a: MathCursor, b: MathCursor): boolean {
  if (a.offset !== b.offset || a.path.length !== b.path.length) return false;
  for (let i = 0; i < a.path.length; i++) {
    if (a.path[i].nodeIdx !== b.path[i].nodeIdx || a.path[i].slot !== b.path[i].slot) {
      return false;
    }
  }
  return true;
}

export function cloneAst(nodes: MathNode[]): MathNode[] {
  return JSON.parse(JSON.stringify(nodes)) as MathNode[];
}

// ---------------- PARSER ----------------

interface ParserState {
  src: string;
  pos: number;
}

function skipSpaces(st: ParserState): void {
  while (st.pos < st.src.length && /\s/.test(st.src[st.pos])) {
    st.pos++;
  }
}

function readBalanced(st: ParserState, openChar: string, closeChar: string): string {
  if (st.src[st.pos] !== openChar) return '';
  st.pos++;
  let depth = 1;
  const start = st.pos;
  while (st.pos < st.src.length && depth > 0) {
    const ch = st.src[st.pos];
    if (ch === '\\' && st.pos + 1 < st.src.length) {
      st.pos += 2;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) depth--;
    if (depth > 0) st.pos++;
  }
  const inner = st.src.slice(start, st.pos);
  if (st.src[st.pos] === closeChar) st.pos++;
  return inner;
}

function readCommandName(st: ParserState): string {
  // st.src[st.pos] === '\\'
  st.pos++;
  if (st.pos >= st.src.length) return '\\';
  const ch = st.src[st.pos];
  if (!/[a-zA-Z]/.test(ch)) {
    st.pos++;
    return '\\' + ch;
  }
  let name = '\\';
  while (st.pos < st.src.length && /[a-zA-Z]/.test(st.src[st.pos])) {
    name += st.src[st.pos];
    st.pos++;
  }
  return name;
}

function readArgSeq(st: ParserState): MathNode[] {
  skipSpaces(st);
  if (st.pos >= st.src.length) return [{ kind: 'slot' }];
  if (st.src[st.pos] === '{') {
    const inner = readBalanced(st, '{', '}');
    const parsed = parseSequence(inner);
    return parsed.length > 0 ? parsed : [{ kind: 'slot' }];
  }
  const single = readSingleNode(st);
  return single ? [single] : [{ kind: 'slot' }];
}

function readDelimiterToken(st: ParserState): string {
  skipSpaces(st);
  if (st.pos >= st.src.length) return '.';
  if (st.src[st.pos] === '\\') {
    return readCommandName(st);
  }
  return st.src[st.pos++];
}

function splitEnvCells(body: string): MathNode[][][] {
  // Split by \\ outside nested braces/environments
  const rowsRaw: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === '\\' && body[i + 1] === '\\') {
      rowsRaw.push(body.slice(last, i));
      i++;
      last = i + 1;
    }
  }
  rowsRaw.push(body.slice(last));

  return rowsRaw.map((rowStr) => {
    const cellsRaw: string[] = [];
    let d = 0;
    let l = 0;
    for (let i = 0; i < rowStr.length; i++) {
      const ch = rowStr[i];
      if (ch === '\\' && i + 1 < rowStr.length) {
        i++;
        continue;
      }
      if (ch === '{') d++;
      else if (ch === '}') d = Math.max(0, d - 1);
      else if (d === 0 && ch === '&') {
        cellsRaw.push(rowStr.slice(l, i));
        l = i + 1;
      }
    }
    cellsRaw.push(rowStr.slice(l));
    return cellsRaw.map((c) => {
      const parsed = parseSequence(c);
      return parsed.length > 0 ? parsed : [{ kind: 'slot' }];
    });
  });
}

function readSingleNode(st: ParserState, stopOnRight = false): MathNode | null {
  skipSpaces(st);
  if (st.pos >= st.src.length) return null;

  const ch = st.src[st.pos];

  if (ch === '}') {
    st.pos++;
    return null;
  }

  if (ch === '{') {
    const inner = readBalanced(st, '{', '}');
    const styledGroup = tryParseStyledGroup(inner);
    if (styledGroup) return styledGroup;
    const seq = parseSequence(inner);
    if (seq.length === 0) return { kind: 'slot' };
    if (seq.length === 1) return seq[0];
    return { kind: 'raw', tex: `{${inner}}` };
  }

  if (ch === '^' || ch === '_') {
    const node: MathNode = { kind: 'supsub' };
    while (st.pos < st.src.length) {
      skipSpaces(st);
      const marker = st.src[st.pos];
      if (marker === '^' && !node.sup) {
        st.pos++;
        node.sup = readArgSeq(st);
      } else if (marker === '_' && !node.sub) {
        st.pos++;
        node.sub = readArgSeq(st);
      } else {
        break;
      }
    }
    return node;
  }

  if (ch === '\\') {
    const savePos = st.pos;
    const cmd = readCommandName(st);

    if (cmd === '\\right') {
      if (stopOnRight) {
        st.pos = savePos;
        return null;
      }
      const d = readDelimiterToken(st);
      return { kind: 'raw', tex: `\\right${d}` };
    }

    if (cmd === '\\square') {
      return { kind: 'slot' };
    }

    if (cmd === '\\frac' || cmd === '\\dfrac' || cmd === '\\tfrac') {
      const num = readArgSeq(st);
      const den = readArgSeq(st);
      return { kind: 'frac', num, den };
    }

    if (cmd === '\\binom') {
      const top = readArgSeq(st);
      const bot = readArgSeq(st);
      return { kind: 'binom', top, bot };
    }

    if (cmd === '\\sqrt') {
      skipSpaces(st);
      let deg: MathNode[] | undefined;
      if (st.src[st.pos] === '[') {
        const degStr = readBalanced(st, '[', ']');
        const parsedDeg = parseSequence(degStr);
        deg = parsedDeg.length > 0 ? parsedDeg : [{ kind: 'slot' }];
      }
      const rad = readArgSeq(st);
      return { kind: 'sqrt', deg, rad };
    }

    if (cmd === '\\textcolor') {
      skipSpaces(st);
      const colorRaw = st.src[st.pos] === '{' ? readBalanced(st, '{', '}') : '';
      const safeColor = sanitizeMathColorToken(colorRaw) ?? '#0f172a';
      const body = readArgSeq(st);
      return { kind: 'styled', styleKind: 'color', cmd: safeColor, body };
    }

    if (MATH_RELATIVE_SIZE_SET.has(cmd)) {
      skipSpaces(st);
      if (st.src[st.pos] === '{') {
        const body = readArgSeq(st);
        return { kind: 'styled', styleKind: 'size', cmd, body };
      }
      return { kind: 'cmd', tex: cmd };
    }

    if (ACCENT_CMDS.has(cmd)) {
      const body = readArgSeq(st);
      return { kind: 'accent', cmd, body };
    }

    if (cmd === '\\overset') {
      const a = readArgSeq(st);
      const b = readArgSeq(st);
      return { kind: 'oversub', cmd, a, b };
    }

    if (cmd === '\\underbrace') {
      const a = readArgSeq(st);
      skipSpaces(st);
      let b: MathNode[] = [{ kind: 'slot' }];
      if (st.src[st.pos] === '_') {
        st.pos++;
        b = readArgSeq(st);
      }
      return { kind: 'oversub', cmd, a, b };
    }

    if (cmd === '\\left') {
      const leftDelim = readDelimiterToken(st);
      const body: MathNode[] = [];
      let rightDelim = '.';
      while (st.pos < st.src.length) {
        skipSpaces(st);
        if (st.src.startsWith('\\right', st.pos) && !/[a-zA-Z]/.test(st.src[st.pos + 6] || '')) {
          st.pos += 6;
          rightDelim = readDelimiterToken(st);
          break;
        }
        const n = readSingleNode(st, true);
        if (!n) break;
        body.push(n);
      }
      return {
        kind: 'delim',
        left: leftDelim,
        right: rightDelim,
        body: body.length > 0 ? body : [{ kind: 'slot' }],
      };
    }

    if (cmd === '\\begin') {
      skipSpaces(st);
      const envName = readBalanced(st, '{', '}').trim();
      const endTag = `\\end{${envName}}`;
      const endIdx = st.src.indexOf(endTag, st.pos);
      if (endIdx !== -1) {
        const inner = st.src.slice(st.pos, endIdx);
        st.pos = endIdx + endTag.length;
        return {
          kind: 'env',
          env: envName,
          rows: splitEnvCells(inner),
        };
      }
      return { kind: 'raw', tex: `\\begin{${envName}}` };
    }

    if (RAW_ARG_CMDS.has(cmd)) {
      skipSpaces(st);
      if (st.src[st.pos] === '{') {
        const arg = readBalanced(st, '{', '}');
        return { kind: 'raw', tex: `${cmd}{${arg}}` };
      }
    }

    return { kind: 'cmd', tex: cmd };
  }

  st.pos++;
  return { kind: 'char', value: ch };
}

// Recorta espacios ASCII de los extremos sin destruir comandos de espacio escapado ('\ ') al final
function trimMathSource(src: string): string {
  const leadTrimmed = src.replace(/^[ \t\r\n]+/, '');
  let end = leadTrimmed.length;
  while (end > 0 && /[ \t\r\n]/.test(leadTrimmed[end - 1])) {
    if (leadTrimmed[end - 1] === ' ') {
      let backslashes = 0;
      for (let k = end - 2; k >= 0 && leadTrimmed[k] === '\\'; k--) {
        backslashes++;
      }
      if (backslashes % 2 === 1) break;
    }
    end--;
  }
  return leadTrimmed.slice(0, end);
}

// V1.11.8-7: Sanitiza tokens de color para \textcolor / \color evitando inyecciones
function sanitizeMathColorToken(raw: string): string | null {
  const t = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`.toLowerCase();
  }
  if (/^[a-zA-Z]{2,20}$/.test(t)) return t;
  return null;
}

// V1.11.8-7: Reconoce grupos con estilo nativo KaTeX: {\large ...} o {\color{#hex} ...}
function tryParseStyledGroup(inner: string): MathNode | null {
  const trimmed = trimMathSource(inner);
  if (!trimmed.startsWith('\\')) return null;
  const st: ParserState = { src: trimmed, pos: 0 };
  const cmd = readCommandName(st);
  if (cmd === '\\color') {
    skipSpaces(st);
    const colorRaw = st.src[st.pos] === '{' ? readBalanced(st, '{', '}') : '';
    const safeColor = sanitizeMathColorToken(colorRaw);
    if (!safeColor) return null;
    const rest = trimmed.slice(st.pos);
    const body = parseSequence(rest);
    return {
      kind: 'styled',
      styleKind: 'color',
      cmd: safeColor,
      body: body.length > 0 ? body : [{ kind: 'slot' }],
    };
  }
  if (MATH_RELATIVE_SIZE_SET.has(cmd)) {
    const rest = trimmed.slice(st.pos);
    if (!rest.trim()) return null;
    const body = parseSequence(rest);
    return {
      kind: 'styled',
      styleKind: 'size',
      cmd,
      body: body.length > 0 ? body : [{ kind: 'slot' }],
    };
  }
  return null;
}

function parseSequence(src: string): MathNode[] {
  const st: ParserState = { src: trimMathSource(src), pos: 0 };
  const result: MathNode[] = [];
  while (st.pos < st.src.length) {
    skipSpaces(st);
    if (st.pos >= st.src.length) break;
    if (st.src[st.pos] === '{') {
      const inner = readBalanced(st, '{', '}');
      const styledGroup = tryParseStyledGroup(inner);
      if (styledGroup) {
        result.push(styledGroup);
        continue;
      }
      const innerNodes = parseSequence(inner);
      if (innerNodes.length === 0) {
        result.push({ kind: 'slot' });
      } else {
        result.push(...innerNodes);
      }
      continue;
    }
    const n = readSingleNode(st);
    if (n) {
      // Merge adjacent supsub nodes (e.g. a_{0}^{n} or a^{n}_{0})
      const prev = result[result.length - 1];
      if (n.kind === 'supsub' && prev?.kind === 'supsub') {
        if (n.sub && !prev.sub) {
          prev.sub = n.sub;
          continue;
        }
        if (n.sup && !prev.sup) {
          prev.sup = n.sup;
          continue;
        }
      }
      result.push(n);
    }
  }
  return result;
}

export function parseLatexToAst(latex: string): MathNode[] {
  const parsed = parseSequence(latex || '');
  return parsed.length > 0 ? parsed : [{ kind: 'slot' }];
}

// ---------------- SERIALIZER ----------------

function needsSpaceAfterCmd(cmdTex: string, nextStr: string): boolean {
  if (!/^\\[a-zA-Z]+$/.test(cmdTex)) return false;
  if (!nextStr) return false;
  return /^[a-zA-Z]/.test(nextStr);
}

export function serializeAstToLatex(nodes: MathNode[]): string {
  if (!nodes || nodes.length === 0) return '\\square';
  const parts: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    parts.push(serializeNode(node));
  }
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i];
    const next = parts[i + 1] || '';
    out += cur;
    if (nodes[i].kind === 'cmd' && needsSpaceAfterCmd(nodes[i].kind === 'cmd' ? (nodes[i] as { kind: 'cmd'; tex: string }).tex : '', next)) {
      out += ' ';
    } else if (nodes[i].kind === 'slot' && /^[a-zA-Z]/.test(next)) {
      out += ' ';
    }
  }
  return out;
}

function serializeNode(node: MathNode): string {
  switch (node.kind) {
    case 'char':
      return node.value;
    case 'cmd':
      return node.tex;
    case 'slot':
      return '\\square';
    case 'raw':
      return node.tex;
    case 'frac':
      return `\\frac{${serializeAstToLatex(node.num)}}{${serializeAstToLatex(node.den)}}`;
    case 'binom':
      return `\\binom{${serializeAstToLatex(node.top)}}{${serializeAstToLatex(node.bot)}}`;
    case 'sqrt':
      return node.deg
        ? `\\sqrt[${serializeAstToLatex(node.deg)}]{${serializeAstToLatex(node.rad)}}`
        : `\\sqrt{${serializeAstToLatex(node.rad)}}`;
    case 'supsub': {
      let s = '';
      if (node.sub) s += `_{${serializeAstToLatex(node.sub)}}`;
      if (node.sup) s += `^{${serializeAstToLatex(node.sup)}}`;
      return s;
    }
    case 'accent':
      return `${node.cmd}{${serializeAstToLatex(node.body)}}`;
    case 'oversub':
      if (node.cmd === '\\underbrace') {
        return `\\underbrace{${serializeAstToLatex(node.a)}}_{${serializeAstToLatex(node.b)}}`;
      }
      return `${node.cmd}{${serializeAstToLatex(node.a)}}{${serializeAstToLatex(node.b)}}`;
    case 'delim':
      return `\\left${node.left} ${serializeAstToLatex(node.body)} \\right${node.right}`;
    case 'env': {
      const rowStrs = node.rows.map((r) => r.map((c) => serializeAstToLatex(c)).join(' & '));
      return `\\begin{${node.env}} ${rowStrs.join(' \\\\ ')} \\end{${node.env}}`;
    }
    case 'styled': {
      const bodyStr = serializeAstToLatex(node.body);
      if (node.styleKind === 'color') {
        return `\\textcolor{${node.cmd}}{${bodyStr}}`;
      }
      return `{${node.cmd} ${bodyStr}}`;
    }
  }
}

// ---------------- CHILD CONTAINER METADATA ----------------

export function getChildSlots(node: MathNode): { slot: string; seq: MathNode[] }[] {
  switch (node.kind) {
    case 'frac':
      return [
        { slot: 'num', seq: node.num },
        { slot: 'den', seq: node.den },
      ];
    case 'binom':
      return [
        { slot: 'top', seq: node.top },
        { slot: 'bot', seq: node.bot },
      ];
    case 'sqrt':
      return node.deg
        ? [
            { slot: 'deg', seq: node.deg },
            { slot: 'rad', seq: node.rad },
          ]
        : [{ slot: 'rad', seq: node.rad }];
    case 'supsub': {
      const list: { slot: string; seq: MathNode[] }[] = [];
      if (node.sub) list.push({ slot: 'sub', seq: node.sub });
      if (node.sup) list.push({ slot: 'sup', seq: node.sup });
      return list;
    }
    case 'accent':
      return [{ slot: 'body', seq: node.body }];
    case 'oversub':
      return [
        { slot: 'a', seq: node.a },
        { slot: 'b', seq: node.b },
      ];
    case 'delim':
      return [{ slot: 'body', seq: node.body }];
    case 'env': {
      const list: { slot: string; seq: MathNode[] }[] = [];
      for (let r = 0; r < node.rows.length; r++) {
        for (let c = 0; c < node.rows[r].length; c++) {
          list.push({ slot: `${r}.${c}`, seq: node.rows[r][c] });
        }
      }
      return list;
    }
    case 'styled':
      return [{ slot: 'body', seq: node.body }];
    default:
      return [];
  }
}

export function getSeqAtPath(root: MathNode[], path: CursorStep[]): MathNode[] | null {
  let cur = root;
  for (const step of path) {
    const node = cur[step.nodeIdx];
    if (!node) return null;
    const found = getChildSlots(node).find((s) => s.slot === step.slot);
    if (!found) return null;
    cur = found.seq;
  }
  return cur;
}

export function clampCursor(root: MathNode[], cursor: MathCursor): MathCursor {
  const seq = getSeqAtPath(root, cursor.path);
  if (!seq) {
    return { path: [], offset: root.length };
  }
  return {
    path: cursor.path,
    offset: Math.max(0, Math.min(seq.length, cursor.offset)),
  };
}

// ---------------- INTERACTIVE RENDERING ----------------

export function encodePath(path: CursorStep[]): string {
  if (path.length === 0) return 'r';
  return path.map((s) => `${s.nodeIdx}-${s.slot}`).join('_');
}

export function decodePath(encoded: string): CursorStep[] {
  if (!encoded || encoded === 'r') return [];
  return encoded.split('_').map((seg) => {
    const dash = seg.indexOf('-');
    return {
      nodeIdx: Number(seg.slice(0, dash)),
      slot: seg.slice(dash + 1),
    };
  });
}

function pathEqual(a: CursorStep[], b: CursorStep[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, idx) => s.nodeIdx === b[idx].nodeIdx && s.slot === b[idx].slot)
  );
}

function renderSeqForEditing(
  nodes: MathNode[],
  path: CursorStep[],
  cursor: MathCursor,
  selection?: MathSelectionRange | null
): string {
  const pathKey = encodePath(path);
  const isActiveSeq = pathEqual(path, cursor.path);
  const hasSelInSeq =
    Boolean(selection) &&
    selection!.start !== selection!.end &&
    pathEqual(path, selection!.path);
  const selLo = hasSelInSeq ? Math.max(0, Math.min(selection!.start, selection!.end)) : -1;
  const selHi = hasSelInSeq ? Math.min(nodes.length, Math.max(selection!.start, selection!.end)) : -1;

  const pieces: string[] = [];
  const selectedPieces: string[] = [];

  const pushPiece = (nodeIdx: number, texPiece: string) => {
    if (hasSelInSeq && nodeIdx >= selLo && nodeIdx < selHi) {
      selectedPieces.push(texPiece);
      if (nodeIdx === selHi - 1) {
        pieces.push(`\\htmlClass{eq-sel-range}{${selectedPieces.join(' ')}}`);
        selectedPieces.length = 0;
      }
    } else {
      pieces.push(texPiece);
    }
  };

  for (let i = 0; i <= nodes.length; i++) {
    if (isActiveSeq && cursor.offset === i) {
      const atSlot = nodes[i]?.kind === 'slot';
      if (!atSlot) {
        pieces.push('\\htmlClass{eq-caret-marker}{\\kern0pt}');
      }
    }
    if (i === nodes.length) break;

    const node = nodes[i];
    const children = getChildSlots(node);

    if (children.length === 0) {
      if (node.kind === 'slot') {
        const isCurrentSlot = isActiveSeq && cursor.offset === i;
        if (isCurrentSlot) {
          pushPiece(
            i,
            `\\htmlData{p=${pathKey},i=${i},s=1}{\\htmlClass{eq-active-slot}{\\square}}\\htmlClass{eq-caret-marker}{\\kern0pt}`
          );
        } else {
          pushPiece(i, `\\htmlData{p=${pathKey},i=${i},s=1}{\\square}`);
        }
      } else {
        const inner = serializeNode(node);
        if (node.kind === 'cmd' && LARGE_OP_CMDS.has(node.tex)) {
          pushPiece(i, `\\mathop{\\htmlData{p=${pathKey},i=${i}}{${inner}}}`);
        } else {
          pushPiece(i, `\\htmlData{p=${pathKey},i=${i}}{${inner}}`);
        }
      }
    } else {
      switch (node.kind) {
        case 'frac': {
          const numTex = renderSeqForEditing(node.num, [...path, { nodeIdx: i, slot: 'num' }], cursor, selection);
          const denTex = renderSeqForEditing(node.den, [...path, { nodeIdx: i, slot: 'den' }], cursor, selection);
          pushPiece(i, `\\frac{${numTex}}{${denTex}}`);
          break;
        }
        case 'binom': {
          const topTex = renderSeqForEditing(node.top, [...path, { nodeIdx: i, slot: 'top' }], cursor, selection);
          const botTex = renderSeqForEditing(node.bot, [...path, { nodeIdx: i, slot: 'bot' }], cursor, selection);
          pushPiece(i, `\\binom{${topTex}}{${botTex}}`);
          break;
        }
        case 'sqrt': {
          const radTex = renderSeqForEditing(node.rad, [...path, { nodeIdx: i, slot: 'rad' }], cursor, selection);
          if (node.deg) {
            const degTex = renderSeqForEditing(node.deg, [...path, { nodeIdx: i, slot: 'deg' }], cursor, selection);
            pushPiece(i, `\\sqrt[${degTex}]{${radTex}}`);
          } else {
            pushPiece(i, `\\sqrt{${radTex}}`);
          }
          break;
        }
        case 'supsub': {
          let s = '';
          if (node.sub) {
            const subTex = renderSeqForEditing(node.sub, [...path, { nodeIdx: i, slot: 'sub' }], cursor, selection);
            s += `_{${subTex}}`;
          }
          if (node.sup) {
            const supTex = renderSeqForEditing(node.sup, [...path, { nodeIdx: i, slot: 'sup' }], cursor, selection);
            s += `^{${supTex}}`;
          }
          pushPiece(i, s);
          break;
        }
        case 'accent': {
          const bodyTex = renderSeqForEditing(node.body, [...path, { nodeIdx: i, slot: 'body' }], cursor, selection);
          pushPiece(i, `${node.cmd}{${bodyTex}}`);
          break;
        }
        case 'oversub': {
          const aTex = renderSeqForEditing(node.a, [...path, { nodeIdx: i, slot: 'a' }], cursor, selection);
          const bTex = renderSeqForEditing(node.b, [...path, { nodeIdx: i, slot: 'b' }], cursor, selection);
          if (node.cmd === '\\underbrace') {
            pushPiece(i, `\\underbrace{${aTex}}_{${bTex}}`);
          } else {
            pushPiece(i, `${node.cmd}{${aTex}}{${bTex}}`);
          }
          break;
        }
        case 'delim': {
          const bodyTex = renderSeqForEditing(node.body, [...path, { nodeIdx: i, slot: 'body' }], cursor, selection);
          pushPiece(i, `\\left${node.left} ${bodyTex} \\right${node.right}`);
          break;
        }
        case 'env': {
          const rowStrs = node.rows.map((r, rIdx) =>
            r
              .map((c, cIdx) =>
                renderSeqForEditing(c, [...path, { nodeIdx: i, slot: `${rIdx}.${cIdx}` }], cursor, selection)
              )
              .join(' & ')
          );
          pushPiece(i, `\\begin{${node.env}} ${rowStrs.join(' \\\\ ')} \\end{${node.env}}`);
          break;
        }
        case 'styled': {
          const bodyTex = renderSeqForEditing(
            node.body,
            [...path, { nodeIdx: i, slot: 'body' }],
            cursor,
            selection
          );
          if (node.styleKind === 'color') {
            pushPiece(i, `\\textcolor{${node.cmd}}{${bodyTex}}`);
          } else {
            pushPiece(i, `{${node.cmd} ${bodyTex}}`);
          }
          break;
        }
      }
    }
  }

  return pieces.join(' ');
}

// Escapa caracteres HTML para mostrar el código LaTeX plano de forma segura ante fallos de render
function escapeEquationPlainHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderInteractiveEquationHtml(
  latex: string,
  cursor: MathCursor,
  displayMode = true,
  selection?: MathSelectionRange | null
): string {
  const ast = parseLatexToAst(latex);
  const clamped = clampCursor(ast, cursor);
  const editTex = renderSeqForEditing(ast, [], clamped, selection);
  try {
    const renderedEdit = renderKatexToStringLazy(editTex || '\\square', {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: (context) =>
        context.command === '\\htmlClass' || context.command === '\\htmlData',
    });
    if (renderedEdit !== null) return renderedEdit;
    return renderLatexFallbackHtml(latex || '\\square');
  } catch {
    try {
      const renderedPlain = renderKatexToStringLazy(latex || '\\square', {
        displayMode,
        throwOnError: false,
        strict: false,
      });
      if (renderedPlain !== null) return renderedPlain;
      return renderLatexFallbackHtml(latex || '');
    } catch {
      return `<code class="font-mono text-xs break-all">${escapeEquationPlainHtml(latex || '')}</code>`;
    }
  }
}

// ---------------- PLACEHOLDERS & NAVIGATION ----------------

export function countAstPlaceholders(nodes: MathNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.kind === 'slot') count++;
    for (const ch of getChildSlots(n)) {
      count += countAstPlaceholders(ch.seq);
    }
  }
  return count;
}

export function findAllSlotCursors(nodes: MathNode[], basePath: CursorStep[] = []): MathCursor[] {
  const list: MathCursor[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind === 'slot') {
      list.push({ path: basePath, offset: i });
    }
    for (const ch of getChildSlots(n)) {
      list.push(...findAllSlotCursors(ch.seq, [...basePath, { nodeIdx: i, slot: ch.slot }]));
    }
  }
  return list;
}

export function getInitialEditCursor(latex: string): MathCursor {
  const ast = parseLatexToAst(latex);
  const slots = findAllSlotCursors(ast);
  if (slots.length > 0) return slots[0];
  return { path: [], offset: ast.length };
}

export function jumpToNextSlotCursor(
  latex: string,
  cursor: MathCursor,
  backwards = false
): MathCursor {
  const ast = parseLatexToAst(latex);
  const slots = findAllSlotCursors(ast);
  if (slots.length === 0) return cursor;

  // Determine linear order of slots vs current cursor
  const orderedStops = collectAllStops(ast);
  const curIdx = orderedStops.findIndex((s) => cursorsEqual(s, cursor));

  if (!backwards) {
    for (const stopIdx of orderedStops.keys()) {
      if (stopIdx > curIdx) {
        const match = slots.find((sl) => cursorsEqual(sl, orderedStops[stopIdx]));
        if (match) return match;
      }
    }
    return slots[0];
  } else {
    for (let stopIdx = orderedStops.length - 1; stopIdx >= 0; stopIdx--) {
      if (stopIdx < curIdx) {
        const match = slots.find((sl) => cursorsEqual(sl, orderedStops[stopIdx]));
        if (match) return match;
      }
    }
    return slots[slots.length - 1];
  }
}

function collectAllStops(nodes: MathNode[], basePath: CursorStep[] = []): MathCursor[] {
  const stops: MathCursor[] = [];
  for (let i = 0; i <= nodes.length; i++) {
    stops.push({ path: basePath, offset: i });
    if (i < nodes.length) {
      const children = getChildSlots(nodes[i]);
      for (const ch of children) {
        stops.push(...collectAllStops(ch.seq, [...basePath, { nodeIdx: i, slot: ch.slot }]));
      }
    }
  }
  return stops;
}

export function stepCursorLeft(latex: string, cursor: MathCursor): MathCursor {
  const ast = parseLatexToAst(latex);
  const clamped = clampCursor(ast, cursor);
  const stops = collectAllStops(ast);
  const idx = stops.findIndex((s) => cursorsEqual(s, clamped));
  if (idx > 0) {
    // Skip redundant stop immediately after single slot when stepping onto slot
    return stops[idx - 1];
  }
  return clamped;
}

export function stepCursorRight(latex: string, cursor: MathCursor): MathCursor {
  const ast = parseLatexToAst(latex);
  const clamped = clampCursor(ast, cursor);
  const stops = collectAllStops(ast);
  const idx = stops.findIndex((s) => cursorsEqual(s, clamped));
  if (idx >= 0 && idx < stops.length - 1) {
    return stops[idx + 1];
  }
  return clamped;
}

export function stepCursorVertical(
  latex: string,
  cursor: MathCursor,
  dir: 'up' | 'down'
): MathCursor {
  const ast = parseLatexToAst(latex);
  const clamped = clampCursor(ast, cursor);
  if (clamped.path.length === 0) return clamped;

  // Walk from deepest path outward to find a parent that supports vertical navigation
  for (let depth = clamped.path.length - 1; depth >= 0; depth--) {
    const parentPath = clamped.path.slice(0, depth);
    const step = clamped.path[depth];
    const parentSeq = getSeqAtPath(ast, parentPath);
    const node = parentSeq?.[step.nodeIdx];
    if (!node) continue;

    if (node.kind === 'frac') {
      if (step.slot === 'num' && dir === 'down') {
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'den' }],
          offset: Math.min(clamped.offset, node.den.length),
        };
      }
      if (step.slot === 'den' && dir === 'up') {
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'num' }],
          offset: Math.min(clamped.offset, node.num.length),
        };
      }
    }

    if (node.kind === 'binom') {
      if (step.slot === 'top' && dir === 'down') {
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'bot' }],
          offset: Math.min(clamped.offset, node.bot.length),
        };
      }
      if (step.slot === 'bot' && dir === 'up') {
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'top' }],
          offset: Math.min(clamped.offset, node.top.length),
        };
      }
    }

    if (node.kind === 'supsub') {
      if (step.slot === 'sup' && dir === 'down') {
        if (node.sub) {
          return {
            path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'sub' }],
            offset: Math.min(clamped.offset, node.sub.length),
          };
        }
        return { path: parentPath, offset: step.nodeIdx + 1 };
      }
      if (step.slot === 'sub' && dir === 'up') {
        if (node.sup) {
          return {
            path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'sup' }],
            offset: Math.min(clamped.offset, node.sup.length),
          };
        }
        return { path: parentPath, offset: step.nodeIdx + 1 };
      }
    }

    if (node.kind === 'oversub') {
      if (step.slot === 'a' && dir === 'down') {
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'b' }],
          offset: Math.min(clamped.offset, node.b.length),
        };
      }
      if (step.slot === 'b' && dir === 'up') {
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'a' }],
          offset: Math.min(clamped.offset, node.a.length),
        };
      }
    }

    if (node.kind === 'env') {
      const [rStr, cStr] = step.slot.split('.');
      const r = Number(rStr);
      const c = Number(cStr);
      const nextR = dir === 'up' ? r - 1 : r + 1;
      if (nextR >= 0 && nextR < node.rows.length) {
        const colIdx = Math.min(c, node.rows[nextR].length - 1);
        return {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: `${nextR}.${colIdx}` }],
          offset: Math.min(clamped.offset, node.rows[nextR][colIdx].length),
        };
      }
    }
  }

  return clamped;
}

// ---------------- EDITING MUTATIONS ----------------

function ensureNonEmptySlot(seq: MathNode[]): void {
  if (seq.length === 0) {
    seq.push({ kind: 'slot' });
  }
}

// Comprueba si un nodo es un espacio visible explícito de LaTeX
function isVisibleSpaceNode(node: MathNode | undefined): boolean {
  return Boolean(
    node &&
      node.kind === 'cmd' &&
      (node.tex === '\\ ' || node.tex === '\\;' || node.tex === '\\,' || node.tex === '\\:')
  );
}

// Extrae texto interno si el nodo representa un identificador recto de unidad (\mathrm{...} o \text{...})
function getUprightUnitInner(node: MathNode | undefined): string | null {
  if (!node || node.kind !== 'raw') return null;
  const m = node.tex.match(/^\\(?:mathrm|text)\{([^{}]+)\}$/);
  return m ? m[1] : null;
}

// Determina si la secuencia contiene un nodo de unidad en letra recta
function sequenceHasUprightUnit(nodes: MathNode[]): boolean {
  return nodes.some((n) => getUprightUnitInner(n) !== null);
}

// Comprueba si un nodo representa el final de un número (dígito o exponente tras dígito)
function endsNumericExpression(seq: MathNode[], endIdx: number): boolean {
  let i = endIdx;
  if (i < 0) return false;
  if (seq[i]?.kind === 'supsub') {
    i--;
  }
  const n = seq[i];
  return Boolean(n && n.kind === 'char' && /^[0-9]$/.test(n.value));
}

// Verifica si en la posición actual corresponde formatear la letra escrita como unidad en letra recta (\mathrm{...})
function shouldFormatAsUprightUnit(
  root: MathNode[],
  c: MathCursor,
  seq: MathNode[],
  ch: string
): boolean {
  if (!/^[a-zA-Z°µμΩ]$/.test(ch)) return false;

  const prev = c.offset > 0 ? seq[c.offset - 1] : undefined;
  // Si continúa inmediatamente después de una unidad recta existente (\mathrm{k} + g -> \mathrm{kg})
  if (getUprightUnitInner(prev) !== null) {
    return true;
  }

  // Si continúa inmediatamente después de número + espacio visible (p. ej. "0.713\ m")
  let backIdx = c.offset - 1;
  if (backIdx >= 0 && isVisibleSpaceNode(seq[backIdx])) {
    while (backIdx >= 0 && isVisibleSpaceNode(seq[backIdx])) {
      backIdx--;
    }
    if (endsNumericExpression(seq, backIdx)) {
      return true;
    }
  }

  // Si sigue a un divisor '/' cuya parte izquierda termina en unidad recta (p. ej. "15\ \mathrm{m}^{3}/s")
  if (prev?.kind === 'char' && prev.value === '/') {
    let leftIdx = c.offset - 2;
    if (leftIdx >= 0 && seq[leftIdx]?.kind === 'supsub') leftIdx--;
    if (getUprightUnitInner(seq[leftIdx]) !== null) {
      return true;
    }
  }

  // Si está en el denominador de una fracción cuyo numerador contiene unidades rectas (\frac{\mathrm{m}^3}{s})
  if (c.path.length > 0) {
    const lastStep = c.path[c.path.length - 1];
    if (lastStep.slot === 'den') {
      const parentSeq = getSeqAtPath(root, c.path.slice(0, -1));
      const fracNode = parentSeq?.[lastStep.nodeIdx];
      if (fracNode?.kind === 'frac' && sequenceHasUprightUnit(fracNode.num)) {
        return true;
      }
    }
  }

  return false;
}

function findNumeratorTermRange(seq: MathNode[], beforeOffset: number): number {
  let start = beforeOffset;
  while (start > 0) {
    const n = seq[start - 1];
    if (n.kind === 'char') {
      if (['=', '+', '-', '*', ',', ';', ':', '(', '[', '{', '/'].includes(n.value)) break;
      start--;
    } else if (n.kind === 'cmd') {
      if (
        isVisibleSpaceNode(n) ||
        ['\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\leq', '\\geq', '\\neq', '\\approx', '\\rightarrow', '\\Rightarrow', '\\to'].includes(n.tex)
      ) {
        break;
      }
      start--;
    } else if (n.kind === 'supsub' || n.kind === 'delim' || n.kind === 'sqrt' || n.kind === 'accent' || n.kind === 'raw') {
      start--;
    } else {
      break;
    }
  }
  return start;
}

function insertSingleKey(
  root: MathNode[],
  cursor: MathCursor,
  ch: string
): MathCursor {
  const c = clampCursor(root, cursor);
  const seq = getSeqAtPath(root, c.path);
  if (!seq) return c;

  // Smart '/' -> create fraction from preceding term (or empty fraction)
  if (ch === '/') {
    if (seq.length === 1 && seq[0].kind === 'slot') {
      seq.splice(0, 1, {
        kind: 'frac',
        num: [{ kind: 'slot' }],
        den: [{ kind: 'slot' }],
      });
      return { path: [...c.path, { nodeIdx: 0, slot: 'num' }], offset: 0 };
    }
    const termStart = findNumeratorTermRange(seq, c.offset);
    if (termStart < c.offset) {
      const numNodes = seq.splice(termStart, c.offset - termStart);
      const fracNode: MathNode = {
        kind: 'frac',
        num: numNodes,
        den: [{ kind: 'slot' }],
      };
      seq.splice(termStart, 0, fracNode);
      return { path: [...c.path, { nodeIdx: termStart, slot: 'den' }], offset: 0 };
    }
    const fracNode: MathNode = {
      kind: 'frac',
      num: [{ kind: 'slot' }],
      den: [{ kind: 'slot' }],
    };
    seq.splice(c.offset, 0, fracNode);
    return { path: [...c.path, { nodeIdx: c.offset, slot: 'num' }], offset: 0 };
  }

  // Smart '^' / '_' -> superscript / subscript
  if (ch === '^' || ch === '_') {
    const slotKey = ch === '^' ? 'sup' : 'sub';
    const prev = c.offset > 0 ? seq[c.offset - 1] : null;
    if (prev && prev.kind === 'supsub' && !prev[slotKey]) {
      prev[slotKey] = [{ kind: 'slot' }];
      return { path: [...c.path, { nodeIdx: c.offset - 1, slot: slotKey }], offset: 0 };
    }
    const node: MathNode =
      ch === '^'
        ? { kind: 'supsub', sup: [{ kind: 'slot' }] }
        : { kind: 'supsub', sub: [{ kind: 'slot' }] };
    if (seq.length === 1 && seq[0].kind === 'slot' && c.offset === 0) {
      seq.splice(1, 0, node);
      return { path: [...c.path, { nodeIdx: 1, slot: slotKey }], offset: 0 };
    }
    if (seq[c.offset]?.kind === 'slot') {
      seq.splice(c.offset + 1, 0, node);
      return { path: [...c.path, { nodeIdx: c.offset + 1, slot: slotKey }], offset: 0 };
    }
    seq.splice(c.offset, 0, node);
    return { path: [...c.path, { nodeIdx: c.offset, slot: slotKey }], offset: 0 };
  }

  // Superíndices Unicode frecuentes en unidades ('²', '³', '¹') -> convierte a superíndice matemático limpio
  if (ch === '²' || ch === '³' || ch === '¹') {
    const digit = ch === '¹' ? '1' : ch === '²' ? '2' : '3';
    const supNode: MathNode = { kind: 'supsub', sup: [{ kind: 'char', value: digit }] };
    if (seq[c.offset]?.kind === 'slot') {
      seq.splice(c.offset, 1, supNode);
      return { path: c.path, offset: c.offset + 1 };
    }
    seq.splice(c.offset, 0, supNode);
    return { path: c.path, offset: c.offset + 1 };
  }

  // Barra espaciadora -> inserta espacio visible y persistente en LaTeX ('\ ')
  if (ch === ' ') {
    const spaceNode: MathNode = { kind: 'cmd', tex: '\\ ' };
    if (seq[c.offset]?.kind === 'slot') {
      seq.splice(c.offset, 1, spaceNode);
      return { path: c.path, offset: c.offset + 1 };
    }
    if (c.offset > 0 && seq.length === 1 && seq[0].kind === 'slot') {
      seq.splice(0, 1, spaceNode);
      return { path: c.path, offset: 1 };
    }
    seq.splice(c.offset, 0, spaceNode);
    return { path: c.path, offset: c.offset + 1 };
  }

  // Unidades tras número + espacio (o continuación de unidad recta) -> renderizar en letra recta con \mathrm{}
  if (shouldFormatAsUprightUnit(root, c, seq, ch)) {
    const prevNode = c.offset > 0 ? seq[c.offset - 1] : undefined;
    const prevInner = getUprightUnitInner(prevNode);
    if (prevInner !== null && prevNode?.kind === 'raw') {
      prevNode.tex = `\\mathrm{${prevInner}${ch}}`;
      return { path: c.path, offset: c.offset };
    }
    const unitNode: MathNode = { kind: 'raw', tex: `\\mathrm{${ch}}` };
    if (seq[c.offset]?.kind === 'slot') {
      seq.splice(c.offset, 1, unitNode);
      return { path: c.path, offset: c.offset + 1 };
    }
    seq.splice(c.offset, 0, unitNode);
    return { path: c.path, offset: c.offset + 1 };
  }

  // Carácter normal: si el cursor está sobre un hueco \square, lo reemplaza
  if (seq[c.offset]?.kind === 'slot') {
    seq.splice(c.offset, 1, { kind: 'char', value: ch });
    return { path: c.path, offset: c.offset + 1 };
  }
  if (c.offset > 0 && seq.length === 1 && seq[0].kind === 'slot') {
    seq.splice(0, 1, { kind: 'char', value: ch });
    return { path: c.path, offset: 1 };
  }

  seq.splice(c.offset, 0, { kind: 'char', value: ch });
  return { path: c.path, offset: c.offset + 1 };
}

// Inserta un espacio fino (\,) o normal (\ ) en la posición actual del cursor
export function insertMathSpaceAtCursor(
  latex: string,
  cursor: MathCursor,
  kind: 'normal' | 'thin' = 'normal'
): { latex: string; cursor: MathCursor } {
  const ast = parseLatexToAst(latex);
  const c = clampCursor(ast, cursor);
  const seq = getSeqAtPath(ast, c.path);
  if (!seq) return { latex, cursor: c };

  const tex = kind === 'thin' ? '\\,' : '\\ ';
  const spaceNode: MathNode = { kind: 'cmd', tex };
  if (seq[c.offset]?.kind === 'slot') {
    seq.splice(c.offset, 1, spaceNode);
    return { latex: serializeAstToLatex(ast), cursor: { path: c.path, offset: c.offset + 1 } };
  }
  if (c.offset > 0 && seq.length === 1 && seq[0].kind === 'slot') {
    seq.splice(0, 1, spaceNode);
    return { latex: serializeAstToLatex(ast), cursor: { path: c.path, offset: 1 } };
  }
  seq.splice(c.offset, 0, spaceNode);
  return {
    latex: serializeAstToLatex(ast),
    cursor: { path: c.path, offset: c.offset + 1 },
  };
}

export function applyTextInputAtCursor(
  latex: string,
  cursor: MathCursor,
  text: string
): { latex: string; cursor: MathCursor } {
  const ast = parseLatexToAst(latex);
  let cur = clampCursor(ast, cursor);

  // If user pasted a LaTeX expression containing '\'
  if (text.includes('\\') && text.length > 1) {
    return applySnippetAtCursor(latex, cur, text);
  }

  for (const ch of text) {
    cur = insertSingleKey(ast, cur, ch);
  }

  return {
    latex: serializeAstToLatex(ast),
    cursor: cur,
  };
}

export function applySnippetAtCursor(
  latex: string,
  cursor: MathCursor,
  snippetLatex: string
): { latex: string; cursor: MathCursor } {
  const ast = parseLatexToAst(latex);
  const c = clampCursor(ast, cursor);
  const seq = getSeqAtPath(ast, c.path);
  if (!seq) return { latex, cursor: c };

  const snippetNodes = parseSequence(snippetLatex);
  if (snippetNodes.length === 0) return { latex, cursor: c };

  // Special case: snippet is a supsub like \square^{\square} and user already typed a base before cursor
  if (
    snippetNodes.length === 2 &&
    snippetNodes[0].kind === 'slot' &&
    snippetNodes[1].kind === 'supsub' &&
    c.offset > 0 &&
    seq[c.offset - 1]?.kind !== 'slot'
  ) {
    const supSubNode = snippetNodes[1];
    const insertAt = c.offset;
    seq.splice(insertAt, 0, supSubNode);
    const subSlots = findAllSlotCursors([supSubNode], c.path);
    const nextCursor =
      subSlots.length > 0
        ? {
            path: [...c.path, { nodeIdx: insertAt, slot: subSlots[0].path[c.path.length]?.slot || 'sup' }],
            offset: 0,
          }
        : { path: c.path, offset: insertAt + 1 };
    return {
      latex: serializeAstToLatex(ast),
      cursor: clampCursor(ast, nextCursor),
    };
  }

  let insertAt = c.offset;
  if (seq[c.offset]?.kind === 'slot') {
    seq.splice(c.offset, 1, ...snippetNodes);
  } else if (c.offset > 0 && seq.length === 1 && seq[0].kind === 'slot') {
    insertAt = 0;
    seq.splice(0, 1, ...snippetNodes);
  } else {
    seq.splice(c.offset, 0, ...snippetNodes);
  }

  // Place cursor on the first \square inside the inserted slice (if any)
  const insertedSlice = seq.slice(insertAt, insertAt + snippetNodes.length);
  const innerSlots = findAllSlotCursors(insertedSlice, []).map((sl) => ({
    path: [
      ...c.path,
      ...(sl.path.length > 0
        ? [{ nodeIdx: insertAt + sl.path[0].nodeIdx, slot: sl.path[0].slot }, ...sl.path.slice(1)]
        : []),
    ],
    offset: sl.path.length === 0 ? insertAt + sl.offset : sl.offset,
  }));

  const nextCursor =
    innerSlots.length > 0
      ? innerSlots[0]
      : { path: c.path, offset: insertAt + snippetNodes.length };

  return {
    latex: serializeAstToLatex(ast),
    cursor: clampCursor(ast, nextCursor),
  };
}

function isSubtreeAllEmpty(nodes: MathNode[]): boolean {
  return nodes.every((n) => n.kind === 'slot');
}

export function applyBackspaceAtCursor(
  latex: string,
  cursor: MathCursor
): { latex: string; cursor: MathCursor } {
  const ast = parseLatexToAst(latex);
  const c = clampCursor(ast, cursor);
  const seq = getSeqAtPath(ast, c.path);
  if (!seq) return { latex, cursor: c };

  // Case 1: Inside a child container at offset 0 -> unwrap or delete empty parent structure
  if (c.offset === 0) {
    if (c.path.length === 0) {
      return { latex, cursor: c };
    }
    const parentPath = c.path.slice(0, -1);
    const step = c.path[c.path.length - 1];
    const parentSeq = getSeqAtPath(ast, parentPath);
    const parentNode = parentSeq?.[step.nodeIdx];
    if (!parentSeq || !parentNode) return { latex, cursor: c };

    const allEmpty = getChildSlots(parentNode).every((ch) => isSubtreeAllEmpty(ch.seq));
    if (allEmpty) {
      parentSeq.splice(step.nodeIdx, 1);
      ensureNonEmptySlot(parentSeq);
      return {
        latex: serializeAstToLatex(ast),
        cursor: { path: parentPath, offset: Math.min(step.nodeIdx, parentSeq.length) },
      };
    }

    // For frac/sqrt/accent/delim when at start of first/single non-empty child: unwrap contents into parent
    if (parentNode.kind === 'sqrt' && step.slot === 'rad' && !parentNode.deg) {
      const inner = parentNode.rad.filter((n) => n.kind !== 'slot');
      parentSeq.splice(step.nodeIdx, 1, ...inner);
      ensureNonEmptySlot(parentSeq);
      return {
        latex: serializeAstToLatex(ast),
        cursor: { path: parentPath, offset: step.nodeIdx },
      };
    }
    if (parentNode.kind === 'frac' && step.slot === 'den') {
      if (isSubtreeAllEmpty(parentNode.den)) {
        const inner = parentNode.num.filter((n) => n.kind !== 'slot');
        parentSeq.splice(step.nodeIdx, 1, ...inner);
        ensureNonEmptySlot(parentSeq);
        return {
          latex: serializeAstToLatex(ast),
          cursor: { path: parentPath, offset: step.nodeIdx + inner.length },
        };
      }
      return {
        latex,
        cursor: {
          path: [...parentPath, { nodeIdx: step.nodeIdx, slot: 'num' }],
          offset: parentNode.num.length,
        },
      };
    }

    return {
      latex: serializeAstToLatex(ast),
      cursor: stepCursorLeft(latex, c),
    };
  }

  // Case 2: offset > 0 inside current seq
  const target = seq[c.offset - 1];
  const targetChildren = getChildSlots(target);
  if (targetChildren.length > 0) {
    const allEmpty = targetChildren.every((ch) => isSubtreeAllEmpty(ch.seq));
    if (allEmpty) {
      seq.splice(c.offset - 1, 1);
      ensureNonEmptySlot(seq);
      return {
        latex: serializeAstToLatex(ast),
        cursor: { path: c.path, offset: Math.max(0, c.offset - 1) },
      };
    }
    // Step into the end of the last child of the structure instead of deleting it all at once
    const lastChild = targetChildren[targetChildren.length - 1];
    return {
      latex,
      cursor: {
        path: [...c.path, { nodeIdx: c.offset - 1, slot: lastChild.slot }],
        offset: lastChild.seq.length,
      },
    };
  }

  // Si la hoja anterior es una unidad \mathrm{...} con más de un carácter, elimina solo el último carácter
  const uprightInner = getUprightUnitInner(target);
  if (target.kind === 'raw' && uprightInner && uprightInner.length > 1) {
    target.tex = `\\mathrm{${uprightInner.slice(0, -1)}}`;
    return {
      latex: serializeAstToLatex(ast),
      cursor: { path: c.path, offset: c.offset },
    };
  }

  // Removing a single leaf (char/cmd/slot/raw)
  seq.splice(c.offset - 1, 1);
  ensureNonEmptySlot(seq);
  const nextOffset = Math.max(0, Math.min(c.offset - 1, seq.length));
  return {
    latex: serializeAstToLatex(ast),
    cursor: { path: c.path, offset: seq[0]?.kind === 'slot' && seq.length === 1 ? 0 : nextOffset },
  };
}

export function applyDeleteAtCursor(
  latex: string,
  cursor: MathCursor
): { latex: string; cursor: MathCursor } {
  const ast = parseLatexToAst(latex);
  const c = clampCursor(ast, cursor);
  const seq = getSeqAtPath(ast, c.path);
  if (!seq || c.offset >= seq.length) return { latex, cursor: c };

  const target = seq[c.offset];
  const targetChildren = getChildSlots(target);
  if (targetChildren.length > 0 && !targetChildren.every((ch) => isSubtreeAllEmpty(ch.seq))) {
    // Enter first child at 0
    return {
      latex,
      cursor: {
        path: [...c.path, { nodeIdx: c.offset, slot: targetChildren[0].slot }],
        offset: 0,
      },
    };
  }

  if (seq.length === 1 && seq[0].kind === 'slot') {
    return { latex, cursor: c };
  }

  seq.splice(c.offset, 1);
  ensureNonEmptySlot(seq);
  return {
    latex: serializeAstToLatex(ast),
    cursor: { path: c.path, offset: seq[0]?.kind === 'slot' && seq.length === 1 ? 0 : Math.min(c.offset, seq.length) },
  };
}

// V1.11.8-7: Aplica color (\textcolor) o tamaño relativo nativo KaTeX a una subselección sin habilitar trust: true
export function applyStyleToLatexSelection(
  latex: string,
  cursor: MathCursor,
  selection: MathSelectionRange | null | undefined,
  patch: { color?: string; sizeCmd?: string }
): { latex: string; cursor: MathCursor; selection: MathSelectionRange | null } {
  const ast = parseLatexToAst(latex);
  const c = clampCursor(ast, cursor);

  const safeColor = patch.color ? sanitizeMathColorToken(patch.color) : null;
  const safeSize =
    patch.sizeCmd && MATH_RELATIVE_SIZE_SET.has(patch.sizeCmd) ? patch.sizeCmd : null;
  if (!safeColor && !safeSize) {
    return { latex, cursor: c, selection: selection ?? null };
  }

  const targetStyleKind: 'color' | 'size' = safeColor ? 'color' : 'size';
  const targetCmd = (safeColor ?? safeSize)!;

  if (selection && selection.start !== selection.end) {
    const seq = getSeqAtPath(ast, selection.path);
    if (seq && seq.length > 0) {
      const lo = Math.max(0, Math.min(selection.start, selection.end));
      const hi = Math.min(seq.length, Math.max(selection.start, selection.end));
      if (hi > lo) {
        const slice = seq.slice(lo, hi);
        if (
          slice.length === 1 &&
          slice[0].kind === 'styled' &&
          slice[0].styleKind === targetStyleKind
        ) {
          if (targetStyleKind === 'size' && targetCmd === '\\normalsize') {
            const unwrapped = slice[0].body.length > 0 ? slice[0].body : [{ kind: 'slot' as const }];
            seq.splice(lo, 1, ...unwrapped);
            return {
              latex: serializeAstToLatex(ast),
              cursor: { path: selection.path, offset: lo + unwrapped.length },
              selection: { path: selection.path, start: lo, end: lo + unwrapped.length },
            };
          }
          slice[0].cmd = targetCmd;
          return {
            latex: serializeAstToLatex(ast),
            cursor: { path: selection.path, offset: lo + 1 },
            selection: { path: selection.path, start: lo, end: lo + 1 },
          };
        }

        if (targetStyleKind === 'size' && targetCmd === '\\normalsize') {
          return { latex, cursor: c, selection };
        }

        const wrapped: MathNode = {
          kind: 'styled',
          styleKind: targetStyleKind,
          cmd: targetCmd,
          body: slice,
        };
        seq.splice(lo, hi - lo, wrapped);
        return {
          latex: serializeAstToLatex(ast),
          cursor: { path: selection.path, offset: lo + 1 },
          selection: { path: selection.path, start: lo, end: lo + 1 },
        };
      }
    }
  }

  // Sin rango activo: si el cursor ya está dentro de un nodo styled del mismo tipo, actualiza su comando
  if (c.path.length > 0) {
    const lastStep = c.path[c.path.length - 1];
    const parentSeq = getSeqAtPath(ast, c.path.slice(0, -1));
    const parentNode = parentSeq?.[lastStep.nodeIdx];
    if (parentNode && parentNode.kind === 'styled' && parentNode.styleKind === targetStyleKind) {
      if (targetStyleKind === 'size' && targetCmd === '\\normalsize' && parentSeq) {
        const bodyCopy = parentNode.body.length > 0 ? parentNode.body : [{ kind: 'slot' as const }];
        parentSeq.splice(lastStep.nodeIdx, 1, ...bodyCopy);
        return {
          latex: serializeAstToLatex(ast),
          cursor: {
            path: c.path.slice(0, -1),
            offset: lastStep.nodeIdx + Math.min(c.offset, bodyCopy.length),
          },
          selection: null,
        };
      }
      parentNode.cmd = targetCmd;
      return { latex: serializeAstToLatex(ast), cursor: c, selection: null };
    }
  }

  // Inserta un marcador estilizado con hueco editable en la posición del cursor
  if (targetStyleKind === 'size' && targetCmd === '\\normalsize') {
    return { latex, cursor: c, selection: null };
  }
  const seq = getSeqAtPath(ast, c.path);
  if (!seq) return { latex, cursor: c, selection: null };
  const styledNode: MathNode = {
    kind: 'styled',
    styleKind: targetStyleKind,
    cmd: targetCmd,
    body: [{ kind: 'slot' }],
  };
  let insertAt = c.offset;
  if (seq[c.offset]?.kind === 'slot') {
    seq.splice(c.offset, 1, styledNode);
  } else if (c.offset > 0 && seq.length === 1 && seq[0].kind === 'slot') {
    insertAt = 0;
    seq.splice(0, 1, styledNode);
  } else {
    seq.splice(c.offset, 0, styledNode);
  }
  return {
    latex: serializeAstToLatex(ast),
    cursor: { path: [...c.path, { nodeIdx: insertAt, slot: 'body' }], offset: 0 },
    selection: null,
  };
}
