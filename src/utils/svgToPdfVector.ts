import type { jsPDF } from 'jspdf';

type Rgb = [number, number, number];
type Matrix = [number, number, number, number, number, number]; // [a, b, c, d, e, f]

interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  text: string;
}

interface DrawStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashArray: number[] | null;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  lineCap: 'butt' | 'round' | 'square';
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  fontFamily: string;
  textAnchor: 'start' | 'middle' | 'end';
  dominantBaseline: string;
}

const DEFAULT_STYLE: DrawStyle = {
  fill: '#0f172a',
  stroke: 'none',
  strokeWidth: 1,
  dashArray: null,
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  lineCap: 'butt',
  fontSize: 10,
  fontWeight: 'normal',
  fontStyle: 'normal',
  fontFamily: 'helvetica',
  textAnchor: 'start',
  dominantBaseline: 'auto',
};

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#dc2626',
  blue: '#2563eb',
  green: '#16a34a',
  purple: '#7c3aed',
  amber: '#d97706',
  slate: '#475569',
  gray: '#64748b',
  grey: '#64748b',
  transparent: 'none',
  none: 'none',
};

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rawAttrs)) !== null) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

// Analizador XML/SVG ligero independiente del DOM para funcionar tanto en navegador como en Node
function parseSvgTree(markup: string): SvgNode {
  const cleaned = markup
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  const tokenRe = /<(\/?)([a-zA-Z_][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(cleaned)) !== null) {
    if (m[5] !== undefined) {
      if (stack.length > 0) {
        stack[stack.length - 1].text += decodeXmlEntities(m[5]);
      }
      continue;
    }

    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] || '';
    const isSelfClose = m[4] === '/';

    if (isClose) {
      const popped = stack.pop();
      if (!popped || popped.tag !== tag) {
        throw new Error(`Etiqueta SVG desbalanceada: </${tag}>`);
      }
      continue;
    }

    const node: SvgNode = {
      tag,
      attrs: parseAttributes(rawAttrs),
      children: [],
      text: '',
    };

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      root = node;
    }

    if (!isSelfClose) {
      stack.push(node);
    }
  }

  if (stack.length > 0 || !root || root.tag !== 'svg') {
    throw new Error('SVG inválido o raíz <svg> ausente');
  }
  return root;
}

function mulMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseTransform(raw?: string): Matrix {
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  if (!raw) return m;
  const fnRe = /(translate|scale|rotate|matrix)\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRe.exec(raw)) !== null) {
    const kind = match[1];
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    let next: Matrix = [1, 0, 0, 1, 0, 0];
    if (kind === 'translate' && nums.length >= 1) {
      next = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (kind === 'scale' && nums.length >= 1) {
      next = [nums[0], 0, 0, nums[1] ?? nums[0], 0, 0];
    } else if (kind === 'rotate' && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const cx = nums[1];
        const cy = nums[2];
        next = mulMatrix(
          mulMatrix([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]),
          [1, 0, 0, 1, -cx, -cy]
        );
      } else {
        next = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (kind === 'matrix' && nums.length >= 6) {
      next = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    }
    m = mulMatrix(m, next);
  }
  return m;
}

function parseColor(
  raw: string,
  extraAlpha = 1
): { rgb: Rgb; visible: boolean } {
  const val = (raw || '').trim().toLowerCase();
  if (!val || val === 'none' || val === 'transparent') {
    return { rgb: [0, 0, 0], visible: false };
  }
  const named = NAMED_COLORS[val];
  const hexSrc = named ?? val;

  if (hexSrc.startsWith('#')) {
    const h = hexSrc.slice(1);
    let r = 0;
    let g = 0;
    let b = 0;
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else if (h.length >= 6) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return { rgb: [15, 23, 42], visible: true };
    }
    return {
      rgb: blendOnWhite(r, g, b, extraAlpha),
      visible: extraAlpha > 0.01,
    };
  }

  const rgbaMatch = val.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/
  );
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1]);
    const g = Number(rgbaMatch[2]);
    const b = Number(rgbaMatch[3]);
    const a = (rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1) * extraAlpha;
    return {
      rgb: blendOnWhite(r, g, b, a),
      visible: a > 0.01,
    };
  }

  return { rgb: [15, 23, 42], visible: true };
}

