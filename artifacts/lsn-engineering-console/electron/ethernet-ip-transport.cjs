'use strict';

/**
 * EtherNet/IP transport for the LSN Engineering Console main process.
 *
 * This module implements only *standard* EtherNet/IP encapsulation:
 *   - UDP ListIdentity (0x0063) discovery on the fixed port 44818
 *   - TCP RegisterSession (0x0065) / UnRegisterSession (0x0066)
 *   - Generic unconnected explicit CIP via SendRRData (0x006F)
 *
 * It deliberately contains NO device-profile mapping, NO CIP object/class/
 * instance/attribute assumptions, and NO value encoding. Higher layers must
 * supply a fully-formed CIP request payload; this module only frames it.
 *
 * The module is dependency-injectable (udpFactory / tcpFactory) so it can be
 * unit-tested against local fake endpoints without Electron or real hardware.
 */

const dgram = require('node:dgram');
const netModule = require('node:net');

// --- Protocol constants ----------------------------------------------------

const ENIP_PORT = 44818;
const ENCAP_HEADER_LENGTH = 24;

const COMMAND_LIST_IDENTITY = 0x0063;
const COMMAND_REGISTER_SESSION = 0x0065;
const COMMAND_UNREGISTER_SESSION = 0x0066;
const COMMAND_SEND_RR_DATA = 0x006f;

const STATUS_SUCCESS = 0x0000;

// Common Packet Format (CPF) item type IDs.
const CPF_ITEM_NULL_ADDRESS = 0x0000;
const CPF_ITEM_UNCONNECTED_DATA = 0x00b2;
const CPF_ITEM_IDENTITY = 0x000c;

// Bounds. These are intentionally strict; EtherNet/IP encapsulation length is a
// 16-bit field, but real ListIdentity / RegisterSession / SendRRData frames are
// tiny. We refuse anything unreasonable to keep parsing memory-safe.
const MAX_ENCAP_DATA_LENGTH = 0xffff;
const MAX_DISCOVERY_RESPONSE_BYTES = 1024;
const MAX_TCP_RESPONSE_BYTES = 64 * 1024;
const MAX_CIP_REQUEST_BYTES = 504; // conservative unconnected message body cap
const MAX_CIP_PATH_BYTES = 128;
const MAX_DISCOVERY_CANDIDATES = 256;

const DEFAULT_DISCOVERY_TIMEOUT_MS = 2000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

// RegisterSession fixed body: protocol version 1, options 0.
const REGISTER_SESSION_PROTOCOL_VERSION = 0x0001;
const REGISTER_SESSION_OPTIONS = 0x0000;

// --- IPv4 validation -------------------------------------------------------

const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Strict dotted-quad IPv4 check; rejects everything else (no hostnames). */
function isValidIpv4(address) {
  return typeof address === 'string' && IPV4_PATTERN.test(address);
}

function assertValidIpv4(address) {
  if (!isValidIpv4(address)) {
    throw new Error('Invalid IPv4 address');
  }
  return address;
}

// --- Encapsulation header --------------------------------------------------

/**
 * Build a 24-byte EtherNet/IP encapsulation header followed by the command
 * data. Validates every field so we never emit a malformed frame.
 */
