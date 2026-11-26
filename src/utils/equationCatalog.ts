// OPT: 1.1 — Carga diferida de KaTeX bajo demanda
import { renderKatexToStringLazy, renderLatexFallbackHtml } from './katexLoader';

export interface SymbolItem {
  label: string;
  snippet: string;
  title: string;
}

export interface SymbolGroup {
  id: string;
  label: string;
  items: SymbolItem[];
}

export interface StructureItem {
  title: string;
  previewLatex: string;
  snippet: string;
}

export interface StructureCategory {
  id: string;
  label: string;
  iconLatex: string;
  items: StructureItem[];
}

export const BUILTIN_EQUATIONS = [
  {
    name: 'Área del círculo',
    latex: 'A = \\pi r^2',
  },
  {
    name: 'Teorema de Pitágoras',
    latex: 'a^2 + b^2 = c^2',
  },
  {
    name: 'Fórmula cuadrática',
    latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
  },
  {
    name: 'Teorema binomial',
    latex: '(x + a)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^k a^{n-k}',
  },
  {
    name: 'Identidad trigonométrica',
    latex: '\\sin^2(\\theta) + \\cos^2(\\theta) = 1',
  },
  {
    name: 'Derivada por definición',
    latex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}",
  },
  {
    name: 'Expansión de Taylor',
    latex: 'e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!}',
  },
  {
    name: 'Segunda ley de Newton',
    latex: '\\sum \\vec{F} = m \\cdot \\vec{a}',
  },
];

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    id: 'basic',
    label: 'Matemáticas básicas',
    items: [
      { label: '±', snippet: '\\pm ', title: 'Más menos' },
      { label: '∞', snippet: '\\infty ', title: 'Infinito' },
      { label: '=', snippet: '= ', title: 'Igual' },
      { label: '≠', snippet: '\\neq ', title: 'Distinto' },
      { label: '≈', snippet: '\\approx ', title: 'Aproximado' },
      { label: '×', snippet: '\\times ', title: 'Por' },
      { label: '÷', snippet: '\\div ', title: 'Dividido entre' },
      { label: '·', snippet: '\\cdot ', title: 'Producto punto' },
      { label: '≤', snippet: '\\leq ', title: 'Menor o igual' },
      { label: '≥', snippet: '\\geq ', title: 'Mayor o igual' },
      { label: '∝', snippet: '\\propto ', title: 'Proporcional a' },
      { label: '°', snippet: '^\\circ ', title: 'Grados' },
      { label: '∂', snippet: '\\partial ', title: 'Derivada parcial' },
      { label: '∇', snippet: '\\nabla ', title: 'Nabla / Gradiente' },
      { label: '∴', snippet: '\\therefore ', title: 'Por lo tanto' },
      { label: '∵', snippet: '\\because ', title: 'Porque' },
      { label: '⎵', snippet: '\\ ', title: 'Espacio normal (Espacio)' },
      { label: '␣', snippet: '\\,', title: 'Espacio fino (Shift+Espacio)' },
    ],
  },
  {
    id: 'greek',
    label: 'Letras griegas',
    items: [
      { label: 'α', snippet: '\\alpha ', title: 'Alpha' },
      { label: 'β', snippet: '\\beta ', title: 'Beta' },
      { label: 'γ', snippet: '\\gamma ', title: 'Gamma' },
      { label: 'δ', snippet: '\\delta ', title: 'Delta' },
      { label: 'ε', snippet: '\\varepsilon ', title: 'Épsilon' },
      { label: 'ζ', snippet: '\\zeta ', title: 'Zeta' },
      { label: 'η', snippet: '\\eta ', title: 'Eta' },
      { label: 'θ', snippet: '\\theta ', title: 'Theta' },
      { label: 'λ', snippet: '\\lambda ', title: 'Lambda' },
      { label: 'μ', snippet: '\\mu ', title: 'Mu' },
      { label: 'π', snippet: '\\pi ', title: 'Pi' },
      { label: 'ρ', snippet: '\\rho ', title: 'Rho' },
      { label: 'σ', snippet: '\\sigma ', title: 'Sigma' },
      { label: 'τ', snippet: '\\tau ', title: 'Tau' },
      { label: 'φ', snippet: '\\varphi ', title: 'Phi' },
      { label: 'ω', snippet: '\\omega ', title: 'Omega' },
      { label: 'Δ', snippet: '\\Delta ', title: 'Delta mayúscula' },
      { label: 'Θ', snippet: '\\Theta ', title: 'Theta mayúscula' },
      { label: 'Σ', snippet: '\\Sigma ', title: 'Sigma mayúscula' },
      { label: 'Ω', snippet: '\\Omega ', title: 'Omega mayúscula' },
    ],
  },
  {
    id: 'relations',
    label: 'Conjuntos y Lógica',
    items: [
      { label: '∈', snippet: '\\in ', title: 'Pertenece' },
      { label: '∉', snippet: '\\notin ', title: 'No pertenece' },
      { label: '⊂', snippet: '\\subset ', title: 'Subconjunto propio' },
      { label: '⊆', snippet: '\\subseteq ', title: 'Subconjunto' },
      { label: '∪', snippet: '\\cup ', title: 'Unión' },
      { label: '∩', snippet: '\\cap ', title: 'Intersección' },
      { label: '∅', snippet: '\\emptyset ', title: 'Conjunto vacío' },
      { label: '∀', snippet: '\\forall ', title: 'Para todo' },
      { label: '∃', snippet: '\\exists ', title: 'Existe' },
      { label: '¬', snippet: '\\neg ', title: 'Negación' },
      { label: '∧', snippet: '\\land ', title: 'Y lógico' },
      { label: '∨', snippet: '\\lor ', title: 'O lógico' },
      { label: 'ℝ', snippet: '\\mathbb{R}', title: 'Números reales' },
      { label: 'ℤ', snippet: '\\mathbb{Z}', title: 'Números enteros' },
      { label: 'ℕ', snippet: '\\mathbb{N}', title: 'Números naturales' },
      { label: 'ℂ', snippet: '\\mathbb{C}', title: 'Números complejos' },
    ],
  },
  {
    id: 'arrows',
    label: 'Flechas y Geometría',
    items: [
      { label: '→', snippet: '\\rightarrow ', title: 'Flecha derecha' },
      { label: '←', snippet: '\\leftarrow ', title: 'Flecha izquierda' },
      { label: '↔', snippet: '\\leftrightarrow ', title: 'Doble flecha' },
      { label: '⇒', snippet: '\\Rightarrow ', title: 'Implica' },
      { label: '⇔', snippet: '\\Leftrightarrow ', title: 'Si y solo si' },
      { label: '↦', snippet: '\\mapsto ', title: 'Mapea a' },
      { label: '∠', snippet: '\\angle ', title: 'Ángulo' },
      { label: '△', snippet: '\\triangle ', title: 'Triángulo' },
      { label: '⊥', snippet: '\\perp ', title: 'Perpendicular' },
      { label: '∥', snippet: '\\parallel ', title: 'Paralelo' },
      { label: '≅', snippet: '\\cong ', title: 'Congruente' },
      { label: '∼', snippet: '\\sim ', title: 'Semejante' },
    ],
  },
];