function blendOnWhite(r: number, g: number, b: number, alpha: number): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    Math.round(255 * (1 - a) + r * a),
    Math.round(255 * (1 - a) + g * a),
    Math.round(255 * (1 - a) + b * a),
  ];
}

function mergeStyle(parent: DrawStyle, attrs: Record<string, string>): DrawStyle {
  const opacity =
    attrs.opacity !== undefined ? parent.opacity * Number(attrs.opacity) : parent.opacity;
  const fillOpacity =
    attrs['fill-opacity'] !== undefined
      ? parent.fillOpacity * Number(attrs['fill-opacity'])
      : parent.fillOpacity;
  const strokeOpacity =
    attrs['stroke-opacity'] !== undefined
      ? parent.strokeOpacity * Number(attrs['stroke-opacity'])
      : parent.strokeOpacity;

  let dashArray = parent.dashArray;
  if (attrs['stroke-dasharray'] !== undefined) {
    const raw = attrs['stroke-dasharray'].trim();
    if (!raw || raw === 'none') {
      dashArray = null;
    } else {
      const nums = raw
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      dashArray = nums.length > 0 ? nums : null;
    }
  }

  const cap = attrs['stroke-linecap'];
  const lineCap: DrawStyle['lineCap'] =
    cap === 'round' || cap === 'square' || cap === 'butt' ? cap : parent.lineCap;

  const anchor = attrs['text-anchor'];
  const textAnchor: DrawStyle['textAnchor'] =
    anchor === 'start' || anchor === 'middle' || anchor === 'end'
      ? anchor
      : parent.textAnchor;

  return {
    fill: attrs.fill ?? parent.fill,
    stroke: attrs.stroke ?? parent.stroke,
    strokeWidth:
      attrs['stroke-width'] !== undefined
        ? Number(attrs['stroke-width']) || 1
        : parent.strokeWidth,
    dashArray,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    fillOpacity: Number.isFinite(fillOpacity) ? fillOpacity : 1,
    strokeOpacity: Number.isFinite(strokeOpacity) ? strokeOpacity : 1,
    lineCap,
    fontSize:
      attrs['font-size'] !== undefined
        ? parseFloat(attrs['font-size']) || parent.fontSize
        : parent.fontSize,
    fontWeight: attrs['font-weight'] ?? parent.fontWeight,
    fontStyle: attrs['font-style'] ?? parent.fontStyle,
    fontFamily: attrs['font-family'] ?? parent.fontFamily,
    textAnchor,
    dominantBaseline: attrs['dominant-baseline'] ?? parent.dominantBaseline,
  };
}

function numAttr(attrs: Record<string, string>, key: string, fallback = 0): number {
  const v = attrs[key];
  if (v === undefined) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePointsList(raw: string): [number, number][] {
  const nums = (raw || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([nums[i], nums[i + 1]]);
  }
  return pts;
}

// Convierte un arco SVG (A rx ry xAxisRot largeArc sweep x y) a segmentos cúbicos de Bézier
function arcToCubicSegments(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): [number, number, number, number, number, number][] {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6) {
    return [[x1, y1, x2, y2, x2, y2]];
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1pSq - ry2 * x1pSq);
  const den = rx2 * y1pSq + ry2 * x1pSq;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(den > 1e-12 ? num / den : 0);
  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = ux * vx + uy * vy;
    const mag = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ratio = mag > 1e-12 ? Math.max(-1, Math.min(1, dot / mag)) : 1;
    return sign * Math.acos(ratio);
  };

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta1 = vecAngle(1, 0, ux, uy);
  let dTheta = vecAngle(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segCount = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segCount;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const out: [number, number, number, number, number, number][] = [];

  for (let i = 0; i < segCount; i++) {
    const t1 = theta1 + i * delta;
    const t2 = t1 + delta;
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);
    const c2 = Math.cos(t2);
    const s2 = Math.sin(t2);

    const p1x = c1 - alpha * s1;
    const p1y = s1 + alpha * c1;
    const p2x = c2 + alpha * s2;
    const p2y = s2 - alpha * c2;
    const p3x = c2;
    const p3y = s2;

    const mapPt = (px: number, py: number): [number, number] => [
      cx + cosPhi * rx * px - sinPhi * ry * py,
      cy + sinPhi * rx * px + cosPhi * ry * py,
    ];
    const [cp1x, cp1y] = mapPt(p1x, p1y);
    const [cp2x, cp2y] = mapPt(p2x, p2y);
    const [ex, ey] = mapPt(p3x, p3y);
    out.push([cp1x, cp1y, cp2x, cp2y, ex, ey]);
  }
  return out;
}

