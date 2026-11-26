import type { ShapeKind } from '../../types/whiteboard';

export type CadCatalogCategory =
  | 'Dibujo'
  | 'Acotación'
  | 'Edición'
  | 'Matrices'
  | 'Agrupación'
  | 'Ayudas'
  | 'Tablero';

export type QuickCatalogExecution =
  | { kind: 'cad'; commandText: string }
  | {
      kind: 'board-action';
      actionId:
        | 'select'
        | 'hand'
        | 'pen'
        | 'eraser'
        | 'cut'
        | 'text'
        | 'sticky'
        | 'equation'
        | 'graph'
        | 'import-file'
        | 'export'
        | 'settings';
    }
  | { kind: 'shape-tool'; shapeKind: ShapeKind };

export interface CadCatalogItem {
  id: string;
  code: string;
  label: string;
  description: string;
  category: CadCatalogCategory;
  aliases: string[];
  keywords: string[];
  execution: QuickCatalogExecution;
}

export const CAD_COMMAND_CATALOG: CadCatalogItem[] = [
  // Dibujo técnico
  {
    id: 'cmd-line',
    code: 'LIN',
    label: 'Línea',
    description: 'Dibujar segmentos rectos por coordenadas o clics',
    category: 'Dibujo',
    aliases: ['L', 'LINEA', 'LINE'],
    keywords: ['segmento', 'recta', 'trazar'],
    execution: { kind: 'cad', commandText: 'LIN' },
  },
  {
    id: 'cmd-pline',
    code: 'PL',
    label: 'Polilínea',
    description: 'Secuencia continua de segmentos conectados',
    category: 'Dibujo',
    aliases: ['POLILINEA', 'POLI'],
    keywords: ['camino', 'continuo', 'cerrar'],
    execution: { kind: 'cad', commandText: 'PL' },
  },
  {
    id: 'cmd-rect',
    code: 'REC',
    label: 'Rectángulo',
    description: 'Construir rectángulo por esquinas o dimensiones',
    category: 'Dibujo',
    aliases: ['RECT', 'RECTANG', 'RECTANGULO'],
    keywords: ['cuadro', 'caja'],
    execution: { kind: 'cad', commandText: 'REC' },
  },
  {
    id: 'cmd-circle',
    code: 'CIR',
    label: 'Círculo',
    description: 'Círculo por centro y radio o diámetro',
    category: 'Dibujo',
    aliases: ['CIRC', 'CIRCULO'],
    keywords: ['radio', 'diametro', 'redondo'],
    execution: { kind: 'cad', commandText: 'CIR' },
  },
  {
    id: 'cmd-arc',
    code: 'ARC',
    label: 'Arco',
    description: 'Arco por 3 puntos o centro, inicio y ángulo',
    category: 'Dibujo',
    aliases: ['A', 'ARCO'],
    keywords: ['curva', 'sector'],
    execution: { kind: 'cad', commandText: 'ARC' },
  },
  {
    id: 'cmd-polygon',
    code: 'POL',
    label: 'Polígono',
    description: 'Polígono regular inscrito o circunscrito',
    category: 'Dibujo',
    aliases: ['POLIGONO'],
    keywords: ['lados', 'pentagono', 'hexagono'],
    execution: { kind: 'cad', commandText: 'POL' },
  },

  // Acotación
  {
    id: 'cmd-dim-linear',
    code: 'ACL',
    label: 'Cota lineal',
    description: 'Acotar distancia horizontal o vertical',
    category: 'Acotación',
    aliases: ['COTLINEAL', 'ACOTACIONLINEAL'],
    keywords: ['cota', 'acotar', 'medida', 'horizontal', 'vertical'],
    execution: { kind: 'cad', commandText: 'ACL' },
  },
  {
    id: 'cmd-dim-aligned',
    code: 'ACA',
    label: 'Cota alineada',
    description: 'Acotar distancia real paralela entre dos puntos',
    category: 'Acotación',
    aliases: ['COTALINEADA', 'ACOTACIONALINEADA', 'MEDIR'],
    keywords: ['cota', 'acotar', 'medicion', 'distancia'],
    execution: { kind: 'cad', commandText: 'ACA' },
  },
  {
    id: 'cmd-dim-angular',
    code: 'ANG',
    label: 'Cota angular',
    description: 'Medir el ángulo entre tres puntos o vértice',
    category: 'Acotación',
    aliases: ['COTANGULAR', 'ANGULAR'],
    keywords: ['cota', 'angulo', 'grados'],
    execution: { kind: 'cad', commandText: 'ANG' },
  },
  {
    id: 'cmd-dim-radial',
    code: 'RAD',
    label: 'Cota radial',
    description: 'Acotar el radio de un círculo o arco',
    category: 'Acotación',
    aliases: ['COTRADIAL', 'RADIAL'],
    keywords: ['cota', 'radio', 'circulo'],
    execution: { kind: 'cad', commandText: 'RAD' },
  },
  {
    id: 'cmd-dim-diametral',
    code: 'DIA',
    label: 'Cota diametral',
    description: 'Acotar el diámetro de un círculo o arco',
    category: 'Acotación',
    aliases: ['COTDIAMETRAL', 'DIAMETRAL'],
    keywords: ['cota', 'diametro', 'circulo'],
    execution: { kind: 'cad', commandText: 'DIA' },
  },
  {
    id: 'cmd-dim-ordinate',
    code: 'COR',
    label: 'Cota por coordenadas',
    description: 'Etiquetar coordenada X o Y respecto al origen',
    category: 'Acotación',
    aliases: ['COORDENADAS', 'ACOTACIONCOORD'],
    keywords: ['cota', 'coordenada', 'origen'],
    execution: { kind: 'cad', commandText: 'COR' },
  },

  // Edición geométrica
  {
    id: 'cmd-mirror',
    code: 'SIM',
    label: 'Simetría',
    description: 'Reflejar objetos seleccionados respecto a un eje',
    category: 'Edición',
    aliases: ['SIMETRIA', 'ESPEJO'],
    keywords: ['reflejar', 'invertir', 'espejo'],
    execution: { kind: 'cad', commandText: 'SIM' },
  },
  {
    id: 'cmd-match-points',
    code: 'CP',
    label: 'Hacer coincidir puntos',
    description: 'Unir exactamente un punto de referencia con otro',
    category: 'Edición',
    aliases: ['COINCIDIR', 'COINCIDENCIA', 'COINCIDIRPUNTOS'],
    keywords: ['empalmar', 'ajustar', 'extremo', 'snap'],
    execution: { kind: 'cad', commandText: 'CP' },
  },
  {
    id: 'cmd-join',
    code: 'UNI',
    label: 'Unir segmentos',
    description: 'Conectar segmentos contiguos en una polilínea',
    category: 'Edición',
    aliases: ['UNIR'],
    keywords: ['conectar', 'polilinea', 'combinar'],
    execution: { kind: 'cad', commandText: 'UNI' },
  },

  // Matrices
  {
    id: 'cmd-array-rect',
    code: 'MR',
    label: 'Matriz rectangular',
    description: 'Repetir la selección en filas y columnas',
    category: 'Matrices',
    aliases: ['MATRIZRECT', 'MATRIZRECTANGULAR'],
    keywords: ['matriz', 'filas', 'columnas', 'patron'],
    execution: { kind: 'cad', commandText: 'MR' },
  },
  {
    id: 'cmd-array-polar',
    code: 'MP',
    label: 'Matriz polar',
    description: 'Distribuir copias alrededor de un centro',
    category: 'Matrices',
    aliases: ['MATRIZPOLAR'],
    keywords: ['matriz', 'circular', 'centro', 'radial'],
    execution: { kind: 'cad', commandText: 'MP' },
  },
  {
    id: 'cmd-array-path',
    code: 'MC',
    label: 'Matriz de camino',
    description: 'Distribuir copias siguiendo una línea o trayectoria',
    category: 'Matrices',
    aliases: ['MATRIZCAMINO'],
    keywords: ['matriz', 'camino', 'ruta', 'trayectoria'],
    execution: { kind: 'cad', commandText: 'MC' },
  },

  // Agrupación
  {
    id: 'cmd-group',
    code: 'AGR',
    label: 'Agrupar',
    description: 'Agrupar los elementos seleccionados como unidad',
    category: 'Agrupación',
    aliases: ['AGRUPAR', 'GRUPO'],
    keywords: ['grupo', 'unir', 'conjunto'],
    execution: { kind: 'cad', commandText: 'AGR' },
  },
  {
    id: 'cmd-ungroup',
    code: 'DES',
    label: 'Desagrupar',
    description: 'Separar los elementos de un grupo seleccionado',
    category: 'Agrupación',
    aliases: ['DESAGRUPAR'],
    keywords: ['grupo', 'separar', 'soltar'],
    execution: { kind: 'cad', commandText: 'DES' },
  },

  // Ayudas de precisión y vista
  {
    id: 'aid-ortho',
    code: 'ORT',
    label: 'Modo ortogonal',
    description: 'Restringir trazos a ángulos de 0° y 90°',
    category: 'Ayudas',
    aliases: ['ORTO', 'ORTOGONAL'],
    keywords: ['recto', 'perpendicular', 'f8'],
    execution: { kind: 'cad', commandText: 'ORT' },
  },
  {
    id: 'aid-polar',
    code: 'SP',
    label: 'Seguimiento polar',
    description: 'Guías angulares incrementales de precisión',
    category: 'Ayudas',
    aliases: ['POLAR', 'SEGUIMIENTOPOLAR'],
    keywords: ['angulos', 'guias', 'f10'],
    execution: { kind: 'cad', commandText: 'SP' },
  },
  {
    id: 'aid-grid',
    code: 'GRID',
    label: 'Cuadrícula',
    description: 'Mostrar u ocultar la cuadrícula del tablero',
    category: 'Ayudas',
    aliases: ['REJILLA', 'CUADRICULA'],
    keywords: ['fondo', 'patron', 'f7'],
    execution: { kind: 'cad', commandText: 'GRID' },
  },
  {
    id: 'aid-snap',
    code: 'SNAP',
    label: 'Ajuste a cuadrícula',
    description: 'Activar o desactivar imantado a la cuadrícula',
    category: 'Ayudas',
    aliases: ['AJUSTE'],
    keywords: ['iman', 'cuadricula', 'f9'],
    execution: { kind: 'cad', commandText: 'SNAP' },
  },
  {
    id: 'aid-rg',
    code: 'RG',
    label: 'Referencias geométricas',
    description: 'Activar o desactivar imantado a extremos, medios y centros',
    category: 'Ayudas',
    aliases: ['REFERENCIAS'],
    keywords: ['extremos', 'intersecciones', 'medios', 'f3'],
    execution: { kind: 'cad', commandText: 'RG' },
  },
  {
    id: 'aid-dyn',
    code: 'DIN',
    label: 'Entrada dinámica',
    description: 'Mostrar u ocultar indicadores flotantes junto al cursor',
    category: 'Ayudas',
    aliases: ['DINAMICO'],
    keywords: ['hud', 'cursor', 'coordenadas', 'f12'],
    execution: { kind: 'cad', commandText: 'DIN' },
  },
  {
    id: 'aid-origin',
    code: 'ORIGEN',
    label: 'Definir origen (0,0)',
    description: 'Ubicar el origen del sistema de coordenadas',
    category: 'Ayudas',
    aliases: ['ORIGIN'],
    keywords: ['cero', 'ejes', 'referencia'],
    execution: { kind: 'cad', commandText: 'ORIGEN' },
  },

  // Herramientas generales del tablero
  {
    id: 'tool-select',
    code: 'SEL',
    label: 'Selección',
    description: 'Cambiar a la herramienta de selección (V)',
    category: 'Tablero',
    aliases: ['SELECCION', 'SELECCIONAR'],
    keywords: ['puntero', 'mover'],
    execution: { kind: 'board-action', actionId: 'select' },
  },
  {
    id: 'tool-hand',
    code: 'MANO',
    label: 'Desplazar vista',
    description: 'Mover el lienzo con la herramienta mano (H)',
    category: 'Tablero',
    aliases: ['PAN', 'MOVER'],
    keywords: ['vista', 'navegar'],
    execution: { kind: 'board-action', actionId: 'hand' },
  },
  {
    id: 'tool-pen',
    code: 'LAPIZ',
    label: 'Lápiz / Trazo libre',
    description: 'Dibujar a mano alzada (P)',
    category: 'Tablero',
    aliases: ['PEN', 'TRAZO'],
    keywords: ['dibujo', 'pluma'],
    execution: { kind: 'board-action', actionId: 'pen' },
  },
  {
    id: 'tool-cut',
    code: 'CORTAR',
    label: 'Cortar / Recortar tramos',
    description: 'Dividir figuras o recortar segmentos entre intersecciones (C)',
    category: 'Tablero',
    aliases: ['RECORTAR', 'TIJERA'],
    keywords: ['dividir', 'recorte'],
    execution: { kind: 'board-action', actionId: 'cut' },
  },
  {
    id: 'tool-text',
    code: 'TEXTO',
    label: 'Insertar texto',
    description: 'Agregar cuadro de texto al tablero (T)',
    category: 'Tablero',
    aliases: ['TXT', 'TEXT'],
    keywords: ['escribir', 'etiqueta'],
    execution: { kind: 'board-action', actionId: 'text' },
  },
  {
    id: 'tool-sticky',
    code: 'NOTA',
    label: 'Insertar nota rápida',
    description: 'Crear una nota adhesiva (N)',
    category: 'Tablero',
    aliases: ['STICKY'],
    keywords: ['postit', 'recordatorio'],
    execution: { kind: 'board-action', actionId: 'sticky' },
  },
  {
    id: 'tool-equation',
    code: 'ECU',
    label: 'Insertar ecuación',
    description: 'Crear expresión matemática en vivo (M)',
    category: 'Tablero',
    aliases: ['ECUACION', 'FORMULA'],
    keywords: ['matematica', 'latex'],
    execution: { kind: 'board-action', actionId: 'equation' },
  },
  {
    id: 'tool-graph',
    code: 'GRAF',
    label: 'Insertar gráfica',
    description: 'Abrir editor de gráfica cartesiana (G)',
    category: 'Tablero',
    aliases: ['GRAFICA', 'PLANO'],
    keywords: ['funcion', 'ejes', 'curva'],
    execution: { kind: 'board-action', actionId: 'graph' },
  },
];

