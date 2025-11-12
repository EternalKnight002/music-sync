const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// expose ipc calls (unchanged)
contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  startFileServer: (filePath) => ipcRenderer.invoke('start-file-server', filePath),
  stopFileServer: () => ipcRenderer.invoke('stop-file-server'),
  getLanIp: () => ipcRenderer.invoke('get-lan-ip')
});


let signalingUrl = process.env.SIGNALING_URL || null;


try {
  
  const cfgPath = path.join(process.resourcesPath || __dirname, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (!signalingUrl && cfg.SIGNALING_URL) signalingUrl = cfg.SIGNALING_URL;
  }
} catch (e) {
  console.error('Error reading runtime config.json:', e);
}

contextBridge.exposeInMainWorld('CONFIG', {
  SIGNALING_URL: signalingUrl
});
