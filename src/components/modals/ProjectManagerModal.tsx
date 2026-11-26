import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Copy,
  Download,
  Folder,
  FolderPlus,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  FolderRecord,
  ProjectSnapshotMeta,
  ProjectSummary,
  WhiteboardProject,
} from '../../types/whiteboard';
import {
  createFolder,
  deleteFolder,
  deleteProject,
  exportAllBackupJson,
  listFolders,
  listProjectSummaries,
  listSnapshots,
  loadProject,
  MAX_PROJECT_VERSIONS,
  restoreBackupJson,
  restoreSnapshotWithCheckpoint,
  saveProject,
  saveProjectDetailed,
} from '../../services/storageService';
import { createNewProject } from '../../data/defaultTemplates';
import { formatBytes, formatDateTime, uid } from '../../utils/id';
import { APP_VERSION } from '../../version';

interface ProjectManagerModalProps {
  currentProject: WhiteboardProject;
  onSelectProject: (project: WhiteboardProject) => void;
  onRequestNewProject?: (folderId: string) => void;
  onNotifyToast?: (message: string, kind?: 'info' | 'error') => void;
  onClose: () => void;
}

export const ProjectManagerModal: React.FC<ProjectManagerModalProps> = ({
  currentProject,
  onSelectProject,
  onRequestNewProject,
  onNotifyToast,
  onClose,
}) => {
  const [tab, setTab] = useState<'projects' | 'versions'>('projects');
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [snapshots, setSnapshots] = useState<ProjectSnapshotMeta[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const pizarraInputRef = useRef<HTMLInputElement>(null);

  const refreshData = async () => {
    try {
      const [fList, pList, sList] = await Promise.all([
        listFolders(),
        listProjectSummaries(),
        listSnapshots(currentProject.id),
      ]);
      setFolders(Array.isArray(fList) ? fList : []);
      setProjects(Array.isArray(pList) ? pList : []);
      setSnapshots(Array.isArray(sList) ? sList : []);
    } catch {
      setStatusMessage('No se pudo actualizar completamente la lista local.');
    }
  };

  useEffect(() => {
    refreshData();
  }, [currentProject.id]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder(newFolderName.trim());
    setNewFolderName('');
    await refreshData();
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (folderId === 'general') return;
    await deleteFolder(folderId);
    if (selectedFolder === folderId) setSelectedFolder('all');
    await refreshData();
  };

  const handleCreateProject = async () => {
    const targetFolder = selectedFolder === 'all' ? 'general' : selectedFolder;
    if (onRequestNewProject) {
      onClose();
      onRequestNewProject(targetFolder);
      return;
    }
    const proj = createNewProject(`Proyecto ${projects.length + 1}`, targetFolder);
    await saveProject(proj, true);
    onSelectProject(proj);
    onClose();
  };

  const handleOpenProject = async (id: string) => {
    const loaded = await loadProject(id);
    if (loaded) {
      onSelectProject(loaded);
      onClose();
    }
  };

  const handleDuplicateProject = async (id: string) => {
    const orig = await loadProject(id);
    if (!orig) return;
    const copy: WhiteboardProject = {
      ...JSON.parse(JSON.stringify(orig)),
      id: uid('proj'),
      name: `${orig.name} (Copia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveProject(copy, true);
    setStatusMessage(`Proyecto duplicado: ${copy.name}`);
    await refreshData();
  };

  const handleRenameCommit = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    const orig = await loadProject(id);
    if (orig) {
      const updated = { ...orig, name: renameValue.trim() };
      await saveProject(updated, false);
      if (id === currentProject.id) {
        onSelectProject(updated);
      }
    }
    setRenamingId(null);
    await refreshData();
  };

  const handleMoveFolder = async (id: string, folderId: string) => {
    const orig = await loadProject(id);
    if (!orig) return;
    const updated = { ...orig, folderId };
    await saveProject(updated, false);
    if (id === currentProject.id) onSelectProject(updated);
    await refreshData();
  };

  const handleDeleteProject = async (id: string) => {
    if (projects.length <= 1) {
      setStatusMessage('Debe existir al menos un proyecto local.');
      return;
    }
    await deleteProject(id);
    if (id === currentProject.id) {
      const remaining = projects.filter((p) => p.id !== id);
      if (remaining.length > 0) {
        const nextProj = await loadProject(remaining[0].id);
        if (nextProj) onSelectProject(nextProj);
      }
    }
    await refreshData();
  };

  const handleExportFullBackup = async () => {
    const json = await exportAllBackupJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo-abaco-pizarra-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMessage('Copia de seguridad local descargada.');
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const restoredCount = await restoreBackupJson(text);
    setStatusMessage(`Se restauraron ${restoredCount} proyecto(s) desde la copia de seguridad.`);
    await refreshData();
    e.target.value = '';
  };

  const handleImportPizarra = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WhiteboardProject;
      if (parsed && Array.isArray(parsed.boards)) {
        const imported: WhiteboardProject = {
          ...parsed,
          id: uid('proj'),
          updatedAt: Date.now(),
        };
        await saveProject(imported, true);
        onSelectProject(imported);
        onClose();
      }
    } catch {
      setStatusMessage('El archivo seleccionado no tiene un formato .pizarra válido.');
    }
    e.target.value = '';
  };

  const handleCreateManualSnapshot = async () => {
    try {
      const res = await saveProjectDetailed(currentProject, true);
      if (res.snapshotError) {
        setStatusMessage(res.snapshotError);
        onNotifyToast?.(res.snapshotError, 'error');
        await refreshData();
        return;
      }
      if (res.evictedSnapshots.length > 0) {
        const oldest = res.evictedSnapshots[0];
        const dateLabel =
          oldest.savedAt > 0 ? formatDateTime(oldest.savedAt) : 'fecha desconocida';
        const msg = `Se eliminó la versión más antigua (${dateLabel})`;
        setStatusMessage(`Versión guardada. ${msg}.`);
        onNotifyToast?.(msg, 'info');
      } else {
        setStatusMessage('Versión guardada en el historial local.');
        onNotifyToast?.('Versión guardada en el historial local.', 'info');
      }
      await refreshData();
    } catch {
      const errMsg =
        'No se pudo guardar la nueva versión en el historial. Las versiones anteriores siguen intactas.';
      setStatusMessage(errMsg);
      onNotifyToast?.(errMsg, 'error');
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    try {
      const res = await restoreSnapshotWithCheckpoint(currentProject, snapshotId);
      if (!res.ok || !res.restoredProject) {
        const errMsg =
          res.warningMessage ||
          'No se pudo restaurar la versión seleccionada. Las demás versiones se mantienen intactas.';
        setStatusMessage(errMsg);
        onNotifyToast?.(errMsg, 'error');
        return;
      }

      onSelectProject(res.restoredProject);
      if (res.evictedSnapshots.length > 0) {
        const oldest = res.evictedSnapshots[0];
        const dateLabel =
          oldest.savedAt > 0 ? formatDateTime(oldest.savedAt) : 'fecha desconocida';
        onNotifyToast?.(`Versión restaurada. Se eliminó la versión más antigua (${dateLabel})`, 'info');
      } else if (res.warningMessage) {
        onNotifyToast?.(res.warningMessage, 'info');
      } else {
        onNotifyToast?.(
          res.checkpointSaved
            ? 'Versión anterior restaurada. Se conservó el estado previo como punto de control.'
            : 'Versión anterior restaurada correctamente.',
          'info'
        );
      }
      onClose();
    } catch {
      const errMsg =
        'No se pudo restaurar la versión seleccionada. Las versiones guardadas siguen intactas.';
      setStatusMessage(errMsg);
      onNotifyToast?.(errMsg, 'error');
    }
  };

  const filteredProjects = projects.filter((p) => {
    const folderMatch = selectedFolder === 'all' || p.folderId === selectedFolder;
    const queryMatch =
      !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.toLowerCase());
    return folderMatch && queryMatch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl flex flex-col h-[82vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Proyectos locales y recuperación
            </h2>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setTab('projects')}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                  tab === 'projects'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Mis proyectos ({projects.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('versions')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                  tab === 'versions'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                Historial de versiones ({snapshots.length}/{MAX_PROJECT_VERSIONS})
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {statusMessage && (
          <div className="px-5 py-2 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-200 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button type="button" onClick={() => setStatusMessage(null)} className="underline">
              Ocultar
            </button>
          </div>
        )}

        {tab === 'projects' ? (
          <div className="flex-1 flex min-h-0">
            {/* Folder Sidebar */}
            <aside className="w-56 border-r border-slate-200 dark:border-slate-800 p-3 flex flex-col gap-2 bg-slate-50 dark:bg-slate-950/40 shrink-0">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-2">
                Carpetas locales
              </div>
              <button
                type="button"
                onClick={() => setSelectedFolder('all')}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium ${
                  selectedFolder === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                }`}
              >
                <span>Todos los proyectos</span>
                <span className="tabular-nums">{projects.length}</span>
              </button>

              <div className="flex-1 overflow-y-auto panel-scroll space-y-1">
                {folders.map((folder) => {
                  const count = projects.filter((p) => p.folderId === folder.id).length;
                  return (
                    <div key={folder.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedFolder(folder.id)}
                        className={`flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium min-w-0 ${
                          selectedFolder === folder.id
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Folder className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{folder.name}</span>
                        </span>
                        <span className="tabular-nums ml-1">{count}</span>
                      </button>
                      {folder.id !== 'general' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(folder.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-600"
                          title="Eliminar carpeta"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add Folder */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center gap-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="Nueva carpeta..."
                  className="flex-1 min-w-0 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  className="p-1.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-700 dark:text-slate-200"
                  title="Crear carpeta"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
            </aside>

            {/* Project List */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar proyecto local..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nuevo proyecto
                </button>
                <button
                  type="button"
                  onClick={() => pizarraInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Abrir .pizarra
                </button>
                <input
                  ref={pizarraInputRef}
                  type="file"
                  accept=".pizarra,.json"
                  onChange={handleImportPizarra}
                  className="hidden"
                />
              </div>

              <div className="flex-1 overflow-y-auto panel-scroll divide-y divide-slate-200 dark:divide-slate-800">
                {filteredProjects.map((p) => {
                  const isCurrent = p.id === currentProject.id;
                  return (
                    <div
                      key={p.id}
                      className={`px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        isCurrent ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        {renamingId === p.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameCommit(p.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameCommit(p.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="w-full max-w-sm rounded border border-blue-500 px-2 py-0.5 text-sm font-medium bg-white dark:bg-slate-900"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenProject(p.id)}
                            className="text-left block w-full"
                          >
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {p.name}
                              {isCurrent && (
                                <span className="ml-2 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                                  · Abierto
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-0.5 tabular-nums">
                              <span>{p.boardCount} tablero(s)</span>
                              <span>·</span>
                              <span>Modificado {formatDateTime(p.updatedAt)}</span>
                              {p.sizeBytes ? (
                                <>
                                  <span>·</span>
                                  <span>{formatBytes(p.sizeBytes)}</span>
                                </>
                              ) : null}
                            </div>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={p.folderId}
                          onChange={(e) => handleMoveFolder(p.id, e.target.value)}
                          className="text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
                          title="Mover a carpeta"
                        >
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameValue(p.name);
                          }}
                          className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                          title="Renombrar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateProject(p.id)}
                          className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                          title="Duplicar proyecto"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProject(p.id)}
                          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600"
                          title="Eliminar proyecto"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredProjects.length === 0 && (
                  <div className="p-10 text-center text-xs text-slate-500">
                    No hay proyectos que coincidan con el filtro seleccionado.
                  </div>
                )}
              </div>

              {/* Local Backup Footer */}
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  Ábaco v{APP_VERSION} · Almacenamiento 100% local en disco e IndexedDB sin nube.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportFullBackup}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 rounded-lg whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Crear copia de seguridad
                  </button>
                  <button
                    type="button"
                    onClick={() => backupInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 rounded-lg whitespace-nowrap"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Restaurar respaldo
                  </button>
                  <input
                    ref={backupInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col p-5 overflow-hidden">
            <div className="flex items-center justify-between mb-3 gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Historial de versiones ({snapshots.length}/{MAX_PROJECT_VERSIONS}) — {currentProject.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Se conservan las últimas 5 versiones. Al guardar una nueva, se elimina la más antigua.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateManualSnapshot}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Guardar versión ahora
              </button>
            </div>
            <div className="flex-1 overflow-y-auto panel-scroll border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
              {snapshots.map((snap) => (
                <div
                  key={snap.snapshotId}
                  className="px-4 py-3 flex items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {snap.name || 'Proyecto sin título'}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                      Guardado el {snap.savedAt > 0 ? formatDateTime(snap.savedAt) : 'fecha desconocida'} ·{' '}
                      {snap.boardCount || 0} tablero(s)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreSnapshot(snap.snapshotId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar versión
                  </button>
                </div>
              ))}
              {snapshots.length === 0 && (
                <div className="p-8 text-center text-xs text-slate-500">
                  Aún no hay instantáneas registradas para este proyecto. Pulsa «Guardar versión ahora» para crear una.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
