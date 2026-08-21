'use strict';

/**
 * Authoritative main-process EtherNet/IP hardware service.
 *
 * Owns the single active transport session and the pinned device profile.
 * The renderer can only invoke narrow SYMBOLIC operations:
 *   - getProfileReadiness()
 *   - readField(symbolicName)
 *   - armControl()          (native confirmation -> one-shot arm token)
 *   - writeEnable(boolean)  (guarded enable / gated disable)
 *
 * The renderer NEVER supplies a CIP service, EPATH, raw bytes, or a profile.
 * The service resolves mapping, EPATH, access, service code, wire encoding and
 * codec entirely in main, matching src/lib/hardware-profile.ts semantics.
 *
 * The current lsn-v0.1 profile is all-TBD, so every mapped operation fails
 * closed with precise readiness/issues. The low-level sendExplicit path stays
 * internal to the transport/session for testing only; it is not exposed to the
 * renderer.
 */

const {
  EnipSession,
  discoverIdentities,
  isValidIpv4,
} = require('./ethernet-ip-transport.cjs');
const {
  loadBundledProfile,
  computeReadiness,
  resolveFieldMapping,
  buildMessageRouterRequest,
  parseCipReply,
  decodeCipReply,
  encodeValue,
  findField,
  resolveExpectedIdentity,
} = require('./profile-operations.cjs');

// A control arm token lives briefly and is single-use.
const ARM_TOKEN_TTL_MS = 30_000;

// Symbolic field names for the guarded enable workflow.
const FIELD_ENABLE_REQUEST = 'EmissionEnableRequest';
const FIELD_OUTPUT_ACTIVE = 'EmissionControlOutputActive';
const FIELD_READY = 'Ready';
const FIELD_FAULTED = 'Faulted';
const FIELD_INTERLOCK = 'InterlockOK';
const FIELD_REMOTE_STOP = 'RemoteStopOK';

class HardwareService {
  constructor({
    onStateChange = () => {},
    sessionFactory = () => new EnipSession(),
    discover = discoverIdentities,
    confirmArm = async () => false,
    profileLoader = loadBundledProfile,
    now = () => Date.now(),
  } = {}) {
    this._onStateChange = onStateChange;
    this._sessionFactory = sessionFactory;
    this._discover = discover;
    this._confirmArm = confirmArm;
    this._now = now;
    this._session = null;
    this._discoveryAbort = null;
    this._identityBinding = null;

    const { profile, digest } = profileLoader();
    this._profile = profile;
    this._profileDigest = digest;
    this._readiness = computeReadiness(profile);

    // One-shot main-owned arm token: { token, expiresAt } or null.
    this._arm = null;
    // Last broadcast state signature for deduplication (see _broadcast).
    this._lastBroadcastSignature = null;
  }

  getState() {
    if (this._session) {
      const state = this._session.getState();
      return {
        state: state.state,
        connected: state.connected,
        address: state.address,
        sessionHandle: state.sessionHandle,
        identityVerified: this._identityBinding !== null,
      };
    }
    return { state: 'disconnected', connected: false, address: null, sessionHandle: null, identityVerified: false };
  }

  getProfileReadiness() {
    return {
      profileDigest: this._profileDigest,
      ...this._readiness,
      mappingEvidence: this._profile.fields
        .filter((field) => field && typeof field.symbolicName === 'string')
        .slice(0, 25)
        .map((field) => ({
          symbolicName: field.symbolicName,
          cipService: field.cipService ?? null,
          class: field.class ?? null,
          instance: field.instance ?? null,
          attribute: field.attribute ?? null,
          assembly: field.assembly ?? null,
        })),
    };
  }

