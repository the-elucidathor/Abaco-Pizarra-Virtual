// OPT: 1.1 — Carga diferida de html-to-image y jspdf únicamente al exportar PNG/PDF
import type { WhiteboardProject } from '../types/whiteboard';
import { pxToMm } from './boardSizes';
import { APP_VERSION } from '../version';

async function loadToPng() {
  const mod = await import('html-to-image');
  return mod.toPng;
}

async function loadJsPDF() {
  const mod = await import('jspdf');
  return mod.jsPDF;
}

export type ExportBackgroundMode = 'board' | 'transparent' | 'white';

export interface ExportCaptureOptions {
  excludeFrame?: boolean;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function hideNodesBySelector(
  root: HTMLElement,
  selector: string
): { el: SVGElement | HTMLElement; prevDisplay: string }[] {
  const hidden: { el: SVGElement | HTMLElement; prevDisplay: string }[] = [];
  root.querySelectorAll(selector).forEach((node) => {
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      hidden.push({ el: node, prevDisplay: node.style.display });
      node.style.display = 'none';
    }
  });
  return hidden;
}

function restoreHiddenNodes(
  hidden: { el: SVGElement | HTMLElement; prevDisplay: string }[]
): void {
  for (const item of hidden) {
    item.el.style.display = item.prevDisplay;
  }
}

// Adapta temporalmente colores del papel, patrón y marco para exportar en "Fondo blanco sólido" legible desde cualquier tema
function applyWhiteSheetPalette(root: HTMLElement): () => void {
  const restores: (() => void)[] = [];
  const saveStyleProp = (el: HTMLElement | SVGElement, prop: string, val: string) => {
    const prevVal = el.style.getPropertyValue(prop);
    const prevPri = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, val, 'important');
    restores.push(() => {
      if (prevVal) el.style.setProperty(prop, prevVal, prevPri);
      else el.style.removeProperty(prop);
    });
  };
  const saveAttr = (el: Element, attr: string, val: string) => {
    const prev = el.getAttribute(attr);
    el.setAttribute(attr, val);
    restores.push(() => {
      if (prev === null) el.removeAttribute(attr);
      else el.setAttribute(attr, prev);
    });
  };

  root.querySelectorAll('[data-export-role]').forEach((node) => {
    const role = node.getAttribute('data-export-role');
    if (role === 'sheet-bg' && node instanceof HTMLElement) {
      saveStyleProp(node, 'background-color', '#ffffff');
      saveStyleProp(node, 'box-shadow', 'none');
    } else if (role === 'grid-stroke') {
      saveAttr(node, 'stroke', 'rgba(15, 23, 42, 0.14)');
    } else if (role === 'lined-stroke') {
      saveAttr(node, 'stroke', 'rgba(37, 99, 235, 0.22)');
    } else if (role === 'dot-fill') {
      saveAttr(node, 'fill', 'rgba(15, 23, 42, 0.28)');
    } else if (role === 'frame-stroke') {
      saveAttr(node, 'stroke', 'rgba(15, 23, 42, 0.34)');
    } else if (role === 'axis-stroke') {
      saveAttr(node, 'stroke', 'rgba(15, 23, 42, 0.50)');
    } else if (role === 'axis-text') {
      saveAttr(node, 'fill', '#334155');
    }
  });

  return () => {
    for (let i = restores.length - 1; i >= 0; i -= 1) {
      restores[i]();
    }
  };
}

// Oculta temporalmente los subrayados ortográficos de CSS Custom Highlight API durante exportación
function suspendSpellHighlightsForExport(): () => void {
  try {
    const cssObj = typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: Map<string, unknown> }) : null;
    const registry = cssObj?.highlights;
    if (!registry || !registry.has('abaco-spell-error')) return () => {};
    const saved = registry.get('abaco-spell-error');
    registry.delete('abaco-spell-error');
    return () => {
      try {
        if (saved !== undefined) registry.set('abaco-spell-error', saved);
      } catch {
        // Ignorar si ya no aplica
      }
    };
  } catch {
    return () => {};
  }
}

// OPT: 2.3 — Asegura que objetos fuera del viewport se monten temporalmente durante la exportación DOM
async function beginCanvasExportCapture(): Promise<() => void> {
  if (typeof window === 'undefined') return () => {};
  try {
    window.dispatchEvent(new CustomEvent('abaco:export-state', { detail: { exporting: true } }));
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  } catch {
    // Ignorar en entornos sin DOM completo
  }
  return () => {
    try {
      window.dispatchEvent(new CustomEvent('abaco:export-state', { detail: { exporting: false } }));
    } catch {
      // Ignorar
    }
  };
}