type PathOp =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

function parseSvgPath(d: string): PathOp[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const ops: PathOp[] = [];
  let idx = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const isCmd = (tok: string) => /^[a-zA-Z]$/.test(tok);
  const nextNum = () => {
    const val = parseFloat(tokens[idx++]);
    return Number.isFinite(val) ? val : 0;
  };

  while (idx < tokens.length) {
    if (isCmd(tokens[idx])) {
      cmd = tokens[idx++];
      if (cmd === 'Z' || cmd === 'z') {
        ops.push({ op: 'Z' });
        cx = sx;
        cy = sy;
        continue;
      }
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    }

    switch (cmd) {
      case 'M': {
        cx = nextNum();
        cy = nextNum();
        sx = cx;
        sy = cy;
        ops.push({ op: 'M', x: cx, y: cy });
        break;
      }
      case 'm': {
        cx += nextNum();
        cy += nextNum();
        sx = cx;
        sy = cy;
        ops.push({ op: 'M', x: cx, y: cy });
        break;
      }
      case 'L': {
        cx = nextNum();
        cy = nextNum();
        ops.push({ op: 'L', x: cx, y: cy });
        break;
      }
      case 'l': {
        cx += nextNum();
        cy += nextNum();
        ops.push({ op: 'L', x: cx, y: cy });
        break;
      }
      case 'H': {
        cx = nextNum();
        ops.push({ op: 'L', x: cx, y: cy });
        break;
      }
      case 'h': {
        cx += nextNum();
        ops.push({ op: 'L', x: cx, y: cy });
        break;
      }
      case 'V': {
        cy = nextNum();
        ops.push({ op: 'L', x: cx, y: cy });
        break;
      }
      case 'v': {
        cy += nextNum();
        ops.push({ op: 'L', x: cx, y: cy });
        break;
      }
      case 'C': {
        const x1 = nextNum();
        const y1 = nextNum();
        const x2 = nextNum();
        const y2 = nextNum();
        cx = nextNum();
        cy = nextNum();
        ops.push({ op: 'C', x1, y1, x2, y2, x: cx, y: cy });
        break;
      }
      case 'c': {
        const x1 = cx + nextNum();
        const y1 = cy + nextNum();
        const x2 = cx + nextNum();
        const y2 = cy + nextNum();
        cx += nextNum();
        cy += nextNum();
        ops.push({ op: 'C', x1, y1, x2, y2, x: cx, y: cy });
        break;
      }
      case 'Q': {
        const qx = nextNum();
        const qy = nextNum();
        const nx = nextNum();
        const ny = nextNum();
        ops.push({
          op: 'C',
          x1: cx + (2 / 3) * (qx - cx),
          y1: cy + (2 / 3) * (qy - cy),
          x2: nx + (2 / 3) * (qx - nx),
          y2: ny + (2 / 3) * (qy - ny),
          x: nx,
          y: ny,
        });
        cx = nx;
        cy = ny;
        break;
      }
      case 'q': {
        const qx = cx + nextNum();
        const qy = cy + nextNum();
        const nx = cx + nextNum();
        const ny = cy + nextNum();
        ops.push({
          op: 'C',
          x1: cx + (2 / 3) * (qx - cx),
          y1: cy + (2 / 3) * (qy - cy),
          x2: nx + (2 / 3) * (qx - nx),
          y2: ny + (2 / 3) * (qy - ny),
          x: nx,
          y: ny,
        });
        cx = nx;
        cy = ny;
        break;
      }
      case 'A':
      case 'a': {
        const rx = nextNum();
        const ry = nextNum();
        const rot = nextNum();
        const large = nextNum() ? 1 : 0;
        const sweep = nextNum() ? 1 : 0;
        const nx = cmd === 'A' ? nextNum() : cx + nextNum();
        const ny = cmd === 'A' ? nextNum() : cy + nextNum();
        const cubics = arcToCubicSegments(cx, cy, rx, ry, rot, large, sweep, nx, ny);
        for (const [x1, y1, x2, y2, x, y] of cubics) {
          ops.push({ op: 'C', x1, y1, x2, y2, x, y });
        }
        cx = nx;
        cy = ny;
        break;
      }
      default: {
        idx++;
        break;
      }
    }
  }
  return ops;
}

