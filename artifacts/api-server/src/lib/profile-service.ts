import { db } from "@workspace/db";
import {
  profilesTable,
  profileDraftsTable,
  profileVersionsTable,
  profileReviewsTable,
  profileCommentsTable,
  profileDecisionsTable,
  profilePublicationsTable,
  profileValidationsTable,
  profileSandboxesTable,
  profileAuditTable,
  type ProfileVersion,
  type AuditAction,
  type ProfileState,
} from "@workspace/db/schema";
import type { Role } from "@workspace/db/schema";
import { eq, and, desc, max } from "drizzle-orm";
import { canonicalize, digestOf } from "./profile-canonical.js";
import { summarizeProfile } from "./profile-summary.js";

/**
 * Transactional profile lifecycle service. All state transitions that must be
 * atomic (create version, submit review, publish, promote, roll back) run
 * inside a DB transaction so invariants hold: immutable versions/snapshots are
 * never mutated, only one active publication per channel exists, and audit
 * records are appended for every action.
 */

export interface Actor {
  userId: number;
  username: string;
  role: Role;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function appendAudit(
  tx: Tx,
  params: {
    profileId: number;
    versionId?: number | null;
    action: AuditAction;
    actor: Actor;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(profileAuditTable).values({
    profileId: params.profileId,
    versionId: params.versionId ?? null,
    action: params.action,
    actorId: params.actor.userId,
    actorUsername: params.actor.username,
    actorRole: params.actor.role,
    detail: params.detail ?? {},
  });
}

/** Create a new profile with an initial empty draft. */
export async function createProfile(
  actor: Actor,
  input: { key: string; name: string; description?: string; document?: unknown },
) {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .insert(profilesTable)
      .values({
        key: input.key,
        name: input.name,
        description: input.description ?? "",
        createdBy: actor.userId,
      })
      .returning();

    const document = canonicalize(input.document ?? { fields: [] });
    await tx.insert(profileDraftsTable).values({
      profileId: profile.id,
      document,
      revision: 0,
      updatedBy: actor.userId,
    });

    await appendAudit(tx, {
      profileId: profile.id,
      action: "PROFILE_CREATED",
      actor,
      detail: { key: input.key, name: input.name },
    });

    return profile;
  });
}

/**
 * Save the working draft. Uses optimistic concurrency: `expectedRevision`
 * must match the current revision, otherwise a conflict is signalled.
 */
export class RevisionConflictError extends Error {
  constructor() {
    super("Draft revision conflict");
    this.name = "RevisionConflictError";
  }
}

export async function saveDraft(
  actor: Actor,
  profileId: number,
  document: unknown,
  expectedRevision?: number,
) {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(profileDraftsTable)
      .where(eq(profileDraftsTable.profileId, profileId))
      .limit(1);
    if (!draft) throw new Error("Draft not found");

    if (
      typeof expectedRevision === "number" &&
      expectedRevision !== draft.revision
    ) {
      throw new RevisionConflictError();
    }

    const [updated] = await tx
      .update(profileDraftsTable)
      .set({
        document: canonicalize(document),
        revision: draft.revision + 1,
        updatedBy: actor.userId,
      })
      .where(eq(profileDraftsTable.profileId, profileId))
      .returning();

    await appendAudit(tx, {
      profileId,
      action: "DRAFT_SAVED",
      actor,
      detail: { revision: updated.revision },
    });

    return updated;
  });
}

/** Create the next immutable version from a given document. */
async function createVersionTx(
  tx: Tx,
  actor: Actor,
  profileId: number,
  document: unknown,
  state: ProfileState,
  provenance: Record<string, unknown>,
): Promise<ProfileVersion> {
  const canonical = canonicalize(document);
  const digest = digestOf(canonical);

  const [{ value: maxNum }] = await tx
    .select({ value: max(profileVersionsTable.versionNumber) })
    .from(profileVersionsTable)
    .where(eq(profileVersionsTable.profileId, profileId));
  const versionNumber = (maxNum ?? 0) + 1;

  const [version] = await tx
    .insert(profileVersionsTable)
    .values({
      profileId,
      versionNumber,
      state,
      document: canonical,
      digest,
      provenance: { ...provenance, createdByUsername: actor.username },
      createdBy: actor.userId,
    })
    .returning();
  return version;
}

/**
 * Submit the current draft for client review. Creates an immutable version and
 * an immutable review snapshot bound to its digest. Any previously OPEN review
 * for the profile is marked SUPERSEDED (previously submitted snapshots are
 * never overwritten — a new immutable record is created).
 */
