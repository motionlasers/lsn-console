/**
 * Pure TypeScript profile-mapping validator and CIP codec boundary.
 *
 * This module is the safety boundary between the LSN Device Profile and any
 * physical EtherNet/IP / CIP interaction with real ESP32 hardware. It NEVER
 * invents a mapping: a logical field is only "resolved" for hardware use when
 * its CIP service, class, instance, attribute, implementation status, and wire
 * encoding are all explicitly and validly assigned in the profile. Anything
 * else produces an explicit, blocking issue.
 *
 * Nothing here reads or writes files, touches Electron, React, or the Zustand
 * store, or mutates profile values. It only inspects the profile document and
 * encodes/decodes byte payloads.
 */

import type {
  DeviceProfileDocument,
  DeviceProfileField,
} from './profile-validation';

/* -------------------------------------------------------------------------- */
/* CIP service constants                                                       */
/* -------------------------------------------------------------------------- */

/** Standard explicit-messaging CIP service codes we understand. */
export const CIP_SERVICE_GET_ATTRIBUTE_SINGLE = 0x0e;
export const CIP_SERVICE_SET_ATTRIBUTE_SINGLE = 0x10;

/** Accepted symbolic aliases (case-insensitive) for the read service. */
const GET_ATTRIBUTE_SINGLE_ALIASES = new Set([
  'getattributesingle',
  'get_attribute_single',
  'get attribute single',
]);

/** Accepted symbolic aliases (case-insensitive) for the write service. */
const SET_ATTRIBUTE_SINGLE_ALIASES = new Set([
  'setattributesingle',
  'set_attribute_single',
  'set attribute single',
]);

export type CipServiceKind = 'read' | 'write';

/* -------------------------------------------------------------------------- */
/* Wire encoding metadata                                                      */
/* -------------------------------------------------------------------------- */

export type WireByteOrder = 'little' | 'big';

/**
 * Supported wire types. These describe the byte-level encoding of a logical
 * value. Each is only usable when the required metadata is explicit.
 */
export type WireType =
  | 'bool8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'string'
  | 'enum';

/**
 * Explicit wire metadata. These are additional, optional profile properties.
 * They do not change any existing profile values; the current lsn-v0.1 profile
 * omits them, which keeps every field unresolved (blocking) for hardware use.
 */
export interface WireMetadata {
  /** Explicit byte-level wire encoding. */
  wireType?: WireType | null;
  /** Byte order for multi-byte scalars. Required for uint16/uint32/uint64. */
  byteOrder?: WireByteOrder | null;
  /** Fixed byte length for `string` wire type (UTF-8, fixed field). */
  stringLength?: number | null;
  /**
   * Explicit numeric enum mapping (symbol -> numeric code). Required for the
   * `enum` wire type. Never inferred.
   */
  enumMapping?: Record<string, number> | null;
  /** Storage width in bytes for `enum` wire type (1, 2, or 4). */
  enumWidth?: number | null;
}

/**
 * A field extended with the optional wire metadata. Because the base
 * DeviceProfileField already carries an index signature, these properties can
 * be present on any profile field without a schema change.
 */
export type HardwareProfileField = DeviceProfileField & WireMetadata;

/* -------------------------------------------------------------------------- */
/* Resolved mapping / codec descriptors                                       */
/* -------------------------------------------------------------------------- */

/** A fully validated, ready-to-use CIP codec for a scalar wire type. */
export interface ScalarCodec {
  kind: 'scalar';
  wireType: 'bool8' | 'uint16' | 'uint32' | 'uint64';
  byteOrder: WireByteOrder;
  byteLength: number;
}

/** A fully validated fixed-length UTF-8 string codec. */
export interface StringCodec {
  kind: 'string';
  wireType: 'string';
  byteLength: number;
}

/** A fully validated explicit enum codec. */
export interface EnumCodec {
  kind: 'enum';
  wireType: 'enum';
  byteOrder: WireByteOrder;
  byteLength: number;
  /** symbol -> code */
  symbolToCode: Record<string, number>;
  /** code -> symbol */
  codeToSymbol: Record<number, string>;
}

export type WireCodec = ScalarCodec | StringCodec | EnumCodec;

/** Decoded logical value produced by a codec. */
export type LogicalValue = boolean | number | bigint | string;

