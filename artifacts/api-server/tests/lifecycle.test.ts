import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { ensureUser, deleteUser, loginAgent } from "./helpers.js";
import { digestOf } from "../src/lib/profile-canonical.js";

let app: Express;
let superadmin: Agent;
let firmware: Agent;
let reviewer: Agent;
let profileId: number;

const KEY = `test-lsn-${Date.now()}`;

const baseDoc = {
  profileVersion: "0.1.0",
  protocolVersion: "EIP-1",
  hardwareFamily: "LSN-X",
  capabilities: { interlock: { enabled: true, phase: "A", description: "" } },
  fields: [
    {
      symbolicName: "remoteStop",
      direction: "PC_TO_LSN",
      dataType: "bool",
      access: "WRITE",
      cipService: "0x10",
      implementationStatus: "VERIFIED",
      simulationStatus: "VERIFIED",
      expectedFirmwareBehavior: "stop",
      expectedReportedResponse: "ack",
    },
  ],
};

beforeAll(async () => {
  ({ default: app } = await import("../src/app.js"));
  await ensureUser("t_super", "SUPERADMIN");
  await ensureUser("t_fw", "FIRMWARE_ADMIN");
  await ensureUser("t_rev", "CLIENT_REVIEWER");
  superadmin = await loginAgent(app, "t_super");
  firmware = await loginAgent(app, "t_fw");
  reviewer = await loginAgent(app, "t_rev");
});

afterAll(async () => {
  const [p] = await db.select().from(profilesTable).where(eq(profilesTable.key, KEY)).limit(1);
  if (p) await db.delete(profilesTable).where(eq(profilesTable.id, p.id));
  await deleteUser("t_super");
  await deleteUser("t_fw");
  await deleteUser("t_rev");
});

describe("session exposes canonical role + permissions", () => {
  it("returns role and permissions on /session", async () => {
    const res = await firmware.get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("FIRMWARE_ADMIN");
    expect(res.body.isAdmin).toBe(false);
    expect(res.body.permissions).toContain("development.publish");
    expect(res.body.permissions).not.toContain("production.promote");
  });
});

describe("RBAC enforcement on profile creation", () => {
  it("Client Reviewer cannot create a profile (403)", async () => {
    const res = await reviewer
      .post("/api/profiles")
      .send({ key: KEY + "-x", name: "nope" });
    expect(res.status).toBe(403);
  });

  it("Firmware Admin can create a profile (201)", async () => {
    const res = await firmware
      .post("/api/profiles")
      .send({ key: KEY, name: "Test", document: baseDoc });
    expect(res.status).toBe(201);
    profileId = res.body.id;
    expect(profileId).toBeTruthy();
  });
});

describe("draft editing + optimistic concurrency", () => {
  it("Client Reviewer cannot edit the draft (403)", async () => {
    const res = await reviewer
      .put(`/api/profiles/${profileId}/draft`)
      .send({ document: baseDoc });
    expect(res.status).toBe(403);
  });

  it("Firmware Admin saves the draft and revision increments", async () => {
    const res = await firmware
      .put(`/api/profiles/${profileId}/draft`)
      .send({ document: { ...baseDoc, note: "edited" }, expectedRevision: 0 });
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(1);
  });

  it("rejects a stale expectedRevision with 409", async () => {
    const res = await firmware
      .put(`/api/profiles/${profileId}/draft`)
      .send({ document: baseDoc, expectedRevision: 0 });
    expect(res.status).toBe(409);
  });
});

let reviewId: number;
let versionId: number;
let versionDigest: string;

describe("review submission creates an immutable snapshot", () => {
  it("Firmware Admin submits for review", async () => {
    const res = await firmware.post(`/api/profiles/${profileId}/submit`).send({});
    expect(res.status).toBe(201);
    reviewId = res.body.review.id;
    versionId = res.body.version.id;
    versionDigest = res.body.version.digest;
    expect(res.body.version.state).toBe("CLIENT_REVIEW");
    expect(res.body.review.digest).toBe(versionDigest);
  });

  it("review snapshot digest matches canonical digest of the snapshot", async () => {
    const res = await reviewer.get(`/api/profiles/reviews/${reviewId}`);
    expect(res.status).toBe(200);
    expect(digestOf(res.body.review.snapshot)).toBe(res.body.review.digest);
    expect(res.body.summary.mappingComplete).toBe(true);
  });
});

