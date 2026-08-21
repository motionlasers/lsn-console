import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Device Profile governance domain.
 *
 * A `profile` is a logical device profile (identified by a stable key/name).
 * It owns:
 *  - a mutable working `draft` (one per profile) that Firmware Admins edit
 *  - a series of immutable `versions` (canonicalized snapshots + digest)
 *  - `reviews` (a version submitted for client review) with immutable snapshots
 *  - `comments` and `decisions` bound to the exact review/digest
 *  - `publications` (channel bindings, e.g. Development Published)
 *  - `validations` (simulation evidence + physical hardware evidence)
 *  - `sandboxes` (per-user private client sandbox state)
 *  - append-only `audit` records
 */

/** Explicit lifecycle states for an immutable version. */
export const PROFILE_STATES = [
  "DRAFT",
  "CLIENT_REVIEW",
  "CLIENT_REVIEW_ACCEPTED",
  "DEVELOPMENT_PUBLISHED",
  "HARDWARE_VERIFIED",
  "PRODUCTION_FROZEN",
] as const;
export type ProfileState = (typeof PROFILE_STATES)[number];
export const profileStateSchema = z.enum(PROFILE_STATES);

/** Review decision outcomes recorded by Client Reviewers. */
export const REVIEW_DECISIONS = ["ACCEPTED", "CHANGES_REQUESTED"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);

/** Review status of a review record. */
export const REVIEW_STATES = ["OPEN", "ACCEPTED", "CHANGES_REQUESTED", "SUPERSEDED"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** Publication channels. Development is the MVF channel; Production is Superadmin-only. */
export const PUBLICATION_CHANNELS = ["DEVELOPMENT", "PRODUCTION"] as const;
export type PublicationChannel = (typeof PUBLICATION_CHANNELS)[number];
export const publicationChannelSchema = z.enum(PUBLICATION_CHANNELS);

/** Validation evidence kinds. Simulation and physical hardware are kept distinct. */
export const VALIDATION_KINDS = ["SIMULATION", "HARDWARE"] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];
export const validationKindSchema = z.enum(VALIDATION_KINDS);

/** Audit action verbs (append-only history). */
export const AUDIT_ACTIONS = [
  "PROFILE_CREATED",
  "DRAFT_SAVED",
  "REVIEW_SUBMITTED",
  "REVIEW_COMMENTED",
  "REVIEW_ACCEPTED",
  "REVIEW_CHANGES_REQUESTED",
  "DEVELOPMENT_PUBLISHED",
  "DEVELOPMENT_ROLLED_BACK",
  "HARDWARE_VERIFIED",
  "PRODUCTION_PROMOTED",
  "VALIDATION_RECORDED",
  "SANDBOX_RESET",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  /** Stable, human-meaningful key (e.g. hardware family / product line). */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// profile_drafts — one mutable working draft per profile
// ---------------------------------------------------------------------------
export const profileDraftsTable = pgTable(
  "profile_drafts",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    /** The full working device-profile document (schema-shaped JSON). */
    document: jsonb("document").notNull(),
    /** Monotonic revision counter for optimistic concurrency. */
    revision: integer("revision").notNull().default(0),
    updatedBy: integer("updated_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("profile_drafts_profile_id_uq").on(t.profileId)],
);

// ---------------------------------------------------------------------------
// profile_versions — immutable, canonicalized, digest-addressed snapshots
// ---------------------------------------------------------------------------
export const profileVersionsTable = pgTable(
  "profile_versions",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    /** Sequential, per-profile version number (1-based). */
    versionNumber: integer("version_number").notNull(),
    /** Explicit lifecycle state for this immutable version. */
    state: text("state").notNull().default("DRAFT"),
    /** Canonicalized profile document (stable key ordering). */
    document: jsonb("document").notNull(),
    /** Canonical SHA-256 digest of the canonicalized document (hex). */
    digest: text("digest").notNull(),
    /** Provenance/metadata bound to this immutable version. */
    provenance: jsonb("provenance").notNull().default({}),
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("profile_versions_profile_version_uq").on(t.profileId, t.versionNumber),
    index("profile_versions_profile_idx").on(t.profileId),
    index("profile_versions_digest_idx").on(t.digest),
  ],
);

// ---------------------------------------------------------------------------
// profile_reviews — a version submitted for client review (immutable snapshot)
// ---------------------------------------------------------------------------
export const profileReviewsTable = pgTable(
  "profile_reviews",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    versionId: integer("version_id")
      .notNull()
      .references(() => profileVersionsTable.id, { onDelete: "cascade" }),
    /** Immutable snapshot of the submitted document at submission time. */
    snapshot: jsonb("snapshot").notNull(),
    /** Digest of the snapshot; decisions/comments bind to this. */
    digest: text("digest").notNull(),
    state: text("state").notNull().default("OPEN"),
    submittedBy: integer("submitted_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("profile_reviews_profile_idx").on(t.profileId),
    index("profile_reviews_version_idx").on(t.versionId),
  ],
);

// ---------------------------------------------------------------------------
// profile_comments — bound to a review + exact digest
// ---------------------------------------------------------------------------
export const profileCommentsTable = pgTable(
  "profile_comments",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => profileReviewsTable.id, { onDelete: "cascade" }),
    /** Digest the comment was written against (guards against silent mutation). */
    digest: text("digest").notNull(),
    body: text("body").notNull(),
    /** Optional symbolic target (e.g. a field symbolicName). */
    target: text("target"),
    authorId: integer("author_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    authorRole: text("author_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("profile_comments_review_idx").on(t.reviewId)],
);

