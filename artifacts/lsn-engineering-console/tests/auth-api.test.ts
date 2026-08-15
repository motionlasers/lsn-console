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
});