describe("comments + decisions bind to the exact digest", () => {
  it("Client Reviewer comments on the review", async () => {
    const res = await reviewer
      .post(`/api/profiles/reviews/${reviewId}/comments`)
      .send({ body: "please clarify", target: "remoteStop" });
    expect(res.status).toBe(201);
    expect(res.body.digest).toBe(versionDigest);
  });

  it("Firmware Admin responds to feedback on the exact review digest", async () => {
    const res = await firmware
      .post(`/api/profiles/reviews/${reviewId}/comments`)
      .send({ body: "mapping rationale clarified", target: "remoteStop" });
    expect(res.status).toBe(201);
    expect(res.body.digest).toBe(versionDigest);
    expect(res.body.authorRole).toBe("FIRMWARE_ADMIN");
  });

  it("Firmware Admin cannot record a review decision (403)", async () => {
    const res = await firmware
      .post(`/api/profiles/reviews/${reviewId}/decision`)
      .send({ decision: "ACCEPTED", rationale: "lgtm" });
    expect(res.status).toBe(403);
  });

  it("Client Reviewer accepts the review; version transitions", async () => {
    const res = await reviewer
      .post(`/api/profiles/reviews/${reviewId}/decision`)
      .send({ decision: "ACCEPTED", rationale: "lgtm" });
    expect(res.status).toBe(201);
    expect(res.body.digest).toBe(versionDigest);

    const v = await firmware.get(`/api/profiles/versions/${versionId}`);
    expect(v.body.version.state).toBe("CLIENT_REVIEW_ACCEPTED");
  });

  it("a decided review cannot be decided again (409, no silent overwrite)", async () => {
    const res = await reviewer
      .post(`/api/profiles/reviews/${reviewId}/decision`)
      .send({ decision: "CHANGES_REQUESTED", rationale: "actually no" });
    expect(res.status).toBe(409);
  });
});

describe("development publication + rollback invariants", () => {
  it("Client Reviewer cannot publish (403)", async () => {
    const res = await reviewer.post(`/api/profiles/versions/${versionId}/publish`).send({});
    expect(res.status).toBe(403);
  });

  it("Firmware Admin publishes accepted version to Development", async () => {
    const res = await firmware.post(`/api/profiles/versions/${versionId}/publish`).send({});
    expect(res.status).toBe(201);
    expect(res.body.publication.channel).toBe("DEVELOPMENT");
    expect(res.body.publication.active).toBe(true);
    expect(res.body.summary.mappingComplete).toBe(true);
  });

  it("only one active Development publication exists per profile", async () => {
    const res = await firmware.get(`/api/profiles/${profileId}/publications`);
    const activeDev = res.body.filter(
      (p: { channel: string; active: boolean }) => p.channel === "DEVELOPMENT" && p.active,
    );
    expect(activeDev).toHaveLength(1);
  });
});

let version2Id: number;

