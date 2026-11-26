const { app, BrowserWindow, dialog, ipcMain, Notification, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow = null;
let updatePromptVisible = false;

const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 900,
  isMaximized: false,
};
const MIN_WINDOW_WIDTH = 1024;
const MIN_WINDOW_HEIGHT = 680;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function isBoundsVisibleOnDisplays(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  const displays = screen.getAllDisplays();
  if (!Array.isArray(displays) || displays.length === 0) return true;
  return displays.some((display) => {
    const area = display.workArea;
    const overlapX = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    );
    const overlapY = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    );
    return overlapX >= 120 && overlapY >= 80;
  });
}

function loadWindowState() {
  try {
    const statePath = getWindowStatePath();
    if (!fs.existsSync(statePath)) return { ...DEFAULT_WINDOW_STATE };
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_WINDOW_STATE };

    const width =
      typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? Math.max(MIN_WINDOW_WIDTH, Math.round(parsed.width))
        : DEFAULT_WINDOW_STATE.width;
    const height =
      typeof parsed.height === 'number' && Number.isFinite(parsed.height)
        ? Math.max(MIN_WINDOW_HEIGHT, Math.round(parsed.height))
        : DEFAULT_WINDOW_STATE.height;
    const isMaximized = Boolean(parsed.isMaximized);

    const candidate = {
      width,
      height,
      isMaximized,
      ...(typeof parsed.x === 'number' && Number.isFinite(parsed.x)
        ? { x: Math.round(parsed.x) }
        : {}),
      ...(typeof parsed.y === 'number' && Number.isFinite(parsed.y)
        ? { y: Math.round(parsed.y) }
        : {}),
    };

    if (
      typeof candidate.x === 'number' &&
      typeof candidate.y === 'number' &&
      !isBoundsVisibleOnDisplays(candidate)
    ) {
      delete candidate.x;
      delete candidate.y;
    }

    return candidate;
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

function captureWindowState(win, fallbackState) {
  if (!win || win.isDestroyed() || win.isMinimized()) {
    return fallbackState;
  }
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    isMaximized,
  };
}

function saveWindowStateSync(state) {
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // Ignorar error de escritura en disco al cerrar
  }
}

function configureAutoUpdater() {
  // Descarga silenciosa en segundo plano e instalación automática al cerrar si el usuario pospone el reinicio
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    console.info('[Ábaco AutoUpdater] Comprobando si hay nuevas versiones en GitHub...');
  });

  autoUpdater.on('update-available', (info) => {
    const nextVersion = info?.version ? `v${info.version}` : 'nueva versión';
    console.info(
      `[Ábaco AutoUpdater] Actualización disponible (${nextVersion}). Descargando silenciosamente en segundo plano...`
    );

    if (Notification.isSupported()) {
      try {
        new Notification({
          title: 'Actualización disponible — Ábaco Pizarra Virtual',
          body: `Se encontró la ${nextVersion} en GitHub. Se está descargando silenciosamente en segundo plano.`,
          silent: true,
        }).show();
      } catch {
        // Ignorar si el sistema operativo bloquea notificaciones
      }
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.info('[Ábaco AutoUpdater] La aplicación ya se encuentra en la última versión.');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = typeof progress?.percent === 'number' ? Math.round(progress.percent) : 0;
    if (pct > 0 && pct % 25 === 0) {
      console.info(`[Ábaco AutoUpdater] Descarga en curso: ${pct}%`);
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const readyVersion = info?.version ? `v${info.version}` : 'la nueva versión';
    console.info(
      `[Ábaco AutoUpdater] Actualización ${readyVersion} descargada y lista para instalar.`
    );

    if (updatePromptVisible) return;
    updatePromptVisible = true;

    try {
      const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const result = await dialog.showMessageBox(targetWindow, {
        type: 'info',
        title: 'Actualización lista — Ábaco Pizarra Virtual',
        message: `La actualización ${readyVersion} está lista para instalarse.`,
        detail:
          'La descarga finalizó en segundo plano. Puedes reiniciar ahora para aplicar los cambios o continuar trabajando e instalarla automáticamente al cerrar la aplicación.',
        buttons: ['Reiniciar e instalar ahora', 'Instalar al cerrar'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (result.response === 0) {
        setImmediate(() => {
          autoUpdater.quitAndInstall(false, true);
        });
      }
    } catch (err) {
      console.warn('[Ábaco AutoUpdater] No se pudo mostrar el aviso de instalación:', err?.message || err);
    } finally {
      updatePromptVisible = false;
    }
  });

  autoUpdater.on('error', (err) => {
    // Falla silenciosa pensada para uso nativo en PC sin conexión a internet
    console.warn('[Ábaco AutoUpdater] Sin conexión o error al verificar actualizaciones:', err?.message || err);
  });
}

configureAutoUpdater();

function createWindow() {
  let windowState = loadWindowState();
  let saveStateTimer = null;

  const scheduleSaveWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    windowState = captureWindowState(mainWindow, windowState);
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      saveWindowStateSync(windowState);
    }, 250);
  };

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(typeof windowState.x === 'number' && typeof windowState.y === 'number'
      ? { x: windowState.x, y: windowState.y }
      : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: 'Ábaco Pizarra Virtual',
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('maximize', scheduleSaveWindowState);
  mainWindow.on('unmaximize', scheduleSaveWindowState);
  mainWindow.on('close', () => {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    windowState = captureWindowState(mainWindow, windowState);
    saveWindowStateSync(windowState);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (app.isPackaged) {
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Native Windows file dialogs for .pizarra project export/import
ipcMain.handle('dialog:save-pizarra', async (_event, defaultName, jsonContent) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar proyecto de pizarra',
    defaultPath: defaultName || 'proyecto.pizarra',
    filters: [{ name: 'Proyecto Ábaco Pizarra Virtual', extensions: ['pizarra', 'json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, jsonContent, 'utf-8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('dialog:open-pizarra', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir proyecto de pizarra',
    properties: ['openFile'],
    filters: [{ name: 'Proyecto Ábaco Pizarra Virtual', extensions: ['pizarra', 'json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { canceled: false, filePath, content };
});
