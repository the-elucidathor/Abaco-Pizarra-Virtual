import type {
  BackgroundPattern,
  Board,
  BoardSizePreset,
  EquationObject,
  GraphObject,
  LineObject,
  PageOrientation,
  ShapeObject,
  StickyObject,
  TextObject,
  ToolOptions,
  WhiteboardProject,
} from '../types/whiteboard';
import {
  DEFAULT_FRAME_MARGIN_MM,
  computeCenteredViewportForPage,
  resolveBoardDimensions,
} from '../utils/boardSizes';
import { uid } from '../utils/id';
import { APP_VERSION } from '../version';

export interface CreateBoardOptions {
  sizePreset?: BoardSizePreset;
  pageOrientation?: PageOrientation;
  customWidthPx?: number;
  customHeightPx?: number;
  backgroundPattern?: BackgroundPattern;
  viewportWidth?: number;
  viewportHeight?: number;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  penColor: '#0f172a',
  penWidth: 3,
  penOpacity: 1,
  penStyle: 'solid',
  penHighlighter: false,
  eraserRadius: 18,
  shapeKind: 'rectangle',
  lineKind: 'arrow',
  shapeStrokeColor: '#1e293b',
  shapeFillColor: 'transparent',
  shapeStrokeWidth: 2,
  shapeStrokeStyle: 'solid',
  polygonSides: 6,
  stickyColor: '#fef08a',
  textColor: '#0f172a',
  textFontSize: 18,
};

export function createEmptyBoard(
  name = 'Tablero 1',
  gridSize = 28,
  options: CreateBoardOptions = {}
): Board {
  const layerId = uid('layer');
  const resolved = resolveBoardDimensions(
    options.sizePreset ?? 'infinite',
    options.pageOrientation ?? 'portrait',
    options.customWidthPx,
    options.customHeightPx
  );
  const viewport =
    resolved.pageWidth && resolved.pageHeight
      ? computeCenteredViewportForPage(
          resolved.pageWidth,
          resolved.pageHeight,
          options.viewportWidth ?? 1000,
          options.viewportHeight ?? 700
        )
      : {
          panX: Math.round((options.viewportWidth ?? 1000) * 0.44),
          panY: Math.round((options.viewportHeight ?? 700) * 0.58),
          zoom: 1,
        };

  return {
    id: uid('board'),
    name,
    backgroundPattern: options.backgroundPattern ?? 'grid',
    gridSize,
    showCoordinates: false,
    snapToGrid: false,
    sizePreset: resolved.sizePreset,
    pageWidth: resolved.pageWidth,
    pageHeight: resolved.pageHeight,
    pageOrientation: resolved.pageOrientation,
    ...(resolved.sizePreset !== 'infinite'
      ? {
          showFrame: true,
          frameMarginMm: DEFAULT_FRAME_MARGIN_MM,
          clipToFrame: true,
        }
      : {}),
    viewport,
    layers: [{ id: layerId, name: 'Capa Principal', visible: true, locked: false }],
    activeLayerId: layerId,
    objects: [],
  };
}

export function createNewProject(
  name = 'Nuevo Proyecto',
  folderId = 'general',
  boardName = 'Tablero 1',
  gridSize = 28,
  boardOptions: CreateBoardOptions = {}
): WhiteboardProject {
  const board = createEmptyBoard(boardName, gridSize, boardOptions);
  const now = Date.now();
  return {
    id: uid('proj'),
    name,
    folderId,
    appVersion: APP_VERSION,
    createdAt: now,
    updatedAt: now,
    activeBoardId: board.id,
    boards: [board],
  };
}