async function captureStagePng(
  element: HTMLElement,
  pixelRatio: number,
  backgroundMode: ExportBackgroundMode,
  options: ExportCaptureOptions = {}
): Promise<string> {
  const endExportCapture = await beginCanvasExportCapture();
  const prevBg = element.style.getPropertyValue('background-color');
  const prevBgPriority = element.style.getPropertyPriority('background-color');
  const hideBg = backgroundMode === 'transparent';
  const hideFrame = hideBg || Boolean(options.excludeFrame);

  const hiddenBgNodes = hideBg ? hideNodesBySelector(element, '[data-board-background="true"]') : [];
  const hiddenFrameNodes = hideFrame ? hideNodesBySelector(element, '[data-board-frame="true"]') : [];
  const restoreWhitePalette =
    backgroundMode === 'white' ? applyWhiteSheetPalette(element) : () => {};

  const computedBg =
    backgroundMode === 'board'
      ? getComputedStyle(element).backgroundColor || '#ffffff'
      : '#ffffff';

  if (backgroundMode === 'transparent') {
    element.style.setProperty('background-color', 'transparent', 'important');
  } else if (backgroundMode === 'white') {
    element.style.setProperty('background-color', '#ffffff', 'important');
  }

  const restoreHighlights = suspendSpellHighlightsForExport();
  try {
    const toPng = await loadToPng();
    return await toPng(element, {
      pixelRatio,
      backgroundColor: backgroundMode === 'transparent' ? undefined : computedBg,
      style:
        backgroundMode === 'transparent'
          ? { backgroundColor: 'transparent', background: 'transparent' }
          : { backgroundColor: computedBg },
      cacheBust: true,
      filter: (node) => {
        if (node instanceof Element) {
          if (node.getAttribute('data-export-ignore') === 'true') {
            return false;
          }
          if (hideBg && node.getAttribute('data-board-background') === 'true') {
            return false;
          }
          if (hideFrame && node.getAttribute('data-board-frame') === 'true') {
            return false;
          }
        }
        return true;
      },
    });
  } finally {
    restoreHighlights();
    restoreWhitePalette();
    if (prevBg) {
      element.style.setProperty('background-color', prevBg, prevBgPriority);
    } else {
      element.style.removeProperty('background-color');
    }
    restoreHiddenNodes(hiddenFrameNodes);
    restoreHiddenNodes(hiddenBgNodes);
    endExportCapture();
  }
}

async function captureFixedPagePng(
  stageElement: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  pixelRatio: number,
  backgroundMode: ExportBackgroundMode,
  sheetY = 0
): Promise<string> {
  const endExportCapture = await beginCanvasExportCapture();
  const worldLayer =
    (stageElement.querySelector('[data-world-layer="true"]') as HTMLElement | null) ||
    stageElement;
  const worldSheetRoot = worldLayer.querySelector(
    '[data-world-sheet-root="true"]'
  ) as HTMLElement | null;
  const prevSheetRootTransform = worldSheetRoot ? worldSheetRoot.style.transform : '';

  const pageSheet = worldLayer.querySelector('[data-board-background="true"]') as HTMLElement | null;
  const sheetBg =
    backgroundMode === 'board'
      ? (pageSheet && getComputedStyle(pageSheet).backgroundColor) ||
        getComputedStyle(stageElement).backgroundColor ||
        '#ffffff'
      : '#ffffff';

  const hideBg = backgroundMode === 'transparent';
  const hiddenBgNodes = hideBg ? hideNodesBySelector(worldLayer, '[data-board-background="true"]') : [];
  const hiddenFrameNodes = hideBg ? hideNodesBySelector(worldLayer, '[data-board-frame="true"]') : [];
  const restoreWhitePalette =
    backgroundMode === 'white' ? applyWhiteSheetPalette(worldLayer) : () => {};

  const restoreHighlights = suspendSpellHighlightsForExport();
  try {
    if (worldSheetRoot && sheetY !== 0) {
      worldSheetRoot.style.transform = `translateY(${-sheetY}px)`;
    }
    const toPng = await loadToPng();
    return await toPng(worldLayer, {
      width: pageWidth,
      height: pageHeight,
      pixelRatio,
      backgroundColor: backgroundMode === 'transparent' ? undefined : sheetBg,
      style: {
        transform: 'none',
        transformOrigin: 'top left',
        left: '0px',
        top: '0px',
        width: `${pageWidth}px`,
        height: `${pageHeight}px`,
        overflow: 'hidden',
        backgroundColor: backgroundMode === 'transparent' ? 'transparent' : sheetBg,
        background: backgroundMode === 'transparent' ? 'transparent' : sheetBg,
      },
      cacheBust: true,
      filter: (node) => {
        if (node instanceof Element) {
          if (node.getAttribute('data-export-ignore') === 'true') {
            return false;
          }
          if (hideBg && node.getAttribute('data-board-background') === 'true') {
            return false;
          }
          if (hideBg && node.getAttribute('data-board-frame') === 'true') {
            return false;
          }
        }
        return true;
      },
    });
  } finally {
    if (worldSheetRoot) {
      worldSheetRoot.style.transform = prevSheetRootTransform;
    }
    restoreHighlights();
    restoreWhitePalette();
    restoreHiddenNodes(hiddenFrameNodes);
    restoreHiddenNodes(hiddenBgNodes);
    endExportCapture();
  }
}

