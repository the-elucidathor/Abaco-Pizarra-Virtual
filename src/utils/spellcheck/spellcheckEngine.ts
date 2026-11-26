import type { NSpellInstance } from 'nspell';
import type { SpellcheckLanguage } from '../../types/whiteboard';
import {
  addPersonalWord,
  isPersonalWord,
  loadPersonalDictionary,
  subscribePersonalDictionary,
} from './personalDictionary';
// OPT: 1.1 — Carga diferida de diccionarios de respaldo (solo cuando falla la descarga Hunspell)
type FallbackDictModule = typeof import('./fallbackDictionaries');
let fallbackDictMod: FallbackDictModule | null = null;
let fallbackLoadPromise: Promise<FallbackDictModule | null> | null = null;

async function ensureFallbackDictionariesLoaded(): Promise<FallbackDictModule | null> {
  if (fallbackDictMod) return fallbackDictMod;
  if (!fallbackLoadPromise) {
    fallbackLoadPromise = import('./fallbackDictionaries')
      .then((mod) => {
        fallbackDictMod = mod;
        return mod;
      })
      .catch((err) => {
        console.warn('[Ábaco][opt] Error al cargar respaldo ortográfico:', err);
        return null;
      })
      .finally(() => {
        fallbackLoadPromise = null;
      });
  }
  return fallbackLoadPromise;
}

export type DictionaryStatus = 'idle' | 'loading' | 'ready' | 'fallback';

export interface SpellToken {
  word: string;
  start: number;
  end: number;
}

const CDN_DICTIONARIES: Record<
  SpellcheckLanguage,
  { affUrl: string; dicUrl: string }
> = {
  es: {
    affUrl: 'https://cdn.jsdelivr.net/npm/dictionary-es/index.aff',
    dicUrl: 'https://cdn.jsdelivr.net/npm/dictionary-es/index.dic',
  },
  'es-MX': {
    // Diccionario Hunspell específico para Español (México)
    affUrl: 'https://cdn.jsdelivr.net/npm/dictionary-es-mx/index.aff',
    dicUrl: 'https://cdn.jsdelivr.net/npm/dictionary-es-mx/index.dic',
  },
  'en-US': {
    affUrl: 'https://cdn.jsdelivr.net/npm/dictionary-en/index.aff',
    dicUrl: 'https://cdn.jsdelivr.net/npm/dictionary-en/index.dic',
  },
};

const CACHE_NAME = 'abaco-hunspell-dict-v1';
const IDB_NAME = 'abaco-spellcheck-dicts-v1';
const IDB_STORE = 'dictionaries';

const loadedHunspell = new Map<SpellcheckLanguage, NSpellInstance>();
const loadingPromises = new Map<SpellcheckLanguage, Promise<DictionaryStatus>>();
const statusMap = new Map<SpellcheckLanguage, DictionaryStatus>([
  ['es', 'idle'],
  ['es-MX', 'idle'],
  ['en-US', 'idle'],
]);
const statusListeners = new Set<(lang: SpellcheckLanguage, status: DictionaryStatus) => void>();

// Palabras ignoradas solo durante la sesión actual (no persisten tras recargar)
const sessionIgnoredWords = new Set<string>();

// Sincroniza palabras del diccionario personal con las instancias nspell ya cargadas
let syncedPersonalSnapshot = new Set<string>(
  loadPersonalDictionary().map((w) => w.toLocaleLowerCase())
);
subscribePersonalDictionary((words) => {
  const nextSet = new Set(words.map((w) => w.toLocaleLowerCase()));
  loadedHunspell.forEach((sp) => {
    try {
      for (const prev of syncedPersonalSnapshot) {
        if (!nextSet.has(prev)) sp.remove(prev);
      }
      for (const cur of words) {
        sp.add(cur);
      }
    } catch {
      // No interrumpir ante fallos de nspell
    }
  });
  syncedPersonalSnapshot = nextSet;
});

function emitStatus(lang: SpellcheckLanguage, status: DictionaryStatus): void {
  statusMap.set(lang, status);
  statusListeners.forEach((fn) => {
    try {
      fn(lang, status);
    } catch {
      // Ignorar errores en suscriptores
    }
  });
}

// Consulta el estado actual de carga del diccionario para un idioma
export function getDictionaryStatus(lang: SpellcheckLanguage): DictionaryStatus {
  return statusMap.get(lang) ?? 'idle';
}

// Permite escuchar cambios de estado ('loading', 'ready', 'fallback') para mostrar indicador discreto
export function subscribeDictionaryStatus(
  listener: (lang: SpellcheckLanguage, status: DictionaryStatus) => void
): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

