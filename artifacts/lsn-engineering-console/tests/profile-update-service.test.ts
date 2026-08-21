import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const svc = require('../electron/profile-update-service.cjs') as {
  ProfileUpdateService: new (options?: Record<string, unknown>) => any;
  PROFILE_CHANNEL_PATH: string;
  verifyCandidate: (args: Record<string, unknown>) => {
    ok: boolean;
    code?: string;
    issues?: Array<{ code: string; message: string }>;
    verified?: Record<string, unknown>;
  };
  validateProfileSchema: (doc: unknown) => string[];
  canonicalize: (v: unknown) => string;
  canonicalDigest: (v: unknown) => string;
  parseSemver: (v: unknown) => number[] | null;
  compareSemverCore: (a: string, b: string) => number | null;
  isFirmwareSupported: (v: string, list: string[]) => boolean;
};

const API_ORIGIN = 'https://lsn.saberindustrial.net';

// A minimal schema-valid and physically ready profile document.
function baseDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const readField = (symbolicName: string, attribute: number) => ({
    symbolicName,
    direction: 'LSN_TO_PC',
    dataType: 'boolean',
    access: 'READ',
    cipService: 'GetAttributeSingle',
    class: 100,
    instance: 1,
    attribute,
    wireType: 'bool8',
    implementationStatus: 'VERIFIED',
    simulationStatus: 'VERIFIED',
    expectedFirmwareBehavior: 'x',
    expectedReportedResponse: 'x',
  });
  return {
    profileVersion: '0.2.0',
    protocolVersion: 'LSN v0.1',
    hardwareFamily: 'WT32-ETH01',
    supportedFirmware: ['0.1.x', '0.2.x-development'],
    identity: { vendorId: 1, deviceType: 2, productCode: 3, mappingState: 'VERIFIED' },
    capabilities: {
      interlock: { enabled: false, phase: 'future', description: 'x' },
      remoteStop: { enabled: false, phase: 'future', description: 'x' },
      sensors: { enabled: false, phase: 'future', description: 'x' },
    },
    fields: [
      readField('Ready', 1),
      readField('Faulted', 2),
      readField('EmissionControlOutputActive', 3),
      { ...readField('InterlockOK', 4), capability: 'interlock' },
      { ...readField('RemoteStopOK', 5), capability: 'remoteStop' },
      {
        ...readField('EmissionEnableRequest', 6),
        symbolicName: 'EmissionEnableRequest',
        direction: 'PC_TO_LSN',
        access: 'WRITE',
        cipService: 'SetAttributeSingle',
      },
    ],
    ...overrides,
  };
}

function unresolvedDocument(): Record<string, unknown> {
  const doc = baseDocument();
  return {
    ...doc,
    identity: { vendorId: null, deviceType: null, productCode: null, mappingState: 'TBD' },
    fields: [
      {
        ...(doc.fields as Record<string, unknown>[])[0],
        cipService: 'TBD',
        class: null,
        instance: null,
        attribute: null,
        implementationStatus: 'TBD',
      },
    ],
  };
}

/**
 * A fake fetch driven by a route map. Keys are absolute URLs; values are the
 * JSON payload to serialize and return. Missing routes 404.
 */
function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const key = String(url);
    if (!(key in routes)) {
      return { ok: false, status: 404, text: async () => 'not found' };
    }
    const value = routes[key];
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { ok: true, status: 200, text: async () => text };
  });
}

function manifestFor(doc: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const artifactRaw = JSON.stringify(doc);
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(Buffer.from(artifactRaw, 'utf8')).digest('hex');
  return {
    available: true,
    profileVersion: doc.profileVersion,
    digest,
    artifactPath: '/api/desktop/profile-artifact/0.2.0',
    releaseName: 'LSN 0.2.0 Development',
    ...extra,
  };
}

let dir: string;
function newDir() {
  dir = mkdtempSync(join(tmpdir(), 'lsn-profiles-'));
  return dir;
}

afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('profile-update-service — pure verification', () => {
  it('accepts an unresolved document for non-physical review workflows', () => {
    expect(svc.validateProfileSchema(unresolvedDocument())).toEqual([]);
  });

  it('rejects unresolved mappings and identity for physical staging', () => {
    const doc = unresolvedDocument();
    const manifest = manifestFor(doc);
    const result = svc.verifyCandidate({
      manifest,
      document: doc,
      artifactRaw: JSON.stringify(doc),
      artifactUrl: `${API_ORIGIN}${manifest.artifactPath}`,
      apiOrigin: API_ORIGIN,
      currentIdentity: null,
    });
    expect(result.ok).toBe(false);
    expect(result.issues?.map((issue) => issue.code)).toContain('identity_unresolved');
  });

  it('rejects malformed documents', () => {
    expect(svc.validateProfileSchema(null).length).toBeGreaterThan(0);
    expect(svc.validateProfileSchema(baseDocument({ fields: [] })).length).toBeGreaterThan(0);
    expect(
      svc.validateProfileSchema(baseDocument({ profileVersion: '' })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects duplicate symbolic field names (ambiguous mapping)', () => {
    const doc = baseDocument({
      fields: [
        baseDocument().fields as never,
      ],
    });
    // Two fields with same name.
    (doc.fields as unknown[]) = [
      { ...(baseDocument().fields as never[])[0] },
      { ...(baseDocument().fields as never[])[0] },
    ];
    expect(svc.validateProfileSchema(doc).some((m) => /duplicate/.test(m))).toBe(true);
  });

  it('canonical digest is order-independent', () => {
    const a = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const b = { a: 2, nested: { x: 2, y: 1 }, b: 1 };
    expect(svc.canonicalDigest(a)).toBe(svc.canonicalDigest(b));
  });

  it('semver policy comparisons', () => {
    expect(svc.compareSemverCore('0.2.0', '0.1.0')).toBe(1);
    expect(svc.compareSemverCore('0.1.0', '0.2.0')).toBe(-1);
    expect(svc.compareSemverCore('0.2.0', '0.2.0')).toBe(0);
    expect(svc.compareSemverCore('bad', '0.2.0')).toBeNull();
  });

  it('firmware wildcard compatibility', () => {
    expect(svc.isFirmwareSupported('0.2.5-development', ['0.2.x-development'])).toBe(true);
    expect(svc.isFirmwareSupported('0.1.9', ['0.1.x', '0.2.x-development'])).toBe(true);
    expect(svc.isFirmwareSupported('1.0.0', ['0.1.x'])).toBe(false);
  });

  it('verifyCandidate passes for a matching manifest/document', () => {
    const doc = baseDocument();
    const artifactRaw = JSON.stringify(doc);
    const result = svc.verifyCandidate({
      manifest: manifestFor(doc),
      document: doc,
      artifactRaw,
      currentIdentity: {
        profileVersion: '0.1.0',
        protocolVersion: 'LSN v0.1',
        hardwareFamily: 'WT32-ETH01',
      },
    });
    expect(result.ok).toBe(true);
    expect(result.verified?.controlReady).toBe(true);
    expect(result.verified?.readReady).toBe(true);
  });

  it('rejects a digest mismatch', () => {
    const doc = baseDocument();
    const manifest = manifestFor(doc, { digest: 'f'.repeat(64) });
    const result = svc.verifyCandidate({
      manifest,
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: { profileVersion: '0.1.0' },
    });
    expect(result.ok).toBe(false);
    expect(result.issues?.some((i) => i.code === 'digest_mismatch')).toBe(true);
  });

  it('rejects a version-identity mismatch between manifest and document', () => {
    const doc = baseDocument();
    const manifest = manifestFor(doc, { profileVersion: '9.9.9' });
    const result = svc.verifyCandidate({
      manifest,
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: { profileVersion: '0.1.0' },
    });
    expect(result.ok).toBe(false);
    expect(result.issues?.some((i) => i.code === 'version_mismatch')).toBe(true);
  });

  it('blocks a version downgrade', () => {
    const doc = baseDocument({ profileVersion: '0.1.0' });
    const result = svc.verifyCandidate({
      manifest: manifestFor(doc),
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: { profileVersion: '0.2.0' },
    });
    expect(result.ok).toBe(false);
    expect(result.issues?.some((i) => i.code === 'version_downgrade_blocked')).toBe(true);
  });

  it('rejects incompatible protocol and hardware family', () => {
    const doc = baseDocument({ protocolVersion: 'LSN v9', hardwareFamily: 'OTHER' });
    const result = svc.verifyCandidate({
      manifest: manifestFor(doc),
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: {
        profileVersion: '0.1.0',
        protocolVersion: 'LSN v0.1',
        hardwareFamily: 'WT32-ETH01',
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues?.some((i) => i.code === 'protocol_incompatible')).toBe(true);
    expect(result.issues?.some((i) => i.code === 'hardware_family_mismatch')).toBe(true);
  });

  it('rejects incompatible firmware from the manifest', () => {
    const doc = baseDocument();
    const result = svc.verifyCandidate({
      manifest: manifestFor(doc, { firmwareVersion: '9.9.9' }),
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: { profileVersion: '0.1.0' },
    });
    expect(result.ok).toBe(false);
    expect(result.issues?.some((i) => i.code === 'firmware_incompatible')).toBe(true);
  });

  it('records an invalid optional signature but leaves valid ones alone', () => {
    const doc = baseDocument();
    const bad = svc.verifyCandidate({
      manifest: manifestFor(doc, { signature: 'x' }),
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: { profileVersion: '0.1.0' },
      verifySignature: () => 'signature not trusted',
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues?.some((i) => i.code === 'signature_invalid')).toBe(true);

    const good = svc.verifyCandidate({
      manifest: manifestFor(doc, { signature: 'x' }),
      document: doc,
      artifactRaw: JSON.stringify(doc),
      currentIdentity: { profileVersion: '0.1.0' },
      verifySignature: () => null,
    });
    expect(good.ok).toBe(true);
    expect(good.verified?.signatureState).toBe('verified');
  });
});

describe('profile-update-service — fetch/stage/activate/rollback lifecycle', () => {
  const bundledPath = join(
    import.meta.dirname,
    '../profiles/lsn-v0.1.json',
  );

  function makeService(routes: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return new svc.ProfileUpdateService({
      apiOrigin: API_ORIGIN,
      fetch: fakeFetch(routes),
      profilesDir: newDir(),
      bundledProfilePath: bundledPath,
      now: () => '2024-01-01T00:00:00.000Z',
      ...extra,
    });
  }

  it('initializes to the bundled profile when nothing is persisted', async () => {
    const service = makeService({});
    const state = await service.initialize();
    expect(state.active?.source).toBe('bundled');
    expect(state.active?.controlReady).toBe(false);
    expect(state.staged).toBeNull();
    expect(state.lastKnownGood).toBeNull();
  });

  it('check() fetches, verifies, and stages but never activates', async () => {
    const doc = baseDocument();
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(doc),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: doc,
    };
    const service = makeService(routes);
    await service.initialize();
    const state = await service.check();
    expect(state.staged?.profileVersion).toBe('0.2.0');
    expect(state.staged?.source).toBe('channel');
    // Active is still bundled — no activation happened.
    expect(state.active?.source).toBe('bundled');
    expect(state.error).toBeNull();
  });

  it('check() reports verification errors without staging', async () => {
    const doc = baseDocument({ profileVersion: '0.0.1' }); // downgrade vs bundled 0.1.0
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(doc),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: doc,
    };
    // Fix the artifact route to match the manifest artifactPath.
    routes[`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`] = doc;
    const service = makeService(routes);
    await service.initialize();
    const state = await service.check();
    expect(state.staged).toBeNull();
    expect(state.error?.issues.some((i) => i.code === 'version_downgrade_blocked')).toBe(true);
  });

  it('rejects an artifact URL that is off the fixed origin', async () => {
    const doc = baseDocument();
    const manifest = manifestFor(doc, { artifactUrl: 'https://evil.example/x.json' });
    delete (manifest as Record<string, unknown>).artifactPath;
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifest,
    };
    const service = makeService(routes);
    await service.initialize();
    const state = await service.check();
    expect(state.error?.issues.some((i) => i.code === 'origin_violation')).toBe(true);
    expect(state.staged).toBeNull();
  });

  it('activate() atomically promotes staged -> active, stores last-known-good, and applies to hardware', async () => {
    const doc = baseDocument();
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(doc),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: doc,
    };
    const onActivate = vi.fn(async () => {});
    const service = makeService(routes, { onActivate });
    await service.initialize();
    await service.check();
    const state = await service.activate();
    expect(state.active?.profileVersion).toBe('0.2.0');
    expect(state.active?.source).toBe('channel');
    expect(state.staged).toBeNull();
    // Bundled active was not stored as LKG (bundled is always recoverable).
    expect(state.lastKnownGood).toBeNull();
    // Hardware repin was invoked with the activated document.
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect((onActivate.mock.calls[0][0] as Record<string, unknown>).profileVersion).toBe('0.2.0');
    // Persisted atomically on disk.
    expect(existsSync(join(dir, 'active.json'))).toBe(true);
    expect(existsSync(join(dir, 'staged.json'))).toBe(false);
  });

  it('activate() rejects a mismatched requested digest', async () => {
    const doc = baseDocument();
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(doc),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: doc,
    };
    const service = makeService(routes);
    await service.initialize();
    await service.check();
    await expect(service.activate({ digest: 'f'.repeat(64) })).rejects.toThrow(/digest/i);
  });

  it('activate() throws when nothing is staged', async () => {
    const service = makeService({});
    await service.initialize();
    await expect(service.activate()).rejects.toThrow(/no staged/i);
  });

  it('rollback() restores last-known-good then falls back to bundled', async () => {
    // First activate v0.2.0 (bundled 0.1.0 -> not stored as LKG).
    const v020 = baseDocument({ profileVersion: '0.2.0' });
    const v030 = baseDocument({ profileVersion: '0.3.0' });
    const onActivate = vi.fn(async () => {});
    const service = makeService(
      {
        [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(v020),
        [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: v020,
      },
      { onActivate },
    );
    await service.initialize();
    await service.check();
    await service.activate();
    expect(service.getState().active?.profileVersion).toBe('0.2.0');

    // Now stage + activate 0.3.0: previous channel active (0.2.0) becomes LKG.
    service._fetch = fakeFetch({
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(v030, {
        profileVersion: '0.3.0',
        artifactPath: '/api/desktop/profile-artifact/0.3.0',
      }),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.3.0`]: v030,
    });
    await service.check();
    await service.activate();
    let state = service.getState();
    expect(state.active?.profileVersion).toBe('0.3.0');
    expect(state.lastKnownGood?.profileVersion).toBe('0.2.0');

    // Rollback -> last-known-good 0.2.0.
    state = await service.rollback();
    expect(state.active?.profileVersion).toBe('0.2.0');
    expect(state.lastKnownGood).toBeNull();

    // Rollback again -> bundled fallback (no LKG left).
    state = await service.rollback();
    expect(state.active?.source).toBe('bundled');
    expect(onActivate).toHaveBeenCalled();
  });

  it('rollback({ toBundled: true }) goes straight to the bundled profile', async () => {
    const v020 = baseDocument({ profileVersion: '0.2.0' });
    const service = makeService({
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(v020),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: v020,
    });
    await service.initialize();
    await service.check();
    await service.activate();
    const state = await service.rollback({ toBundled: true });
    expect(state.active?.source).toBe('bundled');
  });

  it('reloads persisted active/staged/lkg across restart', async () => {
    const doc = baseDocument();
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(doc),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: doc,
    };
    const profilesDir = newDir();
    const first = new svc.ProfileUpdateService({
      apiOrigin: API_ORIGIN,
      fetch: fakeFetch(routes),
      profilesDir,
      bundledProfilePath: bundledPath,
    });
    await first.initialize();
    await first.check();
    await first.activate();

    // A fresh service over the same dir must restore the active profile.
    const repin = vi.fn(async () => {});
    const second = new svc.ProfileUpdateService({
      apiOrigin: API_ORIGIN,
      fetch: fakeFetch(routes),
      profilesDir,
      bundledProfilePath: bundledPath,
      onActivate: repin,
    });
    const state = await second.initialize();
    expect(state.active?.profileVersion).toBe('0.2.0');
    expect(state.active?.source).toBe('channel');
    expect(repin).toHaveBeenCalledOnce();
    expect(repin.mock.calls[0][0]).toMatchObject({ profileVersion: '0.2.0' });
  });

  it('drops a tampered on-disk active entry and falls back to bundled', async () => {
    const profilesDir = newDir();
    // Write a bogus active.json with a mismatched digest.
    const fs = require('node:fs');
    fs.writeFileSync(
      join(profilesDir, 'active.json'),
      JSON.stringify({
        meta: { profileVersion: '9.9.9', digest: '0'.repeat(64), source: 'channel' },
        document: baseDocument({ profileVersion: '9.9.9' }),
      }),
    );
    const service = new svc.ProfileUpdateService({
      apiOrigin: API_ORIGIN,
      fetch: fakeFetch({}),
      profilesDir,
      bundledProfilePath: bundledPath,
    });
    const state = await service.initialize();
    expect(state.active?.source).toBe('bundled');
    dir = profilesDir;
  });

  it('drops a digest-valid but physically incomplete persisted channel profile', async () => {
    const profilesDir = newDir();
    const fs = require('node:fs');
    const document = unresolvedDocument();
    fs.writeFileSync(
      join(profilesDir, 'active.json'),
      JSON.stringify({
        meta: {
          profileVersion: document.profileVersion,
          protocolVersion: document.protocolVersion,
          hardwareFamily: document.hardwareFamily,
          digest: svc.canonicalDigest(document),
          source: 'channel',
        },
        document,
      }),
    );
    const repin = vi.fn(async () => {});
    const service = new svc.ProfileUpdateService({
      apiOrigin: API_ORIGIN,
      fetch: fakeFetch({}),
      profilesDir,
      bundledProfilePath: bundledPath,
      onActivate: repin,
    });
    const state = await service.initialize();
    expect(state.active?.source).toBe('bundled');
    expect(repin).not.toHaveBeenCalled();
    expect(existsSync(join(profilesDir, 'active.json'))).toBe(false);
    dir = profilesDir;
  });

  it('discardStaged() clears a staged profile', async () => {
    const doc = baseDocument();
    const routes = {
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: manifestFor(doc),
      [`${API_ORIGIN}/api/desktop/profile-artifact/0.2.0`]: doc,
    };
    const service = makeService(routes);
    await service.initialize();
    await service.check();
    expect(service.getState().staged).not.toBeNull();
    const state = await service.discardStaged();
    expect(state.staged).toBeNull();
    expect(existsSync(join(dir, 'staged.json'))).toBe(false);
  });

  it('handles a "no update available" manifest', async () => {
    const service = makeService({
      [`${API_ORIGIN}${svc.PROFILE_CHANNEL_PATH}`]: { available: false },
    });
    await service.initialize();
    const state = await service.check();
    expect(state.staged).toBeNull();
    expect(state.error?.code).toBe('no_update');
  });
});
