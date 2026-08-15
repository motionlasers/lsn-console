// Auth API client — all requests go to /api/auth/* and /api/admin/*
// Cookies are included automatically (same-origin, HttpOnly session cookie).

import { getDesktopBridge } from "./desktop";

export interface SessionUser {
  userId: number;
  username: string;
  isAdmin: boolean;
  /** True when the server requires this user to set a new password before proceeding */
  forcePasswordChange: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  forcePasswordChange: boolean;
  createdAt: string;
}

async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const bridge = getDesktopBridge();
    const method = options?.method ?? "GET";
    const response = bridge
      ? await bridge.authRequest(
          url,
          method,
          typeof options?.body === "string" ? options.body : undefined,
        )
      : await fetch(url, {
          credentials: "include",
          headers: { "Content-Type": "application/json", ...options?.headers },
          ...options,
        }).then(async (res) => ({
          status: res.status,
          body: await res.json().catch(() => ({})),
        }));
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, data: response.body as T };
    }
    return {
      ok: false,
      error: (response.body as { error?: string }).error ?? "Request failed",
      status: response.status,
    };
  } catch {
    return { ok: false, error: "Network error", status: 0 };
  }
}

export const authApi = {
  /** Returns the authoritative DB state for the current session, including forcePasswordChange. */
  getSession: () => apiFetch<SessionUser>("/api/auth/session"),

  login: (username: string, password: string) =>
    apiFetch<SessionUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const adminApi = {
  listUsers: () => apiFetch<AdminUser[]>("/api/admin/users"),

  createUser: (username: string, password: string, isAdmin: boolean) =>
    apiFetch<AdminUser>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, password, isAdmin }),
    }),

  updateUser: (id: number, updates: { password?: string; isAdmin?: boolean }) =>
    apiFetch<AdminUser>(`/api/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  deleteUser: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/admin/users/${id}`, { method: "DELETE" }),
};
