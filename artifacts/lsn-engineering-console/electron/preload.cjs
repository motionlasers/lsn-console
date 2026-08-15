const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lsnDesktop', Object.freeze({
  getPlatform: () => ipcRenderer.invoke('desktop:get-platform'),
  authRequest: (path, method, body) =>
    ipcRenderer.invoke('desktop:auth-request', { path, method, body }),
  getHardwareCapabilities: () =>
    ipcRenderer.invoke('desktop:hardware-capabilities'),
  selectFirmwarePackage: () =>
    ipcRenderer.invoke('desktop:select-firmware'),
  saveFile: (filename, data) =>
    ipcRenderer.invoke('desktop:save-file', { filename, data }),
  getUpdateState: () => ipcRenderer.invoke('desktop:updates-get-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:updates-check'),
  deferUpdate: () => ipcRenderer.invoke('desktop:updates-defer'),
  installUpdate: () => ipcRenderer.invoke('desktop:updates-install'),
  onUpdateState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('desktop:updates-state', handler);
    return () => ipcRenderer.removeListener('desktop:updates-state', handler);
  },
}));