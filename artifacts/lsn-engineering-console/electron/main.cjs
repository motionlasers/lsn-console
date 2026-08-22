const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const { execFile } = require('node:child_process');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const {
  WindowsUpdateService,
  classifyPublisherSignature,
} = require('./update-service.cjs');
const { HardwareService } = require('./hardware-service.cjs');
const {
  isPhysicalHardwareRuntime,
  assertPhysicalHardwareRuntime,
} = require('./hardware-runtime.cjs');
const { ProfileUpdateService } = require('./profile-update-service.cjs');
const { createCiProfileSmokeFetch } = require('./ci-profile-smoke-fetch.cjs');
const { isAllowedAuthRequest } = require('./auth-route-policy.cjs');

const isDev = !app.isPackaged;
let hardwareService = null;
const DEFAULT_API_ORIGIN = 'https://lsn.saberindustrial.net';
const EXPECTED_UPDATE_PUBLISHER = 'Saber Industrial Applications';
const execFileAsync = promisify(execFile);
let updateService = null;
let updateReadyPromise = Promise.resolve();
let profileUpdateService = null;
let profileReadyPromise = Promise.resolve();
const allowedChannels = new Set([
  'desktop:get-platform',
  'desktop:select-firmware',
  'desktop:hardware-capabilities',
  'desktop:save-file',
  'desktop:hw-discover',
  'desktop:hw-connect',
  'desktop:hw-disconnect',
  'desktop:hw-get-state',
  'desktop:hw-profile-readiness',
  'desktop:hw-read-field',
  'desktop:hw-arm-control',
  'desktop:hw-write-enable',
  'desktop:profile-get-state',
  'desktop:profile-check',
  'desktop:profile-activate',
  'desktop:profile-rollback',
  'desktop:profile-discard-staged',
]);

function getApiOrigin() {
  const origin = new URL(process.env.LSN_API_BASE_URL || DEFAULT_API_ORIGIN);
  if (app.isPackaged && origin.protocol !== 'https:') {
    throw new Error('Packaged desktop API origin must use HTTPS');
  }
  return origin.origin;
}

function getCiProfileSmokeFetch() {
  return createCiProfileSmokeFetch({
    env: process.env,
    isPackaged: app.isPackaged,
    platform: process.platform,
    apiOrigin: getApiOrigin(),
    nodeFetch: globalThis.fetch.bind(globalThis),
  });
}

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
  return window;
}

async function inspectWindowsInstallerSignature(installerPath) {
  if (process.platform !== 'win32') return 'invalid';
  const script = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:LSN_UPDATE_INSTALLER',
    '[PSCustomObject]@{',
    'Status = [string]$signature.Status',
    'Subject = [string]$signature.SignerCertificate.Subject',
    'Publisher = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { "" }',
    '} | ConvertTo-Json -Compress',
  ].join('; ');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      env: { ...process.env, LSN_UPDATE_INSTALLER: installerPath },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 64 * 1024,
    },
  );
  const signature = JSON.parse(stdout);
  return classifyPublisherSignature(signature, EXPECTED_UPDATE_PUBLISHER);
}

async function confirmUnsignedInstaller(update) {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Install unsigned Development Preview?',
    message: `Install LSN Engineering Console v${update.version}?`,
    detail:
      'The published SHA-256 checksum was verified, but this installer is not code-signed. Windows SmartScreen will warn when it opens. Choose More info, then Run anyway in the Windows warning.',
    buttons: ['Install now', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0;
}

async function launchVerifiedInstaller(installerPath) {
  // Squirrel's Setup.exe is itself the bootstrapper for a full install/update.
  // It does not use NSIS/Inno-style silent flags.
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  app.quit();
}

function broadcastUpdateState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop:updates-state', state);
    }
  }
}

function configureWindowsUpdates() {
  updateService = new WindowsUpdateService({
    currentVersion: app.getVersion(),
    supported: app.isPackaged && process.platform === 'win32',
    fetch: (url, options) => net.fetch(url, options),
    updatesDir: path.join(app.getPath('userData'), 'updates'),
    inspectSignature: inspectWindowsInstallerSignature,
    confirmInstall: confirmUnsignedInstaller,
    launchInstaller: launchVerifiedInstaller,
    onStateChange: broadcastUpdateState,
  });
  updateReadyPromise = updateService.initialize();
  void updateReadyPromise.then(() => {
    const delay = process.argv.includes('--squirrel-firstrun') ? 10_000 : 5_000;
    const timer = setTimeout(() => {
      void updateService.check();
    }, delay);
    timer.unref();
  });
}