function buildEncapsulation({
  command,
  sessionHandle = 0,
  status = 0,
  senderContext,
  options = 0,
  data,
}) {
  if (!Number.isInteger(command) || command < 0 || command > 0xffff) {
    throw new Error('Invalid encapsulation command');
  }
  if (
    !Number.isInteger(sessionHandle) ||
    sessionHandle < 0 ||
    sessionHandle > 0xffffffff
  ) {
    throw new Error('Invalid session handle');
  }
  if (!Number.isInteger(status) || status < 0 || status > 0xffffffff) {
    throw new Error('Invalid encapsulation status');
  }
  if (!Number.isInteger(options) || options < 0 || options > 0xffffffff) {
    throw new Error('Invalid encapsulation options');
  }
  const body = data ? Buffer.from(data) : Buffer.alloc(0);
  if (body.length > MAX_ENCAP_DATA_LENGTH) {
    throw new Error('Encapsulation data exceeds bounds');
  }
  let context = Buffer.alloc(8);
  if (senderContext !== undefined) {
    const provided = Buffer.from(senderContext);
    if (provided.length !== 8) {
      throw new Error('Sender context must be 8 bytes');
    }
    context = provided;
  }

  const header = Buffer.alloc(ENCAP_HEADER_LENGTH);
  header.writeUInt16LE(command, 0);
  header.writeUInt16LE(body.length, 2);
  header.writeUInt32LE(sessionHandle, 4);
  header.writeUInt32LE(status, 8);
  context.copy(header, 12);
  header.writeUInt32LE(options, 20);

  return Buffer.concat([header, body]);
}

/**
 * Parse and validate a 24-byte encapsulation header + data. Throws on any
 * inconsistency (short buffer, length mismatch, oversized data).
 */
function parseEncapsulation(buffer, { maxDataLength = MAX_ENCAP_DATA_LENGTH } = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Encapsulation frame must be a Buffer');
  }
  if (buffer.length < ENCAP_HEADER_LENGTH) {
    throw new Error('Encapsulation frame shorter than header');
  }
  const command = buffer.readUInt16LE(0);
  const dataLength = buffer.readUInt16LE(2);
  const sessionHandle = buffer.readUInt32LE(4);
  const status = buffer.readUInt32LE(8);
  const senderContext = buffer.subarray(12, 20);
  const options = buffer.readUInt32LE(20);

  if (dataLength > maxDataLength) {
    throw new Error('Encapsulation data length exceeds bounds');
  }
  if (buffer.length !== ENCAP_HEADER_LENGTH + dataLength) {
    throw new Error('Encapsulation data length mismatch');
  }

  return {
    command,
    dataLength,
    sessionHandle,
    status,
    senderContext: Buffer.from(senderContext),
    options,
    data: Buffer.from(buffer.subarray(ENCAP_HEADER_LENGTH)),
  };
}

// --- ListIdentity discovery ------------------------------------------------

/** Build the outgoing ListIdentity request (header only, no data). */
function buildListIdentityRequest() {
  return buildEncapsulation({ command: COMMAND_LIST_IDENTITY });
}

/**
 * Parse a ListIdentity response and extract the Identity Item (0x000C).
 * Returns a plain identity object, or throws if the frame is malformed.
 *
 * We only decode standard Identity Object fields; we never interpret them as
 * profile-specific values.
 */