/** A field whose CIP mapping and wire encoding are fully resolved and valid. */
export interface ResolvedFieldMapping {
  symbolicName: string;
  serviceKind: CipServiceKind;
  serviceCode: number;
  class: number;
  instance: number;
  attribute: number;
  /** Validated CIP EPATH bytes (word-padded logical segments). */
  epath: Uint8Array;
  codec: WireCodec;
}

/* -------------------------------------------------------------------------- */
/* Issue reporting                                                            */
/* -------------------------------------------------------------------------- */

export type IssueSeverity = 'blocking';

export interface MappingIssue {
  symbolicName: string;
  severity: IssueSeverity;
  code: string;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Small internal helpers                                                     */
/* -------------------------------------------------------------------------- */

function isTbd(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === 'string' && value.trim().toUpperCase() === 'TBD')
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Resolve an explicit CIP service value to its numeric code. Accepts numeric
 * codes, hex strings like "0x0E", decimal strings, and known symbolic aliases.
 * Returns null when the value is TBD, ambiguous, or unrecognized.
 */
export function parseCipService(value: unknown): number | null {
  if (isTbd(value)) return null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= 0xff
      ? value
      : null;
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

  // Numeric string forms: "0x0E", "14", etc.
  let parsed: number | null = null;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    parsed = Number.parseInt(trimmed.slice(2), 16);
  } else if (/^\d+$/.test(trimmed)) {
    parsed = Number.parseInt(trimmed, 10);
  }
  if (parsed == null || Number.isNaN(parsed)) return null;
  if (parsed < 0 || parsed > 0xff) return null;
  return parsed;
}

/** Which CIP service kind (read/write) a numeric service code represents. */
function serviceKindForCode(code: number): CipServiceKind | null {
  if (code === CIP_SERVICE_GET_ATTRIBUTE_SINGLE) return 'read';
  if (code === CIP_SERVICE_SET_ATTRIBUTE_SINGLE) return 'write';
  return null;
}

/** The CIP service kind implied by a field's declared access + direction. */
function expectedServiceKind(
  field: DeviceProfileField,
): CipServiceKind | 'both' {
  // A field's direction and access must agree with the CIP service kind:
  //  - READ  / LSN_TO_PC  -> read
  //  - WRITE / PC_TO_LSN  -> write
  //  - READ_WRITE         -> both accepted
  if (field.access === 'READ') return 'read';
  if (field.access === 'WRITE') return 'write';
  return 'both';
}

/* -------------------------------------------------------------------------- */
/* CIP EPATH construction                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Encode a single logical segment (class / instance / attribute) using the
 * correct 8-bit or 16-bit logical segment form.
 *
 * 8-bit form:  [0x20|0x24|0x30 | 0x00] [value]
 * 16-bit form: [0x20|0x24|0x30 | 0x01] [0x00 pad] [value low] [value high]
 *
 * The pad byte after a 16-bit segment header keeps the following 16-bit value
 * word-aligned, matching the CIP logical-segment encoding rules.
 */
function encodeLogicalSegment(baseType: number, value: number): number[] {
  if (!isNonNegativeInteger(value)) {
    throw new RangeError(`Logical segment value must be a non-negative integer, received ${value}`);
  }
  if (value <= 0xff) {
    // 8-bit logical format (format bits = 0b00)
    return [baseType | 0x00, value & 0xff];
  }
  if (value <= 0xffff) {
    // 16-bit logical format (format bits = 0b01); pad byte keeps 16-bit
    // value word-aligned.
    return [baseType | 0x01, 0x00, value & 0xff, (value >> 8) & 0xff];
  }
  throw new RangeError(`Logical segment value ${value} exceeds 16-bit range`);
}

const LOGICAL_SEGMENT_CLASS = 0x20;
const LOGICAL_SEGMENT_INSTANCE = 0x24;
const LOGICAL_SEGMENT_ATTRIBUTE = 0x30;

/**
 * Build validated CIP EPATH bytes for a class / instance / attribute triple.
 * The resulting path is an even number of bytes (word-padded per segment).
 */
export function buildEpath(
  classId: number,
  instanceId: number,
  attributeId: number,
): Uint8Array {
  const bytes = [
    ...encodeLogicalSegment(LOGICAL_SEGMENT_CLASS, classId),
    ...encodeLogicalSegment(LOGICAL_SEGMENT_INSTANCE, instanceId),
    ...encodeLogicalSegment(LOGICAL_SEGMENT_ATTRIBUTE, attributeId),
  ];
  // Every logical segment produced above is already word-aligned (2 or 4
  // bytes), so the total is always even; assert defensively.
  if (bytes.length % 2 !== 0) {
    bytes.push(0x00);
  }
  return Uint8Array.from(bytes);
}

