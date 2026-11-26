import type { SpellcheckLanguage } from '../../types/whiteboard';

// Listas de respaldo ligeras ordenadas por frecuencia aproximada para uso offline si falla la descarga Hunspell
// Se incluyen palabras cotidianas, académicas, matemáticas y geométricas en español e inglés (EE. UU.)
const SPANISH_WORDS_BY_FREQ = [
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para',
  'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o',
  'este', 'sí', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me',
  'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'todos', 'uno', 'les',
  'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos', 'e', 'esto', 'mí', 'antes',
  'algunos', 'qué', 'unos', 'yo', 'otro', 'otras', 'otra', 'él', 'tanto', 'esa', 'estos',
  'mucho', 'quienes', 'nada', 'muchos', 'cual', 'poco', 'ella', 'estar', 'estas', 'algunas',
  'algo', 'nosotros', 'mi', 'mis', 'tú', 'te', 'ti', 'tu', 'tus', 'ellas', 'nosotras',
  'vosotros', 'mío', 'tuyo', 'suyo', 'nuestro', 'vuestro', 'es', 'son', 'fue', 'era', 'ser',
  'está', 'están', 'tiene', 'tienen', 'hacer', 'hace', 'puede', 'pueden', 'cada', 'bien',
  'texto', 'cuadro', 'escribe', 'escribir', 'aquí', 'nota', 'nueva', 'nuevo', 'pizarra',
  'tablero', 'proyecto', 'dibujo', 'línea', 'líneas', 'punto', 'puntos', 'recta', 'segmento',
  'ángulo', 'ángulos', 'triángulo', 'triángulos', 'cuadrado', 'cuadrados', 'rectángulo',
  'rectángulos', 'círculo', 'círculos', 'elipse', 'polígono', 'polígonos', 'trapecio',
  'trapecial', 'rombo', 'pentágono', 'hexágono', 'octágono', 'cubo', 'esfera', 'cilindro',
  'cono', 'pirámide', 'prisma', 'área', 'perímetro', 'volumen', 'radio', 'diámetro',
  'altura', 'base', 'lado', 'lados', 'vértice', 'vértices', 'arista', 'aristas', 'cara',
  'eje', 'ejes', 'origen', 'coordenada', 'coordenadas', 'plano', 'cartesiano', 'gráfica',
  'gráficas', 'función', 'funciones', 'ecuación', 'ecuaciones', 'fórmula', 'fórmulas',
  'álgebra', 'geometría', 'cálculo', 'análisis', 'matemáticas', 'estadística', 'probabilidad',
  'integral', 'derivada', 'límite', 'matriz', 'matrices', 'vector', 'vectores', 'suma',
  'resta', 'producto', 'división', 'potencia', 'raíz', 'fracción', 'porcentaje', 'número',
  'números', 'valor', 'valores', 'resultado', 'resultados', 'solución', 'problema',
  'ejercicio', 'ejercicios', 'ejemplo', 'ejemplos', 'definición', 'teorema', 'propiedad',
  'propiedades', 'intersección', 'intersecciones', 'paralela', 'paralelas', 'perpendicular',
  'tangente', 'secante', 'cuerda', 'arco', 'centro', 'simetría', 'escala', 'rotación',
  'traslación', 'reflexión', 'distancia', 'longitud', 'ancho', 'alto', 'tamaño', 'color',
  'colores', 'fondo', 'cuadrícula', 'capa', 'capas', 'grupo', 'grupos', 'selección',
  'seleccionar', 'copiar', 'pegar', 'cortar', 'duplicar', 'eliminar', 'borrar', 'deshacer',
  'rehacer', 'guardar', 'exportar', 'imagen', 'documento', 'página', 'páginas', 'título',
  'subtítulo', 'párrafo', 'lista', 'negrita', 'cursiva', 'subrayado', 'alineación',
  'izquierda', 'derecha', 'centrar', 'justificado', 'idioma', 'español', 'inglés',
  'diccionario', 'ortografía', 'corrector', 'sugerencia', 'sugerencias', 'ignorar',
  'agregar', 'aceptar', 'cancelar', 'cerrar', 'configuración', 'hola', 'mundo', 'casa',
  'mesa', 'libro', 'clase', 'clases', 'apuntes', 'diagrama', 'diagramas', 'técnico',
  'técnicos', 'forma', 'formas', 'figura', 'figuras', 'datos', 'tabla', 'tiempo', 'día',
  'días', 'año', 'años', 'trabajo', 'sistema', 'proceso', 'cambio', 'cambios', 'estudio',
  'información', 'usuario', 'manual', 'ayuda', 'herramienta', 'herramientas', 'modo',
  'pingüino', 'cigüeña', 'vergüenza', 'antigüedad', 'bilingüe', 'desagüe', 'canción',
  'corazón', 'razón', 'camión', 'árbol', 'lápiz', 'fácil', 'difícil', 'útil', 'práctica',
  'rápido', 'lento', 'grande', 'pequeño', 'mayor', 'menor', 'igual', 'diferente', 'doble',
  'triple', 'mitad', 'primero', 'segundo', 'tercero', 'último', 'siempre', 'nunca', 'luego',
  'después', 'ahora', 'hoy', 'ayer', 'mañana', 'verdad', 'falso', 'cierto', 'real',
  'entero', 'racional', 'complejo', 'positivo', 'negativo', 'cero', 'uno', 'dos', 'tres',
  'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'cien', 'mil',
  'hola', 'buenos', 'buenas', 'tardes', 'noches', 'gracias', 'favor', 'permiso',
  'entonces', 'además', 'aunque', 'mientras', 'según', 'hacia', 'mediante', 'través',
  'puede', 'puedo', 'puedes', 'podemos', 'tengo', 'tienes', 'tenemos', 'estoy', 'estás',
  'estamos', 'soy', 'eres', 'somos', 'voy', 'vas', 'va', 'vamos', 'van', 'ver', 'leer',
  'usar', 'crear', 'abrir', 'editar', 'mover', 'girar', 'medir', 'cota', 'cotas',
];