describe("second version + diff + rollback", () => {
  it("edit + resubmit + accept + publish a second version", async () => {
    await firmware
      .put(`/api/profiles/${profileId}/draft`)
      .send({ document: { ...baseDoc, profileVersion: "0.2.0" } });
    const sub = await firmware.post(`/api/profiles/${profileId}/submit`).send({});
    version2Id = sub.body.version.id;
    const rev2 = sub.body.review.id;
    await reviewer.post(`/api/profiles/reviews/${rev2}/decision`).send({ decision: "ACCEPTED", rationale: "ok" });
    const pub = await firmware.post(`/api/profiles/versions/${version2Id}/publish`).send({});
    expect(pub.status).toBe(201);
  });

  it("diff between the two versions is classified", async () => {
    const res = await firmware.get(`/api/profiles/diff?from=${versionId}&to=${version2Id}`);
    expect(res.status).toBe(200);
    expect(res.body.hasChanges).toBe(true);
    expect(res.body.counts.field).toBeGreaterThanOrEqual(1);
  });

  it("rollback to a previously published version supersedes the active one", async () => {
    const res = await firmware
      .post(`/api/profiles/${profileId}/rollback`)
      .send({ targetVersionId: versionId });
    expect(res.status).toBe(200);
    expect(res.body.versionId).toBe(versionId);

    const pubs = await firmware.get(`/api/profiles/${profileId}/publications`);
    const activeDev = pubs.body.filter(
      (p: { channel: string; active: boolean }) => p.channel === "DEVELOPMENT" && p.active,
    );
    expect(activeDev).toHaveLength(1);
    expect(activeDev[0].versionId).toBe(versionId);
  });

  it("cannot roll back to a version never published to Development (409)", async () => {
    // Create an accepted-but-never-published version.
    await firmware
      .put(`/api/profiles/${profileId}/draft`)
      .send({ document: { ...baseDoc, profileVersion: "0.3.0" } });
    const sub = await firmware.post(`/api/profiles/${profileId}/submit`).send({});
    const unpublished = sub.body.version.id;
    await reviewer
      .post(`/api/profiles/reviews/${sub.body.review.id}/decision`)
      .send({ decision: "ACCEPTED", rationale: "ok" });

    const res = await firmware
      .post(`/api/profiles/${profileId}/rollback`)
      .send({ targetVersionId: unpublished });
    expect(res.status).toBe(409);
  });
});

describe("hardware verification + production promotion authority", () => {
  it("cannot hardware-verify or promote an unaccepted review candidate", async () => {
    const created = await firmware
      .post("/api/profiles")
      .send({ key: `${KEY}-guard`, name: "Transition guard", document: baseDoc });
    const submitted = await firmware
      .post(`/api/profiles/${created.body.id}/submit`)
      .send({});
    const candidateId = submitted.body.version.id;

    const verify = await firmware
      .post(`/api/profiles/versions/${candidateId}/verify-hardware`)
      .send({ passed: true, evidence: { rig: "invalid-shortcut" } });
    expect(verify.status).toBe(409);

    const promote = await superadmin
      .post(`/api/profiles/versions/${candidateId}/promote`)
      .send({});
    expect(promote.status).toBe(409);
  });

  it("cannot hardware-verify or promote a change-requested version", async () => {
    const created = await firmware
      .post("/api/profiles")
      .send({ key: `${KEY}-rejected`, name: "Rejected transition", document: baseDoc });
    const submitted = await firmware
      .post(`/api/profiles/${created.body.id}/submit`)
      .send({});
    const candidateId = submitted.body.version.id;
    await reviewer
      .post(`/api/profiles/reviews/${submitted.body.review.id}/decision`)
      .send({ decision: "CHANGES_REQUESTED", rationale: "not accepted" });

    const verify = await firmware
      .post(`/api/profiles/versions/${candidateId}/verify-hardware`)
      .send({ passed: true, evidence: { rig: "invalid-shortcut" } });
    expect(verify.status).toBe(409);

    const promote = await superadmin
      .post(`/api/profiles/versions/${candidateId}/promote`)
      .send({});
    expect(promote.status).toBe(409);
  });

  it("Firmware Admin records hardware verification -> HARDWARE_VERIFIED", async () => {
    const res = await firmware
      .post(`/api/profiles/versions/${versionId}/verify-hardware`)
      .send({ passed: true, evidence: { rig: "bench-1" } });
    expect(res.status).toBe(201);
    const v = await firmware.get(`/api/profiles/versions/${versionId}`);
    expect(v.body.version.state).toBe("HARDWARE_VERIFIED");
  });

  it("Firmware Admin cannot promote to Production (403)", async () => {
    const res = await firmware.post(`/api/profiles/versions/${versionId}/promote`).send({});
    expect(res.status).toBe(403);
  });

  it("Superadmin promotes a hardware-verified version to Production", async () => {
    const res = await superadmin.post(`/api/profiles/versions/${versionId}/promote`).send({});
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe("PRODUCTION");
    const v = await superadmin.get(`/api/profiles/versions/${versionId}`);
    expect(v.body.version.state).toBe("PRODUCTION_FROZEN");
  });

  it("Superadmin cannot promote a non-hardware-verified version (409)", async () => {
    const res = await superadmin.post(`/api/profiles/versions/${version2Id}/promote`).send({});
    expect(res.status).toBe(409);
  });
});