// ---------------------------------------------------------------------------
// profile_decisions — accept / request-changes bound to a review + digest
// ---------------------------------------------------------------------------
export const profileDecisionsTable = pgTable(
  "profile_decisions",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => profileReviewsTable.id, { onDelete: "cascade" }),
    digest: text("digest").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull().default(""),
    decidedBy: integer("decided_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    decidedByRole: text("decided_by_role").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("profile_decisions_review_idx").on(t.reviewId)],
);

// ---------------------------------------------------------------------------
// profile_publications — channel bindings for immutable versions
// ---------------------------------------------------------------------------
export const profilePublicationsTable = pgTable(
  "profile_publications",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    versionId: integer("version_id")
      .notNull()
      .references(() => profileVersionsTable.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    digest: text("digest").notNull(),
    /** Whether this is the currently-active publication for the channel. */
    active: boolean("active").notNull().default(true),
    /** Review status / evidence summary shown before confirmation. */
    summary: jsonb("summary").notNull().default({}),
    publishedBy: integer("published_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    index("profile_publications_profile_channel_idx").on(t.profileId, t.channel),
    // Only one active publication per profile+channel (partial unique index).
    uniqueIndex("profile_publications_active_uq")
      .on(t.profileId, t.channel)
      .where(sql`active = true`),
  ],
);

// ---------------------------------------------------------------------------
// profile_validations — simulation / hardware evidence bound to version+digest
// ---------------------------------------------------------------------------
export const profileValidationsTable = pgTable(
  "profile_validations",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    versionId: integer("version_id")
      .notNull()
      .references(() => profileVersionsTable.id, { onDelete: "cascade" }),
    /** Digest of the exact version the evidence is bound to. */
    digest: text("digest").notNull(),
    kind: text("kind").notNull(),
    passed: boolean("passed").notNull(),
    /** Structured evidence payload (results, metrics, identity binding). */
    evidence: jsonb("evidence").notNull().default({}),
    recordedBy: integer("recorded_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("profile_validations_version_idx").on(t.versionId),
    index("profile_validations_kind_idx").on(t.kind),
  ],
);

// ---------------------------------------------------------------------------
// profile_sandboxes — private, per-user, resettable client sandbox
// ---------------------------------------------------------------------------
export const profileSandboxesTable = pgTable(
  "profile_sandboxes",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Private overrides; never affect shared profiles or Windows profiles. */
    document: jsonb("document").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("profile_sandboxes_owner_profile_uq").on(t.profileId, t.ownerId)],
);

// ---------------------------------------------------------------------------
// profile_audit — append-only history
// ---------------------------------------------------------------------------
export const profileAuditTable = pgTable(
  "profile_audit",
  {
    id: serial("id").primaryKey(),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    versionId: integer("version_id").references(() => profileVersionsTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    actorId: integer("actor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    actorUsername: text("actor_username"),
    actorRole: text("actor_role"),
    /** Additional structured detail (comment, decision, digest, channel, etc). */
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("profile_audit_profile_idx").on(t.profileId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Zod insert schemas + derived types
// ---------------------------------------------------------------------------
export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Profile = typeof profilesTable.$inferSelect;
export type ProfileDraft = typeof profileDraftsTable.$inferSelect;
export type ProfileVersion = typeof profileVersionsTable.$inferSelect;
export type ProfileReview = typeof profileReviewsTable.$inferSelect;
export type ProfileComment = typeof profileCommentsTable.$inferSelect;
export type ProfileDecision = typeof profileDecisionsTable.$inferSelect;
export type ProfilePublication = typeof profilePublicationsTable.$inferSelect;
export type ProfileValidation = typeof profileValidationsTable.$inferSelect;
export type ProfileSandbox = typeof profileSandboxesTable.$inferSelect;
export type ProfileAudit = typeof profileAuditTable.$inferSelect;
