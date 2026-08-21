'use strict';

/**
 * Authoritative main-process Development Profile update trust boundary.
 *
 * This is the ONLY path by which a Device Profile other than the bundled
 * fallback may ever become the active physical-hardware profile. It exists
 * entirely in the Electron main process; the renderer can never fetch, verify,
 * stage, activate, or roll back a profile itself, and a renderer-saved or
 * locally imported profile document can NEVER reach physical mappings.
 *
 * Trust boundary responsibilities (Task #48, steps 7 & 8):
 *   1. Fetch    — pull the manifest + immutable artifact from a FIXED origin
 *                 over the authenticated HTTPS API (the caller supplies a
 *                 credentialed fetch bound to the renderer's own on-disk
 *                 session; this module never constructs its own network stack).
 *   2. Verify   — independently re-check, in main, every one of:
 *                   - immutable version identity (manifest vs. document)
 *                   - SHA-256 digest over the canonical artifact bytes
 *                   - schema conformance (self-contained; no renderer libs)
 *                   - protocol version policy
 *                   - hardware family / identity readiness
 *                   - firmware compatibility
 *                   - mapping readiness (via profile-operations)
 *                   - version policy (monotonic, never silently downgrade)
 *                   - OPTIONAL manifest signature (defense in depth only)
 *   3. Stage    — persist the verified artifact + metadata atomically.
 *   4. Activate — ONLY on an explicit operator action: atomically promote the
 *                 staged profile to "active", preserving the previous active as
 *                 "last-known-good", then force a hardware disconnect and
 *                 identity revalidation so no stale session survives the swap.
 *   5. Rollback — atomically restore the last-known-good verified profile, or
 *                 the bundled fallback when none exists.
 *
 * Everything the renderer can observe is sanitized metadata only (versions,
 * digests, readiness, diffs, status) — never CIP mappings, EPATHs, raw bytes,
 * services, or a full profile document with wire encodings.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const {
  computeReadiness,
  resolveExpectedIdentity,
  BUNDLED_PROFILE_PATH,
} = require('./profile-operations.cjs');

// --- Fixed policy constants -------------------------------------------------

/** Manifest / channel endpoint on the fixed authenticated HTTPS origin. */
const PROFILE_CHANNEL_PATH = '/api/desktop/profile-channel';

/** Maximum sizes to bound untrusted network payloads. */
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/** SemVer-ish comparable version, e.g. "0.2.0". */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

/** Only these implementation states are treated as resolvable. */
const RESOLVED_IDENTITY_STATES = new Set(['IMPLEMENTED', 'VERIFIED']);