function applyPaintStyle(
  doc: jsPDF,
  style: DrawStyle,
  scaleAvg: number
): { hasFill: boolean; hasStroke: boolean } {
  const fillCol = parseColor(style.fill, style.opacity * style.fillOpacity);
  const strokeCol = parseColor(style.stroke, style.opacity * style.strokeOpacity);

  if (fillCol.visible) {
    doc.setFillColor(...fillCol.rgb);
  }
  if (strokeCol.visible) {
    doc.setDrawColor(...strokeCol.rgb);
    doc.setLineWidth(Math.max(0.12, style.strokeWidth * scaleAvg));
    doc.setLineCap(style.lineCap);
    if (style.dashArray && style.dashArray.length > 0) {
      doc.setLineDashPattern(
        style.dashArray.map((n) => Math.max(0.2, n * scaleAvg)),
        0
      );
    } else {
      doc.setLineDashPattern([], 0);
    }
  } else {
    doc.setLineDashPattern([], 0);
  }

  return { hasFill: fillCol.visible, hasStroke: strokeCol.visible };
}

function drawStyleFlag(hasFill: boolean, hasStroke: boolean): 'F' | 'S' | 'FD' | null {
  if (hasFill && hasStroke) return 'FD';
  if (hasFill) return 'F';
  if (hasStroke) return 'S';
  return null;
}

