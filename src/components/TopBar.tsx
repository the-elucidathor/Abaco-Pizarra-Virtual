import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Crop,
  Download,
  FileText,
  FolderOpen,
  Redo2,
  Save,
  Settings,
  Undo2,
} from 'lucide-react';
import type { BackgroundPattern, ToolId } from '../types/whiteboard';
import type { CadCommandId } from '../types/cad';
import { APP_VERSION } from '../version';

interface TopBarProps {
  projectName: string;
  onRenameProject: (name: string) => void;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  canUndo: boolean;
  canRedo: boolean;
  backgroundPattern: BackgroundPattern;
  showCoordinates: boolean;
  snapToGrid: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomBarsCollapsed: boolean;
  autoTransparentPanels: boolean;
  cleanWorkMode: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSaveNow: () => void;
  onNewProject: () => void;
  onOpenProjectManager: () => void;
  onOpenFilePizarra: () => void;
  onDownloadPizarra: () => void;
  onImportExternalFile: () => void;
  onOpenExport: () => void;
  onStartAreaExport: () => void;
  onDownloadManual: () => void;
  onOpenSettings: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onSelectAll: () => void;
  onDeleteSelection: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitContent: () => void;
  onToggleFullscreen: () => void;
  onSetBackground: (pattern: BackgroundPattern) => void;
  onToggleCoordinates: () => void;
  onToggleSnapToGrid: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  onToggleBottomBars: () => void;
  onToggleAutoTransparentPanels: () => void;
  onToggleCleanWorkMode: () => void;
  onSelectTool: (tool: ToolId) => void;
  onStartCadCommand: (cmd: CadCommandId) => void;
  onJoinSegments: () => void;
  onInsertEquation: () => void;
  onInsertGraph: () => void;
  onInsertSticky: () => void;
  onInsertText: () => void;
}

type MenuKey = 'archivo' | 'editar' | 'ver' | 'insertar' | 'herramientas' | null;

