import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Keyboard,
  Moon,
  MousePointer2,
  PaintBucket,
  Palette,
  SlidersHorizontal,
  SpellCheck,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  SpellcheckLanguage,
  ThemePreset,
} from '../../types/whiteboard';
import {
  loadSettingsOpenSections,
  saveSettingsOpenSections,
} from '../../services/storageService';
import {
  buildCursorSvg,
  getContrastCanvasCursor,
  getThemeCursorPalette,
} from '../../utils/canvasCursor';
import {
  loadPersonalDictionary,
  removePersonalWord,
  setRememberedTextLang,
  subscribePersonalDictionary,
} from '../../utils/spellcheck/personalDictionary';
import { getEffectiveBoardColors } from '../../utils/themePalette';
import { CanvasColorPickerControl } from '../CanvasColorPickerControl';
import { APP_VERSION } from '../../version';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onClose: () => void;
}

// Identificadores estables de las 6 secciones plegables del panel de configuración
type SettingsSectionId =
  | 'appearance'
  | 'canvas-bg'
  | 'cursor'
  | 'preferences'
  | 'spellcheck'
  | 'shortcuts';

const ALL_SECTION_IDS: SettingsSectionId[] = [
  'appearance',
  'canvas-bg',
  'cursor',
  'preferences',
  'spellcheck',
  'shortcuts',
];

const THEME_OPTIONS: {
  id: ThemePreset;
  name: string;
  subtitle: string;
  swatches: [string, string, string];
}[] = [
  {
    id: 'light',
    name: 'Claro',
    subtitle: 'Blanco y azul clásico',
    swatches: ['#ffffff', '#cbd5e1', '#2563eb'],
  },
  {
    id: 'dark',
    name: 'Oscuro',
    subtitle: 'Pizarra nocturna',
    swatches: ['#0f172a', '#334155', '#3b82f6'],
  },
  {
    id: 'warm',
    name: 'Cálida',
    subtitle: 'Rojo, naranja y amarillo',
    swatches: ['#dc2626', '#ea580c', '#facc15'],
  },
  {
    id: 'cool',
    name: 'Fría',
    subtitle: 'Azul, gris y morado',
    swatches: ['#2563eb', '#64748b', '#7c3aed'],
  },
  {
    id: 'nature',
    name: 'Natura',
    subtitle: 'Verde y amarillo',
    swatches: ['#15803d', '#65a30d', '#facc15'],
  },
  {
    id: 'blueprint',
    name: 'Plano',
    subtitle: 'Azul de plano técnico',
    swatches: ['#0B2A4A', '#1E5A8C', '#4FD1E8'],
  },
  {
    id: 'sepia',
    name: 'Sepia',
    subtitle: 'Papel antiguo y tinta',
    swatches: ['#F3E7D3', '#8B5E3C', '#C2410C'],
  },
  {
    id: 'neon',
    name: 'Neón',
    subtitle: 'Magenta y cian brillante',
    swatches: ['#12001F', '#D946EF', '#22D3EE'],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    subtitle: 'Obsidiana, esmeralda y oro',
    swatches: ['#061613', '#10B981', '#FBBF24'],
  },
];

const SHORTCUTS = [
  ['V', 'Herramienta Selección'],
  ['H / Espacio', 'Mano / Desplazar lienzo'],
  ['P', 'Lápiz a mano alzada'],
  ['E', 'Borrador de trazos'],
  ['T', 'Cuadro de texto'],
  ['S', 'Figuras geométricas'],
  ['L', 'Líneas y conectores'],
  ['C', 'Cortar / Recortar'],
  ['M', 'Insertar ecuación matemática'],
  ['G', 'Insertar gráfica cartesiana'],
  ['N', 'Insertar nota adhesiva'],
  ['Ctrl + Z / Ctrl + Y', 'Deshacer / Rehacer'],
  ['Ctrl + C / X / V', 'Copiar / Cortar / Pegar'],
  ['Ctrl + D', 'Duplicar selección'],
  ['Ctrl + G / Ctrl + Shift + G', 'Agrupar / Desagrupar'],
  ['Ctrl + .', 'Modo de trabajo limpio'],
  ['Ctrl + A', 'Seleccionar todos los objetos'],
  ['Ctrl + S', 'Guardar proyecto en disco'],
  ['Ctrl + + / - / 0', 'Zoom acercar / alejar / 100%'],
  ['Supr / Retroceso', 'Eliminar selección'],
];

