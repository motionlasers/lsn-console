import { getDesktopBridge } from "./desktop";

export interface ActivityEvent {
  eventName: 'PAGE_VISIT' | 'SETTING_CHANGED' | 'DESKTOP_ACTION';
  clientEventId: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: Record<string, unknown>;
}

export interface ActivityLogItem {
  id: number;
  actorId: number | null;
  actorUsername: string | null;
  actorRole: string | null;
  category: string;
  action: string;
  outcome: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

export interface ActivityLogResponse {
  items: ActivityLogItem[];
  page: number;
  pageSize: number;
  total: number;
  retentionPolicy: string;
}

export function generateEventId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export const activityApi = {
  recordEvent: async (event: ActivityEvent): Promise<boolean> => {
    try {
      const bridge = getDesktopBridge();
      const url = "/api/activity/events";
      const method = "POST";
      const payload = {
        eventName: event.eventName,
        clientEventId: event.clientEventId,
        targetType: event.targetType,
        targetId: event.targetId,
        targetLabel: event.targetLabel,
        detail: event.detail,
      };
      const body = JSON.stringify(payload);

      let status = 0;
      if (bridge) {
        const response = await bridge.authRequest(url, method, body);
        status = response.status;
      } else {
        const response = await fetch(url, {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body,
        });
        status = response.status;
      }
      return status >= 200 && status < 300;
    } catch {
      // Activity recording errors must be silent (no console warnings even on network/403 failure)
      return false;
    }
  },

  listActivity: async (params: {
    page?: number;
    pageSize?: number;
    actorId?: number;
    category?: string;
    action?: string;
    outcome?: string;
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
  }): Promise<{ ok: true; data: ActivityLogResponse } | { ok: false; error: string }> => {
    try {
      const search = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') {
          search.append(k, String(v));
        }
      }

      const bridge = getDesktopBridge();
      const url = `/api/admin/activity?${search.toString()}`;

      let resStatus = 0;
      let resBody: any = null;

      if (bridge) {
        const response = await bridge.authRequest(url, "GET");
        resStatus = response.status;
        resBody = response.body;
      } else {
        const response = await fetch(url, { credentials: "include" });
        resStatus = response.status;
        resBody = await response.json().catch(() => ({}));
      }

      if (resStatus >= 200 && resStatus < 300) {
        return { ok: true, data: resBody as ActivityLogResponse };
      }
      return { ok: false, error: resBody?.error ?? "Request failed" };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }
};