function parseListIdentityResponse(buffer) {
  const frame = parseEncapsulation(buffer, {
    maxDataLength: MAX_DISCOVERY_RESPONSE_BYTES,
  });
  if (frame.command !== COMMAND_LIST_IDENTITY) {
    throw new Error('Response is not ListIdentity');
  }
  if (frame.status !== STATUS_SUCCESS) {
    throw new Error('ListIdentity reported non-success status');
  }
  const data = frame.data;
  if (data.length < 2) {
    throw new Error('ListIdentity missing item count');
  }
  const itemCount = data.readUInt16LE(0);
  if (itemCount < 1) {
    throw new Error('ListIdentity contains no items');
  }
  let offset = 2;
  if (offset + 4 > data.length) {
    throw new Error('ListIdentity truncated before item header');
  }
  const itemType = data.readUInt16LE(offset);
  const itemLength = data.readUInt16LE(offset + 2);
  offset += 4;
  if (itemType !== CPF_ITEM_IDENTITY) {
    throw new Error('ListIdentity first item is not an Identity Item');
  }
  if (itemLength < 2 || offset + itemLength > data.length) {
    throw new Error('Identity Item length out of bounds');
  }
  const item = data.subarray(offset, offset + itemLength);

  // Identity Item layout (standard EtherNet/IP):
  //   uint16 encapProtocolVersion
  //   sockaddr_in (16 bytes, big-endian): sin_family, sin_port, sin_addr, zero
  //   uint16 vendorId
  //   uint16 deviceType
  //   uint16 productCode
  //   uint8  revisionMajor, revisionMinor
  //   uint16 status
  //   uint32 serialNumber
  //   uint8  productNameLength + productName
  //   uint8  state
  let p = 0;
  const need = (n) => {
    if (p + n > item.length) {
      throw new Error('Identity Item truncated');
    }
  };
  need(2);
  const encapProtocolVersion = item.readUInt16LE(p);
  p += 2;
  need(16);
  const sockaddr = item.subarray(p, p + 16);
  const sinPort = sockaddr.readUInt16BE(2);
  const socketAddress = `${sockaddr[4]}.${sockaddr[5]}.${sockaddr[6]}.${sockaddr[7]}`;
  p += 16;
  need(2);
  const vendorId = item.readUInt16LE(p);
  p += 2;
  need(2);
  const deviceType = item.readUInt16LE(p);
  p += 2;
  need(2);
  const productCode = item.readUInt16LE(p);
  p += 2;
  need(2);
  const revisionMajor = item.readUInt8(p);
  const revisionMinor = item.readUInt8(p + 1);
  p += 2;
  need(2);
  const deviceStatus = item.readUInt16LE(p);
  p += 2;
  need(4);
  const serialNumber = item.readUInt32LE(p);
  p += 4;
  need(1);
  const nameLength = item.readUInt8(p);
  p += 1;
  need(nameLength);
  const productName = item
    .subarray(p, p + nameLength)
    .toString('latin1')
    .replace(/\0+$/, '');
  p += nameLength;
  let state = null;
  if (p < item.length) {
    state = item.readUInt8(p);
  }

  return {
    encapProtocolVersion,
    socketAddress,
    socketPort: sinPort,
    vendorId,
    deviceType,
    productCode,
    revision: `${revisionMajor}.${revisionMinor}`,
    status: deviceStatus,
    serialNumber,
    productName,
    state,
  };
}

/**
 * Perform a bounded UDP ListIdentity discovery.
 *
 * @param {object} options
 * @param {string} [options.address]  Manual IPv4 probe target. When provided,
 *   the request is unicast to that address; otherwise it is broadcast.
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.udpFactory]  Injectable dgram.createSocket.
 * @returns {Promise<Array>} unique identity candidates
 */
function discoverIdentities({
  address,
  timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
  signal,
  udpFactory = (type) => dgram.createSocket(type),
} = {}) {
  if (address !== undefined && !isValidIpv4(address)) {
    return Promise.reject(new Error('Invalid IPv4 address'));
  }
  if (signal && signal.aborted) {
    return Promise.reject(new Error('Discovery aborted'));
  }

  return new Promise((resolve, reject) => {
    const socket = udpFactory('udp4');
    const candidates = new Map();
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        socket.close();
      } catch {
        // socket already closed
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Array.from(candidates.values()));
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => fail(new Error('Discovery aborted'));

    socket.on('error', (error) => fail(error));

    socket.on('message', (message, rinfo) => {
      if (settled) return;
      if (!message || message.length > MAX_DISCOVERY_RESPONSE_BYTES) return;
      let identity;
      try {
        identity = parseListIdentityResponse(message);
      } catch {
        // Reject malformed packets silently; do not abort the whole scan.
        return;
      }
      const source = rinfo && isValidIpv4(rinfo.address) ? rinfo.address : null;
      const key = source || identity.socketAddress || `serial:${identity.serialNumber}`;
      if (!candidates.has(key) && candidates.size < MAX_DISCOVERY_CANDIDATES) {
        candidates.set(key, { ...identity, sourceAddress: source });
      }
    });

    const send = () => {
      const request = buildListIdentityRequest();
      const target = address || '255.255.255.255';
      socket.send(request, ENIP_PORT, target, (error) => {
        if (error) fail(error);
      });
    };

    socket.on('listening', () => {
      try {
        if (!address) socket.setBroadcast(true);
        send();
      } catch (error) {
        fail(error);
      }
    });

    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      socket.bind();
    } catch (error) {
      fail(error);
    }
  });
}

