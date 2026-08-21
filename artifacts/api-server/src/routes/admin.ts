import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { ROLES, type Role } from "@workspace/db/schema";
import { eq, ne, and, count } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  requireAuth,
  requirePasswordChanged,
  requireAdmin,
} from "../middleware/require-auth.js";
import { normalizeRole } from "../lib/permissions.js";

const router: IRouter = Router();

// All admin routes require: valid session + password changed + Superadmin role
router.use(requireAuth, requirePasswordChanged, requireAdmin);

function isValidRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

function projectUser(row: {
  id: number;
  username: string;
  isAdmin: boolean;
  role: string;
  forcePasswordChange: boolean;
  createdAt: Date;
}) {
  const role = normalizeRole(row.role, row.isAdmin);
  return {
    id: row.id,
    username: row.username,
    role,
    // Legacy compatibility field.
    isAdmin: role === "SUPERADMIN",
    forcePasswordChange: row.forcePasswordChange,
    createdAt: row.createdAt,
  };
}

const userColumns = {
  id: usersTable.id,
  username: usersTable.username,
  isAdmin: usersTable.isAdmin,
  role: usersTable.role,
  forcePasswordChange: usersTable.forcePasswordChange,
  createdAt: usersTable.createdAt,
};

// GET /api/admin/users
router.get("/users", async (_req, res): Promise<void> => {
  const users = await db
    .select(userColumns)
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(users.map(projectUser));
});

// POST /api/admin/users — create new user
// Accepts either { role } (canonical) or legacy { isAdmin } to pick the role.
router.post("/users", async (req, res): Promise<void> => {
  const { username, password, role, isAdmin } = req.body ?? {};
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

  let resolvedRole: Role;
  if (role !== undefined) {
    if (!isValidRole(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    resolvedRole = role;
  } else {
    // Legacy path: isAdmin boolean maps to SUPERADMIN / CLIENT_REVIEWER
    resolvedRole = isAdmin === true ? "SUPERADMIN" : "CLIENT_REVIEWER";
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const [created] = await db
      .insert(usersTable)
      .values({
        username: username.trim(),
        passwordHash,
        role: resolvedRole,
        isAdmin: resolvedRole === "SUPERADMIN",
        forcePasswordChange: true,
      })
      .returning(userColumns);
    res.status(201).json(projectUser(created));
  } catch (err: unknown) {
    const isUnique = err instanceof Error && err.message.includes("unique");
    if (isUnique) {
      res.status(409).json({ error: "Username already exists" });
    } else {
      req.log.error({ err }, "Failed to create user");
      res.status(500).json({ error: "Failed to create user" });
    }
  }
});

// PUT /api/admin/users/:id — update password and/or role.
// Enforces last-Superadmin protection when demoting away from SUPERADMIN.
router.put("/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const { password, role, isAdmin } = req.body ?? {};
  const updates: Partial<typeof usersTable.$inferInsert> = {};

  if (typeof password === "string") {
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }
    updates.passwordHash = await bcrypt.hash(password, 12);
    updates.forcePasswordChange = false;
  }

  // Resolve a target role from either the canonical `role` or legacy `isAdmin`.
  let targetRole: Role | undefined;
  if (role !== undefined) {
    if (!isValidRole(role)) {
      res.status(400).json({ error: "Invalid role" });
      return;
    }
    targetRole = role;
  } else if (typeof isAdmin === "boolean") {
    targetRole = isAdmin ? "SUPERADMIN" : "CLIENT_REVIEWER";
  }

  if (targetRole !== undefined) {
    // Determine current role of the target user.
    const [existing] = await db
      .select({ isAdmin: usersTable.isAdmin, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentRole = normalizeRole(existing.role, existing.isAdmin);

    // Last-Superadmin protection: cannot demote the final SUPERADMIN.
    if (currentRole === "SUPERADMIN" && targetRole !== "SUPERADMIN") {
      const [{ count: superadminCount }] = await db
        .select({ count: count() })
        .from(usersTable)
        .where(and(eq(usersTable.role, "SUPERADMIN"), ne(usersTable.id, id)));
      if (Number(superadminCount) === 0) {
        res.status(409).json({ error: "Cannot remove the last Superadmin" });
        return;
      }
    }

    updates.role = targetRole;
    updates.isAdmin = targetRole === "SUPERADMIN";
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning(userColumns);

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(projectUser(updated));
});

// DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res): Promise<void> => {
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

  const [user] = await db
    .select({ isAdmin: usersTable.isAdmin, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Guard: cannot delete the last Superadmin.
  const role = normalizeRole(user.role, user.isAdmin);
  if (role === "SUPERADMIN") {
    const [{ count: superadminCount }] = await db
      .select({ count: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "SUPERADMIN"));
    if (Number(superadminCount) <= 1) {
      res.status(409).json({ error: "Cannot delete the last Superadmin" });
      return;
    }
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

export default router;
