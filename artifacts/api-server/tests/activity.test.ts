import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { usersTable, adminActivityTable, profilesTable } from "@workspace/db/schema";
import { eq, and, like, desc } from "drizzle-orm";
import { ensureUser, deleteUser, loginAgent } from "./helpers.js";
import {
  boundDetail,
  filterClientDetail,
  boundTargetDescriptor,
  actorFromSession,
  isClientEventName,
  ensureAdminActivityAppendOnly,
} from "../src/lib/activity-service.js";

let app: Express;
let superadmin: Agent;
let firmware: Agent;
let reviewer: Agent;

const PREFIX = `t_act_${process.pid}_`;

async function cleanupActivity(): Promise<void> {
  // The production audit stream is append-only. Tests use unique identifiers
  // and intentionally leave their audit evidence in place.
}

beforeAll(async () => {
  ({ default: app } = await import("../src/app.js"));
  await ensureUser(`${PREFIX}super`, "SUPERADMIN");
  await ensureUser(`${PREFIX}fw`, "FIRMWARE_ADMIN");
  await ensureUser(`${PREFIX}rev`, "CLIENT_REVIEWER");
  superadmin = await loginAgent(app, `${PREFIX}super`);
  firmware = await loginAgent(app, `${PREFIX}fw`);
  reviewer = await loginAgent(app, `${PREFIX}rev`);
});

afterAll(async () => {
  await cleanupActivity();
  await db.delete(usersTable).where(like(usersTable.username, `${PREFIX}%`));
  await deleteUser(`${PREFIX}super`);
  await deleteUser(`${PREFIX}fw`);
  await deleteUser(`${PREFIX}rev`);
});

// ---------------------------------------------------------------------------
// Unit: redaction / bounds / allowlist
// ---------------------------------------------------------------------------
describe("detail bounding + redaction", () => {
  it("drops forbidden keys (passwords/tokens/cookies/documents/firmware/cip/telemetry)", () => {
    const out = boundDetail({
      keep: "ok",
      password: "hunter2",
      passwordHash: "$2b$...",
      accessToken: "abc",
      sessionCookie: "c",
      rawBody: { x: 1 },
      document: { fields: [] },
      firmwareBlob: "…",
      cipService: "0x10",
      telemetry: { fps: 60 },
      evidence: { pass: true },
    });
    expect(out.keep).toBe("ok");
    expect(out).not.toHaveProperty("password");
    expect(out).not.toHaveProperty("passwordHash");
    expect(out).not.toHaveProperty("accessToken");
    expect(out).not.toHaveProperty("sessionCookie");
    expect(out).not.toHaveProperty("rawBody");
    expect(out).not.toHaveProperty("document");
    expect(out).not.toHaveProperty("firmwareBlob");
    expect(out).not.toHaveProperty("cipService");
    expect(out).not.toHaveProperty("telemetry");
    expect(out).not.toHaveProperty("evidence");
  });

  it("bounds string length", () => {
    const out = boundDetail({ note: "x".repeat(5000) });
    expect(String(out.note).length).toBeLessThan(600);
    expect(String(out.note)).toContain("truncated");
  });

  it("bounds object depth", () => {
    const out = boundDetail({ a: { b: { c: { d: { e: 1 } } } } });
    const serialized = JSON.stringify(out);
    // Deeply nested value collapses to a marker rather than persisting fully.
    expect(serialized).toMatch(/\[object\]|\[array\]/);
  });

  it("replaces oversized total payloads with a marker", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 20; i++) big[`k${i}`] = "y".repeat(500);
    const out = boundDetail(big);
    expect(out).toHaveProperty("note");
  });
});

