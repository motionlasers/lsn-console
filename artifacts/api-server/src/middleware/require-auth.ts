import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUserId, clearSession } from "../lib/auth-session.js";

export interface SessionUser {
  userId: number;
  username: string;
  isAdmin: boolean;
  forcePasswordChange: boolean;
}

// Augment Express Request to carry the resolved DB user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

/**
 * Resolves the signed session cookie to a live DB row.
 * - Returns 401 if the cookie is missing, invalid, or the user was deleted.
 * - Attaches the full current DB state (including isAdmin, forcePasswordChange) to req.sessionUser.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      isAdmin: usersTable.isAdmin,
      forcePasswordChange: usersTable.forcePasswordChange,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    // User was deleted — clear their cookie
    clearSession(res);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.sessionUser = {
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    forcePasswordChange: user.forcePasswordChange,
  };
  next();
}

/**
 * Blocks users whose forcePasswordChange is true from all routes except
 * change-password and logout. Must be applied after requireAuth.
 */
export function requirePasswordChanged(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.sessionUser?.forcePasswordChange) {
    res
      .status(403)
      .json({ error: "Password change required before accessing this resource" });
    return;
  }
  next();
}

/**
 * Enforces admin privilege using the current DB state (already resolved by requireAuth).
 * Must be applied after requireAuth.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.sessionUser?.isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
