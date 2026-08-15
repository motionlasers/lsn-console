import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron security boundary', () => {
  const main = readFileSync(resolve(import.meta.dirname, '../electron/main.cjs'), 'utf8');
  const preload = readFileSync(resolve(import.meta.dirname, '../electron/preload.cjs'), 'utf8');

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

  it('does not let the renderer choose an update URL, file path, or process command', () => {
    expect(preload).toContain('checkForUpdates: () =>');
    expect(preload).toContain('deferUpdate: () =>');
    expect(preload).toContain('installUpdate: () =>');
    expect(preload).not.toMatch(/checkForUpdates:\s*\([^)]*\w+[^)]*\)\s*=>/);
    expect(preload).not.toMatch(/installUpdate:\s*\([^)]*\w+[^)]*\)\s*=>/);
    expect(preload).not.toMatch(/deferUpdate:\s*\([^)]*\w+[^)]*\)\s*=>/);
  });
});