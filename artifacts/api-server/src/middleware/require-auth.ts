import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import type { Role } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUserId, clearSession } from "../lib/auth-session.js";
import {
  normalizeRole,
  roleHasPermission,
  isSuperadmin,
  type Permission,
} from "../lib/permissions.js";

export interface SessionUser {
  userId: number;
  username: string;
  /** Canonical governance role (authoritative). */
  role: Role;
  /** Legacy compatibility flag: true iff role === "SUPERADMIN". */
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
 * - Attaches the full current DB state (role, isAdmin, forcePasswordChange) to
 *   req.sessionUser. Because this reads live DB state on every request, role
 *   changes and revocations take effect immediately.
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
      role: usersTable.role,
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

  const role = normalizeRole(user.role, user.isAdmin);
  req.sessionUser = {
    userId: user.id,
    username: user.username,
    role,
    isAdmin: isSuperadmin(role),
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
 * Enforces Superadmin privilege using the current DB state (resolved by
 * requireAuth). Retained for backwards compatibility with existing admin
 * routes. Must be applied after requireAuth.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.sessionUser || !isSuperadmin(req.sessionUser.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/**
 * Enforces that the session user's role grants a specific centralized
 * permission. Must be applied after requireAuth.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.sessionUser || !roleHasPermission(req.sessionUser.role, permission)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/** Enforces that the current role grants at least one of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !req.sessionUser ||
      !permissions.some((permission) =>
        roleHasPermission(req.sessionUser!.role, permission),
      )
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
