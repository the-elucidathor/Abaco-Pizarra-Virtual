// OPT: 1.1 — Carga diferida (lazy loading) de KaTeX y sus fuentes CSS para reducir drásticamente la carga inicial
import { useEffect, useState } from 'react';
import type { KatexOptions } from 'katex';

type KatexApi = {
  renderToString: (tex: string, options?: KatexOptions) => string;
};

let katexInstance: KatexApi | null = null;
let loadPromise: Promise<boolean> | null = null;
let loadFailed = false;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Ignorar fallos de suscriptores
    }
  });
}

export function isKatexLoaded(): boolean {
  return katexInstance !== null;
}

export function hasKatexLoadFailed(): boolean {
  return loadFailed;
}

export function ensureKatexLoaded(): Promise<boolean> {
  if (katexInstance) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const [mod] = await Promise.all([
        import('katex'),
        import('katex/dist/katex.min.css'),
      ]);
      const api = (mod as unknown as { default?: KatexApi }).default ?? (mod as unknown as KatexApi);
      if (api && typeof api.renderToString === 'function') {
        katexInstance = api;
        loadFailed = false;
        notifyListeners();
        return true;
      }
      loadFailed = true;
      return false;
    } catch (err) {
      loadFailed = true;
      console.warn('[Ábaco][opt] No se pudo cargar KaTeX de forma diferida:', err);
      notifyListeners();
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

export function subscribeKatexReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useKatexReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => katexInstance !== null);
  useEffect(() => {
    if (katexInstance) {
      setReady(true);
      return;
    }
    let active = true;
    const unsub = subscribeKatexReady(() => {
      if (active && katexInstance) setReady(true);
    });
    void ensureKatexLoaded();
    return () => {
      active = false;
      unsub();
    };
  }, []);
  return ready;
}

function escapePlainLatexHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderKatexToStringLazy(
  tex: string,
  options: KatexOptions
): string | null {
  if (!katexInstance) {
    void ensureKatexLoaded();
    return null;
  }
  return katexInstance.renderToString(tex, options);
}

export function renderLatexFallbackHtml(tex: string): string {
  return `<code class="font-mono text-xs break-all">${escapePlainLatexHtml(tex)}</code>`;
}
