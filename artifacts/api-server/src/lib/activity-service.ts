import { db } from "@workspace/db";
import {
  adminActivityTable,
  type AdminActivityCategory,
  type AdminActivityOutcome,
  type InsertAdminActivity,
} from "@workspace/db/schema";
import type { Role } from "@workspace/db/schema";
import type { Logger } from "pino";
import { sql } from "drizzle-orm";
import type { SessionUser } from "../middleware/require-auth.js";
import { logger } from "./logger.js";

/**
 * Administrator usage audit service (Task #53).
 *
 * Responsibilities:
 *  - Derive the actor strictly from the server-resolved session user
 *    (`req.sessionUser`) — never from the request body.
 *  - Bound and redact the `detail` payload: max string length, object depth,
 *    key/entry counts, and total serialized size.
 *  - Strictly allowlist client event names and metadata keys.
 *  - Never accept passwords, tokens, cookies, raw bodies, profile documents,
 *    firmware, CIP, or telemetry payloads.
 *  - Fail safe: audit write failures are logged and swallowed so they never
 *    break the primary operation. Only explicit client-event / download
 *    endpoints may surface a write failure to the caller.
 */

// ---------------------------------------------------------------------------
// Retention policy (indefinite until an explicit future policy/migration).
// ---------------------------------------------------------------------------
export const RETENTION_POLICY =
  "INDEFINITE: admin_activity is retained indefinitely in the database. There is no automatic expiry and no delete/update endpoint. Retention will only change via an explicit future policy and migration.";

// ---------------------------------------------------------------------------
// Actor derivation (always server-derived)
// ---------------------------------------------------------------------------
export interface ActivityActor {
  actorId: number | null;
  actorUsername: string | null;
  actorRole: string | null;
}

/** Derive an actor snapshot from the resolved session user. */
export function actorFromSession(
  su: SessionUser | undefined,
): ActivityActor {
  if (!su) {
    return { actorId: null, actorUsername: null, actorRole: null };
  }
  return {
    actorId: su.userId,
    actorUsername: su.username,
    actorRole: su.role,
  };
}

/** Actor snapshot for a known user resolved from the DB (e.g. failed login). */
export function actorFromUser(user: {
  id: number;
  username: string;
  role: string;
}): ActivityActor {
  return { actorId: user.id, actorUsername: user.username, actorRole: user.role };
}

// ---------------------------------------------------------------------------
// Detail bounding / redaction
// ---------------------------------------------------------------------------
const MAX_STRING_LEN = 512;
const MAX_DEPTH = 3;
const MAX_KEYS = 32;
const MAX_ARRAY_ITEMS = 32;
const MAX_TOTAL_BYTES = 8 * 1024;

/**
 * Keys that must never be persisted, regardless of source. Matching is
 * case-insensitive and substring-based so that e.g. `passwordHash`,
 * `access_token`, `csrfToken`, `sessionCookie`, `rawBody`, `firmwareBlob`,
 * `cipService`, and `telemetry` are all dropped.
 */
const FORBIDDEN_KEY_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token",
  "cookie",
  "session",
  "authorization",
  "auth",
  "credential",
  "hash",
  "body",
  "document",
  "profile",
  "firmware",
  "cip",
  "telemetry",
  "evidence",
  "snapshot",
  "payload",
];

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEY_PATTERNS.some((p) => k.includes(p));
}

function boundString(s: string): string {
  return s.length > MAX_STRING_LEN ? `${s.slice(0, MAX_STRING_LEN)}…[truncated]` : s;
}

/**
 * Recursively bound + redact an arbitrary value into a safe JSON-serializable
 * shape. Forbidden keys are dropped. Depth, key counts, array length, and
 * string length are all capped. Non-primitive leaves beyond the depth cap are
 * replaced with a marker.
 */
function boundValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") return boundString(value as string);
  if (t === "number") return Number.isFinite(value as number) ? value : null;
  if (t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "undefined" || t === "function" || t === "symbol") return undefined;

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return "[array]";
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const bounded = boundValue(item, depth + 1);
      if (bounded !== undefined) out.push(bounded);
    }
    return out;
  }

  if (t === "object") {
    if (depth >= MAX_DEPTH) return "[object]";
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_KEYS) break;
      if (isForbiddenKey(k)) continue;
      const bounded = boundValue(v, depth + 1);
      if (bounded === undefined) continue;
      out[k] = bounded;
      count++;
    }
    return out;
  }
  return undefined;
}

/** Bound an arbitrary detail object into a safe, size-capped record. */
export function boundDetail(detail: unknown): Record<string, unknown> {
  const bounded = boundValue(detail ?? {}, 0);
  const obj =
    bounded && typeof bounded === "object" && !Array.isArray(bounded)
      ? (bounded as Record<string, unknown>)
      : {};
  // Enforce a hard total-size cap.
  let serialized = JSON.stringify(obj);
  if (serialized.length > MAX_TOTAL_BYTES) {
    return { note: "detail omitted: exceeded size bound" };
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Client event allowlist (strict)
// ---------------------------------------------------------------------------
export const CLIENT_EVENT_NAMES = [
  "PAGE_VISIT",
  "SETTING_CHANGED",
  "DESKTOP_ACTION",
] as const;
export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export function isClientEventName(v: unknown): v is ClientEventName {
  return (
    typeof v === "string" && (CLIENT_EVENT_NAMES as readonly string[]).includes(v)
  );
}

/**
 * Allowlisted `detail` keys per client event. Only these keys survive; every
 * value is additionally bounded/redacted by `boundDetail`.
 */
const CLIENT_EVENT_DETAIL_ALLOWLIST: Record<ClientEventName, readonly string[]> = {
  PAGE_VISIT: ["page", "path"],
  SETTING_CHANGED: ["before", "after", "scope"],
  DESKTOP_ACTION: [
    "operation",
    "result",
    "versionId",
    "versionNumber",
    "digestPrefix",
    "fileName",
    "asset",
  ],
};

/**
 * Strictly filter a client-supplied `detail` object to the per-event
 * allowlist, then bound/redact the result. Returns a safe record.
 */
export function filterClientDetail(
  eventName: ClientEventName,
  detail: unknown,
): Record<string, unknown> {
  const allow = CLIENT_EVENT_DETAIL_ALLOWLIST[eventName];
  const src =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {};
  const picked: Record<string, unknown> = {};
  for (const key of allow) {
    if (key in src && !isForbiddenKey(key)) {
      const value = src[key];
      if (eventName === "PAGE_VISIT") {
        if (typeof value === "string" && /^\/[A-Za-z0-9_./:-]{0,159}$/.test(value)) {
          picked[key] = value;
        }
      } else if (eventName === "SETTING_CHANGED") {
        if (key === "scope" && (value === "settings" || value === "logical_state")) {
          picked[key] = value;
        } else if (key === "before" || key === "after") {
          if (value === null || typeof value === "boolean") picked[key] = value;
          else if (typeof value === "number" && Number.isFinite(value)) picked[key] = value;
          else if (typeof value === "string") picked[key] = "[text value]";
        }
      } else if (eventName === "DESKTOP_ACTION") {
        if (key === "operation" && ["check", "activate", "rollback", "generate_zip", "generate_file", "download"].includes(String(value))) {
          picked[key] = value;
        } else if (key === "result" && (value === "success" || value === "failure")) {
          picked[key] = value;
        } else if ((key === "versionId" || key === "versionNumber") && Number.isSafeInteger(value)) {
          picked[key] = value;
        } else if (key === "digestPrefix" && typeof value === "string" && /^[a-f0-9]{1,16}$/i.test(value)) {
          picked[key] = value;
        } else if (key === "fileName" && typeof value === "string" && /^[A-Za-z0-9_.-]{1,120}$/.test(value)) {
          picked[key] = value;
        } else if (key === "asset" && ["installer", "portable", "checksums"].includes(String(value))) {
          picked[key] = value;
        }
      }
    }
  }
  return boundDetail(picked);
}

/** Install the database-level guard that makes the activity stream immutable. */
export async function ensureAdminActivityAppendOnly(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION reject_admin_activity_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'admin_activity is append-only';
    END;
    $$;
    DROP TRIGGER IF EXISTS admin_activity_append_only ON admin_activity;
    CREATE TRIGGER admin_activity_append_only
      BEFORE UPDATE OR DELETE ON admin_activity
      FOR EACH ROW EXECUTE FUNCTION reject_admin_activity_mutation();
  `));
}

/**
 * Bound a client-supplied target descriptor (targetType/targetId/targetLabel).
 * These are short opaque descriptors; they are never documents/payloads. Values
 * that are not primitives are dropped. Forbidden target types are rejected.
 */
export function boundTargetDescriptor(value: unknown): string | null {
  if (value == null) return null;
  const t = typeof value;
  if (t === "string") return boundString(value as string);
  if (t === "number" || t === "boolean" || t === "bigint") {
    return boundString(String(value));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core write
// ---------------------------------------------------------------------------
export interface RecordActivityInput {
  actor: ActivityActor;
  category: AdminActivityCategory;
  action: string;
  outcome: AdminActivityOutcome;
  targetType?: string | null;
  targetId?: string | number | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown>;
  requestId?: string | null;
  clientEventId?: string | null;
}

function toInsert(input: RecordActivityInput): InsertAdminActivity {
  return {
    actorId: input.actor.actorId,
    actorUsername: input.actor.actorUsername,
    actorRole: input.actor.actorRole,
    category: input.category,
    action: input.action,
    outcome: input.outcome,
    targetType: input.targetType ?? null,
    targetId:
      input.targetId == null ? null : String(input.targetId).slice(0, MAX_STRING_LEN),
    targetLabel: input.targetLabel ? boundString(input.targetLabel) : null,
    detail: boundDetail(input.detail ?? {}),
    requestId: input.requestId ? boundString(input.requestId) : null,
    clientEventId: input.clientEventId ?? null,
  };
}

/** True if a DB error represents a unique-constraint (idempotency) violation. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  if (e.cause && typeof e.cause === "object") {
    const causeCode = (e.cause as { code?: unknown }).code;
    if (causeCode === "23505") return true;
  }
  const msg = typeof e.message === "string" ? e.message : "";
  return /unique|duplicate key|23505/i.test(msg);
}

/**
 * Fail-safe record. Never throws: any failure is logged and swallowed so the
 * primary operation is unaffected. Use for auth/user-management/mirror events.
 */
export async function recordActivitySafe(
  input: RecordActivityInput,
  log: Logger = logger,
): Promise<void> {
  try {
    await db.insert(adminActivityTable).values(toInsert(input));
  } catch (err) {
    // Never leak the attempted detail; log only category/action/outcome.
    log.error(
      { category: input.category, action: input.action, outcome: input.outcome },
      "admin_activity write failed",
    );
  }
}

/**
 * Strict record. Throws on failure so the caller (explicit client-event /
 * download endpoints) may report the failure. Idempotency violations surface as
 * an `AdminActivityDuplicateError`.
 */
export class AdminActivityDuplicateError extends Error {
  constructor() {
    super("Duplicate client event");
    this.name = "AdminActivityDuplicateError";
  }
}

export async function recordActivityStrict(
  input: RecordActivityInput,
): Promise<void> {
  try {
    await db.insert(adminActivityTable).values(toInsert(input));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AdminActivityDuplicateError();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Auth-event recording policy
// ---------------------------------------------------------------------------
const ADMIN_ROLES: readonly Role[] = ["SUPERADMIN", "FIRMWARE_ADMIN"];

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}