async function cropCapturedPng(
  fullDataUrl: string,
  cropRect: { x: number; y: number; width: number; height: number },
  pixelRatio: number,
  backgroundMode: ExportBackgroundMode
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = fullDataUrl;
  });

  const canvas = document.createElement('canvas');
  const sx = Math.max(0, Math.round(cropRect.x * pixelRatio));
  const sy = Math.max(0, Math.round(cropRect.y * pixelRatio));
  const sw = Math.max(10, Math.min(img.width - sx, Math.round(cropRect.width * pixelRatio)));
  const sh = Math.max(10, Math.min(img.height - sy, Math.round(cropRect.height * pixelRatio)));

  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Error al crear canvas de recorte');

  try {
    if (backgroundMode !== 'transparent') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sw, sh);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: sw / pixelRatio,
      height: sh / pixelRatio,
    };
  } finally {
    // OPT: 1.4 — Libera el búfer del canvas de recorte
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function exportElementToPng(
  element: HTMLElement,
  filename: string,
  pixelRatio = 2,
  backgroundMode: ExportBackgroundMode = 'board',
  options?: ExportCaptureOptions
): Promise<string> {
  const dataUrl = await captureStagePng(element, pixelRatio, backgroundMode, options);
  downloadDataUrl(dataUrl, filename);
  return dataUrl;
}

export async function exportFixedPageToPng(
  stageElement: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  filename: string,
  pixelRatio = 2,
  backgroundMode: ExportBackgroundMode = 'board',
  sheetY = 0
): Promise<string> {
  const dataUrl = await captureFixedPagePng(
    stageElement,
    pageWidth,
    pageHeight,
    pixelRatio,
    backgroundMode,
    sheetY
  );
  downloadDataUrl(dataUrl, filename);
  return dataUrl;
}

export async function exportFixedSheetsToPng(
  stageElement: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  sheetYs: number[],
  filename: string,
  pixelRatio = 2,
  backgroundMode: ExportBackgroundMode = 'board'
): Promise<string> {
  const targets = sheetYs.length > 0 ? sheetYs : [0];
  if (targets.length === 1) {
    return exportFixedPageToPng(
      stageElement,
      pageWidth,
      pageHeight,
      filename,
      pixelRatio,
      backgroundMode,
      targets[0]
    );
  }

  const gapPx = 24;
  const rawTotalH = targets.length * pageHeight + (targets.length - 1) * gapPx;
  const maxCanvasDim = 28000;
  const effectiveRatio = Math.min(
    pixelRatio,
    maxCanvasDim / Math.max(1, rawTotalH),
    maxCanvasDim / Math.max(1, pageWidth)
  );

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(pageWidth * effectiveRatio));
  canvas.height = Math.max(1, Math.round(rawTotalH * effectiveRatio));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return exportFixedPageToPng(
      stageElement,
      pageWidth,
      pageHeight,
      filename,
      pixelRatio,
      backgroundMode,
      targets[0]
    );
  }

  try {
    if (backgroundMode !== 'transparent') {
      ctx.fillStyle = backgroundMode === 'white' ? '#f8fafc' : '#e2e8f0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const sheetPixelH = Math.round(pageHeight * effectiveRatio);
    const gapPixelH = Math.round(gapPx * effectiveRatio);

    for (let i = 0; i < targets.length; i += 1) {
      const sheetDataUrl = await captureFixedPagePng(
        stageElement,
        pageWidth,
        pageHeight,
        effectiveRatio,
        backgroundMode,
        targets[i]
      );
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (err) => reject(err);
        img.src = sheetDataUrl;
      });
      const destY = i * (sheetPixelH + gapPixelH);
      ctx.drawImage(img, 0, destY, canvas.width, sheetPixelH);
    }

    const combinedUrl = canvas.toDataURL('image/png');
    downloadDataUrl(combinedUrl, filename);
    return combinedUrl;
  } finally {
    // OPT: 1.4 — Libera el búfer del canvas combinado
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function exportCroppedRegionToPng(
  element: HTMLElement,
  cropRect: { x: number; y: number; width: number; height: number },
  filename: string,
  pixelRatio = 2,
  backgroundMode: ExportBackgroundMode = 'board',
  options?: ExportCaptureOptions
): Promise<string> {
  const fullDataUrl = await captureStagePng(element, pixelRatio, backgroundMode, options);
  const { dataUrl } = await cropCapturedPng(fullDataUrl, cropRect, pixelRatio, backgroundMode);
  downloadDataUrl(dataUrl, filename);
  return dataUrl;
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  cropRect?: { x: number; y: number; width: number; height: number },
  backgroundMode: ExportBackgroundMode = 'board',
  pixelRatio = 2,
  options?: ExportCaptureOptions
): Promise<void> {
  const fullDataUrl = await captureStagePng(element, pixelRatio, backgroundMode, options);

  let finalDataUrl = fullDataUrl;
  let width = element.clientWidth || 1200;
  let height = element.clientHeight || 800;

  if (cropRect) {
    const cropped = await cropCapturedPng(fullDataUrl, cropRect, pixelRatio, backgroundMode);
    finalDataUrl = cropped.dataUrl;
    width = cropped.width;
    height = cropped.height;
  } else {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = fullDataUrl;
    });
    width = img.width / pixelRatio;
    height = img.height / pixelRatio;
  }

  const orientation = width >= height ? 'landscape' : 'portrait';
  const pageW = Math.max(120, width);
  const pageH = Math.max(120, height);
  const widthMm = pxToMm(pageW);
  const heightMm = pxToMm(pageH);
  const JsPDF = await loadJsPDF();
  const pdf = new JsPDF({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm],
  });
  pdf.addImage(finalDataUrl, 'PNG', 0, 0, widthMm, heightMm);
  pdf.save(filename);
}

