import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import consolePackage from '../package.json' with { type: 'json' };
import {
  CONSOLE_RELEASES,
  CONSOLE_RELEASE_LABEL,
  CONSOLE_VERSION,
  CURRENT_RELEASE,
  RELEASE_ASSET_BASE_URL,
  RELEASE_ASSET_ROOT_URL,
  VERSION_TRACKS,
  WINDOWS_ARTIFACTS,
  getProtocolImpactSummary,
  getReleaseExportMetadata,
  normalizeReleaseAssetRoot,
  releaseAssetUrl,
  releaseRequiresFirmwareAction,
  type ConsoleRelease,
} from '../src/lib/release';
import {
  WHATS_NEW_STORAGE_KEY,
  acknowledgeWhatsNew,
  getAcknowledgedWhatsNewVersion,
  shouldShowWhatsNew,
} from '../src/lib/whats-new';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Release identity', () => {
  it('centralizes the Console version from package.json', () => {
    expect(CONSOLE_VERSION).toBe(consolePackage.version);
    expect(CONSOLE_VERSION).toBe('0.3.0');
    expect(CONSOLE_RELEASE_LABEL).toBe('v0.3.0 Development Preview');
    expect(CURRENT_RELEASE.version).toBe(CONSOLE_VERSION);
    expect(CURRENT_RELEASE.releaseType).toBe('development-preview');
  });

  it('keeps the external interface tracks at v0.1', () => {
    expect(VERSION_TRACKS.protocol.version).toBe('LSN v0.1');
    expect(VERSION_TRACKS.deviceProfile.version).toBe('0.1.0');
    expect(VERSION_TRACKS.firmwareInterface.label).toBe('LSN-Firmware-Interface-v0.1');
  });

  it('matches the active Device Profile document', () => {
    const profile = JSON.parse(read('profiles/lsn-v0.1.json'));
    expect(profile.profileVersion).toBe(VERSION_TRACKS.deviceProfile.version);
    expect(profile.protocolVersion).toBe(VERSION_TRACKS.protocol.version);
  });

  it('names the Windows artifacts for the current version', () => {
    expect(WINDOWS_ARTIFACTS.installer).toBe('LSN-Engineering-Console-Setup-0.3.0-dev.exe');
    expect(WINDOWS_ARTIFACTS.portable).toBe('LSN-Engineering-Console-Portable-0.3.0.zip');
    expect(WINDOWS_ARTIFACTS.releaseTag).toBe('lsn-console-v0.3.0');
    expect(WINDOWS_ARTIFACTS.signed).toBe(false);
  });

  it('pins download URLs to the matching immutable release tag', () => {
    expect(RELEASE_ASSET_ROOT_URL).toBe(
      'https://github.com/motionlasers/lsn-console/releases/download',
    );
    expect(RELEASE_ASSET_BASE_URL).toBe(
      'https://github.com/motionlasers/lsn-console/releases/download/lsn-console-v0.3.0',
    );
    expect(releaseAssetUrl(WINDOWS_ARTIFACTS.installer)).toBe(
      'https://github.com/motionlasers/lsn-console/releases/download/lsn-console-v0.3.0/LSN-Engineering-Console-Setup-0.3.0-dev.exe',
    );
    expect(releaseAssetUrl(WINDOWS_ARTIFACTS.portable)).toBe(
      'https://github.com/motionlasers/lsn-console/releases/download/lsn-console-v0.3.0/LSN-Engineering-Console-Portable-0.3.0.zip',
    );
  });

  it('migrates legacy moving or version-specific release roots', () => {
    expect(normalizeReleaseAssetRoot(
      'https://github.com/motionlasers/lsn-console/releases/latest/download',
    )).toBe('https://github.com/motionlasers/lsn-console/releases/download');
    expect(normalizeReleaseAssetRoot(
      'https://github.com/motionlasers/lsn-console/releases/download/lsn-console-v0.2.0/',
    )).toBe('https://github.com/motionlasers/lsn-console/releases/download');
  });

  it('keeps the Forge installer name in sync with the artifact identity', async () => {
    // Load the actual resolved maker configuration, not a simulated string.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const forgeConfig = require(resolve(root, 'forge.config.cjs'));
    const squirrel = forgeConfig.makers.find(
      (maker: { name: string }) => maker.name === '@electron-forge/maker-squirrel',
    );
    expect(squirrel.config.setupExe).toBe(WINDOWS_ARTIFACTS.installer);
    expect(squirrel.config).toHaveProperty('certificateFile');
    expect(squirrel.config).toHaveProperty('certificatePassword');
  });
});

