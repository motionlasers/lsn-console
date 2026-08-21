'use strict';

/**
 * Main-process profile operation layer.
 *
 * This is the authoritative, renderer-inaccessible boundary that maps LSN
 * *symbolic* fields to CIP explicit-messaging operations. The renderer never
 * supplies a CIP service, EPATH, raw bytes, or an arbitrary profile document.
 *
 * The module loads the bundled profiles/lsn-v0.1.json itself, validates and
 * deep-freezes it, and pins a digest so the service/session use one fixed
 * profile. It re-implements the same resolution/codec semantics as
 * src/lib/hardware-profile.ts for the supported wire types:
 *   bool8, uint16, uint32, uint64, fixed UTF-8 string, explicit enum.
 *
 * The current lsn-v0.1 profile has every mapping at "TBD", so every field
 * fails closed with precise blocking issues — nothing is ever invented.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// --- CIP service constants (mirror hardware-profile.ts) --------------------

const CIP_SERVICE_GET_ATTRIBUTE_SINGLE = 0x0e;
const CIP_SERVICE_SET_ATTRIBUTE_SINGLE = 0x10;

const GET_ATTRIBUTE_SINGLE_ALIASES = new Set([
  'getattributesingle',
  'get_attribute_single',
  'get attribute single',
]);
const SET_ATTRIBUTE_SINGLE_ALIASES = new Set([
  'setattributesingle',
  'set_attribute_single',
  'set attribute single',
]);

const LOGICAL_SEGMENT_CLASS = 0x20;
const LOGICAL_SEGMENT_INSTANCE = 0x24;
const LOGICAL_SEGMENT_ATTRIBUTE = 0x30;

const SCALAR_BYTE_LENGTHS = { bool8: 1, uint16: 2, uint32: 4, uint64: 8 };

const RESOLVABLE_IMPLEMENTATION_STATUSES = new Set(['IMPLEMENTED', 'VERIFIED']);
const RESOLVED_IDENTITY_STATES = new Set(['IMPLEMENTED', 'VERIFIED']);

// --- Small helpers ---------------------------------------------------------

function isTbd(value) {
  return (
    value == null ||
    (typeof value === 'string' && value.trim().toUpperCase() === 'TBD')
  );
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function deepFreeze(object) {
  if (object && typeof object === 'object' && !Object.isFrozen(object)) {
    for (const key of Object.keys(object)) deepFreeze(object[key]);
    Object.freeze(object);
  }
  return object;
}

function resolveExpectedIdentity(doc) {
  const identity = doc && doc.identity;
  const issues = [];
  const push = (code, message) =>
    issues.push({ symbolicName: 'Identity', severity: 'blocking', code, message });
  if (!identity || typeof identity !== 'object') {
    push('identity_missing', 'Expected device identity is missing from the profile');
    return { issues };
  }
  if (!RESOLVED_IDENTITY_STATES.has(identity.mappingState)) {
    push('identity_unresolved', `Identity mapping state "${String(identity.mappingState)}" is not IMPLEMENTED/VERIFIED`);
  }
  for (const key of ['vendorId', 'deviceType', 'productCode']) {
    if (!Number.isSafeInteger(identity[key]) || identity[key] < 0 || identity[key] > 0xffff) {
      push(`${key}_unresolved`, `Expected identity ${key} is not a resolved 16-bit value`);
    }
  }
  if (issues.length > 0) return { issues };
  return {
    identity: {
      vendorId: identity.vendorId,
      deviceType: identity.deviceType,
      productCode: identity.productCode,
    },
  };
}

// --- CIP service parsing ----------------------------------------------------

function parseCipService(value) {
  if (isTbd(value)) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= 0xff ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.toLowerCase();
  if (GET_ATTRIBUTE_SINGLE_ALIASES.has(normalized)) {
    return CIP_SERVICE_GET_ATTRIBUTE_SINGLE;
  }
  if (SET_ATTRIBUTE_SINGLE_ALIASES.has(normalized)) {
    return CIP_SERVICE_SET_ATTRIBUTE_SINGLE;
  }
  let parsed = null;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    parsed = Number.parseInt(trimmed.slice(2), 16);
  } else if (/^\d+$/.test(trimmed)) {
    parsed = Number.parseInt(trimmed, 10);
  }
  if (parsed == null || Number.isNaN(parsed)) return null;
  if (parsed < 0 || parsed > 0xff) return null;
  return parsed;
}

function serviceKindForCode(code) {
  if (code === CIP_SERVICE_GET_ATTRIBUTE_SINGLE) return 'read';
  if (code === CIP_SERVICE_SET_ATTRIBUTE_SINGLE) return 'write';
  return null;
}

function expectedServiceKind(field) {
  if (field.access === 'READ') return 'read';
  if (field.access === 'WRITE') return 'write';
  return 'both';
}

// --- EPATH -----------------------------------------------------------------

function encodeLogicalSegment(baseType, value) {
  if (!isNonNegativeInteger(value)) {
    throw new RangeError(`Logical segment value must be a non-negative integer, received ${value}`);
  }
  if (value <= 0xff) {
    return [baseType | 0x00, value & 0xff];
  }
  if (value <= 0xffff) {
    return [baseType | 0x01, 0x00, value & 0xff, (value >> 8) & 0xff];
  }
  throw new RangeError(`Logical segment value ${value} exceeds 16-bit range`);
}

function buildEpath(classId, instanceId, attributeId) {
  const bytes = [
    ...encodeLogicalSegment(LOGICAL_SEGMENT_CLASS, classId),
    ...encodeLogicalSegment(LOGICAL_SEGMENT_INSTANCE, instanceId),
    ...encodeLogicalSegment(LOGICAL_SEGMENT_ATTRIBUTE, attributeId),
  ];
  if (bytes.length % 2 !== 0) bytes.push(0x00);
  return Uint8Array.from(bytes);
}

// --- Wire codec resolution --------------------------------------------------

function resolveWireCodec(field) {
  const wireType = field.wireType;
  if (isTbd(wireType)) {
    return { error: 'wire encoding (wireType) is not assigned in the profile' };
  }
  switch (wireType) {
    case 'bool8':
      return { codec: { kind: 'scalar', wireType: 'bool8', byteOrder: 'little', byteLength: 1 } };
    case 'uint16':
    case 'uint32':
    case 'uint64': {
      if (isTbd(field.byteOrder)) {
        return { error: `byteOrder is required for ${wireType} but is not assigned` };
      }
      if (field.byteOrder !== 'little' && field.byteOrder !== 'big') {
        return { error: `byteOrder "${String(field.byteOrder)}" is invalid` };
      }
      return {
        codec: {
          kind: 'scalar',
          wireType,
          byteOrder: field.byteOrder,
          byteLength: SCALAR_BYTE_LENGTHS[wireType],
        },
      };
    }
    case 'string': {
      if (!isNonNegativeInteger(field.stringLength) || field.stringLength === 0) {
        return { error: 'stringLength (fixed byte length) is required for string but is not assigned' };
      }
      return { codec: { kind: 'string', wireType: 'string', byteLength: field.stringLength } };
    }
    case 'enum': {
      const mapping = field.enumMapping;
      if (mapping == null || typeof mapping !== 'object' || Array.isArray(mapping)) {
        return { error: 'enumMapping (explicit symbol->code) is required for enum but is not assigned' };
      }
      const entries = Object.entries(mapping);
      if (entries.length === 0) {
        return { error: 'enumMapping is empty; explicit numeric codes are required' };
      }
      const width = field.enumWidth ?? 2;
      if (![1, 2, 4].includes(width)) {
        return { error: `enumWidth ${String(width)} is invalid (expected 1, 2, or 4)` };
      }
      if (width > 1 && isTbd(field.byteOrder)) {
        return { error: `byteOrder is required for a ${width}-byte enum but is not assigned` };
      }
      if (width > 1 && field.byteOrder !== 'little' && field.byteOrder !== 'big') {
        return { error: `byteOrder "${String(field.byteOrder)}" is invalid` };
      }
      const byteOrder = width === 1 ? 'little' : field.byteOrder;
      const symbolToCode = {};
      const codeToSymbol = {};
      const maxCode = 2 ** (width * 8) - 1;
      for (const [symbol, code] of entries) {
        if (!Number.isSafeInteger(code) || code < 0 || code > maxCode) {
          return { error: `enum code for "${symbol}" (${String(code)}) is out of range for a ${width}-byte enum` };
        }
        if (code in codeToSymbol) {
          return { error: `enum code ${code} is mapped to multiple symbols` };
        }
        symbolToCode[symbol] = code;
        codeToSymbol[code] = symbol;
      }
      return {
        codec: { kind: 'enum', wireType: 'enum', byteOrder, byteLength: width, symbolToCode, codeToSymbol },
      };
    }
    default:
      return { error: `unsupported or ambiguous wireType "${String(wireType)}"` };
  }
}

// --- Field mapping resolution ----------------------------------------------

function resolveFieldMapping(field, requiredKind) {
  const issues = [];
  const name = field.symbolicName;
  const push = (code, message) =>
    issues.push({ symbolicName: name, severity: 'blocking', code, message });

  const serviceCode = parseCipService(field.cipService);
  if (serviceCode == null) {
    push('cip_service_unresolved', `CIP service is not explicitly assigned (found ${JSON.stringify(field.cipService ?? null)})`);
  }
  const serviceKind = serviceCode == null ? null : serviceKindForCode(serviceCode);
  if (serviceCode != null && serviceKind == null) {
    push('cip_service_unsupported', `CIP service 0x${serviceCode.toString(16).toUpperCase()} is not a supported explicit service (GetAttributeSingle/SetAttributeSingle)`);
  }

  if (serviceKind != null) {
    const expected = expectedServiceKind(field);
    if (expected !== 'both' && serviceKind !== expected) {
      push('service_access_mismatch', `CIP service kind "${serviceKind}" does not match field access "${field.access}"`);
    }
    if (serviceKind === 'read' && field.direction !== 'LSN_TO_PC' && field.access === 'READ') {
      push('service_direction_mismatch', `Read service used with direction ${field.direction}`);
    }
    if (serviceKind === 'write' && field.direction !== 'PC_TO_LSN' && field.access === 'WRITE') {
      push('service_direction_mismatch', `Write service used with direction ${field.direction}`);
    }
    if (requiredKind && serviceKind !== requiredKind && expected !== 'both') {
      push('service_kind_required_mismatch', `This workflow requires a ${requiredKind} service but the field maps a ${serviceKind} service`);
    }
  }

  if (!isNonNegativeInteger(field.class)) push('class_unresolved', 'CIP class is not explicitly assigned');
  if (!isNonNegativeInteger(field.instance)) push('instance_unresolved', 'CIP instance is not explicitly assigned');
  if (!isNonNegativeInteger(field.attribute)) push('attribute_unresolved', 'CIP attribute is not explicitly assigned');

  if (!RESOLVABLE_IMPLEMENTATION_STATUSES.has(field.implementationStatus)) {
    push('implementation_unresolved', `Implementation status "${field.implementationStatus}" is not IMPLEMENTED/VERIFIED`);
  }

  const codecResult = resolveWireCodec(field);
  if ('error' in codecResult) push('wire_encoding_unresolved', codecResult.error);

  if (issues.length > 0) return { issues };

  const classId = field.class;
  const instanceId = field.instance;
  const attributeId = field.attribute;
  return {
    mapping: {
      symbolicName: name,
      serviceKind,
      serviceCode,
      class: classId,
      instance: instanceId,
      attribute: attributeId,
      epath: buildEpath(classId, instanceId, attributeId),
      codec: codecResult.codec,
    },
  };
}

// --- Codec decode/encode ----------------------------------------------------

function readUintLE(bytes, length) {
  let value = 0n;
  for (let i = length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

function readUintBE(bytes, length) {
  let value = 0n;
  for (let i = 0; i < length; i += 1) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

function decodeValue(codec, payload) {
  if (codec.kind === 'string') {
    if (payload.length !== codec.byteLength) {
      throw new RangeError(`String payload length ${payload.length} does not match fixed length ${codec.byteLength}`);
    }
    let end = payload.length;
    for (let i = 0; i < payload.length; i += 1) {
      if (payload[i] === 0x00) { end = i; break; }
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(0, end));
  }
  if (payload.length !== codec.byteLength) {
    throw new RangeError(`Payload length ${payload.length} does not match expected ${codec.byteLength} for ${codec.wireType}`);
  }
  if (codec.kind === 'scalar') {
    if (codec.wireType === 'bool8') {
      const byte = payload[0];
      if (byte !== 0 && byte !== 1) throw new RangeError(`bool8 value must be 0 or 1, received ${byte}`);
      return byte === 1;
    }
    const raw = codec.byteOrder === 'little'
      ? readUintLE(payload, codec.byteLength)
      : readUintBE(payload, codec.byteLength);
    if (codec.wireType === 'uint64') return raw;
    return Number(raw);
  }
  const raw = codec.byteOrder === 'little'
    ? readUintLE(payload, codec.byteLength)
    : readUintBE(payload, codec.byteLength);
  const code = Number(raw);
  const symbol = codec.codeToSymbol[code];
  if (symbol === undefined) throw new RangeError(`Enum code ${code} has no explicit symbol mapping`);
  return symbol;
}

function writeUintLE(value, length) {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

function writeUintBE(value, length) {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i -= 1) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

function toBigIntInRange(value, wireType, byteLength) {
  let big;
  if (typeof value === 'bigint') {
    big = value;
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new TypeError(`Expected integer value for ${wireType}, received ${value}`);
    if (!Number.isSafeInteger(value)) throw new RangeError(`Value ${value} is not a safe integer; use bigint for ${wireType}`);
    big = BigInt(value);
  } else {
    throw new TypeError(`Expected numeric value for ${wireType}, received ${typeof value}`);
  }
  const max = (1n << BigInt(byteLength * 8)) - 1n;
  if (big < 0n || big > max) throw new RangeError(`Value ${big} is out of range for ${wireType} (0..${max})`);
  return big;
}

function encodeValue(codec, value) {
  if (codec.kind === 'string') {
    if (typeof value !== 'string') throw new TypeError(`Expected string value for string codec, received ${typeof value}`);
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > codec.byteLength) {
      throw new RangeError(`String is ${encoded.length} bytes, exceeding fixed length ${codec.byteLength}`);
    }
    const out = new Uint8Array(codec.byteLength);
    out.set(encoded, 0);
    return out;
  }
  if (codec.kind === 'scalar') {
    if (codec.wireType === 'bool8') {
      if (typeof value !== 'boolean') throw new TypeError(`Expected boolean value for bool8, received ${typeof value}`);
      return Uint8Array.of(value ? 1 : 0);
    }
    const big = toBigIntInRange(value, codec.wireType, codec.byteLength);
    return codec.byteOrder === 'little' ? writeUintLE(big, codec.byteLength) : writeUintBE(big, codec.byteLength);
  }
  if (typeof value !== 'string') throw new TypeError(`Expected enum symbol string, received ${typeof value}`);
  const code = codec.symbolToCode[value];
  if (code === undefined) throw new RangeError(`Enum symbol "${value}" has no explicit code mapping`);
  const big = BigInt(code);
  return codec.byteOrder === 'little' ? writeUintLE(big, codec.byteLength) : writeUintBE(big, codec.byteLength);
}

// --- CIP Message Router request framing / reply parsing --------------------

/**
 * Build CIP Message Router request bytes for a resolved mapping.
 *   [service][path size in words][EPATH bytes][request data]
 */