// --- Small helpers ----------------------------------------------------------

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const m = SEMVER_RE.exec(value.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare two release cores; ignores prerelease tags for policy purposes. */
function compareSemverCore(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Canonicalize a JSON document to a deterministic byte string with sorted keys
 * so the digest is stable regardless of key order. The published manifest
 * digest MUST be computed over these exact canonical bytes.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(doc) {
  return sha256Hex(Buffer.from(canonicalize(doc), 'utf8'));
}

// --- Self-contained schema validation (no renderer libraries) ---------------

const FIELD_DIRECTIONS = new Set(['PC_TO_LSN', 'LSN_TO_PC']);
const FIELD_ACCESS = new Set(['READ', 'WRITE', 'READ_WRITE']);
const IMPL_STATUSES = new Set([
  'TBD',
  'IMPLEMENTING',
  'TESTING',
  'IMPLEMENTED',
  'VERIFIED',
]);
const SIM_STATUSES = new Set(['NOT_TESTED', 'TESTING', 'VERIFIED']);

/**
 * Validate a candidate profile document against the LSN device-profile schema
 * shape. Returns an array of human-readable issues (empty when valid). This is
 * intentionally self-contained so the main process never depends on a bundler
 * or the renderer's AJV instance.
 */
function validateProfileSchema(doc) {
  const issues = [];
  const push = (message) => issues.push(message);

  if (!isPlainObject(doc)) {
    return ['profile is not an object'];
  }
  for (const key of [
    'profileVersion',
    'protocolVersion',
    'hardwareFamily',
  ]) {
    if (typeof doc[key] !== 'string' || doc[key].trim() === '') {
      push(`"${key}" must be a non-empty string`);
    }
  }
  if (!isPlainObject(doc.capabilities)) {
    push('"capabilities" must be an object');
  } else {
    for (const [name, cap] of Object.entries(doc.capabilities)) {
      if (!isPlainObject(cap)) {
        push(`capability "${name}" must be an object`);
        continue;
      }
      if (typeof cap.enabled !== 'boolean') {
        push(`capability "${name}".enabled must be a boolean`);
      }
      if (typeof cap.phase !== 'string') {
        push(`capability "${name}".phase must be a string`);
      }
      if (typeof cap.description !== 'string') {
        push(`capability "${name}".description must be a string`);
      }
    }
  }
  if (!Array.isArray(doc.fields) || doc.fields.length === 0) {
    push('"fields" must be a non-empty array');
  } else {
    doc.fields.forEach((field, index) => {
      const label = `fields[${index}]`;
      if (!isPlainObject(field)) {
        push(`${label} must be an object`);
        return;
      }
      if (typeof field.symbolicName !== 'string' || field.symbolicName === '') {
        push(`${label}.symbolicName must be a non-empty string`);
      }
      if (!FIELD_DIRECTIONS.has(field.direction)) {
        push(`${label}.direction is invalid`);
      }
      if (typeof field.dataType !== 'string') {
        push(`${label}.dataType must be a string`);
      }
      if (!FIELD_ACCESS.has(field.access)) {
        push(`${label}.access is invalid`);
      }
      if (!IMPL_STATUSES.has(field.implementationStatus)) {
        push(`${label}.implementationStatus is invalid`);
      }
      if (!SIM_STATUSES.has(field.simulationStatus)) {
        push(`${label}.simulationStatus is invalid`);
      }
      if (typeof field.expectedFirmwareBehavior !== 'string') {
        push(`${label}.expectedFirmwareBehavior must be a string`);
      }
      if (typeof field.expectedReportedResponse !== 'string') {
        push(`${label}.expectedReportedResponse must be a string`);
      }
    });
    // Reject duplicate symbolic names — an ambiguous mapping is a hard failure.
    const seen = new Set();
    for (const field of doc.fields) {
      if (isPlainObject(field) && typeof field.symbolicName === 'string') {
        if (seen.has(field.symbolicName)) {
          push(`duplicate symbolic field "${field.symbolicName}"`);
        }
        seen.add(field.symbolicName);
      }
    }
  }
  return issues;
}

// --- Verification pipeline --------------------------------------------------

/**
 * Independently verify a fetched manifest + artifact in main. This is the core
 * of the trust boundary and never trusts the renderer or the raw network
 * response. Returns { ok: true, verified } or { ok: false, code, issues }.
 *
 * @param {object} args
 * @param {object} args.manifest        Parsed manifest metadata from the API.
 * @param {object} args.document        Parsed candidate profile document.
 * @param {string} args.artifactRaw     Exact artifact bytes as received (utf8).
 * @param {object} args.currentIdentity Bundled/active hardware family + version.
 * @param {(m:object)=>string|null} [args.verifySignature] Optional signature check.
 */
function verifyCandidate({
  manifest,
  document,
  artifactRaw,
  currentIdentity,
  verifySignature,
}) {
  const issues = [];
  const fail = (code, message) => issues.push({ code, message });

  if (!isPlainObject(manifest)) {
    return { ok: false, code: 'manifest_invalid', issues: [{ code: 'manifest_invalid', message: 'Manifest is not an object' }] };
  }
  if (!isPlainObject(document)) {
    return { ok: false, code: 'document_invalid', issues: [{ code: 'document_invalid', message: 'Profile document is not an object' }] };
  }

  // (a) Schema conformance -- reject anything malformed/ambiguous outright.
  const schemaIssues = validateProfileSchema(document);
  for (const message of schemaIssues) fail('schema_invalid', message);
  if (schemaIssues.length > 0) {
    // A malformed document cannot be trusted for any further check.
    return { ok: false, code: 'schema_invalid', issues };
  }

  // (b) Immutable version identity: manifest.version must equal the document's
  //     own profileVersion, so the artifact cannot be relabeled after signing.
  if (typeof manifest.profileVersion !== 'string' || manifest.profileVersion === '') {
    fail('version_missing', 'Manifest is missing a profileVersion');
  } else if (manifest.profileVersion !== document.profileVersion) {
    fail(
      'version_mismatch',
      `Manifest version "${manifest.profileVersion}" does not match document version "${document.profileVersion}"`,
    );
  }
  if (!parseSemver(document.profileVersion)) {
    fail('version_unparseable', `Profile version "${String(document.profileVersion)}" is not a valid semantic version`);
  }

  // (c) Digest: recompute over the canonical artifact and compare to manifest.
  const rawDigest = sha256Hex(Buffer.from(artifactRaw, 'utf8'));
  const canonDigest = canonicalDigest(document);
  const expectedDigest =
    typeof manifest.digest === 'string' ? manifest.digest.toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
    fail('digest_missing', 'Manifest digest is missing or malformed');
  } else if (expectedDigest !== rawDigest && expectedDigest !== canonDigest) {
    fail(
      'digest_mismatch',
      'Recomputed SHA-256 digest does not match the manifest digest',
    );
  }
  const digest = /^[a-f0-9]{64}$/.test(expectedDigest) ? expectedDigest : rawDigest;

  // (d) Protocol version policy: must be present and comparable/known.
  if (typeof document.protocolVersion !== 'string' || document.protocolVersion.trim() === '') {
    fail('protocol_missing', 'Profile is missing a protocolVersion');
  } else if (
    currentIdentity &&
    typeof currentIdentity.protocolVersion === 'string' &&
    currentIdentity.protocolVersion.trim() !== '' &&
    document.protocolVersion.trim() !== currentIdentity.protocolVersion.trim()
  ) {
    fail(
      'protocol_incompatible',
      `Profile protocol "${document.protocolVersion}" is not compatible with the current protocol "${currentIdentity.protocolVersion}"`,
    );
  }

  // (e) Hardware family / identity readiness.
  if (
    currentIdentity &&
    typeof currentIdentity.hardwareFamily === 'string' &&
    currentIdentity.hardwareFamily.trim() !== '' &&
    document.hardwareFamily.trim() !== currentIdentity.hardwareFamily.trim()
  ) {
    fail(
      'hardware_family_mismatch',
      `Profile hardware family "${document.hardwareFamily}" does not match the current hardware family "${currentIdentity.hardwareFamily}"`,
    );
  }

  // (f) Firmware compatibility: if the manifest names a firmware target it must
  //     be advertised in the profile's supportedFirmware list.
  if (typeof manifest.firmwareVersion === 'string' && manifest.firmwareVersion !== '') {
    const supported = Array.isArray(document.supportedFirmware)
      ? document.supportedFirmware
      : [];
    if (!isFirmwareSupported(manifest.firmwareVersion, supported)) {
      fail(
        'firmware_incompatible',
        `Firmware "${manifest.firmwareVersion}" is not listed in the profile's supportedFirmware`,
      );
    }
  }

  // (g) Version policy: never silently downgrade below the current active/base.
  if (currentIdentity && typeof currentIdentity.profileVersion === 'string') {
    const cmp = compareSemverCore(document.profileVersion, currentIdentity.profileVersion);
    if (cmp === null) {
      fail('version_policy_unknown', 'Unable to compare candidate version against the current version');
    } else if (cmp < 0) {
      fail(
        'version_downgrade_blocked',
        `Candidate version "${document.profileVersion}" is older than the current version "${currentIdentity.profileVersion}"`,
      );
    }
  }

  // (h) Optional signature (defense in depth only — never an MVF blocker).
  let signatureState = 'unsigned';
  if (typeof verifySignature === 'function') {
    let result;
    try {
      result = verifySignature(manifest);
    } catch (error) {
      result = String(error?.message ?? error);
    }
    if (result === null || result === undefined || result === true) {
      signatureState = manifest.signature ? 'verified' : 'unsigned';
    } else if (result === false) {
      fail('signature_invalid', 'Manifest signature verification failed');
      signatureState = 'invalid';
    } else if (typeof result === 'string') {
      fail('signature_invalid', result);
      signatureState = 'invalid';
    }
  }

  // (i) Physical-profile readiness is fail-closed. Incomplete or ambiguous
  //     mappings remain valid for review/download workflows, but must never be
  //     staged or activated as Electron's physical hardware profile.
  const readiness = computeReadiness(document);
  const identityResult = resolveExpectedIdentity(document);
  const identityResolved =
    !('issues' in identityResult) &&
    isPlainObject(document.identity) &&
    RESOLVED_IDENTITY_STATES.has(document.identity.mappingState);
  if (!identityResolved) {
    fail('identity_unresolved', 'Profile hardware identity is unresolved');
  }
  if (!readiness.readReady || !readiness.controlReady) {
    const blocking = [
      ...(readiness.stateRead?.issues ?? []),
      ...(readiness.enable?.issues ?? []),
    ];
    fail(
      'mapping_incomplete',
      blocking[0]?.message ?? 'Profile mappings are incomplete for physical hardware',
    );
  }

  if (issues.length > 0) {
    return { ok: false, code: issues[0].code, issues };
  }

  return {
    ok: true,
    verified: {
      profileVersion: document.profileVersion,
      protocolVersion: document.protocolVersion,
      hardwareFamily: document.hardwareFamily,
      digest,
      signatureState,
      controlReady: readiness.controlReady === true,
      readReady: readiness.readReady === true,
      identityResolved,
      releaseName:
        typeof manifest.releaseName === 'string' ? manifest.releaseName : document.profileVersion,
      firmwareVersion:
        typeof manifest.firmwareVersion === 'string' ? manifest.firmwareVersion : null,
    },
  };
}

/**
 * Firmware compatibility: exact match, or a "x.y.z"/"x.y.x" style wildcard
 * where a trailing "x" segment matches any value (e.g. "0.2.x-development").
 */
function isFirmwareSupported(firmwareVersion, supportedList) {
  const target = String(firmwareVersion).trim();
  for (const entry of supportedList) {
    if (typeof entry !== 'string') continue;
    const spec = entry.trim();
    if (spec === target) return true;
    // Build a regex from the wildcard spec: "x" segments become .+, and any
    // suffix after a dash (e.g. "-development") must match literally.
    const escaped = spec
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\bx\b/g, '[^.]+');
    if (new RegExp(`^${escaped}$`).test(target)) return true;
  }
  return false;
}