export const STRUCTURE_CATEGORIES: StructureCategory[] = [
  {
    id: 'fraction',
    label: 'Fracción',
    iconLatex: '\\frac{\\square}{\\square}',
    items: [
      { title: 'Fracción apilada', previewLatex: '\\frac{\\square}{\\square}', snippet: '\\frac{\\square}{\\square}' },
      { title: 'Fracción sesgada', previewLatex: '^{\\square}/_{\\square}', snippet: '^{\\square}/_{\\square}' },
      { title: 'Fracción lineal', previewLatex: '\\square / \\square', snippet: '\\square / \\square' },
      { title: 'Derivada dy/dx', previewLatex: '\\frac{dy}{dx}', snippet: '\\frac{dy}{dx}' },
      { title: 'Derivada parcial', previewLatex: '\\frac{\\partial y}{\\partial x}', snippet: '\\frac{\\partial y}{\\partial x}' },
      { title: 'Segunda derivada', previewLatex: '\\frac{d^2 y}{dx^2}', snippet: '\\frac{d^2 y}{dx^2}' },
    ],
  },
  {
    id: 'script',
    label: 'Índices',
    iconLatex: 'e^{\\square}',
    items: [
      { title: 'Superíndice', previewLatex: '\\square^{\\square}', snippet: '\\square^{\\square}' },
      { title: 'Subíndice', previewLatex: '\\square_{\\square}', snippet: '\\square_{\\square}' },
      { title: 'Subíndice y superíndice', previewLatex: '\\square_{\\square}^{\\square}', snippet: '\\square_{\\square}^{\\square}' },
      { title: 'Índices anteriores', previewLatex: '{}_{\\square}^{\\square}\\square', snippet: '{}_{\\square}^{\\square}\\square' },
      { title: 'Notación científica', previewLatex: '\\square \\times 10^{\\square}', snippet: '\\square \\times 10^{\\square}' },
      { title: 'Combinatoria nCr', previewLatex: '\\binom{\\square}{\\square}', snippet: '\\binom{\\square}{\\square}' },
    ],
  },
  {
    id: 'radical',
    label: 'Radical',
    iconLatex: '\\sqrt{\\square}',
    items: [
      { title: 'Raíz cuadrada', previewLatex: '\\sqrt{\\square}', snippet: '\\sqrt{\\square}' },
      { title: 'Radical con grado', previewLatex: '\\sqrt[\\square]{\\square}', snippet: '\\sqrt[\\square]{\\square}' },
      { title: 'Raíz cúbica', previewLatex: '\\sqrt[3]{\\square}', snippet: '\\sqrt[3]{\\square}' },
      { title: 'Fórmula cuadrática', previewLatex: '\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}', snippet: '\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
    ],
  },
  {
    id: 'integral',
    label: 'Integral',
    iconLatex: '\\int_{\\square}^{\\square}',
    items: [
      { title: 'Integral indefinida', previewLatex: '\\int \\square\\,dx', snippet: '\\int \\square\\,dx' },
      { title: 'Integral definida', previewLatex: '\\int_{\\square}^{\\square} \\square\\,dx', snippet: '\\int_{\\square}^{\\square} \\square\\,dx' },
      { title: 'Integral doble', previewLatex: '\\iint_{\\square} \\square\\,dA', snippet: '\\iint_{\\square} \\square\\,dA' },
      { title: 'Integral triple', previewLatex: '\\iiint_{\\square} \\square\\,dV', snippet: '\\iiint_{\\square} \\square\\,dV' },
      { title: 'Integral de contorno', previewLatex: '\\oint_{\\square} \\square\\,ds', snippet: '\\oint_{\\square} \\square\\,ds' },
    ],
  },
  {
    id: 'largeop',
    label: 'Operador grande',
    iconLatex: '\\sum_{\\square}^{\\square}',
    items: [
      { title: 'Sumatoria simple', previewLatex: '\\sum \\square', snippet: '\\sum \\square' },
      { title: 'Sumatoria con límites', previewLatex: '\\sum_{\\square}^{\\square} \\square', snippet: '\\sum_{\\square}^{\\square} \\square' },
      { title: 'Productoria', previewLatex: '\\prod_{\\square}^{\\square} \\square', snippet: '\\prod_{\\square}^{\\square} \\square' },
      { title: 'Coproductoria', previewLatex: '\\coprod_{\\square}^{\\square} \\square', snippet: '\\coprod_{\\square}^{\\square} \\square' },
      { title: 'Gran unión', previewLatex: '\\bigcup_{\\square}^{\\square} \\square', snippet: '\\bigcup_{\\square}^{\\square} \\square' },
      { title: 'Gran intersección', previewLatex: '\\bigcap_{\\square}^{\\square} \\square', snippet: '\\bigcap_{\\square}^{\\square} \\square' },
    ],
  },
  {
    id: 'bracket',
    label: 'Corchetes',
    iconLatex: '(\\square)',
    items: [
      { title: 'Paréntesis', previewLatex: '\\left( \\square \\right)', snippet: '\\left( \\square \\right)' },
      { title: 'Corchetes', previewLatex: '\\left[ \\square \\right]', snippet: '\\left[ \\square \\right]' },
      { title: 'Llaves', previewLatex: '\\left\\{ \\square \\right\\}', snippet: '\\left\\{ \\square \\right\\}' },
      { title: 'Valor absoluto', previewLatex: '\\left| \\square \\right|', snippet: '\\left| \\square \\right|' },
      { title: 'Norma vectorial', previewLatex: '\\left\\| \\square \\right\\|', snippet: '\\left\\| \\square \\right\\|' },
      { title: 'Sistema 2 ecuaciones', previewLatex: '\\begin{cases} \\square \\\\ \\square \\end{cases}', snippet: '\\begin{cases} \\square \\\\ \\square \\end{cases}' },
      { title: 'Sistema 3 ecuaciones', previewLatex: '\\begin{cases} \\square \\\\ \\square \\\\ \\square \\end{cases}', snippet: '\\begin{cases} \\square \\\\ \\square \\\\ \\square \\end{cases}' },
    ],
  },
  {
    id: 'function',
    label: 'Función',
    iconLatex: '\\sin\\theta',
    items: [
      { title: 'Seno', previewLatex: '\\sin(\\square)', snippet: '\\sin(\\square)' },
      { title: 'Coseno', previewLatex: '\\cos(\\square)', snippet: '\\cos(\\square)' },
      { title: 'Tangente', previewLatex: '\\tan(\\square)', snippet: '\\tan(\\square)' },
      { title: 'Arcoseno', previewLatex: '\\arcsin(\\square)', snippet: '\\arcsin(\\square)' },
      { title: 'Logaritmo natural', previewLatex: '\\ln(\\square)', snippet: '\\ln(\\square)' },
      { title: 'Logaritmo base n', previewLatex: '\\log_{\\square}(\\square)', snippet: '\\log_{\\square}(\\square)' },
      { title: 'Exponencial', previewLatex: 'e^{\\square}', snippet: 'e^{\\square}' },
      { title: 'Seno hiperbólico', previewLatex: '\\sinh(\\square)', snippet: '\\sinh(\\square)' },
    ],
  },
  {
    id: 'accent',
    label: 'Énfasis',
    iconLatex: '\\vec{a}',
    items: [
      { title: 'Vector superior', previewLatex: '\\vec{\\square}', snippet: '\\vec{\\square}' },
      { title: 'Vector dirigido', previewLatex: '\\overrightarrow{\\square}', snippet: '\\overrightarrow{\\square}' },
      { title: 'Vector unitario', previewLatex: '\\hat{\\square}', snippet: '\\hat{\\square}' },
      { title: 'Barra / Promedio', previewLatex: '\\overline{\\square}', snippet: '\\overline{\\square}' },
      { title: 'Punto (derivada t)', previewLatex: '\\dot{\\square}', snippet: '\\dot{\\square}' },
      { title: 'Doble punto', previewLatex: '\\ddot{\\square}', snippet: '\\ddot{\\square}' },
      { title: 'Llave inferior', previewLatex: '\\underbrace{\\square}_{\\square}', snippet: '\\underbrace{\\square}_{\\square}' },
    ],
  },
  {
    id: 'limit',
    label: 'Límite',
    iconLatex: '\\lim_{n\\to\\infty}',
    items: [
      { title: 'Límite general', previewLatex: '\\lim_{\\square \\to \\square} \\square', snippet: '\\lim_{\\square \\to \\square} \\square' },
      { title: 'Límite al infinito', previewLatex: '\\lim_{x \\to \\infty} \\square', snippet: '\\lim_{x \\to \\infty} \\square' },
      { title: 'Límite a cero', previewLatex: '\\lim_{h \\to 0} \\square', snippet: '\\lim_{h \\to 0} \\square' },
      { title: 'Máximo', previewLatex: '\\max_{\\square} \\square', snippet: '\\max_{\\square} \\square' },
      { title: 'Mínimo', previewLatex: '\\min_{\\square} \\square', snippet: '\\min_{\\square} \\square' },
    ],
  },
  {
    id: 'operator',
    label: 'Operador',
    iconLatex: '\\overset{\\square}{=}',
    items: [
      { title: 'Definido como', previewLatex: '\\square := \\square', snippet: '\\square := \\square' },
      { title: 'Flecha con etiqueta', previewLatex: '\\xrightarrow{\\square}', snippet: '\\xrightarrow{\\square}' },
      { title: 'Igual con etiqueta', previewLatex: '\\overset{\\square}{=}', snippet: '\\overset{\\square}{=}' },
      { title: 'Equivalente a', previewLatex: '\\square \\equiv \\square', snippet: '\\square \\equiv \\square' },
    ],
  },
  {
    id: 'matrix',
    label: 'Matriz',
    iconLatex: '\\begin{smallmatrix}\\square&\\square\\\\\\square&\\square\\end{smallmatrix}',
    items: [
      { title: 'Vector fila 1×2', previewLatex: '\\begin{pmatrix} \\square & \\square \\end{pmatrix}', snippet: '\\begin{pmatrix} \\square & \\square \\end{pmatrix}' },
      { title: 'Vector columna 2×1', previewLatex: '\\begin{pmatrix} \\square \\\\ \\square \\end{pmatrix}', snippet: '\\begin{pmatrix} \\square \\\\ \\square \\end{pmatrix}' },
      { title: 'Matriz 2×2 (paréntesis)', previewLatex: '\\begin{pmatrix} \\square & \\square \\\\ \\square & \\square \\end{pmatrix}', snippet: '\\begin{pmatrix} \\square & \\square \\\\ \\square & \\square \\end{pmatrix}' },
      { title: 'Matriz 2×2 (corchetes)', previewLatex: '\\begin{bmatrix} \\square & \\square \\\\ \\square & \\square \\end{bmatrix}', snippet: '\\begin{bmatrix} \\square & \\square \\\\ \\square & \\square \\end{bmatrix}' },
      { title: 'Matriz 3×3', previewLatex: '\\begin{pmatrix} \\square & \\square & \\square \\\\ \\square & \\square & \\square \\\\ \\square & \\square & \\square \\end{pmatrix}', snippet: '\\begin{pmatrix} \\square & \\square & \\square \\\\ \\square & \\square & \\square \\\\ \\square & \\square & \\square \\end{pmatrix}' },
      { title: 'Determinante 2×2', previewLatex: '\\begin{vmatrix} \\square & \\square \\\\ \\square & \\square \\end{vmatrix}', snippet: '\\begin{vmatrix} \\square & \\square \\\\ \\square & \\square \\end{vmatrix}' },
    ],
  },
];

export function renderKatexSafe(tex: string, displayMode = false): string {
  try {
    const html = renderKatexToStringLazy(tex || '\\square', {
      displayMode,
      throwOnError: false,
      strict: false,
    });
    if (html !== null) return html;
    return renderLatexFallbackHtml(tex || '');
  } catch {
    // Muestra el código LaTeX en texto plano seguro si falla el renderizado
    const escaped = String(tex || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<code class="font-mono text-xs break-all">${escaped}</code>`;
  }
}

/**
 * Highlights the active \square placeholder in KaTeX preview when editing live on the canvas
 * so it looks like an active shaded placeholder slot.
 */
export function highlightActiveSlotLatex(latex: string, cursorPos: number): string {
  const target = '\\square';
  if (!latex.includes(target)) return latex;

  // Find the \square enclosing or closest after cursorPos, otherwise the first \square
  let bestIdx = latex.indexOf(target, Math.max(0, cursorPos - target.length));
  if (bestIdx === -1) {
    bestIdx = latex.indexOf(target);
  }
  if (bestIdx === -1) return latex;

  return (
    latex.slice(0, bestIdx) +
    '\\colorbox{#cbd5e1}{\\square}' +
    latex.slice(bestIdx + target.length)
  );
}
