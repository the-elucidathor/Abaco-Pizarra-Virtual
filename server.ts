import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(__dirname, 'local-data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');

interface FolderRecord {
  id: string;
  name: string;
  createdAt: number;
}

async function ensureStorageDirs(): Promise<void> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
  await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  try {
    await fs.access(FOLDERS_FILE);
  } catch {
    const initialFolders: FolderRecord[] = [
      { id: 'general', name: 'General', createdAt: Date.now() },
      { id: 'clases', name: 'Clases y Apuntes', createdAt: Date.now() },
      { id: 'diagramas', name: 'Diagramas Técnicos', createdAt: Date.now() },
    ];
    await fs.writeFile(FOLDERS_FILE, JSON.stringify(initialFolders, null, 2), 'utf-8');
  }
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

function resolveSafeSubpath(baseDir: string, ...segments: string[]): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (!target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}

async function readAppVersion(): Promise<string> {
  try {
    const pkgRaw = await fs.readFile(path.resolve(__dirname, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '1.11.8';
  } catch {
    return '1.11.8';
  }
}

async function createApp() {
  await ensureStorageDirs();

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'local-desktop-storage' });
  });

  // Folders CRUD
  app.get('/api/folders', async (_req, res) => {
    try {
      const content = await fs.readFile(FOLDERS_FILE, 'utf-8');
      res.json(JSON.parse(content));
    } catch {
      res.json([]);
    }
  });

  app.post('/api/folders', async (req, res) => {
    try {
      const { id, name } = req.body as { id?: string; name?: string };
      if (!name || !name.trim()) {
        res.status(400).json({ error: 'Nombre de carpeta requerido' });
        return;
      }
      const raw = await fs.readFile(FOLDERS_FILE, 'utf-8').catch(() => '[]');
      const folders: FolderRecord[] = JSON.parse(raw);
      const newFolder: FolderRecord = {
        id: sanitizeId(id || `fld_${Date.now()}`),
        name: name.trim(),
        createdAt: Date.now(),
      };
      folders.push(newFolder);
      await fs.writeFile(FOLDERS_FILE, JSON.stringify(folders, null, 2), 'utf-8');
      res.json(newFolder);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete('/api/folders/:id', async (req, res) => {
    try {
      const targetId = sanitizeId(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: 'ID de carpeta inválido' });
        return;
      }
      const raw = await fs.readFile(FOLDERS_FILE, 'utf-8').catch(() => '[]');
      const folders: FolderRecord[] = JSON.parse(raw);
      const filtered = folders.filter((f) => f.id !== targetId);
      await fs.writeFile(FOLDERS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // List projects (metadata summary)
  app.get('/api/projects', async (_req, res) => {
    try {
      const files = await fs.readdir(PROJECTS_DIR);
      const summaries = [];
      for (const file of files) {
        if (!file.endsWith('.pizarra.json')) continue;
        try {
          const fullPath = path.join(PROJECTS_DIR, file);
          const stat = await fs.stat(fullPath);
          const text = await fs.readFile(fullPath, 'utf-8');
          const proj = JSON.parse(text);
          summaries.push({
            id: proj.id,
            name: proj.name,
            folderId: proj.folderId || 'general',
            boardCount: Array.isArray(proj.boards) ? proj.boards.length : 1,
            updatedAt: proj.updatedAt || stat.mtimeMs,
            createdAt: proj.createdAt || stat.birthtimeMs,
            sizeBytes: stat.size,
          });
        } catch {
          // Ignore malformed files
        }
      }
      summaries.sort((a, b) => b.updatedAt - a.updatedAt);
      res.json(summaries);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get single project
  app.get('/api/projects/:id', async (req, res) => {
    try {
      const id = sanitizeId(req.params.id);
      const filePath = id ? resolveSafeSubpath(PROJECTS_DIR, `${id}.pizarra.json`) : null;
      if (!filePath) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      const text = await fs.readFile(filePath, 'utf-8');
      res.json(JSON.parse(text));
    } catch {
      res.status(404).json({ error: 'Proyecto no encontrado' });
    }
  });

  // Save or update project + optional version snapshot
  app.put('/api/projects/:id', async (req, res) => {
    try {
      const id = sanitizeId(req.params.id);
      const filePath = id ? resolveSafeSubpath(PROJECTS_DIR, `${id}.pizarra.json`) : null;
      if (!id || !filePath) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      const createSnapshot = req.query.snapshot === 'true';
      const reqSnapshotId =
        typeof req.query.snapshotId === 'string' ? sanitizeId(req.query.snapshotId) : '';
      const payload = req.body;
      await fs.writeFile(filePath, JSON.stringify(payload), 'utf-8');

      if (createSnapshot) {
        const snapDir = resolveSafeSubpath(SNAPSHOTS_DIR, id);
        if (!snapDir) {
          res.status(400).json({ error: 'ID de snapshot inválido' });
          return;
        }
        await fs.mkdir(snapDir, { recursive: true });
        const snapId = reqSnapshotId || `snap_${Date.now()}`;
        const snapFilePath = resolveSafeSubpath(snapDir, `${snapId}.json`);
        if (!snapFilePath) {
          res.status(400).json({ error: 'ID de versión inválido' });
          return;
        }
        const savedAt = Date.now();
        const snapPayload = {
          snapshotId: snapId,
          savedAt,
          project: payload,
        };
        // Escribir la nueva instantánea antes de recortar las más antiguas (FIFO máx. 5)
        await fs.writeFile(snapFilePath, JSON.stringify(snapPayload), 'utf-8');

        const files = (await fs.readdir(snapDir)).filter((f) => f.endsWith('.json'));
        if (files.length > 5) {
          const withTimes: { file: string; savedAt: number; isCurrent: boolean }[] = [];
          for (const file of files) {
            try {
              const full = path.join(snapDir, file);
              const raw = await fs.readFile(full, 'utf-8');
              const parsed = JSON.parse(raw);
              const ts =
                typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)
                  ? parsed.savedAt
                  : 0;
              withTimes.push({ file, savedAt: ts, isCurrent: file === `${snapId}.json` });
            } catch {
              const stat = await fs.stat(path.join(snapDir, file)).catch(() => null);
              withTimes.push({
                file,
                savedAt: stat?.mtimeMs ?? 0,
                isCurrent: file === `${snapId}.json`,
              });
            }
          }
          withTimes.sort((a, b) => {
            const diff = b.savedAt - a.savedAt;
            if (diff !== 0) return diff;
            if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
            return b.file.localeCompare(a.file);
          });
          const toRemove = withTimes.slice(5);
          for (const old of toRemove) {
            await fs.unlink(path.join(snapDir, old.file)).catch(() => {});
          }
        }
      }

      res.json({ ok: true, id, updatedAt: payload.updatedAt || Date.now() });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Delete project
  app.delete('/api/projects/:id', async (req, res) => {
    try {
      const id = sanitizeId(req.params.id);
      const filePath = id ? resolveSafeSubpath(PROJECTS_DIR, `${id}.pizarra.json`) : null;
      const snapDir = id ? resolveSafeSubpath(SNAPSHOTS_DIR, id) : null;
      if (!filePath || !snapDir) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      await fs.unlink(filePath).catch(() => {});
      await fs.rm(snapDir, { recursive: true, force: true }).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // List snapshots for project
  app.get('/api/projects/:id/snapshots', async (req, res) => {
    try {
      const id = sanitizeId(req.params.id);
      const snapDir = id ? resolveSafeSubpath(SNAPSHOTS_DIR, id) : null;
      if (!snapDir) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      const files = await fs.readdir(snapDir).catch(() => [] as string[]);
      const list = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const text = await fs.readFile(path.join(snapDir, file), 'utf-8');
          const parsed = JSON.parse(text);
          const fallbackId = file.replace(/\.json$/, '');
          list.push({
            snapshotId: typeof parsed?.snapshotId === 'string' ? parsed.snapshotId : fallbackId,
            savedAt:
              typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)
                ? parsed.savedAt
                : 0,
            boardCount: Array.isArray(parsed?.project?.boards) ? parsed.project.boards.length : 0,
            name:
              typeof parsed?.project?.name === 'string' && parsed.project.name.trim()
                ? parsed.project.name
                : 'Proyecto sin título',
          });
        } catch {
          // Ignorar archivos de instantánea corruptos para no bloquear el historial
        }
      }
      list.sort((a, b) => b.savedAt - a.savedAt);
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Restore snapshot payload
  app.get('/api/projects/:id/snapshots/:snapId', async (req, res) => {
    try {
      const id = sanitizeId(req.params.id);
      const snapId = sanitizeId(req.params.snapId);
      const snapPath =
        id && snapId ? resolveSafeSubpath(SNAPSHOTS_DIR, id, `${snapId}.json`) : null;
      if (!snapPath) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      const text = await fs.readFile(snapPath, 'utf-8');
      res.json(JSON.parse(text));
    } catch {
      res.status(404).json({ error: 'Versión no encontrada' });
    }
  });

  // Delete specific snapshot (usado en limpieza FIFO)
  app.delete('/api/projects/:id/snapshots/:snapId', async (req, res) => {
    try {
      const id = sanitizeId(req.params.id);
      const snapId = sanitizeId(req.params.snapId);
      const snapPath =
        id && snapId ? resolveSafeSubpath(SNAPSHOTS_DIR, id, `${snapId}.json`) : null;
      if (!snapPath) {
        res.status(400).json({ error: 'ID inválido' });
        return;
      }
      await fs.unlink(snapPath).catch(() => {});
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Full local backup export
  app.get('/api/backup', async (_req, res) => {
    try {
      const foldersRaw = await fs.readFile(FOLDERS_FILE, 'utf-8').catch(() => '[]');
      const files = await fs.readdir(PROJECTS_DIR).catch(() => [] as string[]);
      const projects = [];
      for (const file of files) {
        if (!file.endsWith('.pizarra.json')) continue;
        const text = await fs.readFile(path.join(PROJECTS_DIR, file), 'utf-8');
        projects.push(JSON.parse(text));
      }
      const appVersion = await readAppVersion();
      res.json({
        format: 'abaco-pizarra-backup-v1',
        appVersion,
        exportedAt: Date.now(),
        folders: JSON.parse(foldersRaw),
        projects,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Vite middleware in dev, static dist in prod
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ábaco Pizarra Virtual ejecutándose localmente en http://localhost:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('Error al iniciar el servidor local:', err);
  process.exit(1);
});