export function createStarterProject(): WhiteboardProject {
  const layerMain = uid('layer');
  const layerAnnotations = uid('layer');
  const board1Id = uid('board');
  const board2 = createEmptyBoard('Ejercicios de Álgebra');

  const titleObj: TextObject = {
    id: uid('txt'),
    type: 'text',
    layerId: layerMain,
    x: 40,
    y: 28,
    width: 560,
    height: 64,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    content: 'Análisis de Funciones e Intersecciones',
    fontFamily: 'sans',
    fontSize: 26,
    bold: true,
    italic: false,
    underline: false,
    align: 'left',
    color: '#0f172a',
    backgroundColor: 'transparent',
    listStyle: 'none',
  };

  const eq1: EquationObject = {
    id: uid('eq'),
    type: 'equation',
    layerId: layerMain,
    x: 40,
    y: 112,
    width: 390,
    height: 86,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 2,
    latex: 'f(x) = \\sin(x) \\quad \\wedge \\quad g(x) = \\frac{1}{3}x',
    fontSize: 22,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  };

  const eq2: EquationObject = {
    id: uid('eq'),
    type: 'equation',
    layerId: layerMain,
    x: 40,
    y: 218,
    width: 390,
    height: 98,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 3,
    latex: '\\int_{0}^{\\pi} \\sin(x)\\,dx = \\Big[-\\cos(x)\\Big]_{0}^{\\pi} = 2',
    fontSize: 20,
    color: '#1d4ed8',
    backgroundColor: '#eff6ff',
  };

  const graph1: GraphObject = {
    id: uid('graph'),
    type: 'graph',
    layerId: layerMain,
    x: 465,
    y: 105,
    width: 500,
    height: 370,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 4,
    xMin: -6,
    xMax: 6,
    yMin: -3,
    yMax: 3,
    showGrid: true,
    showAxes: true,
    showIntersections: true,
    xStep: 1,
    yStep: 1,
    backgroundColor: '#ffffff',
    functions: [
      {
        id: uid('fn'),
        expression: 'sin(x)',
        color: '#2563eb',
        strokeStyle: 'solid',
        strokeWidth: 2.5,
        visible: true,
      },
      {
        id: uid('fn'),
        expression: 'x / 3',
        color: '#dc2626',
        strokeStyle: 'dashed',
        strokeWidth: 2,
        visible: true,
      },
    ],
    points: [
      { id: uid('pt'), label: 'Máx', x: 1.57, y: 1, color: '#059669' },
    ],
    vectors: [
      { id: uid('vec'), label: 'v', x1: 0, y1: 0, x2: 2, y2: 1.5, color: '#7c3aed' },
    ],
  };

  const rectObj: ShapeObject = {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'rectangle',
    layerId: layerMain,
    x: 40,
    y: 345,
    width: 175,
    height: 95,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 5,
    strokeColor: '#0284c7',
    fillColor: '#e0f2fe',
    strokeWidth: 2,
    strokeStyle: 'solid',
    cornerRadius: 8,
  };

  const triObj: ShapeObject = {
    id: uid('shp'),
    type: 'shape',
    shapeKind: 'triangle',
    layerId: layerMain,
    x: 270,
    y: 345,
    width: 145,
    height: 95,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 6,
    strokeColor: '#0f766e',
    fillColor: '#ccfbf1',
    strokeWidth: 2,
    strokeStyle: 'solid',
  };

  const arrowObj: LineObject = {
    id: uid('line'),
    type: 'line',
    lineKind: 'arrow',
    layerId: layerMain,
    x: 215,
    y: 382,
    width: 55,
    height: 20,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 7,
    startPoint: { x: 0, y: 10 },
    endPoint: { x: 52, y: 10 },
    strokeColor: '#334155',
    strokeWidth: 2.2,
    strokeStyle: 'solid',
  };

  const stickyObj: StickyObject = {
    id: uid('stk'),
    type: 'sticky',
    layerId: layerAnnotations,
    x: 720,
    y: 20,
    width: 245,
    height: 75,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 8,
    content: 'Doble clic en ecuaciones, textos o gráficas para editarlos. Arrastra archivos PDF, DOCX, XLSX o imágenes al lienzo.',
    backgroundColor: '#fef08a',
    textColor: '#1e293b',
    fontSize: 12,
  };

  const board1: Board = {
    id: board1Id,
    name: 'Cálculo y Geometría',
    backgroundPattern: 'grid',
    gridSize: 28,
    showCoordinates: false,
    snapToGrid: false,
    viewport: { panX: 60, panY: 40, zoom: 1 },
    layers: [
      { id: layerMain, name: 'Contenido Principal', visible: true, locked: false },
      { id: layerAnnotations, name: 'Anotaciones', visible: true, locked: false },
    ],
    activeLayerId: layerMain,
    objects: [titleObj, eq1, eq2, graph1, rectObj, triObj, arrowObj, stickyObj],
  };

  const now = Date.now();
  return {
    id: uid('proj'),
    name: 'Clase de Matemáticas — Demo Local',
    folderId: 'clases',
    appVersion: APP_VERSION,
    createdAt: now,
    updatedAt: now,
    activeBoardId: board1.id,
    boards: [board1, board2],
  };
}