function renderNode(
  doc: jsPDF,
  node: SvgNode,
  parentMatrix: Matrix,
  parentStyle: DrawStyle,
  scaleAvg: number
): void {
  if (node.tag === 'defs' || node.tag === 'title' || node.tag === 'desc') return;

  const matrix = node.attrs.transform
    ? mulMatrix(parentMatrix, parseTransform(node.attrs.transform))
    : parentMatrix;
  const style = mergeStyle(parentStyle, node.attrs);
  const mScale = Math.hypot(matrix[0], matrix[1]);

  if (node.tag === 'svg' || node.tag === 'g') {
    for (const child of node.children) {
      renderNode(doc, child, matrix, style, scaleAvg);
    }
    return;
  }

  if (node.tag === 'rect') {
    const x = numAttr(node.attrs, 'x', 0);
    const y = numAttr(node.attrs, 'y', 0);
    const w = numAttr(node.attrs, 'width', 0);
    const h = numAttr(node.attrs, 'height', 0);
    const rx = numAttr(node.attrs, 'rx', 0);
    const ry = numAttr(node.attrs, 'ry', rx);
    if (w <= 0 || h <= 0) return;

    const { hasFill, hasStroke } = applyPaintStyle(doc, style, scaleAvg);
    const flag = drawStyleFlag(hasFill, hasStroke);
    if (!flag) return;

    const isAxisAligned = Math.abs(matrix[1]) < 1e-5 && Math.abs(matrix[2]) < 1e-5;
    if (isAxisAligned) {
      const [px, py] = applyMatrix(matrix, x, y);
      const [px2, py2] = applyMatrix(matrix, x + w, y + h);
      const rw = Math.abs(px2 - px);
      const rh = Math.abs(py2 - py);
      const sx = Math.min(px, px2);
      const sy = Math.min(py, py2);
      const rdx = Math.min(rw / 2, rx * Math.abs(matrix[0]));
      const rdy = Math.min(rh / 2, ry * Math.abs(matrix[3]));
      if (rdx > 0.05 || rdy > 0.05) {
        doc.roundedRect(sx, sy, rw, rh, rdx, rdy, flag);
      } else {
        doc.rect(sx, sy, rw, rh, flag);
      }
    } else {
      const corners: [number, number][] = [
        applyMatrix(matrix, x, y),
        applyMatrix(matrix, x + w, y),
        applyMatrix(matrix, x + w, y + h),
        applyMatrix(matrix, x, y + h),
      ];
      doc.moveTo(corners[0][0], corners[0][1]);
      doc.lineTo(corners[1][0], corners[1][1]);
      doc.lineTo(corners[2][0], corners[2][1]);
      doc.lineTo(corners[3][0], corners[3][1]);
      doc.close();
      if (flag === 'FD') doc.fillStroke();
      else if (flag === 'F') doc.fill();
      else doc.stroke();
    }
    doc.setLineDashPattern([], 0);
    return;
  }

  if (node.tag === 'circle') {
    const cx = numAttr(node.attrs, 'cx', 0);
    const cy = numAttr(node.attrs, 'cy', 0);
    const r = numAttr(node.attrs, 'r', 0);
    if (r <= 0) return;
    const { hasFill, hasStroke } = applyPaintStyle(doc, style, scaleAvg);
    const flag = drawStyleFlag(hasFill, hasStroke);
    if (!flag) return;
    const [pcx, pcy] = applyMatrix(matrix, cx, cy);
    doc.circle(pcx, pcy, r * mScale, flag);
    doc.setLineDashPattern([], 0);
    return;
  }

  if (node.tag === 'ellipse') {
    const cx = numAttr(node.attrs, 'cx', 0);
    const cy = numAttr(node.attrs, 'cy', 0);
    const rx = numAttr(node.attrs, 'rx', 0);
    const ry = numAttr(node.attrs, 'ry', 0);
    if (rx <= 0 || ry <= 0) return;
    const { hasFill, hasStroke } = applyPaintStyle(doc, style, scaleAvg);
    const flag = drawStyleFlag(hasFill, hasStroke);
    if (!flag) return;
    const [pcx, pcy] = applyMatrix(matrix, cx, cy);
    const sx = Math.hypot(matrix[0], matrix[1]);
    const sy = Math.hypot(matrix[2], matrix[3]);
    doc.ellipse(pcx, pcy, rx * sx, ry * sy, flag);
    doc.setLineDashPattern([], 0);
    return;
  }

  if (node.tag === 'line') {
    const x1 = numAttr(node.attrs, 'x1', 0);
    const y1 = numAttr(node.attrs, 'y1', 0);
    const x2 = numAttr(node.attrs, 'x2', 0);
    const y2 = numAttr(node.attrs, 'y2', 0);
    const { hasStroke } = applyPaintStyle(doc, style, scaleAvg);
    if (!hasStroke) return;
    const [ax, ay] = applyMatrix(matrix, x1, y1);
    const [bx, by] = applyMatrix(matrix, x2, y2);
    doc.line(ax, ay, bx, by);
    doc.setLineDashPattern([], 0);
    return;
  }

  if (node.tag === 'polyline' || node.tag === 'polygon') {
    const pts = parsePointsList(node.attrs.points || '');
    if (pts.length < 2) return;
    const { hasFill, hasStroke } = applyPaintStyle(doc, style, scaleAvg);
    const flag = drawStyleFlag(node.tag === 'polygon' && hasFill, hasStroke);
    if (!flag) return;
    const [x0, y0] = applyMatrix(matrix, pts[0][0], pts[0][1]);
    doc.moveTo(x0, y0);
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = applyMatrix(matrix, pts[i][0], pts[i][1]);
      doc.lineTo(px, py);
    }
    if (node.tag === 'polygon') doc.close();
    if (flag === 'FD') doc.fillStroke();
    else if (flag === 'F') doc.fill();
    else doc.stroke();
    doc.setLineDashPattern([], 0);
    return;
  }

  if (node.tag === 'path') {
    const ops = parseSvgPath(node.attrs.d || '');
    if (ops.length === 0) return;
    const { hasFill, hasStroke } = applyPaintStyle(doc, style, scaleAvg);
    const flag = drawStyleFlag(hasFill, hasStroke);
    if (!flag) return;
    for (const op of ops) {
      if (op.op === 'M') {
        const [x, y] = applyMatrix(matrix, op.x, op.y);
        doc.moveTo(x, y);
      } else if (op.op === 'L') {
        const [x, y] = applyMatrix(matrix, op.x, op.y);
        doc.lineTo(x, y);
      } else if (op.op === 'C') {
        const [x1, y1] = applyMatrix(matrix, op.x1, op.y1);
        const [x2, y2] = applyMatrix(matrix, op.x2, op.y2);
        const [x, y] = applyMatrix(matrix, op.x, op.y);
        doc.curveTo(x1, y1, x2, y2, x, y);
      } else if (op.op === 'Z') {
        doc.close();
      }
    }
    if (flag === 'FD') doc.fillStroke();
    else if (flag === 'F') doc.fill();
    else doc.stroke();
    doc.setLineDashPattern([], 0);
    return;
  }

  if (node.tag === 'text') {
    const content = (
      node.text + node.children.map((c) => c.text).join('')
    ).replace(/\s+/g, ' ').trim();
    if (!content) return;
    const fillCol = parseColor(style.fill, style.opacity * style.fillOpacity);
    if (!fillCol.visible) return;

    const x = numAttr(node.attrs, 'x', 0);
    const y = numAttr(node.attrs, 'y', 0);
    const [px, py] = applyMatrix(matrix, x, y);

    const fontPt = Math.max(4.5, style.fontSize * mScale * 2.83465);
    const isMono = /mono|courier|consolas/i.test(style.fontFamily);
    const isBold = style.fontWeight === 'bold' || Number(style.fontWeight) >= 600;
    const isItalic = style.fontStyle === 'italic';
    const fontStyle =
      isBold && isItalic
        ? 'bolditalic'
        : isBold
        ? 'bold'
        : isItalic
        ? 'italic'
        : 'normal';

    doc.setFont(isMono ? 'courier' : 'helvetica', fontStyle);
    doc.setFontSize(fontPt);
    doc.setTextColor(...fillCol.rgb);

    const align =
      style.textAnchor === 'middle'
        ? 'center'
        : style.textAnchor === 'end'
        ? 'right'
        : 'left';

    const yOffset =
      style.dominantBaseline === 'central' || style.dominantBaseline === 'middle'
        ? (style.fontSize * mScale) * 0.34
        : 0;

    doc.text(content, px, py + yOffset, { align });
  }
}