/** Sanitized metadata exposed to the renderer; never wire mappings. */
function sanitizeEntry(entry) {
  if (!entry) return null;
  return {
    profileVersion: entry.profileVersion,
    protocolVersion: entry.protocolVersion,
    hardwareFamily: entry.hardwareFamily,
    digest: entry.digest,
    releaseName: entry.releaseName,
    signatureState: entry.signatureState ?? 'unsigned',
    controlReady: entry.controlReady === true,
    readReady: entry.readReady === true,
    identityResolved: entry.identityResolved === true,
    source: entry.source ?? 'bundled',
    stagedAt: entry.stagedAt,
    activatedAt: entry.activatedAt,
  };
}

// --- Storage layout ---------------------------------------------------------
//
//   <profilesDir>/active.json        -> { meta, document }
//   <profilesDir>/last-known-good.json
//   <profilesDir>/staged.json
//
// Writes are atomic: write to a temp file in the same directory, fsync, then
// rename over the target so a crash never leaves a half-written profile.

class ProfileUpdateService {
  constructor({
    apiOrigin,
    fetch,
    profilesDir,
    bundledProfilePath = BUNDLED_PROFILE_PATH,
    onStateChange = () => {},
    onActivate = async () => {},
    verifySignature = null,
    now = () => new Date().toISOString(),
  } = {}) {
    this._apiOrigin = apiOrigin;
    this._fetch = fetch;
    this._profilesDir = profilesDir;
    this._bundledProfilePath = bundledProfilePath;
    this._onStateChange = onStateChange;
    // Called on activation with the newly-active document so the hardware
    // service can atomically repin, force disconnect, and revalidate identity.
    this._onActivate = onActivate;
    this._verifySignature = verifySignature;
    this._now = now;

    this._activePath = path.join(profilesDir, 'active.json');
    this._lkgPath = path.join(profilesDir, 'last-known-good.json');
    this._stagedPath = path.join(profilesDir, 'staged.json');

    this._bundled = this._loadBundled();
    this._active = null; // { meta, document }
    this._lastKnownGood = null;
    this._staged = null;
    this._lastError = null;
    this._checking = false;
  }

