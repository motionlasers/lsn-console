import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Administrator usage audit domain (Task #53).
 *
 * `admin_activity` is an append-only, indefinitely-retained record of
 * administrator-relevant activity across the console: authentication events,
 * user/security management, mirrored profile governance events, and explicit
 * client events / download requests.
 *
 * Design invariants:
 *  - Append-only. There is no delete/update endpoint and no automatic expiry.
 *    Retention is indefinite database retention until an explicit future
 *    policy/migration changes it.
 *  - Records survive deletion of the acting user: `actorId` is nullable with
 *    `set null` on delete, while `actorUsername` / `actorRole` are immutable
 *    snapshots captured at write time.
 *  - The actor is always server-derived (from `req.sessionUser`), never taken
 *    from the request body.
 *  - `detail` is a bounded JSON object. It never contains passwords, tokens,
 *    cookies, raw request bodies, profile documents, firmware, CIP, or
 *    telemetry payloads — only small, allowlisted, redacted fields.
 *  - `clientEventId` is nullable but unique, providing idempotency for
 *    client-submitted events.
 */

/** Broad activity categories used for filtering/newest-first grouping. */
export const ADMIN_ACTIVITY_CATEGORIES = [
  "AUTH",
  "USER_MANAGEMENT",
  "SECURITY",
  "PROFILE_GOVERNANCE",
  "CLIENT_EVENT",
  "DOWNLOAD",
] as const;
export type AdminActivityCategory = (typeof ADMIN_ACTIVITY_CATEGORIES)[number];

/** Outcome of the recorded action. */
export const ADMIN_ACTIVITY_OUTCOMES = ["SUCCESS", "FAILURE", "DENIED"] as const;
export type AdminActivityOutcome = (typeof ADMIN_ACTIVITY_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// admin_activity — append-only administrator usage audit
// ---------------------------------------------------------------------------
export const adminActivityTable = pgTable(
  "admin_activity",
  {
    id: serial("id").primaryKey(),
    /** Acting user; nulled if the user is later deleted (records survive). */
    // Deliberately not a foreign key: audit identity is a historical snapshot.
    // Deleting a user must not mutate this append-only row.
    actorId: integer("actor_id"),
    /** Immutable snapshot of the acting username at write time. */
    actorUsername: text("actor_username"),
    /** Immutable snapshot of the acting role at write time. */
    actorRole: text("actor_role"),
    /** Broad category (AUTH, USER_MANAGEMENT, ...). */
    category: text("category").notNull(),
    /** Specific action verb within the category. */
    action: text("action").notNull(),
    /** SUCCESS / FAILURE / DENIED. */
    outcome: text("outcome").notNull(),
    /** Optional target descriptors (never a document/payload). */
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    /** Bounded, redacted, allowlisted structured detail. */
    detail: jsonb("detail").notNull().default({}),
    /** Correlation id from the request logger, if available. */
    requestId: text("request_id"),
    /** Client-supplied idempotency key for client events (unique). */
    clientEventId: text("client_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Newest-first listing.
    index("admin_activity_created_idx").on(t.createdAt),
    // Actor-scoped queries.
    index("admin_activity_actor_idx").on(t.actorId),
    // Category / action filters.
    index("admin_activity_category_action_idx").on(t.category, t.action),
    // Idempotency for client events.
    uniqueIndex("admin_activity_client_event_uq").on(t.clientEventId),
  ],
);

export const adminActivityCategorySchema = z.enum(ADMIN_ACTIVITY_CATEGORIES);
export const adminActivityOutcomeSchema = z.enum(ADMIN_ACTIVITY_OUTCOMES);

export type AdminActivity = typeof adminActivityTable.$inferSelect;
export type InsertAdminActivity = typeof adminActivityTable.$inferInsert;