// --- RegisterSession body ---------------------------------------------------

function buildRegisterSessionRequest() {
  const body = Buffer.alloc(4);
  body.writeUInt16LE(REGISTER_SESSION_PROTOCOL_VERSION, 0);
  body.writeUInt16LE(REGISTER_SESSION_OPTIONS, 2);
  return buildEncapsulation({ command: COMMAND_REGISTER_SESSION, data: body });
}

function parseRegisterSessionResponse(buffer) {
  const frame = parseEncapsulation(buffer, { maxDataLength: 64 });
  if (frame.command !== COMMAND_REGISTER_SESSION) {
    throw new Error('Response is not RegisterSession');
  }
  if (frame.status !== STATUS_SUCCESS) {
    throw new Error('RegisterSession reported non-success status');
  }
  if (frame.data.length < 4) {
    throw new Error('RegisterSession response too short');
  }
  const protocolVersion = frame.data.readUInt16LE(0);
  if (protocolVersion !== REGISTER_SESSION_PROTOCOL_VERSION) {
    throw new Error('Unexpected RegisterSession protocol version');
  }
  if (frame.sessionHandle === 0) {
    throw new Error('RegisterSession returned a zero session handle');
  }
  return { sessionHandle: frame.sessionHandle, protocolVersion };
}

function buildUnRegisterSessionRequest(sessionHandle) {
  return buildEncapsulation({
    command: COMMAND_UNREGISTER_SESSION,
    sessionHandle,
  });
}

// --- SendRRData (unconnected explicit CIP) ---------------------------------

/**
 * Frame a generic unconnected explicit CIP request in a SendRRData command.
 *
 * The caller supplies the raw CIP Message Router request bytes (service +
 * request path + request data) as `cipRequest`. This function performs NO
 * interpretation of that payload; it only enforces size limits and wraps it in
 * the standard CPF (Null Address Item + Unconnected Data Item).
 *
 * @param {object} options
 * @param {number} options.sessionHandle
 * @param {Buffer|Uint8Array} options.cipRequest  Raw CIP request bytes.
 * @param {number} [options.timeoutTicks]  Interface timeout (seconds field).
 */
function buildSendRRDataRequest({ sessionHandle, cipRequest, timeoutTicks = 5 }) {
  if (
    !Number.isInteger(sessionHandle) ||
    sessionHandle <= 0 ||
    sessionHandle > 0xffffffff
  ) {
    throw new Error('SendRRData requires a valid session handle');
  }
  const cip = Buffer.from(cipRequest || []);
  if (cip.length === 0) {
    throw new Error('SendRRData requires a non-empty CIP request');
  }
  if (cip.length > MAX_CIP_REQUEST_BYTES) {
    throw new Error('CIP request exceeds size limit');
  }
  if (!Number.isInteger(timeoutTicks) || timeoutTicks < 0 || timeoutTicks > 0xffff) {
    throw new Error('Invalid interface timeout');
  }

  // SendRRData command data:
  //   uint32 interfaceHandle (0 = CIP)
  //   uint16 timeout (seconds)
  //   CPF: uint16 itemCount = 2
  //     Null Address Item: type 0x0000, length 0
  //     Unconnected Data Item: type 0x00B2, length = cip.length, data = cip
  const head = Buffer.alloc(6 + 2 + 4 + 4);
  let o = 0;
  head.writeUInt32LE(0, o); // interface handle (CIP)
  o += 4;
  head.writeUInt16LE(timeoutTicks, o);
  o += 2;
  head.writeUInt16LE(2, o); // item count
  o += 2;
  head.writeUInt16LE(CPF_ITEM_NULL_ADDRESS, o);
  o += 2;
  head.writeUInt16LE(0, o); // null address length
  o += 2;
  head.writeUInt16LE(CPF_ITEM_UNCONNECTED_DATA, o);
  o += 2;
  head.writeUInt16LE(cip.length, o);
  o += 2;

  const body = Buffer.concat([head, cip]);
  return buildEncapsulation({
    command: COMMAND_SEND_RR_DATA,
    sessionHandle,
    data: body,
  });
}