describe("client event allowlist", () => {
  it("recognises only the three allowed events", () => {
    expect(isClientEventName("PAGE_VISIT")).toBe(true);
    expect(isClientEventName("SETTING_CHANGED")).toBe(true);
    expect(isClientEventName("DESKTOP_ACTION")).toBe(true);
    expect(isClientEventName("SOMETHING_ELSE")).toBe(false);
    expect(isClientEventName(123)).toBe(false);
  });

  it("filters detail to the per-event allowlist", () => {
    const out = filterClientDetail("PAGE_VISIT", {
      page: "/admin",
      evil: "drop-me",
      password: "no",
    });
    expect(out).toEqual({ page: "/admin" });
  });

  it("SETTING_CHANGED and DESKTOP_ACTION each have their own allowlist", () => {
    expect(filterClientDetail("SETTING_CHANGED", { before: "dark", after: "light", nope: 1 })).toEqual({
      before: "[text value]",
      after: "[text value]",
    });
    // A key allowed for one event is dropped for another.
    expect(filterClientDetail("DESKTOP_ACTION", { before: "dark", operation: "download" })).toEqual({
      operation: "download",
    });
  });

  it("bounds target descriptors and drops non-primitives", () => {
    expect(boundTargetDescriptor("release")).toBe("release");
    expect(boundTargetDescriptor(42)).toBe("42");
    expect(boundTargetDescriptor({ nested: true })).toBeNull();
    expect(boundTargetDescriptor(["a"])).toBeNull();
    expect(boundTargetDescriptor(null)).toBeNull();
    expect(String(boundTargetDescriptor("z".repeat(2000))).length).toBeLessThan(600);
  });
});

describe("actor derivation is server-derived", () => {
  it("derives from the session user, ignoring body-provided actors", () => {
    const a = actorFromSession({
      userId: 7,
      username: "srv",
      role: "SUPERADMIN",
      isAdmin: true,
      forcePasswordChange: false,
    });
    expect(a).toEqual({ actorId: 7, actorUsername: "srv", actorRole: "SUPERADMIN" });
  });
});

describe("database append-only guard", () => {
  it("rejects ordinary UPDATE and DELETE mutations", async () => {
    await ensureAdminActivityAppendOnly();
    const [row] = await db
      .insert(adminActivityTable)
      .values({
        actorUsername: `${PREFIX}immutable`,
        category: "SECURITY",
        action: "IMMUTABILITY_TEST",
        outcome: "SUCCESS",
      })
      .returning();
    await expect(
      db.update(adminActivityTable).set({ outcome: "FAILURE" }).where(eq(adminActivityTable.id, row.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(adminActivityTable).where(eq(adminActivityTable.id, row.id)),
    ).rejects.toThrow();
    const [unchanged] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.id, row.id));
    expect(unchanged.outcome).toBe("SUCCESS");
  });
});

