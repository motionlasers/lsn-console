import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, adminActivityTable } from "@workspace/db/schema";
import { ROLES, type Role } from "@workspace/db/schema";
import { eq, ne, and, count, desc, gte, lte, type SQL } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  requireAuth,
  requirePasswordChanged,
  requireAdmin,
} from "../middleware/require-auth.js";
import { normalizeRole } from "../lib/permissions.js";
import {
  recordActivitySafe,
  actorFromSession,
  RETENTION_POLICY,
} from "../lib/activity-service.js";

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
    await recordActivitySafe(
      {
        actor: actorFromSession(req.sessionUser),
        category: "USER_MANAGEMENT",
        action: "USER_CREATED",
        outcome: "SUCCESS",
        targetType: "user",
        targetId: created.id,
        targetLabel: created.username,
        detail: { role: resolvedRole },
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
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
  const passwordReset = typeof password === "string";

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

  let beforeRole: Role | undefined;
  let targetUsername: string | undefined;
  if (targetRole !== undefined) {
    // Determine current role of the target user.
    const [existing] = await db
      .select({
        isAdmin: usersTable.isAdmin,
        role: usersTable.role,
        username: usersTable.username,
      })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const currentRole = normalizeRole(existing.role, existing.isAdmin);
    beforeRole = currentRole;
    targetUsername = existing.username;

    // Last-Superadmin protection: cannot demote the final SUPERADMIN.
    if (currentRole === "SUPERADMIN" && targetRole !== "SUPERADMIN") {
      const [{ count: superadminCount }] = await db
        .select({ count: count() })
        .from(usersTable)
        .where(and(eq(usersTable.role, "SUPERADMIN"), ne(usersTable.id, id)));
      if (Number(superadminCount) === 0) {
        await recordActivitySafe(
          {
            actor: actorFromSession(req.sessionUser),
            category: "USER_MANAGEMENT",
            action: "ROLE_CHANGED",
            outcome: "DENIED",
            targetType: "user",
            targetId: id,
            targetLabel: existing.username,
            detail: { reason: "last_superadmin", from: currentRole, to: targetRole },
            requestId: req.id ? String(req.id) : null,
          },
          req.log,
        );
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

  if (targetRole !== undefined && beforeRole !== undefined && beforeRole !== targetRole) {
    await recordActivitySafe(
      {
        actor: actorFromSession(req.sessionUser),
        category: "USER_MANAGEMENT",
        action: "ROLE_CHANGED",
        outcome: "SUCCESS",
        targetType: "user",
        targetId: updated.id,
        targetLabel: targetUsername ?? updated.username,
        detail: { from: beforeRole, to: targetRole },
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
  }

  if (passwordReset) {
    await recordActivitySafe(
      {
        actor: actorFromSession(req.sessionUser),
        category: "SECURITY",
        action: "PASSWORD_RESET",
        outcome: "SUCCESS",
        targetType: "user",
        targetId: updated.id,
        targetLabel: updated.username,
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
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
    await recordActivitySafe(
      {
        actor: actorFromSession(req.sessionUser),
        category: "USER_MANAGEMENT",
        action: "USER_DELETED",
        outcome: "DENIED",
        targetType: "user",
        targetId: id,
        detail: { reason: "self_delete" },
        requestId: req.id ? String(req.id) : null,
      },
      req.log,
    );
    res.status(409).json({ error: "Cannot delete your own account" });
    return;
  }

  const [user] = await db
    .select({
      isAdmin: usersTable.isAdmin,
      role: usersTable.role,
      username: usersTable.username,
    })
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
      await recordActivitySafe(
        {
          actor: actorFromSession(req.sessionUser),
          category: "USER_MANAGEMENT",
          action: "USER_DELETED",
          outcome: "DENIED",
          targetType: "user",
          targetId: id,
          targetLabel: user.username,
          detail: { reason: "last_superadmin" },
          requestId: req.id ? String(req.id) : null,
        },
        req.log,
      );
      res.status(409).json({ error: "Cannot delete the last Superadmin" });
      return;
    }
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  await recordActivitySafe(
    {
      actor: actorFromSession(req.sessionUser),
      category: "USER_MANAGEMENT",
      action: "USER_DELETED",
      outcome: "SUCCESS",
      targetType: "user",
      targetId: id,
      targetLabel: user.username,
      detail: { role },
      requestId: req.id ? String(req.id) : null,
    },
    req.log,
  );
  res.json({ ok: true });
});

// GET /api/admin/activity — Superadmin-only append-only audit reader.
// Supports page/pageSize (max 100) + actorId/category/action/outcome/
// targetType/targetId/from/to filters. Never exposes request/session secrets.
const MAX_PAGE_SIZE = 100;

router.get("/activity", async (req, res): Promise<void> => {
  const q = req.query;

  const pageRaw = Number(q.page);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const pageSizeRaw = Number(q.pageSize);
  let pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? Math.floor(pageSizeRaw) : 25;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  const conditions: SQL[] = [];

  // page/pageSize must be valid positive integers when supplied.
  if (typeof q.page === "string" && q.page.length > 0 && !/^\d+$/.test(q.page)) {
    res.status(400).json({ error: "Invalid page" });
    return;
  }
  if (
    typeof q.pageSize === "string" &&
    q.pageSize.length > 0 &&
    !/^\d+$/.test(q.pageSize)
  ) {
    res.status(400).json({ error: "Invalid pageSize" });
    return;
  }

  const actorIdRaw = q.actorId;
  if (typeof actorIdRaw === "string" && actorIdRaw.length > 0) {
    // Strictly an integer id — reject fractional/garbage rather than coercing.
    if (!/^\d+$/.test(actorIdRaw)) {
      res.status(400).json({ error: "Invalid actorId" });
      return;
    }
    const actorId = Number(actorIdRaw);
    if (!Number.isSafeInteger(actorId)) {
      res.status(400).json({ error: "Invalid actorId" });
      return;
    }
    conditions.push(eq(adminActivityTable.actorId, actorId));
  }

  if (typeof q.category === "string" && q.category.length > 0) {
    if (!["AUTH", "SECURITY", "USER_MANAGEMENT", "PROFILE_GOVERNANCE", "CLIENT_EVENT", "DOWNLOAD"].includes(q.category)) {
      res.status(400).json({ error: "Invalid category" });
      return;
    }
    conditions.push(eq(adminActivityTable.category, q.category));
  }
  if (typeof q.action === "string" && q.action.length > 0) {
    if (!/^[A-Z_]{1,80}$/.test(q.action)) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }
    conditions.push(eq(adminActivityTable.action, q.action));
  }
  if (typeof q.outcome === "string" && q.outcome.length > 0) {
    if (!["SUCCESS", "FAILURE", "DENIED"].includes(q.outcome)) {
      res.status(400).json({ error: "Invalid outcome" });
      return;
    }
    conditions.push(eq(adminActivityTable.outcome, q.outcome));
  }
  if (typeof q.targetType === "string" && q.targetType.length > 0) {
    if (!/^[A-Za-z0-9_./:-]{1,80}$/.test(q.targetType)) {
      res.status(400).json({ error: "Invalid targetType" });
      return;
    }
    conditions.push(eq(adminActivityTable.targetType, q.targetType));
  }
  if (typeof q.targetId === "string" && q.targetId.length > 0) {
    if (!/^[A-Za-z0-9_./:-]{1,160}$/.test(q.targetId)) {
      res.status(400).json({ error: "Invalid targetId" });
      return;
    }
    conditions.push(eq(adminActivityTable.targetId, q.targetId));
  }

  if (typeof q.from === "string" && q.from.length > 0) {
    const from = new Date(q.from);
    if (Number.isNaN(from.getTime())) {
      res.status(400).json({ error: "Invalid from date" });
      return;
    }
    conditions.push(gte(adminActivityTable.createdAt, from));
  }
  if (typeof q.to === "string" && q.to.length > 0) {
    const to = new Date(q.to);
    if (Number.isNaN(to.getTime())) {
      res.status(400).json({ error: "Invalid to date" });
      return;
    }
    conditions.push(lte(adminActivityTable.createdAt, to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Explicit column projection — never expose request/session secrets or the
  // internal client idempotency key. actorId/actorUsername/actorRole are
  // nullable (the actor may have been deleted; snapshots are retained).
  const columns = {
    id: adminActivityTable.id,
    actorId: adminActivityTable.actorId,
    actorUsername: adminActivityTable.actorUsername,
    actorRole: adminActivityTable.actorRole,
    category: adminActivityTable.category,
    action: adminActivityTable.action,
    outcome: adminActivityTable.outcome,
    targetType: adminActivityTable.targetType,
    targetId: adminActivityTable.targetId,
    targetLabel: adminActivityTable.targetLabel,
    detail: adminActivityTable.detail,
    requestId: adminActivityTable.requestId,
    createdAt: adminActivityTable.createdAt,
  };

  const [{ total }] = await db
    .select({ total: count() })
    .from(adminActivityTable)
    .where(where);

  const items = await db
    .select(columns)
    .from(adminActivityTable)
    .where(where)
    .orderBy(desc(adminActivityTable.createdAt), desc(adminActivityTable.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({
    items,
    page,
    pageSize,
    total: Number(total),
    retentionPolicy: RETENTION_POLICY,
  });
});

export default router;