  /**
   * Atomically repin the active device profile. Called ONLY by the main-process
   * profile update service after it has independently fetched, verified, staged,
   * and explicitly activated an immutable profile (or a rollback target). The
   * renderer can never reach this path — a renderer-saved or imported profile
   * document never becomes the physical hardware profile directly.
   *
   * Repinning forces a hardware disconnect and clears any identity binding and
   * arm token so the next connect must re-run ListIdentity against the NEW
   * pinned profile before any symbolic control is permitted.
   *
   * @param {object} profile A validated, deep-frozen-safe profile document.
   * @param {string} [digest] The verified digest of that profile document.
   */
  async setActiveProfile(profile, digest) {
    if (!profile || typeof profile !== 'object' || !Array.isArray(profile.fields)) {
      throw new Error('setActiveProfile requires a validated profile document');
    }
    // Force disconnect so no session survives the profile swap. This clears the
    // identity binding and arm token via the disconnect path.
    await this.disconnect();
    this._profile = profile;
    this._profileDigest =
      typeof digest === 'string' && digest.length > 0 ? digest : this._profileDigest;
    this._readiness = computeReadiness(profile);
    // Belt-and-suspenders: ensure no stale freshness survives a repin.
    this._clearArm();
    this._clearIdentityBinding();
    this._broadcast();
    return this.getProfileReadiness();
  }

  _broadcast() {
    const state = this.getState();
    // Deduplicate: never emit the same sanitized state twice in a row, so a
    // successful connect (session event + defensive broadcast) yields exactly
    // one connected event and no false/duplicate transitions reach the renderer.
    const signature = `${state.state}|${state.connected}|${state.address ?? ''}|${state.sessionHandle ?? ''}`;
    if (signature === this._lastBroadcastSignature) return;
    this._lastBroadcastSignature = signature;
    try {
      this._onStateChange(state);
    } catch {
      // Broadcasting must never throw into transport logic.
    }
  }

  _clearArm() {
    this._arm = null;
  }

  _clearIdentityBinding() {
    this._identityBinding = null;
  }

  _requireVerifiedIdentity() {
    if (!this._identityBinding) {
      const err = new Error('Connected endpoint identity is not verified against the pinned profile');
      err.code = 'identity_unverified';
      throw err;
    }
  }

  // --- Discovery / connect / disconnect (unchanged behavior) ---------------

  async discover({ address } = {}) {
    if (address !== undefined && !isValidIpv4(address)) {
      throw new Error('Invalid IPv4 address');
    }
    if (this._discoveryAbort) this._discoveryAbort.abort();
    const controller = new AbortController();
    this._discoveryAbort = controller;
    try {
      const candidates = await this._discover({ address, signal: controller.signal });
      return { candidates };
    } finally {
      if (this._discoveryAbort === controller) this._discoveryAbort = null;
    }
  }

  /**
   * Handle a sanitized state transition emitted by the created session,
   * including ASYNCHRONOUS socket close/error/request-timeout transitions the
   * caller never awaited. Broadcasts the new state to the renderer, and on any
   * unexpected transition to disconnected clears the one-shot arm token
   * immediately so physical evidence can never remain live.
   */
  _handleSessionState(session, state) {
    // Ignore events from a session we have already replaced/torn down.
    if (session !== this._session) return;
    if (state.connected !== true) {
      // Unexpected loss of the connected session: clear arm freshness now.
      this._clearArm();
      this._clearIdentityBinding();
    }
    this._broadcast();
  }

  async connect(address) {
    if (!isValidIpv4(address)) throw new Error('Invalid IPv4 address');
    if (this._session) await this.disconnect();
    this._clearIdentityBinding();
    // Pass an options object so the default EnipSession wires its sanitized
    // state-change callback. Custom factories may ignore the options.
    const session = this._sessionFactory({
      onStateChange: (state) => this._handleSessionState(session, state),
    });
    this._session = session;
    try {
      const state = await session.connect(address);
      const expected = resolveExpectedIdentity(this._profile);
      if ('identity' in expected) {
        const observed = state.identity;
        const matches =
          observed &&
          observed.vendorId === expected.identity.vendorId &&
          observed.deviceType === expected.identity.deviceType &&
          observed.productCode === expected.identity.productCode &&
          (observed.sourceAddress === address || observed.socketAddress === address);
        if (!matches) {
          await session.disconnect().catch(() => {});
          if (this._session === session) this._session = null;
          this._clearIdentityBinding();
          throw new Error('ListIdentity response does not match the pinned profile and requested endpoint');
        }
        this._identityBinding = {
          address,
          vendorId: observed.vendorId,
          deviceType: observed.deviceType,
          productCode: observed.productCode,
          serialNumber: observed.serialNumber,
        };
      }
      // The session emits its own connected transition; broadcast defensively
      // in case a custom factory ignored the callback. _broadcast() reads the
      // current session state, so this never produces a false connected event.
      this._broadcast();
      return state;
    } catch (error) {
      if (this._session === session) this._session = null;
      this._clearArm();
      this._clearIdentityBinding();
      this._broadcast();
      throw error;
    }
  }

