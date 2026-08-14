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
});