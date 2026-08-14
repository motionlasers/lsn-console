import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setSession, clearSession } from "../lib/auth-session.js";
import { requireAuth } from "../middleware/require-auth.js";

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

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Store only the user ID in the cookie; all other state is resolved from DB
  setSession(res, user.id, user.isAdmin);

  res.json({
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    forcePasswordChange: user.forcePasswordChange,
  });
});

// POST /api/auth/logout — requireAuth to ensure valid session, but skip forcePasswordChange check
router.post("/logout", requireAuth, (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// GET /api/auth/session — returns authoritative DB state including forcePasswordChange
router.get("/session", requireAuth, (req, res) => {
  // req.sessionUser is populated from DB by requireAuth
  res.json(req.sessionUser);
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

  res.json({ ok: true });
});

export default router;