export async function submitForReview(actor: Actor, profileId: number) {
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(profileDraftsTable)
      .where(eq(profileDraftsTable.profileId, profileId))
      .limit(1);
    if (!draft) throw new Error("Draft not found");

    const version = await createVersionTx(
      tx,
      actor,
      profileId,
      draft.document,
      "CLIENT_REVIEW",
      { source: "draft", draftRevision: draft.revision },
    );

    // Supersede any still-open reviews (immutable — not deleted/mutated).
    await tx
      .update(profileReviewsTable)
      .set({ state: "SUPERSEDED" })
      .where(
        and(
          eq(profileReviewsTable.profileId, profileId),
          eq(profileReviewsTable.state, "OPEN"),
        ),
      );

    const [review] = await tx
      .insert(profileReviewsTable)
      .values({
        profileId,
        versionId: version.id,
        snapshot: version.document,
        digest: version.digest,
        state: "OPEN",
        submittedBy: actor.userId,
      })
      .returning();

    await appendAudit(tx, {
      profileId,
      versionId: version.id,
      action: "REVIEW_SUBMITTED",
      actor,
      detail: { reviewId: review.id, digest: version.digest, versionNumber: version.versionNumber },
    });

    return { version, review };
  });
}

/** Add a comment bound to a review + its exact digest. */
export async function addComment(
  actor: Actor,
  reviewId: number,
  body: string,
  target?: string,
) {
  return db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(profileReviewsTable)
      .where(eq(profileReviewsTable.id, reviewId))
      .limit(1);
    if (!review) throw new Error("Review not found");

    const [comment] = await tx
      .insert(profileCommentsTable)
      .values({
        reviewId,
        digest: review.digest,
        body,
        target: target ?? null,
        authorId: actor.userId,
        authorRole: actor.role,
      })
      .returning();

    await appendAudit(tx, {
      profileId: review.profileId,
      versionId: review.versionId,
      action: "REVIEW_COMMENTED",
      actor,
      detail: { reviewId, digest: review.digest, target: target ?? null },
    });

    return comment;
  });
}

/**
 * Record an ACCEPTED / CHANGES_REQUESTED decision on a review. Binds to the
 * exact digest and transitions review + version state. A review that is not
 * OPEN cannot be decided again (no silent overwrite).
 */
export async function decideReview(
  actor: Actor,
  reviewId: number,
  decision: "ACCEPTED" | "CHANGES_REQUESTED",
  rationale: string,
) {
  return db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(profileReviewsTable)
      .where(eq(profileReviewsTable.id, reviewId))
      .limit(1);
    if (!review) throw new Error("Review not found");
    if (review.state !== "OPEN") {
      throw new InvariantError("Review is not open for decision");
    }

    const [rec] = await tx
      .insert(profileDecisionsTable)
      .values({
        reviewId,
        digest: review.digest,
        decision,
        rationale,
        decidedBy: actor.userId,
        decidedByRole: actor.role,
      })
      .returning();

    const reviewState = decision === "ACCEPTED" ? "ACCEPTED" : "CHANGES_REQUESTED";
    await tx
      .update(profileReviewsTable)
      .set({ state: reviewState })
      .where(eq(profileReviewsTable.id, reviewId));

    if (decision === "ACCEPTED") {
      await tx
        .update(profileVersionsTable)
        .set({ state: "CLIENT_REVIEW_ACCEPTED" })
        .where(eq(profileVersionsTable.id, review.versionId));
    }

    await appendAudit(tx, {
      profileId: review.profileId,
      versionId: review.versionId,
      action: decision === "ACCEPTED" ? "REVIEW_ACCEPTED" : "REVIEW_CHANGES_REQUESTED",
      actor,
      detail: { reviewId, digest: review.digest, rationale },
    });

    return rec;
  });
}

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

/**
 * Publish an accepted version to the DEVELOPMENT channel. The version must be
 * CLIENT_REVIEW_ACCEPTED (or later). Supersedes the current active publication
 * for the channel (only one active per channel).
 */