/**
 * Parse a SendRRData response and return the raw CIP reply bytes from the
 * Unconnected Data Item. No CIP interpretation is performed.
 */
function parseSendRRDataResponse(buffer, expectedSessionHandle) {
  const frame = parseEncapsulation(buffer, { maxDataLength: MAX_TCP_RESPONSE_BYTES });
  if (frame.command !== COMMAND_SEND_RR_DATA) {
    throw new Error('Response is not SendRRData');
  }
  if (frame.status !== STATUS_SUCCESS) {
    throw new Error('SendRRData reported non-success status');
  }
  if (
    expectedSessionHandle !== undefined &&
    frame.sessionHandle !== expectedSessionHandle
  ) {
    throw new Error('SendRRData session handle mismatch');
  }
  const data = frame.data;
  if (data.length < 6 + 2) {
    throw new Error('SendRRData response too short');
  }
  let o = 4; // skip interface handle
  o += 2; // skip timeout
  const itemCount = data.readUInt16LE(o);
  o += 2;
  if (itemCount < 2) {
    throw new Error('SendRRData response missing CPF items');
  }
  // Address item (expected null).
  if (o + 4 > data.length) throw new Error('SendRRData address item truncated');
  o += 2; // address item type
  const addrLen = data.readUInt16LE(o);
  o += 2;
  o += addrLen;
  // Data item.
  if (o + 4 > data.length) throw new Error('SendRRData data item truncated');
  const dataType = data.readUInt16LE(o);
  o += 2;
  const dataLen = data.readUInt16LE(o);
  o += 2;
  if (dataType !== CPF_ITEM_UNCONNECTED_DATA) {
    throw new Error('SendRRData data item is not unconnected data');
  }
  if (o + dataLen > data.length) {
    throw new Error('SendRRData data item length out of bounds');
  }
  return Buffer.from(data.subarray(o, o + dataLen));
}

/**
 * Validate a caller-supplied explicit request descriptor without interpreting
 * profile semantics. Ensures the CIP payload and any embedded path stay within
 * strict bounds. Returns the normalized CIP request Buffer.
 */
function validateExplicitRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new Error('Explicit request must be an object');
  }
  const { cipRequest, path } = request;
  if (path !== undefined) {
    const pathBuf = Buffer.from(path);
    if (pathBuf.length > MAX_CIP_PATH_BYTES) {
      throw new Error('CIP path exceeds size limit');
    }
  }
  if (cipRequest === undefined || cipRequest === null) {
    throw new Error('Explicit request requires cipRequest bytes');
  }
  let cip;
  try {
    cip = Buffer.from(cipRequest);
  } catch {
    throw new Error('cipRequest must be byte-like');
  }
  if (cip.length === 0) {
    throw new Error('cipRequest must be non-empty');
  }
  if (cip.length > MAX_CIP_REQUEST_BYTES) {
    throw new Error('cipRequest exceeds size limit');
  }
  return cip;
}

// --- Session (TCP) transport -----------------------------------------------

const STATE_DISCONNECTED = 'disconnected';
const STATE_CONNECTING = 'connecting';
const STATE_CONNECTED = 'connected';

