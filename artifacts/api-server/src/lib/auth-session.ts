import type { Request, Response } from "express";

export interface SessionUser {
  userId: number;
  username: string;
  isAdmin: boolean;
  forcePasswordChange: boolean;
}

const COOKIE_NAME = "lsn_session";

/** Extract the user ID from the signed session cookie. Returns null if absent or invalid. */
export function getSessionUserId(req: Request): number | null {
  const raw = req.signedCookies?.[COOKIE_NAME];
  if (!raw || raw === false) return null;
  try {
    // Support both new (number) and legacy (JSON object) cookie shapes
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "number") return parsed;
    if (parsed && typeof parsed === "object" && "userId" in parsed) {
      const id = (parsed as { userId: unknown }).userId;
      if (typeof id === "number") return id;
    }
    return null;
  } catch {
    return null;
  }
}

const STANDARD_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/** Store only the userId in the signed HttpOnly cookie. */
export function setSession(
  res: Response,
  userId: number,
  isAdmin: boolean,
): void {
  res.cookie(COOKIE_NAME, JSON.stringify(userId), {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: isAdmin ? ADMIN_SESSION_MS : STANDARD_SESSION_MS,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}
