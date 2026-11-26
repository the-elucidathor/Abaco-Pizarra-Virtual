import type {
  AppSettings,
  FolderRecord,
  ProjectSnapshotMeta,
  ProjectSummary,
  WhiteboardProject,
} from '../types/whiteboard';
import { validateAndNormalizeProject } from '../utils/richText';
import { APP_VERSION } from '../version';

export const MAX_PROJECT_VERSIONS = 5;

const DB_NAME = 'abaco-pizarra-db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_FOLDERS = 'folders';
const STORE_SNAPSHOTS = 'snapshots';
const SETTINGS_KEY = 'abaco_settings_v1';
const LAST_PROJECT_KEY = 'abaco_last_project_id_v1';

interface StoredSnapshot {
  snapshotId: string;
  projectId: string;
  savedAt: number;
  project: WhiteboardProject;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapStore = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'snapshotId' });
        snapStore.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clave de persistencia para las secciones abiertas en el acordeón de Configuración
const SETTINGS_OPEN_SECTIONS_KEY = 'abaco_settings_open_sections_v1';

// Valores predeterminados de configuración general (incluye color del lienzo automático)
export const defaultSettings: AppSettings = {
  theme: 'light',
  canvasBgMode: 'auto',
  canvasBgCustomColor: '#ffffff',
  adaptStrokeColorsToCanvasBg: false,
  autoSaveEnabled: true,
  autoSaveIntervalSec: 12,
  pressureSensitivity: true,
  defaultGridSize: 28,
  cursorSize: 28,
  cursorColor: 'auto',
  spellcheckEnabled: true,
  spellcheckDefaultLang: 'es',
  wheelScrollSheets: true,
};

const VALID_THEMES = new Set([
  'light',
  'dark',
  'warm',
  'cool',
  'nature',
  'blueprint',
  'sepia',
  'neon',
]);

const VALID_CANVAS_BG_MODES = new Set([
  'auto',
  'white',
  'graphite',
  'chalkboard',
  'cream',
  'custom',
]);

// Valida formato hexadecimal de 6 dígitos (#RRGGBB) para color personalizado
function isValidHex6(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    const merged = { ...defaultSettings, ...parsed };
    if (!VALID_THEMES.has(merged.theme)) {
      merged.theme = 'light';
    }
    if (!VALID_CANVAS_BG_MODES.has(merged.canvasBgMode)) {
      merged.canvasBgMode = 'auto';
    }
    merged.canvasBgCustomColor = isValidHex6(merged.canvasBgCustomColor)
      ? merged.canvasBgCustomColor.trim()
      : '#ffffff';
    merged.adaptStrokeColorsToCanvasBg = Boolean(merged.adaptStrokeColorsToCanvasBg);
    merged.cursorSize =
      typeof merged.cursorSize === 'number' && Number.isFinite(merged.cursorSize)
        ? Math.max(20, Math.min(48, Math.round(merged.cursorSize)))
        : 28;
    if (typeof merged.cursorColor !== 'string' || !merged.cursorColor.trim()) {
      merged.cursorColor = 'auto';
    }
    merged.spellcheckEnabled =
      typeof merged.spellcheckEnabled === 'boolean' ? merged.spellcheckEnabled : true;
    merged.spellcheckDefaultLang =
      merged.spellcheckDefaultLang === 'en-US' ||
      merged.spellcheckDefaultLang === 'es-MX' ||
      merged.spellcheckDefaultLang === 'es'
        ? merged.spellcheckDefaultLang
        : 'es';
    merged.wheelScrollSheets =
      typeof merged.wheelScrollSheets === 'boolean' ? merged.wheelScrollSheets : true;
    return merged;
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Carga las secciones abiertas del panel de configuración; por defecto solo abre la primera ('appearance')
export function loadSettingsOpenSections(
  validIds: readonly string[],
  defaultOpenIds: readonly string[] = ['appearance']
): string[] {
  try {
    const raw = localStorage.getItem(SETTINGS_OPEN_SECTIONS_KEY);
    if (raw === null) return [...defaultOpenIds];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaultOpenIds];
    const validSet = new Set(validIds);
    return parsed.filter((id): id is string => typeof id === 'string' && validSet.has(id));
  } catch {
    return [...defaultOpenIds];
  }
}

