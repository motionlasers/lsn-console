import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, like, and, ne } from "drizzle-orm";
import { ensureUser, deleteUser, loginAgent } from "./helpers.js";
import { migrateRolesIfNeeded } from "../src/lib/role-migrate.js";

let app: Express;
let superadmin: Agent;

beforeAll(async () => {
  ({ default: app } = await import("../src/app.js"));
  await ensureUser("t_admin_super", "SUPERADMIN");
  superadmin = await loginAgent(app, "t_admin_super");
});

afterAll(async () => {
  await db.delete(usersTable).where(like(usersTable.username, "t_admin_%"));
  await deleteUser("t_admin_super");
});

describe("superadmin user management with canonical roles", () => {
  it("backfills a legacy administrator even when the new role column has its reviewer default", async () => {
    const legacyId = await ensureUser("t_admin_backfill", "CLIENT_REVIEWER");
    await db
      .update(usersTable)
      .set({ role: "CLIENT_REVIEWER", isAdmin: true })
      .where(eq(usersTable.id, legacyId));
    await migrateRolesIfNeeded();
    const [migrated] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, legacyId))
      .limit(1);
    expect(migrated.role).toBe("SUPERADMIN");
    expect(migrated.isAdmin).toBe(true);
  });
  it("creates a Firmware Admin via explicit role assignment", async () => {
    const res = await superadmin
      .post("/api/admin/users")
      .send({ username: "t_admin_fw", password: "password123", role: "FIRMWARE_ADMIN" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("FIRMWARE_ADMIN");
    expect(res.body.isAdmin).toBe(false);
  });

  it("legacy isAdmin=true maps to SUPERADMIN on create", async () => {
    const res = await superadmin
      .post("/api/admin/users")
      .send({ username: "t_admin_legacy", password: "password123", isAdmin: true });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("SUPERADMIN");
    expect(res.body.isAdmin).toBe(true);
  });

  it("rejects an invalid role", async () => {
    const res = await superadmin
      .post("/api/admin/users")
      .send({ username: "t_admin_bad", password: "password123", role: "WIZARD" });
    expect(res.status).toBe(400);
  });

  it("updates a user's role and keeps isAdmin in sync", async () => {
    const [fw] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, "t_admin_fw"))
      .limit(1);
    const res = await superadmin
      .put(`/api/admin/users/${fw.id}`)
      .send({ role: "SUPERADMIN" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("SUPERADMIN");
    expect(res.body.isAdmin).toBe(true);
  });
});

describe("last-Superadmin protection", () => {
  // These assertions require the test user to be the *sole* superadmin. Because
  // the shared DB contains real superadmins (seeded admins), we temporarily
  // demote all other superadmins around each assertion and restore them after,
  // so the test is hermetic and non-destructive.
  async function withSoleSuperadmin<T>(
    soleId: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const others = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.role, "SUPERADMIN"), ne(usersTable.id, soleId)));
    // Demote others to CLIENT_REVIEWER (keep isAdmin in sync).
    for (const o of others) {
      await db
        .update(usersTable)
        .set({ role: "CLIENT_REVIEWER", isAdmin: false })
        .where(eq(usersTable.id, o.id));
    }
    try {
      return await fn();
    } finally {
      for (const o of others) {
        await db
          .update(usersTable)
          .set({ role: "SUPERADMIN", isAdmin: true })
          .where(eq(usersTable.id, o.id));
      }
    }
  }

  it("cannot demote the last Superadmin via role update", async () => {
    await db.delete(usersTable).where(like(usersTable.username, "t_admin_%"));
    const lastId = await ensureUser("t_admin_last", "SUPERADMIN");
    const agent = await loginAgent(app, "t_admin_last");

    await withSoleSuperadmin(lastId, async () => {
      const res = await agent
        .put(`/api/admin/users/${lastId}`)
        .send({ role: "CLIENT_REVIEWER" });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/last Superadmin/i);
    });
  });

  it("cannot delete the last Superadmin, but can delete one when others remain", async () => {
    const lastId = (
      await db.select().from(usersTable).where(eq(usersTable.username, "t_admin_last")).limit(1)
    )[0].id;
    const actorId = await ensureUser("t_admin_actor", "SUPERADMIN");
    const actor = await loginAgent(app, "t_admin_actor");

    // Two test superadmins exist (plus restored real ones): deleting one is OK.
    const okDelete = await actor.delete(`/api/admin/users/${lastId}`);
    expect(okDelete.status).toBe(200);

    // Now make `t_admin_actor` the sole superadmin and confirm it cannot be
    // deleted (self-delete guard is 409; and it is the last superadmin).
    await withSoleSuperadmin(actorId, async () => {
      const selfDelete = await actor.delete(`/api/admin/users/${actorId}`);
      expect(selfDelete.status).toBe(409);
    });
  });
});
