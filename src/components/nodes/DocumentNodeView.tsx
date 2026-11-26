import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Lock } from 'lucide-react';
import type { DocumentObject } from '../../types/whiteboard';
import {
  destroyPdfDocument,
  loadPdfDocument,
  renderPdfPageFromDocument,
  renderPdfPageToBlobUrl,
  renderPdfPageToDataUrl,
  sanitizeDocumentHtml,
} from '../../utils/documentImporter';

interface DocumentNodeViewProps {
  obj: DocumentObject;
  onUpdateDocument: (id: string, patch: Partial<DocumentObject>) => void;
}

// OPT: 1.4 — Límite LRU de páginas en memoria por visor PDF (libera Blob URLs antiguos y destruye pdfDoc al desmontar)
const MAX_VOLATILE_PDF_PAGES = 14;

const DocumentNodeViewInner: React.FC<DocumentNodeViewProps> = ({
  obj,
  onUpdateDocument,
}) => {
  const [loadingPage, setLoadingPage] = useState(false);
  const safeHtmlContent = useMemo(
    () => (obj.docKind === 'docx' ? sanitizeDocumentHtml(obj.htmlContent || '') : ''),
    [obj.docKind, obj.htmlContent]
  );
  const [visiblePdfPage, setVisiblePdfPage] = useState<number>(obj.currentPage || 1);
  const [pdfPageCache, setPdfPageCache] = useState<Record<number, string>>(() =>
    obj.renderedPageDataUrl ? { [obj.currentPage || 1]: obj.renderedPageDataUrl } : {}
  );
  const pdfScrollRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<Awaited<ReturnType<typeof loadPdfDocument>> | null>(null);
  const objectUrlsRef = useRef<Map<number, string>>(new Map());

  const revokePageUrl = (pageNum: number) => {
    const prevUrl = objectUrlsRef.current.get(pageNum);
    if (prevUrl) {
      try {
        URL.revokeObjectURL(prevUrl);
      } catch {
        // Ignorar
      }
      objectUrlsRef.current.delete(pageNum);
    }
  };

  const setCachedPageUrl = (pageNum: number, url: string, isObjectUrl: boolean) => {
    if (isObjectUrl) {
      const existing = objectUrlsRef.current.get(pageNum);
      if (existing && existing !== url) {
        try {
          URL.revokeObjectURL(existing);
        } catch {
          // Ignorar
        }
      }
      objectUrlsRef.current.delete(pageNum);
      objectUrlsRef.current.set(pageNum, url);
    }

    setPdfPageCache((prev) => {
      if (prev[pageNum] === url) return prev;
      const next: Record<number, string> = { ...prev, [pageNum]: url };
      const keys = Object.keys(next).map(Number);
      if (keys.length > MAX_VOLATILE_PDF_PAGES) {
        const pinned = obj.currentPage || 1;
        for (const k of keys) {
          if (Object.keys(next).length <= MAX_VOLATILE_PDF_PAGES) break;
          if (k === pageNum || k === pinned) continue;
          if (Math.abs(k - visiblePdfPage) <= 3) continue;
          delete next[k];
          revokePageUrl(k);
        }
      }
      return next;
    });
  };

  // OPT: 1.4 — Limpieza integral al desmontar o cambiar el documento PDF
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignorar
        }
      });
      objectUrlsRef.current.clear();
      const doc = pdfDocRef.current;
      pdfDocRef.current = null;
      if (doc) {
        void destroyPdfDocument(doc);
      }
    };
  }, [obj.id, obj.pdfDataUrl]);

  // Sincroniza caché con la página renderizada almacenada en el objeto
  useEffect(() => {
    const p = obj.currentPage || 1;
    setVisiblePdfPage(p);
    if (obj.renderedPageDataUrl) {
      setPdfPageCache((prev) =>
        prev[p] === obj.renderedPageDataUrl
          ? prev
          : { ...prev, [p]: obj.renderedPageDataUrl! }
      );
    }
  }, [obj.currentPage, obj.renderedPageDataUrl]);

  // Renderizado progresivo de páginas de PDF para permitir desplazamiento vertical con la rueda
  useEffect(() => {
    if (obj.docKind !== 'pdf' || !obj.pdfDataUrl || obj.isReferenceBackground) return;
    const total = Math.max(1, obj.totalPages || 1);
    if (total <= 1) return;

    let cancelled = false;

    const loadPages = async () => {
      try {
        const pdfDoc = await loadPdfDocument(obj.pdfDataUrl!);
        if (cancelled) {
          void destroyPdfDocument(pdfDoc);
          return;
        }
        if (pdfDocRef.current && pdfDocRef.current !== pdfDoc) {
          void destroyPdfDocument(pdfDocRef.current);
        }
        pdfDocRef.current = pdfDoc;
        const pageCount = Math.min(total, pdfDoc.numPages || total);
        // Renderizar páginas en torno a la página actual hasta el límite LRU para mantener uso de memoria acotado
        const maxImmediate = Math.min(pageCount, MAX_VOLATILE_PDF_PAGES);
        for (let p = 1; p <= maxImmediate; p++) {
          if (cancelled) break;
          const rendered = await renderPdfPageToBlobUrl(pdfDoc, p, 1.35);
          if (cancelled) {
            if (rendered.isObjectUrl) URL.revokeObjectURL(rendered.url);
            break;
          }
          setCachedPageUrl(p, rendered.url, rendered.isObjectUrl);
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch {
        // Fallback silencioso a navegación página por página con botones
      }
    };

    loadPages();
    return () => {
      cancelled = true;
    };
  }, [obj.id, obj.docKind, obj.pdfDataUrl, obj.totalPages, obj.isReferenceBackground]);

  const ensurePdfPageRendered = async (pageNum: number): Promise<string | null> => {
    if (pdfPageCache[pageNum]) return pdfPageCache[pageNum];
    if (!obj.pdfDataUrl) return null;
    try {
      const pdfDoc = pdfDocRef.current || (await loadPdfDocument(obj.pdfDataUrl));
      pdfDocRef.current = pdfDoc;
      const rendered = await renderPdfPageToBlobUrl(pdfDoc, pageNum, 1.4);
      setCachedPageUrl(pageNum, rendered.url, rendered.isObjectUrl);
      return rendered.url;
    } catch {
      return null;
    }
  };

  const handleChangePdfPage = async (nextPage: number) => {
    if (!obj.pdfDataUrl || !obj.totalPages) return;
    const target = Math.max(1, Math.min(nextPage, obj.totalPages));
    if (loadingPage) return;

    setVisiblePdfPage(target);
    const container = pdfScrollRef.current;
    if (container && !obj.isReferenceBackground) {
      const targetEl = container.querySelector<HTMLElement>(
        `[data-pdf-page="${target}"]`
      );
      if (targetEl) {
        container.scrollTo({
          top: Math.max(0, targetEl.offsetTop - 8),
          behavior: 'smooth',
        });
      }
    }

    if (target === obj.currentPage && pdfPageCache[target]) return;
    setLoadingPage(true);
    try {
      const cached = pdfPageCache[target];
      // Conserva dataUrl persistente al guardar el estado de la página activa del objeto
      if (cached && cached.startsWith('data:')) {
        onUpdateDocument(obj.id, {
          currentPage: target,
          renderedPageDataUrl: cached,
        });
      } else if (pdfDocRef.current) {
        const rendered = await renderPdfPageFromDocument(pdfDocRef.current, target, 1.5);
        onUpdateDocument(obj.id, {
          currentPage: target,
          renderedPageDataUrl: rendered.dataUrl,
        });
      } else {
        const rendered = await renderPdfPageToDataUrl(obj.pdfDataUrl, target, 1.5);
        setPdfPageCache((prev) => ({ ...prev, [target]: rendered.dataUrl }));
        onUpdateDocument(obj.id, {
          currentPage: target,
          renderedPageDataUrl: rendered.dataUrl,
        });
      }
    } finally {
      setLoadingPage(false);
    }
  };

  const handlePdfScroll = () => {
    const container = pdfScrollRef.current;
    if (!container) return;
    const total = Math.max(1, obj.totalPages || 1);
    if (total <= 1) return;

    const midY = container.scrollTop + container.clientHeight * 0.35;
    const pageEls = container.querySelectorAll<HTMLElement>('[data-pdf-page]');
    let detected = visiblePdfPage;
    pageEls.forEach((el) => {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      const p = Number(el.dataset.pdfPage || 1);
      if (midY >= top && midY <= bottom) {
        detected = p;
      }
    });
    if (detected !== visiblePdfPage) {
      setVisiblePdfPage(detected);
      if (!pdfPageCache[detected]) {
        void ensurePdfPageRendered(detected);
      }
    }
  };

  // Permite scroll nativo con la rueda dentro de archivos importados; Ctrl/Cmd+rueda sigue haciendo zoom del lienzo
  const handleContentWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      e.stopPropagation();
    }
  };

  if (obj.docKind === 'pdf') {
    const totalPages = Math.max(1, obj.totalPages || 1);
    const activePageNum = obj.isReferenceBackground ? obj.currentPage || 1 : visiblePdfPage;

    return (
      <div
        data-scrollable-content={obj.isReferenceBackground ? undefined : 'true'}
        onWheel={obj.isReferenceBackground ? undefined : handleContentWheel}
        style={obj.isReferenceBackground ? undefined : { overscrollBehavior: 'contain' }}
        className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md overflow-hidden shadow-xs"
      >
        <div
          className="flex items-center justify-between px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-red-600 shrink-0" />
            <span className="truncate font-medium">{obj.fileName}</span>
            {obj.isReferenceBackground && (
              <Lock className="w-3 h-3 text-amber-600 shrink-0" aria-label="Fondo bloqueado" />
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1 shrink-0 font-mono-tabular">
              <button
                type="button"
                onClick={() => handleChangePdfPage(activePageNum - 1)}
                disabled={activePageNum <= 1 || loadingPage}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                title="Página anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] px-1">
                {activePageNum}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => handleChangePdfPage(activePageNum + 1)}
                disabled={activePageNum >= totalPages || loadingPage}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
                title="Página siguiente"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {obj.isReferenceBackground ? (
          <div className="flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950 flex items-center justify-center relative">
            {obj.renderedPageDataUrl ? (
              <img
                src={obj.renderedPageDataUrl}
                alt={`${obj.fileName} página ${obj.currentPage || 1}`}
                className="w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
              />
            ) : (
              <div className="text-xs text-slate-400">Sin vista previa PDF</div>
            )}
          </div>
        ) : (
          <div
            ref={pdfScrollRef}
            data-scrollable-content="true"
            onScroll={handlePdfScroll}
            onWheel={handleContentWheel}
            style={{ overscrollBehavior: 'contain' }}
            className="flex-1 overflow-y-auto overflow-x-hidden panel-scroll overscroll-contain bg-slate-100 dark:bg-slate-950 p-2.5 space-y-2.5 relative"
          >
            {totalPages > 1 ? (
              Array.from({ length: totalPages }, (_, idx) => {
                const pageNum = idx + 1;
                const src =
                  pdfPageCache[pageNum] ||
                  (pageNum === (obj.currentPage || 1) ? obj.renderedPageDataUrl : undefined);
                return (
                  <div
                    key={pageNum}
                    data-pdf-page={pageNum}
                    className="relative rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden"
                  >
                    {src ? (
                      <img
                        src={src}
                        alt={`${obj.fileName} página ${pageNum}`}
                        className="w-full h-auto block pointer-events-none select-none"
                        draggable={false}
                      />
                    ) : (
                      <div className="min-h-[260px] flex flex-col items-center justify-center gap-2 text-xs text-slate-400 p-4">
                        <span>Página {pageNum} de {totalPages}</span>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => void ensurePdfPageRendered(pageNum)}
                          className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                          Cargar página
                        </button>
                      </div>
                    )}
                    <div className="px-2 py-0.5 text-[10px] font-mono-tabular text-right text-slate-400 border-t border-slate-100 dark:border-slate-800">
                      Pág. {pageNum} / {totalPages}
                    </div>
                  </div>
                );
              })
            ) : obj.renderedPageDataUrl ? (
              <img
                src={obj.renderedPageDataUrl}
                alt={`${obj.fileName} página 1`}
                className="w-full h-auto block rounded shadow-xs bg-white pointer-events-none select-none"
                draggable={false}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sin vista previa PDF
              </div>
            )}

            {loadingPage && (
              <div className="sticky bottom-2 left-1/2 -translate-x-1/2 w-fit mx-auto px-3 py-1 rounded-full bg-slate-900/80 text-white text-[11px] font-medium shadow">
                Cargando página...
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (obj.docKind === 'xlsx') {
    const sheets = obj.sheets || [];
    const activeIdx = obj.activeSheetIndex || 0;
    const currentSheet = sheets[activeIdx] || { name: 'Hoja 1', rows: [] };

    return (
      <div
        data-scrollable-content={obj.isReferenceBackground ? undefined : 'true'}
        onWheel={obj.isReferenceBackground ? undefined : handleContentWheel}
        style={obj.isReferenceBackground ? undefined : { overscrollBehavior: 'contain' }}
        className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md overflow-hidden shadow-xs"
      >
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate font-medium text-slate-800 dark:text-slate-100">
              {obj.fileName}
            </span>
          </div>
          {sheets.length > 1 && (
            <div className="flex items-center gap-1 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
              {sheets.map((s, idx) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onUpdateDocument(obj.id, { activeSheetIndex: idx })}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                    idx === activeIdx
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          data-scrollable-content="true"
          style={{ overscrollBehavior: 'contain' }}
          className="flex-1 overflow-auto panel-scroll overscroll-contain p-2 text-[11px] font-mono-tabular"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={handleContentWheel}
        >
          <table className="w-full border-collapse">
            <tbody>
              {currentSheet.rows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx === 0 ? 'bg-slate-100 dark:bg-slate-800 font-semibold' : ''}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border border-slate-200 dark:border-slate-700 px-2 py-1 text-slate-800 dark:text-slate-200 whitespace-nowrap"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (obj.docKind === 'docx') {
    return (
      <div
        data-scrollable-content={obj.isReferenceBackground ? undefined : 'true'}
        onWheel={obj.isReferenceBackground ? undefined : handleContentWheel}
        style={obj.isReferenceBackground ? undefined : { overscrollBehavior: 'contain' }}
        className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md overflow-hidden shadow-xs"
      >
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs shrink-0">
          <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">
            {obj.fileName}
          </span>
        </div>
        <div
          data-scrollable-content="true"
          style={{ overscrollBehavior: 'contain' }}
          className="flex-1 overflow-auto panel-scroll overscroll-contain p-4 text-xs leading-relaxed text-slate-800 dark:text-slate-200 prose prose-sm max-w-none"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={handleContentWheel}
          dangerouslySetInnerHTML={{ __html: safeHtmlContent }}
        />
      </div>
    );
  }

  return (
    <div
      data-scrollable-content={obj.isReferenceBackground ? undefined : 'true'}
      onWheel={obj.isReferenceBackground ? undefined : handleContentWheel}
      style={obj.isReferenceBackground ? undefined : { overscrollBehavior: 'contain' }}
      className="w-full h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md overflow-hidden shadow-xs"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs shrink-0">
        <FileText className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0" />
        <span className="truncate font-medium text-slate-800 dark:text-slate-100">
          {obj.fileName}
        </span>
      </div>
      <pre
        data-scrollable-content="true"
        style={{ overscrollBehavior: 'contain' }}
        className="flex-1 overflow-auto panel-scroll overscroll-contain p-3 text-xs font-mono-tabular text-slate-800 dark:text-slate-200 whitespace-pre-wrap"
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={handleContentWheel}
      >
        {obj.textContent || ''}
      </pre>
    </div>
  );
};

// OPT: 2.6 — Memoización de DocumentNodeView para evitar re-renderizados en pan/zoom/selección
export const DocumentNodeView = React.memo(DocumentNodeViewInner);