// Guarda en localStorage la lista actual de secciones desplegadas en Configuración
export function saveSettingsOpenSections(openIds: string[]): void {
  try {
    localStorage.setItem(SETTINGS_OPEN_SECTIONS_KEY, JSON.stringify(openIds));
  } catch {
    // Ignorar error de cuota en almacenamiento local
  }
}

const SHEET_WHEEL_HINT_DISMISSED_KEY = 'abaco_sheet_wheel_hint_dismissed_v1';

// Indica si el usuario ya cerró la sugerencia discreta de navegación con rueda en hojas fijas
export function loadSheetWheelHintDismissed(): boolean {
  try {
    return localStorage.getItem(SHEET_WHEEL_HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

// Marca como cerrada de forma permanente la sugerencia discreta de rueda en hojas fijas
export function saveSheetWheelHintDismissed(): void {
  try {
    localStorage.setItem(SHEET_WHEEL_HINT_DISMISSED_KEY, '1');
  } catch {
    // Ignorar error de almacenamiento local
  }
}

export function getLastOpenedProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastOpenedProjectId(id: string): void {
  localStorage.setItem(LAST_PROJECT_KEY, id);
}

const DEFAULT_FOLDERS: FolderRecord[] = [
  { id: 'general', name: 'General', createdAt: 1700000000000 },
  { id: 'clases', name: 'Clases y Apuntes', createdAt: 1700000000001 },
  { id: 'diagramas', name: 'Diagramas Técnicos', createdAt: 1700000000002 },
];

function canSyncWithLocalServer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export async function listFolders(): Promise<FolderRecord[]> {
  if (canSyncWithLocalServer()) {
    try {
      const res = await fetch('/api/folders');
    if (res.ok) {
      const data: FolderRecord[] = await res.json();
      for (const f of data) {
        await idbPut(STORE_FOLDERS, f).catch(() => {});
      }
      return data.length > 0 ? data : DEFAULT_FOLDERS;
    }
    } catch {
      // Offline fallback to IndexedDB
    }
  }
  const local = await idbGetAll<FolderRecord>(STORE_FOLDERS);
  if (local.length === 0) {
    for (const f of DEFAULT_FOLDERS) {
      await idbPut(STORE_FOLDERS, f);
    }
    return DEFAULT_FOLDERS;
  }
  return local;
}

export async function createFolder(name: string): Promise<FolderRecord> {
  const folder: FolderRecord = {
    id: `fld_${Date.now().toString(36)}`,
    name: name.trim(),
    createdAt: Date.now(),
  };
  await idbPut(STORE_FOLDERS, folder);
  if (canSyncWithLocalServer()) {
    try {
      await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folder),
      });
    } catch {
      // Offline safe
    }
  }
  return folder;
}

export async function deleteFolder(id: string): Promise<void> {
  await idbDelete(STORE_FOLDERS, id);
  if (canSyncWithLocalServer()) {
    try {
      await fetch(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      // Offline safe
    }
  }
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const localProjects = await idbGetAll<WhiteboardProject>(STORE_PROJECTS);
  const map = new Map<string, ProjectSummary>();

  for (const p of localProjects) {
    const sizeBytes = new Blob([JSON.stringify(p)]).size;
    map.set(p.id, {
      id: p.id,
      name: p.name,
      folderId: p.folderId || 'general',
      boardCount: p.boards.length,
      updatedAt: p.updatedAt,
      createdAt: p.createdAt,
      sizeBytes,
    });
  }

  if (canSyncWithLocalServer()) {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const serverList: ProjectSummary[] = await res.json();
        for (const s of serverList) {
          const existing = map.get(s.id);
          if (!existing || s.updatedAt > existing.updatedAt) {
            map.set(s.id, s);
          }
        }
      }
    } catch {
      // Offline fallback uses local IndexedDB
    }
  }

  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface SaveProjectOptions {
  skipVersionTrim?: boolean;
  /** Permite pruebas o simulación controlada de error al guardar historial sin perder versiones previas */
  __simulateSnapshotWriteFailure?: boolean;
}

export interface SaveProjectResult {
  project: WhiteboardProject;
  snapshotSaved: boolean;
  snapshotError: string | null;
  evictedSnapshots: ProjectSnapshotMeta[];
  storageError: string | null;
}

export interface RestoreSnapshotResult {
  ok: boolean;
  restoredProject: WhiteboardProject | null;
  checkpointSaved: boolean;
  evictedSnapshots: ProjectSnapshotMeta[];
  warningMessage: string | null;
}

