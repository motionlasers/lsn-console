import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  HARDWARE_RUNTIME_ERROR,
  isPhysicalHardwareRuntime,
  assertPhysicalHardwareRuntime,
} = require('../electron/hardware-runtime.cjs') as {
  HARDWARE_RUNTIME_ERROR: string;
  isPhysicalHardwareRuntime: (runtime: { isPackaged: boolean; platform: string }) => boolean;
  assertPhysicalHardwareRuntime: (runtime: { isPackaged: boolean; platform: string }) => void;
};
const { isAllowedAuthRequest } = require('../electron/auth-route-policy.cjs') as {
  isAllowedAuthRequest: (path: string, method: string) => boolean;
};

describe('Electron security boundary', () => {
  const main = readFileSync(resolve(import.meta.dirname, '../electron/main.cjs'), 'utf8');
  const preload = readFileSync(resolve(import.meta.dirname, '../electron/preload.cjs'), 'utf8');
  const authPolicy = readFileSync(
    resolve(import.meta.dirname, '../electron/auth-route-policy.cjs'),
    'utf8',
  );

  it('uses isolation, sandboxing, and no renderer Node integration', () => {
    expect(main).toContain('contextIsolation: true');
    expect(main).toContain('nodeIntegration: false');
    expect(main).toContain('sandbox: true');
  });

  it('exposes a narrow preload API instead of ipcRenderer directly', () => {
    expect(preload).toContain('contextBridge.exposeInMainWorld');
    expect(preload).not.toContain("exposeInMainWorld('ipcRenderer'");
  });

  it('allowlists the native save channel and keeps writes in main', () => {
    expect(main).toContain("'desktop:save-file'");
    expect(main).toContain('showSaveDialog');
    // The renderer only supplies a suggested filename + bytes; main owns fs.
    expect(preload).not.toContain('require(\'node:fs');
    expect(preload).not.toContain('require("node:fs');
  });

  it('proxies only allowlisted desktop auth routes to the production HTTPS API', () => {
    expect(main).toContain("'desktop:auth-request'");
    expect(main).toContain('https://lsn.saberindustrial.net');
    expect(main).toContain("origin.protocol !== 'https:'");
    expect(main).toContain('isAllowedAuthRequest(pathname, method)');
    expect(main).toContain('event.sender.session.fetch');
    expect(preload).toContain("ipcRenderer.invoke('desktop:auth-request'");
  });

  it('allows only the narrow administrator activity bridge contracts', () => {
    expect(isAllowedAuthRequest('/api/activity/events', 'POST')).toBe(true);
    expect(isAllowedAuthRequest('/api/activity/events', 'GET')).toBe(false);
    expect(isAllowedAuthRequest('/api/admin/activity', 'GET')).toBe(true);
    expect(
      isAllowedAuthRequest(
        '/api/admin/activity?page=2&pageSize=50&actorId=42&category=AUTH&action=LOGIN&outcome=SUCCESS&targetType=SESSION&targetId=42&from=2024-01-01&to=2024-12-31',
        'GET',
      ),
    ).toBe(true);
    expect(isAllowedAuthRequest('/api/admin/activity', 'POST')).toBe(false);
    expect(isAllowedAuthRequest('/api/admin/activity?unknown=value', 'GET')).toBe(false);
    expect(isAllowedAuthRequest('/api/admin/activity?page=1&page=2', 'GET')).toBe(false);
    expect(isAllowedAuthRequest('/api/admin/activity?action=LOGIN%26admin%3Dtrue', 'GET')).toBe(false);
    expect(isAllowedAuthRequest('//evil.example/api/admin/activity', 'GET')).toBe(false);
  });

  it('uses the renderer persistent session for auth — no ephemeral in-memory partition', () => {
    // Cookie persistence across restarts depends on Electron's default on-disk
    // session. An in-memory partition (partition: 'in-memory' or session.fromPartition
    // with no 'persist:' prefix) would discard cookies on every app close, breaking
    // the stay-signed-in guarantee introduced in v0.2.1.
    expect(main).not.toMatch(/partition\s*:\s*['"]in-memory['"]/);
    expect(main).not.toMatch(/fromPartition\s*\(/);
    // Auth requests must flow through event.sender.session (the window's own
    // on-disk session), not a separately constructed session object.
    expect(main).toMatch(/event\.sender\.session\.fetch/);
    expect(main).not.toMatch(/session\.defaultSession\.fetch/);
    expect(main).not.toMatch(/new\s+Session\s*\(/);
  });

  it('exposes authRequest through the preload bridge so the renderer never calls fetch directly', () => {
    // If the renderer called fetch() directly from file://, the URL would not
    // resolve and the app would get a Network error on every auth attempt.
    expect(preload).toContain('authRequest');
    expect(preload).toContain("ipcRenderer.invoke('desktop:auth-request'");
    // The preload must NOT import node:http, node:https, or fetch polyfills —
    // all network I/O must stay in the main process.
    expect(preload).not.toMatch(/require\(['"]node:https?['"]\)/);
    expect(preload).not.toMatch(/require\(['"]https?['"]\)/);
    expect(preload).not.toContain('global.fetch');
  });

  it('keeps update networking, verification, files, and installer launch in main', () => {
    expect(main).toContain("require('./update-service.cjs')");
    expect(main).toContain('inspectWindowsInstallerSignature');
    expect(main).toContain('classifyPublisherSignature');
    expect(main).toContain('confirmUnsignedInstaller');
    expect(main).toContain('dialog.showMessageBox');
    expect(main).toContain('More info');
    expect(main).toContain('Run anyway');
    expect(main).toContain("'powershell.exe'");
    expect(main).toContain('spawn(installerPath, []');
    expect(main).not.toContain("'--silent'");
    expect(preload).toContain("ipcRenderer.invoke('desktop:updates-check')");
    expect(preload).toContain("ipcRenderer.invoke('desktop:updates-defer')");
    expect(preload).toContain("ipcRenderer.invoke('desktop:updates-install')");
    expect(preload).not.toContain('LSN_UPDATE_INSTALLER');
    expect(preload).not.toContain('releases/latest');
  });

  it('keeps EtherNet/IP transport in main behind a narrow preload surface', () => {
    // Transport modules live in main; the port is fixed and never renderer-set.
    expect(main).toContain("require('./hardware-service.cjs')");
    expect(main).toContain("'desktop:hw-discover'");
    expect(main).toContain("'desktop:hw-connect'");
    expect(main).toContain("'desktop:hw-disconnect'");
    // Renderer supplies only an optional address for discovery/connect.
    expect(preload).toContain('hardwareDiscover');
    expect(preload).toContain('hardwareConnect');
    expect(preload).toContain('onHardwareState');
    // The preload must NOT expose ipcRenderer, raw sockets, or arbitrary
    // host/port controls to the renderer.
    expect(preload).not.toContain("exposeInMainWorld('ipcRenderer'");
    expect(preload).not.toMatch(/require\(['"]node:net['"]\)/);
    expect(preload).not.toMatch(/require\(['"]node:dgram['"]\)/);
    expect(preload).not.toContain('createSocket');
    expect(preload).not.toContain('44818');
  });

  it('authorizes physical transport only in packaged Windows', () => {
    expect(isPhysicalHardwareRuntime({ isPackaged: true, platform: 'win32' })).toBe(true);
    expect(isPhysicalHardwareRuntime({ isPackaged: false, platform: 'win32' })).toBe(false);
    expect(isPhysicalHardwareRuntime({ isPackaged: true, platform: 'linux' })).toBe(false);
    expect(isPhysicalHardwareRuntime({ isPackaged: true, platform: 'darwin' })).toBe(false);
    expect(() =>
      assertPhysicalHardwareRuntime({ isPackaged: false, platform: 'win32' }),
    ).toThrow(HARDWARE_RUNTIME_ERROR);
    expect(() =>
      assertPhysicalHardwareRuntime({ isPackaged: true, platform: 'linux' }),
    ).toThrow(HARDWARE_RUNTIME_ERROR);
  });

  it('guards service construction and every physical hardware IPC operation', () => {
    const serviceFactory = main.match(
      /function getHardwareService\(\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? '';
    expect(serviceFactory).toContain('assertPhysicalHardwareRuntime');
    expect(serviceFactory.indexOf('assertPhysicalHardwareRuntime')).toBeLessThan(
      serviceFactory.indexOf('new HardwareService'),
    );

    const guardedChannels = [
      'desktop:hw-discover',
      'desktop:hw-connect',
      'desktop:hw-disconnect',
      'desktop:hw-get-state',
      'desktop:hw-profile-readiness',
      'desktop:hw-read-field',
      'desktop:hw-arm-control',
      'desktop:hw-write-enable',
    ];
    for (const channel of guardedChannels) {
      const start = main.indexOf(`ipcMain.handle('${channel}'`);
      expect(start, `${channel} is registered`).toBeGreaterThanOrEqual(0);
      const nextHandler = main.indexOf('ipcMain.handle(', start + 20);
      const handler = main.slice(start, nextHandler < 0 ? undefined : nextHandler);
      expect(handler, `${channel} delegates through guarded service access`).toContain(
        'getHardwareService()',
      );
    }
  });

  it('exposes only narrow symbolic profile operations, never raw CIP access', () => {
    // No raw explicit-request surface may exist anywhere in the boundary.
    expect(preload).not.toContain('hardwareExplicitRequest');
    expect(preload).not.toContain('desktop:hw-explicit-request');
    expect(main).not.toContain('desktop:hw-explicit-request');
    expect(main).not.toContain('explicitRequest');
    // The renderer may only invoke symbolic operations; it never supplies a CIP
    // service, EPATH, raw bytes, or a profile document.
    expect(preload).toContain('hardwareGetProfileReadiness');
    expect(preload).toContain('hardwareReadField');
    expect(preload).toContain('hardwareArmControl');
    expect(preload).toContain('hardwareWriteEnable');
    expect(preload).not.toContain('cipRequest');
    expect(preload).not.toContain('epath');
    expect(preload).not.toContain('serviceCode');
    // No arbitrary write-symbol API — only the guarded enable workflow.
    expect(preload).not.toMatch(/hardwareWriteField/);
    // Arm control requires a native physical-output consent dialog in main.
    expect(main).toContain('confirmArmControl');
    expect(main).toContain('dialog.showMessageBox');
    expect(main).toContain('emission-control output');
  });

  it('loads and pins the bundled profile in main, never from the renderer', () => {
    const profileOps = readFileSync(
      resolve(import.meta.dirname, '../electron/profile-operations.cjs'),
      'utf8',
    );
    expect(profileOps).toContain('lsn-v0.1.json');
    expect(profileOps).toContain('deepFreeze');
    expect(profileOps).toContain("createHash('sha256')");
    // The renderer never provides a profile path or document.
    expect(preload).not.toContain('lsn-v0.1');
    expect(preload).not.toContain('loadProfile');
  });

  it('fixes the EtherNet/IP port to 44818 and validates IPv4 in main', () => {
    const transport = readFileSync(
      resolve(import.meta.dirname, '../electron/ethernet-ip-transport.cjs'),
      'utf8',
    );
    expect(transport).toContain('ENIP_PORT = 44818');
    expect(transport).toContain('isValidIpv4');
    // No enable command, no implicit I/O, no guessed CIP object mappings.
    expect(transport).not.toMatch(/enableEmission|sendEnable|forwardOpen/i);
  });

  it('keeps Development Profile fetch/verify/stage/activate/rollback in main', () => {
    // The profile update trust boundary lives in main and its own module.
    expect(main).toContain("require('./profile-update-service.cjs')");
    expect(main).toContain('ProfileUpdateService');
    expect(main).toContain('configureProfileUpdates');
    // Main fetches from the fixed authenticated origin via net.fetch with
    // credentials; the renderer never supplies an origin or path.
    expect(main).toContain('apiOrigin: getApiOrigin()');
    expect(main).toContain("credentials: 'include'");
    // Activation applies to the hardware service (forced disconnect + identity
    // revalidation) only inside the packaged Windows hardware runtime.
    expect(main).toContain('applyActiveProfileToHardware');
    expect(main).toContain('setActiveProfile');
    expect(main).toContain('isPhysicalHardwareRuntime');
    // The main-process activation IPC is explicit and digest-scoped.
    expect(main).toContain("ipcMain.handle('desktop:profile-check'");
    expect(main).toContain("ipcMain.handle('desktop:profile-activate'");
    expect(main).toContain("ipcMain.handle('desktop:profile-rollback'");
    expect(authPolicy).toContain("/^\\/api\\/profiles\\/\\d+\\/draft$/");
    expect(authPolicy).toContain("/^\\/api\\/profiles\\/reviews\\/\\d+\\/decision$/");
    expect(authPolicy).toContain("/^\\/api\\/profiles\\/versions\\/\\d+\\/verify-hardware$/");
    expect(authPolicy).toContain("/^\\/api\\/profiles\\/diff\\?from=\\d+&to=\\d+$/");
  });

  it('exposes only sanitized profile-channel operations to the renderer', () => {
    // Preload exposes explicit, argument-narrow transitions and observation.
    expect(preload).toContain('getProfileChannelState');
    expect(preload).toContain('checkForProfileUpdate');
    expect(preload).toContain('activateProfileUpdate');
    expect(preload).toContain('rollbackProfile');
    expect(preload).toContain('onProfileChannelState');
    expect(preload).toContain("ipcRenderer.invoke('desktop:profile-check'");
    expect(preload).toContain("ipcRenderer.invoke('desktop:profile-activate'");
    // The renderer can never supply a profile document, path, URL, or CIP
    // mapping through the profile channel — only an optional activation digest.
    expect(preload).not.toContain('artifactUrl');
    expect(preload).not.toContain('artifactPath');
    expect(preload).not.toMatch(/checkForProfileUpdate:\s*\([^)]*\w+[^)]*\)\s*=>/);
    // Activation carries only a narrow digest string, never a document.
    expect(preload).toContain('activateProfileUpdate: (digest) =>');
  });

  it('never lets a renderer-supplied profile document reach the update service', () => {
    const updateService = readFileSync(
      resolve(import.meta.dirname, '../electron/profile-update-service.cjs'),
      'utf8',
    );
    // The service verifies digest, schema, protocol, identity, firmware,
    // mapping readiness, and version policy in main.
    expect(updateService).toContain('validateProfileSchema');
    expect(updateService).toContain("createHash('sha256')");
    expect(updateService).toContain('version_downgrade_blocked');
    expect(updateService).toContain('hardware_family_mismatch');
    expect(updateService).toContain('protocol_incompatible');
    expect(updateService).toContain('firmware_incompatible');
    expect(updateService).toContain('origin_violation');
    // Atomic active + last-known-good storage with forced disconnect on apply.
    expect(updateService).toContain('_writeEntryAtomic');
    expect(updateService).toContain('last-known-good');
    expect(updateService).toContain('rollback');
    // Only sanitized metadata is exposed — never a raw document with mappings.
    expect(updateService).toContain('sanitizeEntry');
    // The renderer never provides the fetch, origin, or profile path.
    expect(preload).not.toContain('profile-update-service');
    expect(preload).not.toContain('profile-artifact');
  });

  it('does not let the renderer choose an update URL, file path, or process command', () => {
    expect(preload).toContain('checkForUpdates: () =>');
    expect(preload).toContain('deferUpdate: () =>');
    expect(preload).toContain('installUpdate: () =>');
    expect(preload).not.toMatch(/checkForUpdates:\s*\([^)]*\w+[^)]*\)\s*=>/);
    expect(preload).not.toMatch(/installUpdate:\s*\([^)]*\w+[^)]*\)\s*=>/);
    expect(preload).not.toMatch(/deferUpdate:\s*\([^)]*\w+[^)]*\)\s*=>/);
  });
});