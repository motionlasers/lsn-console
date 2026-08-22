import type { DeviceProfileDocument } from "./profile-validation";

/**
 * Pure, deterministic client-review sandbox helpers.
 *
 * The Client Reviewer works against an isolated copy of the immutable review
 * snapshot. Nothing here mutates the shared draft, review, or version. The
 * simulation is a deterministic local evaluation of the reviewer's edited
 * inputs — it is NOT firmware or hardware execution and never claims to be.
 */

export interface ReviewSandboxInputs {
  /** Requested Packet Interval (ms) the reviewer wants to evaluate. */
  requestedPacketIntervalMs: number;
  /** Explicit message timeout (ms). */
  timeoutMs: number;
  /** Runtime timing tolerance (ms). */
  toleranceMs: number;
  /** Symbolic name of the representative field/command being evaluated. */
  representativeField: string;
  /**
   * Optional reviewer verification override for the representative field's
   * expected reported response. Empty string means "use the snapshot value".
   */
  expectedResponseOverride: string;
}

export interface SandboxCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SandboxSimulationResult {
  passed: boolean;
  checks: SandboxCheck[];
  summary: string;
}

const MIN_RPI_MS = 1;
const MAX_RPI_MS = 3200;
const MIN_TIMEOUT_MS = 1;
const MIN_TOLERANCE_MS = 0;

/**
 * Build a deterministic set of isolated sandbox inputs from the immutable
 * review snapshot. The snapshot itself is never modified; the returned object
 * is a fresh, editable copy the reviewer owns.
 */
export function deriveSandboxInputs(
  snapshot: DeviceProfileDocument,
): ReviewSandboxInputs {
  const timing = (snapshot.timing ?? {}) as Record<string, unknown>;
  const toNum = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  const timeoutMs = toNum(timing.explicitMessageTimeoutMs, 1000);
  const reconnectMs = toNum(timing.reconnectIntervalMs, 2000);
  const toleranceMs = toNum(timing.runtimeToleranceMs, 250);

  // The profile has no explicit RPI, so seed a deterministic reasonable value
  // from the message timeout (half the timeout, clamped to the valid range).
  const seededRpi = Math.min(
    MAX_RPI_MS,
    Math.max(MIN_RPI_MS, Math.round(timeoutMs / 2) || reconnectMs),
  );

  const representativeField = snapshot.fields[0]?.symbolicName ?? "";

  return {
    requestedPacketIntervalMs: seededRpi,
    timeoutMs,
    toleranceMs,
    representativeField,
    expectedResponseOverride: "",
  };
}

/** Serialize sandbox inputs into an editable DeviceProfileDocument copy. */
export function applyInputsToSandboxDocument(
  snapshot: DeviceProfileDocument,
  inputs: ReviewSandboxInputs,
): DeviceProfileDocument {
  const base = JSON.parse(JSON.stringify(snapshot)) as DeviceProfileDocument;
  const timing = { ...(base.timing ?? {}) } as Record<string, unknown>;
  timing.explicitMessageTimeoutMs = inputs.timeoutMs;
  timing.runtimeToleranceMs = inputs.toleranceMs;
  timing.requestedPacketIntervalMs = inputs.requestedPacketIntervalMs;
  base.timing = timing;

  if (inputs.expectedResponseOverride.trim() && inputs.representativeField) {
    base.fields = base.fields.map((field) =>
      field.symbolicName === inputs.representativeField
        ? {
            ...field,
            expectedReportedResponse: inputs.expectedResponseOverride.trim(),
          }
        : field,
    );
  }
  return base;
}

/** Extract sandbox inputs previously stored in a sandbox document. */
export function readInputsFromSandboxDocument(
  snapshot: DeviceProfileDocument,
  sandboxDocument: DeviceProfileDocument | undefined,
): ReviewSandboxInputs {
  const base = deriveSandboxInputs(snapshot);
  if (!sandboxDocument) return base;

  const timing = (sandboxDocument.timing ?? {}) as Record<string, unknown>;
  const toNum = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  const representativeField =
    sandboxDocument.fields.find(
      (field) => field.symbolicName === base.representativeField,
    )?.symbolicName ??
    sandboxDocument.fields[0]?.symbolicName ??
    base.representativeField;

  const snapshotField = snapshot.fields.find(
    (field) => field.symbolicName === representativeField,
  );
  const sandboxField = sandboxDocument.fields.find(
    (field) => field.symbolicName === representativeField,
  );
  const override =
    sandboxField &&
    snapshotField &&
    sandboxField.expectedReportedResponse !==
      snapshotField.expectedReportedResponse
      ? String(sandboxField.expectedReportedResponse ?? "")
      : "";

  return {
    requestedPacketIntervalMs: toNum(
      timing.requestedPacketIntervalMs,
      base.requestedPacketIntervalMs,
    ),
    timeoutMs: toNum(timing.explicitMessageTimeoutMs, base.timeoutMs),
    toleranceMs: toNum(timing.runtimeToleranceMs, base.toleranceMs),
    representativeField,
    expectedResponseOverride: override,
  };
}