let snapshotSeqCounter = 0;

function createUniqueSnapshotId(ts: number): string {
  snapshotSeqCounter = (snapshotSeqCounter + 1) % 10000;
  return `snap_${ts}_${snapshotSeqCounter.toString().padStart(4, '0')}`;
}

function normalizeSnapshotMeta(raw: Partial<StoredSnapshot> | Partial<ProjectSnapshotMeta> | null | undefined): ProjectSnapshotMeta | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const snapId = typeof raw.snapshotId === 'string' ? raw.snapshotId.trim() : '';
    if (!snapId) return null;
    const proj = 'project' in raw ? (raw.project as Partial<WhiteboardProject> | undefined) : undefined;
    const rawSavedAt =
      typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt)
        ? raw.savedAt
        : typeof proj?.updatedAt === 'number' && Number.isFinite(proj.updatedAt)
        ? proj.updatedAt
        : 0;
    const boardCount =
      'boardCount' in raw && typeof raw.boardCount === 'number' && Number.isFinite(raw.boardCount)
        ? Math.max(0, raw.boardCount)
        : Array.isArray(proj?.boards)
        ? proj.boards.length
        : 0;
    const name =
      'name' in raw && typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : typeof proj?.name === 'string' && proj.name.trim()
        ? proj.name.trim()
        : 'Proyecto sin título';
    return {
      snapshotId: snapId,
      savedAt: rawSavedAt,
      boardCount,
      name,
    };
  } catch {
    return null;
  }
}

// Selecciona las versiones más recientes a conservar y las más antiguas a eliminar (FIFO)
export function selectSnapshotsToKeepAndEvict<
  T extends { snapshotId: string; savedAt: number }
>(
  snapshots: T[],
  maxVersions = MAX_PROJECT_VERSIONS,
  protectedSnapshotId?: string
): { keep: T[]; evict: T[] } {
  const validLimit = Math.max(1, maxVersions);
  const sortedDesc = [...snapshots].sort((a, b) => {
    const timeDiff = (b.savedAt || 0) - (a.savedAt || 0);
    if (timeDiff !== 0) return timeDiff;
    if (protectedSnapshotId) {
      if (a.snapshotId === protectedSnapshotId && b.snapshotId !== protectedSnapshotId) return -1;
      if (b.snapshotId === protectedSnapshotId && a.snapshotId !== protectedSnapshotId) return 1;
    }
    return b.snapshotId.localeCompare(a.snapshotId);
  });

  const keep = sortedDesc.slice(0, validLimit);
  const evict = sortedDesc
    .slice(validLimit)
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  return { keep, evict };
}