// ---------------------------------------------------------------------------
// Auth events
// ---------------------------------------------------------------------------
describe("auth event recording", () => {
  beforeEach(cleanupActivity);

  it("records admin successful login + logout", async () => {
    const agent = await loginAgent(app, `${PREFIX}super`);
    await agent.post("/api/auth/logout");
    const rows = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.actorUsername, `${PREFIX}super`),
          eq(adminActivityTable.category, "AUTH"),
        ),
      );
    const actions = rows.map((r) => `${r.action}:${r.outcome}`);
    expect(actions).toContain("LOGIN:SUCCESS");
    expect(actions).toContain("LOGOUT:SUCCESS");
  });

  it("records known-admin invalid-password attempts", async () => {
    const res = await (await import("supertest")).default(app)
      .post("/api/auth/login")
      .send({ username: `${PREFIX}fw`, password: "wrong-password" });
    expect(res.status).toBe(401);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.actorUsername, `${PREFIX}fw`),
          eq(adminActivityTable.action, "LOGIN"),
          eq(adminActivityTable.outcome, "FAILURE"),
        ),
      )
      .limit(1);
    expect(row).toBeTruthy();
    expect(row.detail).toMatchObject({ reason: "invalid_password" });
  });

  it("skips ordinary CLIENT_REVIEWER login noise", async () => {
    await loginAgent(app, `${PREFIX}rev`);
    const rows = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.actorUsername, `${PREFIX}rev`),
          eq(adminActivityTable.category, "AUTH"),
        ),
      );
    expect(rows.length).toBe(0);
  });

  it("skips nonexistent-user login noise", async () => {
    const res = await (await import("supertest")).default(app)
      .post("/api/auth/login")
      .send({ username: `${PREFIX}ghost`, password: "whatever" });
    expect(res.status).toBe(401);
    const rows = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.actorUsername, `${PREFIX}ghost`));
    expect(rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// User management events + role change before/after + deletion survival
// ---------------------------------------------------------------------------
describe("user management recording", () => {
  beforeEach(cleanupActivity);

  it("records account create with role", async () => {
    const res = await superadmin
      .post("/api/admin/users")
      .send({ username: `${PREFIX}created`, password: "password123", role: "FIRMWARE_ADMIN" });
    expect(res.status).toBe(201);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.action, "USER_CREATED"))
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(row.detail).toMatchObject({ role: "FIRMWARE_ADMIN" });
    expect(row.targetLabel).toBe(`${PREFIX}created`);
    expect(row.actorUsername).toBe(`${PREFIX}super`);
  });

  it("records role change with before/after", async () => {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `${PREFIX}created`))
      .limit(1);
    const res = await superadmin
      .put(`/api/admin/users/${u.id}`)
      .send({ role: "CLIENT_REVIEWER" });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.action, "ROLE_CHANGED"))
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(row.outcome).toBe("SUCCESS");
    expect(row.detail).toMatchObject({ from: "FIRMWARE_ADMIN", to: "CLIENT_REVIEWER" });
  });

  it("records password reset", async () => {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `${PREFIX}created`))
      .limit(1);
    const res = await superadmin
      .put(`/api/admin/users/${u.id}`)
      .send({ password: "newpassword123" });
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.action, "PASSWORD_RESET"))
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(row.outcome).toBe("SUCCESS");
    expect(row.actorUsername).toBe(`${PREFIX}super`);
  });

  it("records self-delete denial", async () => {
    const [self] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `${PREFIX}super`))
      .limit(1);
    const res = await superadmin.delete(`/api/admin/users/${self.id}`);
    expect(res.status).toBe(409);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.action, "USER_DELETED"),
          eq(adminActivityTable.outcome, "DENIED"),
        ),
      )
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(row.detail).toMatchObject({ reason: "self_delete" });
  });

  it("records delete and the record survives target-user deletion", async () => {
    const targetId = await ensureUser(`${PREFIX}victim`, "CLIENT_REVIEWER");
    const res = await superadmin.delete(`/api/admin/users/${targetId}`);
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.action, "USER_DELETED"),
          eq(adminActivityTable.outcome, "SUCCESS"),
          eq(adminActivityTable.targetLabel, `${PREFIX}victim`),
        ),
      )
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(row).toBeTruthy();
    // actorId is preserved (actor still exists); the key property is survival:
    // deleting the *target* user does not remove the record.
    const stillThere = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.id, row.id))
      .limit(1);
    expect(stillThere.length).toBe(1);
  });

  it("preserves actor identity snapshots when the ACTOR is deleted", async () => {
    // Create a fresh superadmin actor, have them create a user (an activity
    // row), then delete the actor and confirm the immutable identity snapshot
    // remains intact without a live-user foreign key.
    const actorName = `${PREFIX}soon_gone`;
    await ensureUser(actorName, "SUPERADMIN");
    const actorAgent = await loginAgent(app, actorName);
    await actorAgent
      .post("/api/admin/users")
      .send({ username: `${PREFIX}byproduct`, password: "password123", role: "CLIENT_REVIEWER" });
    const [actorRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, actorName))
      .limit(1);
    const [activity] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.actorId, actorRow.id))
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(activity).toBeTruthy();

    // Delete the actor (via DB to bypass last-superadmin guard concerns).
    await db.delete(usersTable).where(eq(usersTable.id, actorRow.id));
    const [after] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.id, activity.id))
      .limit(1);
    expect(after).toBeTruthy();
    expect(after.actorId).toBe(actorRow.id);
    expect(after.actorUsername).toBe(actorName);
    expect(after.actorRole).toBe("SUPERADMIN");
  });
});