export async function publishDevelopment(actor: Actor, versionId: number) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(profileVersionsTable)
      .where(eq(profileVersionsTable.id, versionId))
      .limit(1);
    if (!version) throw new Error("Version not found");

    const publishable: ProfileState[] = [
      "CLIENT_REVIEW_ACCEPTED",
      "DEVELOPMENT_PUBLISHED",
      "HARDWARE_VERIFIED",
    ];
    if (!publishable.includes(version.state as ProfileState)) {
      throw new InvariantError(
        "Only client-review-accepted versions can be published to Development",
      );
    }

    await supersedeActive(tx, version.profileId, "DEVELOPMENT");

    const summary = summarizeProfile(version.document);
    const [publication] = await tx
      .insert(profilePublicationsTable)
      .values({
        profileId: version.profileId,
        versionId: version.id,
        channel: "DEVELOPMENT",
        digest: version.digest,
        active: true,
        summary: summary as unknown as Record<string, unknown>,
        publishedBy: actor.userId,
      })
      .returning();

    await tx
      .update(profileVersionsTable)
      .set({ state: "DEVELOPMENT_PUBLISHED" })
      .where(eq(profileVersionsTable.id, version.id));

    await appendAudit(tx, {
      profileId: version.profileId,
      versionId: version.id,
      action: "DEVELOPMENT_PUBLISHED",
      actor,
      detail: { digest: version.digest, versionNumber: version.versionNumber, summary },
    });

    return { publication, summary };
  });
}

async function supersedeActive(tx: Tx, profileId: number, channel: string) {
  await tx
    .update(profilePublicationsTable)
    .set({ active: false, supersededAt: new Date() })
    .where(
      and(
        eq(profilePublicationsTable.profileId, profileId),
        eq(profilePublicationsTable.channel, channel),
        eq(profilePublicationsTable.active, true),
      ),
    );
}

/**
 * Roll back the DEVELOPMENT channel to a specific earlier version. The target
 * version must already have been published to Development at some point.
 */
export async function rollbackDevelopment(
  actor: Actor,
  profileId: number,
  targetVersionId: number,
) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(profileVersionsTable)
      .where(
        and(
          eq(profileVersionsTable.id, targetVersionId),
          eq(profileVersionsTable.profileId, profileId),
        ),
      )
      .limit(1);
    if (!target) throw new Error("Target version not found");

    const [priorPub] = await tx
      .select()
      .from(profilePublicationsTable)
      .where(
        and(
          eq(profilePublicationsTable.profileId, profileId),
          eq(profilePublicationsTable.channel, "DEVELOPMENT"),
          eq(profilePublicationsTable.versionId, targetVersionId),
        ),
      )
      .limit(1);
    if (!priorPub) {
      throw new InvariantError(
        "Rollback target must be a previously published Development version",
      );
    }

    await supersedeActive(tx, profileId, "DEVELOPMENT");

    const summary = summarizeProfile(target.document);
    const [publication] = await tx
      .insert(profilePublicationsTable)
      .values({
        profileId,
        versionId: target.id,
        channel: "DEVELOPMENT",
        digest: target.digest,
        active: true,
        summary: { ...summary, rolledBack: true } as unknown as Record<string, unknown>,
        publishedBy: actor.userId,
      })
      .returning();

    await appendAudit(tx, {
      profileId,
      versionId: target.id,
      action: "DEVELOPMENT_ROLLED_BACK",
      actor,
      detail: { digest: target.digest, versionNumber: target.versionNumber },
    });

    return publication;
  });
}

/** Record hardware verification evidence and transition version to HARDWARE_VERIFIED. */
export async function recordHardwareVerification(
  actor: Actor,
  versionId: number,
  passed: boolean,
  evidence: Record<string, unknown>,
) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(profileVersionsTable)
      .where(eq(profileVersionsTable.id, versionId))
      .limit(1);
    if (!version) throw new Error("Version not found");
    if (version.state !== "DEVELOPMENT_PUBLISHED") {
      throw new InvariantError(
        "Hardware verification requires a Development-published version",
      );
    }
    const [activeDevelopment] = await tx
      .select({ id: profilePublicationsTable.id })
      .from(profilePublicationsTable)
      .where(
        and(
          eq(profilePublicationsTable.profileId, version.profileId),
          eq(profilePublicationsTable.versionId, version.id),
          eq(profilePublicationsTable.channel, "DEVELOPMENT"),
          eq(profilePublicationsTable.active, true),
        ),
      )
      .limit(1);
    if (!activeDevelopment) {
      throw new InvariantError(
        "Hardware verification requires the active Development publication",
      );
    }

    const [rec] = await tx
      .insert(profileValidationsTable)
      .values({
        profileId: version.profileId,
        versionId: version.id,
        digest: version.digest,
        kind: "HARDWARE",
        passed,
        evidence,
        recordedBy: actor.userId,
      })
      .returning();

    if (passed) {
      await tx
        .update(profileVersionsTable)
        .set({ state: "HARDWARE_VERIFIED" })
        .where(eq(profileVersionsTable.id, version.id));
    }

    await appendAudit(tx, {
      profileId: version.profileId,
      versionId: version.id,
      action: "HARDWARE_VERIFIED",
      actor,
      detail: { passed, digest: version.digest },
    });

    return rec;
  });
}