describe("simulation and hardware evidence are distinct + version-bound", () => {
  it("records simulation evidence separately from hardware evidence", async () => {
    const res = await firmware
      .post(`/api/profiles/versions/${versionId}/simulation`)
      .send({ passed: true, evidence: { scenario: "smoke" } });
    expect(res.status).toBe(201);
    const list = await firmware.get(`/api/profiles/versions/${versionId}/validations`);
    const kinds = list.body.map((v: { kind: string }) => v.kind).sort();
    expect(kinds).toContain("SIMULATION");
    expect(kinds).toContain("HARDWARE");
    for (const v of list.body) expect(v.digest).toBe(versionDigest);
  });
});

describe("audit history is append-only + records actors/roles/actions", () => {
  it("records the full lifecycle with actor + role", async () => {
    const res = await firmware.get(`/api/profiles/${profileId}/audit`);
    expect(res.status).toBe(200);
    const actions = res.body.map((a: { action: string }) => a.action);
    for (const expected of [
      "PROFILE_CREATED",
      "DRAFT_SAVED",
      "REVIEW_SUBMITTED",
      "REVIEW_ACCEPTED",
      "DEVELOPMENT_PUBLISHED",
      "DEVELOPMENT_ROLLED_BACK",
      "HARDWARE_VERIFIED",
      "PRODUCTION_PROMOTED",
    ]) {
      expect(actions).toContain(expected);
    }
    const promoted = res.body.find((a: { action: string }) => a.action === "PRODUCTION_PROMOTED");
    expect(promoted.actorRole).toBe("SUPERADMIN");
  });
});

describe("digest-addressed download", () => {
  it("serves the canonical artifact with digest headers", async () => {
    const res = await firmware.get(`/api/profiles/versions/${versionId}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["x-profile-digest"]).toBe(versionDigest);
    const body = JSON.parse(res.text);
    expect(body.digest).toBe(versionDigest);
    expect(body.versionId).toBe(versionId);
  });
});

describe("client sandbox isolation", () => {
  it("Client Reviewer saves + reads a private sandbox", async () => {
    const put = await reviewer
      .put(`/api/profiles/${profileId}/sandbox`)
      .send({ document: { override: 1 } });
    expect(put.status).toBe(200);
    const get = await reviewer.get(`/api/profiles/${profileId}/sandbox`);
    expect(get.body.document.override).toBe(1);
  });

  it("another user's sandbox is separate (isolation)", async () => {
    const get = await superadmin.get(`/api/profiles/${profileId}/sandbox`);
    expect(get.body).toBeNull();
  });

  it("sandbox never mutates the shared draft/versions", async () => {
    const draft = await firmware.get(`/api/profiles/${profileId}/draft`);
    expect(draft.body.document.override).toBeUndefined();
  });

  it("reset clears the sandbox", async () => {
    await reviewer.delete(`/api/profiles/${profileId}/sandbox`);
    const get = await reviewer.get(`/api/profiles/${profileId}/sandbox`);
    expect(get.body).toBeNull();
  });
});

describe("desktop profile-channel (Electron trust boundary contract)", () => {
  it("manifest references a same-origin artifact with a matching digest", async () => {
    const res = await firmware.get(`/api/desktop/profile-channel?profileId=${profileId}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(typeof res.body.artifactPath).toBe("string");
    expect(res.body.artifactPath.startsWith("/api/")).toBe(true);
    expect(res.body.profileVersion).toBe(res.body.releaseName);

    const artifact = await firmware.get(res.body.artifactPath);
    expect(artifact.status).toBe(200);
    // Electron recomputes the canonical digest over the raw document.
    expect(digestOf(artifact.body)).toBe(res.body.digest);
    // Manifest profileVersion must equal the document's profileVersion.
    expect(artifact.body.profileVersion).toBe(res.body.profileVersion);
  });

  it("requires authentication", async () => {
    const res = await import("supertest").then((s) => s.default(app).get("/api/desktop/profile-channel"));
    expect(res.status).toBe(401);
  });
});
