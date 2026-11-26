const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronDesktop', {
  isDesktop: true,
  platform: process.platform,
  savePizarraFile: (defaultName, jsonContent) =>
    ipcRenderer.invoke('dialog:save-pizarra', defaultName, jsonContent),
  openPizarraFile: () => ipcRenderer.invoke('dialog:open-pizarra'),
});
