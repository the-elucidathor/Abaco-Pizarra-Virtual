const { app, BrowserWindow, dialog, ipcMain, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow = null;
let updatePromptVisible = false;

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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
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