const ENGLISH_WORDS_BY_FREQ = [
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on',
  'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we',
  'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
  'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when',
  'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into',
  'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now',
  'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two',
  'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any',
  'these', 'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'been', 'has', 'had',
  'text', 'box', 'note', 'notes', 'board', 'whiteboard', 'canvas', 'draw', 'drawing',
  'line', 'lines', 'point', 'points', 'angle', 'angles', 'triangle', 'triangles', 'square',
  'rectangle', 'circle', 'ellipse', 'polygon', 'trapezoid', 'pentagon', 'hexagon', 'cube',
  'sphere', 'cylinder', 'cone', 'pyramid', 'prism', 'area', 'perimeter', 'volume', 'radius',
  'diameter', 'height', 'width', 'base', 'side', 'sides', 'vertex', 'vertices', 'edge',
  'axis', 'axes', 'origin', 'coordinate', 'coordinates', 'plane', 'graph', 'graphs',
  'function', 'functions', 'equation', 'equations', 'formula', 'algebra', 'geometry',
  'calculus', 'analysis', 'mathematics', 'math', 'integral', 'derivative', 'limit',
  'matrix', 'vector', 'vectors', 'sum', 'difference', 'product', 'division', 'power',
  'root', 'fraction', 'percent', 'number', 'numbers', 'value', 'values', 'result',
  'solution', 'problem', 'example', 'definition', 'theorem', 'property', 'properties',
  'intersection', 'parallel', 'perpendicular', 'tangent', 'center', 'symmetry', 'scale',
  'rotation', 'translation', 'distance', 'length', 'size', 'color', 'colors', 'background',
  'grid', 'layer', 'layers', 'group', 'groups', 'select', 'selection', 'copy', 'paste',
  'cut', 'duplicate', 'delete', 'undo', 'redo', 'save', 'export', 'image', 'document',
  'page', 'title', 'paragraph', 'list', 'bold', 'italic', 'underline', 'align', 'left',
  'right', 'justify', 'language', 'spanish', 'english', 'dictionary', 'spell', 'spelling',
  'suggestion', 'suggestions', 'ignore', 'add', 'settings', 'hello', 'world', 'class',
  'study', 'data', 'table', 'system', 'change', 'changes', 'user', 'help', 'tool', 'tools',
  'receive', 'separate', 'definitely', 'necessary', 'occurrence', 'accommodation',
  'believe', 'achieve', 'friend', 'piece', 'their', 'write', 'writing', 'written',
  'read', 'reading', 'edit', 'editing', 'create', 'open', 'close', 'cancel', 'apply',
  'true', 'false', 'real', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'hundred', 'thousand', 'first', 'second', 'third', 'last',
  'always', 'never', 'often', 'sometimes', 'before', 'during', 'between', 'through',
  'while', 'where', 'here', 'there', 'every', 'each', 'both', 'few', 'more', 'less',
  'same', 'different', 'large', 'small', 'high', 'low', 'fast', 'slow', 'easy', 'hard',
  'important', 'information', 'process', 'project', 'check', 'correct', 'error', 'word',
  'words', 'sentence', 'sentences', "don't", "isn't", "it's", "we're", "you're", "they're",
];

