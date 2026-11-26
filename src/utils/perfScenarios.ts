// OPT: Generador reproducible de los 8 escenarios (a)-(h) para pruebas comparativas de rendimiento
import type {
  CanvasObject,
  DocumentObject,
  LineObject,
  Point2D,
  ShapeObject,
  StrokeObject,
  TableObject,
  TextObject,
} from '../types/whiteboard';
import { createParagraphsFromPlainText, getDefaultRunStyle } from './richText';
import { createTableObject, updateTableCellParagraphs } from './tableUtils';

export type PerfScenarioId =
  | 'a_empty'
  | 'b_500_strokes'
  | 'c_2000_strokes'
  | 'd_300_shapes_lines'
  | 'e_20_texts_3_tables'
  | 'f_pdf_20_pages'
  | 'g_zoom_pan'
  | 'h_eraser_500';

// Generador pseudoaleatorio determinista (LCG) para reproducibilidad exacta entre mediciones
function createRng(seed = 1337) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function buildStrokeScenario(count: number, seed = 42): StrokeObject[] {
  const rand = createRng(seed);
  const cols = Math.max(10, Math.ceil(Math.sqrt(count)));
  const out: StrokeObject[] = [];
  for (let i = 0; i < count; i++) {
    const gx = (i % cols) * 260;
    const gy = Math.floor(i / cols) * 200;
    const w = 140 + Math.round(rand() * 120);
    const h = 80 + Math.round(rand() * 90);
    const pts: Point2D[] = [];
    const ptCount = 28;
    for (let k = 0; k < ptCount; k++) {
      const t = k / (ptCount - 1);
      pts.push({
        x: Math.round((t * w + Math.sin(t * Math.PI * 3 + i) * 18) * 10) / 10,
        y: Math.round((h * 0.5 + Math.cos(t * Math.PI * 2 + i) * (h * 0.38)) * 10) / 10,
        pressure: 0.4 + rand() * 0.4,
      });
    }
    out.push({
      id: `bench_stk_${i}`,
      type: 'stroke',
      layerId: 'layer_main',
      x: gx,
      y: gy,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: i + 1,
      points: pts,
      color: i % 3 === 0 ? '#0f172a' : i % 3 === 1 ? '#2563eb' : '#7c3aed',
      strokeWidth: 2.5,
      strokeStyle: 'solid',
    });
  }
  return out;
}

export function buildMixedShapesAndLinesScenario(count = 300): CanvasObject[] {
  const rand = createRng(99);
  const out: CanvasObject[] = [];
  const kinds: ShapeObject['shapeKind'][] = [
    'rectangle',
    'circle',
    'triangle',
    'hexagon',
    'diamond',
  ];
  const cols = 18;
  for (let i = 0; i < count; i++) {
    const gx = (i % cols) * 220;
    const gy = Math.floor(i / cols) * 180;
    if (i % 3 === 0) {
      const w = 150;
      const h = 100;
      const line: LineObject = {
        id: `bench_line_${i}`,
        type: 'line',
        lineKind: i % 6 === 0 ? 'arrow' : 'line',
        layerId: 'layer_main',
        x: gx,
        y: gy,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: i + 1,
        startPoint: { x: 0, y: Math.round(rand() * h) },
        endPoint: { x: w, y: Math.round(rand() * h) },
        strokeColor: '#0f172a',
        strokeWidth: 2,
        strokeStyle: 'solid',
      };
      out.push(line);
    } else {
      const shape: ShapeObject = {
        id: `bench_shp_${i}`,
        type: 'shape',
        shapeKind: kinds[i % kinds.length],
        layerId: 'layer_main',
        x: gx,
        y: gy,
        width: 140 + (i % 4) * 15,
        height: 110 + (i % 3) * 15,
        rotation: 0,
        opacity: 1,
        locked: false,
        zIndex: i + 1,
        strokeColor: '#1e293b',
        fillColor: i % 2 === 0 ? 'transparent' : 'rgba(37, 99, 235, 0.08)',
        strokeWidth: 2,
        strokeStyle: 'solid',
      };
      out.push(shape);
    }
  }
  return out;
}