// Lee o escribe pares .aff/.dic en IndexedDB como respaldo de Cache API para modo sin conexión
function openDictIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'lang' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readDictFromIdb(
  lang: SpellcheckLanguage
): Promise<{ aff: string; dic: string } | null> {
  try {
    const db = await openDictIdb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(lang);
      req.onsuccess = () => {
        const res = req.result as { lang: string; aff: string; dic: string } | undefined;
        resolve(res && res.aff && res.dic ? { aff: res.aff, dic: res.dic } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeDictToIdb(
  lang: SpellcheckLanguage,
  aff: string,
  dic: string
): Promise<void> {
  try {
    const db = await openDictIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ lang, aff, dic, cachedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignorar fallo silenciosamente
  }
}

async function readDictFromCacheApi(
  lang: SpellcheckLanguage
): Promise<{ aff: string; dic: string } | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    const { affUrl, dicUrl } = CDN_DICTIONARIES[lang];
    const [affRes, dicRes] = await Promise.all([cache.match(affUrl), cache.match(dicUrl)]);
    if (!affRes || !dicRes) return null;
    const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);
    if (!aff || !dic) return null;
    return { aff, dic };
  } catch {
    return null;
  }
}

async function writeDictToCacheApi(
  lang: SpellcheckLanguage,
  aff: string,
  dic: string
): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CACHE_NAME);
    const { affUrl, dicUrl } = CDN_DICTIONARIES[lang];
    await Promise.all([
      cache.put(
        affUrl,
        new Response(aff, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      ),
      cache.put(
        dicUrl,
        new Response(dic, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      ),
    ]);
  } catch {
    // Ignorar error de Cache API
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs = 4000): Promise<string> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller !== null
      ? window.setTimeout(() => controller.abort(), timeoutMs)
      : null;
  try {
    const res = await fetch(url, {
      signal: controller?.signal,
      cache: 'force-cache',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

// Carga diferida de nspell + diccionario Hunspell con caché offline (Cache API + IndexedDB) y respaldo Norvig silencioso
export async function ensureDictionaryLoaded(
  lang: SpellcheckLanguage
): Promise<DictionaryStatus> {
  if (loadedHunspell.has(lang)) {
    emitStatus(lang, 'ready');
    return 'ready';
  }
  const inFlight = loadingPromises.get(lang);
  if (inFlight) return inFlight;

  const task = (async (): Promise<DictionaryStatus> => {
    emitStatus(lang, 'loading');
    try {
      let data = await readDictFromCacheApi(lang);
      if (!data) {
        data = await readDictFromIdb(lang);
      }
      if (!data) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new Error('Sin conexión a internet; usando diccionario local integrado');
        }
        const { affUrl, dicUrl } = CDN_DICTIONARIES[lang];
        const [aff, dic] = await Promise.all([
          fetchTextWithTimeout(affUrl),
          fetchTextWithTimeout(dicUrl),
        ]);
        data = { aff, dic };
        void writeDictToCacheApi(lang, aff, dic);
        void writeDictToIdb(lang, aff, dic);
      }

      const nspellMod = await import('nspell');
      const createNSpell =
        (nspellMod as unknown as { default?: typeof import('nspell').default }).default ??
        (nspellMod as unknown as typeof import('nspell').default);
      const instance = createNSpell(data.aff, data.dic);

      // Inyecta las palabras del diccionario personal en la instancia recién cargada
      for (const w of loadPersonalDictionary()) {
        try {
          instance.add(w);
        } catch {
          // Ignorar entrada incompatible
        }
      }

      loadedHunspell.set(lang, instance);
      emitStatus(lang, 'ready');
      return 'ready';
    } catch {
      // Si falla la descarga o carga, se activa el respaldo Norvig sin bloquear al usuario
      await ensureFallbackDictionariesLoaded();
      emitStatus(lang, 'fallback');
      return 'fallback';
    } finally {
      loadingPromises.delete(lang);
    }
  })();

  loadingPromises.set(lang, task);
  return task;
}

// Marca una palabra como ignorada únicamente durante la sesión actual
export function ignoreWordForSession(word: string, lang: SpellcheckLanguage): void {
  const key = `${lang}:${word.trim().toLocaleLowerCase()}`;
  sessionIgnoredWords.add(key);
}

// Agrega palabra al diccionario personal persistente y la registra en el motor activo
export function addWordToPersonalDictionaryAndEngine(word: string): string[] {
  return addPersonalWord(word);
}

// Verifica si una palabra es correcta usando Hunspell o respaldo Norvig (nunca lanza)
export function isWordCorrect(word: string, lang: SpellcheckLanguage): boolean {
  try {
    const trimmed = typeof word === 'string' ? word.trim() : '';
    if (!trimmed) return true;
    const lower = trimmed.toLocaleLowerCase();

    if (sessionIgnoredWords.has(`${lang}:${lower}`)) return true;
    if (isPersonalWord(trimmed)) return true;

    const hunspell = loadedHunspell.get(lang);
    if (hunspell) {
      if (hunspell.correct(trimmed)) return true;
      // Prueba también en minúscula cuando va al inicio de frase u oración
      if (trimmed !== lower && hunspell.correct(lower)) return true;
      return false;
    }

    if (statusMap.get(lang) === 'fallback') {
      if (fallbackDictMod) {
        return fallbackDictMod.checkWordFallback(trimmed, lang);
      }
      void ensureFallbackDictionariesLoaded();
      return true;
    }

    // Mientras aún carga por primera vez y no hay respaldo activo, no marca errores falsos
    return true;
  } catch {
    return true;
  }
}

// Obtiene hasta `maxSuggestions` sugerencias para una palabra mal escrita
export function getSpellSuggestions(
  word: string,
  lang: SpellcheckLanguage,
  maxSuggestions = 5
): string[] {
  try {
    const trimmed = typeof word === 'string' ? word.trim() : '';
    if (!trimmed) return [];

    const hunspell = loadedHunspell.get(lang);
    if (hunspell) {
      const raw = hunspell.suggest(trimmed);
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const cand of raw) {
        if (!cand || seen.has(cand.toLocaleLowerCase())) continue;
        seen.add(cand.toLocaleLowerCase());
        unique.push(cand);
        if (unique.length >= maxSuggestions) break;
      }
      return unique;
    }

    if (fallbackDictMod) {
      return fallbackDictMod.suggestWordsFallback(trimmed, lang, maxSuggestions);
    }
    void ensureFallbackDictionariesLoaded();
    return [];
  } catch {
    return [];
  }
}

// Conserva la capitalización original (Título / MAYÚSCULAS) al aplicar una sugerencia
export function applySuggestionCase(original: string, suggestion: string): string {
  if (!original || !suggestion) return suggestion;
  const isAllUpper =
    original.length > 1 &&
    original === original.toLocaleUpperCase() &&
    original !== original.toLocaleLowerCase();
  if (isAllUpper) {
    return suggestion.toLocaleUpperCase();
  }
  const firstChar = original[0];
  const isFirstUpper =
    firstChar === firstChar.toLocaleUpperCase() &&
    firstChar !== firstChar.toLocaleLowerCase();
  if (isFirstUpper && suggestion[0] === suggestion[0].toLocaleLowerCase()) {
    return suggestion[0].toLocaleUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

// Expresiones para detectar URLs, correos electrónicos y tokens de palabras Unicode con apóstrofes/guiones
const URL_OR_EMAIL_REGEX =
  /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>()]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\b[\p{L}\p{N}-]+\.(?:com|net|org|edu|gov|io|es|mx|ar|co|cl|pe|app|dev|ai)(?:\/[^\s<>()]*)?/giu;
const TOKEN_REGEX = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

// Extrae las palabras revisables de un texto respetando letras Unicode, tildes, ñ, apóstrofes y guiones
export function tokenizeTextForSpellcheck(text: string): SpellToken[] {
  if (typeof text !== 'string' || !text) return [];
  try {
    const excludedSpans: { start: number; end: number }[] = [];
    URL_OR_EMAIL_REGEX.lastIndex = 0;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = URL_OR_EMAIL_REGEX.exec(text)) !== null) {
      excludedSpans.push({
        start: urlMatch.index,
        end: urlMatch.index + urlMatch[0].length,
      });
    }

    const tokens: SpellToken[] = [];
    TOKEN_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_REGEX.exec(text)) !== null) {
      const word = m[0];
      const start = m.index;
      const end = start + word.length;

      // Ignora URLs o correos detectados previamente
      const insideUrlOrEmail = excludedSpans.some(
        (sp) => Math.max(sp.start, start) < Math.min(sp.end, end)
      );
      if (insideUrlOrEmail) continue;

      // Ignora tokens que contengan cualquier dígito numérico
      if (/\p{N}/u.test(word)) continue;

      // Ignora palabras escritas completamente en MAYÚSCULAS (acrónimos, siglas, etc.)
      if (word === word.toLocaleUpperCase() && word !== word.toLocaleLowerCase()) {
        continue;
      }

      // Debe contener al menos una letra real
      if (!/\p{L}/u.test(word)) continue;

      tokens.push({ word, start, end });
    }
    return tokens;
  } catch {
    return [];
  }
}

// Ejecuta revisión ortográfica completa sobre un texto y devuelve únicamente los tokens con error
export function findMisspelledTokens(
  text: string,
  lang: SpellcheckLanguage
): SpellToken[] {
  try {
    const tokens = tokenizeTextForSpellcheck(text);
    const errors: SpellToken[] = [];
    for (const tk of tokens) {
      if (!isWordCorrect(tk.word, lang)) {
        errors.push(tk);
      }
    }
    return errors;
  } catch {
    return [];
  }
}
