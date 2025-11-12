const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] Starting preload script');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => {
    console.log('[PRELOAD] selectFile called');
    return ipcRenderer.invoke('select-file');
  },
  startFileServer: (filePath) => {
    console.log('[PRELOAD] startFileServer called');
    return ipcRenderer.invoke('start-file-server', filePath);
  },
  stopFileServer: () => {
    console.log('[PRELOAD] stopFileServer called');
    return ipcRenderer.invoke('stop-file-server');
  },
  getLanIp: () => {
    console.log('[PRELOAD] getLanIp called');
    return ipcRenderer.invoke('get-lan-ip');
  }
});

console.log('[PRELOAD] electronAPI exposed');
console.log('[PRELOAD] Preload script completed');