// Términos y modismos frecuentes en español de México agregados sobre la base general en español
const MEXICAN_SPANISH_WORDS_BY_FREQ = [
  ...SPANISH_WORDS_BY_FREQ,
  'méxico', 'mexicano', 'mexicana', 'mexicanos', 'mexicanas', 'computadora', 'computadoras',
  'pluma', 'plumas', 'celular', 'celulares', 'boleto', 'boletos', 'camioneta', 'camionetas',
  'carro', 'carros', 'departamento', 'cuarto', 'recámara', 'recámaras', 'pizarrón', 'pizarrones',
  'marcador', 'marcadores', 'plumón', 'plumones', 'goma', 'escuadra', 'transportador', 'compás',
  'libreta', 'libretas', 'cuaderno', 'cuadernos', 'carpeta', 'impresora', 'pantalla', 'teclado',
  'ventana', 'puerta', 'calle', 'colonia', 'ciudad', 'estado', 'municipio', 'delegación',
  'alcaldía', 'peso', 'pesos', 'centavo', 'centavos', 'dinero', 'tienda', 'tiendita', 'mercado',
  'tianguis', 'comida', 'agua', 'café', 'leche', 'pan', 'tortilla', 'tortillas', 'maíz',
  'frijol', 'frijoles', 'chile', 'chiles', 'jitomate', 'jitomates', 'aguacate', 'aguacates',
  'guacamole', 'taco', 'tacos', 'nopal', 'nopales', 'elote', 'elotes', 'pozole', 'mole',
  'tamal', 'tamales', 'quesadilla', 'quesadillas', 'alberca', 'estacionamiento', 'banqueta',
  'semáforo', 'autobús', 'camión', 'pasaje', 'correo', 'teléfono', 'llave', 'lentes',
  'playera', 'playeras', 'chamarra', 'chamarras', 'tenis', 'zapatos', 'bolsa', 'mochila',
  'semana', 'mes', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
  'ahorita', 'órale', 'ándale', 'papá', 'mamá', 'hermano', 'hermana', 'amigo', 'amiga',
  'compañero', 'compañera', 'maestro', 'maestra', 'maestros', 'maestras', 'alumno', 'alumna',
  'alumnos', 'alumnas', 'salón', 'salones', 'escuela', 'primaria', 'secundaria', 'preparatoria',
  'bachillerato', 'universidad', 'examen', 'exámenes', 'tarea', 'tareas', 'calificación',
  'calificaciones', 'promedio', 'apunte', 'resumen', 'práctica', 'prácticas', 'laboratorio',
];

// Mapa de frecuencia (índice menor => mayor frecuencia en el idioma)
function buildFrequencyMap(list: string[]): Map<string, number> {
  const map = new Map<string, number>();
  list.forEach((word, idx) => {
    const lower = word.toLocaleLowerCase();
    if (!map.has(lower)) {
      map.set(lower, list.length - idx);
    }
  });
  return map;
}

const FALLBACK_MAPS: Record<SpellcheckLanguage, Map<string, number>> = {
  es: buildFrequencyMap(SPANISH_WORDS_BY_FREQ),
  'es-MX': buildFrequencyMap(MEXICAN_SPANISH_WORDS_BY_FREQ),
  'en-US': buildFrequencyMap(ENGLISH_WORDS_BY_FREQ),
};