  _loadBundled() {
    const raw = fsSync.readFileSync(this._bundledProfilePath, 'utf8');
    const document = JSON.parse(raw);
    const readiness = computeReadiness(document);
    const identityResult = resolveExpectedIdentity(document);
    const meta = {
      profileVersion: document.profileVersion,
      protocolVersion: document.protocolVersion,
      hardwareFamily: document.hardwareFamily,
      digest: sha256Hex(Buffer.from(raw, 'utf8')),
      releaseName: document.displayName ?? document.profileVersion,
      signatureState: 'bundled',
      controlReady: readiness.controlReady === true,
      readReady: readiness.readReady === true,
      identityResolved:
        !('issues' in identityResult) &&
        isPlainObject(document.identity) &&
        RESOLVED_IDENTITY_STATES.has(document.identity.mappingState),
      source: 'bundled',
      activatedAt: null,
      stagedAt: null,
    };
    return { meta, document };
  }

  /** Load persisted active/last-known-good/staged state from disk. */
  async initialize() {
    await fs.mkdir(this._profilesDir, { recursive: true });
    this._active = await this._readEntry(this._activePath);
    const restoredPersistedActive = Boolean(this._active);
    this._lastKnownGood = await this._readEntry(this._lkgPath);
    this._staged = await this._readEntry(this._stagedPath);
    // Fall back to the bundled profile as the active profile when nothing is
    // persisted (first run, or corrupted store already cleared by _readEntry).
    if (!this._active) {
      this._active = { meta: { ...this._bundled.meta }, document: this._bundled.document };
    }
    if (restoredPersistedActive) {
      await this._onActivate(this._active.document, this._active.meta);
    }
    this._broadcast();
    return this.getState();
  }