/** Record simulation evidence (distinct from hardware; does not change state). */
export async function recordSimulation(
  actor: Actor,
  versionId: number,
  passed: boolean,
  evidence: Record<string, unknown>,
) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(profileVersionsTable)
      .where(eq(profileVersionsTable.id, versionId))
      .limit(1);
    if (!version) throw new Error("Version not found");

    const [rec] = await tx
      .insert(profileValidationsTable)
      .values({
        profileId: version.profileId,
        versionId: version.id,
        digest: version.digest,
        kind: "SIMULATION",
        passed,
        evidence,
        recordedBy: actor.userId,
      })
      .returning();

    await appendAudit(tx, {
      profileId: version.profileId,
      versionId: version.id,
      action: "VALIDATION_RECORDED",
      actor,
      detail: { kind: "SIMULATION", passed, digest: version.digest },
    });

    return rec;
  });
}

/**
 * Promote a version to PRODUCTION_FROZEN (Superadmin only — enforced at the
 * route). Requires HARDWARE_VERIFIED. Publishes to the PRODUCTION channel.
 */
export async function promoteProduction(actor: Actor, versionId: number) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(profileVersionsTable)
      .where(eq(profileVersionsTable.id, versionId))
      .limit(1);
    if (!version) throw new Error("Version not found");

    if (version.state !== "HARDWARE_VERIFIED") {
      throw new InvariantError(
        "Only hardware-verified versions can be promoted to Production",
      );
    }
    const [review] = await tx
      .select({ id: profileReviewsTable.id })
      .from(profileReviewsTable)
      .where(
        and(
          eq(profileReviewsTable.versionId, version.id),
          eq(profileReviewsTable.digest, version.digest),
        ),
      )
      .limit(1);
    if (!review) {
      throw new InvariantError("Production promotion requires Client Review");
    }
    const [acceptance] = await tx
      .select({ id: profileDecisionsTable.id })
      .from(profileDecisionsTable)
      .where(
        and(
          eq(profileDecisionsTable.reviewId, review.id),
          eq(profileDecisionsTable.digest, version.digest),
          eq(profileDecisionsTable.decision, "ACCEPTED"),
        ),
      )
      .limit(1);
    const [developmentPublication] = await tx
      .select({ id: profilePublicationsTable.id })
      .from(profilePublicationsTable)
      .where(
        and(
          eq(profilePublicationsTable.versionId, version.id),
          eq(profilePublicationsTable.digest, version.digest),
          eq(profilePublicationsTable.channel, "DEVELOPMENT"),
        ),
      )
      .limit(1);
    const [hardwareEvidence] = await tx
      .select({ id: profileValidationsTable.id })
      .from(profileValidationsTable)
      .where(
        and(
          eq(profileValidationsTable.versionId, version.id),
          eq(profileValidationsTable.digest, version.digest),
          eq(profileValidationsTable.kind, "HARDWARE"),
          eq(profileValidationsTable.passed, true),
        ),
      )
      .limit(1);
    if (!acceptance || !developmentPublication || !hardwareEvidence) {
      throw new InvariantError(
        "Production promotion requires accepted review, Development publication, and passing hardware evidence",
      );
    }

    await supersedeActive(tx, version.profileId, "PRODUCTION");

    const summary = summarizeProfile(version.document);
    const [publication] = await tx
      .insert(profilePublicationsTable)
      .values({
        profileId: version.profileId,
        versionId: version.id,
        channel: "PRODUCTION",
        digest: version.digest,
        active: true,
        summary: summary as unknown as Record<string, unknown>,
        publishedBy: actor.userId,
      })
      .returning();

    await tx
      .update(profileVersionsTable)
      .set({ state: "PRODUCTION_FROZEN" })
      .where(eq(profileVersionsTable.id, version.id));

    await appendAudit(tx, {
      profileId: version.profileId,
      versionId: version.id,
      action: "PRODUCTION_PROMOTED",
      actor,
      detail: { digest: version.digest, versionNumber: version.versionNumber },
    });

    return publication;
  });
}