describe('Changelog completeness', () => {
  const changelog = read('CHANGELOG.md');

  it('is reverse-chronological and preserves the historical 0.1.0 entry', () => {
    const headings = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)/gm)].map(m => m[1]);
    expect(headings).toEqual(CONSOLE_RELEASES.map(release => release.version));
    expect(headings).toContain('0.1.0');
  });

  it('contains a dated v0.3.0 Development Preview entry with required sections', () => {
    expect(changelog).toMatch(/^## 0\.3\.0 — Development Preview \(2026-08-21\)/m);
    for (const section of ['### Added', '### Changed', '### Fixed', '### Known limitations', '### Protocol impact', '### Device Profile impact']) {
      expect(changelog).toContain(section);
    }
    expect(changelog).toContain('No protocol impact');
    expect(changelog).toContain('Device Profile unchanged');
    expect(changelog).toContain('LSN-Firmware-Interface-v0.1.zip');
  });

  it('mirrors every in-app release record (derivation check)', () => {
    for (const release of CONSOLE_RELEASES) {
      expect(changelog).toContain(`## ${release.version}`);
      expect(changelog).toContain(`(${release.date})`);
      for (const item of [...release.added, ...release.knownLimitations]) {
        expect(changelog).toContain(item);
      }
      expect(changelog).toContain(release.protocolImpactStatement);
      expect(changelog).toContain(release.deviceProfileImpactStatement);
    }
  });
});

describe('Protocol impact messaging', () => {
  const releaseWith = (impact: ConsoleRelease['protocolImpact']): ConsoleRelease => ({
    ...CURRENT_RELEASE,
    protocolImpact: impact,
    protocolImpactStatement: 'statement',
  });

  it('does not warn for Console-only releases', () => {
    expect(releaseRequiresFirmwareAction(releaseWith('none'))).toBe(false);
    expect(getProtocolImpactSummary(releaseWith('none')).tone).toBe('info');
  });

  it('escalates additive and breaking protocol changes', () => {
    expect(releaseRequiresFirmwareAction(releaseWith('additive'))).toBe(true);
    expect(getProtocolImpactSummary(releaseWith('additive')).tone).toBe('warning');
    expect(releaseRequiresFirmwareAction(releaseWith('breaking'))).toBe(true);
    const breaking = getProtocolImpactSummary(releaseWith('breaking'));
    expect(breaking.tone).toBe('critical');
    expect(breaking.headline).toContain('FIRMWARE ACTION REQUIRED');
  });

  it('declares no protocol or profile impact for the current release', () => {
    expect(CURRENT_RELEASE.protocolImpact).toBe('none');
    expect(releaseRequiresFirmwareAction(CURRENT_RELEASE)).toBe(false);
  });
});

describe("What's New once-per-version behavior", () => {
  const memoryStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
    };
  };

  it('shows only in the packaged desktop runtime', () => {
    expect(shouldShowWhatsNew(null, '0.3.0', false)).toBe(false);
    expect(shouldShowWhatsNew(null, '0.3.0', true)).toBe(true);
  });

  it('shows once per installed version and again after an upgrade', () => {
    const storage = memoryStorage();
    acknowledgeWhatsNew('0.2.0', storage);
    expect(shouldShowWhatsNew(getAcknowledgedWhatsNewVersion(storage), '0.3.0', true)).toBe(true);
    acknowledgeWhatsNew('0.3.0', storage);
    expect(shouldShowWhatsNew(getAcknowledgedWhatsNewVersion(storage), '0.3.0', true)).toBe(false);
    expect(shouldShowWhatsNew(getAcknowledgedWhatsNewVersion(storage), '0.3.1', true)).toBe(true);
  });

  it('persists outside engineering-state persistence', () => {
    // Its dedicated key must not be part of the zustand-persisted stores.
    expect(WHATS_NEW_STORAGE_KEY).toBe('lsn-whats-new-acknowledged-version');
    const store = read('src/lib/store.ts');
    expect(store).not.toContain(WHATS_NEW_STORAGE_KEY);
  });
});