/* -------------------------------------------------------------------------- */
/* Wire codec resolution                                                       */
/* -------------------------------------------------------------------------- */

const SCALAR_BYTE_LENGTHS: Record<string, number> = {
  bool8: 1,
  uint16: 2,
  uint32: 4,
  uint64: 8,
};

/**
 * Resolve a validated wire codec from a field's explicit wire metadata, or an
 * explanatory error string when the encoding is missing or ambiguous.
 */
export function resolveWireCodec(
  field: HardwareProfileField,
): { codec: WireCodec } | { error: string } {
  const wireType = field.wireType;
  if (isTbd(wireType)) {
    return { error: 'wire encoding (wireType) is not assigned in the profile' };
  }

  switch (wireType) {
    case 'bool8': {
      // bool8 is a single byte; byte order is irrelevant but we normalize to
      // little for a consistent descriptor.
      return {
        codec: {
          kind: 'scalar',
          wireType: 'bool8',
          byteOrder: 'little',
          byteLength: 1,
        },
      };
    }
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
      return {
        codec: {
          kind: 'string',
          wireType: 'string',
          byteLength: field.stringLength,
        },
      };
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
      const byteOrder: WireByteOrder =
        width === 1 ? 'little' : isTbd(field.byteOrder) ? 'little' : (field.byteOrder as WireByteOrder);
      if (width > 1 && isTbd(field.byteOrder)) {
        return { error: `byteOrder is required for a ${width}-byte enum but is not assigned` };
      }
      if (width > 1 && field.byteOrder !== 'little' && field.byteOrder !== 'big') {
        return { error: `byteOrder "${String(field.byteOrder)}" is invalid` };
      }
      const symbolToCode: Record<string, number> = {};
      const codeToSymbol: Record<number, string> = {};
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
        codec: {
          kind: 'enum',
          wireType: 'enum',
          byteOrder,
          byteLength: width,
          symbolToCode,
          codeToSymbol,
        },
      };
    }
    default:
      return { error: `unsupported or ambiguous wireType "${String(wireType)}"` };
  }
}

/* -------------------------------------------------------------------------- */
/* Field mapping resolution                                                    */
/* -------------------------------------------------------------------------- */

const RESOLVABLE_IMPLEMENTATION_STATUSES = new Set([
  'IMPLEMENTED',
  'VERIFIED',
]);

/**
 * Attempt to resolve a single field into a fully validated mapping. On failure,
 * returns a list of explicit blocking issues explaining exactly what is
 * missing. Never invents any mapping value.
 *
 * @param requiredKind Optionally constrain the intended access direction of the
 *   resolution ('read' or 'write'). Used by workflow-specific checks.
 */
