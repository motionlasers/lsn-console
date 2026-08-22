import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createCiProfileSmokeFetch } = require('../electron/ci-profile-smoke-fetch.cjs') as {
  createCiProfileSmokeFetch: (options: {
    env: Record<string, string | undefined>;
    isPackaged: boolean;
    platform: string;
    apiOrigin: string;
    nodeFetch: (url: URL, options?: unknown) => Promise<unknown>;
  }) => ((url: string | URL, options?: unknown) => Promise<unknown>) | null;
};

const runnerTemp = 'C:\\actions\\temp';
const caPath = join(runnerTemp, 'lsn-profile-smoke-cert', 'localhost-cert.pem');
const enabledEnv = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  LSN_WINDOWS_PROFILE_SMOKE: '1',
  NODE_EXTRA_CA_CERTS: caPath,
  RUNNER_TEMP: runnerTemp,
};

describe('CI profile-smoke TLS trust boundary', () => {
  it('enables Node fetch only for the packaged Windows GitHub Actions localhost fixture', async () => {
    const nodeFetch = vi.fn(async () => ({ ok: true }));
    const fetch = createCiProfileSmokeFetch({
      env: enabledEnv,
      isPackaged: true,
      platform: 'win32',
      apiOrigin: 'https://localhost:9443',
      nodeFetch,
    });

    expect(fetch).not.toBeNull();
    await fetch?.('https://localhost:9443/api/desktop/profile-channel', {
      method: 'GET',
    });
    expect(nodeFetch).toHaveBeenCalledWith(
      new URL('https://localhost:9443/api/desktop/profile-channel'),
      { method: 'GET' },
    );
  });

  it.each([
    ['unpackaged runtime', { isPackaged: false }],
    ['non-Windows runtime', { platform: 'linux' }],
    ['non-CI runtime', { env: { ...enabledEnv, CI: undefined } }],
    ['non-GitHub runner', { env: { ...enabledEnv, GITHUB_ACTIONS: undefined } }],
    ['missing smoke marker', { env: { ...enabledEnv, LSN_WINDOWS_PROFILE_SMOKE: undefined } }],
    ['CA outside runner temp', { env: { ...enabledEnv, NODE_EXTRA_CA_CERTS: 'C:\\other\\ca.pem' } }],
    ['production API origin', { apiOrigin: 'https://lsn.saberindustrial.net' }],
  ])('stays disabled for %s', (_label, override) => {
    const fetch = createCiProfileSmokeFetch({
      env: enabledEnv,
      isPackaged: true,
      platform: 'win32',
      apiOrigin: 'https://localhost:9443',
      nodeFetch: vi.fn(),
      ...override,
    });
    expect(fetch).toBeNull();
  });

  it('rejects every request outside the fixed localhost origin', () => {
    const fetch = createCiProfileSmokeFetch({
      env: enabledEnv,
      isPackaged: true,
      platform: 'win32',
      apiOrigin: 'https://localhost:9443',
      nodeFetch: vi.fn(),
    });
    expect(() => fetch?.('https://localhost:9555/api/desktop/profile-channel')).toThrow(
      /fixed localhost API origin/,
    );
    expect(() => fetch?.('https://example.com/api/desktop/profile-channel')).toThrow(
      /fixed localhost API origin/,
    );
  });

  it('contains no certificate-verification bypass', () => {
    const source = require('node:fs').readFileSync(
      join(import.meta.dirname, '../electron/ci-profile-smoke-fetch.cjs'),
      'utf8',
    );
    expect(source).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(source).not.toContain('rejectUnauthorized');
    expect(source).not.toContain('webSecurity');
    expect(source).not.toContain('ignore-certificate-errors');
  });
});