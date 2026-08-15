import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WindowsUpdateService,
  compareStableVersions,
  installerNameForVersion,
  isTrustedPublisherSignature,
  parseChecksumManifest,
  selectNewerStableRelease,
} = require('../electron/update-service.cjs') as {
  WindowsUpdateService: new (options: Record<string, unknown>) => {
    initialize: () => Promise<Record<string, unknown>>;
    check: () => Promise<Record<string, unknown>>;
    defer: () => Record<string, unknown>;
    install: () => Promise<Record<string, unknown>>;
    getState: () => Record<string, unknown>;
  };
  compareStableVersions: (left: string, right: string) => number;
  installerNameForVersion: (version: string) => string;
  isTrustedPublisherSignature: (
    signature: Record<string, unknown>,
    expectedPublisher: string,
  ) => boolean;
  parseChecksumManifest: (manifest: string, filename: string) => string;
  selectNewerStableRelease: (
    release: Record<string, unknown>,
    currentVersion: string,
  ) => Record<string, unknown> | null;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function releaseFor(version: string, overrides: Record<string, unknown> = {}) {
  const tag = `lsn-console-v${version}`;
  const installerName = installerNameForVersion(version);
  return {
    draft: false,
    prerelease: false,
    tag_name: tag,
    name: `LSN Engineering Console ${tag}`,
    assets: [
      {
        name: installerName,
        browser_download_url:
          `https://github.com/motionlasers/lsn-console/releases/download/${tag}/${installerName}`,
      },
      {
        name: 'SHA256SUMS.txt',
        browser_download_url:
          `https://github.com/motionlasers/lsn-console/releases/download/${tag}/SHA256SUMS.txt`,
      },
    ],
    ...overrides,
  };
}

async function createService(options: {
  release?: Record<string, unknown>;
  installer?: Uint8Array;
  manifestHash?: string;
  contentLength?: boolean;
  verifySignature?: (installerPath: string) => Promise<boolean>;
  launchInstaller?: (installerPath: string) => Promise<void>;
}) {
  const updatesDir = await mkdtemp(path.join(os.tmpdir(), 'lsn-updates-'));
  temporaryDirectories.push(updatesDir);
  const installer = options.installer ?? Buffer.from('signed installer bytes');
  const version = '0.2.2';
  const installerName = installerNameForVersion(version);
  const actualHash = crypto.createHash('sha256').update(installer).digest('hex');
  const manifestHash = options.manifestHash ?? actualHash;
  const states: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/releases/latest')) {
      return new Response(
        JSON.stringify(options.release ?? releaseFor(version)),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/SHA256SUMS.txt')) {
      return new Response(`${manifestHash}  ${installerName}\n`, { status: 200 });
    }
    if (url.endsWith(`/${installerName}`)) {
      return new Response(installer, {
        status: 200,
        headers:
          options.contentLength === false
            ? undefined
            : { 'Content-Length': String(installer.byteLength) },
      });
    }
    return new Response('not found', { status: 404 });
  });
  const verifySignature =
    options.verifySignature ?? vi.fn(async () => true);
  const launchInstaller =
    options.launchInstaller ?? vi.fn(async () => undefined);
  const service = new WindowsUpdateService({
    currentVersion: '0.2.1',
    supported: true,
    fetch,
    updatesDir,
    verifySignature,
    launchInstaller,
    onStateChange: (state: Record<string, unknown>) => states.push(state),
    now: () => '2026-08-15T12:00:00.000Z',
  });
  await service.initialize();
  return {
    service,
    updatesDir,
    states,
    fetch,
    verifySignature,
    launchInstaller,
  };
}

