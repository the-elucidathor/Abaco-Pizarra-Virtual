// OPT: 1.1 — Carga diferida de pdfjs-dist, mammoth y xlsx únicamente cuando se importan o abren documentos
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { CanvasObject, DocumentObject, ImageObject } from '../types/whiteboard';
import { uid } from './id';

const SAFE_DOC_TAGS = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
  'sub', 'sup', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'caption', 'colgroup', 'col', 'hr', 'a', 'img',
]);

const STRIP_SUBTREE_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset',
  'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'meta',
  'link', 'base', 'noscript', 'template',
]);

const SAFE_DOC_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  td: new Set(['colspan', 'rowspan']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
};

function isSafeDocHref(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.startsWith('#') || value.startsWith('/')) return true;
  const normalized = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:')
  );
}

function isSafeDocImageSrc(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  const normalized = value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return true;
  }
  return /^data:image\/(png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(
    value.replace(/\s+/g, '')
  );
}

export function sanitizeDocumentHtml(html: string): string {
  const raw = typeof html === 'string' ? html : '';
  if (!raw.trim()) return '';

  if (typeof DOMParser !== 'undefined' && typeof document !== 'undefined') {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(raw, 'text/html');
    const cleanRoot = document.createElement('div');

    const sanitizeNode = (node: Node, targetParent: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        targetParent.appendChild(document.createTextNode(node.textContent || ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      if (STRIP_SUBTREE_TAGS.has(tag)) {
        return;
      }

      if (!SAFE_DOC_TAGS.has(tag)) {
        Array.from(el.childNodes).forEach((child) => sanitizeNode(child, targetParent));
        return;
      }

      const cleanEl = document.createElement(tag);
      const allowedAttrs = SAFE_DOC_ATTRS[tag];
      if (allowedAttrs) {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          if (!allowedAttrs.has(name)) continue;
          const val = attr.value;
          if (tag === 'a' && name === 'href') {
            if (isSafeDocHref(val)) {
              cleanEl.setAttribute('href', val.trim());
              cleanEl.setAttribute('rel', 'noopener noreferrer');
              cleanEl.setAttribute('target', '_blank');
            }
          } else if (tag === 'img' && name === 'src') {
            if (isSafeDocImageSrc(val)) {
              cleanEl.setAttribute('src', val.trim());
            }
          } else if (name === 'colspan' || name === 'rowspan' || name === 'span' || name === 'width' || name === 'height') {
            if (/^\d{1,4}$/.test(val.trim())) {
              cleanEl.setAttribute(name, val.trim());
            }
          } else {
            cleanEl.setAttribute(name, val);
          }
        }
      }

      Array.from(el.childNodes).forEach((child) => sanitizeNode(child, cleanEl));
      targetParent.appendChild(cleanEl);
    };

    Array.from(parsed.body.childNodes).forEach((child) => sanitizeNode(child, cleanRoot));
    return cleanRoot.innerHTML;
  }

  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:javascript|vbscript|data)\s*:/gi, '');
}

let pdfjsConfigured: typeof import('pdfjs-dist') | null = null;
let pdfjsLoadPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfJs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsConfigured) return pdfjsConfigured;
  if (!pdfjsLoadPromise) {
    pdfjsLoadPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
      .then(([lib, workerMod]) => {
        lib.GlobalWorkerOptions.workerSrc = workerMod.default;
        pdfjsConfigured = lib;
        return lib;
      })
      .catch((err) => {
        pdfjsLoadPromise = null;
        console.warn('[Ábaco][opt] Error al cargar pdfjs-dist bajo demanda:', err);
        throw err;
      });
  }
  return pdfjsLoadPromise;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = src;
  });
}

function base64DataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function loadPdfDocument(pdfDataUrl: string): Promise<PDFDocumentProxy> {
  const pdfjsLib = await getPdfJs();
  const data = base64DataUrlToUint8Array(pdfDataUrl);
  const loadingTask = pdfjsLib.getDocument({ data });
  return loadingTask.promise;
}

export async function renderPdfPageFromDocument(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale = 1.4
): Promise<{ dataUrl: string; width: number; height: number; totalPages: number }> {
  const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(clampedPage);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo inicializar el contexto 2D para el PDF');

  try {
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
      totalPages: pdf.numPages,
    };
  } finally {
    // OPT: 1.4 — Libera inmediatamente el búfer del canvas temporal
    canvas.width = 0;
    canvas.height = 0;
  }
}

