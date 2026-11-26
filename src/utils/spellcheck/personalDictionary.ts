import type { SpellcheckLanguage } from '../../types/whiteboard';

const PERSONAL_DICT_KEY = 'abaco_personal_dictionary_v1';
const LAST_LANG_KEY = 'abaco_last_text_lang_v1';

type DictListener = (words: string[]) => void;
const listeners = new Set<DictListener>();

// Lee la lista completa de palabras del diccionario personal compartida entre proyectos
export function loadPersonalDictionary(): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PERSONAL_DICT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(trimmed);
      }
    }
    return result;
  } catch {
    return [];
  }
}

// Persiste el diccionario personal y notifica a suscriptores activos
function savePersonalDictionary(words: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PERSONAL_DICT_KEY, JSON.stringify(words));
    }
  } catch {
    // Ignorar errores de cuota de almacenamiento local
  }
  const snapshot = [...words];
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // No propagar errores de oyentes
    }
  });
}

// Agrega una palabra al diccionario personal si aún no existe
export function addPersonalWord(word: string): string[] {
  const cleaned = typeof word === 'string' ? word.trim() : '';
  if (!cleaned) return loadPersonalDictionary();
  const current = loadPersonalDictionary();
  const key = cleaned.toLocaleLowerCase();
  if (current.some((w) => w.toLocaleLowerCase() === key)) {
    return current;
  }
  const next = [...current, cleaned].sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  );
  savePersonalDictionary(next);
  return next;
}

// Elimina una palabra del diccionario personal
export function removePersonalWord(word: string): string[] {
  const cleaned = typeof word === 'string' ? word.trim() : '';
  const current = loadPersonalDictionary();
  if (!cleaned) return current;
  const key = cleaned.toLocaleLowerCase();
  const next = current.filter((w) => w.toLocaleLowerCase() !== key);
  if (next.length !== current.length) {
    savePersonalDictionary(next);
  }
  return next;
}

// Comprueba si una palabra está registrada en el diccionario personal (sin distinguir mayúsculas)
export function isPersonalWord(word: string): boolean {
  const key = typeof word === 'string' ? word.trim().toLocaleLowerCase() : '';
  if (!key) return false;
  return loadPersonalDictionary().some((w) => w.toLocaleLowerCase() === key);
}

// Suscribe un componente a cambios del diccionario personal
export function subscribePersonalDictionary(listener: DictListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Comprueba si un valor corresponde a un idioma soportado por el corrector
export function isValidSpellcheckLanguage(value: unknown): value is SpellcheckLanguage {
  return value === 'es' || value === 'es-MX' || value === 'en-US';
}

// Obtiene el último idioma seleccionado por el usuario para nuevos cuadros de texto
export function getRememberedTextLang(fallback: SpellcheckLanguage = 'es'): SpellcheckLanguage {
  try {
    if (typeof localStorage === 'undefined') {
      return isValidSpellcheckLanguage(fallback) ? fallback : 'es';
    }
    const saved = localStorage.getItem(LAST_LANG_KEY);
    if (isValidSpellcheckLanguage(saved)) return saved;
  } catch {
    // Ignorar error de lectura
  }
  return isValidSpellcheckLanguage(fallback) ? fallback : 'es';
}

// Guarda el último idioma elegido para futuros cuadros de texto
export function setRememberedTextLang(lang: SpellcheckLanguage): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_LANG_KEY, lang);
    }
  } catch {
    // Ignorar error de almacenamiento
  }
}
