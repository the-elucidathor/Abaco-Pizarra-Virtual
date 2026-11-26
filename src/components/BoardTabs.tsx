import React, { useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import type { Board } from '../types/whiteboard';

interface BoardTabsProps {
  boards: Board[];
  activeBoardId: string;
  onSelectBoard: (boardId: string) => void;
  onAddBoard: () => void;
  onDuplicateBoard: (boardId: string) => void;
  onRenameBoard: (boardId: string, name: string) => void;
  onDeleteBoard: (boardId: string) => void;
}

// OPT: 2.6 — Evita re-renderizados cuando cambia el lienzo o el cursor
export const BoardTabs: React.FC<BoardTabsProps> = React.memo(({
  boards,
  activeBoardId,
  onSelectBoard,
  onAddBoard,
  onDuplicateBoard,
  onRenameBoard,
  onDeleteBoard,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = (boardId: string) => {
    setEditingId(null);
    if (draft.trim()) {
      onRenameBoard(boardId, draft.trim());
    }
  };

  return (
    <div className="no-print h-8 px-2 theme-surface-alt border-b flex items-center gap-1 overflow-x-auto panel-scroll select-none shrink-0">
      {boards.map((b) => {
        const isActive = b.id === activeBoardId;
        return (
          <div
            key={b.id}
            style={isActive ? { borderBottomColor: 'var(--ui-accent)' } : undefined}
            className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs border-b-2 transition-colors shrink-0 ${
              isActive
                ? 'theme-surface font-medium'
                : 'border-transparent opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
            }`}
          >
            {editingId === b.id ? (
              <input
                autoFocus
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(b.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(b.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="w-28 px-1 py-0 text-xs theme-surface border theme-border rounded"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelectBoard(b.id)}
                onDoubleClick={() => {
                  setEditingId(b.id);
                  setDraft(b.name);
                }}
                title="Doble clic para renombrar tablero"
                className="whitespace-nowrap max-w-[160px] truncate"
              >
                {b.name}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDuplicateBoard(b.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
              title="Duplicar tablero"
            >
              <Copy className="w-2.5 h-2.5" />
            </button>
            {boards.length > 1 && (
              <button
                type="button"
                onClick={() => onDeleteBoard(b.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600"
                title="Eliminar tablero"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAddBoard}
        className="flex items-center gap-1 px-2 py-1 text-xs font-medium opacity-80 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 rounded whitespace-nowrap shrink-0"
        title="Añadir nuevo tablero"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Nuevo tablero</span>
      </button>
    </div>
  );
});

