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
}));