async function deleteSnapshotEverywhere(projectId: string, snapshotId: string): Promise<void> {
  try {
    await idbDelete(STORE_SNAPSHOTS, snapshotId);
  } catch {
    // Ignorar fallo individual al limpiar snapshot en IndexedDB
  }
  if (canSyncWithLocalServer()) {
    try {
      await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}`,
        { method: 'DELETE' }
      );
    } catch {
      // Modo sin conexión seguro
    }
  }
}

export async function saveProjectDetailed(
  project: WhiteboardProject,
  createSnapshot = false,
  options: SaveProjectOptions = {}
): Promise<SaveProjectResult> {
  const now = Date.now();
  const updated: WhiteboardProject = {
    ...project,
    appVersion: APP_VERSION,
    updatedAt: now,
  };

  let storageError: string | null = null;
  try {
    await idbPut(STORE_PROJECTS, updated);
    setLastOpenedProjectId(updated.id);
  } catch (err) {
    console.error('[Ábaco] Error al guardar el proyecto localmente:', err);
    storageError =
      'No se pudo guardar el proyecto en el almacenamiento local (posible falta de espacio).';
    return {
      project: updated,
      snapshotSaved: false,
      snapshotError: createSnapshot
        ? 'No se pudo guardar la versión en el historial; las versiones anteriores siguen intactas.'
        : null,
      evictedSnapshots: [],
      storageError,
    };
  }

  let snapshotSaved = false;
  let snapshotError: string | null = null;
  let evictedSnapshots: ProjectSnapshotMeta[] = [];
  let createdSnapId: string | undefined;

  if (createSnapshot) {
    // Paso 1: Guardar la nueva versión ANTES de eliminar cualquier versión antigua
    const snapId = createUniqueSnapshotId(now);
    const snap: StoredSnapshot = {
      snapshotId: snapId,
      projectId: updated.id,
      savedAt: now,
      project: JSON.parse(JSON.stringify(updated)) as WhiteboardProject,
    };
    try {
      if (options.__simulateSnapshotWriteFailure) {
        throw new Error('Simulated snapshot storage quota failure');
      }
      await idbPut(STORE_SNAPSHOTS, snap);
      snapshotSaved = true;
      createdSnapId = snapId;
    } catch (err) {
      console.error('[Ábaco] Error al guardar versión en historial:', err);
      snapshotError =
        'No se pudo guardar la nueva versión en el historial (almacenamiento lleno o no disponible). Las versiones anteriores permanecen intactas.';
    }
  }

  // Paso 2: Sincronizar con el servidor local si aplica (solo crea snapshot en servidor si el guardado local tuvo éxito)
  if (canSyncWithLocalServer()) {
    try {
      const query = new URLSearchParams({
        snapshot: String(Boolean(createSnapshot && snapshotSaved)),
      });
      if (createdSnapId) {
        query.set('snapshotId', createdSnapId);
      }
      await fetch(`/api/projects/${encodeURIComponent(updated.id)}?${query.toString()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch {
      // Modo sin conexión: IndexedDB ya persistió el proyecto y la instantánea
    }
  }

  // Paso 3: Aplicar regla FIFO (máximo 5 versiones) únicamente si no hubo error de guardado
  const shouldTrim =
    (createSnapshot && snapshotSaved) || (!createSnapshot && !options.skipVersionTrim);

  if (shouldTrim) {
    try {
      const allSnapshots = await listSnapshots(updated.id);
      if (allSnapshots.length > MAX_PROJECT_VERSIONS) {
        const { evict } = selectSnapshotsToKeepAndEvict(
          allSnapshots,
          MAX_PROJECT_VERSIONS,
          createdSnapId
        );
        for (const oldSnap of evict) {
          await deleteSnapshotEverywhere(updated.id, oldSnap.snapshotId);
        }
        evictedSnapshots = evict;
      }
    } catch (err) {
      console.error('[Ábaco] Error al depurar versiones antiguas:', err);
      if (!snapshotError) {
        snapshotError =
          'Se guardó el proyecto, pero ocurrió un aviso al actualizar el límite del historial.';
      }
    }
  }

  return {
    project: updated,
    snapshotSaved,
    snapshotError,
    evictedSnapshots,
    storageError,
  };
}

export async function saveProject(
  project: WhiteboardProject,
  createSnapshot = false,
  options?: SaveProjectOptions
): Promise<WhiteboardProject> {
  const res = await saveProjectDetailed(project, createSnapshot, options);
  return res.project;
}

export async function loadProject(id: string): Promise<WhiteboardProject | null> {
  const local = await idbGet<WhiteboardProject>(STORE_PROJECTS, id);
  if (canSyncWithLocalServer()) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (res.ok) {
        const serverProj: WhiteboardProject = await res.json();
        if (!local || serverProj.updatedAt >= local.updatedAt) {
          await idbPut(STORE_PROJECTS, serverProj);
          return validateAndNormalizeProject(serverProj).project;
        }
      }
    } catch {
      // Offline safe
    }
  }
  return local ? validateAndNormalizeProject(local).project : null;
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id);
  try {
    const allLocal = await idbGetAll<StoredSnapshot>(STORE_SNAPSHOTS);
    for (const s of allLocal) {
      if (s?.projectId === id && s?.snapshotId) {
        await idbDelete(STORE_SNAPSHOTS, s.snapshotId).catch(() => {});
      }
    }
  } catch {
    // Ignorar error al limpiar instantáneas locales del proyecto eliminado
  }
  if (canSyncWithLocalServer()) {
    try {
      await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      // Offline safe
    }
  }
}

