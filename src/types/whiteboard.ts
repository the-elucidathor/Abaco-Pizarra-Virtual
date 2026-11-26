export type ToolId =
  | 'select'
  | 'hand'
  | 'pen'
  | 'eraser'
  | 'text'
  | 'sticky'
  | 'shape'
  | 'line'
  | 'equation'
  | 'graph'
  | 'cut';

export type ShapeKind =
  | 'rectangle'
  | 'square'
  | 'triangle'
  | 'right-triangle'
  | 'right-trapezoid'
  | 'trapezoid'
  | 'parallelogram'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'polygon'
  | 'star'
  | 'circle'
  | 'ellipse'
  | 'rounded-rect'
  | 'semicircle'
  | 'sector'
  | 'arc'
  | 'curve'
  | 'polyline'
  | 'cube'
  | 'cube-wire'
  | 'cylinder'
  | 'oblique-prism'
  | 'square-pyramid'
  | 'cone'
  | 'sphere'
  | 'tetrahedron'
  | 'triangular-prism'
  | 'hex-pyramid'
  | 'hex-prism'
  | 'octahedron'
  | 'frustum-pyramid'
  | 'frustum-cone'
  | 'custom-polygon';

export type LineKind =
  | 'line'
  | 'segment'
  | 'dashed-line'
  | 'arrow'
  | 'double-arrow'
  | 'vector'
  | 'connector'
  | 'orthogonal';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export type BackgroundPattern =
  | 'blank'
  | 'grid'
  | 'lined'
  | 'dotted'
  | 'isometric';

export type ThemePreset =
  | 'light'
  | 'dark'
  | 'warm'
  | 'cool'
  | 'nature'
  | 'blueprint'
  | 'sepia'
  | 'neon'
  | 'aurora';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface Point2D {
  x: number;
  y: number;
  pressure?: number;
}

export interface GroupRecord {
  id: string;
  name: string;
  parentGroupId?: string;
  createdAt: number;
}

export interface BaseCanvasObject {
  id: string;
  type:
    | 'stroke'
    | 'shape'
    | 'line'
    | 'text'
    | 'sticky'
    | 'equation'
    | 'graph'
    | 'image'
    | 'document'
    | 'dimension'
    | 'table';
  layerId: string;
  groupId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  opacity: number; // 0..1
  locked: boolean;
  zIndex: number;
}

export interface StrokeObject extends BaseCanvasObject {
  type: 'stroke';
  points: Point2D[]; // relative to (x, y)
  color: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  isHighlighter?: boolean;
}

export interface ShapeObject extends BaseCanvasObject {
  type: 'shape';
  shapeKind: ShapeKind;
  strokeColor: string;
  fillColor: string; // 'transparent' or hex
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  cornerRadius?: number;
  polygonSides?: number; // for polygon
  arcStartAngle?: number; // degrees
  arcEndAngle?: number; // degrees
  customPoints?: Point2D[]; // normalized or local points for polyline / curve
  customVertices?: Point2D[]; // editable polygon vertices local to (x, y)
  flipX?: boolean;
  flipY?: boolean;
}

export interface LineObject extends BaseCanvasObject {
  type: 'line';
  lineKind: LineKind;
  startPoint: Point2D; // relative to (x, y)
  endPoint: Point2D; // relative to (x, y)
  controlPoint?: Point2D; // for curved connector
  strokeColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  startNodeId?: string;
  endNodeId?: string;
}

export type TextFontFamily =
  | 'sans'
  | 'serif'
  | 'mono'
  | 'times'
  | 'arial'
  | 'comic-sans'
  | 'tahoma'
  | 'acme'
  | 'alatsi';

// Alineación horizontal de párrafos de texto (incluye justificado)
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

// Estilo en línea aplicable a un tramo (run) individual de texto
export interface TextRunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  color?: string;
  fontFamily?: TextFontFamily;
}

export interface TextRunMath {
  latex: string;
  displayMode?: boolean;
}

// Tramo contiguo de texto con formato homogéneo (o expresión matemática embebida)
export interface TextRun extends TextRunStyle {
  text: string;
  math?: TextRunMath;
}

// Párrafo de texto enriquecido con alineación propia y lista de tramos
export interface RichTextParagraph {
  align?: TextAlign;
  runs: TextRun[];
}