function buildMessageRouterRequest(mapping, requestData) {
  const epath = mapping.epath;
  if (epath.length % 2 !== 0) throw new Error('EPATH must be word-aligned');
  const pathWords = epath.length / 2;
  if (pathWords < 1 || pathWords > 0xff) throw new Error('EPATH word count out of range');
  const data = requestData ? Uint8Array.from(requestData) : new Uint8Array(0);
  const out = new Uint8Array(2 + epath.length + data.length);
  out[0] = mapping.serviceCode & 0xff;
  out[1] = pathWords & 0xff;
  out.set(epath, 2);
  out.set(data, 2 + epath.length);
  return out;
}

/**
 * Parse a CIP explicit-messaging reply.
 *   [reply service][reserved 0x00][general status][additional status size]
 *   [additional status words...][response data]
 * Rejects a malformed/short reply. Returns replyService, generalStatus,
 * additionalStatus (array of words), and data bytes.
 */
function parseCipReply(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (buf.length < 4) throw new Error('CIP reply too short');
  const replyService = buf[0];
  // buf[1] is reserved (should be 0)
  const generalStatus = buf[2];
  const additionalSize = buf[3];
  const additionalBytes = additionalSize * 2;
  if (4 + additionalBytes > buf.length) throw new Error('CIP reply additional status out of bounds');
  const additionalStatus = [];
  for (let i = 0; i < additionalSize; i += 1) {
    const o = 4 + i * 2;
    additionalStatus.push(buf[o] | (buf[o + 1] << 8));
  }
  const data = buf.subarray(4 + additionalBytes);
  return { replyService, generalStatus, additionalStatus, data: Uint8Array.from(data) };
}