  async disconnect() {
    const session = this._session;
    // Detach before teardown so the session's own disconnected transition is
    // treated as expected (its _handleSessionState is a no-op once replaced).
    this._session = null;
    // On socket loss, clear arm token and any freshness.
    this._clearArm();
    this._clearIdentityBinding();
    if (session) {
      try {
        await session.disconnect();
      } catch {
        // teardown errors are non-fatal
      }
    }
    this._broadcast();
    return this.getState();
  }

  cancelDiscovery() {
    if (this._discoveryAbort) {
      this._discoveryAbort.abort();
      this._discoveryAbort = null;
    }
  }

  async close() {
    this.cancelDiscovery();
    await this.disconnect();
  }

  // --- Internal profile-driven operations ----------------------------------

  _requireConnected(requireVerifiedIdentity = true) {
    if (!this._session || !this._session.isConnected()) {
      throw new Error('Not connected');
    }
    if (requireVerifiedIdentity) this._requireVerifiedIdentity();
  }

  _resolveOrThrow(symbolicName, requiredKind) {
    const field = findField(this._profile, symbolicName);
    if (!field) {
      const err = new Error(`Field "${symbolicName}" is not present in the profile`);
      err.code = 'field_missing';
      throw err;
    }
    const result = resolveFieldMapping(field, requiredKind);
    if ('issues' in result) {
      const err = new Error(`Field "${symbolicName}" mapping is unresolved`);
      err.code = 'mapping_unresolved';
      err.issues = result.issues;
      throw err;
    }
    return result.mapping;
  }

  /**
   * Internal typed read: resolve mapping, build Message Router bytes, send via
   * the transport, parse the CIP reply and decode the exact typed value.
   */
  async _readMapped(symbolicName) {
    this._requireConnected(false);
    const mapping = this._resolveOrThrow(symbolicName, 'read');
    this._requireVerifiedIdentity();
    const request = buildMessageRouterRequest(mapping, []);
    const replyBytes = await this._session.sendExplicit({ cipRequest: request });
    const reply = parseCipReply(replyBytes);
    if (reply.generalStatus !== 0) {
      const err = new Error(
        `Read of "${symbolicName}" returned CIP status 0x${reply.generalStatus.toString(16).toUpperCase()}`,
      );
      err.code = 'cip_error';
      err.generalStatus = reply.generalStatus;
      err.additionalStatus = reply.additionalStatus;
      throw err;
    }
    return decodeCipReply(mapping.codec, reply);
  }

  /** Internal typed write: resolve mapping, encode value, send, verify status. */
  async _writeMapped(symbolicName, value) {
    this._requireConnected(false);
    const mapping = this._resolveOrThrow(symbolicName, 'write');
    this._requireVerifiedIdentity();
    const data = encodeValue(mapping.codec, value);
    const request = buildMessageRouterRequest(mapping, data);
    const replyBytes = await this._session.sendExplicit({ cipRequest: request });
    const reply = parseCipReply(replyBytes);
    if (reply.generalStatus !== 0) {
      const err = new Error(
        `Write of "${symbolicName}" returned CIP status 0x${reply.generalStatus.toString(16).toUpperCase()}`,
      );
      err.code = 'cip_error';
      err.generalStatus = reply.generalStatus;
      err.additionalStatus = reply.additionalStatus;
      throw err;
    }
    return true;
  }

  // --- Narrow symbolic API --------------------------------------------------

  /** Read one symbolic field. Fails closed if the mapping is unresolved. */
  async readField(symbolicName) {
    if (typeof symbolicName !== 'string' || symbolicName.length === 0) {
      throw new Error('readField requires a symbolic field name');
    }
    const value = await this._readMapped(symbolicName);
    return { symbolicName, value };
  }