const ALPHABETS: Record<SpellcheckLanguage, string> = {
  es: 'abcdefghijklmnñopqrstuvwxyzáéíóúü',
  'es-MX': 'abcdefghijklmnñopqrstuvwxyzáéíóúü',
  'en-US': 'abcdefghijklmnopqrstuvwxyz',
};

// Genera ediciones de distancia 1 según algoritmo de Norvig
function edits1(word: string, alphabet: string): Set<string> {
  const results = new Set<string>();
  const len = word.length;
  // Eliminaciones
  for (let i = 0; i < len; i++) {
    results.add(word.slice(0, i) + word.slice(i + 1));
  }
  // Transposiciones adyacentes
  for (let i = 0; i < len - 1; i++) {
    results.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  // Sustituciones
  for (let i = 0; i < len; i++) {
    const prefix = word.slice(0, i);
    const suffix = word.slice(i + 1);
    for (let c = 0; c < alphabet.length; c++) {
      results.add(prefix + alphabet[c] + suffix);
    }
  }
  // Inserciones
  for (let i = 0; i <= len; i++) {
    const prefix = word.slice(0, i);
    const suffix = word.slice(i);
    for (let c = 0; c < alphabet.length; c++) {
      results.add(prefix + alphabet[c] + suffix);
    }
  }
  return results;
}

// Verifica si una palabra pertenece al léxico de respaldo del idioma indicado
export function checkWordFallback(word: string, lang: SpellcheckLanguage): boolean {
  const lower = word.toLocaleLowerCase();
  const dict = FALLBACK_MAPS[lang];
  if (dict.has(lower)) return true;
  // Permite plurales regulares sencillos si la raíz existe en el diccionario de respaldo
  if (lang === 'es' || lang === 'es-MX') {
    if (lower.endsWith('s') && lower.length > 3 && dict.has(lower.slice(0, -1))) return true;
    if (lower.endsWith('es') && lower.length > 4 && dict.has(lower.slice(0, -2))) return true;
  } else {
    if (lower.endsWith('s') && lower.length > 3 && dict.has(lower.slice(0, -1))) return true;
    if (lower.endsWith('es') && lower.length > 4 && dict.has(lower.slice(0, -2))) return true;
    if (lower.endsWith('ed') && lower.length > 4 && dict.has(lower.slice(0, -2))) return true;
    if (lower.endsWith('ing') && lower.length > 5 && dict.has(lower.slice(0, -3))) return true;
  }
  return false;
}

// Genera sugerencias de respaldo ordenadas por distancia de edición (1 antes que 2) y frecuencia
export function suggestWordsFallback(
  word: string,
  lang: SpellcheckLanguage,
  maxSuggestions = 5
): string[] {
  const lower = word.toLocaleLowerCase();
  if (!lower || lower.length > 24) return [];

  const dict = FALLBACK_MAPS[lang];
  const alphabet = ALPHABETS[lang];
  const ranked: { word: string; dist: number; freq: number }[] = [];
  const seen = new Set<string>();

  const e1 = edits1(lower, alphabet);
  for (const cand of e1) {
    const freq = dict.get(cand);
    if (freq !== undefined && !seen.has(cand)) {
      seen.add(cand);
      ranked.push({ word: cand, dist: 1, freq });
    }
  }

  // Solo calcula distancia 2 si aún faltan sugerencias y la palabra es de longitud moderada
  if (ranked.length < maxSuggestions && lower.length <= 14) {
    for (const step1 of e1) {
      const e2 = edits1(step1, alphabet);
      for (const cand of e2) {
        if (seen.has(cand)) continue;
        const freq = dict.get(cand);
        if (freq !== undefined) {
          seen.add(cand);
          ranked.push({ word: cand, dist: 2, freq });
        }
      }
      if (ranked.length >= 40) break;
    }
  }

  ranked.sort((a, b) => a.dist - b.dist || b.freq - a.freq);
  return ranked.slice(0, maxSuggestions).map((r) => r.word);
}