/** Decode a successful reply's data into a typed value; reject nonzero status. */
function decodeCipReply(codec, reply) {
  if (reply.generalStatus !== 0) {
    const extra = reply.additionalStatus.length
      ? ` (additional: ${reply.additionalStatus.map((w) => `0x${w.toString(16)}`).join(',')})`
      : '';
    throw new Error(`CIP general status 0x${reply.generalStatus.toString(16).toUpperCase()} indicates an error response${extra}`);
  }
  return decodeValue(codec, reply.data);
}

// --- Workflow requirements (mirror hardware-profile.ts) --------------------

const WORKFLOW_REQUIRED_FIELDS = {
  stateRead: ['Ready', 'Faulted', 'EmissionControlOutputActive'],
  enable: [
    'Ready',
    'Faulted',
    'EmissionControlOutputActive',
    'EmissionEnableRequest',
    'InterlockOK',
    'RemoteStopOK',
  ],
};

function findField(doc, symbolicName) {
  return doc.fields.find((f) => f.symbolicName === symbolicName);
}

function workflowKindForField(workflow, field) {
  if (workflow === 'enable' && field.symbolicName === 'EmissionEnableRequest') return 'write';
  return 'read';
}

/**
 * Whether a capability-gated field is active. Safety fields (InterlockOK /
 * RemoteStopOK) are only required when their capability is enabled in the
 * profile. When disabled they are treated as satisfied (not present in the
 * physical device), matching the console's capability gating.
 */