  /**
   * Arm control: requires connection, requires the enable workflow to be fully
   * resolved, then requires an explicit native confirmation callback. On
   * success a short-lived, single-use main-owned token is minted.
   */
  async armControl() {
    this._requireConnected();
    if (!this._readiness.enable.ready) {
      const err = new Error('Control is not available until the profile enable mapping is resolved');
      err.code = 'enable_unresolved';
      err.issues = this._readiness.enable.issues;
      throw err;
    }
    const confirmed = await this._confirmArm();
    if (confirmed !== true) {
      this._clearArm();
      return { armed: false };
    }
    const token = `arm-${this._now()}-${Math.floor(Math.random() * 1e9)}`;
    this._arm = { token, expiresAt: this._now() + ARM_TOKEN_TTL_MS };
    return { armed: true, expiresAt: this._arm.expiresAt };
  }

  _consumeArmToken() {
    const arm = this._arm;
    this._arm = null; // one-shot: consumed regardless of validity
    if (!arm) {
      const err = new Error('Control is not armed');
      err.code = 'not_armed';
      throw err;
    }
    if (this._now() > arm.expiresAt) {
      const err = new Error('Arm token has expired');
      err.code = 'arm_expired';
      throw err;
    }
    return arm;
  }

  /** Fresh main-owned preflight: read all enable-guard fields. */
  async _preflightEnable() {
    const ready = await this._readMapped(FIELD_READY);
    const faulted = await this._readMapped(FIELD_FAULTED);
    const outputActive = await this._readMapped(FIELD_OUTPUT_ACTIVE);

    const problems = [];
    if (ready !== true) problems.push('Ready is not true');
    if (faulted !== false) problems.push('Faulted is not false');
    if (outputActive !== false) problems.push('EmissionControlOutputActive is not false');

    // Safety-capability feedback: only checked when enabled in the profile.
    for (const symbol of [FIELD_INTERLOCK, FIELD_REMOTE_STOP]) {
      const field = findField(this._profile, symbol);
      if (!field || !field.capability) continue;
      const capability = this._profile.capabilities && this._profile.capabilities[field.capability];
      if (capability && capability.enabled) {
        const ok = await this._readMapped(symbol);
        if (ok !== true) problems.push(`${symbol} is not true`);
      }
    }

    if (problems.length > 0) {
      const err = new Error(`Preflight failed: ${problems.join('; ')}`);
      err.code = 'preflight_failed';
      err.problems = problems;
      throw err;
    }
  }

  /**
   * Guarded emission-enable request.
   *
   * enable=true: requires connection, a valid one-shot arm token, and a fresh
   *   preflight (Ready=true, Faulted=false, OutputActive=false, plus enabled
   *   safety fields). Then writes EmissionEnableRequest=true and reads back
   *   EmissionControlOutputActive. Never retries, never auto-enables.
   *
   * enable=false: may bypass arm/preflight when connected and the mapping is
   *   resolved. Writes EmissionEnableRequest=false and reads back
   *   EmissionControlOutputActive.
   */
  async writeEnable(enable) {
    if (typeof enable !== 'boolean') {
      throw new Error('writeEnable requires a boolean');
    }
    this._requireConnected();
    if (!this._readiness.enable.ready) {
      const err = new Error('Emission control mapping is unresolved');
      err.code = 'enable_unresolved';
      err.issues = this._readiness.enable.issues;
      throw err;
    }

    if (enable) {
      // Consume the one-shot token first (clears it even on failure).
      this._consumeArmToken();
      // Fresh main-owned preflight read.
      await this._preflightEnable();
      // Encode + write the request exactly once.
      await this._writeMapped(FIELD_ENABLE_REQUEST, true);
    } else {
      // Disable is permitted without arm/preflight when connected + resolved.
      this._clearArm();
      await this._writeMapped(FIELD_ENABLE_REQUEST, false);
    }

    // Readback of the hardware-control output (never inferred).
    const outputActive = await this._readMapped(FIELD_OUTPUT_ACTIVE);
    return { requested: enable, outputActive };
  }
}

module.exports = { HardwareService, ARM_TOKEN_TTL_MS };