export async function exportFixedPageToPdf(
  stageElement: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  filename: string,
  backgroundMode: ExportBackgroundMode = 'board',
  pixelRatio = 2,
  sheetY = 0
): Promise<void> {
  return exportFixedSheetsToPdf(
    stageElement,
    pageWidth,
    pageHeight,
    [sheetY],
    filename,
    backgroundMode,
    pixelRatio
  );
}

export async function exportFixedSheetsToPdf(
  stageElement: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  sheetYs: number[],
  filename: string,
  backgroundMode: ExportBackgroundMode = 'board',
  pixelRatio = 2
): Promise<void> {
  const targets = sheetYs.length > 0 ? sheetYs : [0];
  const orientation = pageWidth >= pageHeight ? 'landscape' : 'portrait';
  // Convierte CSS px (96 DPI) a mm exactos para que Carta/Oficio/etc. coincida 1:1 en papel
  const widthMm = pxToMm(pageWidth);
  const heightMm = pxToMm(pageHeight);
  const JsPDF = await loadJsPDF();
  const pdf = new JsPDF({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  for (let i = 0; i < targets.length; i += 1) {
    const dataUrl = await captureFixedPagePng(
      stageElement,
      pageWidth,
      pageHeight,
      pixelRatio,
      backgroundMode,
      targets[i]
    );
    if (i > 0) {
      pdf.addPage([widthMm, heightMm], orientation);
    }
    pdf.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);
  }
  pdf.save(filename);
}

export async function copyElementAsPngToClipboard(
  element: HTMLElement,
  cropRect?: { x: number; y: number; width: number; height: number },
  pixelRatio = 2,
  backgroundMode: ExportBackgroundMode = 'board',
  options?: ExportCaptureOptions
): Promise<boolean> {
  try {
    const fullDataUrl = await captureStagePng(element, pixelRatio, backgroundMode, options);
    const dataUrl = cropRect
      ? (await cropCapturedPng(fullDataUrl, cropRect, pixelRatio, backgroundMode)).dataUrl
      : fullDataUrl;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      window.dispatchEvent(new CustomEvent('abaco:system-clipboard-updated'));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function copyFixedPageAsPngToClipboard(
  stageElement: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  pixelRatio = 2,
  backgroundMode: ExportBackgroundMode = 'board',
  sheetY = 0
): Promise<boolean> {
  try {
    const dataUrl = await captureFixedPagePng(
      stageElement,
      pageWidth,
      pageHeight,
      pixelRatio,
      backgroundMode,
      sheetY
    );
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      window.dispatchEvent(new CustomEvent('abaco:system-clipboard-updated'));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function downloadProjectFile(project: WhiteboardProject): Promise<void> {
  const json = JSON.stringify({ ...project, appVersion: APP_VERSION }, null, 2);
  const safeName = (project.name || 'proyecto').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '_');

  // Use native Windows dialog if running inside Electron desktop
  const win = window as unknown as {
    electronDesktop?: {
      isDesktop: boolean;
      savePizarraFile: (defaultName: string, jsonContent: string) => Promise<{ canceled: boolean }>;
    };
  };
  if (win.electronDesktop?.isDesktop) {
    await win.electronDesktop.savePizarraFile(`${safeName}.pizarra`, json);
    return;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, `${safeName}.pizarra`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