export async function listSnapshots(projectId: string): Promise<ProjectSnapshotMeta[]> {
  const localMap = new Map<string, ProjectSnapshotMeta>();

  try {
    const allLocal = await idbGetAll<StoredSnapshot>(STORE_SNAPSHOTS);
    for (const s of allLocal) {
      if (!s || s.projectId !== projectId) continue;
      const normalized = normalizeSnapshotMeta(s);
      if (normalized) {
        localMap.set(normalized.snapshotId, normalized);
      }
    }
  } catch (err) {
    console.error('[Ábaco] Error al leer historial local de versiones:', err);
  }

  if (canSyncWithLocalServer()) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/snapshots`);
      if (res.ok) {
        const serverSnaps: unknown = await res.json();
        if (Array.isArray(serverSnaps)) {
          for (const s of serverSnaps) {
            const normalized = normalizeSnapshotMeta(s as Partial<ProjectSnapshotMeta>);
            if (normalized) {
              localMap.set(normalized.snapshotId, normalized);
            }
          }
        }
      }
    } catch {
      // Offline safe
    }
  }

  return Array.from(localMap.values()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export async function loadSnapshot(
  projectId: string,
  snapshotId: string
): Promise<WhiteboardProject | null> {
  try {
    const local = await idbGet<StoredSnapshot>(STORE_SNAPSHOTS, snapshotId);
    if (local && local.project && typeof local.project === 'object') {
      return validateAndNormalizeProject(local.project).project;
    }
  } catch (err) {
    console.error('[Ábaco] Error al cargar versión local:', err);
  }

  if (canSyncWithLocalServer()) {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}`
      );
      if (res.ok) {
        const data = await res.json();
        return data?.project && typeof data.project === 'object'
          ? validateAndNormalizeProject(data.project as WhiteboardProject).project
          : null;
      }
    } catch {
      // Offline safe
    }
  }
  return null;
}

// Restaura una versión guardando primero el estado actual como punto de control recuperable (máx 5 FIFO)
export async function restoreSnapshotWithCheckpoint(
  currentProject: WhiteboardProject,
  snapshotId: string,
  options: SaveProjectOptions = {}
): Promise<RestoreSnapshotResult> {
  try {
    const restored = await loadSnapshot(currentProject.id, snapshotId);
    if (!restored) {
      return {
        ok: false,
        restoredProject: null,
        checkpointSaved: false,
        evictedSnapshots: [],
        warningMessage: 'No se pudo cargar la versión seleccionada o sus datos están incompletos.',
      };
    }

    // Guarda el estado actual como punto de control antes de restaurar (si hay espacio)
    let checkpointSaved = false;
    let evictedSnapshots: ProjectSnapshotMeta[] = [];
    let checkpointWarning: string | null = null;
    try {
      const checkpointRes = await saveProjectDetailed(currentProject, true, options);
      checkpointSaved = checkpointRes.snapshotSaved;
      evictedSnapshots = checkpointRes.evictedSnapshots;
      checkpointWarning = checkpointRes.snapshotError;
    } catch {
      checkpointWarning =
        'Se restauró la versión, aunque no fue posible guardar el punto de control previo.';
    }

    const activeRes = await saveProjectDetailed(restored, false, {
      skipVersionTrim: true,
    });
    return {
      ok: !activeRes.storageError,
      restoredProject: activeRes.project,
      checkpointSaved,
      evictedSnapshots,
      warningMessage: activeRes.storageError || checkpointWarning,
    };
  } catch (err) {
    console.error('[Ábaco] Error al restaurar versión:', err);
    return {
      ok: false,
      restoredProject: null,
      checkpointSaved: false,
      evictedSnapshots: [],
      warningMessage:
        'Ocurrió un error al restaurar la versión. Las demás versiones se mantienen intactas.',
    };
  }
}

export async function exportAllBackupJson(): Promise<string> {
  const folders = await listFolders();
  const summaries = await listProjectSummaries();
  const projects: WhiteboardProject[] = [];
  for (const s of summaries) {
    const p = await loadProject(s.id);
    if (p) projects.push(p);
  }
  return JSON.stringify(
    {
      format: 'abaco-pizarra-backup-v1',
      appVersion: APP_VERSION,
      exportedAt: Date.now(),
      folders,
      projects,
    },
    null,
    2
  );
}

export async function restoreBackupJson(rawJson: string): Promise<number> {
  const parsed = JSON.parse(rawJson);
  if (Array.isArray(parsed.folders)) {
    for (const f of parsed.folders as FolderRecord[]) {
      await idbPut(STORE_FOLDERS, f);
    }
  }
  let count = 0;
  if (Array.isArray(parsed.projects)) {
    for (const p of parsed.projects as WhiteboardProject[]) {
      if (p && p.id && Array.isArray(p.boards)) {
        await saveProject(validateAndNormalizeProject(p).project, false);
        count++;
      }
    }
  }
  return count;
}