export function resolveFieldMapping(
  field: HardwareProfileField,
  requiredKind?: CipServiceKind,
): { mapping: ResolvedFieldMapping } | { issues: MappingIssue[] } {
  const issues: MappingIssue[] = [];
  const name = field.symbolicName;
  const push = (code: string, message: string) =>
    issues.push({ symbolicName: name, severity: 'blocking', code, message });

  // 1. CIP service must be explicit and valid.
  const serviceCode = parseCipService(field.cipService);
  if (serviceCode == null) {
    push('cip_service_unresolved', `CIP service is not explicitly assigned (found ${JSON.stringify(field.cipService ?? null)})`);
  }
  const serviceKind = serviceCode == null ? null : serviceKindForCode(serviceCode);
  if (serviceCode != null && serviceKind == null) {
    push(
      'cip_service_unsupported',
      `CIP service 0x${serviceCode.toString(16).toUpperCase()} is not a supported explicit service (GetAttributeSingle/SetAttributeSingle)`,
    );
  }

  // 2. Service kind must agree with declared access/direction.
  if (serviceKind != null) {
    const expected = expectedServiceKind(field);
    if (expected !== 'both' && serviceKind !== expected) {
      push(
        'service_access_mismatch',
        `CIP service kind "${serviceKind}" does not match field access "${field.access}"`,
      );
    }
    // Direction sanity: reads come from LSN, writes go to LSN.
    if (serviceKind === 'read' && field.direction !== 'LSN_TO_PC' && field.access === 'READ') {
      push('service_direction_mismatch', `Read service used with direction ${field.direction}`);
    }
    if (serviceKind === 'write' && field.direction !== 'PC_TO_LSN' && field.access === 'WRITE') {
      push('service_direction_mismatch', `Write service used with direction ${field.direction}`);
    }
    // If a specific kind is required (per workflow) it must match.
    if (requiredKind && serviceKind !== requiredKind && expected !== 'both') {
      push(
        'service_kind_required_mismatch',
        `This workflow requires a ${requiredKind} service but the field maps a ${serviceKind} service`,
      );
    }
  }

  // 3. Class / instance / attribute must be explicit non-negative integers.
  if (!isNonNegativeInteger(field.class)) {
    push('class_unresolved', 'CIP class is not explicitly assigned');
  }
  if (!isNonNegativeInteger(field.instance)) {
    push('instance_unresolved', 'CIP instance is not explicitly assigned');
  }
  if (!isNonNegativeInteger(field.attribute)) {
    push('attribute_unresolved', 'CIP attribute is not explicitly assigned');
  }

  // 4. Implementation status must be at a resolvable stage.
  if (!RESOLVABLE_IMPLEMENTATION_STATUSES.has(field.implementationStatus)) {
    push(
      'implementation_unresolved',
      `Implementation status "${field.implementationStatus}" is not IMPLEMENTED/VERIFIED`,
    );
  }

  // 5. Wire encoding must be explicit and valid.
  const codecResult = resolveWireCodec(field);
  if ('error' in codecResult) {
    push('wire_encoding_unresolved', codecResult.error);
  }

  if (issues.length > 0) {
    return { issues };
  }

  // All checks passed: safe to build the resolved mapping.
  const classId = field.class as number;
  const instanceId = field.instance as number;
  const attributeId = field.attribute as number;
  const codec = (codecResult as { codec: WireCodec }).codec;
  return {
    mapping: {
      symbolicName: name,
      serviceKind: serviceKind as CipServiceKind,
      serviceCode: serviceCode as number,
      class: classId,
      instance: instanceId,
      attribute: attributeId,
      epath: buildEpath(classId, instanceId, attributeId),
      codec,
    },
  };
}

/** Convenience: true only when a field resolves cleanly. */
export function isFieldMappingResolved(field: HardwareProfileField): boolean {
  return 'mapping' in resolveFieldMapping(field);
}

/* -------------------------------------------------------------------------- */
/* Codec: decode                                                               */
/* -------------------------------------------------------------------------- */

