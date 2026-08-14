const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isDev = !app.isPackaged;
const allowedChannels = new Set([
  'desktop:get-platform',
  'desktop:select-firmware',
  'desktop:hardware-capabilities',
  'desktop:save-file',
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b1118',
    title: 'LSN Engineering Console',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.LSN_DEV_SERVER_URL) {
    window.loadURL(process.env.LSN_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'public', 'index.html'));
  }
}

ipcMain.handle('desktop:get-platform', () => ({
  platform: process.platform,
  packaged: app.isPackaged,
  appVersion: app.getVersion(),
}));

// Native save dialog for engineering exports (reports, logs, support bundles,
// firmware packages). The renderer supplies only a suggested filename and the
// file bytes; the main process owns the filesystem write.
ipcMain.handle('desktop:save-file', async (_event, request) => {
  if (!request || typeof request.filename !== 'string') {
    return { saved: false, error: 'Invalid save request' };
  }
  const suggested = path.basename(request.filename);
  const result = await dialog.showSaveDialog({
    title: 'Save export',
    defaultPath: suggested,
  });
  if (result.canceled || !result.filePath) return { saved: false };
  const data = request.data;
  if (!(data instanceof Uint8Array) && typeof data !== 'string') {
    return { saved: false, error: 'Unsupported export payload' };
  }
  await fs.writeFile(result.filePath, data);
  return { saved: true, path: result.filePath };
});

ipcMain.handle('desktop:hardware-capabilities', () => ({
  controlTransport: 'AWAITING FIRMWARE IMPLEMENTATION',
  profileMapping: 'PROTOCOL MAPPING TBD',
  maintenanceTransport: 'MAINTENANCE ENDPOINT NOT YET IMPLEMENTED',
  physicalValidation: 'HARDWARE VALIDATION REQUIRED',
  canTransmit: false,
}));

ipcMain.handle('desktop:select-firmware', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select LSN firmware package',
    properties: ['openFile'],
    filters: [
      { name: 'LSN Firmware Packages', extensions: ['lsnfw', 'bin', 'json'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.on('desktop:invoke', (event, channel) => {
  if (!allowedChannels.has(channel)) {
    event.returnValue = { error: 'IPC channel not allowed' };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});