const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');

autoUpdater.on('error', (err) => {
  console.warn('[Ábaco AutoUpdater] No se pudo verificar actualizaciones:', err?.message || err);
});

let mainWindow = null;

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
