import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setSession, clearSession } from "../lib/auth-session.js";
import { requireAuth } from "../middleware/require-auth.js";
import { normalizeRole, permissionsForRole } from "../lib/permissions.js";
import {
  recordActivitySafe,
  actorFromSession,
  actorFromUser,
  isAdminRole,
} from "../lib/activity-service.js";

const router: IRouter = Router();

// POST /api/auth/login — no auth required
router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username.trim()))
    .limit(1);

  if (!user) {
    // Constant-time compare to prevent username enumeration
    await bcrypt.compare(password, "$2b$12$invalidhashtopreventtiming");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const attemptRole = normalizeRole(user.role, user.isAdmin);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    // Record only known-admin invalid-password attempts; skip ordinary
    // CLIENT_REVIEWER / nonexistent-user login noise.
    if (isAdminRole(attemptRole)) {
      await recordActivitySafe(
        {
          actor: actorFromUser({
            id: user.id,
            username: user.username,
            role: attemptRole,
          }),
          category: "AUTH",
          action: "LOGIN",
          outcome: "FAILURE",
          detail: { reason: "invalid_password" },
          requestId: req.id ? String(req.id) : null,
        },
        req.log,
      );
    }
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Store only the user ID in the cookie; all other state is resolved from DB
  setSession(res, user.id, user.isAdmin);

  const role = normalizeRole(user.role, user.isAdmin);

  // Record successful admin/Firmware Admin logins only.
  if (isAdminRole(role)) {
    await recordActivitySafe(
      {
        actor: actorFromUser({ id: user.id, username: user.username, role }),
        category: "AUTH",
        action: "LOGIN",
        outcome: "SUCCESS",
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
  }
  res.json({
    userId: user.id,
    username: user.username,
    role,
    permissions: permissionsForRole(role),
    // Legacy compatibility field retained for existing clients.
    isAdmin: role === "SUPERADMIN",
    forcePasswordChange: user.forcePasswordChange,
  });
});

// POST /api/auth/logout — requireAuth to ensure valid session, but skip forcePasswordChange check
router.post("/logout", requireAuth, async (req, res) => {
  const su = req.sessionUser;
  if (isAdminRole(su?.role)) {
    await recordActivitySafe(
      {
        actor: actorFromSession(su),
        category: "AUTH",
        action: "LOGOUT",
        outcome: "SUCCESS",
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
  }
  clearSession(res);
  res.json({ ok: true });
});

// GET /api/auth/session — returns authoritative DB state including forcePasswordChange
router.get("/session", requireAuth, (req, res) => {
  // req.sessionUser is populated from DB by requireAuth
  const su = req.sessionUser!;
  res.json({
    ...su,
    permissions: permissionsForRole(su.role),
  });
});

// POST /api/auth/change-password — requireAuth only; forcePasswordChange users ARE allowed here
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string" ||
    newPassword.length < 8
  ) {
    res
      .status(400)
      .json({ error: "currentPassword and newPassword (min 8 chars) required" });
    return;
  }

  const userId = req.sessionUser!.userId;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash, forcePasswordChange: false })
    .where(eq(usersTable.id, userId));

  const su = req.sessionUser!;
  if (isAdminRole(su.role)) {
    await recordActivitySafe(
      {
        actor: actorFromSession(su),
        category: "SECURITY",
        action: "PASSWORD_CHANGED",
        outcome: "SUCCESS",
        targetType: "user",
        targetId: su.userId,
        targetLabel: su.username,
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
  }

  res.json({ ok: true });
});

export default router;