function readUintLE(bytes: Uint8Array, length: number): bigint {
  let value = 0n;
  for (let i = length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value;
}

function readUintBE(bytes: Uint8Array, length: number): bigint {
  let value = 0n;
  for (let i = 0; i < length; i += 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value;
}

/**
 * Decode a raw wire payload (the attribute data, no CIP header) into a typed
 * logical value using a resolved codec. Rejects malformed lengths.
 */
export function decodeValue(codec: WireCodec, payload: Uint8Array): LogicalValue {
  if (codec.kind === 'string') {
    if (payload.length !== codec.byteLength) {
      throw new RangeError(
        `String payload length ${payload.length} does not match fixed length ${codec.byteLength}`,
      );
    }
    // Fixed UTF-8 field; trim at first NUL terminator if present.
    let end = payload.length;
    for (let i = 0; i < payload.length; i += 1) {
      if (payload[i] === 0x00) {
        end = i;
        break;
      }
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(0, end));
  }

  if (payload.length !== codec.byteLength) {
    throw new RangeError(
      `Payload length ${payload.length} does not match expected ${codec.byteLength} for ${codec.wireType}`,
    );
  }

  if (codec.kind === 'scalar') {
    if (codec.wireType === 'bool8') {
      const byte = payload[0];
      if (byte !== 0 && byte !== 1) {
        throw new RangeError(`bool8 value must be 0 or 1, received ${byte}`);
      }
      return byte === 1;
    }
    const raw = codec.byteOrder === 'little'
      ? readUintLE(payload, codec.byteLength)
      : readUintBE(payload, codec.byteLength);
    // uint16/uint32 fit safely in number; uint64 stays a bigint.
    if (codec.wireType === 'uint64') return raw;
    return Number(raw);
  }

  // enum
  const raw = codec.byteOrder === 'little'
    ? readUintLE(payload, codec.byteLength)
    : readUintBE(payload, codec.byteLength);
  const code = Number(raw);
  const symbol = codec.codeToSymbol[code];
  if (symbol === undefined) {
    throw new RangeError(`Enum code ${code} has no explicit symbol mapping`);
  }
  return symbol;
}

/* -------------------------------------------------------------------------- */
/* Codec: encode                                                               */
/* -------------------------------------------------------------------------- */

function writeUintLE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function writeUintBE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Encode a typed logical value into a raw wire payload using a resolved codec.
 * Performs range and type checks; rejects out-of-range and mistyped values.
 */
export function encodeValue(codec: WireCodec, value: LogicalValue): Uint8Array {
  if (codec.kind === 'string') {
    if (typeof value !== 'string') {
      throw new TypeError(`Expected string value for string codec, received ${typeof value}`);
    }
    const encoded = new TextEncoder().encode(value);
    if (encoded.length > codec.byteLength) {
      throw new RangeError(
        `String is ${encoded.length} bytes, exceeding fixed length ${codec.byteLength}`,
      );
    }
    const out = new Uint8Array(codec.byteLength); // zero-padded (NUL fill)
    out.set(encoded, 0);
    return out;
  }

  if (codec.kind === 'scalar') {
    if (codec.wireType === 'bool8') {
      if (typeof value !== 'boolean') {
        throw new TypeError(`Expected boolean value for bool8, received ${typeof value}`);
      }
      return Uint8Array.of(value ? 1 : 0);
    }
    const big = toBigIntInRange(value, codec.wireType, codec.byteLength);
    return codec.byteOrder === 'little'
      ? writeUintLE(big, codec.byteLength)
      : writeUintBE(big, codec.byteLength);
  }

  // enum
  if (typeof value !== 'string') {
    throw new TypeError(`Expected enum symbol string, received ${typeof value}`);
  }
  const code = codec.symbolToCode[value];
  if (code === undefined) {
    throw new RangeError(`Enum symbol "${value}" has no explicit code mapping`);
  }
  const big = BigInt(code);
  return codec.byteOrder === 'little'
    ? writeUintLE(big, codec.byteLength)
    : writeUintBE(big, codec.byteLength);
}

function toBigIntInRange(
  value: LogicalValue,
  wireType: string,
  byteLength: number,
): bigint {
  let big: bigint;
  if (typeof value === 'bigint') {
    big = value;
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new TypeError(`Expected integer value for ${wireType}, received ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Value ${value} is not a safe integer; use bigint for ${wireType}`);
    }
    big = BigInt(value);
  } else {
    throw new TypeError(`Expected numeric value for ${wireType}, received ${typeof value}`);
  }
  const max = (1n << BigInt(byteLength * 8)) - 1n;
  if (big < 0n || big > max) {
    throw new RangeError(`Value ${big} is out of range for ${wireType} (0..${max})`);
  }
  return big;
}

/* -------------------------------------------------------------------------- */
/* CIP response decoding                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A parsed CIP explicit-messaging response. `generalStatus` of 0 indicates
 * success; any nonzero value is a device error and must be rejected.
 */
export interface CipResponse {
  generalStatus: number;
  data: Uint8Array;
}

/**
 * Decode a successful CIP response into a typed logical value. Rejects nonzero
 * general status and malformed payload lengths.
 */
export function decodeCipResponse(codec: WireCodec, response: CipResponse): LogicalValue {
  if (response.generalStatus !== 0) {
    throw new Error(
      `CIP general status 0x${response.generalStatus.toString(16).toUpperCase()} indicates an error response`,
    );
  }
  return decodeValue(codec, response.data);
}

/**
 * Encode a logical value for a CIP write (SetAttributeSingle request data).
 * Performs the same range/type checks as `encodeValue`.
 */
export function encodeCipWrite(codec: WireCodec, value: LogicalValue): Uint8Array {
  return encodeValue(codec, value);
}

/* -------------------------------------------------------------------------- */
/* Missing-requirement reporting (global + per workflow)                       */
/* -------------------------------------------------------------------------- */

/** Named hardware workflows the console can attempt against real hardware. */
export type HardwareWorkflow =
  | 'discovery'
  | 'identity'
  | 'session'
  | 'stateRead'
  | 'enable'
  | 'runtime';

/**
 * Minimum field sets each field-dependent workflow requires.
 *
 * Discovery / identity / session are CIP-transport concerns that do not depend
 * on logical field mappings, so they have no field requirements here.
 */
const WORKFLOW_REQUIRED_FIELDS: Record<HardwareWorkflow, string[]> = {
  discovery: [],
  identity: [],
  session: [],
  stateRead: ['Ready', 'Faulted', 'EmissionControlOutputActive'],
  enable: [
    'Ready',
    'Faulted',
    'EmissionControlOutputActive',
    'EmissionEnableRequest',
    // Safety-capability feedback required before permitting an enable request.
    'InterlockOK',
    'RemoteStopOK',
  ],
  runtime: [
    'TimerState',
    'LifetimeEmissionTimeMs',
    'EnableCount',
  ],
};

function identityRequirements(document: DeviceProfileDocument): MappingIssue[] {
  const identity = document.identity;
  const issues: MappingIssue[] = [];
  const push = (code: string, message: string) =>
    issues.push({ symbolicName: 'Identity', severity: 'blocking', code, message });
  if (!identity) {
    push('identity_missing', 'Expected device identity is missing from the profile');
    return issues;
  }
  if (!['IMPLEMENTED', 'VERIFIED'].includes(String(identity.mappingState))) {
    push('identity_unresolved', `Identity mapping state "${String(identity.mappingState)}" is not IMPLEMENTED/VERIFIED`);
  }
  for (const key of ['vendorId', 'deviceType', 'productCode'] as const) {
    const value = identity[key];
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 0xffff) {
      push(`${key}_unresolved`, `Expected identity ${key} is not a resolved 16-bit value`);
    }
  }
  return issues;
}

