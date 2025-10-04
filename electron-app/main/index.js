const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { startFileServer, stopFileServer, getServerUrl } = require('./fileServer');
const { getLanIp, calculateChecksum } = require('./utils');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopFileServer();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// Open file dialog and return file path
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled) {
    return null;
  }

  const filePath = result.filePaths[0];
  
  // Calculate checksum for track identification
  try {
    const checksum = await calculateChecksum(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      checksum
    };
  } catch (err) {
    console.error('Error calculating checksum:', err);
    throw err;
  }
});

// Start file server for hosting
ipcMain.handle('start-file-server', async (event, filePath) => {
  try {
    const port = 3000;
    await startFileServer(filePath, port);
    
    const lanIp = getLanIp();
    const url = getServerUrl(lanIp, port);
    
    return {
      success: true,
      url,
      port
    };
  } catch (err) {
    console.error('Failed to start file server:', err);
    return {
      success: false,
      error: err.message
    };
  }
});

// Stop file server
ipcMain.handle('stop-file-server', async () => {
  stopFileServer();
  return { success: true };
});

// Get LAN IP
ipcMain.handle('get-lan-ip', () => {
  return getLanIp();
});

// Graceful shutdown
app.on('before-quit', () => {
  stopFileServer();
});