/**
 * Renderiza un string SVG directamente como vectores nativos de jsPDF dentro de un rectángulo dado (en mm).
 * No usa capturas ni rasterización: produce archivos PDF muy ligeros y nítidos al imprimir.
 */
export function renderSvgToPdf(
  doc: jsPDF,
  svgMarkup: string,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
): void {
  const root = parseSvgTree(svgMarkup);
  const vbRaw = root.attrs.viewBox;
  let vbX = 0;
  let vbY = 0;
  let vbW = numAttr(root.attrs, 'width', boxW);
  let vbH = numAttr(root.attrs, 'height', boxH);

  if (vbRaw) {
    const parts = vbRaw.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      [vbX, vbY, vbW, vbH] = parts;
    }
  }

  if (vbW <= 0 || vbH <= 0) {
    throw new Error('viewBox SVG inválido');
  }

  const scale = Math.min(boxW / vbW, boxH / vbH);
  const offsetX = boxX + (boxW - vbW * scale) / 2 - vbX * scale;
  const offsetY = boxY + (boxH - vbH * scale) / 2 - vbY * scale;
  const rootMatrix: Matrix = [scale, 0, 0, scale, offsetX, offsetY];

  renderNode(doc, root, rootMatrix, DEFAULT_STYLE, scale);
}