describe('Windows update release selection', () => {
  it('compares stable semantic versions without treating strings lexically', () => {
    expect(compareStableVersions('0.10.0', '0.2.9')).toBe(1);
    expect(compareStableVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareStableVersions('0.2.1', '0.2.2')).toBe(-1);
  });

  it('selects only a newer normal release with exact repository assets', () => {
    expect(selectNewerStableRelease(releaseFor('0.2.2'), '0.2.1')).toMatchObject({
      version: '0.2.2',
      tag: 'lsn-console-v0.2.2',
      installerName: 'LSN-Engineering-Console-Setup-0.2.2-dev.exe',
    });
    expect(selectNewerStableRelease(releaseFor('0.2.1'), '0.2.1')).toBeNull();
    expect(
      selectNewerStableRelease(
        releaseFor('0.2.2', { prerelease: true }),
        '0.2.1',
      ),
    ).toBeNull();
  });

  it('rejects a release asset redirected to an untrusted repository path', () => {
    const release = releaseFor('0.2.2');
    const assets = release.assets as Array<Record<string, string>>;
    assets[0].browser_download_url =
      'https://example.com/LSN-Engineering-Console-Setup-0.2.2-dev.exe';
    expect(() => selectNewerStableRelease(release, '0.2.1')).toThrow(
      'missing required update assets',
    );
  });

  it('parses the checksum only for the exact installer filename', () => {
    const hash = 'a'.repeat(64);
    expect(
      parseChecksumManifest(
        `${'b'.repeat(64)}  other.exe\n${hash} *expected.exe\n`,
        'expected.exe',
      ),
    ).toBe(hash);
    expect(() =>
      parseChecksumManifest(`${hash}  other.exe`, 'expected.exe'),
    ).toThrow('Checksum not found');
  });

  it('requires a valid Authenticode result from the expected publisher', () => {
    expect(
      isTrustedPublisherSignature(
        {
          Status: 'Valid',
          Subject: 'CN=Saber Industrial Applications, O=Saber Industrial Applications',
        },
        'Saber Industrial Applications',
      ),
    ).toBe(true);
    expect(
      isTrustedPublisherSignature(
        { Status: 'NotSigned', Subject: '' },
        'Saber Industrial Applications',
      ),
    ).toBe(false);
    expect(
      isTrustedPublisherSignature(
        { Status: 'Valid', Subject: 'CN=Unexpected Publisher' },
        'Saber Industrial Applications',
      ),
    ).toBe(false);
  });
});

describe('WindowsUpdateService', () => {
  it('downloads with progress, verifies, defers, and launches only the prepared installer', async () => {
    const { service, states, verifySignature, launchInstaller } =
      await createService({});

    const ready = await service.check();
    expect(ready).toMatchObject({
      status: 'ready',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      percent: undefined,
    });
    expect(states.some((state) => state.status === 'downloading')).toBe(true);
    expect(
      states.some(
        (state) => state.status === 'downloading' && state.percent === 100,
      ),
    ).toBe(true);
    expect(verifySignature).toHaveBeenCalledTimes(1);

    expect(service.defer()).toMatchObject({ status: 'deferred' });
    expect(await service.install()).toMatchObject({ status: 'installing' });
    expect(verifySignature).toHaveBeenCalledTimes(2);
    expect(launchInstaller).toHaveBeenCalledTimes(1);
    expect(launchInstaller).toHaveBeenCalledWith(
      expect.stringMatching(
        /LSN-Engineering-Console-Setup-0\.2\.2-dev\.exe$/,
      ),
    );
  });

  it('supports indeterminate byte progress when content length is unavailable', async () => {
    const installer = new Uint8Array(1024 * 16).fill(7);
    const { service, states } = await createService({
      installer,
      contentLength: false,
    });
    expect(await service.check()).toMatchObject({
      status: 'ready',
      latestVersion: '0.2.2',
    });
    expect(
      states.some(
        (state) =>
          state.status === 'downloading' &&
          typeof state.receivedBytes === 'number' &&
          state.percent === undefined,
      ),
    ).toBe(true);
  });

  it('restores a deferred verified update after the app restarts', async () => {
    const first = await createService({});
    await first.service.check();
    first.service.defer();

    const restored = new WindowsUpdateService({
      currentVersion: '0.2.1',
      supported: true,
      fetch: first.fetch,
      updatesDir: first.updatesDir,
      verifySignature: first.verifySignature,
      launchInstaller: first.launchInstaller,
    });
    expect(await restored.initialize()).toMatchObject({
      status: 'deferred',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
    });
  });

  it('keeps the installed version usable after checksum or signature failure', async () => {
    const { service, launchInstaller } = await createService({
      manifestHash: 'f'.repeat(64),
    });
    expect(await service.check()).toMatchObject({
      status: 'error',
      currentVersion: '0.2.1',
      errorCode: 'UPDATE_DOWNLOAD_FAILED',
      canRetry: true,
    });
    expect(await service.install()).toMatchObject({ status: 'error' });
    expect(launchInstaller).not.toHaveBeenCalled();
  });

  it('reports up-to-date without downloading when the release is not newer', async () => {
    const { service, fetch } = await createService({
      release: releaseFor('0.2.1'),
    });
    expect(await service.check()).toMatchObject({
      status: 'up-to-date',
      currentVersion: '0.2.1',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the running version and retry path when installer launch fails', async () => {
    const launchInstaller = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const { service } = await createService({ launchInstaller });
    await service.check();
    expect(await service.install()).toMatchObject({
      status: 'error',
      currentVersion: '0.2.1',
      errorCode: 'UPDATE_INSTALL_FAILED',
      canRetry: true,
    });
  });
});