// Idiomas soportados por el corrector ortográfico personalizado
export type SpellcheckLanguage = 'es' | 'es-MX' | 'en-US';

// Modo de ancho del cuadro de texto ('auto': crece hasta límite razonable; 'fixed': ancho fijo)
export type TextWidthMode = 'auto' | 'fixed';

export interface TextObject extends BaseCanvasObject {
  type: 'text';
  content: string;
  fontFamily: TextFontFamily;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  color: string;
  backgroundColor: string;
  listStyle: 'none' | 'bullet' | 'numbered';
  // Estructura de texto enriquecido por párrafos y tramos (opcional para compatibilidad retroactiva)
  paragraphs?: RichTextParagraph[];
  // Si es true, el ancho se ajusta al contenido y el justificado no surte efecto visible hasta fijar ancho
  autoWidth?: boolean;
  // Modo explícito de ancho introducido en etapa 2 ('auto' | 'fixed')
  widthMode?: TextWidthMode;
  // Idioma asignado al cuadro de texto para el corrector ortográfico ('es' | 'es-MX' | 'en-US')
  lang?: SpellcheckLanguage;
}

export interface StickyObject extends BaseCanvasObject {
  type: 'sticky';
  content: string;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
}

export interface EquationObject extends BaseCanvasObject {
  type: 'equation';
  latex: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
}

export interface GraphFunctionItem {
  id: string;
  expression: string; // e.g. "sin(x)", "x^2 - 2"
  color: string;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  visible: boolean;
}