// OPT: 2.6 — Evita re-renderizar la barra superior ante movimientos de puntero o cambios de zoom
export const TopBar: React.FC<TopBarProps> = React.memo((props) => {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(props.projectName);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftName(props.projectName);
  }, [props.projectName]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const runAndClose = (fn: () => void) => {
    setOpenMenu(null);
    fn();
  };

  const commitProjectName = () => {
    setEditingName(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== props.projectName) {
      props.onRenameProject(trimmed);
    } else {
      setDraftName(props.projectName);
    }
  };

  const menuItemCls =
    'w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-between gap-4 whitespace-nowrap';

  return (
    <header
      ref={menuContainerRef}
      className="no-print h-12 px-3 theme-surface border-b flex items-center justify-between gap-4 select-none shrink-0 z-30"
    >
      {/* Left: Brand & Project Name + Menus */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={props.onOpenProjectManager}
          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
          title="Gestor de proyectos locales"
        >
          <span className="w-6 h-6 rounded-md theme-accent-btn text-xs font-bold flex items-center justify-center shrink-0">
            Á
          </span>
          <span className="text-sm font-bold tracking-tight whitespace-nowrap">
            Ábaco
          </span>
          <span className="text-[10px] font-mono-tabular opacity-55 whitespace-nowrap">
            v{APP_VERSION}
          </span>
        </button>

        <span className="opacity-30">/</span>

        {editingName ? (
          <input
            autoFocus
            type="text"
            aria-label="Nombre del proyecto"
            value={draftName}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitProjectName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitProjectName();
              if (e.key === 'Escape') {
                setDraftName(props.projectName);
                setEditingName(false);
              }
            }}
            className="top-project-badge-editing px-2.5 py-1.5 text-xs rounded-lg outline-none max-w-[160px] sm:max-w-[220px] xl:max-w-[260px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            title={`Nombre del proyecto: ${props.projectName} (clic para editar)`}
            aria-label={`Nombre del proyecto: ${props.projectName}. Clic para editar`}
            className="top-project-badge inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg min-w-0 max-w-[130px] sm:max-w-[200px] xl:max-w-[260px]"
          >
            <FileText className="hidden sm:block w-3.5 h-3.5 shrink-0 top-project-badge-icon" />
            <span className="truncate">{props.projectName}</span>
          </button>
        )}

        {/* Dropdown Menus */}
        <nav className="hidden lg:flex items-center gap-0.5 ml-1">
          {/* Archivo */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'archivo' ? null : 'archivo')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 whitespace-nowrap ${
                openMenu === 'archivo'
                  ? 'theme-surface-alt'
                  : 'opacity-85 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              Archivo
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === 'archivo' && (
              <div className="absolute left-0 top-full mt-1 w-60 theme-surface border rounded-lg shadow-lg py-1 z-50">
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onNewProject)}>
                  <span>Nuevo proyecto</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onOpenProjectManager)}
                >
                  <span>Gestor de proyectos locales...</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onOpenFilePizarra)}
                >
                  <span>Abrir archivo .pizarra...</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onSaveNow)}>
                  <span>Guardar ahora (crear versión)</span>
                  <span className="text-[10px] text-slate-400">Ctrl+S</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onDownloadPizarra)}
                >
                  <span>Guardar como archivo .pizarra</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onImportExternalFile)}
                >
                  <span>Importar imagen o documento...</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onOpenExport)}>
                  <span>Exportar a PDF / PNG / Imprimir...</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onStartAreaExport)}
                >
                  <span className="flex items-center gap-2">
                    <Crop className="w-3.5 h-3.5 opacity-80" />
                    <span>Exportar área</span>
                  </span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onDownloadManual)}
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 opacity-80" />
                    <span>Manual de usuario (PDF)...</span>
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Editar */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'editar' ? null : 'editar')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 whitespace-nowrap ${
                openMenu === 'editar'
                  ? 'theme-surface-alt'
                  : 'opacity-85 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              Editar
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === 'editar' && (
              <div className="absolute left-0 top-full mt-1 w-56 theme-surface border rounded-lg shadow-lg py-1 z-50">
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onUndo)}>
                  <span>Deshacer</span>
                  <span className="text-[10px] text-slate-400">Ctrl+Z</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onRedo)}>
                  <span>Rehacer</span>
                  <span className="text-[10px] text-slate-400">Ctrl+Y</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onCut)}>
                  <span>Cortar</span>
                  <span className="text-[10px] text-slate-400">Ctrl+X</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onCopy)}>
                  <span>Copiar</span>
                  <span className="text-[10px] text-slate-400">Ctrl+C</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onPaste)}>
                  <span>Pegar</span>
                  <span className="text-[10px] text-slate-400">Ctrl+V</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onDuplicate)}>
                  <span>Duplicar</span>
                  <span className="text-[10px] text-slate-400">Ctrl+D</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onGroup)}>
                  <span>Agrupar selección</span>
                  <span className="text-[10px] text-slate-400">Ctrl+G</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onUngroup)}>
                  <span>Desagrupar</span>
                  <span className="text-[10px] text-slate-400">Ctrl+Shift+G</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onSelectAll)}>
                  <span>Seleccionar todo</span>
                  <span className="text-[10px] text-slate-400">Ctrl+A</span>
                </button>
                <button
                  type="button"
                  className={`${menuItemCls} text-red-600 dark:text-red-400`}
                  onClick={() => runAndClose(props.onDeleteSelection)}
                >
                  <span>Eliminar selección</span>
                  <span className="text-[10px] opacity-70">Supr</span>
                </button>
              </div>
            )}
          </div>

          {/* Ver */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'ver' ? null : 'ver')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 whitespace-nowrap ${
                openMenu === 'ver'
                  ? 'theme-surface-alt'
                  : 'opacity-85 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              Ver
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === 'ver' && (
              <div className="absolute left-0 top-full mt-1 w-60 theme-surface border rounded-lg shadow-lg py-1 z-50">
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onZoomIn)}>
                  <span>Acercar zoom</span>
                  <span className="text-[10px] text-slate-400">Ctrl++</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onZoomOut)}>
                  <span>Alejar zoom</span>
                  <span className="text-[10px] text-slate-400">Ctrl+-</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onZoomReset)}>
                  <span>Restablecer 100%</span>
                  <span className="text-[10px] text-slate-400">Ctrl+0</span>
                </button>
                <button type="button" className={menuItemCls} onClick={() => runAndClose(props.onFitContent)}>
                  <span>Ajustar a todos los elementos</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase text-slate-400">
                  Fondo del lienzo
                </div>
                {(
                  [
                    ['blank', 'Blanco liso'],
                    ['grid', 'Cuadriculado'],
                    ['lined', 'Rayado'],
                    ['dotted', 'Punteado'],
                    ['isometric', 'Isométrico'],
                  ] as [BackgroundPattern, string][]
                ).map(([pat, label]) => (
                  <button
                    key={pat}
                    type="button"
                    className={menuItemCls}
                    onClick={() => runAndClose(() => props.onSetBackground(pat))}
                  >
                    <span>{label}</span>
                    {props.backgroundPattern === pat && (
                      <span className="text-blue-600 font-bold">✓</span>
                    )}
                  </button>
                ))}
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleCoordinates)}
                >
                  <span>Sistema de coordenadas en lienzo</span>
                  {props.showCoordinates && <span className="text-blue-600 font-bold">✓</span>}
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleSnapToGrid)}
                >
                  <span>Ajustar objetos a cuadrícula</span>
                  {props.snapToGrid && <span className="text-blue-600 font-bold">✓</span>}
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleLeftPanel)}
                >
                  <span>{props.leftCollapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral'}</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleRightPanel)}
                >
                  <span>{props.rightCollapsed ? 'Mostrar panel de propiedades' : 'Ocultar panel de propiedades'}</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleBottomBars)}
                >
                  <span>{props.bottomBarsCollapsed ? 'Mostrar barra inferior' : 'Ocultar barra inferior'}</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleAutoTransparentPanels)}
                >
                  <span>Transparencia automática</span>
                  {props.autoTransparentPanels && <span className="text-blue-600 font-bold">✓</span>}
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleCleanWorkMode)}
                >
                  <span>Modo de trabajo limpio</span>
                  <span className="flex items-center gap-1.5">
                    {props.cleanWorkMode && <span className="text-blue-600 font-bold">✓</span>}
                    <span className="text-[10px] text-slate-400">Ctrl+.</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onToggleFullscreen)}
                >
                  <span>Pantalla completa</span>
                  <span className="text-[10px] text-slate-400">F11</span>
                </button>
              </div>
            )}
          </div>

          {/* Insertar */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'insertar' ? null : 'insertar')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 whitespace-nowrap ${
                openMenu === 'insertar'
                  ? 'theme-surface-alt'
                  : 'opacity-85 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              Insertar
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === 'insertar' && (
              <div className="absolute left-0 top-full mt-1 w-60 theme-surface border rounded-lg shadow-lg py-1 z-50">
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onInsertEquation)}
                >
                  <span>Ecuación matemática (KaTeX)</span>
                  <span className="text-[10px] text-slate-400">M</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onInsertGraph)}
                >
                  <span>Plano cartesiano y gráfica</span>
                  <span className="text-[10px] text-slate-400">G</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onInsertText)}
                >
                  <span>Cuadro de texto</span>
                  <span className="text-[10px] text-slate-400">T</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onInsertSticky)}
                >
                  <span>Nota adhesiva</span>
                  <span className="text-[10px] text-slate-400">N</span>
                </button>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onImportExternalFile)}
                >
                  <span>Imagen (PNG, JPG, SVG)...</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onImportExternalFile)}
                >
                  <span>Documento (PDF, DOCX, XLSX, TXT)...</span>
                </button>
              </div>
            )}
          </div>

          {/* Herramientas */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpenMenu(openMenu === 'herramientas' ? null : 'herramientas')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md flex items-center gap-1 whitespace-nowrap ${
                openMenu === 'herramientas'
                  ? 'theme-surface-alt'
                  : 'opacity-85 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              Herramientas
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {openMenu === 'herramientas' && (
              <div className="absolute left-0 top-full mt-1 w-64 max-h-[76vh] overflow-y-auto panel-scroll theme-surface border rounded-lg shadow-lg py-1 z-50">
                {(
                  [
                    ['select', 'Selección', 'V'],
                    ['hand', 'Mano (Desplazar)', 'H'],
                    ['pen', 'Lápiz a mano alzada', 'P'],
                    ['eraser', 'Borrador de trazos', 'E'],
                    ['text', 'Cuadro de texto', 'T'],
                    ['shape', 'Figuras geométricas', 'S'],
                    ['line', 'Líneas y conectores', 'L'],
                    ['cut', 'Cortar / Recortar', 'C'],
                  ] as [ToolId, string, string][]
                ).map(([toolId, label, key]) => (
                  <button
                    key={toolId}
                    type="button"
                    className={menuItemCls}
                    onClick={() => runAndClose(() => props.onSelectTool(toolId))}
                  >
                    <span>{label}</span>
                    <span className="text-[10px] opacity-60">{key}</span>
                  </button>
                ))}

                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase text-slate-400">
                  Edición geométrica
                </div>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(() => props.onStartCadCommand('mirror'))}
                >
                  <span>Simetría</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">SIM</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(() => props.onStartCadCommand('match-points'))}
                >
                  <span>Hacer coincidir puntos</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">CP</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onJoinSegments)}
                >
                  <span>Unir segmentos</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">UNI</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onGroup)}
                >
                  <span>Agrupar</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">AGR</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(props.onUngroup)}
                >
                  <span>Desagrupar</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">DES</span>
                </button>

                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase text-slate-400">
                  Matrices
                </div>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(() => props.onStartCadCommand('array-rect'))}
                >
                  <span>Matriz rectangular</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">MR</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(() => props.onStartCadCommand('array-polar'))}
                >
                  <span>Matriz polar</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">MP</span>
                </button>
                <button
                  type="button"
                  className={menuItemCls}
                  onClick={() => runAndClose(() => props.onStartCadCommand('array-path'))}
                >
                  <span>Matriz de camino</span>
                  <span className="text-[10px] font-mono-tabular opacity-60">MC</span>
                </button>

                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <div className="px-3 py-1 text-[10px] font-semibold uppercase text-slate-400">
                  Acotación
                </div>
                {(
                  [
                    ['dim-linear', 'Lineal', 'ACL'],
                    ['dim-aligned', 'Alineada', 'ACA'],
                    ['dim-angular', 'Angular', 'ANG'],
                    ['dim-radial', 'Radial', 'RAD'],
                    ['dim-diametral', 'Diametral', 'DIA'],
                    ['dim-ordinate', 'Por coordenadas', 'COR'],
                  ] as [CadCommandId, string, string][]
                ).map(([cmd, label, abbr]) => (
                  <button
                    key={cmd}
                    type="button"
                    className={menuItemCls}
                    onClick={() => runAndClose(() => props.onStartCadCommand(cmd))}
                  >
                    <span>{label}</span>
                    <span className="text-[10px] font-mono-tabular opacity-60">{abbr}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Configuración */}
          <button
            type="button"
            onClick={props.onOpenSettings}
            className="px-2.5 py-1 text-xs font-medium rounded-md opacity-85 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 whitespace-nowrap"
          >
            Configuración
          </button>
        </nav>
      </div>

      {/* Right: Quick Action Controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="hidden xl:inline text-[11px] opacity-65 mr-1 whitespace-nowrap">
          {props.saveStatus === 'saving'
            ? 'Guardando...'
            : props.saveStatus === 'unsaved'
            ? 'Cambios pendientes'
            : 'Guardado local'}
        </span>

        <div className="flex items-center border theme-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={props.onUndo}
            disabled={!props.canUndo}
            title="Deshacer (Ctrl+Z)"
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={props.onRedo}
            disabled={!props.canRedo}
            title="Rehacer (Ctrl+Y)"
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 border-l theme-border"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={props.onOpenProjectManager}
          title="Abrir o administrar proyectos locales"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border theme-border hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap shrink-0"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Proyectos</span>
        </button>

        <button
          type="button"
          onClick={props.onSaveNow}
          title="Guardar proyecto y crear versión (Ctrl+S)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border theme-border hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Guardar</span>
        </button>

        <button
          type="button"
          onClick={props.onStartAreaExport}
          title="Exportar un área específica de la pizarra"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border theme-border hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap shrink-0"
        >
          <Crop className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Exportar área</span>
        </button>

        <button
          type="button"
          onClick={props.onOpenExport}
          title="Exportar a PDF, PNG o imprimir"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium theme-accent-btn rounded-lg whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Exportar</span>
        </button>

        <button
          type="button"
          onClick={props.onDownloadManual}
          title="Descargar Manual de Usuario completo (PDF)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border theme-border hover:bg-black/5 dark:hover:bg-white/10 rounded-lg whitespace-nowrap shrink-0"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Manual PDF</span>
        </button>

        <button
          type="button"
          onClick={props.onOpenSettings}
          title="Configuración"
          className="lg:hidden p-1.5 rounded-lg border theme-border hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
});