describe('Export traceability', () => {
  it('embeds release identity in every engineering-log export and the support bundle', () => {
    const logs = read('src/pages/logs.tsx');
    // JSON transaction log, CSV/TXT headers, validation JSON metadata, and the
    // support bundle all include getReleaseExportMetadata output.
    const calls = logs.match(/getReleaseExportMetadata\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const fn of ['exportJSON', 'exportCSV', 'exportTXT', 'exportValidationJSON', 'exportSupportBundle']) {
      const body = logs.slice(logs.indexOf(`const ${fn}`), logs.indexOf('};', logs.indexOf(`const ${fn}`)));
      expect(body, `${fn} must include release metadata`).toContain('getReleaseExportMetadata');
    }
    const exports = read('src/lib/exports.ts');
    expect(exports).toContain('getReleaseExportMetadata');
  });

  it('routes support bundles through the shared desktop-aware download helper', () => {
    const logs = read('src/pages/logs.tsx');
    const start = logs.indexOf('const exportSupportBundle');
    const bundle = logs.slice(start, logs.indexOf('\n  };', start));
    expect(bundle).toContain('downloadBlob(');
    expect(bundle).not.toContain('createElement');
    expect(bundle).not.toContain('createObjectURL');
    // The shared helper prefers the native save bridge in the desktop shell.
    const exports = read('src/lib/exports.ts');
    expect(exports).toContain('getDesktopBridge()');
    expect(exports).toContain('bridge.saveFile(');
  });

  it('identifies Console, protocol, profile, and connected firmware', () => {
    const metadata = getReleaseExportMetadata('0.1.0-sim');
    expect(metadata.consoleVersion).toBe('0.3.0');
    expect(metadata.consoleRelease).toBe('v0.3.0 Development Preview');
    expect(metadata.protocolVersion).toBe('LSN v0.1');
    expect(metadata.deviceProfileVersion).toBe('0.1.0');
    expect(metadata.firmwareInterfacePackage).toBe('LSN-Firmware-Interface-v0.1');
    expect(metadata.connectedFirmwareVersion).toBe('0.1.0-sim');
  });
});

describe('Release drift guard', () => {
  it('leaves no stale Console v0.1 references in release surfaces', () => {
    // These surfaces must render the shared release identity, not literals.
    for (const path of ['src/components/AppLayout.tsx', 'src/components/LoginScreen.tsx']) {
      const source = read(path);
      expect(source, `${path} should use CONSOLE_RELEASE_LABEL`).toContain('CONSOLE_RELEASE_LABEL');
      expect(source, `${path} must not hardcode a Console version`).not.toMatch(/Console v0\.\d/);
      expect(source).not.toMatch(/v0\.1 · Authorised/);
    }
    const downloads = read('src/pages/downloads.tsx');
    expect(downloads).toContain('CURRENT_RELEASE');
    expect(downloads).not.toContain('WINDOWS BUILD PENDING');
  });

  it('keeps intentional protocol/profile v0.1 references intact', () => {
    expect(read('src/lib/exports.ts')).toContain('LSN Interface Specification (v0.1)');
    const workflow = readFileSync(resolve(root, '../../.github/workflows/lsn-console-windows.yml'), 'utf8');
    expect(workflow).toContain('LSN-Engineering-Console-Setup-${VERSION}-dev.exe');
    expect(workflow).toContain('Install and smoke-test Windows application');
    expect(workflow).toContain('tests/windows/installed-smoke.mjs');
    expect(workflow).toContain('LSN-Engineering-Console-Windows-Smoke-Evidence');
    expect(workflow).toContain('smoke-published-release');
    expect(workflow).toContain('LSN-Engineering-Console-Published-Release-Smoke-Evidence');
    expect(workflow).toContain('Refuse to replace an existing release');
    expect(workflow).toContain('overwrite_files: false');
    expect(workflow).toContain('b0707fafa100d8df6a8b56f5a454e2a070955bda');
    expect(workflow).toContain(
      '8f683e27a138bfe3f0a9199a45cf424304e7ed96e477ff388bdb08eacf0f68fd',
    );
    expect(workflow).toContain('LSN-Engineering-Console-Portable-${VERSION}.zip');
    expect(workflow).toContain('lsn-console-v');
    expect(workflow).toContain(
      'releases/download/${GITHUB_REF_NAME}',
    );
    expect(workflow).toContain(
      'curl --fail --silent --show-error --location --head',
    );
    expect(workflow).toContain('secrets.WINDOWS_CERTIFICATE_PFX_BASE64');
    expect(workflow).toContain('secrets.WINDOWS_CERTIFICATE_PASSWORD');
    expect(workflow).toContain('Get-AuthenticodeSignature');
    expect(workflow).toContain("signature.Status -ne 'Valid'");
    expect(workflow).toContain("signature.Status -ne 'NotSigned'");
    expect(workflow).toContain('X509NameType]::SimpleName');
    expect(workflow).toContain(
      "$publisher -ne 'Saber Industrial Applications'",
    );
    expect(workflow).toContain('WINDOWS_SIGNING_MODE=unsigned');
    expect(workflow).toContain(
      'No signing certificate configured; building an unsigned Development Preview.',
    );
    expect(workflow).toContain('Saber Industrial Applications');
    expect(workflow.indexOf('Get-AuthenticodeSignature')).toBeLessThan(
      workflow.indexOf('sha256sum *'),
    );
    expect(workflow).toContain('More info, then Run anyway');
    expect(workflow).toContain('body_path: windows-release-notes.md');
  });
});
