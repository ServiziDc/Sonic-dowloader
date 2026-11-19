const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dlmgr', {
  onInit:     (cb) => ipcRenderer.on('dlmgr-init', (_, data) => cb(data)),
  onItemStart:(cb) => ipcRenderer.on('dlmgr-item-start', (_, data) => cb(data)),
  onItemDone: (cb) => ipcRenderer.on('dlmgr-item-done', (_, data) => cb(data)),
  onBulkComplete: (cb) => ipcRenderer.on('dlmgr-bulk-complete', (_, data) => cb(data)),
  onAllDone:  (cb) => ipcRenderer.on('dlmgr-all-done', () => cb()),
  stopOrClose: () => ipcRenderer.send('dlmgr-stop-or-close'),
});