function isCapabilityFieldActive(doc, field) {
  if (!field.capability) return true;
  const capability = doc.capabilities && doc.capabilities[field.capability];
  return Boolean(capability && capability.enabled);
}

function missingRequirementsForWorkflow(doc, workflow) {
  const required = WORKFLOW_REQUIRED_FIELDS[workflow] || [];
  const issues = [];
  for (const symbolicName of required) {
    const field = findField(doc, symbolicName);
    if (!field) {
      issues.push({ symbolicName, severity: 'blocking', code: 'field_missing', message: `Required field "${symbolicName}" is not present in the profile` });
      continue;
    }
    if (!isCapabilityFieldActive(doc, field)) continue;
    const kind = workflowKindForField(workflow, field);
    const result = resolveFieldMapping(field, kind);
    if ('issues' in result) issues.push(...result.issues);
  }
  return issues;
}

// --- Profile loading / pinning ---------------------------------------------

const BUNDLED_PROFILE_PATH = path.join(__dirname, '..', 'profiles', 'lsn-v0.1.json');

/**
 * Load, parse, deep-freeze, and digest the bundled profile. The renderer never
 * supplies this; the main process pins exactly one profile per service.
 */
function loadBundledProfile(profilePath = BUNDLED_PROFILE_PATH) {
  const raw = fs.readFileSync(profilePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fields)) {
    throw new Error('Bundled profile is malformed');
  }
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  deepFreeze(parsed);
  return { profile: parsed, digest };
}

