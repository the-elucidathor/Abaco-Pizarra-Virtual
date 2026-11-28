import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  GripVertical,
  Heading,
  Italic,
  Move,
  Plus,
  RotateCcw,
  Trash2,
  Underline,
} from 'lucide-react';
import type {
  RichTextParagraph,
  SpellcheckLanguage,
  TableObject,
  TextAlign,
} from '../../types/whiteboard';
import { normalizarContenidoTexto } from '../../utils/richText';
import {
  TABLE_COMPACT_MIN_COL_WIDTH,
  TABLE_COMPACT_MIN_ROW_HEIGHT,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  TABLE_MIN_ROW_HEIGHT,
  type TableCellCoord,
  addTableCol,
  addTableRow,
  applyFormattingToTableCells,
  clearTableCellsContent,
  getTableDefaultRunStyle,
  normalizarTabla,
  pasteTabularTextIntoTable,
  recomputeTableOuterSize,
  removeTableCol,
  removeTableRow,
  updateTableCellParagraphs,
} from '../../utils/tableUtils';
import { RichTextEditor, type RichTextEditorHandle, RichTextViewer } from '../RichTextEditor';

// Error Boundary dedicado por tabla: aísla fallos para mostrar un aviso discreto sin afectar la pizarra
interface TableErrorBoundaryProps {
  objectId: string;
  resetKey: string;
  onRepair: (id: string) => void;
  children: React.ReactNode;
}

interface TableErrorBoundaryState {
  hasError: boolean;
}

export class TableErrorBoundary extends Component<
  TableErrorBoundaryProps,
  TableErrorBoundaryState