export function buildRichTextAndTablesScenario(): CanvasObject[] {
  const out: CanvasObject[] = [];
  const defaults = getDefaultRunStyle({
    fontSize: 16,
    color: '#0f172a',
    fontFamily: 'sans',
  });
  for (let i = 0; i < 20; i++) {
    const sample =
      `Bloque técnico #${i + 1}: cálculo de intersecciones, ajuste automático de línea ` +
      `y verificación ortográfica en español e inglés (performance benchmark test).`;
    const paragraphs = createParagraphsFromPlainText(sample, defaults, i % 2 === 0 ? 'left' : 'justify');
    const txt: TextObject = {
      id: `bench_txt_${i}`,
      type: 'text',
      layerId: 'layer_main',
      x: (i % 5) * 340,
      y: Math.floor(i / 5) * 180,
      width: 300,
      height: 110,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex: i + 1,
      content: sample,
      paragraphs,
      fontSize: 16,
      fontFamily: 'sans',
      bold: false,
      italic: false,
      underline: false,
      color: '#0f172a',
      backgroundColor: 'transparent',
      align: i % 2 === 0 ? 'left' : 'justify',
      listStyle: 'none',
      widthMode: i % 3 === 0 ? 'auto' : 'fixed',
      autoWidth: i % 3 === 0,
      lang: 'es',
    };
    out.push(txt);
  }

  for (let t = 0; t < 3; t++) {
    let tbl: TableObject = createTableObject({
      x: t * 760,
      y: 800,
      rows: 10,
      cols: 5,
      layerId: 'layer_main',
      zIndex: 25 + t,
      hasHeaderRow: true,
    });
    for (let r = 0; r < tbl.rows; r++) {
      for (let c = 0; c < tbl.cols; c++) {
        const text = r === 0 ? `Columna ${c + 1}` : `Valor ${r}.${c} técnico`;
        const cellDefs = getDefaultRunStyle({ fontSize: 14, color: '#0f172a', fontFamily: 'sans' });
        tbl = updateTableCellParagraphs(
          tbl,
          r,
          c,
          createParagraphsFromPlainText(text, cellDefs, 'left'),
          cellDefs
        );
      }
    }
    tbl.id = `bench_tbl_${t}`;
    out.push(tbl);
  }
  return out;
}

export function buildPdf20PagesScenario(): CanvasObject[] {
  // Simula un PDF de 20 páginas con payload realista (~180 KB en pdfDataUrl) sin depender de red externa
  const fakePayload = 'A'.repeat(180_000);
  const pdfObj: DocumentObject = {
    id: 'bench_pdf_20',
    type: 'document',
    docKind: 'pdf',
    layerId: 'layer_main',
    x: 100,
    y: 80,
    width: 620,
    height: 820,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    fileName: 'documento-tecnico-20-paginas.pdf',
    totalPages: 20,
    currentPage: 1,
    pdfDataUrl: `data:application/pdf;base64,${fakePayload}`,
    renderedPageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  };
  return [pdfObj];
}

export function buildScenarioObjects(id: PerfScenarioId): CanvasObject[] {
  switch (id) {
    case 'a_empty':
      return [];
    case 'b_500_strokes':
    case 'h_eraser_500':
      return buildStrokeScenario(500, 101);
    case 'c_2000_strokes':
      return buildStrokeScenario(2000, 202);
    case 'd_300_shapes_lines':
      return buildMixedShapesAndLinesScenario(300);
    case 'e_20_texts_3_tables':
      return buildRichTextAndTablesScenario();
    case 'f_pdf_20_pages':
      return buildPdf20PagesScenario();
    case 'g_zoom_pan':
      return buildStrokeScenario(1200, 303);
  }
}