// OPT: 1.4 — Renderiza página a Blob ObjectURL ligero para caché volátil de visor evitando cadenas base64 grandes
export async function renderPdfPageToBlobUrl(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale = 1.35
): Promise<{ url: string; isObjectUrl: boolean; width: number; height: number; totalPages: number }> {
  const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(clampedPage);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo inicializar el contexto 2D para el PDF');

  try {
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const width = canvas.width;
    const height = canvas.height;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((b) => resolve(b), 'image/png');
      } else {
        resolve(null);
      }
    });
    if (blob) {
      return {
        url: URL.createObjectURL(blob),
        isObjectUrl: true,
        width,
        height,
        totalPages: pdf.numPages,
      };
    }
    return {
      url: canvas.toDataURL('image/png'),
      isObjectUrl: false,
      width,
      height,
      totalPages: pdf.numPages,
    };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function destroyPdfDocument(
  pdf: PDFDocumentProxy | null | undefined
): Promise<void> {
  if (!pdf) return;
  const candidate = pdf as PDFDocumentProxy & {
    destroy?: () => Promise<void>;
    cleanup?: () => Promise<void>;
  };
  try {
    if (typeof candidate.destroy === 'function') {
      await candidate.destroy();
    } else if (typeof candidate.cleanup === 'function') {
      await candidate.cleanup();
    }
  } catch {
    // Ignorar si ya fue destruido
  }
}

export async function renderPdfPageToDataUrl(
  pdfDataUrl: string,
  pageNumber: number,
  scale = 1.6
): Promise<{ dataUrl: string; width: number; height: number; totalPages: number }> {
  const pdf = await loadPdfDocument(pdfDataUrl);
  try {
    return await renderPdfPageFromDocument(pdf, pageNumber, scale);
  } finally {
    // OPT: 1.4 — Libera worker/recursos del documento temporal
    await destroyPdfDocument(pdf);
  }
}

export async function importExternalFile(
  file: File,
  centerX: number,
  centerY: number,
  layerId: string,
  zIndex: number
): Promise<CanvasObject> {
  const name = file.name;
  const lower = name.toLowerCase();

  // Images: PNG, JPG, JPEG, SVG, WEBP, GIF
  if (
    file.type.startsWith('image/') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.webp')
  ) {
    const src = await readFileAsDataUrl(file);
    const dims = await getImageDimensions(src);
    const maxDim = 560;
    const ratio = Math.min(1, maxDim / Math.max(dims.width, dims.height));
    const width = Math.max(80, Math.round(dims.width * ratio));
    const height = Math.max(80, Math.round(dims.height * ratio));

    const imgObj: ImageObject = {
      id: uid('img'),
      type: 'image',
      layerId,
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex,
      src,
      name,
      naturalWidth: dims.width,
      naturalHeight: dims.height,
    };
    return imgObj;
  }

  // PDF
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdfDataUrl = await readFileAsDataUrl(file);
    const rendered = await renderPdfPageToDataUrl(pdfDataUrl, 1, 1.5);
    const maxDim = 620;
    const ratio = Math.min(1, maxDim / Math.max(rendered.width, rendered.height));
    const width = Math.max(240, Math.round(rendered.width * ratio));
    const height = Math.max(240, Math.round(rendered.height * ratio));

    const docObj: DocumentObject = {
      id: uid('pdf'),
      type: 'document',
      docKind: 'pdf',
      layerId,
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex,
      fileName: name,
      pdfDataUrl,
      currentPage: 1,
      totalPages: rendered.totalPages,
      renderedPageDataUrl: rendered.dataUrl,
    };
    return docObj;
  }

  // DOCX
  if (lower.endsWith('.docx')) {
    const buffer = await readFileAsArrayBuffer(file);
    // OPT: 1.1 — Carga diferida de mammoth
    const mammothMod = await import('mammoth');
    const mammoth = (mammothMod as unknown as { default?: typeof import('mammoth') }).default ?? mammothMod;
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const docObj: DocumentObject = {
      id: uid('docx'),
      type: 'document',
      docKind: 'docx',
      layerId,
      x: centerX - 280,
      y: centerY - 220,
      width: 560,
      height: 440,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex,
      fileName: name,
      htmlContent: sanitizeDocumentHtml(result.value || '<p>(Documento vacío)</p>'),
    };
    return docObj;
  }

  // XLSX / XLS / CSV
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    const buffer = await readFileAsArrayBuffer(file);
    // OPT: 1.1 — Carga diferida de xlsx
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheets = wb.SheetNames.map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      const normalizedRows = rows.slice(0, 60).map((r) =>
        (Array.isArray(r) ? r : []).slice(0, 20).map((cell) => (cell == null ? '' : String(cell)))
      );
      return { name: sheetName, rows: normalizedRows };
    });

    const docObj: DocumentObject = {
      id: uid('xlsx'),
      type: 'document',
      docKind: 'xlsx',
      layerId,
      x: centerX - 300,
      y: centerY - 210,
      width: 600,
      height: 420,
      rotation: 0,
      opacity: 1,
      locked: false,
      zIndex,
      fileName: name,
      sheets: sheets.length > 0 ? sheets : [{ name: 'Hoja 1', rows: [['(Sin datos)']] }],
      activeSheetIndex: 0,
    };
    return docObj;
  }

  // Plain Text / Markdown / Code
  const textContent = await readFileAsText(file);
  const docObj: DocumentObject = {
    id: uid('txt'),
    type: 'document',
    docKind: 'txt',
    layerId,
    x: centerX - 240,
    y: centerY - 180,
    width: 480,
    height: 360,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex,
    fileName: name,
    textContent: textContent.slice(0, 40000),
  };
  return docObj;
}