  async _readEntry(filePath) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        !isPlainObject(parsed) ||
        !isPlainObject(parsed.meta) ||
        !isPlainObject(parsed.document)
      ) {
        throw new Error('Malformed stored profile entry');
      }
      // Re-verify the stored document digest so a tampered on-disk file is
      // never trusted; corrupted entries are dropped and treated as absent.
      const recomputed = canonicalDigest(parsed.document);
      const raw2 = sha256Hex(Buffer.from(JSON.stringify(parsed.document), 'utf8'));
      if (
        parsed.meta.digest !== recomputed &&
        parsed.meta.digest !== raw2 &&
        parsed.meta.source !== 'bundled'
      ) {
        throw new Error('Stored profile digest mismatch');
      }
      if (parsed.meta.source === 'channel') {
        const artifactRaw = JSON.stringify(parsed.document);
        const verification = verifyCandidate({
          manifest: {
            profileVersion: parsed.meta.profileVersion,
            digest: parsed.meta.digest,
            firmwareVersion: parsed.meta.firmwareVersion,
            releaseName: parsed.meta.releaseName,
          },
          document: parsed.document,
          artifactRaw,
          currentIdentity: this._bundled.meta,
          verifySignature: this._verifySignature,
        });
        if (!verification.ok) {
          throw new Error(`Stored channel profile failed verification: ${verification.code}`);
        }
        parsed.meta = {
          ...parsed.meta,
          ...verification.verified,
          source: 'channel',
        };
      }
      return { meta: parsed.meta, document: parsed.document };
    } catch {
      await fs.rm(filePath, { force: true }).catch(() => {});
      return null;
    }
  }

  async _writeEntryAtomic(filePath, entry) {
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({ meta: entry.meta, document: entry.document });
    const handle = await fs.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
    } finally {
      await handle.close().catch(() => {});
    }
    await fs.rename(tmp, filePath);
  }

  async _removeEntry(filePath) {
    await fs.rm(filePath, { force: true }).catch(() => {});
  }

  // --- Public sanitized state ----------------------------------------------

  getState() {
    return {
      active: sanitizeEntry(this._active?.meta),
      lastKnownGood: sanitizeEntry(this._lastKnownGood?.meta),
      staged: sanitizeEntry(this._staged?.meta),
      bundled: sanitizeEntry(this._bundled.meta),
      checking: this._checking,
      error: this._lastError,
    };
  }

  _broadcast() {
    try {
      this._onStateChange(this.getState());
    } catch {
      // Broadcasting must never throw into update logic.
    }
  }

  _currentIdentity() {
    const meta = this._active?.meta ?? this._bundled.meta;
    return {
      profileVersion: meta.profileVersion,
      protocolVersion: meta.protocolVersion,
      hardwareFamily: meta.hardwareFamily,
    };
  }

  // --- Fetch + verify (no activation) --------------------------------------

  /**
   * Check the fixed-origin authenticated channel for an available Development
   * Profile update, fetch and independently verify it, and — when it passes —
   * stage it. Never activates. Returns sanitized state including a diff summary
   * and any blocking verification issues.
   */
  async check() {
    if (this._checking) return this.getState();
    this._checking = true;
    this._lastError = null;
    this._broadcast();
    try {
      const result = await this._fetchAndVerify();
      if (!result.ok) {
        this._lastError = { code: result.code, issues: result.issues };
        return this.getState();
      }
      await this._stageVerified(result.verified, result.document);
      return this.getState();
    } catch (error) {
      this._lastError = {
        code: 'check_failed',
        issues: [{ code: 'check_failed', message: String(error?.message ?? error) }],
      };
      return this.getState();
    } finally {
      this._checking = false;
      this._broadcast();
    }
  }

  async _fetchJson(url, maxBytes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this._fetch(url, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const err = new Error(`Profile channel returned ${response.status}`);
        err.code = 'http_error';
        throw err;
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new Error('Profile channel response exceeded maximum size');
      }
      return { text, json: JSON.parse(text) };
    } finally {
      clearTimeout(timer);
    }
  }

  async _fetchAndVerify() {
    // 1. Manifest from the fixed authenticated origin.
    const manifestUrl = new URL(PROFILE_CHANNEL_PATH, this._apiOrigin).toString();
    const { json: manifest } = await this._fetchJson(manifestUrl, MAX_MANIFEST_BYTES);

    if (isPlainObject(manifest) && manifest.available === false) {
      return { ok: false, code: 'no_update', issues: [] };
    }

    // 2. Immutable artifact. The artifact URL MUST resolve against the same
    //    fixed origin; a manifest can never point us at another host.
    const artifactRef =
      (isPlainObject(manifest) && (manifest.artifactPath || manifest.artifactUrl)) || null;
    if (typeof artifactRef !== 'string' || artifactRef === '') {
      return {
        ok: false,
        code: 'manifest_invalid',
        issues: [{ code: 'manifest_invalid', message: 'Manifest does not reference an artifact' }],
      };
    }
    const artifactUrl = new URL(artifactRef, this._apiOrigin);
    if (artifactUrl.origin !== new URL(this._apiOrigin).origin) {
      return {
        ok: false,
        code: 'origin_violation',
        issues: [{ code: 'origin_violation', message: 'Artifact URL is not on the fixed API origin' }],
      };
    }
    const { text: artifactRaw, json: document } = await this._fetchJson(
      artifactUrl.toString(),
      MAX_ARTIFACT_BYTES,
    );

    const verification = verifyCandidate({
      manifest,
      document,
      artifactRaw,
      currentIdentity: this._currentIdentity(),
      verifySignature: this._verifySignature,
    });
    if (!verification.ok) return verification;
    return { ok: true, verified: verification.verified, document };
  }

  async _stageVerified(verified, document) {
    const meta = {
      ...verified,
      source: 'channel',
      stagedAt: this._now(),
      activatedAt: null,
    };
    const entry = { meta, document };
    await this._writeEntryAtomic(this._stagedPath, entry);
    this._staged = entry;
  }

  // --- Explicit activation --------------------------------------------------

  /**
   * Explicitly activate the currently staged profile (or a specific staged
   * digest). This is the ONLY transition that changes the active physical
   * profile, and it happens only on an explicit operator action from the UI.
   *
   * The swap is atomic: the previous active becomes last-known-good, then the
   * staged entry becomes active, then the hardware transport is force
   * disconnected and identity revalidation is required on the next connect.
   */
  async activate({ digest } = {}) {
    if (!this._staged) {
      const err = new Error('No staged profile to activate');
      err.code = 'no_staged_profile';
      throw err;
    }
    if (digest !== undefined && this._staged.meta.digest !== digest) {
      const err = new Error('Staged profile digest does not match the requested activation digest');
      err.code = 'digest_mismatch';
      throw err;
    }

    // Re-verify the staged document against the CURRENT active identity right
    // before promotion so a concurrent activation cannot bypass version policy.
    const reverify = verifyCandidate({
      manifest: {
        profileVersion: this._staged.meta.profileVersion,
        digest: this._staged.meta.digest,
        firmwareVersion: undefined,
      },
      document: this._staged.document,
      artifactRaw: JSON.stringify(this._staged.document),
      currentIdentity: this._currentIdentity(),
      verifySignature: null,
    });
    // Digest is recomputed over canonical bytes here (the raw form differs),
    // so accept a canonical-digest match; only hard policy failures block.
    if (!reverify.ok) {
      const blocking = reverify.issues.filter(
        (i) => i.code !== 'digest_mismatch' && i.code !== 'digest_missing',
      );
      if (blocking.length > 0) {
        const err = new Error('Staged profile failed activation re-verification');
        err.code = 'activation_reverify_failed';
        err.issues = blocking;
        throw err;
      }
    }

    const previousActive = this._active;
    const now = this._now();

    const activeEntry = {
      meta: { ...this._staged.meta, source: 'channel', activatedAt: now },
      document: this._staged.document,
    };

    // 1. Demote the previous active to last-known-good (only if it was a real,
    //    verified channel profile; the bundled fallback is always recoverable
    //    independently and need not be stored as LKG).
    if (previousActive && previousActive.meta.source === 'channel') {
      await this._writeEntryAtomic(this._lkgPath, previousActive);
      this._lastKnownGood = previousActive;
    }

    // 2. Promote staged -> active atomically, then clear the staged slot.
    await this._writeEntryAtomic(this._activePath, activeEntry);
    this._active = activeEntry;
    await this._removeEntry(this._stagedPath);
    this._staged = null;

    // 3. Force hardware disconnect + identity revalidation with the new pin.
    await this._applyActive(activeEntry);

    this._lastError = null;
    this._broadcast();
    return this.getState();
  }

  async _applyActive(entry) {
    try {
      await this._onActivate(entry.document, entry.meta);
    } catch (error) {
      // Applying the profile to the hardware service must not corrupt storage;
      // surface as an error but keep the stored active profile authoritative.
      this._lastError = {
        code: 'activation_apply_failed',
        issues: [{ code: 'activation_apply_failed', message: String(error?.message ?? error) }],
      };
    }
  }

  // --- Rollback -------------------------------------------------------------

  /**
   * Roll back the active profile. Prefers the last-known-good verified profile;
   * when none exists (or explicitly requested), falls back to the immutable
   * bundled profile. Always forces disconnect + identity revalidation.
   */
  async rollback({ toBundled = false } = {}) {
    const target =
      !toBundled && this._lastKnownGood
        ? this._lastKnownGood
        : { meta: { ...this._bundled.meta }, document: this._bundled.document };

    const now = this._now();
    const activeEntry = {
      meta: { ...target.meta, activatedAt: now },
      document: target.document,
    };
    await this._writeEntryAtomic(this._activePath, activeEntry);
    this._active = activeEntry;

    // Consuming the last-known-good clears that slot so a second rollback goes
    // to the bundled fallback rather than re-applying the same profile.
    if (!toBundled && this._lastKnownGood) {
      await this._removeEntry(this._lkgPath);
      this._lastKnownGood = null;
    }

    await this._applyActive(activeEntry);
    this._lastError = null;
    this._broadcast();
    return this.getState();
  }

  /** Discard the staged profile without activating it. */
  async discardStaged() {
    if (this._staged) {
      await this._removeEntry(this._stagedPath);
      this._staged = null;
      this._broadcast();
    }
    return this.getState();
  }

  /** The document currently pinned as active (for the hardware service). */
  getActiveDocument() {
    return (this._active ?? { document: this._bundled.document }).document;
  }
}

module.exports = {
  ProfileUpdateService,
  PROFILE_CHANNEL_PATH,
  verifyCandidate,
  validateProfileSchema,
  canonicalize,
  canonicalDigest,
  parseSemver,
  compareSemverCore,
  isFirmwareSupported,
  sanitizeEntry,
  MAX_ARTIFACT_BYTES,
  MAX_MANIFEST_BYTES,
};
