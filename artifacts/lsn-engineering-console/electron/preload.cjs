const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lsnDesktop', Object.freeze({
  getPlatform: () => ipcRenderer.invoke('desktop:get-platform'),
  getHardwareCapabilities: () =>
    ipcRenderer.invoke('desktop:hardware-capabilities'),
  selectFirmwarePackage: () =>
    ipcRenderer.invoke('desktop:select-firmware'),
}));