/** Upsert the private client sandbox for a user + profile. */
export async function saveSandbox(actor: Actor, profileId: number, document: unknown) {
  const canonical = canonicalize(document);
  const [existing] = await db
    .select()
    .from(profileSandboxesTable)
    .where(
      and(
        eq(profileSandboxesTable.profileId, profileId),
        eq(profileSandboxesTable.ownerId, actor.userId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(profileSandboxesTable)
      .set({ document: canonical })
      .where(eq(profileSandboxesTable.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(profileSandboxesTable)
    .values({ profileId, ownerId: actor.userId, document: canonical })
    .returning();
  return created;
}

/** Reset (delete) the private sandbox for a user + profile. */
export async function resetSandbox(actor: Actor, profileId: number) {
  await db
    .delete(profileSandboxesTable)
    .where(
      and(
        eq(profileSandboxesTable.profileId, profileId),
        eq(profileSandboxesTable.ownerId, actor.userId),
      ),
    );
  await db.insert(profileAuditTable).values({
    profileId,
    action: "SANDBOX_RESET",
    actorId: actor.userId,
    actorUsername: actor.username,
    actorRole: actor.role,
    detail: {},
  });
}

export async function getSandbox(actor: Actor, profileId: number) {
  const [row] = await db
    .select()
    .from(profileSandboxesTable)
    .where(
      and(
        eq(profileSandboxesTable.profileId, profileId),
        eq(profileSandboxesTable.ownerId, actor.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function listProfiles() {
  return db.select().from(profilesTable).orderBy(desc(profilesTable.updatedAt));
}

export async function getProfile(profileId: number) {
  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.id, profileId))
    .limit(1);
  return profile ?? null;
}

export async function getDraft(profileId: number) {
  const [draft] = await db
    .select()
    .from(profileDraftsTable)
    .where(eq(profileDraftsTable.profileId, profileId))
    .limit(1);
  return draft ?? null;
}

export async function listVersions(profileId: number) {
  return db
    .select()
    .from(profileVersionsTable)
    .where(eq(profileVersionsTable.profileId, profileId))
    .orderBy(desc(profileVersionsTable.versionNumber));
}

export async function getVersion(versionId: number) {
  const [v] = await db
    .select()
    .from(profileVersionsTable)
    .where(eq(profileVersionsTable.id, versionId))
    .limit(1);
  return v ?? null;
}

export async function getReview(reviewId: number) {
  const [r] = await db
    .select()
    .from(profileReviewsTable)
    .where(eq(profileReviewsTable.id, reviewId))
    .limit(1);
  return r ?? null;
}

export async function listReviews(profileId: number) {
  return db
    .select()
    .from(profileReviewsTable)
    .where(eq(profileReviewsTable.profileId, profileId))
    .orderBy(desc(profileReviewsTable.submittedAt));
}

export async function listComments(reviewId: number) {
  return db
    .select()
    .from(profileCommentsTable)
    .where(eq(profileCommentsTable.reviewId, reviewId))
    .orderBy(profileCommentsTable.createdAt);
}

export async function listDecisions(reviewId: number) {
  return db
    .select()
    .from(profileDecisionsTable)
    .where(eq(profileDecisionsTable.reviewId, reviewId))
    .orderBy(profileDecisionsTable.decidedAt);
}

export async function getActivePublication(profileId: number, channel: string) {
  const [pub] = await db
    .select()
    .from(profilePublicationsTable)
    .where(
      and(
        eq(profilePublicationsTable.profileId, profileId),
        eq(profilePublicationsTable.channel, channel),
        eq(profilePublicationsTable.active, true),
      ),
    )
    .limit(1);
  return pub ?? null;
}

export async function listPublications(profileId: number) {
  return db
    .select()
    .from(profilePublicationsTable)
    .where(eq(profilePublicationsTable.profileId, profileId))
    .orderBy(desc(profilePublicationsTable.publishedAt));
}

export async function listValidations(versionId: number) {
  return db
    .select()
    .from(profileValidationsTable)
    .where(eq(profileValidationsTable.versionId, versionId))
    .orderBy(desc(profileValidationsTable.recordedAt));
}

export async function listAudit(profileId: number) {
  return db
    .select()
    .from(profileAuditTable)
    .where(eq(profileAuditTable.profileId, profileId))
    .orderBy(desc(profileAuditTable.createdAt));
}