/**
 * Bounded TCP EtherNet/IP session: connect, RegisterSession, SendRRData,
 * UnRegisterSession, disconnect. Handles socket close/error/timeout so the
 * connected state is never stale.
 */
class EnipSession {
  constructor({
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    tcpFactory = () => new netModule.Socket(),
    identityDiscover = discoverIdentities,
    onStateChange = null,
  } = {}) {
    this._connectTimeoutMs = connectTimeoutMs;
    this._requestTimeoutMs = requestTimeoutMs;
    this._tcpFactory = tcpFactory;
    this._identityDiscover = identityDiscover;
    // Optional sanitized state-change callback. Fires once per ACTUAL state
    // transition (including asynchronous socket close/error/request timeout),
    // so a consumer is never left with a stale connected view.
    this._onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
    this._socket = null;
    this._state = STATE_DISCONNECTED;
    this._sessionHandle = 0;
    this._address = null;
    this._identity = null;
    this._pending = null; // { resolve, reject, buffer, timer }
  }

  getState() {
    return {
      state: this._state,
      connected: this._state === STATE_CONNECTED,
      address: this._address,
      sessionHandle: this._sessionHandle || null,
      identity: this._identity ? { ...this._identity } : null,
    };
  }

  isConnected() {
    return this._state === STATE_CONNECTED && this._sessionHandle !== 0;
  }

  /**
   * Transition to a new state. Emits the sanitized state exactly once per real
   * change; identical states never re-broadcast (no duplicate/false events).
   */
  _setState(nextState) {
    if (this._state === nextState) return;
    this._state = nextState;
    if (this._onStateChange) {
      try {
        this._onStateChange(this.getState());
      } catch {
        // A misbehaving listener must never break transport teardown.
      }
    }
  }

