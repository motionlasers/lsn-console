import { createHash } from "node:crypto";

/**
 * Canonicalization, digest, and diff classification for device profiles.
 *
 * Canonical form: JSON with recursively sorted object keys and a stable
 * serialization, so a given logical profile always produces the same digest
 * regardless of key insertion order. This is the addressable identity used for
 * immutable versions, review snapshots, publications, and validation binding.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/** Recursively sort object keys to produce a stable structure. */
export function canonicalize(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = canonicalize(obj[key]);
      out[key] = v;
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value as Json;
}

/** Deterministic JSON string of the canonical form. */
export function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Canonical SHA-256 digest (hex) of a profile document. */
export function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalString(value)).digest("hex");
}

// ---------------------------------------------------------------------------
// Diff classification
// ---------------------------------------------------------------------------

export type ChangeClass = "field" | "mapping" | "timing" | "behavior" | "other";
export type ChangeKind = "added" | "removed" | "changed";

export interface DiffEntry {
  /** JSON-ish path to the changed element. */
  path: string;
  kind: ChangeKind;
  class: ChangeClass;
  before?: Json;
  after?: Json;
}

export interface DiffResult {
  entries: DiffEntry[];
  counts: Record<ChangeClass, number>;
  hasChanges: boolean;
}

// Field keys that indicate a CIP mapping change.
const MAPPING_KEYS = new Set([
  "cipService",
  "class",
  "instance",
  "attribute",
  "assembly",
  "direction",
  "access",
]);
// Field keys that indicate a timing/phase change.
const TIMING_KEYS = new Set(["phase", "timing", "timeoutMs", "rpiMs", "intervalMs"]);
// Field keys that indicate a behavior change.
const BEHAVIOR_KEYS = new Set([
  "expectedFirmwareBehavior",
  "expectedReportedResponse",
  "enabled",
  "implementationStatus",
  "simulationStatus",
]);

function classifyKey(key: string): ChangeClass {
  if (MAPPING_KEYS.has(key)) return "mapping";
  if (TIMING_KEYS.has(key)) return "timing";
  if (BEHAVIOR_KEYS.has(key)) return "behavior";
  // symbolicName, dataType, description, notes, and top-level metadata → field
  return "field";
}

function leafKey(path: string): string {
  const parts = path.split(/[.[]/);
  const last = parts[parts.length - 1] ?? "";
  return last.replace(/\]$/, "");
}

function isObject(v: unknown): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function walk(before: Json, after: Json, path: string, out: DiffEntry[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;

  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of [...keys].sort()) {
      const childPath = path ? `${path}.${k}` : k;
      const b = k in before ? before[k] : undefined;
      const a = k in after ? after[k] : undefined;
      if (b === undefined) {
        out.push({ path: childPath, kind: "added", class: classifyKey(k), after: a });
      } else if (a === undefined) {
        out.push({ path: childPath, kind: "removed", class: classifyKey(k), before: b });
      } else {
        walk(b, a, childPath, out);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      const childPath = `${path}[${i}]`;
      const b = i < before.length ? before[i] : undefined;
      const a = i < after.length ? after[i] : undefined;
      if (b === undefined) {
        out.push({ path: childPath, kind: "added", class: "field", after: a });
      } else if (a === undefined) {
        out.push({ path: childPath, kind: "removed", class: "field", before: b });
      } else {
        walk(b, a, childPath, out);
      }
    }
    return;
  }

  // Leaf change
  out.push({
    path,
    kind: "changed",
    class: classifyKey(leafKey(path)),
    before,
    after,
  });
}

/**
 * Compute a classified diff between two profile documents. Both are
 * canonicalized first so ordering never produces spurious changes.
 */
export function diffProfiles(before: unknown, after: unknown): DiffResult {
  const entries: DiffEntry[] = [];
  walk(canonicalize(before), canonicalize(after), "", entries);

  const counts: Record<ChangeClass, number> = {
    field: 0,
    mapping: 0,
    timing: 0,
    behavior: 0,
    other: 0,
  };
  for (const e of entries) counts[e.class]++;

  return { entries, counts, hasChanges: entries.length > 0 };
}
