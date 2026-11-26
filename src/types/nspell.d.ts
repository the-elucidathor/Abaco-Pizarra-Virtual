// Declaración de tipos mínima para la librería nspell (corrector ortográfico Hunspell en JS)
declare module 'nspell' {
  export interface NSpellDictionaryInput {
    aff: string | Uint8Array;
    dic: string | Uint8Array;
  }

  export interface NSpellInstance {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpellInstance;
    remove(word: string): NSpellInstance;
    personal(dic: string): NSpellInstance;
  }

  export default function nspell(
    aff: string | Uint8Array | NSpellDictionaryInput,
    dic?: string | Uint8Array
  ): NSpellInstance;
}
