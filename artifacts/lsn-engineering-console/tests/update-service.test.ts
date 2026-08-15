import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WindowsUpdateService,
  checksumUrlForVersion,
  classifyPublisherSignature,
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
  checksumUrlForVersion: (version: string) => string;
  classifyPublisherSignature: (
    signature: Record<string, unknown>,
    expectedPublisher: string,
  ) => string;
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
  inspectSignature?: (installerPath: string) => Promise<string>;
  confirmInstall?: (update: Record<string, unknown>) => Promise<boolean>;
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
  const inspectSignature =
    options.inspectSignature ?? vi.fn(async () => 'unsigned');
  const launchInstaller =
    options.launchInstaller ?? vi.fn(async () => undefined);
  const confirmInstall =
    options.confirmInstall ?? vi.fn(async () => true);
  const service = new WindowsUpdateService({
    currentVersion: '0.2.1',
    supported: true,
    fetch,
    updatesDir,
    inspectSignature,
    confirmInstall,
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
    inspectSignature,
    launchInstaller,
    confirmInstall,
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

  it('derives the checksum URL from the fixed repository and exact release tag', () => {
    expect(checksumUrlForVersion('0.2.2')).toBe(
      'https://github.com/motionlasers/lsn-console/releases/download/lsn-console-v0.2.2/SHA256SUMS.txt',
    );
  });

  it('distinguishes trusted, unsigned, unexpected, and invalid signatures', () => {
    expect(
      classifyPublisherSignature(
        {
          Status: 'Valid',
          Publisher: 'Saber Industrial Applications',
          Subject: 'CN=Saber Industrial Applications, O=Saber Industrial Applications',
        },
        'Saber Industrial Applications',
      ),
    ).toBe('trusted-publisher');
    expect(
      classifyPublisherSignature(
        { Status: 'NotSigned', Subject: '' },
        'Saber Industrial Applications',
      ),
    ).toBe('unsigned');
    expect(
      classifyPublisherSignature(
        {
          Status: 'Valid',
          Publisher: 'Unexpected Publisher',
          Subject: 'CN=Unexpected Publisher',
        },
        'Saber Industrial Applications',
      ),
    ).toBe('unexpected-publisher');
    expect(
      classifyPublisherSignature(
        {
          Status: 'HashMismatch',
          Publisher: 'Saber Industrial Applications',
          Subject: 'CN=Saber Industrial Applications',
        },
        'Saber Industrial Applications',
      ),
    ).toBe('invalid');
    expect(
      isTrustedPublisherSignature(
        {
          Status: 'Valid',
          Publisher: 'Saber Industrial Applications',
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
        {
          Status: 'Valid',
          Publisher: 'Unexpected Publisher',
          Subject: 'CN=Unexpected Publisher',
        },
        'Saber Industrial Applications',
      ),
    ).toBe(false);
  });
});

describe('WindowsUpdateService', () => {
  it('downloads with progress, verifies, defers, and launches only the prepared installer', async () => {
    const { service, states, inspectSignature, launchInstaller } =
      await createService({});

    const ready = await service.check();
    expect(ready).toMatchObject({
      status: 'ready',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      percent: undefined,
      installerTrust: 'unsigned',
    });
    expect(states.some((state) => state.status === 'downloading')).toBe(true);
    expect(
      states.some(
        (state) => state.status === 'downloading' && state.percent === 100,
      ),
    ).toBe(true);
    expect(inspectSignature).toHaveBeenCalledTimes(1);

    expect(service.defer()).toMatchObject({ status: 'deferred' });
    expect(await service.install()).toMatchObject({ status: 'installing' });
    expect(inspectSignature).toHaveBeenCalledTimes(2);
    expect(launchInstaller).toHaveBeenCalledTimes(1);
    expect(launchInstaller).toHaveBeenCalledWith(
      expect.stringMatching(
        /LSN-Engineering-Console-Setup-0\.2\.2-dev\.exe$/,
      ),
    );
  });

  it('requires main-process consent every time before launching an unsigned installer', async () => {
    const confirmInstall = vi.fn(async () => false);
    const { service, launchInstaller } = await createService({
      confirmInstall,
    });
    await service.check();
    expect(await service.install()).toMatchObject({
      status: 'deferred',
      installerTrust: 'unsigned',
    });
    expect(confirmInstall).toHaveBeenCalledWith({
      version: '0.2.2',
      releaseName: 'LSN Engineering Console lsn-console-v0.2.2',
      installerTrust: 'unsigned',
    });
    expect(launchInstaller).not.toHaveBeenCalled();

    confirmInstall.mockResolvedValueOnce(true);
    expect(await service.install()).toMatchObject({ status: 'installing' });
    expect(confirmInstall).toHaveBeenCalledTimes(2);
    expect(launchInstaller).toHaveBeenCalledTimes(1);
  });

  it('does not trust a valid certificate whose publisher only contains the expected name', () => {
    expect(
      classifyPublisherSignature(
        {
          Status: 'Valid',
          Publisher: 'Saber Industrial Applications Update',
          Subject: 'CN=Saber Industrial Applications Update',
        },
        'Saber Industrial Applications',
      ),
    ).toBe('unexpected-publisher');
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
      inspectSignature: first.inspectSignature,
      confirmInstall: first.confirmInstall,
      launchInstaller: first.launchInstaller,
    });
    expect(await restored.initialize()).toMatchObject({
      status: 'deferred',
      currentVersion: '0.2.1',
      latestVersion: '0.2.2',
      installerTrust: 'unsigned',
    });
  });

  it('rechecks the published hash before launching a restored unsigned installer', async () => {
    const first = await createService({});
    await first.service.check();
    first.service.defer();

    const metadataPath = path.join(first.updatesDir, 'ready.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
      installerName: string;
      sha256: string;
    };
    const replacement = Buffer.from('different unsigned installer bytes');
    metadata.sha256 = crypto
      .createHash('sha256')
      .update(replacement)
      .digest('hex');
    await writeFile(
      path.join(first.updatesDir, metadata.installerName),
      replacement,
    );
    await writeFile(metadataPath, JSON.stringify(metadata));

    const restored = new WindowsUpdateService({
      currentVersion: '0.2.1',
      supported: true,
      fetch: first.fetch,
      updatesDir: first.updatesDir,
      inspectSignature: first.inspectSignature,
      confirmInstall: first.confirmInstall,
      launchInstaller: first.launchInstaller,
    });
    expect(await restored.initialize()).toMatchObject({
      status: 'deferred',
      installerTrust: 'unsigned',
    });
    expect(await restored.check()).toMatchObject({ status: 'deferred' });
    expect(await restored.install()).toMatchObject({
      status: 'error',
      errorCode: 'UPDATE_INSTALL_FAILED',
    });
    expect(first.confirmInstall).not.toHaveBeenCalled();
    expect(first.launchInstaller).not.toHaveBeenCalled();
  });

  it('accepts a valid signature from the expected publisher', async () => {
    const { service } = await createService({
      inspectSignature: vi.fn(async () => 'trusted-publisher'),
    });
    expect(await service.check()).toMatchObject({
      status: 'ready',
      installerTrust: 'trusted-publisher',
    });
  });

  it.each(['invalid', 'unexpected-publisher'])(
    'rejects a %s installer without blocking the installed version',
    async (signatureResult) => {
      const { service, launchInstaller } = await createService({
        inspectSignature: vi.fn(async () => signatureResult),
      });
      expect(await service.check()).toMatchObject({
        status: 'error',
        currentVersion: '0.2.1',
        errorCode: 'UPDATE_DOWNLOAD_FAILED',
        canRetry: true,
      });
      expect(launchInstaller).not.toHaveBeenCalled();
    },
  );

  it('keeps the installed version usable after checksum failure', async () => {
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