/** Access direction each workflow needs a given field resolved for. */
function workflowKindForField(
  workflow: HardwareWorkflow,
  field: HardwareProfileField,
): CipServiceKind {
  // enable's EmissionEnableRequest is a write; everything else it needs is a
  // read. All other workflows are reads.
  if (workflow === 'enable' && field.symbolicName === 'EmissionEnableRequest') {
    return 'write';
  }
  return 'read';
}

function findField(
  document: DeviceProfileDocument,
  symbolicName: string,
): HardwareProfileField | undefined {
  return document.fields.find(f => f.symbolicName === symbolicName) as
    | HardwareProfileField
    | undefined;
}

/**
 * List blocking issues for a single named workflow. Discovery/identity/session
 * report no field-mapping issues (they do not depend on field mappings).
 */
export function missingRequirementsForWorkflow(
  document: DeviceProfileDocument,
  workflow: HardwareWorkflow,
): MappingIssue[] {
  const required = WORKFLOW_REQUIRED_FIELDS[workflow];
  const issues: MappingIssue[] =
    workflow === 'identity' || workflow === 'stateRead' || workflow === 'enable'
      ? identityRequirements(document)
      : [];
  for (const symbolicName of required) {
    const field = findField(document, symbolicName);
    if (!field) {
      issues.push({
        symbolicName,
        severity: 'blocking',
        code: 'field_missing',
        message: `Required field "${symbolicName}" is not present in the profile`,
      });
      continue;
    }
    const kind = workflowKindForField(workflow, field);
    const result = resolveFieldMapping(field, kind);
    if ('issues' in result) {
      issues.push(...result.issues);
    }
  }
  return issues;
}

/** True when a workflow can run against real hardware with no blocking issues. */
export function isWorkflowReady(
  document: DeviceProfileDocument,
  workflow: HardwareWorkflow,
): boolean {
  return missingRequirementsForWorkflow(document, workflow).length === 0;
}

/**
 * List blocking issues for every field-dependent workflow, keyed by workflow.
 * Field-independent workflows are present with empty arrays for completeness.
 */
export function missingRequirementsByWorkflow(
  document: DeviceProfileDocument,
): Record<HardwareWorkflow, MappingIssue[]> {
  const workflows: HardwareWorkflow[] = [
    'discovery',
    'identity',
    'session',
    'stateRead',
    'enable',
    'runtime',
  ];
  const result = {} as Record<HardwareWorkflow, MappingIssue[]>;
  for (const workflow of workflows) {
    result[workflow] = missingRequirementsForWorkflow(document, workflow);
  }
  return result;
}

/**
 * List blocking issues for every field in the profile (global view). Each
 * unresolved field contributes its own set of explicit issues.
 */
export function missingRequirementsGlobal(
  document: DeviceProfileDocument,
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  for (const field of document.fields as HardwareProfileField[]) {
    const result = resolveFieldMapping(field);
    if ('issues' in result) {
      issues.push(...result.issues);
    }
  }
  return issues;
}