/**
 * Compute a readiness report for the pinned profile. The current TBD profile
 * reports notReady with per-workflow blocking issues; never falls open.
 */
function computeReadiness(doc) {
  const identityResult = resolveExpectedIdentity(doc);
  const identityIssues = 'issues' in identityResult ? identityResult.issues : [];
  const stateReadIssues = [
    ...identityIssues,
    ...missingRequirementsForWorkflow(doc, 'stateRead'),
  ];
  const enableIssues = [
    ...identityIssues,
    ...missingRequirementsForWorkflow(doc, 'enable'),
  ];
  return {
    profileVersion: doc.profileVersion,
    protocolVersion: doc.protocolVersion,
    stateRead: { ready: stateReadIssues.length === 0, issues: stateReadIssues },
    enable: { ready: enableIssues.length === 0, issues: enableIssues },
    // Overall control readiness requires the enable workflow fully resolved.
    controlReady: enableIssues.length === 0,
    readReady: stateReadIssues.length === 0,
    identity: {
      ready: identityIssues.length === 0,
      issues: identityIssues,
    },
  };
}

module.exports = {
  CIP_SERVICE_GET_ATTRIBUTE_SINGLE,
  CIP_SERVICE_SET_ATTRIBUTE_SINGLE,
  BUNDLED_PROFILE_PATH,
  isTbd,
  parseCipService,
  buildEpath,
  resolveWireCodec,
  resolveFieldMapping,
  decodeValue,
  encodeValue,
  buildMessageRouterRequest,
  parseCipReply,
  decodeCipReply,
  missingRequirementsForWorkflow,
  findField,
  isCapabilityFieldActive,
  loadBundledProfile,
  computeReadiness,
  resolveExpectedIdentity,
  deepFreeze,
};
