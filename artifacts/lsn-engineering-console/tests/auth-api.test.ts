import { afterEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../src/lib/auth-api';

describe('auth API transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses same-origin fetch in the web app', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await authApi.getSession();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(result).toEqual({ ok: false, error: 'Unauthorized', status: 401 });
  });

  it('uses the Electron bridge instead of resolving an API path under file://', async () => {
    const authRequest = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        userId: 1,
        username: 'engineer',
        isAdmin: false,
        forcePasswordChange: false,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { lsnDesktop: { authRequest } });

    const result = await authApi.login('engineer', 'test-password');

    expect(authRequest).toHaveBeenCalledWith(
      '/api/auth/login',
      'POST',
      JSON.stringify({ username: 'engineer', password: 'test-password' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      data: {
        userId: 1,
        username: 'engineer',
        isAdmin: false,
        forcePasswordChange: false,
      },
    });
  });

  it('restores the session via getSession without re-login when cookies persist across restarts', async () => {
    // Simulates app reopen: the bridge calls /api/auth/session and the server
    // returns the user because the Chromium session cookie was written to disk.
    // If the session were in-memory only this would return 401 and the user
    // would be forced to log in again on every launch.
    const sessionUser = {
      userId: 1,
      username: 'engineer',
      isAdmin: false,
      forcePasswordChange: false,
    };
    const authRequest = vi.fn().mockResolvedValue({ status: 200, body: sessionUser });
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', { lsnDesktop: { authRequest } });

    const result = await authApi.getSession();

    expect(authRequest).toHaveBeenCalledWith('/api/auth/session', 'GET', undefined);
    expect(result).toEqual({ ok: true, data: sessionUser });
  });

  it('returns unauthorized on getSession after logout clears the session cookie', async () => {
    // After logout the server invalidates the session and the cookie is cleared.
    // A subsequent getSession (e.g. on the next app launch) must return 401 so
    // the login screen is shown instead of transparently re-authenticating.
    const authRequest = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: { ok: true } }) // logout
      .mockResolvedValueOnce({ status: 401, body: { error: 'Unauthorized' } }); // session check after restart
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', { lsnDesktop: { authRequest } });

    const logoutResult = await authApi.logout();
    const sessionResult = await authApi.getSession();

    expect(logoutResult).toEqual({ ok: true, data: { ok: true } });
    expect(sessionResult).toEqual({ ok: false, error: 'Unauthorized', status: 401 });
    expect(authRequest).toHaveBeenNthCalledWith(1, '/api/auth/logout', 'POST', undefined);
    expect(authRequest).toHaveBeenNthCalledWith(2, '/api/auth/session', 'GET', undefined);
  });
});