function normalizeSearchToken(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function searchCadCommandCatalog(rawQuery: string): CadCatalogItem[] {
  const q = normalizeSearchToken(rawQuery.replace(/^;+/, ''));
  if (!q) {
    return CAD_COMMAND_CATALOG.slice(0, 12);
  }

  const scored: { item: CadCatalogItem; score: number; index: number }[] = [];

  CAD_COMMAND_CATALOG.forEach((item, index) => {
    const codeNorm = normalizeSearchToken(item.code);
    const labelNorm = normalizeSearchToken(item.label);
    const aliasesNorm = item.aliases.map(normalizeSearchToken);
    const keywordsNorm = item.keywords.map(normalizeSearchToken);
    const descNorm = normalizeSearchToken(item.description);

    let score = 0;

    if (codeNorm === q || aliasesNorm.includes(q)) {
      score = 120;
    } else if (codeNorm.startsWith(q)) {
      score = 100;
    } else if (aliasesNorm.some((a) => a.startsWith(q))) {
      score = 90;
    } else if (labelNorm.startsWith(q)) {
      score = 85;
    } else if (labelNorm.split(/\s+/).some((w) => w.startsWith(q))) {
      score = 75;
    } else if (keywordsNorm.some((k) => k.startsWith(q))) {
      score = 65;
    } else if (
      codeNorm.includes(q) ||
      aliasesNorm.some((a) => a.includes(q)) ||
      labelNorm.includes(q) ||
      keywordsNorm.some((k) => k.includes(q))
    ) {
      score = 50;
    } else if (descNorm.includes(q)) {
      score = 35;
    }

    if (score > 0) {
      scored.push({ item, score, index });
    }
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.item.code.length !== b.item.code.length) {
      return a.item.code.length - b.item.code.length;
    }
    return a.index - b.index;
  });

  return scored.map((s) => s.item);
}