> {
  state: TableErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): TableErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[Ábaco] Error aislado en tabla:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: TableErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full h-full min-h-[76px] rounded-md border border-amber-500/60 bg-amber-50/95 dark:bg-amber-950/90 text-amber-900 dark:text-amber-100 p-3 flex flex-col items-start justify-center gap-2 shadow-sm text-xs"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Error al mostrar esta tabla</span>
          </div>
          <p className="text-[11px] opacity-85">
            La tabla contiene datos incompatibles. El resto de la pizarra sigue operativa.
          </p>
          <button
            type="button"
            onClick={() => this.props.onRepair(this.props.objectId)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reparar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface TableNodeViewProps {
  obj: TableObject;
  isSelected: boolean;
  locked: boolean;
  zoom: number;
  isDarkSurface: boolean;
  spellcheckEnabled: boolean;
  defaultSpellcheckLang: SpellcheckLanguage;
  activeEditingCell: TableCellCoord | null;
  activeCellEditorRef?: React.RefObject<RichTextEditorHandle | null>;
  resolveDisplayColor: (color: string) => string;
  onSelectObject: () => void;
  onStartDragObject: (e: React.PointerEvent) => void;
  onSetEditingCell: (cell: TableCellCoord | null) => void;
  onUpdateTable: (nextTable: TableObject, recordHistory: boolean) => void;
  onCommitTableWithSnapshot: (snapshotBefore: TableObject, nextTable: TableObject) => void;
  onDeleteTable: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  dockBarBottom?: boolean;
}

// OPT: 2.6 — Vista interactiva de tabla memorizada cuando sus props no cambian
export const TableNodeView: React.FC<TableNodeViewProps> = React.memo(({
  obj,
  isSelected,
  locked,
  zoom,
  isDarkSurface,
  spellcheckEnabled,
  defaultSpellcheckLang,
  activeEditingCell,
  activeCellEditorRef,
  resolveDisplayColor,
  onSelectObject,
  onStartDragObject,
  onSetEditingCell,
  onUpdateTable,
  onCommitTableWithSnapshot,
  onDeleteTable,
  onUndo,
  onRedo,
  dockBarBottom = false,
}) => {
  // Normaliza antes de cada renderizado para blindar filas irregulares o datos incompletos
  const table = useMemo(() => normalizarTabla(obj), [obj]);

  const [anchorCell, setAnchorCell] = useState<TableCellCoord | null>(null);
  const [focusCell, setFocusCell] = useState<TableCellCoord | null>(null);
  const [isSelectingRange, setIsSelectingRange] = useState(false);

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const tableRef = useRef<TableObject>(table);
  tableRef.current = table;
  const activeEditingCellRef = useRef(activeEditingCell);
  activeEditingCellRef.current = activeEditingCell;

  // Limpia selección interna de celdas al deseleccionar el objeto tabla
  useEffect(() => {
    if (!isSelected) {
      setAnchorCell(null);
      setFocusCell(null);
      setIsSelectingRange(false);
    }
  }, [isSelected]);

  // Finaliza selección por arrastre de celdas al soltar el botón en cualquier lugar
  useEffect(() => {
    if (!isSelectingRange) return;
    const onUp = () => setIsSelectingRange(false);
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [isSelectingRange]);

  // V1.11.8-16: Sincroniza altura solo cuando el usuario escribe en una fila activa y el contenido supera la altura actual (sin bloquear el encogimiento compacto)
  const syncMeasuredRowHeights = useCallback(
    (targetRowIdx?: number) => {
      if (locked) return;
      const cur = tableRef.current;
      let changed = false;
      const nextHeights = cur.rowHeights.map((storedH, rIdx) => {
        if (targetRowIdx !== undefined && rIdx !== targetRowIdx) return storedH;
        const tr = rowRefs.current[rIdx];
        if (!tr) return storedH;
        const rowCells = cur.cells[rIdx] || [];
        const hasText = rowCells.some((c) => Boolean(c?.content?.trim()));
        if (!hasText) return storedH;
        const measured = Math.ceil(tr.getBoundingClientRect().height / Math.max(0.15, zoom));
        if (measured > storedH + 2 && storedH >= TABLE_MIN_ROW_HEIGHT) {
          changed = true;
          return measured;
        }
        return storedH;
      });
      if (changed) {
        onUpdateTable(
          recomputeTableOuterSize({
            ...cur,
            rowHeights: nextHeights,
          }),
          false
        );
      }
    },
    [locked, onUpdateTable, zoom]
  );

  // Calcula lista rectangular de celdas seleccionadas actualmente
  const selectedCells: TableCellCoord[] = useMemo(() => {
    if (activeEditingCell) return [activeEditingCell];
    if (!anchorCell) return [];
    const target = focusCell || anchorCell;
    const minR = Math.max(0, Math.min(anchorCell.r, target.r));
    const maxR = Math.min(table.rows - 1, Math.max(anchorCell.r, target.r));
    const minC = Math.max(0, Math.min(anchorCell.c, target.c));
    const maxC = Math.min(table.cols - 1, Math.max(anchorCell.c, target.c));
    const list: TableCellCoord[] = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        list.push({ r, c });
      }
    }
    return list;
  }, [activeEditingCell, anchorCell, focusCell, table.cols, table.rows]);

  const selectedCellSet = useMemo(
    () => new Set(selectedCells.map((pt) => `${pt.r}:${pt.c}`)),
    [selectedCells]
  );

  const primaryCell: TableCellCoord | null = activeEditingCell || anchorCell;
  const activeLang: SpellcheckLanguage = table.lang ?? defaultSpellcheckLang;

  // Paleta de tabla adaptada dinámicamente al tema activo y al color actual del lienzo
  const tableBg = isDarkSurface
    ? 'rgba(15, 23, 42, 0.82)'
    : 'rgba(255, 255, 255, 0.94)';
  const headerBg =
    table.headerFillColor ||
    (isDarkSurface ? 'rgba(37, 99, 235, 0.24)' : 'rgba(226, 232, 240, 0.86)');
  const borderColor =
    table.borderColor ||
    (isDarkSurface ? 'rgba(203, 213, 225, 0.34)' : 'rgba(15, 23, 42, 0.28)');

  const resolveCellTextColor = useCallback(
    (c: string) => resolveDisplayColor(c),
    [resolveDisplayColor]
  );

  // Arrastre para ajustar manualmente el ancho de una columna en coordenadas del mundo
  const startColResize = (e: React.PointerEvent, colIdx: number) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectObject();
    const startX = e.clientX;
    const snapshot = normalizarTabla(tableRef.current);
    const initialW = snapshot.colWidths[colIdx] ?? 120;

    const onMove = (ev: PointerEvent) => {
      const dxWorld = (ev.clientX - startX) / Math.max(0.15, zoom);
      const nextColWidths = [...snapshot.colWidths];
      nextColWidths[colIdx] = Math.max(
        TABLE_COMPACT_MIN_COL_WIDTH,
        Math.round(initialW + dxWorld)
      );
      onUpdateTable(
        recomputeTableOuterSize({
          ...tableRef.current,
          colWidths: nextColWidths,
        }),
        false
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onCommitTableWithSnapshot(snapshot, normalizarTabla(tableRef.current));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // V1.11.8-16: Arrastre para ajustar manualmente el alto de una fila hasta dimensiones compactas
  const startRowResize = (e: React.PointerEvent, rowIdx: number) => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectObject();
    const startY = e.clientY;
    const snapshot = normalizarTabla(tableRef.current);
    const initialH = snapshot.rowHeights[rowIdx] ?? 40;
    const minContentH = TABLE_COMPACT_MIN_ROW_HEIGHT;

    const onMove = (ev: PointerEvent) => {
      const dyWorld = (ev.clientY - startY) / Math.max(0.15, zoom);
      const nextRowHeights = [...snapshot.rowHeights];
      nextRowHeights[rowIdx] = Math.max(minContentH, Math.round(initialH + dyWorld));
      onUpdateTable(
        recomputeTableOuterSize({
          ...tableRef.current,
          rowHeights: nextRowHeights,
        }),
        false
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onCommitTableWithSnapshot(snapshot, normalizarTabla(tableRef.current));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Mueve la edición a otra celda concreta (y selecciona también su coordenada)
  const focusCellEditor = (r: number, c: number) => {
    const clampedR = Math.max(0, Math.min(tableRef.current.rows - 1, r));
    const clampedC = Math.max(0, Math.min(tableRef.current.cols - 1, c));
    const coord = { r: clampedR, c: clampedC };
    setAnchorCell(coord);
    setFocusCell(coord);
    onSetEditingCell(coord);
  };

  // Aplica negrita / cursiva / subrayado / color / alineación sobre celdas seleccionadas o celda en edición
  const handleQuickFormat = (opts: {
    stylePatch?: Partial<{ bold: boolean; italic: boolean; underline: boolean; color: string }>;
    align?: TextAlign;
    wholeColumn?: boolean;
  }) => {
    if (locked) return;
    // Si hay texto seleccionado dentro de una celda en edición activa, usa el editor enriquecido directamente
    if (activeEditingCell && activeCellEditorRef?.current && !opts.wholeColumn) {
      if (opts.stylePatch) {
        activeCellEditorRef.current.applyStyle(opts.stylePatch, { restoreFocus: true });
      }
      if (opts.align) {
        activeCellEditorRef.current.applyAlign(opts.align, { restoreFocus: true });
      }
      return;
    }

    let targets: TableCellCoord[] = [];
    if (opts.wholeColumn && primaryCell) {
      for (let r = 0; r < table.rows; r++) {
        targets.push({ r, c: primaryCell.c });
      }
    } else if (selectedCells.length > 0) {
      targets = selectedCells;
    } else {
      for (let r = 0; r < table.rows; r++) {
        for (let c = 0; c < table.cols; c++) {
          targets.push({ r, c });
        }
      }
    }

    onUpdateTable(
      applyFormattingToTableCells(table, targets, {
        stylePatch: opts.stylePatch,
        align: opts.align,
      }),
      true
    );
  };

  // Maneja navegación con Tab, Shift+Tab, Enter y flechas dentro de la celda activa
  const handleCellKeyDown = (
    r: number,
    c: number,
    e: React.KeyboardEvent<HTMLDivElement>,
    info: {
      atStart: boolean;
      atEnd: boolean;
      hasSelection: boolean;
      flush: () => RichTextParagraph[];
    }
  ): boolean => {
    const curTable = tableRef.current;

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const flushed = info.flush();
      const cellDefaults = getTableDefaultRunStyle(
        curTable,
        curTable.hasHeaderRow && r === 0
      );
      let updated = updateTableCellParagraphs(curTable, r, c, flushed, cellDefaults);

      if (e.shiftKey) {
        if (c > 0) {
          onUpdateTable(updated, false);
          focusCellEditor(r, c - 1);
        } else if (r > 0) {
          onUpdateTable(updated, false);
          focusCellEditor(r - 1, updated.cols - 1);
        }
        return true;
      }

      if (c + 1 < updated.cols) {
        onUpdateTable(updated, false);
        focusCellEditor(r, c + 1);
      } else if (r + 1 < updated.rows) {
        onUpdateTable(updated, false);
        focusCellEditor(r + 1, 0);
      } else if (updated.rows < TABLE_MAX_ROWS) {
        // Al pulsar Tab en la última celda agrega una fila nueva en un solo paso de deshacer y salta a ella
        updated = addTableRow(updated);
        onUpdateTable(updated, true);
        focusCellEditor(updated.rows - 1, 0);
      }
      return true;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const flushed = info.flush();
      const cellDefaults = getTableDefaultRunStyle(
        curTable,
        curTable.hasHeaderRow && r === 0
      );
      const updated = updateTableCellParagraphs(curTable, r, c, flushed, cellDefaults);
      onUpdateTable(updated, true);
      if (r + 1 < updated.rows) {
        focusCellEditor(r + 1, c);
      } else {
        onSetEditingCell(null);
      }
      return true;
    }

    if (e.key === 'ArrowLeft' && info.atStart && !info.hasSelection) {
      if (c > 0 || r > 0) {
        e.preventDefault();
        e.stopPropagation();
        info.flush();
        if (c > 0) focusCellEditor(r, c - 1);
        else focusCellEditor(r - 1, curTable.cols - 1);
        return true;
      }
    }

    if (e.key === 'ArrowRight' && info.atEnd && !info.hasSelection) {
      if (c + 1 < curTable.cols || r + 1 < curTable.rows) {
        e.preventDefault();
        e.stopPropagation();
        info.flush();
        if (c + 1 < curTable.cols) focusCellEditor(r, c + 1);
        else focusCellEditor(r + 1, 0);
        return true;
      }
    }

    if (e.key === 'ArrowUp' && info.atStart && !info.hasSelection && r > 0) {
      e.preventDefault();
      e.stopPropagation();
      info.flush();
      focusCellEditor(r - 1, c);
      return true;
    }

    if (e.key === 'ArrowDown' && info.atEnd && !info.hasSelection && r + 1 < curTable.rows) {
      e.preventDefault();
      e.stopPropagation();
      info.flush();
      focusCellEditor(r + 1, c);
      return true;
    }

    return false;
  };

  // Maneja borrado de contenido cuando hay varias celdas seleccionadas fuera del modo de escritura
  const handleContainerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (activeEditingCell) return;
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      selectedCells.length > 1 &&
      !locked
    ) {
      e.preventDefault();
      e.stopPropagation();
      onUpdateTable(clearTableCellsContent(table, selectedCells), true);
    }
  };

  const isOnLastCell =
    Boolean(activeEditingCell) &&
    activeEditingCell?.r === table.rows - 1 &&
    activeEditingCell?.c === table.cols - 1;

  // Coordenadas acumuladas para dibujar divisores interactivos sobre los bordes exactos de columnas y filas
  const colPositions: number[] = [];
  let accX = 0;
  for (let c = 0; c < table.cols; c++) {
    accX += table.colWidths[c] ?? 120;
    colPositions.push(accX);
  }

  return (
    <div
      tabIndex={isSelected ? 0 : -1}
      onKeyDown={handleContainerKeyDown}
      className="relative w-full h-full select-none outline-none"
      style={{ backgroundColor: tableBg }}
    >
      {/* Asidero superior izquierdo para arrastrar la tabla fácilmente incluso cuando está seleccionada */}
      {isSelected && !locked && (
        <div
          data-export-ignore="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            onSetEditingCell(null);
            onStartDragObject(e);
          }}
          title="Mover tabla"
          className="absolute -left-6 top-0 w-5 h-6 rounded-l border border-r-0 border-blue-600 bg-blue-600 text-white flex items-center justify-center cursor-grab active:cursor-grabbing shadow-xs z-30"
        >
          <GripVertical className="w-3 h-3" />
        </div>
      )}

      {/* Mini barra contextual de operaciones de tabla cuando está seleccionada */}
      {isSelected && !locked && (
        <div
          data-export-ignore="true"
          onPointerDown={(e) => e.stopPropagation()}
          className={`no-print absolute ${
            dockBarBottom ? 'top-full mt-2' : '-top-11'
          } left-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-700 shadow-xl z-40 whitespace-nowrap text-[11px] text-slate-800 dark:text-slate-100`}
        >
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onSetEditingCell(null);
              onStartDragObject(e);
            }}
            title="Arrastrar tabla"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing"
          >
            <Move className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            disabled={table.rows >= TABLE_MAX_ROWS}
            onClick={() => {
              const targetR = primaryCell ? primaryCell.r + 1 : table.rows;
              onUpdateTable(addTableRow(table, targetR), true);
            }}
            title="Agregar fila"
            className="px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 font-medium inline-flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" />
            Fila
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            disabled={table.rows <= 1}
            onClick={() => {
              const targetR = primaryCell ? primaryCell.r : table.rows - 1;
              onSetEditingCell(null);
              setAnchorCell(null);
              setFocusCell(null);
              onUpdateTable(removeTableRow(table, targetR), true);
            }}
            title="Eliminar fila actual"
            className="px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 disabled:opacity-40 font-medium"
          >
            -Fila
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            disabled={table.cols >= TABLE_MAX_COLS}
            onClick={() => {
              const targetC = primaryCell ? primaryCell.c + 1 : table.cols;
              onUpdateTable(addTableCol(table, targetC), true);
            }}
            title="Agregar columna"
            className="px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 font-medium inline-flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" />
            Col
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            disabled={table.cols <= 1}
            onClick={() => {
              const targetC = primaryCell ? primaryCell.c : table.cols - 1;
              onSetEditingCell(null);
              setAnchorCell(null);
              setFocusCell(null);
              onUpdateTable(removeTableCol(table, targetC), true);
            }}
            title="Eliminar columna actual"
            className="px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 disabled:opacity-40 font-medium"
          >
            -Col
          </button>

          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              onUpdateTable({ ...table, hasHeaderRow: !table.hasHeaderRow }, true)
            }
            title="Activar o desactivar fila de encabezado"
            className={`px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-medium ${
              table.hasHeaderRow
                ? 'bg-blue-600 text-white'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Heading className="w-3 h-3" />
            Encab.
          </button>

          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          {/* Formato rápido sobre la selección de texto en celda o rango de celdas */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleQuickFormat({ stylePatch: { bold: true } })}
            title="Negrita (Ctrl+B)"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Bold className="w-3 h-3" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleQuickFormat({ stylePatch: { italic: true } })}
            title="Cursiva (Ctrl+I)"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Italic className="w-3 h-3" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleQuickFormat({ stylePatch: { underline: true } })}
            title="Subrayado (Ctrl+U)"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Underline className="w-3 h-3" />
          </button>

          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />

          {/* Alineación de celda / selección (o Shift+clic para toda la columna) */}
          {(
            [
              ['left', AlignLeft, 'Alinear a la izquierda (Shift+clic: columna)'],
              ['center', AlignCenter, 'Centrar (Shift+clic: columna)'],
              ['right', AlignRight, 'Alinear a la derecha (Shift+clic: columna)'],
              ['justify', AlignJustify, 'Justificar (Shift+clic: columna)'],
            ] as const
          ).map(([al, Icon, tip]) => (
            <button
              key={al}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(ev) =>
                handleQuickFormat({ align: al, wholeColumn: ev.shiftKey })
              }
              title={tip}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Icon className="w-3 h-3" />
            </button>
          ))}

          {selectedCells.length > 1 && (
            <>
              <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  onUpdateTable(clearTableCellsContent(table, selectedCells), true)
                }
                title={`Vaciar contenido de ${selectedCells.length} celdas seleccionadas`}
                className="px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-0.5"
              >
                <Eraser className="w-3 h-3" />
                Vaciar
              </button>
            </>
          )}

          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDeleteTable}
            title="Eliminar tabla (Supr)"
            className="p-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Aviso discreto cuando el cursor está en la última celda indicando que Tab agrega una fila */}
      {isSelected && isOnLastCell && !locked && table.rows < TABLE_MAX_ROWS && (
        <div
          data-export-ignore="true"
          className="no-print absolute -bottom-6 right-0 px-2 py-0.5 rounded bg-slate-900/90 text-white text-[10px] shadow pointer-events-none whitespace-nowrap"
        >
          Pulsa Tab para agregar una fila nueva
        </div>
      )}

      {/* Estructura HTML de tabla con dimensiones exactas y escalado limpio para celdas compactas */}
      <table
        className="border-collapse table-fixed"
        style={{
          width: table.width,
          height: table.height,
          border: `1.5px solid ${borderColor}`,
        }}
      >
        <colgroup>
          {table.colWidths.map((w, cIdx) => (
            <col key={cIdx} style={{ width: w }} />
          ))}
        </colgroup>
        <tbody>
          {table.cells.map((row, rIdx) => {
            const isHeader = table.hasHeaderRow && rIdx === 0;
            const rowH = table.rowHeights[rIdx] ?? TABLE_COMPACT_MIN_ROW_HEIGHT;
            return (
              <tr
                key={rIdx}
                ref={(el) => {
                  rowRefs.current[rIdx] = el;
                }}
                style={{ height: rowH }}
              >
                {row.map((cell, cIdx) => {
                  const isEditingThisCell =
                    activeEditingCell?.r === rIdx && activeEditingCell?.c === cIdx;
                  const isCellInSelection = selectedCellSet.has(`${rIdx}:${cIdx}`);
                  const defaults = getTableDefaultRunStyle(table, isHeader);
                  const safeAlign = cell?.align || 'left';
                  const paragraphs = normalizarContenidoTexto(
                    cell?.paragraphs,
                    defaults,
                    safeAlign
                  );
                  const colW = table.colWidths[cIdx] ?? TABLE_COMPACT_MIN_COL_WIDTH;
                  const compactTight = rowH < 28 || colW < 48;
                  const compactScale = compactTight
                    ? Math.max(0.4, Math.min(1, rowH / 28, colW / 44))
                    : 1;

                  return (
                    <td
                      key={cell?.id || `${rIdx}-${cIdx}`}
                      onPointerDown={(e) => {
                        if (locked) return;
                        // Si la tabla no está seleccionada aún, deja que el clic inicial la seleccione/arrastre
                        if (!isSelected) return;
                        if (isEditingThisCell) {
                          e.stopPropagation();
                          return;
                        }
                        e.stopPropagation();
                        if (e.shiftKey && anchorCell) {
                          setFocusCell({ r: rIdx, c: cIdx });
                        } else {
                          onSetEditingCell(null);
                          setAnchorCell({ r: rIdx, c: cIdx });
                          setFocusCell({ r: rIdx, c: cIdx });
                          setIsSelectingRange(true);
                        }
                      }}
                      onPointerEnter={() => {
                        if (isSelectingRange && !locked) {
                          setFocusCell({ r: rIdx, c: cIdx });
                        }
                      }}
                      onDoubleClick={(e) => {
                        if (locked) return;
                        e.stopPropagation();
                        onSelectObject();
                        setAnchorCell({ r: rIdx, c: cIdx });
                        setFocusCell({ r: rIdx, c: cIdx });
                        onSetEditingCell({ r: rIdx, c: cIdx });
                      }}
                      className="relative align-top p-0"
                      style={{
                        border: `1px solid ${borderColor}`,
                        backgroundColor: isHeader ? headerBg : 'transparent',
                        height: rowH,
                      }}
                    >
                      {/* Resaltado de selección de celda excluido de exportaciones */}
                      {isSelected && isCellInSelection && !isEditingThisCell && (
                        <div
                          data-export-ignore="true"
                          className="pointer-events-none absolute inset-0 bg-blue-500/15 ring-1 ring-inset ring-blue-500 z-10"
                        />
                      )}

                      {isEditingThisCell ? (
                        <RichTextEditor
                          ref={activeCellEditorRef}
                          paragraphs={paragraphs}
                          defaults={defaults}
                          defaultAlign={safeAlign}
                          listStyle="none"
                          backgroundColor="transparent"
                          autoWidth={false}
                          compactCell
                          lang={activeLang}
                          spellcheckEnabled={spellcheckEnabled}
                          showToolbar={true}
                          showListControls={false}
                          showDoneButton={true}
                          autoFocus={true}
                          placeholderDefaultsToSelectAll={[]}
                          resolveColor={resolveCellTextColor}
                          onChangeLang={(nextLang) => {
                            onUpdateTable({ ...table, lang: nextLang }, true);
                          }}
                          onChangeParagraphs={(nextParas, recordHistory) => {
                            const updated = updateTableCellParagraphs(
                              tableRef.current,
                              rIdx,
                              cIdx,
                              nextParas,
                              defaults
                            );
                            onUpdateTable(updated, recordHistory);
                            requestAnimationFrame(() => syncMeasuredRowHeights(rIdx));
                          }}
                          onTableCellKeyDown={(ev, info) =>
                            handleCellKeyDown(rIdx, cIdx, ev, info)
                          }
                          onTablePaste={(plain, html) => {
                            const res = pasteTabularTextIntoTable(
                              tableRef.current,
                              rIdx,
                              cIdx,
                              plain,
                              html
                            );
                            if (!res) return false;
                            onUpdateTable(res.table, true);
                            onSetEditingCell(null);
                            setAnchorCell({ r: rIdx, c: cIdx });
                            setFocusCell({
                              r: Math.min(res.table.rows - 1, rIdx + res.matrix.length - 1),
                              c: Math.min(
                                res.table.cols - 1,
                                cIdx +
                                  Math.max(
                                    1,
                                    ...res.matrix.map((rowItems) => rowItems.length)
                                  ) -
                                  1
                              ),
                            });
                            return true;
                          }}
                          onUndo={onUndo}
                          onRedo={onRedo}
                          onFinish={() => onSetEditingCell(null)}
                        />
                      ) : (
                        <div
                          className="w-full overflow-hidden"
                          style={{ height: rowH, maxHeight: rowH }}
                        >
                          <RichTextViewer
                            paragraphs={paragraphs}
                            defaults={defaults}
                            defaultAlign={safeAlign}
                            listStyle="none"
                            backgroundColor="transparent"
                            autoWidth={false}
                            compactCell
                            compactTight={compactTight}
                            compactScale={compactScale}
                            resolveColor={resolveCellTextColor}
                          />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Divisores arrastrables de columnas (excluidos de exportación) */}
      {isSelected && !locked && (
        <div data-export-ignore="true" className="pointer-events-none absolute inset-0 z-20">
          {colPositions.map((xPos, colIdx) => (
            <div
              key={`col-res-${colIdx}`}
              onPointerDown={(e) => startColResize(e, colIdx)}
              title="Arrastrar para ajustar ancho de columna"
              style={{ left: xPos - 3, top: 0, width: 6, height: '100%' }}
              className="pointer-events-auto absolute cursor-col-resize hover:bg-blue-500/35 transition-colors"
            />
          ))}
          {rowRefs.current.slice(0, table.rows).map((_, rowIdx) => {
            const topPos =
              table.rowHeights
                .slice(0, rowIdx + 1)
                .reduce((a, b) => a + b, 0) - 3;
            return (
              <div
                key={`row-res-${rowIdx}`}
                onPointerDown={(e) => startRowResize(e, rowIdx)}
                title="Arrastrar para ajustar alto de fila"
                style={{ left: 0, top: topPos, width: '100%', height: 6 }}
                className="pointer-events-auto absolute cursor-row-resize hover:bg-blue-500/35 transition-colors"
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

