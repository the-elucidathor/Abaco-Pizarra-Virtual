import type { TextFontFamily } from '../types/whiteboard';

export const TEXT_FONT_OPTIONS: {
  id: TextFontFamily;
  label: string;
  css: string;
}[] = [
  { id: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { id: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  {
    id: 'comic-sans',
    label: 'Comic Sans',
    css: '"Comic Sans MS", "Comic Sans", cursive, sans-serif',
  },
  { id: 'tahoma', label: 'Tahoma', css: 'Tahoma, Geneva, Verdana, sans-serif' },
  { id: 'acme', label: 'Acme', css: '"Acme", sans-serif' },
  { id: 'alatsi', label: 'Alatsi', css: '"Alatsi", sans-serif' },
  { id: 'sans', label: 'Sans (Sistema)', css: 'var(--font-sans)' },
  { id: 'serif', label: 'Serif (Georgia)', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monoespacio', css: 'var(--font-mono)' },
];

export function normalizeTextFontFamily(raw: unknown): TextFontFamily {
  if (typeof raw === 'string' && TEXT_FONT_OPTIONS.some((f) => f.id === raw)) {
    return raw as TextFontFamily;
  }
  return 'sans';
}

export function getTextFontCss(fontFamily: TextFontFamily): string {
  return TEXT_FONT_OPTIONS.find((f) => f.id === fontFamily)?.css ?? 'var(--font-sans)';
}
