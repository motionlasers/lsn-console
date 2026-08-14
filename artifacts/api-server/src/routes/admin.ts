import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, ne, and, count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  requireAuth,
  requirePasswordChanged,
  requireAdmin,
} from "../middleware/require-auth.js";

const router: IRouter = Router();

// All admin routes require: valid session + password changed + admin flag
router.use(requireAuth, requirePasswordChanged, requireAdmin);

// GET /api/admin/users
router.get("/users", async (_req, res) => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      isAdmin: usersTable.isAdmin,
      forcePasswordChange: usersTable.forcePasswordChange,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(users);
});

// POST /api/admin/users — create new user
router.post("/users", async (req, res) => {
  const { username, password, isAdmin = false } = req.body ?? {};
  if (
    typeof username !== "string" ||
    username.trim().length < 2 ||
    typeof password !== "string" ||
    password.length < 8
  ) {
    res.status(400).json({
      error: "username (min 2 chars) and password (min 8 chars) required",
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const [created] = await db
      .insert(usersTable)
      .values({
        username: username.trim(),
        passwordHash,
        isAdmin: Boolean(isAdmin),
        forcePasswordChange: true,
      })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        isAdmin: usersTable.isAdmin,
        forcePasswordChange: usersTable.forcePasswordChange,
        createdAt: usersTable.createdAt,
      });
    res.status(201).json(created);
  } catch (err: unknown) {
    const isUnique =
      err instanceof Error && err.message.includes("unique");
    if (isUnique) {
      res.status(409).json({ error: "Username already exists" });
    } else {
      res.status(500).json({ error: "Failed to create user" });
    }
  }
});

// PUT /api/admin/users/:id — update password and/or admin flag
router.put("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const { password, isAdmin } = req.body ?? {};
  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (typeof password === "string") {
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    updates.passwordHash = await bcrypt.hash(password, 12);
    updates.forcePasswordChange = false;
  }

  if (typeof isAdmin === "boolean") {
    // Prevent removing admin status from the last admin
    if (!isAdmin) {
      const [{ count: adminCount }] = await db
        .select({ count: count() })
        .from(usersTable)
        .where(and(eq(usersTable.isAdmin, true), ne(usersTable.id, id)));
      if (Number(adminCount) === 0) {
        res.status(409).json({ error: "Cannot remove the last admin" });
        return;
      }
    }
    updates.isAdmin = isAdmin;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      isAdmin: usersTable.isAdmin,
      forcePasswordChange: usersTable.forcePasswordChange,
      createdAt: usersTable.createdAt,
    });

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(updated);
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  const id = Number(req.params.id);
  const selfId = req.sessionUser!.userId;

  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (id === selfId) {
    res.status(409).json({ error: "Cannot delete your own account" });
    return;
  }

  // Guard: cannot delete the last admin
  const [user] = await db
    .select({ isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.isAdmin) {
    const [{ count: adminCount }] = await db
      .select({ count: count() })
      .from(usersTable)
      .where(eq(usersTable.isAdmin, true));
    if (Number(adminCount) <= 1) {
      res.status(409).json({ error: "Cannot delete the last admin" });
      return;
    }
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

export default router;
