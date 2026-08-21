const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lsnDesktop', Object.freeze({
  getPlatform: () => ipcRenderer.invoke('desktop:get-platform'),
  authRequest: (path, method, body) =>
    ipcRenderer.invoke('desktop:auth-request', { path, method, body }),
  getHardwareCapabilities: () =>
    ipcRenderer.invoke('desktop:hardware-capabilities'),
  // EtherNet/IP transport. The renderer can supply only an optional validated
  // IPv4 probe target; it can never set a host/port (the fixed EtherNet/IP
  // port lives in main) or touch raw sockets.
  hardwareDiscover: (address) =>
    ipcRenderer.invoke('desktop:hw-discover', { address }),
  hardwareConnect: (address) =>
    ipcRenderer.invoke('desktop:hw-connect', { address }),
  hardwareDisconnect: () => ipcRenderer.invoke('desktop:hw-disconnect'),
  getHardwareState: () => ipcRenderer.invoke('desktop:hw-get-state'),
  // Narrow SYMBOLIC profile operations only. The renderer never supplies a CIP
  // service, EPATH, raw bytes, or a profile; main resolves all of that. There
  // is no arbitrary write-symbol API — only the guarded enable workflow.
  hardwareGetProfileReadiness: () =>
    ipcRenderer.invoke('desktop:hw-profile-readiness'),
  hardwareReadField: (symbolicName) =>
    ipcRenderer.invoke('desktop:hw-read-field', { symbolicName }),
  hardwareArmControl: () => ipcRenderer.invoke('desktop:hw-arm-control'),
  hardwareWriteEnable: (enable) =>
    ipcRenderer.invoke('desktop:hw-write-enable', { enable }),
  onHardwareState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('desktop:hw-state', handler);
    return () => ipcRenderer.removeListener('desktop:hw-state', handler);
  },
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