function broadcastProfileState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop:profile-state', state);
    }
  }
}

// Apply a newly-activated (or rolled-back) profile to the authoritative
// hardware service. The renderer never reaches this path; only the main-process
// profile update service invokes it after independent verification. Repinning
// forces a hardware disconnect and identity revalidation. Outside the packaged
// Windows hardware runtime there is no transport to repin, so this is a no-op.
async function applyActiveProfileToHardware(document, meta) {
  if (
    !isPhysicalHardwareRuntime({
      isPackaged: app.isPackaged,
      platform: process.platform,
    })
  ) {
    return;
  }
  await getHardwareService().setActiveProfile(document, meta?.digest);
}

function configureProfileUpdates() {
  const ciProfileSmokeFetch = getCiProfileSmokeFetch();
  profileUpdateService = new ProfileUpdateService({
    apiOrigin: getApiOrigin(),
    // Network I/O stays in main and flows through the default persistent
    // session (net.fetch) so authenticated cookies are attached; the renderer
    // never chooses an origin, path, or supplies a profile document.
    fetch: ciProfileSmokeFetch ??
      ((url, options) => net.fetch(url, { ...options, credentials: 'include' })),
    profilesDir: path.join(app.getPath('userData'), 'profiles'),
    onStateChange: broadcastProfileState,
    onActivate: applyActiveProfileToHardware,
  });
  profileReadyPromise = profileUpdateService.initialize();
}

ipcMain.handle('desktop:get-platform', () => ({
  platform: process.platform,
  packaged: app.isPackaged,
  appVersion: app.getVersion(),
}));

ipcMain.handle('desktop:updates-get-state', async () => {
  await updateReadyPromise;
  return updateService?.getState() ?? {
    status: 'unsupported',
    currentVersion: app.getVersion(),
    message: 'Automatic updates are not available in this runtime.',
    canRetry: false,
  };
});

ipcMain.handle('desktop:updates-check', async () => {
  await updateReadyPromise;
  return updateService?.check();
});

ipcMain.handle('desktop:updates-defer', async () => {
  await updateReadyPromise;
  return updateService?.defer();
});

ipcMain.handle('desktop:updates-install', async () => {
  await updateReadyPromise;
  return updateService?.install();
});

// --- Development Profile update channel ------------------------------------
// All fetch/verify/stage/activate/rollback runs in main via the profile update
// service. The renderer only observes sanitized metadata and triggers explicit
// actions; it can never supply a URL, path, profile document, or CIP mapping.

ipcMain.handle('desktop:profile-get-state', async () => {
  await profileReadyPromise;
  return profileUpdateService?.getState() ?? null;
});

ipcMain.handle('desktop:profile-check', async () => {
  await profileReadyPromise;
  return profileUpdateService?.check() ?? null;
});

ipcMain.handle('desktop:profile-activate', async (_event, request) => {
  await profileReadyPromise;
  if (!profileUpdateService) return null;
  const digest = request?.digest;
  if (digest !== undefined && typeof digest !== 'string') {
    throw new Error('Invalid activation digest');
  }
  try {
    return await profileUpdateService.activate({ digest });
  } catch (error) {
    return {
      ...profileUpdateService.getState(),
      error: {
        code: error?.code ?? 'activation_failed',
        issues: error?.issues ?? [
          { code: error?.code ?? 'activation_failed', message: String(error?.message ?? error) },
        ],
      },
    };
  }
});

ipcMain.handle('desktop:profile-rollback', async (_event, request) => {
  await profileReadyPromise;
  if (!profileUpdateService) return null;
  const toBundled = request?.toBundled === true;
  return profileUpdateService.rollback({ toBundled });
});

ipcMain.handle('desktop:profile-discard-staged', async () => {
  await profileReadyPromise;
  return profileUpdateService?.discardStaged() ?? null;
});

ipcMain.handle('desktop:auth-request', async (event, request) => {
  const pathname = request?.path;
  const method = request?.method ?? 'GET';
  const body = request?.body;

  if (
    typeof pathname !== 'string' ||
    typeof method !== 'string' ||
    !isAllowedAuthRequest(pathname, method)
  ) {
    return { status: 400, body: { error: 'Desktop auth request not allowed' } };
  }
  if (body !== undefined && (typeof body !== 'string' || body.length > 65_536)) {
    return { status: 400, body: { error: 'Invalid desktop auth request body' } };
  }

  const url = new URL(pathname, getApiOrigin());
  const options = {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body,
  };
  const ciProfileSmokeFetch = getCiProfileSmokeFetch();
  const response = ciProfileSmokeFetch
    ? await ciProfileSmokeFetch(url, options)
    : await event.sender.session.fetch(url, options);
  const responseBody = await response.json().catch(() => ({}));
  return { status: response.status, body: responseBody };
});

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