/**
 * Run a deterministic local evaluation of the reviewer's edited sandbox inputs
 * against the immutable snapshot. Produces PASS/FAIL evidence from actual
 * checks. This is a simulation only and does not implement or verify firmware
 * or hardware.
 */
export function runSandboxSimulation(
  snapshot: DeviceProfileDocument,
  inputs: ReviewSandboxInputs,
): SandboxSimulationResult {
  const checks: SandboxCheck[] = [];

  // 1. RPI must be a finite positive value within the supported window.
  const rpiValid =
    Number.isFinite(inputs.requestedPacketIntervalMs) &&
    inputs.requestedPacketIntervalMs >= MIN_RPI_MS &&
    inputs.requestedPacketIntervalMs <= MAX_RPI_MS;
  checks.push({
    id: "rpi-range",
    label: "Requested packet interval within supported window",
    passed: rpiValid,
    detail: `RPI ${inputs.requestedPacketIntervalMs}ms vs allowed ${MIN_RPI_MS}–${MAX_RPI_MS}ms`,
  });

  // 2. Timeout must be positive and strictly greater than the RPI so at least
  //    one packet can be delivered before the connection is torn down.
  const timeoutValid =
    Number.isFinite(inputs.timeoutMs) &&
    inputs.timeoutMs >= MIN_TIMEOUT_MS &&
    inputs.timeoutMs > inputs.requestedPacketIntervalMs;
  checks.push({
    id: "timeout-vs-rpi",
    label: "Timeout exceeds requested packet interval",
    passed: timeoutValid,
    detail: `Timeout ${inputs.timeoutMs}ms must be > RPI ${inputs.requestedPacketIntervalMs}ms and ≥ ${MIN_TIMEOUT_MS}ms`,
  });

  // 3. Tolerance must be non-negative and not exceed the RPI (a tolerance wider
  //    than the interval would make timing evidence meaningless).
  const toleranceValid =
    Number.isFinite(inputs.toleranceMs) &&
    inputs.toleranceMs >= MIN_TOLERANCE_MS &&
    inputs.toleranceMs <= inputs.requestedPacketIntervalMs;
  checks.push({
    id: "tolerance-range",
    label: "Tolerance non-negative and within one packet interval",
    passed: toleranceValid,
    detail: `Tolerance ${inputs.toleranceMs}ms must be between ${MIN_TOLERANCE_MS}ms and RPI ${inputs.requestedPacketIntervalMs}ms`,
  });

  // 4. The representative field must exist in the immutable snapshot.
  const field = snapshot.fields.find(
    (candidate) => candidate.symbolicName === inputs.representativeField,
  );
  checks.push({
    id: "field-exists",
    label: "Representative field resolves in snapshot",
    passed: Boolean(field),
    detail: field
      ? `Resolved "${field.symbolicName}" (${field.direction})`
      : `Field "${inputs.representativeField}" not present in snapshot`,
  });

  // 5. The effective expected response (override or snapshot value) must be
  //    non-empty so the reviewer is asserting a concrete expectation.
  const effectiveResponse = inputs.expectedResponseOverride.trim()
    ? inputs.expectedResponseOverride.trim()
    : String(field?.expectedReportedResponse ?? "").trim();
  const responseValid = effectiveResponse.length > 0;
  checks.push({
    id: "expected-response",
    label: "Expected reported response is defined",
    passed: responseValid,
    detail: responseValid
      ? `${inputs.expectedResponseOverride.trim() ? "Override" : "Snapshot"} response: "${truncate(effectiveResponse, 80)}"`
      : "No expected reported response defined for the representative field",
  });

  const passed = checks.every((check) => check.passed);
  const failing = checks.filter((check) => !check.passed).length;
  const summary = passed
    ? `All ${checks.length} deterministic checks passed for the isolated sandbox inputs.`
    : `${failing} of ${checks.length} deterministic checks failed for the isolated sandbox inputs.`;

  return { passed, checks, summary };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Compute a stable, deterministic digest of the immutable review snapshot so
 * the reviewer sees a review identity even when a server digest is not loaded.
 * FNV-1a over canonicalized JSON; not cryptographic, used only as an identity
 * label alongside the authoritative version digest when available.
 */
export function computeReviewDigest(snapshot: DeviceProfileDocument): string {
  const canonical = canonicalize(snapshot);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}