// ---------------------------------------------------------------------------
// POST /api/activity/events
// ---------------------------------------------------------------------------
describe("POST /api/activity/events", () => {
  beforeEach(cleanupActivity);

  it("consumes the exact contract {eventName, clientEventId, target*, detail} with idempotency", async () => {
    const clientEventId = randomUUID();
    const res1 = await superadmin
      .post("/api/activity/events")
      .send({
        eventName: "PAGE_VISIT",
        clientEventId,
        targetType: "ROUTE",
        targetId: "/settings",
        targetLabel: "/settings",
        detail: { page: "/admin", secret: "x" },
      });
    expect(res1.status).toBe(201);

    // Same clientEventId -> idempotent dedup (no duplicate row).
    const res2 = await superadmin
      .post("/api/activity/events")
      .send({
        eventName: "PAGE_VISIT",
        clientEventId,
        targetType: "ROUTE",
        targetId: "/settings",
        targetLabel: "/settings",
        detail: { page: "/admin" },
      });
    expect(res2.status).toBe(200);
    expect(res2.body.deduplicated).toBe(true);

    const rows = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.clientEventId, clientEventId));
    expect(rows.length).toBe(1);
    // detail is strict-filtered to the allowlist (secret dropped).
    expect(rows[0].detail).toEqual({ page: "/admin" });
    // target descriptors are persisted (regression: they were previously dropped).
    expect(rows[0].targetType).toBe("ROUTE");
    expect(rows[0].targetId).toBe("/settings");
    expect(rows[0].targetLabel).toBe("/settings");
    expect(rows[0].action).toBe("PAGE_VISIT");
  });

  it("rejects the legacy {event, metadata} shape (uses eventName + detail)", async () => {
    // Regression: sending the old field names must NOT be accepted.
    const res = await superadmin
      .post("/api/activity/events")
      .send({ event: "PAGE_VISIT", clientEventId: randomUUID(), metadata: { page: "/x" } });
    expect(res.status).toBe(400);
  });

  it("rejects unknown eventName", async () => {
    const res = await superadmin
      .post("/api/activity/events")
      .send({ eventName: "NOPE", clientEventId: randomUUID() });
    expect(res.status).toBe(400);
  });

  it("requires a clientEventId", async () => {
    const res = await superadmin
      .post("/api/activity/events")
      .send({ eventName: "PAGE_VISIT" });
    expect(res.status).toBe(400);
  });

  it("rejects credential-like and non-UUID clientEventId values", async () => {
    for (const clientEventId of [
      "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
      "session=superadmin-cookie",
      "password=correct-horse-battery-staple",
      `evt-${Date.now()}`,
    ]) {
      const res = await superadmin
        .post("/api/activity/events")
        .send({
          eventName: "PAGE_VISIT",
          clientEventId,
          targetType: "ROUTE",
          targetId: "/settings",
        });
      expect(res.status).toBe(400);
    }
  });

  it("rejects non-string target descriptors", async () => {
    const res = await superadmin
      .post("/api/activity/events")
      .send({ eventName: "PAGE_VISIT", clientEventId: randomUUID(), targetType: { evil: 1 } });
    expect(res.status).toBe(400);
  });

  it("rejects CLIENT_REVIEWER", async () => {
    const res = await reviewer
      .post("/api/activity/events")
      .send({ eventName: "PAGE_VISIT", clientEventId: randomUUID() });
    expect(res.status).toBe(403);
  });

  it("allows FIRMWARE_ADMIN", async () => {
    const res = await firmware
      .post("/api/activity/events")
      .send({
        eventName: "DESKTOP_ACTION",
        clientEventId: randomUUID(),
        targetType: "DOWNLOAD",
        targetId: "installer",
        targetLabel: "DOWNLOAD_INSTALLER",
        detail: { operation: "download", asset: "installer", result: "success" },
      });
    expect(res.status).toBe(201);
  });

  it("requires authentication", async () => {
    const res = await (await import("supertest")).default(app)
      .post("/api/activity/events")
      .send({ eventName: "PAGE_VISIT", clientEventId: "anon" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/activity/download/:asset
// ---------------------------------------------------------------------------
describe("GET /api/activity/download/:asset", () => {
  beforeEach(cleanupActivity);

  // Exact immutable release asset URLs (repo motionlasers/lsn-console,
  // tag lsn-console-v0.3.0). Any drift here is a redirect-data regression.
  const BASE =
    "https://github.com/motionlasers/lsn-console/releases/download/lsn-console-v0.3.0";
  const EXACT_URLS: Record<string, string> = {
    installer: `${BASE}/LSN-Engineering-Console-Setup-0.3.0-dev.exe`,
    portable: `${BASE}/LSN-Engineering-Console-Portable-0.3.0.zip`,
    checksums: `${BASE}/SHA256SUMS.txt`,
  };

  it("302-redirects installer to the EXACT pinned URL and records the request", async () => {
    const res = await superadmin
      .get("/api/activity/download/installer")
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(EXACT_URLS.installer);
    const [row] = await db
      .select()
      .from(adminActivityTable)
      .where(eq(adminActivityTable.action, "DOWNLOAD_REQUESTED"))
      .orderBy(desc(adminActivityTable.id))
      .limit(1);
    expect(row.detail).toMatchObject({ asset: "installer", releaseTag: "lsn-console-v0.3.0" });
  });

  it("302-redirects portable to the EXACT pinned URL", async () => {
    const res = await superadmin.get("/api/activity/download/portable").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(EXACT_URLS.portable);
  });

  it("302-redirects checksums to the EXACT pinned URL", async () => {
    const res = await superadmin.get("/api/activity/download/checksums").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(EXACT_URLS.checksums);
  });

  it("rejects unknown assets (no user-controlled URL)", async () => {
    const res = await superadmin
      .get("/api/activity/download/evil")
      .redirects(0);
    expect(res.status).toBe(404);
  });

  it("rejects CLIENT_REVIEWER", async () => {
    const res = await reviewer
      .get("/api/activity/download/installer")
      .redirects(0);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/activity (Superadmin-only, filters + pagination)
// ---------------------------------------------------------------------------
describe("GET /api/admin/activity", () => {
  beforeEach(cleanupActivity);

  it("is Superadmin-only", async () => {
    const fwRes = await firmware.get("/api/admin/activity");
    expect(fwRes.status).toBe(403);
    const revRes = await reviewer.get("/api/admin/activity");
    expect(revRes.status).toBe(403);
  });

  it("returns items/page/pageSize/total/retentionPolicy", async () => {
    const res = await superadmin.get("/api/admin/activity");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("pageSize");
    expect(res.body).toHaveProperty("total");
    expect(typeof res.body.retentionPolicy).toBe("string");
    expect(res.body.retentionPolicy).toMatch(/indefinite/i);
  });

  it("caps pageSize at 100", async () => {
    const res = await superadmin.get("/api/admin/activity?pageSize=5000");
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(100);
  });

  it("never exposes cookies, tokens, or internal clientEventId values in items", async () => {
    // Seed one row via a client event carrying a secret in detail.
    const cid = randomUUID();
    await superadmin
      .post("/api/activity/events")
      .send({
        eventName: "PAGE_VISIT",
        clientEventId: cid,
        targetType: "ROUTE",
        targetId: "/settings",
        targetLabel: "/settings",
        detail: { page: "/x", cookie: "abc" },
      });
    const res = await superadmin.get("/api/admin/activity?category=CLIENT_EVENT");
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body.items);
    // The forbidden value never persisted / never surfaces.
    expect(serialized).not.toContain("abc");
    expect(serialized).not.toContain(cid);
    const item = res.body.items.find((i: { action?: string }) => i.action === "PAGE_VISIT");
    expect(item).toBeTruthy();
    expect(item).not.toHaveProperty("clientEventId");
    expect(item).toHaveProperty("actorUsername");
  });

  it("rejects invalid from/to dates and non-integer numeric filters", async () => {
    const badFrom = await superadmin.get("/api/admin/activity?from=not-a-date");
    expect(badFrom.status).toBe(400);
    const badTo = await superadmin.get("/api/admin/activity?to=2024-99-99T99:99");
    expect(badTo.status).toBe(400);
    const badActor = await superadmin.get("/api/admin/activity?actorId=12abc");
    expect(badActor.status).toBe(400);
    const fractionalActor = await superadmin.get("/api/admin/activity?actorId=12.5");
    expect(fractionalActor.status).toBe(400);
    const badPage = await superadmin.get("/api/admin/activity?page=abc");
    expect(badPage.status).toBe(400);
    const badPageSize = await superadmin.get("/api/admin/activity?pageSize=-3");
    expect(badPageSize.status).toBe(400);
  });

  it("filters by category/action/outcome and paginates", async () => {
    // Create a couple of USER_MANAGEMENT rows.
    await superadmin
      .post("/api/admin/users")
      .send({ username: `${PREFIX}pg1`, password: "password123", role: "CLIENT_REVIEWER" });
    await superadmin
      .post("/api/admin/users")
      .send({ username: `${PREFIX}pg2`, password: "password123", role: "CLIENT_REVIEWER" });

    const res = await superadmin.get(
      "/api/admin/activity?category=USER_MANAGEMENT&action=USER_CREATED&outcome=SUCCESS&pageSize=1&page=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(1);
    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    for (const item of res.body.items) {
      expect(item.category).toBe("USER_MANAGEMENT");
      expect(item.action).toBe("USER_CREATED");
      expect(item.outcome).toBe("SUCCESS");
    }
  });

  it("filters by actorId", async () => {
    const [actor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `${PREFIX}super`))
      .limit(1);
    await superadmin
      .post("/api/admin/users")
      .send({ username: `${PREFIX}pg3`, password: "password123", role: "CLIENT_REVIEWER" });
    const res = await superadmin.get(`/api/admin/activity?actorId=${actor.id}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.actorId).toBe(actor.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Profile governance mirror
// ---------------------------------------------------------------------------
describe("profile governance mirror", () => {
  it("mirrors PROFILE_CREATED into admin_activity within the same transaction", async () => {
    const { createProfile } = await import("../src/lib/profile-service.js");
    const [actor] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `${PREFIX}super`))
      .limit(1);
    const key = `${PREFIX}mirror-${Date.now()}`;
    const profile = await createProfile(
      { userId: actor.id, username: `${PREFIX}super`, role: "SUPERADMIN" },
      { key, name: "Mirror Test" },
    );

    const rows = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.category, "PROFILE_GOVERNANCE"),
          eq(adminActivityTable.action, "PROFILE_CREATED"),
          eq(adminActivityTable.targetId, String(profile.id)),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0].outcome).toBe("SUCCESS");
    expect(rows[0].targetType).toBe("profile");
    // Detail should be the safe profile-audit detail (no document/evidence).
    const serialized = JSON.stringify(rows[0].detail);
    expect(serialized).not.toMatch(/document|evidence|fields/i);

    // Cleanup the profile (cascades profile_audit; admin_activity survives).
    await db.delete(profilesTable).where(eq(profilesTable.id, profile.id));
  });

  it("does NOT copy review comment body / decision rationale into the mirror", async () => {
    const svc = await import("../src/lib/profile-service.js");
    const [su] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, `${PREFIX}super`))
      .limit(1);
    const actor = { userId: su.id, username: `${PREFIX}super`, role: "SUPERADMIN" as const };

    const key = `${PREFIX}mirror2-${Date.now()}`;
    const profile = await svc.createProfile(actor, {
      key,
      name: "Redaction Test",
      document: { fields: [] },
    });
    const draft = await svc.getDraft(profile.id);
    const { review } = await svc.submitForReview(actor, profile.id, draft!.revision);

    const SECRET_COMMENT = "SENSITIVE_COMMENT_BODY_XYZ";
    const SECRET_RATIONALE = "SENSITIVE_RATIONALE_ABC raw internal note";
    await svc.addComment(actor, review.id, SECRET_COMMENT, "remoteStop");
    await svc.decideReview(actor, review.id, "CHANGES_REQUESTED", SECRET_RATIONALE);

    const mirrored = await db
      .select()
      .from(adminActivityTable)
      .where(
        and(
          eq(adminActivityTable.category, "PROFILE_GOVERNANCE"),
          eq(adminActivityTable.targetId, String(profile.id)),
        ),
      );
    const serialized = JSON.stringify(mirrored.map((m) => m.detail));
    // Free-text material must never leak into the admin activity mirror.
    expect(serialized).not.toContain(SECRET_COMMENT);
    expect(serialized).not.toContain(SECRET_RATIONALE);
    expect(serialized).not.toMatch(/rationale|body|target/i);

    // Structural metadata IS retained (e.g. reviewId / digest on decisions).
    const decisionRow = mirrored.find((m) => m.action === "REVIEW_CHANGES_REQUESTED");
    expect(decisionRow).toBeTruthy();
    expect(decisionRow!.detail).toHaveProperty("reviewId");
    expect(decisionRow!.detail).toHaveProperty("digest");

    // Confirm the profile_audit row still holds the original detail (unchanged
    // governance behavior) — i.e. we did NOT alter what profile_audit stores.
    const audit = await svc.listAudit(profile.id);
    const auditDecision = audit.find((a) => a.action === "REVIEW_CHANGES_REQUESTED");
    expect(JSON.stringify(auditDecision!.detail)).toContain(SECRET_RATIONALE);

    await db.delete(profilesTable).where(eq(profilesTable.id, profile.id));
  });
});