export interface GraphPointItem {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

export interface GraphVectorItem {
  id: string;
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface GraphObject extends BaseCanvasObject {
  type: 'graph';
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  showGrid: boolean;
  showAxes: boolean;
  showIntersections: boolean;
  xStep: number;
  yStep: number;
  functions: GraphFunctionItem[];
  points: GraphPointItem[];
  vectors: GraphVectorItem[];
  backgroundColor: string;
}

export interface ImageObject extends BaseCanvasObject {
  type: 'image';
  src: string; // Data URL or SVG string data URL
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  isReferenceBackground?: boolean;
}

export interface DocumentObject extends BaseCanvasObject {
  type: 'document';
  docKind: 'pdf' | 'docx' | 'xlsx' | 'txt';
  fileName: string;
  pdfDataUrl?: string;
  currentPage?: number;
  totalPages?: number;
  renderedPageDataUrl?: string;
  htmlContent?: string;
  sheets?: { name: string; rows: string[][] }[];
  activeSheetIndex?: number;
  textContent?: string;
  isReferenceBackground?: boolean;
}

export type DimensionKind =
  | 'linear'
  | 'aligned'
  | 'angular'
  | 'radial'
  | 'diametral'
  | 'ordinate';

export interface DimensionAnchor {
  objectId: string;
  localPoint: Point2D;
  role?: 'center' | 'rim' | 'point';
  rimAngleDeg?: number;
}

export interface DimensionObject extends BaseCanvasObject {
  type: 'dimension';
  dimKind: DimensionKind;
  p1: Point2D;
  p2: Point2D;
  p3?: Point2D;
  offsetPt: Point2D;
  linearAxis?: 'auto' | 'horizontal' | 'vertical';
  ordinateAxis?: 'x' | 'y';
  anchor1?: DimensionAnchor;
  anchor2?: DimensionAnchor;
  anchor3?: DimensionAnchor;
  strokeColor: string;
  textColor: string;
  fontSize: number;
  textOverride?: string;
}

// Celda individual dentro de un objeto de tabla con soporte de texto enriquecido
export interface TableCellData {
  id: string;
  content: string;
  paragraphs: RichTextParagraph[];
  align?: TextAlign;
}

// Tabla editable posicionada en coordenadas del mundo sobre el lienzo
export interface TableObject extends BaseCanvasObject {
  type: 'table';
  rows: number;
  cols: number;
  colWidths: number[];
  rowHeights: number[];
  cells: TableCellData[][];
  hasHeaderRow: boolean;
  fontSize: number;
  fontFamily: TextFontFamily;
  color?: string;
  borderColor?: string;
  headerFillColor?: string;
  lang?: SpellcheckLanguage;
}

export type CanvasObject =
  | StrokeObject
  | ShapeObject
  | LineObject
  | TextObject
  | StickyObject
  | EquationObject
  | GraphObject
  | ImageObject
  | DocumentObject
  | DimensionObject
  | TableObject;

export type BoardSizePreset =
  | 'infinite'
  | 'letter'
  | 'legal'
  | 'tabloid'
  | 'half-letter'
  | 'custom';

export type PageOrientation = 'portrait' | 'landscape';

export interface BoardViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface BoardSheet {
  id: string;
  /** Posición vertical superior (Y en px del mundo) respecto a la hoja 1 (y=0) */
  yOffset?: number;
}

export interface Board {
  id: string;
  name: string;
  backgroundPattern: BackgroundPattern;
  gridSize: number;
  showCoordinates: boolean;
  snapToGrid: boolean;
  sizePreset?: BoardSizePreset;
  pageWidth?: number;
  pageHeight?: number;
  pageOrientation?: PageOrientation;
  // Lista ordenada de hojas para pizarrones de tamaño fijo (compatibilidad retroactiva: ausente = 1 hoja)
  sheets?: BoardSheet[];
  // Muestra el borde interior y el margen tipo hoja impresa en pizarras de tamaño fijo (por defecto true)
  showFrame?: boolean;
  // Margen exterior configurable en milímetros (0..25 mm, por defecto 10 mm)
  frameMarginMm?: number;
  // Recorta visualmente los elementos fuera del área útil del marco sin eliminarlos (por defecto true)
  clipToFrame?: boolean;
  viewport: BoardViewport;
  layers: Layer[];
  activeLayerId: string;
  groups?: GroupRecord[];
  objects: CanvasObject[];
}

export interface WhiteboardProject {
  id: string;
  name: string;
  folderId: string;
  appVersion?: string;
  createdAt: number;
  updatedAt: number;
  activeBoardId: string;
  boards: Board[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  folderId: string;
  boardCount: number;
  updatedAt: number;
  createdAt: number;
  sizeBytes?: number;
}

export interface FolderRecord {
  id: string;
  name: string;
  createdAt: number;
}

export interface ProjectSnapshotMeta {
  snapshotId: string;
  savedAt: number;
  boardCount: number;
  name: string;
}

// Modos disponibles para el color de fondo independiente del lienzo
export type CanvasBackgroundColorMode =
  | 'auto'
  | 'white'
  | 'graphite'
  | 'chalkboard'
  | 'cream'
  | 'custom';

export interface AppSettings {
  theme: ThemePreset;
  // Modo seleccionado para el color de fondo del lienzo ('auto' sigue el tema de interfaz)
  canvasBgMode: CanvasBackgroundColorMode;
  // Color hexadecimal personalizado cuando canvasBgMode es 'custom'
  canvasBgCustomColor: string;
  // Si está activo, adapta dinámicamente los colores de trazos con bajo contraste frente al lienzo
  adaptStrokeColorsToCanvasBg: boolean;
  autoSaveEnabled: boolean;
  autoSaveIntervalSec: number;
  pressureSensitivity: boolean;
  defaultGridSize: number;
  cursorSize: number;
  cursorColor: string;
  // Habilita o deshabilita el corrector ortográfico personalizado en cuadros de texto
  spellcheckEnabled: boolean;
  // Idioma predeterminado para el corrector ortográfico ('es' | 'es-MX' | 'en-US')
  spellcheckDefaultLang: SpellcheckLanguage;
  // En pizarrones de tamaño fijo, la rueda desplaza hojas (Ctrl+rueda hace zoom)
  wheelScrollSheets: boolean;
}

export interface ToolOptions {
  penColor: string;
  penWidth: number;
  penOpacity: number;
  penStyle: StrokeStyle;
  penHighlighter: boolean;
  eraserRadius: number;
  shapeKind: ShapeKind;
  lineKind: LineKind;
  shapeStrokeColor: string;
  shapeFillColor: string;
  shapeStrokeWidth: number;
  shapeStrokeStyle: StrokeStyle;
  polygonSides: number;
  stickyColor: string;
  textColor: string;
  textFontSize: number;
}