ipcMain.handle('desktop:hardware-capabilities', () => {
  // Standard EtherNet/IP discovery + session can transmit in the packaged
  // Windows runtime. Profile-driven control readiness is derived dynamically
  // from the pinned profile; the current TBD profile keeps it false.
  const transportCapable = isPhysicalHardwareRuntime({
    isPackaged: app.isPackaged,
    platform: process.platform,
  });
  const readiness = transportCapable
    ? getHardwareService().getProfileReadiness()
    : { controlReady: false, readReady: false };
  return {
    controlTransport: 'AWAITING FIRMWARE IMPLEMENTATION',
    profileMapping: 'PROTOCOL MAPPING TBD',
    maintenanceTransport: 'MAINTENANCE ENDPOINT NOT YET IMPLEMENTED',
    physicalValidation: 'HARDWARE VALIDATION REQUIRED',
    canTransmit: false,
    discoveryTransport: transportCapable,
    sessionTransport: transportCapable,
    profileControl: transportCapable && readiness.controlReady === true,
    profileRead: transportCapable && readiness.readReady === true,
  };
});

function broadcastHardwareState(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop:hw-state', state);
    }
  }
}

// Native physical-output consent used to mint an arm token. The renderer can
// never bypass this; only an explicit operator confirmation returns true.
async function confirmArmControl() {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Arm physical emission control?',
    message: 'Arm the LSN emission-control output?',
    detail:
      'Arming permits a subsequent enable request to energize the physical ' +
      'emission-control output on the connected LSN hardware. Ensure the work ' +
      'area is safe and all personnel are clear before continuing. The arm is ' +
      'single-use and expires shortly.',
    buttons: ['Arm control', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return result.response === 0;
}

function getHardwareService() {
  assertPhysicalHardwareRuntime({
    isPackaged: app.isPackaged,
    platform: process.platform,
  });
  if (!hardwareService) {
    hardwareService = new HardwareService({
      onStateChange: broadcastHardwareState,
      confirmArm: confirmArmControl,
    });
  }
  return hardwareService;
}

// EtherNet/IP discovery. Fixed port 44818 is enforced inside the transport;
// the renderer may only supply an optional validated IPv4 probe target.
ipcMain.handle('desktop:hw-discover', async (_event, request) => {
  const address = request?.address;
  if (address !== undefined && typeof address !== 'string') {
    throw new Error('Invalid discovery request');
  }
  return getHardwareService().discover({ address });
});

ipcMain.handle('desktop:hw-connect', async (_event, request) => {
  const address = request?.address;
  if (typeof address !== 'string') {
    throw new Error('Connect requires an IPv4 address');
  }
  return getHardwareService().connect(address);
});

ipcMain.handle('desktop:hw-disconnect', async () => {
  return getHardwareService().disconnect();
});

ipcMain.handle('desktop:hw-get-state', () => getHardwareService().getState());

// Narrow symbolic profile operations. The renderer never supplies a CIP
// service, EPATH, raw bytes, or a profile document; main resolves everything.
ipcMain.handle('desktop:hw-profile-readiness', () =>
  getHardwareService().getProfileReadiness(),
);

ipcMain.handle('desktop:hw-read-field', async (_event, request) => {
  const symbolicName = request?.symbolicName;
  if (typeof symbolicName !== 'string') {
    throw new Error('readField requires a symbolic field name');
  }
  return getHardwareService().readField(symbolicName);
});

ipcMain.handle('desktop:hw-arm-control', async () =>
  getHardwareService().armControl(),
);

ipcMain.handle('desktop:hw-write-enable', async (_event, request) => {
  const enable = request?.enable;
  if (typeof enable !== 'boolean') {
    throw new Error('writeEnable requires a boolean');
  }
  return getHardwareService().writeEnable(enable);
});

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
  configureWindowsUpdates();
  configureProfileUpdates();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

async function shutdownHardwareTransport() {
  if (hardwareService) {
    try {
      await hardwareService.close();
    } catch {
      // teardown errors are non-fatal
    }
  }
}

app.on('window-all-closed', () => {
  void shutdownHardwareTransport();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void shutdownHardwareTransport();
});