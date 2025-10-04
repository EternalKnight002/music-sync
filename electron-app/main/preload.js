const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  startFileServer: (filePath) => ipcRenderer.invoke('start-file-server', filePath),
  stopFileServer: () => ipcRenderer.invoke('stop-file-server'),
  getLanIp: () => ipcRenderer.invoke('get-lan-ip')
});