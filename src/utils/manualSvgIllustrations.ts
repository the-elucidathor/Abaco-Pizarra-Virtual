// Generadores SVG reutilizables para el Manual de Usuario de Ábaco Pizarra Virtual
// Cada función devuelve un documento SVG vectorial puro legible tanto a color como en impresión B/N.

const FONT = 'Helvetica, Arial, sans-serif';
const MONO = 'Courier, monospace';
const PURPLE = '#6d28d9';
const PURPLE_SOFT = '#f5f3ff';
const PURPLE_MID = '#ddd6fe';
const DARK = '#0f172a';
const SLATE = '#475569';
const MUTED = '#64748b';
const BORDER = '#cbd5e1';
const BG_PANEL = '#f8fafc';

function svgWrap(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

function numBadge(cx: number, cy: number, label: string, fill = PURPLE): string {
  return `
    <circle cx="${cx}" cy="${cy}" r="8.5" fill="${fill}" stroke="#ffffff" stroke-width="1.2"/>
    <text x="${cx}" y="${cy}" fill="#ffffff" font-size="9.5" font-weight="bold" font-family="${FONT}" text-anchor="middle" dominant-baseline="central">${label}</text>
  `;
}

// 1. Mapa de la interfaz: esquema con las 6 zonas numeradas y su leyenda
export function svgMapaInterfaz(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="236" rx="8" fill="#ffffff" stroke="${BORDER}" stroke-width="1.2"/>`);

  // Zona 1: Barra superior
  parts.push(`<rect x="10" y="10" width="520" height="24" rx="4" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="1.2"/>`);
  parts.push(`<rect x="16" y="15" width="14" height="14" rx="3" fill="${PURPLE}"/>`);
  parts.push(`<text x="23" y="22.5" fill="#ffffff" font-size="9" font-weight="bold" font-family="${FONT}" text-anchor="middle" dominant-baseline="central">A</text>`);
  parts.push(`<text x="36" y="24.5" fill="${DARK}" font-size="8.5" font-weight="bold" font-family="${FONT}">Proyecto  |  Archivo  Editar  Ver  Insertar</text>`);
  parts.push(`<rect x="424" y="15" width="44" height="14" rx="3" fill="${PURPLE}"/>`);
  parts.push(`<text x="446" y="22.5" fill="#ffffff" font-size="7.5" font-weight="bold" font-family="${FONT}" text-anchor="middle" dominant-baseline="central">Exportar</text>`);
  parts.push(`<rect x="472" y="15" width="50" height="14" rx="3" fill="#ffffff" stroke="${PURPLE}" stroke-width="1"/>`);
  parts.push(`<text x="497" y="22.5" fill="${PURPLE}" font-size="7.5" font-weight="bold" font-family="${FONT}" text-anchor="middle" dominant-baseline="central">Manual PDF</text>`);
  parts.push(numBadge(265, 22, '1'));

  // Zona 2: Pestañas de pizarrones
  parts.push(`<rect x="10" y="38" width="520" height="18" rx="3" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<rect x="16" y="41" width="74" height="12" rx="3" fill="#ffffff" stroke="${PURPLE}" stroke-width="1"/>`);
  parts.push(`<text x="53" y="49.5" fill="${DARK}" font-size="7.5" font-weight="bold" font-family="${FONT}" text-anchor="middle">Pizarrón 1</text>`);
  parts.push(`<rect x="94" y="41" width="66" height="12" rx="3" fill="#e2e8f0"/>`);
  parts.push(`<text x="127" y="49.5" fill="${SLATE}" font-size="7.5" font-family="${FONT}" text-anchor="middle">Hoja Carta</text>`);
  parts.push(`<text x="168" y="50" fill="${PURPLE}" font-size="10" font-weight="bold" font-family="${FONT}">+</text>`);
  parts.push(numBadge(265, 47, '2'));

  // Zona 3: Barra lateral izquierda
  parts.push(`<rect x="10" y="60" width="32" height="114" rx="5" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.2"/>`);
  for (let i = 0; i < 6; i++) {
    const by = 66 + i * 16;
    parts.push(`<rect x="16" y="${by}" width="20" height="12" rx="3" fill="${i === 0 ? PURPLE : '#ffffff'}" stroke="${i === 0 ? PURPLE : BORDER}" stroke-width="0.9"/>`);
  }
  parts.push(numBadge(26, 120, '3'));

  // Zona 4: Lienzo central con hoja y marco
  parts.push(`<rect x="48" y="60" width="356" height="114" rx="4" fill="#eef2f6" stroke="${BORDER}" stroke-width="1.1"/>`);
  parts.push(`<rect x="86" y="68" width="280" height="98" rx="2" fill="#ffffff" stroke="#94a3b8" stroke-width="1"/>`);
  // Marco interior con cuadrícula
  parts.push(`<rect x="100" y="76" width="252" height="82" fill="none" stroke="#64748b" stroke-width="1.2"/>`);
  for (let gx = 118; gx < 352; gx += 18) {
    parts.push(`<line x1="${gx}" y1="76" x2="${gx}" y2="158" stroke="#e2e8f0" stroke-width="0.7"/>`);
  }
  for (let gy = 90; gy < 158; gy += 14) {
    parts.push(`<line x1="100" y1="${gy}" x2="352" y2="${gy}" stroke="#e2e8f0" stroke-width="0.7"/>`);
  }
  parts.push(`<rect x="132" y="92" width="70" height="44" rx="2" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="1.5"/>`);
  parts.push(`<circle cx="268" cy="116" r="22" fill="none" stroke="#2563eb" stroke-width="1.5"/>`);
  parts.push(numBadge(226, 117, '4'));

  // Zona 5: Inspector derecho
  parts.push(`<rect x="410" y="60" width="120" height="114" rx="5" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.2"/>`);
  parts.push(`<rect x="415" y="65" width="36" height="13" rx="2.5" fill="${PURPLE}"/>`);
  parts.push(`<text x="433" y="74" fill="#ffffff" font-size="6.8" font-weight="bold" font-family="${FONT}" text-anchor="middle">Prop.</text>`);
  parts.push(`<rect x="453" y="65" width="36" height="13" rx="2.5" fill="#ffffff" stroke="${BORDER}" stroke-width="0.8"/>`);
  parts.push(`<text x="471" y="74" fill="${SLATE}" font-size="6.8" font-family="${FONT}" text-anchor="middle">Capas</text>`);
  parts.push(`<rect x="491" y="65" width="34" height="13" rx="2.5" fill="#ffffff" stroke="${BORDER}" stroke-width="0.8"/>`);
  parts.push(`<text x="508" y="74" fill="${SLATE}" font-size="6.8" font-family="${FONT}" text-anchor="middle">Orden</text>`);
  parts.push(`<line x1="416" y1="88" x2="520" y2="88" stroke="${BORDER}" stroke-width="0.8"/>`);
  parts.push(`<rect x="418" y="96" width="98" height="8" rx="2" fill="#e2e8f0"/>`);
  parts.push(`<rect x="418" y="110" width="76" height="8" rx="2" fill="#e2e8f0"/>`);
  parts.push(`<rect x="418" y="124" width="88" height="8" rx="2" fill="#e2e8f0"/>`);
  parts.push(numBadge(470, 148, '5'));

  // Zona 6: Barra CAD inferior y barra de estado
  parts.push(`<rect x="10" y="179" width="520" height="22" rx="4" fill="${BG_PANEL}" stroke="${PURPLE}" stroke-width="1.1"/>`);
  parts.push(`<text x="20" y="193" fill="${DARK}" font-size="7.5" font-weight="bold" font-family="${MONO}">LIN  PL  REC  CIR  ARC  |  GRID  SNAP  ORT  SP  RG  DIN</text>`);
  parts.push(numBadge(492, 190, '6'));

  // Leyenda en 2 filas
  const legend = [
    ['1', 'Barra superior y menús'],
    ['2', 'Pestañas de pizarrones'],
    ['3', 'Barra lateral de herramientas'],
    ['4', 'Lienzo central / Hoja'],
    ['5', 'Inspector (Propiedades, Capas, Orden)'],
    ['6', 'Barra CAD y estado (zoom / coords)'],
  ];
  legend.forEach(([num, label], idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const lx = 18 + col * 176;
    const ly = 213 + row * 15;
    parts.push(`<circle cx="${lx}" cy="${ly}" r="6" fill="${PURPLE}"/>`);
    parts.push(`<text x="${lx}" y="${ly}" fill="#ffffff" font-size="7.5" font-weight="bold" font-family="${FONT}" text-anchor="middle" dominant-baseline="central">${num}</text>`);
    parts.push(`<text x="${lx + 10}" y="${ly + 2.8}" fill="${DARK}" font-size="7.8" font-family="${FONT}">${label}</text>`);
  });

  return svgWrap(540, 240, parts.join(''));
}

// 2. Barra lateral: iconos de cada herramienta con su atajo debajo
export function svgBarraLateral(): string {
  const tools: { label: string; key: string; drawIcon: (cx: number, cy: number) => string }[] = [
    {
      label: 'Selección',
      key: 'V',
      drawIcon: (cx, cy) =>
        `<polygon points="${cx - 5},${cy - 7} ${cx - 5},${cy + 6} ${cx - 1},${cy + 2} ${cx + 3},${cy + 8} ${cx + 5},${cy + 7} ${cx + 1},${cy + 1} ${cx + 6},${cy + 1}" fill="${PURPLE}"/>`,
    },
    {
      label: 'Mano',
      key: 'H',
      drawIcon: (cx, cy) =>
        `<rect x="${cx - 5}" y="${cy - 2}" width="10" height="8" rx="2.5" fill="none" stroke="${DARK}" stroke-width="1.3"/><line x1="${cx - 3}" y1="${cy - 6}" x2="${cx - 3}" y2="${cy - 2}" stroke="${DARK}" stroke-width="1.3"/><line x1="${cx}" y1="${cy - 7}" x2="${cx}" y2="${cy - 2}" stroke="${DARK}" stroke-width="1.3"/><line x1="${cx + 3}" y1="${cy - 6}" x2="${cx + 3}" y2="${cy - 2}" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      label: 'Lápiz',
      key: 'P',
      drawIcon: (cx, cy) =>
        `<path d="M ${cx - 6} ${cy + 6} L ${cx - 4} ${cy + 1} L ${cx + 4} ${cy - 7} L ${cx + 7} ${cy - 4} L ${cx - 1} ${cy + 4} Z" fill="none" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      label: 'Borrador',
      key: 'E',
      drawIcon: (cx, cy) =>
        `<polygon points="${cx - 6},${cy + 3} ${cx - 1},${cy - 5} ${cx + 7},${cy - 1} ${cx + 2},${cy + 6}" fill="${PURPLE_SOFT}" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      label: 'Texto',
      key: 'T',
      drawIcon: (cx, cy) =>
        `<text x="${cx}" y="${cy + 4}" fill="${DARK}" font-size="14" font-weight="bold" font-family="${FONT}" text-anchor="middle">T</text>`,
    },
    {
      label: 'Figuras',
      key: 'S',
      drawIcon: (cx, cy) =>
        `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" rx="1.5" fill="none" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      label: 'Líneas',
      key: 'L',
      drawIcon: (cx, cy) =>
        `<line x1="${cx - 6}" y1="${cy + 6}" x2="${cx + 6}" y2="${cy - 6}" stroke="${DARK}" stroke-width="1.5"/><polyline points="${cx + 1},${cy - 6} ${cx + 6},${cy - 6} ${cx + 6},${cy - 1}" fill="none" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      label: 'Cortar',
      key: 'C',
      drawIcon: (cx, cy) =>
        `<circle cx="${cx - 4}" cy="${cy + 4}" r="2.5" fill="none" stroke="${DARK}" stroke-width="1.2"/><circle cx="${cx + 4}" cy="${cy + 4}" r="2.5" fill="none" stroke="${DARK}" stroke-width="1.2"/><line x1="${cx - 2}" y1="${cy + 2}" x2="${cx + 5}" y2="${cy - 6}" stroke="#dc2626" stroke-width="1.3"/><line x1="${cx + 2}" y1="${cy + 2}" x2="${cx - 5}" y2="${cy - 6}" stroke="#dc2626" stroke-width="1.3"/>`,
    },
    {
      label: 'Ecuación',
      key: 'M',
      drawIcon: (cx, cy) =>
        `<polyline points="${cx + 5},${cy - 6} ${cx - 5},${cy - 6} ${cx + 1},${cy} ${cx - 5},${cy + 6} ${cx + 5},${cy + 6}" fill="none" stroke="${DARK}" stroke-width="1.5"/>`,
    },
    {
      label: 'Insertar',
      key: 'G/N/Tab',
      drawIcon: (cx, cy) =>
        `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" rx="2" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="1.2"/><line x1="${cx - 3}" y1="${cy}" x2="${cx + 3}" y2="${cy}" stroke="${PURPLE}" stroke-width="1.4"/><line x1="${cx}" y1="${cy - 3}" x2="${cx}" y2="${cy + 3}" stroke="${PURPLE}" stroke-width="1.4"/>`,
    },
  ];

  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="86" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  tools.forEach((t, idx) => {
    const cx = 31 + idx * 52;
    const cy = 26;
    parts.push(`<rect x="${cx - 16}" y="${cy - 16}" width="32" height="32" rx="6" fill="#ffffff" stroke="${idx === 0 ? PURPLE : BORDER}" stroke-width="${idx === 0 ? 1.5 : 1}"/>`);
    parts.push(t.drawIcon(cx, cy));
    parts.push(`<text x="${cx}" y="55" fill="${DARK}" font-size="7.5" font-weight="bold" font-family="${FONT}" text-anchor="middle">${t.label}</text>`);
    parts.push(`<rect x="${cx - 17}" y="61" width="34" height="14" rx="3" fill="${PURPLE_SOFT}" stroke="${PURPLE_MID}" stroke-width="0.9"/>`);
    parts.push(`<text x="${cx}" y="70.5" fill="${PURPLE}" font-size="7.2" font-weight="bold" font-family="${MONO}" text-anchor="middle">${t.key}</text>`);
  });

  return svgWrap(540, 90, parts.join(''));
}

// 3. Tamaños de hoja: Carta, Oficio, Doble Carta y Media Carta con marco (margen, borde y cuadrícula)
export function svgTamanosHoja(): string {
  const sheets = [
    { name: 'Carta', dims: '21.6 x 27.9 cm', w: 56, h: 72, cols: 5, rows: 7 },
    { name: 'Oficio', dims: '21.6 x 35.6 cm', w: 56, h: 92, cols: 5, rows: 9 },
    { name: 'Doble Carta', dims: '27.9 x 43.2 cm', w: 72, h: 112, cols: 7, rows: 11 },
    { name: 'Media Carta', dims: '14.0 x 21.6 cm', w: 38, h: 58, cols: 3, rows: 5 },
  ];

  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="156" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  const centersX = [68, 175, 294, 405];
  const baseBottomY = 128;

  sheets.forEach((s, i) => {
    const sx = centersX[i] - s.w / 2;
    const sy = baseBottomY - s.h;
    // Sombra sutil y hoja de papel
    parts.push(`<rect x="${sx + 2}" y="${sy + 2}" width="${s.w}" height="${s.h}" rx="1.5" fill="#cbd5e1"/>`);
    parts.push(`<rect x="${sx}" y="${sy}" width="${s.w}" height="${s.h}" rx="1.5" fill="#ffffff" stroke="${SLATE}" stroke-width="1"/>`);

    // Marco interior ajustado a celdas completas con margen exterior visible
    const step = 8;
    const fw = s.cols * step;
    const fh = s.rows * step;
    const fx = sx + (s.w - fw) / 2;
    const fy = sy + (s.h - fh) / 2;

    for (let c = 1; c < s.cols; c++) {
      const lx = fx + c * step;
      parts.push(`<line x1="${lx}" y1="${fy}" x2="${lx}" y2="${fy + fh}" stroke="#cbd5e1" stroke-width="0.6"/>`);
    }
    for (let r = 1; r < s.rows; r++) {
      const ly = fy + r * step;
      parts.push(`<line x1="${fx}" y1="${ly}" x2="${fx + fw}" y2="${ly}" stroke="#cbd5e1" stroke-width="0.6"/>`);
    }
    // Borde del marco (1.5x más grueso)
    parts.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="${PURPLE}" stroke-width="1.35"/>`);

    parts.push(`<text x="${centersX[i]}" y="140" fill="${DARK}" font-size="8.5" font-weight="bold" font-family="${FONT}" text-anchor="middle">${s.name}</text>`);
    parts.push(`<text x="${centersX[i]}" y="150" fill="${MUTED}" font-size="7.2" font-family="${MONO}" text-anchor="middle">${s.dims}</text>`);
  });

  // Nota de margen y Espacio Infinito a la derecha
  parts.push(`<rect x="442" y="18" width="86" height="122" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="485" y="34" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}" text-anchor="middle">Marco de hoja</text>`);
  parts.push(`<rect x="454" y="42" width="62" height="38" fill="#ffffff" stroke="${SLATE}" stroke-width="0.9"/>`);
  parts.push(`<rect x="461" y="48" width="48" height="26" fill="none" stroke="${PURPLE}" stroke-width="1.3"/>`);
  parts.push(`<text x="485" y="63" fill="${SLATE}" font-size="6.8" font-family="${FONT}" text-anchor="middle">Área útil</text>`);
  parts.push(`<text x="485" y="92" fill="${DARK}" font-size="7" font-family="${FONT}" text-anchor="middle">Margen: 0–25 mm</text>`);
  parts.push(`<text x="485" y="103" fill="${DARK}" font-size="7" font-family="${FONT}" text-anchor="middle">(10 mm por defecto)</text>`);
  parts.push(`<line x1="450" y1="112" x2="520" y2="112" stroke="${BORDER}" stroke-width="0.8"/>`);
  parts.push(`<text x="485" y="123" fill="${SLATE}" font-size="6.8" font-weight="bold" font-family="${FONT}" text-anchor="middle">Espacio infinito:</text>`);
  parts.push(`<text x="485" y="133" fill="${MUTED}" font-size="6.8" font-family="${FONT}" text-anchor="middle">sin marco ni borde</text>`);

  return svgWrap(540, 160, parts.join(''));
}

// 4. Borrador parcial y Cortar: diagramas Antes / Después
export function svgBorradorYCortar(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="128" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  const panels = [
    { title: '1. Borrador parcial en línea', x: 10, w: 168 },
    { title: '2. Círculo convertido en arco', x: 186, w: 168 },
    { title: '3. Cuchilla Cortar (C)', x: 362, w: 168 },
  ];

  panels.forEach((p) => {
    parts.push(`<rect x="${p.x}" y="10" width="${p.w}" height="112" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
    parts.push(`<text x="${p.x + p.w / 2}" y="23" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}" text-anchor="middle">${p.title}</text>`);
    parts.push(`<text x="${p.x + 36}" y="37" fill="${MUTED}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">ANTES</text>`);
    parts.push(`<text x="${p.x + 128}" y="37" fill="${DARK}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">DESPUÉS</text>`);
    parts.push(`<line x1="${p.x + 76}" y1="32" x2="${p.x + 76}" y2="112" stroke="#e2e8f0" stroke-width="0.9"/>`);
  });

  // Panel 1: Línea dividida en dos
  parts.push(`<line x1="20" y1="88" x2="72" y2="54" stroke="${DARK}" stroke-width="2.2" stroke-linecap="round"/>`);
  parts.push(`<circle cx="46" cy="71" r="9" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`);
  parts.push(`<line x1="94" y1="88" x2="112" y2="76" stroke="${DARK}" stroke-width="2.2" stroke-linecap="round"/>`);
  parts.push(`<line x1="128" y1="66" x2="164" y2="44" stroke="${DARK}" stroke-width="2.2" stroke-linecap="round"/>`);
  parts.push(`<text x="130" y="108" fill="${SLATE}" font-size="7" font-family="${FONT}" text-anchor="middle">2 tramos independientes</text>`);

  // Panel 2: Círculo -> Arco
  parts.push(`<circle cx="223" cy="74" r="20" fill="none" stroke="${DARK}" stroke-width="2.2"/>`);
  parts.push(`<circle cx="238" cy="60" r="8" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="1.2" stroke-dasharray="2.5 2"/>`);
  parts.push(`<path d="M 326 62 A 20 20 0 1 0 331 82" fill="none" stroke="${DARK}" stroke-width="2.2" stroke-linecap="round"/>`);
  parts.push(`<text x="312" y="108" fill="${SLATE}" font-size="7" font-family="${FONT}" text-anchor="middle">Arco editable limpio</text>`);

  // Panel 3: Cuchilla roja cruzando 2 líneas
  parts.push(`<line x1="372" y1="54" x2="428" y2="54" stroke="${DARK}" stroke-width="2"/>`);
  parts.push(`<line x1="372" y1="88" x2="428" y2="88" stroke="${DARK}" stroke-width="2"/>`);
  parts.push(`<line x1="406" y1="42" x2="394" y2="100" stroke="#dc2626" stroke-width="1.7" stroke-dasharray="4 2.5"/>`);
  parts.push(`<circle cx="403.5" cy="54" r="2.8" fill="#ffffff" stroke="#dc2626" stroke-width="1.3"/>`);
  parts.push(`<circle cx="396.5" cy="88" r="2.8" fill="#ffffff" stroke="#dc2626" stroke-width="1.3"/>`);

  parts.push(`<line x1="450" y1="54" x2="478" y2="54" stroke="${DARK}" stroke-width="2"/>`);
  parts.push(`<line x1="484" y1="54" x2="518" y2="54" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="2 2"/>`);
  parts.push(`<line x1="450" y1="88" x2="472" y2="88" stroke="${DARK}" stroke-width="2"/>`);
  parts.push(`<line x1="478" y1="88" x2="518" y2="88" stroke="${DARK}" stroke-width="2"/>`);
  parts.push(`<text x="484" y="108" fill="${SLATE}" font-size="7" font-family="${FONT}" text-anchor="middle">Corte exacto en cruce</text>`);

  return svgWrap(540, 132, parts.join(''));
}

// 5. Figuras: cuadrícula de miniaturas de figuras 2D y sólidos 3D con su nombre
export function svgFiguras2d3d(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="196" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  const items2D: { name: string; draw: (x: number, y: number) => string }[] = [
    { name: 'Rectángulo', draw: (x, y) => `<rect x="${x - 13}" y="${y - 8}" width="26" height="16" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Cuadrado', draw: (x, y) => `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Triángulo', draw: (x, y) => `<polygon points="${x},${y - 10} ${x + 11},${y + 9} ${x - 11},${y + 9}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Triáng. rect.', draw: (x, y) => `<polygon points="${x - 10},${y - 9} ${x - 10},${y + 9} ${x + 11},${y + 9}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Trapecio', draw: (x, y) => `<polygon points="${x - 7},${y - 8} ${x + 7},${y - 8} ${x + 12},${y + 8} ${x - 12},${y + 8}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Paralelogr.', draw: (x, y) => `<polygon points="${x - 6},${y - 8} ${x + 13},${y - 8} ${x + 6},${y + 8} ${x - 13},${y + 8}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Rombo', draw: (x, y) => `<polygon points="${x},${y - 10} ${x + 12},${y} ${x},${y + 10} ${x - 12},${y}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Pentágono', draw: (x, y) => `<polygon points="${x},${y - 10} ${x + 10},${y - 2} ${x + 6},${y + 9} ${x - 6},${y + 9} ${x - 10},${y - 2}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Hexágono', draw: (x, y) => `<polygon points="${x - 5},${y - 9} ${x + 5},${y - 9} ${x + 10},${y} ${x + 5},${y + 9} ${x - 5},${y + 9} ${x - 10},${y}" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Estrella', draw: (x, y) => `<polygon points="${x},${y - 11} ${x + 3},${y - 3} ${x + 11},${y - 3} ${x + 5},${y + 2} ${x + 7},${y + 10} ${x},${y + 5} ${x - 7},${y + 10} ${x - 5},${y + 2} ${x - 11},${y - 3} ${x - 3},${y - 3}" fill="none" stroke="${DARK}" stroke-width="1.2"/>` },
    { name: 'Círculo', draw: (x, y) => `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Elipse', draw: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="13" ry="8" fill="none" stroke="${DARK}" stroke-width="1.4"/>` },
    { name: 'Arco', draw: (x, y) => `<path d="M ${x - 10} ${y + 6} A 11 11 0 1 1 ${x + 10} ${y + 6}" fill="none" stroke="${DARK}" stroke-width="1.5"/>` },
    { name: 'Polilínea', draw: (x, y) => `<polyline points="${x - 12},${y + 7} ${x - 4},${y - 7} ${x + 4},${y + 5} ${x + 12},${y - 8}" fill="none" stroke="${DARK}" stroke-width="1.5"/>` },
  ];

  const items3D: { name: string; draw: (x: number, y: number) => string }[] = [
    {
      name: 'Cubo',
      draw: (x, y) =>
        `<rect x="${x - 10}" y="${y - 4}" width="14" height="14" fill="#ffffff" stroke="${DARK}" stroke-width="1.3"/><polygon points="${x - 10},${y - 4} ${x - 3},${y - 10} ${x + 11},${y - 10} ${x + 4},${y - 4}" fill="${PURPLE_SOFT}" stroke="${DARK}" stroke-width="1.2"/><polygon points="${x + 4},${y - 4} ${x + 11},${y - 10} ${x + 11},${y + 4} ${x + 4},${y + 10}" fill="#e2e8f0" stroke="${DARK}" stroke-width="1.2"/>`,
    },
    {
      name: 'Cubo transp.',
      draw: (x, y) =>
        `<rect x="${x - 10}" y="${y - 4}" width="14" height="14" fill="none" stroke="${DARK}" stroke-width="1.2"/><rect x="${x - 3}" y="${y - 10}" width="14" height="14" fill="none" stroke="${SLATE}" stroke-width="1" stroke-dasharray="2 1.5"/><line x1="${x - 10}" y1="${y - 4}" x2="${x - 3}" y2="${y - 10}" stroke="${DARK}" stroke-width="1.1"/><line x1="${x + 4}" y1="${y - 4}" x2="${x + 11}" y2="${y - 10}" stroke="${DARK}" stroke-width="1.1"/><line x1="${x + 4}" y1="${y + 10}" x2="${x + 11}" y2="${y + 4}" stroke="${DARK}" stroke-width="1.1"/>`,
    },
    {
      name: 'Cilindro',
      draw: (x, y) =>
        `<line x1="${x - 9}" y1="${y - 7}" x2="${x - 9}" y2="${y + 7}" stroke="${DARK}" stroke-width="1.3"/><line x1="${x + 9}" y1="${y - 7}" x2="${x + 9}" y2="${y + 7}" stroke="${DARK}" stroke-width="1.3"/><path d="M ${x - 9} ${y + 7} A 9 4 0 0 0 ${x + 9} ${y + 7}" fill="none" stroke="${DARK}" stroke-width="1.3"/><ellipse cx="${x}" cy="${y - 7}" rx="9" ry="4" fill="${PURPLE_SOFT}" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      name: 'Pirámide cuad.',
      draw: (x, y) =>
        `<polygon points="${x},${y - 11} ${x - 11},${y + 8} ${x + 2},${y + 10} ${x + 12},${y + 4}" fill="none" stroke="${DARK}" stroke-width="1.3"/><line x1="${x}" y1="${y - 11}" x2="${x + 2}" y2="${y + 10}" stroke="${DARK}" stroke-width="1.2"/><line x1="${x - 11}" y1="${y + 8}" x2="${x + 12}" y2="${y + 4}" stroke="${MUTED}" stroke-width="0.9" stroke-dasharray="2 1.5"/>`,
    },
    {
      name: 'Cono',
      draw: (x, y) =>
        `<line x1="${x}" y1="${y - 11}" x2="${x - 10}" y2="${y + 7}" stroke="${DARK}" stroke-width="1.3"/><line x1="${x}" y1="${y - 11}" x2="${x + 10}" y2="${y + 7}" stroke="${DARK}" stroke-width="1.3"/><ellipse cx="${x}" cy="${y + 7}" rx="10" ry="3.8" fill="none" stroke="${DARK}" stroke-width="1.3"/>`,
    },
    {
      name: 'Esfera',
      draw: (x, y) =>
        `<circle cx="${x}" cy="${y}" r="10.5" fill="none" stroke="${DARK}" stroke-width="1.4"/><ellipse cx="${x}" cy="${y}" rx="10.5" ry="3.8" fill="none" stroke="${SLATE}" stroke-width="0.9" stroke-dasharray="2.5 2"/>`,
    },
    {
      name: 'Prisma tri.',
      draw: (x, y) =>
        `<polygon points="${x - 11},${y + 8} ${x - 4},${y - 8} ${x + 3},${y + 8}" fill="#ffffff" stroke="${DARK}" stroke-width="1.3"/><polygon points="${x - 4},${y - 8} ${x + 7},${y - 10} ${x + 12},${y + 5} ${x + 3},${y + 8}" fill="${PURPLE_SOFT}" stroke="${DARK}" stroke-width="1.2"/>`,
    },
    {
      name: 'Octaedro',
      draw: (x, y) =>
        `<polygon points="${x},${y - 11} ${x + 10},${y} ${x},${y + 11} ${x - 10},${y}" fill="none" stroke="${DARK}" stroke-width="1.3"/><line x1="${x - 10}" y1="${y}" x2="${x + 10}" y2="${y}" stroke="${DARK}" stroke-width="1.1"/><line x1="${x}" y1="${y - 11}" x2="${x + 2}" y2="${y + 11}" stroke="${SLATE}" stroke-width="0.9"/>`,
    },
    {
      name: 'Tetraedro',
      draw: (x, y) =>
        `<polygon points="${x},${y - 11} ${x - 10},${y + 8} ${x + 11},${y + 5}" fill="none" stroke="${DARK}" stroke-width="1.3"/><line x1="${x}" y1="${y - 11}" x2="${x - 1}" y2="${y + 9}" stroke="${DARK}" stroke-width="1.2"/>`,
    },
    {
      name: 'Tronco cono',
      draw: (x, y) =>
        `<ellipse cx="${x}" cy="${y - 8}" rx="6" ry="2.6" fill="${PURPLE_SOFT}" stroke="${DARK}" stroke-width="1.2"/><line x1="${x - 6}" y1="${y - 8}" x2="${x - 10}" y2="${y + 7}" stroke="${DARK}" stroke-width="1.3"/><line x1="${x + 6}" y1="${y - 8}" x2="${x + 10}" y2="${y + 7}" stroke="${DARK}" stroke-width="1.3"/><path d="M ${x - 10} ${y + 7} A 10 3.6 0 0 0 ${x + 10} ${y + 7}" fill="none" stroke="${DARK}" stroke-width="1.3"/>`,
    },
  ];

  parts.push(`<text x="14" y="18" fill="${PURPLE}" font-size="8.2" font-weight="bold" font-family="${FONT}">FIGURAS GEOMÉTRICAS 2D (selección de catálogo)</text>`);
  items2D.forEach((it, i) => {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const x = 14 + col * 74;
    const y = 24 + row * 40;
    parts.push(`<rect x="${x}" y="${y}" width="69" height="35" rx="4" fill="#ffffff" stroke="${BORDER}" stroke-width="0.9"/>`);
    parts.push(it.draw(x + 34.5, y + 13));
    parts.push(`<text x="${x + 34.5}" y="${y + 31.5}" fill="${DARK}" font-size="6.8" font-family="${FONT}" text-anchor="middle">${it.name}</text>`);
  });

  parts.push(`<text x="14" y="114" fill="${PURPLE}" font-size="8.2" font-weight="bold" font-family="${FONT}">SÓLIDOS 3D Y VOLÚMENES</text>`);
  items3D.forEach((it, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = 14 + col * 104;
    const y = 120 + row * 38;
    parts.push(`<rect x="${x}" y="${y}" width="98" height="34" rx="4" fill="#ffffff" stroke="${BORDER}" stroke-width="0.9"/>`);
    parts.push(it.draw(x + 22, y + 17));
    parts.push(`<text x="${x + 66}" y="${y + 19}" fill="${DARK}" font-size="7.3" font-weight="bold" font-family="${FONT}" text-anchor="middle">${it.name}</text>`);
  });

  return svgWrap(540, 200, parts.join(''));
}

// 6. Coordenadas: plano cartesiano con ejemplo exacto 100,50 -> @80,-25 -> @120<45
export function svgCoordenadas(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="176" rx="8" fill="#ffffff" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Origen en ox=60, oy=146; escala: 1 unidad = 1.05 px en X, 1.05 px en Y (Y hacia arriba)
  const ox = 56;
  const oy = 146;
  const sc = 1.0;

  // Cuadrícula de referencia cada 25 u
  for (let gx = ox; gx <= 390; gx += 25) {
    parts.push(`<line x1="${gx}" y1="16" x2="${gx}" y2="160" stroke="#f1f5f9" stroke-width="0.8"/>`);
  }
  for (let gy = 21; gy <= 146; gy += 25) {
    parts.push(`<line x1="36" y1="${gy}" x2="390" y2="${gy}" stroke="#f1f5f9" stroke-width="0.8"/>`);
  }

  // Ejes X e Y
  parts.push(`<line x1="34" y1="${oy}" x2="392" y2="${oy}" stroke="${SLATE}" stroke-width="1.3"/>`);
  parts.push(`<polygon points="392,${oy} 386,${oy - 3} 386,${oy + 3}" fill="${SLATE}"/>`);
  parts.push(`<text x="396" y="${oy + 3}" fill="${DARK}" font-size="8.5" font-weight="bold" font-family="${FONT}">+X</text>`);

  parts.push(`<line x1="${ox}" y1="162" x2="${ox}" y2="14" stroke="${SLATE}" stroke-width="1.3"/>`);
  parts.push(`<polygon points="${ox},14 ${ox - 3},20 ${ox + 3},20" fill="${SLATE}"/>`);
  parts.push(`<text x="${ox - 10}" y="18" fill="${DARK}" font-size="8.5" font-weight="bold" font-family="${FONT}">+Y</text>`);
  parts.push(`<text x="${ox - 6}" y="${oy + 11}" fill="${SLATE}" font-size="7.5" font-weight="bold" font-family="${MONO}" text-anchor="end">(0,0)</text>`);

  // Coordenadas reales del ejemplo:
  // P1 = (100, 50)
  const p1x = ox + 100 * sc; // 156
  const p1y = oy - 50 * sc;  // 96
  // P2 = P1 + (80, -25) = (180, 25)
  const p2x = ox + 180 * sc; // 236
  const p2y = oy - 25 * sc;  // 121
  // P3 = P2 + (120 * cos45, 120 * sin45) = (264.85, 109.85)
  const p3x = ox + (180 + 84.85) * sc; // 320.85
  const p3y = oy - (25 + 84.85) * sc;  // 36.15

  // Proyección punteada desde (0,0) -> P1 = 100,50
  parts.push(`<line x1="${ox}" y1="${oy}" x2="${p1x}" y2="${p1y}" stroke="#2563eb" stroke-width="1.4" stroke-dasharray="3.5 2.5"/>`);
  parts.push(`<circle cx="${p1x}" cy="${p1y}" r="3.5" fill="#2563eb"/>`);
  parts.push(`<text x="${p1x - 4}" y="${p1y - 8}" fill="#1d4ed8" font-size="8" font-weight="bold" font-family="${MONO}" text-anchor="middle">100,50</text>`);

  // Desplazamiento relativo P1 -> P2 (@80,-25)
  parts.push(`<line x1="${p1x}" y1="${p1y}" x2="${p2x}" y2="${p1y}" stroke="#94a3b8" stroke-width="0.9" stroke-dasharray="2 2"/>`);
  parts.push(`<line x1="${p2x}" y1="${p1y}" x2="${p2x}" y2="${p2y}" stroke="#94a3b8" stroke-width="0.9" stroke-dasharray="2 2"/>`);
  parts.push(`<text x="${(p1x + p2x) / 2}" y="${p1y - 4}" fill="${MUTED}" font-size="6.8" font-family="${MONO}" text-anchor="middle">+80</text>`);
  parts.push(`<text x="${p2x + 4}" y="${(p1y + p2y) / 2 + 2}" fill="${MUTED}" font-size="6.8" font-family="${MONO}">-25</text>`);
  parts.push(`<line x1="${p1x}" y1="${p1y}" x2="${p2x}" y2="${p2y}" stroke="${PURPLE}" stroke-width="2.1"/>`);
  parts.push(`<circle cx="${p2x}" cy="${p2y}" r="3.5" fill="${PURPLE}"/>`);
  parts.push(`<text x="${p2x + 5}" y="${p2y + 11}" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${MONO}">@80,-25</text>`);

  // Polar relativa P2 -> P3 (@120<45) con ángulo en sentido antihorario
  parts.push(`<line x1="${p2x}" y1="${p2y}" x2="${p2x + 52}" y2="${p2y}" stroke="${SLATE}" stroke-width="1" stroke-dasharray="3 2"/>`);
  // Arco de 45° antihorario
  const rArc = 28;
  const ax = p2x + rArc * Math.cos(-Math.PI / 4);
  const ay = p2y + rArc * Math.sin(-Math.PI / 4);
  parts.push(`<path d="M ${p2x + rArc} ${p2y} A ${rArc} ${rArc} 0 0 0 ${ax.toFixed(1)} ${ay.toFixed(1)}" fill="none" stroke="#d97706" stroke-width="1.5"/>`);
  parts.push(`<text x="${p2x + 34}" y="${p2y - 9}" fill="#b45309" font-size="7.8" font-weight="bold" font-family="${MONO}">45° (antihorario)</text>`);
  parts.push(`<line x1="${p2x}" y1="${p2y}" x2="${p3x.toFixed(1)}" y2="${p3y.toFixed(1)}" stroke="${PURPLE}" stroke-width="2.1"/>`);
  parts.push(`<circle cx="${p3x.toFixed(1)}" cy="${p3y.toFixed(1)}" r="3.5" fill="${PURPLE}"/>`);
  parts.push(`<text x="${(p2x + p3x) / 2 - 22}" y="${(p2y + p3y) / 2 - 8}" fill="${PURPLE}" font-size="8.2" font-weight="bold" font-family="${MONO}">@120&lt;45</text>`);
  parts.push(`<text x="${p3x.toFixed(1)}" y="${(p3y - 8).toFixed(1)}" fill="${DARK}" font-size="7.2" font-family="${MONO}" text-anchor="middle">(264.9, 109.9)</text>`);

  // Caja resumen a la derecha
  parts.push(`<rect x="406" y="16" width="122" height="144" rx="6" fill="${PURPLE_SOFT}" stroke="${PURPLE_MID}" stroke-width="1"/>`);
  parts.push(`<text x="415" y="32" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}">Resumen de entrada</text>`);
  parts.push(`<text x="415" y="49" fill="${DARK}" font-size="7.5" font-weight="bold" font-family="${MONO}">1. 100,50</text>`);
  parts.push(`<text x="415" y="60" fill="${SLATE}" font-size="7" font-family="${FONT}">Punto absoluto desde (0,0).</text>`);
  parts.push(`<text x="415" y="79" fill="${DARK}" font-size="7.5" font-weight="bold" font-family="${MONO}">2. @80,-25</text>`);
  parts.push(`<text x="415" y="90" fill="${SLATE}" font-size="7" font-family="${FONT}">Avanza +80 en X y -25 en Y.</text>`);
  parts.push(`<text x="415" y="109" fill="${DARK}" font-size="7.5" font-weight="bold" font-family="${MONO}">3. @120&lt;45</text>`);
  parts.push(`<text x="415" y="120" fill="${SLATE}" font-size="7" font-family="${FONT}">Distancia 120 a 45° contra</text>`);
  parts.push(`<text x="415" y="130" fill="${SLATE}" font-size="7" font-family="${FONT}">las manecillas del reloj.</text>`);

  return svgWrap(540, 180, parts.join(''));
}

// 7. ORT: comparación lado a lado "Línea (horizontal/vertical)" vs "Rectángulo (proporción 1:1)"
export function svgOrtComparacion(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="122" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Lado izquierdo: Línea H/V
  parts.push(`<rect x="12" y="10" width="252" height="104" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="138" y="25" fill="${PURPLE}" font-size="8.5" font-weight="bold" font-family="${FONT}" text-anchor="middle">Línea con ORT [F8]: Horizontal / Vertical</text>`);
  parts.push(`<line x1="40" y1="88" x2="210" y2="88" stroke="${DARK}" stroke-width="2.2"/>`);
  parts.push(`<line x1="40" y1="88" x2="40" y2="38" stroke="${DARK}" stroke-width="2.2"/>`);
  parts.push(`<line x1="40" y1="88" x2="188" y2="46" stroke="${MUTED}" stroke-width="1.2" stroke-dasharray="3 2.5"/>`);
  parts.push(`<circle cx="40" cy="88" r="3" fill="${PURPLE}"/>`);
  parts.push(`<circle cx="210" cy="88" r="3" fill="${PURPLE}"/>`);
  parts.push(`<circle cx="40" cy="38" r="3" fill="${PURPLE}"/>`);
  parts.push(`<text x="136" y="100" fill="${DARK}" font-size="7.3" font-family="${MONO}" text-anchor="middle">0° o 90° exactos (cursores libres bloqueados)</text>`);
  parts.push(`<text x="206" y="54" fill="${MUTED}" font-size="7" font-family="${FONT}">Cursor real</text>`);

  // Lado derecho: Rectángulo proporción 1:1
  parts.push(`<rect x="276" y="10" width="252" height="104" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="402" y="25" fill="${PURPLE}" font-size="8.5" font-weight="bold" font-family="${FONT}" text-anchor="middle">Rectángulo / Figura con ORT [F8]: Proporción 1:1</text>`);
  parts.push(`<rect x="330" y="36" width="58" height="58" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="2"/>`);
  parts.push(`<rect x="330" y="36" width="88" height="44" fill="none" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3 2.5"/>`);
  parts.push(`<line x1="330" y1="36" x2="388" y2="94" stroke="${PURPLE}" stroke-width="1" stroke-dasharray="2.5 2"/>`);
  parts.push(`<text x="359" y="104" fill="${DARK}" font-size="7.3" font-weight="bold" font-family="${MONO}" text-anchor="middle">L = H (cuadrado 1:1)</text>`);
  parts.push(`<text x="454" y="60" fill="${SLATE}" font-size="7.2" font-family="${FONT}" text-anchor="middle">También aplica</text>`);
  parts.push(`<text x="454" y="71" fill="${SLATE}" font-size="7.2" font-family="${FONT}" text-anchor="middle">con Shift + arrastrar</text>`);
  parts.push(`<text x="454" y="82" fill="${SLATE}" font-size="7.2" font-family="${FONT}" text-anchor="middle">en Círculo / Triáng.</text>`);

  return svgWrap(540, 126, parts.join(''));
}

// 8. SNAP, SP y DIN: un diagrama con cursor en nodos, rayos 15°, 30°, 45°, 90° y etiqueta DIN
export function svgSnapSpDin(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="156" rx="8" fill="#ffffff" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Cuadrícula SNAP
  for (let x = 24; x <= 324; x += 25) {
    parts.push(`<line x1="${x}" y1="16" x2="${x}" y2="144" stroke="#e2e8f0" stroke-width="0.8"/>`);
  }
  for (let y = 16; y <= 144; y += 22) {
    parts.push(`<line x1="24" y1="${y}" x2="324" y2="${y}" stroke="#e2e8f0" stroke-width="0.8"/>`);
  }

  // Nodos SNAP
  const ox = 74;
  const oy = 126;
  for (let nx = 24; nx <= 324; nx += 50) {
    for (let ny = 16; ny <= 144; ny += 44) {
      parts.push(`<circle cx="${nx}" cy="${ny}" r="1.8" fill="#94a3b8"/>`);
    }
  }
  parts.push(`<circle cx="${ox}" cy="${oy}" r="3.5" fill="${DARK}"/>`);

  // Rayos polares SP desde (ox, oy): 0°, 15°, 30°, 45°, 90°
  const angles = [
    { deg: 0, len: 190, active: false, label: '0°' },
    { deg: 15, len: 185, active: false, label: '15°' },
    { deg: 30, len: 180, active: false, label: '30°' },
    { deg: 45, len: 145, active: true, label: '45°' },
    { deg: 90, len: 105, active: false, label: '90°' },
  ];
  angles.forEach((a) => {
    const rad = (-a.deg * Math.PI) / 180;
    const tx = ox + a.len * Math.cos(rad);
    const ty = oy + a.len * Math.sin(rad);
    parts.push(`<line x1="${ox}" y1="${oy}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${a.active ? PURPLE : '#94a3b8'}" stroke-width="${a.active ? 1.8 : 0.95}" stroke-dasharray="${a.active ? 'none' : '4 2.5'}"/>`);
    parts.push(`<text x="${(tx + 7).toFixed(1)}" y="${(ty + 2).toFixed(1)}" fill="${a.active ? PURPLE : SLATE}" font-size="7.5" font-weight="${a.active ? 'bold' : 'normal'}" font-family="${MONO}">${a.label}</text>`);
  });

  // Cursor saltando a nodo exacto
  const cx = 176;
  const cy = 24;
  parts.push(`<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="#ffffff" stroke="${PURPLE}" stroke-width="1.6"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="1.8" fill="${PURPLE}"/>`);

  // Etiqueta flotante DIN junto al cursor
  parts.push(`<rect x="${cx + 12}" y="${cy - 4}" width="118" height="24" rx="4" fill="${DARK}"/>`);
  parts.push(`<text x="${cx + 18}" y="${cy + 6}" fill="#ffffff" font-size="7.2" font-weight="bold" font-family="${MONO}">X: 120.0   Y: 85.0</text>`);
  parts.push(`<text x="${cx + 18}" y="${cy + 15.5}" fill="#ddd6fe" font-size="7" font-family="${MONO}">L: 140.0   Ang: 45°</text>`);

  // Leyenda derecha
  parts.push(`<rect x="342" y="16" width="184" height="128" rx="6" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="352" y="34" fill="${PURPLE}" font-size="8.2" font-weight="bold" font-family="${FONT}">SNAP + SP + DIN combinados</text>`);
  parts.push(`<text x="352" y="52" fill="${DARK}" font-size="7.6" font-weight="bold" font-family="${FONT}">SNAP [F9]:</text>`);
  parts.push(`<text x="352" y="63" fill="${SLATE}" font-size="7.2" font-family="${FONT}">Salta a intersecciones de paso fijo.</text>`);
  parts.push(`<text x="352" y="82" fill="${DARK}" font-size="7.6" font-weight="bold" font-family="${FONT}">SP [F10] (Seguimiento polar):</text>`);
  parts.push(`<text x="352" y="93" fill="${SLATE}" font-size="7.2" font-family="${FONT}">Alinea rayos cada 15°, 30°, 45° o 90°.</text>`);
  parts.push(`<text x="352" y="112" fill="${DARK}" font-size="7.6" font-weight="bold" font-family="${FONT}">DIN [F12] (Entrada dinámica):</text>`);
  parts.push(`<text x="352" y="123" fill="${SLATE}" font-size="7.2" font-family="${FONT}">Muestra X, Y, distancia y ángulo</text>`);
  parts.push(`<text x="352" y="133" fill="${SLATE}" font-size="7.2" font-family="${FONT}">junto al cursor mientras dibujas.</text>`);

  return svgWrap(540, 160, parts.join(''));
}

// 9. RG (OSNAP): los 7 marcadores reales sobre un objeto de ejemplo
export function svgOsnapRg(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="146" rx="8" fill="#ffffff" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Objetos de ejemplo a la izquierda
  // Rectángulo + línea diagonal + círculo + línea paralela
  parts.push(`<rect x="28" y="34" width="110" height="72" fill="none" stroke="${DARK}" stroke-width="1.6"/>`);
  parts.push(`<line x1="28" y1="106" x2="178" y2="28" stroke="${DARK}" stroke-width="1.6"/>`);
  parts.push(`<circle cx="236" cy="74" r="36" fill="none" stroke="${DARK}" stroke-width="1.6"/>`);
  // Línea auxiliar mostrando paralelo y perpendicular
  parts.push(`<line x1="162" y1="124" x2="282" y2="124" stroke="${SLATE}" stroke-width="1.3"/>`);
  parts.push(`<line x1="162" y1="106" x2="282" y2="106" stroke="${MUTED}" stroke-width="1" stroke-dasharray="3 2"/>`);

  // 1. Extremo (cuadro) en (28,34)
  parts.push(`<rect x="23" y="29" width="10" height="10" fill="#ffffff" stroke="#16a34a" stroke-width="1.8"/>`);
  parts.push(`<text x="28" y="23" fill="#15803d" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Extremo</text>`);

  // 2. Punto medio (triángulo) en (83, 34)
  parts.push(`<polygon points="83,27 89,38 77,38" fill="#ffffff" stroke="#2563eb" stroke-width="1.6"/>`);
  parts.push(`<text x="83" y="22" fill="#1d4ed8" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Punto medio</text>`);

  // 5. Intersección (X) donde la diagonal cruza el borde derecho del rectángulo (138, 49)
  parts.push(`<line x1="133" y1="44" x2="143" y2="54" stroke="#dc2626" stroke-width="2"/>`);
  parts.push(`<line x1="143" y1="44" x2="133" y2="54" stroke="#dc2626" stroke-width="2"/>`);
  parts.push(`<text x="148" y="42" fill="#b91c1c" font-size="7" font-weight="bold" font-family="${FONT}">Intersección</text>`);

  // 3. Centro (círculo) en (236,74)
  parts.push(`<circle cx="236" cy="74" r="5" fill="#ffffff" stroke="${PURPLE}" stroke-width="1.8"/>`);
  parts.push(`<circle cx="236" cy="74" r="1.6" fill="${PURPLE}"/>`);
  parts.push(`<text x="236" y="64" fill="${PURPLE}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Centro</text>`);

  // 4. Cuadrante (rombo) en (236, 38)
  parts.push(`<polygon points="236,32 242,38 236,44 230,38" fill="#ffffff" stroke="#d97706" stroke-width="1.6"/>`);
  parts.push(`<text x="236" y="25" fill="#b45309" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Cuadrante</text>`);

  // 6. Perpendicular (∟) en (83, 106)
  parts.push(`<polyline points="83,96 83,106 93,106" fill="none" stroke="#0284c7" stroke-width="1.8"/>`);
  parts.push(`<text x="83" y="122" fill="#0369a1" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Perpendicular</text>`);

  // 7. Paralelo (//) en (218, 115)
  parts.push(`<line x1="214" y1="119" x2="220" y2="109" stroke="${PURPLE}" stroke-width="1.7"/>`);
  parts.push(`<line x1="219" y1="119" x2="225" y2="109" stroke="${PURPLE}" stroke-width="1.7"/>`);
  parts.push(`<text x="242" y="137" fill="${PURPLE}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Paralelo</text>`);

  // Leyenda derecha de los 7 marcadores reales
  parts.push(`<rect x="308" y="14" width="218" height="120" rx="6" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="318" y="30" fill="${PURPLE}" font-size="8.2" font-weight="bold" font-family="${FONT}">Marcadores RG (OSNAP [F3])</text>`);
  const markers: [string, string, string][] = [
    ['Cuadro', 'Extremo', 'Vértice o fin de línea'],
    ['Triángulo', 'Punto medio', 'Centro exacto de arista'],
    ['Círculo', 'Centro', 'Centro de círculo/polígono'],
    ['Rombo', 'Cuadrante', '0°, 90°, 180° y 270°'],
    ['Cruz (X)', 'Intersección', 'Cruce entre segmentos'],
    ['Ángulo recto', 'Perpendicular', 'A 90° de la arista'],
    ['Doble barra //', 'Paralelo', 'Misma dirección que ref.'],
  ];
  markers.forEach(([sym, name, desc], i) => {
    const ry = 43 + i * 13;
    parts.push(`<text x="318" y="${ry}" fill="${DARK}" font-size="7.1" font-weight="bold" font-family="${FONT}">${name}:</text>`);
    parts.push(`<text x="376" y="${ry}" fill="${SLATE}" font-size="7" font-family="${FONT}">${sym} — ${desc}</text>`);
  });

  return svgWrap(540, 150, parts.join(''));
}

// 10. Acotación: ejemplos de cota lineal, alineada, angular, radial, diametral y por coordenadas
export function svgAcotacion(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="136" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  const cells = [
    { title: 'Lineal (ACL)', x: 10, y: 10 },
    { title: 'Alineada (ACA)', x: 186, y: 10 },
    { title: 'Angular (ANG)', x: 362, y: 10 },
    { title: 'Radial (RAD)', x: 10, y: 74 },
    { title: 'Diametral (DIA)', x: 186, y: 74 },
    { title: 'Por coordenadas (COR)', x: 362, y: 74 },
  ];

  cells.forEach((c) => {
    parts.push(`<rect x="${c.x}" y="${c.y}" width="168" height="56" rx="5" fill="#ffffff" stroke="${BORDER}" stroke-width="0.9"/>`);
    parts.push(`<text x="${c.x + 84}" y="${c.y + 12}" fill="${PURPLE}" font-size="7.6" font-weight="bold" font-family="${FONT}" text-anchor="middle">${c.title}</text>`);
  });

  // 1. Lineal
  parts.push(`<rect x="44" y="34" width="98" height="22" fill="none" stroke="${DARK}" stroke-width="1.4"/>`);
  parts.push(`<line x1="44" y1="24" x2="44" y2="34" stroke="#0284c7" stroke-width="0.9"/>`);
  parts.push(`<line x1="142" y1="24" x2="142" y2="34" stroke="#0284c7" stroke-width="0.9"/>`);
  parts.push(`<line x1="44" y1="27" x2="142" y2="27" stroke="#0284c7" stroke-width="1.2"/>`);
  parts.push(`<text x="93" y="25" fill="#0369a1" font-size="7.2" font-weight="bold" font-family="${MONO}" text-anchor="middle">120 u</text>`);

  // 2. Alineada
  parts.push(`<line x1="226" y1="54" x2="310" y2="32" stroke="${DARK}" stroke-width="1.6"/>`);
  parts.push(`<line x1="223" y1="45" x2="307" y2="23" stroke="#0284c7" stroke-width="1.2"/>`);
  parts.push(`<text x="262" y="31" fill="#0369a1" font-size="7.2" font-weight="bold" font-family="${MONO}" text-anchor="middle">86.4 u</text>`);

  // 3. Angular
  parts.push(`<line x1="406" y1="56" x2="486" y2="56" stroke="${DARK}" stroke-width="1.4"/>`);
  parts.push(`<line x1="406" y1="56" x2="466" y2="25" stroke="${DARK}" stroke-width="1.4"/>`);
  parts.push(`<path d="M 442 56 A 36 36 0 0 0 436 39" fill="none" stroke="#0284c7" stroke-width="1.3"/>`);
  parts.push(`<text x="456" y="47" fill="#0369a1" font-size="7.5" font-weight="bold" font-family="${MONO}">32°</text>`);

  // 4. Radial
  parts.push(`<circle cx="72" cy="108" r="15" fill="none" stroke="${DARK}" stroke-width="1.4"/>`);
  parts.push(`<line x1="72" y1="108" x2="84" y2="98" stroke="#0284c7" stroke-width="1.3"/>`);
  parts.push(`<text x="116" y="109" fill="#0369a1" font-size="7.4" font-weight="bold" font-family="${MONO}" text-anchor="middle">R 24.0</text>`);

  // 5. Diametral
  parts.push(`<circle cx="246" cy="108" r="15" fill="none" stroke="${DARK}" stroke-width="1.4"/>`);
  parts.push(`<line x1="234" y1="117" x2="258" y2="99" stroke="#0284c7" stroke-width="1.3"/>`);
  parts.push(`<text x="296" y="109" fill="#0369a1" font-size="7.4" font-weight="bold" font-family="${MONO}" text-anchor="middle">D 48.0</text>`);

  // 6. Por coordenadas
  parts.push(`<circle cx="404" cy="109" r="3" fill="${DARK}"/>`);
  parts.push(`<polyline points="404,109 426,95 480,95" fill="none" stroke="#0284c7" stroke-width="1.2"/>`);
  parts.push(`<text x="452" y="105" fill="#0369a1" font-size="7" font-weight="bold" font-family="${MONO}" text-anchor="middle">X: 120  Y: 80</text>`);

  return svgWrap(540, 140, parts.join(''));
}

// 11. Apariencia: 6 muestras de color de lienzo, 5 patrones y 8 tarjetas de tema
export function svgApariencia(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="176" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Bloque A: 6 colores de lienzo
  parts.push(`<text x="14" y="18" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}">COLOR DEL LIENZO (6 opciones)</text>`);
  const canvasColors = [
    { name: 'Automático', bg: '#f1f5f9', ink: DARK },
    { name: 'Blanco', bg: '#ffffff', ink: DARK },
    { name: 'Grafito', bg: '#1f2937', ink: '#ffffff' },
    { name: 'Verde pizarra', bg: '#1f4d3a', ink: '#ffffff' },
    { name: 'Crema', bg: '#f5efe0', ink: DARK },
    { name: 'Personalizado', bg: '#ede9fe', ink: PURPLE },
  ];
  canvasColors.forEach((c, i) => {
    const cx = 14 + i * 86;
    parts.push(`<rect x="${cx}" y="23" width="80" height="24" rx="4" fill="${c.bg}" stroke="${BORDER}" stroke-width="1"/>`);
    parts.push(`<text x="${cx + 40}" y="38" fill="${c.ink}" font-size="7.2" font-weight="bold" font-family="${FONT}" text-anchor="middle">${c.name}</text>`);
  });

  // Bloque B: 5 patrones de fondo
  parts.push(`<text x="14" y="64" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}">PATRONES DE FONDO (5 diseños)</text>`);
  const patterns = ['Blanco liso', 'Cuadriculado', 'Rayado', 'Punteado', 'Isométrico'];
  patterns.forEach((pName, i) => {
    const px = 14 + i * 103;
    const py = 69;
    parts.push(`<rect x="${px}" y="${py}" width="96" height="34" rx="4" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
    if (i === 1) {
      for (let gx = px + 16; gx < px + 96; gx += 16) {
        parts.push(`<line x1="${gx}" y1="${py}" x2="${gx}" y2="${py + 34}" stroke="#cbd5e1" stroke-width="0.7"/>`);
      }
      for (let gy = py + 11; gy < py + 34; gy += 11) {
        parts.push(`<line x1="${px}" y1="${gy}" x2="${px + 96}" y2="${gy}" stroke="#cbd5e1" stroke-width="0.7"/>`);
      }
    } else if (i === 2) {
      for (let gy = py + 8; gy < py + 34; gy += 8) {
        parts.push(`<line x1="${px}" y1="${gy}" x2="${px + 96}" y2="${gy}" stroke="#93c5fd" stroke-width="0.8"/>`);
      }
    } else if (i === 3) {
      for (let gx = px + 10; gx < px + 92; gx += 14) {
        for (let gy = py + 8; gy < py + 30; gy += 10) {
          parts.push(`<circle cx="${gx}" cy="${gy}" r="1.1" fill="#64748b"/>`);
        }
      }
    } else if (i === 4) {
      for (let k = 0; k < 5; k++) {
        const bx = px + 8 + k * 18;
        parts.push(`<line x1="${bx}" y1="${py + 2}" x2="${bx + 16}" y2="${py + 32}" stroke="#cbd5e1" stroke-width="0.7"/>`);
        parts.push(`<line x1="${bx + 16}" y1="${py + 2}" x2="${bx}" y2="${py + 32}" stroke="#cbd5e1" stroke-width="0.7"/>`);
      }
    }
    parts.push(`<rect x="${px + 12}" y="${py + 20}" width="72" height="12" rx="2" fill="#ffffff" opacity="0.9"/>`);
    parts.push(`<text x="${px + 48}" y="${py + 28.5}" fill="${DARK}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">${pName}</text>`);
  });

  // Bloque C: 8 tarjetas de tema
  parts.push(`<text x="14" y="120" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}">TEMAS DE INTERFAZ (8 estilos)</text>`);
  const themes = [
    { name: 'Claro', bg: '#ffffff', acc: '#2563eb', dark: false },
    { name: 'Oscuro', bg: '#0f172a', acc: '#3b82f6', dark: true },
    { name: 'Cálida', bg: '#fff7ed', acc: '#ea580c', dark: false },
    { name: 'Fría', bg: '#f8fafc', acc: '#6d28d9', dark: false },
    { name: 'Natura', bg: '#f0fdf4', acc: '#15803d', dark: false },
    { name: 'Plano', bg: '#0b2a4a', acc: '#4fd1e8', dark: true },
    { name: 'Sepia', bg: '#f3e7d3', acc: '#c2410c', dark: false },
    { name: 'Neón', bg: '#12001f', acc: '#22d3ee', dark: true },
  ];
  themes.forEach((t, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const tx = 14 + col * 130;
    const ty = 125 + row * 24;
    parts.push(`<rect x="${tx}" y="${ty}" width="124" height="20" rx="4" fill="${t.bg}" stroke="${BORDER}" stroke-width="1"/>`);
    parts.push(`<circle cx="${tx + 12}" cy="${ty + 10}" r="5" fill="${t.acc}"/>`);
    parts.push(`<text x="${tx + 24}" y="${ty + 13}" fill="${t.dark ? '#ffffff' : DARK}" font-size="7.6" font-weight="bold" font-family="${FONT}">${t.name}</text>`);
  });

  return svgWrap(540, 180, parts.join(''));
}

// 12. Novedades 1.11.1: tabla de ejemplo, texto con formato mixto, justificado y menú ortográfico
export function svgNovedades1111(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="146" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Panel 1: Tabla editable con mini barra
  parts.push(`<rect x="10" y="10" width="168" height="128" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="94" y="24" fill="${PURPLE}" font-size="7.8" font-weight="bold" font-family="${FONT}" text-anchor="middle">Editor de tablas (Tab / +Fila)</text>`);
  // Mini barra contextual
  parts.push(`<rect x="22" y="30" width="144" height="14" rx="3" fill="${PURPLE_SOFT}" stroke="${PURPLE_MID}" stroke-width="0.9"/>`);
  parts.push(`<text x="94" y="39.5" fill="${PURPLE}" font-size="6.6" font-weight="bold" font-family="${FONT}" text-anchor="middle">+Fila  +Col  |  N  K  S  |  Alinear</text>`);
  // Tabla 3x3
  parts.push(`<rect x="22" y="49" width="144" height="18" fill="#ede9fe" stroke="${SLATE}" stroke-width="0.8"/>`);
  parts.push(`<rect x="22" y="67" width="144" height="18" fill="#ffffff" stroke="${SLATE}" stroke-width="0.8"/>`);
  parts.push(`<rect x="22" y="85" width="144" height="18" fill="#ffffff" stroke="${SLATE}" stroke-width="0.8"/>`);
  parts.push(`<line x1="70" y1="49" x2="70" y2="103" stroke="${SLATE}" stroke-width="0.8"/>`);
  parts.push(`<line x1="118" y1="49" x2="118" y2="103" stroke="${SLATE}" stroke-width="0.8"/>`);
  parts.push(`<text x="46" y="60.5" fill="${DARK}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Concepto</text>`);
  parts.push(`<text x="94" y="60.5" fill="${DARK}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Valor</text>`);
  parts.push(`<text x="142" y="60.5" fill="${DARK}" font-size="7" font-weight="bold" font-family="${FONT}" text-anchor="middle">Unidad</text>`);
  parts.push(`<text x="46" y="78.5" fill="${SLATE}" font-size="6.8" font-family="${FONT}" text-anchor="middle">Fuerza</text>`);
  parts.push(`<text x="94" y="78.5" fill="${SLATE}" font-size="6.8" font-family="${MONO}" text-anchor="middle">12.5</text>`);
  parts.push(`<text x="142" y="78.5" fill="${SLATE}" font-size="6.8" font-family="${FONT}" text-anchor="middle">N</text>`);
  parts.push(`<text x="94" y="122" fill="${MUTED}" font-size="6.8" font-family="${FONT}" text-anchor="middle">Tab avanza celda o agrega fila</text>`);

  // Panel 2: Texto con formato mixto sobre selección + justificado
  parts.push(`<rect x="186" y="10" width="168" height="128" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="270" y="24" fill="${PURPLE}" font-size="7.8" font-weight="bold" font-family="${FONT}" text-anchor="middle">Formato mixto y Justificado</text>`);
  parts.push(`<rect x="196" y="32" width="148" height="44" rx="4" fill="${BG_PANEL}" stroke="${PURPLE}" stroke-width="1"/>`);
  parts.push(`<text x="204" y="47" fill="${DARK}" font-size="8" font-family="${FONT}">Texto </text>`);
  parts.push(`<rect x="228" y="38" width="46" height="12" rx="2" fill="#dbeafe"/>`);
  parts.push(`<text x="230" y="47" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}">seleccionado</text>`);
  parts.push(`<text x="204" y="62" fill="${SLATE}" font-size="7.5" font-style="italic" font-family="${FONT}">cursiva,</text>`);
  parts.push(`<text x="236" y="62" fill="#dc2626" font-size="7.5" font-weight="bold" font-family="${FONT}">color</text>`);
  parts.push(`<text x="260" y="62" fill="${DARK}" font-size="7.5" font-family="${FONT}">y subrayado</text>`);
  parts.push(`<line x1="268" y1="64" x2="310" y2="64" stroke="${DARK}" stroke-width="0.9"/>`);

  // Justificado
  parts.push(`<rect x="196" y="83" width="148" height="44" rx="4" fill="#ffffff" stroke="${BORDER}" stroke-width="0.9"/>`);
  parts.push(`<text x="204" y="95" fill="${PURPLE}" font-size="6.8" font-weight="bold" font-family="${FONT}">Justificado [Ctrl+J]: bordes rectos</text>`);
  parts.push(`<line x1="204" y1="103" x2="336" y2="103" stroke="${SLATE}" stroke-width="1.5"/>`);
  parts.push(`<line x1="204" y1="110" x2="336" y2="110" stroke="${SLATE}" stroke-width="1.5"/>`);
  parts.push(`<line x1="204" y1="117" x2="292" y2="117" stroke="${SLATE}" stroke-width="1.5"/>`);

  // Panel 3: Corrector ortográfico ES/EN con menú de sugerencias
  parts.push(`<rect x="362" y="10" width="168" height="128" rx="6" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
  parts.push(`<text x="446" y="24" fill="${PURPLE}" font-size="7.8" font-weight="bold" font-family="${FONT}" text-anchor="middle">Corrector ortográfico ES/EN</text>`);
  parts.push(`<rect x="374" y="32" width="144" height="28" rx="4" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="0.9"/>`);
  parts.push(`<text x="382" y="48" fill="${DARK}" font-size="8.2" font-family="${FONT}">Revisar </text>`);
  parts.push(`<text x="415" y="48" fill="#b91c1c" font-size="8.2" font-weight="bold" font-family="${FONT}">ortografa</text>`);
  // Subrayado ondulado rojo
  parts.push(`<path d="M 415 51 Q 418 53 421 51 Q 424 49 427 51 Q 430 53 433 51 Q 436 49 439 51 Q 442 53 445 51 Q 448 49 452 51" fill="none" stroke="#dc2626" stroke-width="1.2"/>`);

  // Menú de sugerencias
  parts.push(`<rect x="394" y="64" width="114" height="66" rx="5" fill="#ffffff" stroke="${PURPLE}" stroke-width="1.2"/>`);
  parts.push(`<rect x="398" y="68" width="106" height="16" rx="3" fill="${PURPLE_SOFT}"/>`);
  parts.push(`<text x="404" y="79" fill="${PURPLE}" font-size="7.6" font-weight="bold" font-family="${FONT}">ortografía</text>`);
  parts.push(`<line x1="398" y1="88" x2="504" y2="88" stroke="${BORDER}" stroke-width="0.7"/>`);
  parts.push(`<text x="404" y="100" fill="${DARK}" font-size="7.2" font-family="${FONT}">Ignorar esta vez</text>`);
  parts.push(`<text x="404" y="114" fill="${DARK}" font-size="7.2" font-family="${FONT}">Agregar al diccionario</text>`);
  parts.push(`<text x="404" y="125" fill="${MUTED}" font-size="6.4" font-family="${FONT}">Idiomas: ES (MX/ES) y EN</text>`);

  return svgWrap(540, 150, parts.join(''));
}

// Diagrama extra: Ejemplo paso a paso cuadrado 5u (LIN -> 0,0 -> @5,0 -> @0,5 -> @-5,0 -> C)
export function svgEjemploCuadrado5u(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="106" rx="8" fill="#ffffff" stroke="${BORDER}" stroke-width="1.1"/>`);

  // Cuadrado a la derecha, pasos a la izquierda
  const sx = 356;
  const sy = 84;
  const side = 62;
  parts.push(`<line x1="${sx - 24}" y1="${sy}" x2="${sx + side + 34}" y2="${sy}" stroke="#cbd5e1" stroke-width="0.9"/>`);
  parts.push(`<line x1="${sx}" y1="${sy + 14}" x2="${sx}" y2="${sy - side - 14}" stroke="#cbd5e1" stroke-width="0.9"/>`);
  parts.push(`<rect x="${sx}" y="${sy - side}" width="${side}" height="${side}" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="2"/>`);

  // Vértices y cotas
  parts.push(`<circle cx="${sx}" cy="${sy}" r="3" fill="${DARK}"/>`);
  parts.push(`<circle cx="${sx + side}" cy="${sy}" r="3" fill="${DARK}"/>`);
  parts.push(`<circle cx="${sx + side}" cy="${sy - side}" r="3" fill="${DARK}"/>`);
  parts.push(`<circle cx="${sx}" cy="${sy - side}" r="3" fill="${DARK}"/>`);
  parts.push(`<text x="${sx - 6}" y="${sy + 10}" fill="${DARK}" font-size="7" font-family="${MONO}" text-anchor="end">0,0</text>`);
  parts.push(`<text x="${sx + side + 4}" y="${sy + 10}" fill="${PURPLE}" font-size="7" font-weight="bold" font-family="${MONO}">@5,0</text>`);
  parts.push(`<text x="${sx + side + 5}" y="${sy - side + 2}" fill="${PURPLE}" font-size="7" font-weight="bold" font-family="${MONO}">@0,5</text>`);
  parts.push(`<text x="${sx - 6}" y="${sy - side + 2}" fill="${PURPLE}" font-size="7" font-weight="bold" font-family="${MONO}" text-anchor="end">@-5,0</text>`);
  parts.push(`<text x="${sx + side / 2}" y="${sy - side / 2 + 2}" fill="${PURPLE}" font-size="8" font-weight="bold" font-family="${FONT}" text-anchor="middle">5 x 5 u</text>`);

  // Pasos numerados a la izquierda
  parts.push(`<text x="16" y="22" fill="${PURPLE}" font-size="8.5" font-weight="bold" font-family="${FONT}">Ejemplo guiado: cuadrado cerrado de 5 unidades</text>`);
  const steps = [
    ['1. Escribe LIN y pulsa Enter', 'Inicia comando de segmentos continuos'],
    ['2. Escribe 0,0 y Enter', 'Fija el vértice inicial en el origen'],
    ['3. @5,0  ->  @0,5  ->  @-5,0', 'Traza derecha, arriba e izquierda (+5 u)'],
    ['4. Escribe C y Enter', 'Cierra automáticamente hacia (0,0)'],
  ];
  steps.forEach(([cmd, desc], i) => {
    const ry = 38 + i * 16;
    parts.push(`<text x="16" y="${ry}" fill="${DARK}" font-size="7.6" font-weight="bold" font-family="${MONO}">${cmd}</text>`);
    parts.push(`<text x="168" y="${ry}" fill="${SLATE}" font-size="7.5" font-family="${FONT}">${desc}</text>`);
  });

  return svgWrap(540, 110, parts.join(''));
}

// Diagrama extra Sección 9: Modos de exportación (Hoja completa / Fondo blanco sólido / Fondo transparente)
export function svgExportacionModos(): string {
  const parts: string[] = [];
  parts.push(`<rect x="2" y="2" width="536" height="96" rx="8" fill="${BG_PANEL}" stroke="${BORDER}" stroke-width="1.1"/>`);

  const modes = [
    { title: 'Diseño de pizarra', desc: 'Conserva fondo, marco y patrón', bg: '#eef2ff', border: '#6d28d9', hasGrid: true, hasFrame: true },
    { title: 'Fondo blanco sólido', desc: 'Marco y patrón legibles en blanco', bg: '#ffffff', border: '#475569', hasGrid: true, hasFrame: true },
    { title: 'Fondo transparente', desc: 'Solo trazos y objetos (sin marco)', bg: '#ffffff', border: BORDER, hasGrid: false, hasFrame: false },
  ];

  modes.forEach((m, i) => {
    const mx = 14 + i * 174;
    parts.push(`<rect x="${mx}" y="10" width="164" height="76" rx="5" fill="#ffffff" stroke="${BORDER}" stroke-width="1"/>`);
    parts.push(`<text x="${mx + 82}" y="22" fill="${PURPLE}" font-size="7.6" font-weight="bold" font-family="${FONT}" text-anchor="middle">${m.title}</text>`);
    parts.push(`<rect x="${mx + 22}" y="27" width="120" height="40" rx="2" fill="${m.bg}" stroke="${SLATE}" stroke-width="0.8"/>`);

    if (!m.hasGrid && !m.hasFrame) {
      // Patrón ajedrezado sutil para indicar transparencia
      for (let ax = mx + 26; ax < mx + 138; ax += 12) {
        parts.push(`<rect x="${ax}" y="31" width="6" height="6" fill="#e2e8f0"/>`);
        parts.push(`<rect x="${ax + 6}" y="37" width="6" height="6" fill="#e2e8f0"/>`);
      }
    }
    if (m.hasFrame) {
      parts.push(`<rect x="${mx + 30}" y="32" width="104" height="30" fill="none" stroke="${m.border}" stroke-width="1.2"/>`);
    }
    if (m.hasGrid) {
      for (let gx = mx + 47; gx < mx + 130; gx += 17) {
        parts.push(`<line x1="${gx}" y1="32" x2="${gx}" y2="62" stroke="#cbd5e1" stroke-width="0.6"/>`);
      }
      for (let gy = 42; gy <= 52; gy += 10) {
        parts.push(`<line x1="${mx + 30}" y1="${gy}" x2="${mx + 134}" y2="${gy}" stroke="#cbd5e1" stroke-width="0.6"/>`);
      }
    }
    // Objeto de usuario común a los 3 modos
    parts.push(`<rect x="${mx + 44}" y="38" width="32" height="18" rx="2" fill="${PURPLE_SOFT}" stroke="${PURPLE}" stroke-width="1.2"/>`);
    parts.push(`<circle cx="${mx + 104}" cy="47" r="9" fill="none" stroke="#2563eb" stroke-width="1.2"/>`);
    parts.push(`<text x="${mx + 82}" y="79" fill="${SLATE}" font-size="6.9" font-family="${FONT}" text-anchor="middle">${m.desc}</text>`);
  });

  return svgWrap(540, 100, parts.join(''));
}

export type ManualIllustrationId =
  | 'mapa-interfaz'
  | 'barra-lateral'
  | 'tamanos-hoja'
  | 'borrador-cortar'
  | 'figuras-2d-3d'
  | 'coordenadas'
  | 'ort-comparacion'
  | 'snap-sp-din'
  | 'osnap-rg'
  | 'acotacion'
  | 'apariencia'
  | 'novedades-1-11-1'
  | 'ejemplo-cuadrado-5u'
  | 'exportacion-modos';

export const MANUAL_ILLUSTRATION_BUILDERS: Record<ManualIllustrationId, () => string> = {
  'mapa-interfaz': svgMapaInterfaz,
  'barra-lateral': svgBarraLateral,
  'tamanos-hoja': svgTamanosHoja,
  'borrador-cortar': svgBorradorYCortar,
  'figuras-2d-3d': svgFiguras2d3d,
  'coordenadas': svgCoordenadas,
  'ort-comparacion': svgOrtComparacion,
  'snap-sp-din': svgSnapSpDin,
  'osnap-rg': svgOsnapRg,
  'acotacion': svgAcotacion,
  'apariencia': svgApariencia,
  'novedades-1-11-1': svgNovedades1111,
  'ejemplo-cuadrado-5u': svgEjemploCuadrado5u,
  'exportacion-modos': svgExportacionModos,
};