  _resetToDisconnected(error) {
    const wasDisconnected = this._state === STATE_DISCONNECTED;
    // Clear session identity first so the broadcast reflects a clean state.
    this._sessionHandle = 0;
    this._address = null;
    this._identity = null;
    if (this._pending) {
      const pending = this._pending;
      this._pending = null;
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error || new Error('Session closed'));
    }
    if (this._socket) {
      const socket = this._socket;
      this._socket = null;
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        // already destroyed
      }
    }
    // Emit the disconnected transition after identity/socket are torn down.
    if (!wasDisconnected) {
      this._setState(STATE_DISCONNECTED);
    }
  }

  _attachSocketHandlers(socket) {
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (error) => this._resetToDisconnected(error));
    socket.on('close', () => {
      if (this._state !== STATE_DISCONNECTED) {
        this._resetToDisconnected(new Error('Socket closed'));
      }
    });
  }

  _onData(chunk) {
    if (!this._pending) return;
    this._pending.buffer = Buffer.concat([this._pending.buffer, chunk]);
    const buffer = this._pending.buffer;
    if (buffer.length < ENCAP_HEADER_LENGTH) return;
    const declared = buffer.readUInt16LE(2);
    const total = ENCAP_HEADER_LENGTH + declared;
    if (declared > MAX_TCP_RESPONSE_BYTES) {
      this._resetToDisconnected(new Error('TCP response exceeds bounds'));
      return;
    }
    if (buffer.length < total) return; // await more bytes
    const frame = buffer.subarray(0, total);
    const pending = this._pending;
    this._pending = null;
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(Buffer.from(frame));
  }

  _sendAndReceive(request) {
    if (!this._socket) {
      return Promise.reject(new Error('Session socket is not open'));
    }
    if (this._pending) {
      return Promise.reject(new Error('A request is already in flight'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending) {
          this._pending = null;
          this._resetToDisconnected(new Error('Request timed out'));
        }
        reject(new Error('Request timed out'));
      }, this._requestTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this._pending = { resolve, reject, buffer: Buffer.alloc(0), timer };
      this._socket.write(request, (error) => {
        if (error && this._pending) {
          this._pending = null;
          clearTimeout(timer);
          this._resetToDisconnected(error);
          reject(error);
        }
      });
    });
  }

  async connect(address) {
    assertValidIpv4(address);
    if (this._state !== STATE_DISCONNECTED) {
      throw new Error('Session already connected or connecting');
    }
    this._setState(STATE_CONNECTING);
    let identity;
    try {
      const candidates = await this._identityDiscover({ address });
      identity = candidates.find(
        (candidate) =>
          candidate &&
          (candidate.sourceAddress === address || candidate.socketAddress === address),
      );
      if (!identity) {
        throw new Error('No ListIdentity response received from the requested endpoint');
      }
    } catch (error) {
      this._resetToDisconnected(error);
      throw error;
    }
    const socket = this._tcpFactory();
    this._socket = socket;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._resetToDisconnected(new Error('Connection timed out'));
        reject(new Error('Connection timed out'));
      }, this._connectTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      const onError = (error) => {
        clearTimeout(timer);
        this._resetToDisconnected(error);
        reject(error);
      };
      socket.once('error', onError);
      socket.connect(ENIP_PORT, address, () => {
        clearTimeout(timer);
        socket.removeListener('error', onError);
        resolve();
      });
    });

    this._attachSocketHandlers(socket);

    // RegisterSession
    let response;
    try {
      response = await this._sendAndReceive(buildRegisterSessionRequest());
    } catch (error) {
      this._resetToDisconnected(error);
      throw error;
    }
    let parsed;
    try {
      parsed = parseRegisterSessionResponse(response);
    } catch (error) {
      this._resetToDisconnected(error);
      throw error;
    }
    // Populate identity before broadcasting so the connected event is complete.
    this._sessionHandle = parsed.sessionHandle;
    this._address = address;
    this._identity = { ...identity };
    this._setState(STATE_CONNECTED);
    return this.getState();
  }

  /**
   * Send a validated unconnected explicit CIP request. Only permitted while
   * connected. Returns the raw CIP reply bytes.
   */
  async sendExplicit(request) {
    if (!this.isConnected()) {
      throw new Error('Session is not connected');
    }
    const cip = validateExplicitRequest(request);
    const frame = buildSendRRDataRequest({
      sessionHandle: this._sessionHandle,
      cipRequest: cip,
    });
    const response = await this._sendAndReceive(frame);
    return parseSendRRDataResponse(response, this._sessionHandle);
  }

  async disconnect() {
    if (this._state === STATE_DISCONNECTED) return;
    const handle = this._sessionHandle;
    const socket = this._socket;
    // Best-effort clean UnRegisterSession; ignore failures.
    if (socket && handle) {
      try {
        socket.write(buildUnRegisterSessionRequest(handle));
      } catch {
        // ignore write failures during teardown
      }
    }
    this._resetToDisconnected(new Error('Disconnected by caller'));
    // resetToDisconnected rejects any pending with an error; swallow to keep
    // disconnect() a resolved teardown.
  }
}

module.exports = {
  ENIP_PORT,
  ENCAP_HEADER_LENGTH,
  COMMAND_LIST_IDENTITY,
  COMMAND_REGISTER_SESSION,
  COMMAND_UNREGISTER_SESSION,
  COMMAND_SEND_RR_DATA,
  CPF_ITEM_IDENTITY,
  CPF_ITEM_UNCONNECTED_DATA,
  MAX_CIP_REQUEST_BYTES,
  MAX_CIP_PATH_BYTES,
  EnipSession,
  isValidIpv4,
  assertValidIpv4,
  buildEncapsulation,
  parseEncapsulation,
  buildListIdentityRequest,
  parseListIdentityResponse,
  discoverIdentities,
  buildRegisterSessionRequest,
  parseRegisterSessionResponse,
  buildUnRegisterSessionRequest,
  buildSendRRDataRequest,
  parseSendRRDataResponse,
  validateExplicitRequest,
};
