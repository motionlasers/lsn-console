import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activityApi, generateEventId } from '../src/lib/activity-api';
import * as desktop from '../src/lib/desktop';

describe('activity-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generateEventId generates valid UUID pattern', () => {
    const id = generateEventId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('recordEvent uses bridge when desktop bridge is present', async () => {
    const mockAuthRequest = vi.fn().mockResolvedValue({ status: 200, body: {} });
    vi.spyOn(desktop, 'getDesktopBridge').mockReturnValue({
      authRequest: mockAuthRequest
    } as any);

    const ok = await activityApi.recordEvent({
      eventName: 'DESKTOP_ACTION',
      clientEventId: 'test-1',
    });

    expect(ok).toBe(true);
    expect(mockAuthRequest).toHaveBeenCalledWith(
      '/api/activity/events',
      'POST',
      JSON.stringify({ eventName: 'DESKTOP_ACTION', clientEventId: 'test-1' })
    );
  });

  it('recordEvent returns false on network failure silently', async () => {
    vi.spyOn(desktop, 'getDesktopBridge').mockReturnValue(null);
    global.fetch = vi.fn().mockRejectedValue(new Error('Network disconnected'));

    const ok = await activityApi.recordEvent({
      eventName: 'PAGE_VISIT',
      clientEventId: 'test-2',
    });

    expect(ok).toBe(false);
  });

  it('recordEvent returns false on 403 status', async () => {
    vi.spyOn(desktop, 'getDesktopBridge').mockReturnValue(null);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    const ok = await activityApi.recordEvent({
      eventName: 'PAGE_VISIT',
      clientEventId: 'test-2',
    });

    expect(ok).toBe(false);
  });

  it('listActivity constructs correct URL and passes all filters', async () => {
    vi.spyOn(desktop, 'getDesktopBridge').mockReturnValue(null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] })
    });

    await activityApi.listActivity({ 
      page: 2, 
      pageSize: 50,
      actorId: 42,
      category: 'AUTH',
      action: 'LOGIN',
      outcome: 'SUCCESS',
      targetType: 'SESSION',
      targetId: '42',
      from: '2024-01-01',
      to: '2024-12-31'
    });
    
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/activity?page=2&pageSize=50&actorId=42&category=AUTH&action=LOGIN&outcome=SUCCESS&targetType=SESSION&targetId=42&from=2024-01-01&to=2024-12-31',
      expect.objectContaining({ credentials: 'include' })
    );
  });
});