const CURSOR_SIZE_PRESETS = [
  { label: 'Pequeño', size: 22 },
  { label: 'Normal', size: 28 },
  { label: 'Grande', size: 36 },
  { label: 'Muy grande', size: 44 },
];

const CURSOR_COLOR_SWATCHES = [
  { hex: '#1d4ed8', label: 'Azul intenso' },
  { hex: '#dc2626', label: 'Rojo' },
  { hex: '#0f766e', label: 'Turquesa' },
  { hex: '#ea580c', label: 'Naranja' },
  { hex: '#db2777', label: 'Fucsia' },
  { hex: '#7c3aed', label: 'Morado' },
  { hex: '#15803d', label: 'Verde' },
  { hex: '#facc15', label: 'Amarillo' },
  { hex: '#0f172a', label: 'Negro tinta' },
];

interface AccordionSectionProps {
  id: SettingsSectionId;
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: SettingsSectionId) => void;
  onReset?: () => void;
  sectionRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}

// Componente de sección plegable accesible con transición suave (200 ms) y botón independiente de restablecimiento
const SettingsAccordionSection: React.FC<AccordionSectionProps> = ({
  id,
  title,
  icon,
  isOpen,
  onToggle,
  onReset,
  sectionRef,
  children,
}) => {
  const headerBtnId = `settings-acc-header-${id}`;
  const panelId = `settings-acc-panel-${id}`;

  return (
    <div
      ref={sectionRef}
      data-settings-section={id}
      className="rounded-xl border theme-border overflow-hidden transition-colors"
    >
      {/* Cabecera interactiva: el botón de expansión y el de Restablecer son hermanos para evitar colapsar al restablecer */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 theme-surface-alt">
        <button
          id={headerBtnId}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
          className="flex-1 flex items-center justify-between gap-2 text-left rounded-md py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="opacity-75 shrink-0">{icon}</span>
            <span className="text-xs font-semibold uppercase tracking-wider opacity-85 truncate">
              {title}
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 opacity-70 shrink-0 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {onReset && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border theme-border theme-surface hover:bg-black/5 dark:hover:bg-white/10 shrink-0 transition-colors"
          >
            Restablecer
          </button>
        )}
      </div>

      {/* Cuerpo colapsable animado con CSS Grid (0fr <-> 1fr) y opacidad en ~200ms */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerBtnId}
        aria-hidden={!isOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          isOpen
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0 invisible pointer-events-none'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="p-3.5 border-t theme-border">{children}</div>
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onClose,
}) => {
  // Estado persistente de secciones abiertas: por defecto solo la primera ("appearance")
  const [openSections, setOpenSections] = useState<SettingsSectionId[]>(() => {
    const saved = loadSettingsOpenSections(ALL_SECTION_IDS, ['appearance']);
    return saved as SettingsSectionId[];
  });

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<SettingsSectionId, HTMLDivElement | null>>>({});

  // Lista reactiva del diccionario personal compartido entre proyectos
  const [personalWords, setPersonalWords] = useState<string[]>(() =>
    loadPersonalDictionary()
  );

  // Persiste el conjunto de secciones desplegadas ante cada cambio
  useEffect(() => {
    saveSettingsOpenSections(openSections);
  }, [openSections]);

  // Se suscribe a altas y bajas del diccionario personal (incluso desde el menú contextual)
  useEffect(() => {
    setPersonalWords(loadPersonalDictionary());
    return subscribePersonalDictionary((words) => {
      setPersonalWords(words);
    });
  }, []);

  // Calcula la paleta del lienzo combinando tema + color de fondo independiente
  const boardPalette = getEffectiveBoardColors(
    settings.theme,
    settings.canvasBgMode,
    settings.canvasBgCustomColor
  );
  const effectivePalette = getThemeCursorPalette(
    settings.theme,
    settings.cursorColor,
    boardPalette.isDarkSurface
  );
  const pickerHex =
    settings.cursorColor === 'auto' ? effectivePalette.fill : settings.cursorColor;
  const pointerPreview = buildCursorSvg(
    settings.theme,
    'default',
    settings.cursorSize,
    settings.cursorColor,
    boardPalette.isDarkSurface
  );
  const crosshairPreview = buildCursorSvg(
    settings.theme,
    'crosshair',
    settings.cursorSize,
    settings.cursorColor,
    boardPalette.isDarkSurface
  );
  const livePreviewCursor = getContrastCanvasCursor(
    settings.theme,
    'default',
    settings.cursorSize,
    settings.cursorColor,
    boardPalette.isDarkSurface
  );

  // Desplaza suavemente la vista interna del modal si la sección abierta queda fuera del área visible
  const ensureSectionVisibleInScroll = (id: SettingsSectionId) => {
    window.setTimeout(() => {
      const container = scrollContainerRef.current;
      const el = sectionRefs.current[id];
      if (!container || !el) return;

      const cRect = container.getBoundingClientRect();
      const sRect = el.getBoundingClientRect();
      const bottomOverflow = sRect.bottom - cRect.bottom;
      const topOverflow = cRect.top - sRect.top;

      if (topOverflow > 0) {
        container.scrollBy({ top: -topOverflow - 12, behavior: 'smooth' });
      } else if (bottomOverflow > 0) {
        // Si la sección es más alta que el contenedor, alinea arriba; si cabe, ajusta lo mínimo para mostrarla
        const delta =
          sRect.height > cRect.height - 16
            ? sRect.top - cRect.top - 12
            : bottomOverflow + 14;
        container.scrollBy({ top: delta, behavior: 'smooth' });
      }
    }, 180);
  };

  // Alterna apertura/cierre de una sección sin cerrar las demás (multi-apertura)
  const toggleSection = (id: SettingsSectionId) => {
    const willOpen = !openSections.includes(id);
    setOpenSections((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
    if (willOpen) {
      ensureSectionVisibleInScroll(id);
    }
  };

  const allOpen = openSections.length === ALL_SECTION_IDS.length;
  const allCollapsed = openSections.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-2xl theme-surface border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b theme-border theme-surface-alt">
          <h2 className="text-base font-semibold">
            Configuración y personalización
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración"
            className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra superior de acciones rápidas para el acordeón */}
        <div className="flex items-center justify-between px-5 py-2 border-b theme-border text-[11px]">
          <span className="opacity-70">
            {openSections.length} de {ALL_SECTION_IDS.length} secciones abiertas
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={allOpen}
              onClick={() => setOpenSections([...ALL_SECTION_IDS])}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Expandir todo
            </button>
            <span className="opacity-35">/</span>
            <button
              type="button"
              disabled={allCollapsed}
              onClick={() => setOpenSections([])}
              className="font-medium underline-offset-2 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Contraer todo
            </button>
          </div>
        </div>

        <div ref={scrollContainerRef} className="p-5 overflow-y-auto panel-scroll space-y-3">
          {/* 1. Personalización de apariencia */}
          <SettingsAccordionSection
            id="appearance"
            title="Personalización de apariencia"
            icon={<Palette className="w-4 h-4" />}
            isOpen={openSections.includes('appearance')}
            onToggle={toggleSection}
            onReset={() => onUpdateSettings({ ...settings, theme: 'light' })}
            sectionRef={(el) => {
              sectionRefs.current.appearance = el;
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {THEME_OPTIONS.map((opt) => {
                const isSelected = settings.theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ ...settings, theme: opt.id })}
                    className={`relative flex flex-col gap-2 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'theme-accent-soft border-current ring-2 ring-current/40'
                        : 'theme-border hover:bg-black/5 dark:hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {opt.id === 'light' ? (
                          <Sun className="w-3.5 h-3.5" />
                        ) : opt.id === 'dark' ? (
                          <Moon className="w-3.5 h-3.5" />
                        ) : (
                          <Palette className="w-3.5 h-3.5" />
                        )}
                        <span className="text-xs font-semibold">{opt.name}</span>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {opt.swatches.map((hex, i) => (
                        <span
                          key={i}
                          className="w-6 h-4 rounded border border-black/15"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>

                    <span className="text-[11px] opacity-75 leading-tight">
                      {opt.subtitle}
                    </span>
                  </button>
                );
              })}
            </div>
          </SettingsAccordionSection>

          {/* 2. Color del lienzo (sincronizado con Propiedades) */}
          <SettingsAccordionSection
            id="canvas-bg"
            title="Color del lienzo"
            icon={<PaintBucket className="w-4 h-4" />}
            isOpen={openSections.includes('canvas-bg')}
            onToggle={toggleSection}
            onReset={() =>
              onUpdateSettings({
                ...settings,
                canvasBgMode: 'auto',
                canvasBgCustomColor: '#ffffff',
                adaptStrokeColorsToCanvasBg: false,
              })
            }
            sectionRef={(el) => {
              sectionRefs.current['canvas-bg'] = el;
            }}
          >
            <CanvasColorPickerControl
              theme={settings.theme}
              mode={settings.canvasBgMode}
              customColor={settings.canvasBgCustomColor}
              adaptStrokeColors={settings.adaptStrokeColorsToCanvasBg}
              onChangeMode={(canvasBgMode) =>
                onUpdateSettings({ ...settings, canvasBgMode })
              }
              onChangeCustomColor={(canvasBgCustomColor) =>
                onUpdateSettings({
                  ...settings,
                  canvasBgMode: 'custom',
                  canvasBgCustomColor,
                })
              }
              onChangeAdaptStrokeColors={(adaptStrokeColorsToCanvasBg) =>
                onUpdateSettings({ ...settings, adaptStrokeColorsToCanvasBg })
              }
            />
          </SettingsAccordionSection>

          {/* 3. Cursor en el área de la pizarra */}
          <SettingsAccordionSection
            id="cursor"
            title="Cursor en el área de la pizarra"
            icon={<MousePointer2 className="w-4 h-4" />}
            isOpen={openSections.includes('cursor')}
            onToggle={toggleSection}
            onReset={() =>
              onUpdateSettings({
                ...settings,
                cursorSize: 28,
                cursorColor: 'auto',
              })
            }
            sectionRef={(el) => {
              sectionRefs.current.cursor = el;
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-[1fr_196px] gap-4 items-stretch">
              <div className="space-y-3.5 rounded-xl border theme-border theme-surface-alt p-3.5">
                {/* Cursor Size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Tamaño del cursor</span>
                    <span className="font-mono-tabular px-2 py-0.5 rounded theme-surface border theme-border text-[11px]">
                      {settings.cursorSize} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={48}
                    step={2}
                    value={settings.cursorSize}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        cursorSize: Number(e.target.value),
                      })
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {CURSOR_SIZE_PRESETS.map((preset) => {
                      const active = settings.cursorSize === preset.size;
                      return (
                        <button
                          key={preset.size}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({ ...settings, cursorSize: preset.size })
                          }
                          className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                            active
                              ? 'theme-accent-soft border-current ring-1 ring-current/40'
                              : 'theme-surface theme-border hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cursor Color */}
                <div className="space-y-2 pt-2 border-t theme-border">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Color del cursor</span>
                    <span className="text-[11px] opacity-75">
                      {settings.cursorColor === 'auto'
                        ? 'Automático por fondo'
                        : pickerHex.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({ ...settings, cursorColor: 'auto' })
                      }
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                        settings.cursorColor === 'auto'
                          ? 'theme-accent-soft border-current ring-1 ring-current/40'
                          : 'theme-surface theme-border hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      Automático
                    </button>

                    {CURSOR_COLOR_SWATCHES.map((swatch) => {
                      const isActive =
                        settings.cursorColor.toLowerCase() === swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.hex}
                          type="button"
                          title={swatch.label}
                          aria-label={swatch.label}
                          onClick={() =>
                            onUpdateSettings({ ...settings, cursorColor: swatch.hex })
                          }
                          className={`w-6 h-6 rounded-full border transition-transform flex items-center justify-center ${
                            isActive
                              ? 'scale-110 ring-2 ring-offset-1 ring-slate-900 dark:ring-white border-white'
                              : 'border-black/20 hover:scale-105'
                          }`}
                          style={{ backgroundColor: swatch.hex }}
                        >
                          {isActive && (
                            <Check
                              className="w-3 h-3"
                              style={{
                                color:
                                  swatch.hex === '#facc15' ? '#0f172a' : '#ffffff',
                              }}
                            />
                          )}
                        </button>
                      );
                    })}

                    <label
                      title="Elegir color personalizado"
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg border theme-border theme-surface cursor-pointer text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <input
                        type="color"
                        value={pickerHex}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...settings,
                            cursorColor: e.target.value,
                          })
                        }
                        className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer"
                      />
                      <span>Otro</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Live Whiteboard Cursor Preview con el color de lienzo efectivo */}
              <div
                style={{
                  cursor: livePreviewCursor,
                  backgroundColor: boardPalette.boardBg,
                  color: boardPalette.axisText,
                  backgroundImage: `linear-gradient(to right, ${boardPalette.gridStroke} 1px, transparent 1px), linear-gradient(to bottom, ${boardPalette.gridStroke} 1px, transparent 1px)`,
                  backgroundSize: '20px 20px',
                }}
                className="rounded-xl border theme-border p-3 flex flex-col items-center justify-between min-h-[140px] shadow-inner select-none"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-85">
                  Vista previa en pizarra
                </span>

                <div className="flex items-center justify-center gap-5 my-2">
                  <img
                    src={`data:image/svg+xml,${encodeURIComponent(
                      pointerPreview.svg.trim().replace(/\s+/g, ' ')
                    )}`}
                    width={settings.cursorSize}
                    height={settings.cursorSize}
                    alt="Vista previa puntero"
                    className="pointer-events-none"
                  />
                  <img
                    src={`data:image/svg+xml,${encodeURIComponent(
                      crosshairPreview.svg.trim().replace(/\s+/g, ' ')
                    )}`}
                    width={settings.cursorSize}
                    height={settings.cursorSize}
                    alt="Vista previa mira de dibujo"
                    className="pointer-events-none"
                  />
                </div>

                <span className="text-[10px] opacity-80 text-center">
                  Pasa el ratón aquí para probar
                </span>
              </div>
            </div>
          </SettingsAccordionSection>

          {/* 4. Preferencias de trabajo */}
          <SettingsAccordionSection
            id="preferences"
            title="Preferencias de trabajo"
            icon={<SlidersHorizontal className="w-4 h-4" />}
            isOpen={openSections.includes('preferences')}
            onToggle={toggleSection}
            onReset={() =>
              onUpdateSettings({
                ...settings,
                autoSaveEnabled: true,
                autoSaveIntervalSec: 12,
                pressureSensitivity: true,
                defaultGridSize: 28,
                wheelScrollSheets: true,
              })
            }
            sectionRef={(el) => {
              sectionRefs.current.preferences = el;
            }}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between py-2 border-b theme-border">
                <div>
                  <div className="text-sm font-medium">
                    Guardado automático local
                  </div>
                  <div className="text-xs opacity-70">
                    Guarda cambios periódicamente sin conexión
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={settings.autoSaveIntervalSec}
                    disabled={!settings.autoSaveEnabled}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        autoSaveIntervalSec: Number(e.target.value),
                      })
                    }
                    className="rounded border theme-border theme-surface px-2 py-1 text-xs"
                  >
                    <option value={5}>Cada 5 s</option>
                    <option value={12}>Cada 12 s</option>
                    <option value={30}>Cada 30 s</option>
                    <option value={60}>Cada 60 s</option>
                  </select>
                  <input
                    type="checkbox"
                    checked={settings.autoSaveEnabled}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, autoSaveEnabled: e.target.checked })
                    }
                    className="w-4 h-4 accent-blue-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-b theme-border">
                <div>
                  <div className="text-sm font-medium">
                    Sensibilidad a presión (lápiz digital / stylus)
                  </div>
                  <div className="text-xs opacity-70">
                    Modula el grosor del trazo según la presión aplicada
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.pressureSensitivity}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, pressureSensitivity: e.target.checked })
                  }
                  className="w-4 h-4 accent-blue-600"
                />
              </div>

              <div className="flex items-center justify-between py-2 border-b theme-border">
                <div>
                  <div className="text-sm font-medium">
                    Tamaño base de cuadrícula
                  </div>
                  <div className="text-xs opacity-70">
                    Espaciado en píxeles para nuevos tableros
                  </div>
                </div>
                <input
                  type="number"
                  min={12}
                  max={80}
                  value={settings.defaultGridSize}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      defaultGridSize: Math.max(12, Math.min(80, Number(e.target.value))),
                    })
                  }
                  className="w-20 rounded border theme-border theme-surface px-2.5 py-1 text-xs font-mono-tabular"
                />
              </div>

              <div className="flex items-center justify-between py-2 gap-3">
                <div>
                  <div className="text-sm font-medium">
                    Rueda del ratón en hojas: desplazar (Ctrl para zoom)
                  </div>
                  <div className="text-xs opacity-70">
                    En hojas de tamaño fijo, la rueda desplaza verticalmente; desactívalo para hacer zoom directo
                  </div>
                </div>
                <input
                  type="checkbox"
                  aria-label="Rueda del ratón en hojas: desplazar (Ctrl para zoom)"
                  checked={settings.wheelScrollSheets ?? true}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, wheelScrollSheets: e.target.checked })
                  }
                  className="w-4 h-4 accent-blue-600 shrink-0"
                />
              </div>
            </div>
          </SettingsAccordionSection>

          {/* 5. Corrector ortográfico */}
          <SettingsAccordionSection
            id="spellcheck"
            title="Corrector ortográfico"
            icon={<SpellCheck className="w-4 h-4" />}
            isOpen={openSections.includes('spellcheck')}
            onToggle={toggleSection}
            onReset={() => {
              setRememberedTextLang('es');
              onUpdateSettings({
                ...settings,
                spellcheckEnabled: true,
                spellcheckDefaultLang: 'es',
              });
            }}
            sectionRef={(el) => {
              sectionRefs.current.spellcheck = el;
            }}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between py-1.5 border-b theme-border">
                <div>
                  <div className="text-sm font-medium">
                    Activar corrector ortográfico
                  </div>
                  <div className="text-xs opacity-70">
                    Subraya palabras desconocidas durante la edición de cuadros de texto
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.spellcheckEnabled}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      spellcheckEnabled: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-blue-600"
                />
              </div>

              <div className="flex items-center justify-between py-1.5 border-b theme-border">
                <div>
                  <div className="text-sm font-medium">
                    Idioma predeterminado
                  </div>
                  <div className="text-xs opacity-70">
                    Se aplica a los cuadros de texto sin idioma personalizado
                  </div>
                </div>
                <select
                  value={settings.spellcheckDefaultLang}
                  onChange={(e) => {
                    const nextLang = e.target.value as SpellcheckLanguage;
                    setRememberedTextLang(nextLang);
                    onUpdateSettings({
                      ...settings,
                      spellcheckDefaultLang: nextLang,
                    });
                  }}
                  className="rounded border theme-border theme-surface px-2.5 py-1 text-xs"
                >
                  <option value="es">Español (ES)</option>
                  <option value="es-MX">Español (México)</option>
                  <option value="en-US">Inglés (EE. UU.)</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      Diccionario personal
                    </div>
                    <div className="text-xs opacity-70">
                      Palabras añadidas por ti (compartidas entre todos tus proyectos)
                    </div>
                  </div>
                  <span className="text-[11px] font-mono-tabular opacity-70">
                    {personalWords.length}{' '}
                    {personalWords.length === 1 ? 'palabra' : 'palabras'}
                  </span>
                </div>

                {personalWords.length === 0 ? (
                  <div className="px-3 py-2.5 rounded-lg border border-dashed theme-border text-xs opacity-65 text-center">
                    No hay palabras en tu diccionario personal. Haz clic derecho sobre
                    una palabra subrayada y elige «Agregar al diccionario».
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-lg border theme-border divide-y theme-border">
                    {personalWords.map((word) => (
                      <div
                        key={word}
                        className="flex items-center justify-between px-3 py-1.5 text-xs theme-surface"
                      >
                        <span className="font-medium truncate mr-2">{word}</span>
                        <button
                          type="button"
                          onClick={() => removePersonalWord(word)}
                          title={`Eliminar "${word}" del diccionario personal`}
                          aria-label={`Eliminar "${word}" del diccionario personal`}
                          className="p-1 rounded hover:bg-red-500/15 text-red-600 dark:text-red-400 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SettingsAccordionSection>

          {/* 6. Atajos de teclado */}
          <SettingsAccordionSection
            id="shortcuts"
            title="Atajos de teclado"
            icon={<Keyboard className="w-4 h-4" />}
            isOpen={openSections.includes('shortcuts')}
            onToggle={toggleSection}
            sectionRef={(el) => {
              sectionRefs.current.shortcuts = el;
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SHORTCUTS.map(([keys, desc]) => (
                <div
                  key={keys}
                  className="flex items-center justify-between px-3 py-1.5 rounded theme-surface-alt border theme-border text-xs"
                >
                  <span className="opacity-85">{desc}</span>
                  <kbd className="px-1.5 py-0.5 rounded theme-surface border theme-border font-mono-tabular text-[11px] whitespace-nowrap ml-2">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </SettingsAccordionSection>
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t theme-border theme-surface-alt">
          <span className="text-[11px] font-mono-tabular opacity-65">
            Ábaco Pizarra Virtual · Versión {APP_VERSION}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium theme-accent-btn rounded-lg whitespace-nowrap"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
};

