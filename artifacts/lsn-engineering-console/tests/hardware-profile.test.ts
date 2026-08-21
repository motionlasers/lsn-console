import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CIP_SERVICE_GET_ATTRIBUTE_SINGLE,
  CIP_SERVICE_SET_ATTRIBUTE_SINGLE,
  buildEpath,
  decodeCipResponse,
  decodeValue,
  encodeCipWrite,
  encodeValue,
  isFieldMappingResolved,
  isWorkflowReady,
  missingRequirementsByWorkflow,
  missingRequirementsForWorkflow,
  missingRequirementsGlobal,
  parseCipService,
  resolveFieldMapping,
  resolveWireCodec,
  type HardwareProfileField,
  type WireCodec,
} from '../src/lib/hardware-profile';
import type { DeviceProfileDocument } from '../src/lib/profile-validation';

const currentProfile = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../profiles/lsn-v0.1.json'), 'utf8'),
) as DeviceProfileDocument;

/* -------------------------------------------------------------------------- */
/* Synthetic fully resolved profile helpers                                   */
/* -------------------------------------------------------------------------- */

function baseField(overrides: Partial<HardwareProfileField>): HardwareProfileField {
  return {
    symbolicName: 'Test',
    direction: 'LSN_TO_PC',
    dataType: 'boolean',
    access: 'READ',
    cipService: '0x0E',
    class: 4,
    instance: 100,
    attribute: 3,
    assembly: null,
    implementationStatus: 'IMPLEMENTED',
    simulationStatus: 'VERIFIED',
    expectedFirmwareBehavior: 'x',
    expectedReportedResponse: 'y',
    wireType: 'bool8',
    ...overrides,
  } as HardwareProfileField;
}

function resolvedBoolRead(name: string): HardwareProfileField {
  return baseField({ symbolicName: name, wireType: 'bool8', dataType: 'boolean' });
}

/** A fully resolved synthetic profile covering every workflow. */
function fullyResolvedProfile(): DeviceProfileDocument {
  const fields: HardwareProfileField[] = [
    resolvedBoolRead('Ready'),
    resolvedBoolRead('Faulted'),
    resolvedBoolRead('EmissionControlOutputActive'),
    resolvedBoolRead('InterlockOK'),
    resolvedBoolRead('RemoteStopOK'),
    baseField({
      symbolicName: 'EmissionEnableRequest',
      direction: 'PC_TO_LSN',
      access: 'WRITE',
      dataType: 'boolean',
      cipService: '0x10',
      wireType: 'bool8',
    }),
    baseField({
      symbolicName: 'TimerState',
      dataType: 'enum',
      wireType: 'enum',
      byteOrder: 'little',
      enumWidth: 2,
      enumMapping: { NotCounting: 0, Counting: 1, Fault: 2, Unknown: 3 },
    }),
    baseField({
      symbolicName: 'LifetimeEmissionTimeMs',
      dataType: 'uint64',
      wireType: 'uint64',
      byteOrder: 'little',
    }),
    baseField({
      symbolicName: 'EnableCount',
      dataType: 'uint64',
      wireType: 'uint64',
      byteOrder: 'little',
    }),
  ];
  return {
    profileVersion: '9.9.9',
    protocolVersion: 'LSN test',
    hardwareFamily: 'TEST',
    identity: {
      vendorId: 1,
      deviceType: 2,
      productCode: 3,
      mappingState: 'VERIFIED',
    },
    capabilities: {
      interlock: { enabled: true, phase: 'test', description: 'x' },
      remoteStop: { enabled: true, phase: 'test', description: 'x' },
      sensors: { enabled: false, phase: 'test', description: 'x' },
    },
    fields,
  } as unknown as DeviceProfileDocument;
}

/* -------------------------------------------------------------------------- */
/* parseCipService                                                             */
/* -------------------------------------------------------------------------- */

describe('parseCipService', () => {
  it('parses symbolic aliases case-insensitively', () => {
    expect(parseCipService('GetAttributeSingle')).toBe(CIP_SERVICE_GET_ATTRIBUTE_SINGLE);
    expect(parseCipService('get_attribute_single')).toBe(CIP_SERVICE_GET_ATTRIBUTE_SINGLE);
    expect(parseCipService('SetAttributeSingle')).toBe(CIP_SERVICE_SET_ATTRIBUTE_SINGLE);
  });

  it('parses hex and decimal numeric strings and numbers', () => {
    expect(parseCipService('0x0E')).toBe(0x0e);
    expect(parseCipService('0x10')).toBe(0x10);
    expect(parseCipService('14')).toBe(14);
    expect(parseCipService(16)).toBe(16);
  });

  it('returns null for TBD, empty, and out-of-range values', () => {
    expect(parseCipService('TBD')).toBeNull();
    expect(parseCipService(null)).toBeNull();
    expect(parseCipService('')).toBeNull();
    expect(parseCipService('not-a-service')).toBeNull();
    expect(parseCipService(999)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* buildEpath                                                                  */
/* -------------------------------------------------------------------------- */

describe('buildEpath', () => {
  it('encodes 8-bit logical segments with correct type bytes', () => {
    const epath = buildEpath(4, 100, 3);
    expect(Array.from(epath)).toEqual([0x20, 0x04, 0x24, 0x64, 0x30, 0x03]);
    expect(epath.length % 2).toBe(0);
  });

  it('encodes 16-bit logical segments with word padding', () => {
    const epath = buildEpath(0x1234, 0x0abc, 5);
    expect(Array.from(epath)).toEqual([
      0x21, 0x00, 0x34, 0x12, // class 16-bit LE with pad
      0x25, 0x00, 0xbc, 0x0a, // instance 16-bit LE with pad
      0x30, 0x05, // attribute 8-bit
    ]);
    expect(epath.length % 2).toBe(0);
  });

  it('rejects out-of-range and negative values', () => {
    expect(() => buildEpath(-1, 1, 1)).toThrow();
    expect(() => buildEpath(0x10000, 1, 1)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* resolveWireCodec                                                            */
/* -------------------------------------------------------------------------- */

describe('resolveWireCodec', () => {
  it('resolves bool8 without byte order', () => {
    const result = resolveWireCodec(baseField({ wireType: 'bool8' }));
    expect('codec' in result).toBe(true);
  });

  it('requires byteOrder for multi-byte scalars', () => {
    expect('error' in resolveWireCodec(baseField({ wireType: 'uint32', byteOrder: null }))).toBe(true);
    expect('codec' in resolveWireCodec(baseField({ wireType: 'uint32', byteOrder: 'big' }))).toBe(true);
  });

  it('requires stringLength for string', () => {
    expect('error' in resolveWireCodec(baseField({ wireType: 'string', stringLength: null }))).toBe(true);
    expect('codec' in resolveWireCodec(baseField({ wireType: 'string', stringLength: 16 }))).toBe(true);
  });

  it('requires an explicit enum mapping and rejects duplicate codes', () => {
    expect('error' in resolveWireCodec(baseField({ wireType: 'enum', enumMapping: null }))).toBe(true);
    expect(
      'error' in resolveWireCodec(baseField({ wireType: 'enum', enumMapping: { A: 1, B: 1 }, byteOrder: 'little' })),
    ).toBe(true);
    expect(
      'codec' in resolveWireCodec(baseField({ wireType: 'enum', enumMapping: { A: 0, B: 1 }, byteOrder: 'little' })),
    ).toBe(true);
  });

  it('rejects unknown/ambiguous wire types and TBD', () => {
    expect('error' in resolveWireCodec(baseField({ wireType: null }))).toBe(true);
    expect('error' in resolveWireCodec(baseField({ wireType: 'float32' as never }))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* resolveFieldMapping                                                         */
/* -------------------------------------------------------------------------- */

describe('resolveFieldMapping', () => {
  it('resolves a fully specified read field', () => {
    const result = resolveFieldMapping(resolvedBoolRead('Ready'));
    expect('mapping' in result).toBe(true);
    if ('mapping' in result) {
      expect(result.mapping.serviceKind).toBe('read');
      expect(result.mapping.serviceCode).toBe(CIP_SERVICE_GET_ATTRIBUTE_SINGLE);
      expect(Array.from(result.mapping.epath)).toEqual([0x20, 0x04, 0x24, 0x64, 0x30, 0x03]);
    }
  });

  it('rejects service/access mismatch', () => {
    const field = baseField({ access: 'READ', cipService: '0x10' }); // write service on read field
    const result = resolveFieldMapping(field);
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some(i => i.code === 'service_access_mismatch')).toBe(true);
    }
  });

  it('rejects unsupported service codes', () => {
    const field = baseField({ cipService: '0x4B' });
    const result = resolveFieldMapping(field);
    expect('issues' in result).toBe(true);
    if ('issues' in result) {
      expect(result.issues.some(i => i.code === 'cip_service_unsupported')).toBe(true);
    }
  });

  it('rejects unresolved implementation status', () => {
    const field = baseField({ implementationStatus: 'TBD' });
    const result = resolveFieldMapping(field);
    expect('issues' in result && result.issues.some(i => i.code === 'implementation_unresolved')).toBe(true);
  });

  it('rejects a required kind mismatch', () => {
    const field = resolvedBoolRead('Ready'); // read service
    const result = resolveFieldMapping(field, 'write');
    expect('issues' in result && result.issues.some(i => i.code === 'service_kind_required_mismatch')).toBe(true);
  });

  it('isFieldMappingResolved reflects resolution', () => {
    expect(isFieldMappingResolved(resolvedBoolRead('Ready'))).toBe(true);
    expect(isFieldMappingResolved(baseField({ cipService: 'TBD' }))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Codecs: encode / decode round-trips                                        */
/* -------------------------------------------------------------------------- */

function codecOf(field: HardwareProfileField): WireCodec {
  const result = resolveWireCodec(field);
  if (!('codec' in result)) throw new Error(`expected codec: ${result.error}`);
  return result.codec;
}

describe('codecs', () => {
  it('bool8 round-trips and rejects invalid bytes', () => {
    const codec = codecOf(baseField({ wireType: 'bool8' }));
    expect(decodeValue(codec, encodeValue(codec, true))).toBe(true);
    expect(decodeValue(codec, encodeValue(codec, false))).toBe(false);
    expect(() => decodeValue(codec, Uint8Array.of(2))).toThrow();
    expect(() => encodeValue(codec, 1 as never)).toThrow();
  });

  it('uint16 respects byte order and range', () => {
    const le = codecOf(baseField({ wireType: 'uint16', byteOrder: 'little' }));
    const be = codecOf(baseField({ wireType: 'uint16', byteOrder: 'big' }));
    expect(Array.from(encodeValue(le, 0x1234))).toEqual([0x34, 0x12]);
    expect(Array.from(encodeValue(be, 0x1234))).toEqual([0x12, 0x34]);
    expect(decodeValue(le, Uint8Array.of(0x34, 0x12))).toBe(0x1234);
    expect(() => encodeValue(le, 0x10000)).toThrow();
    expect(() => encodeValue(le, -1)).toThrow();
  });

  it('uint32 round-trips', () => {
    const codec = codecOf(baseField({ wireType: 'uint32', byteOrder: 'little' }));
    const bytes = encodeValue(codec, 0xdeadbeef);
    expect(decodeValue(codec, bytes)).toBe(0xdeadbeef);
  });

  it('uint64 uses bigint and round-trips large values', () => {
    const codec = codecOf(baseField({ wireType: 'uint64', byteOrder: 'little' }));
    const value = 0x0102030405060708n;
    const bytes = encodeValue(codec, value);
    expect(decodeValue(codec, bytes)).toBe(value);
    expect(() => encodeValue(codec, -1n)).toThrow();
  });

  it('fixed UTF-8 string encodes zero-padded and decodes trimmed', () => {
    const codec = codecOf(baseField({ wireType: 'string', stringLength: 8 }));
    const bytes = encodeValue(codec, 'v1.2');
    expect(bytes.length).toBe(8);
    expect(decodeValue(codec, bytes)).toBe('v1.2');
    expect(() => encodeValue(codec, 'this-is-way-too-long')).toThrow();
    expect(() => decodeValue(codec, Uint8Array.of(1, 2, 3))).toThrow();
  });

  it('enum maps symbols to codes and rejects unknowns', () => {
    const codec = codecOf(
      baseField({ wireType: 'enum', byteOrder: 'little', enumWidth: 2, enumMapping: { A: 0, B: 5 } }),
    );
    const bytes = encodeValue(codec, 'B');
    expect(Array.from(bytes)).toEqual([5, 0]);
    expect(decodeValue(codec, bytes)).toBe('B');
    expect(() => encodeValue(codec, 'Z')).toThrow();
    expect(() => decodeValue(codec, Uint8Array.of(9, 0))).toThrow();
  });

  it('rejects malformed lengths for scalars', () => {
    const codec = codecOf(baseField({ wireType: 'uint32', byteOrder: 'little' }));
    expect(() => decodeValue(codec, Uint8Array.of(1, 2))).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* CIP response decoding                                                       */
/* -------------------------------------------------------------------------- */

describe('decodeCipResponse / encodeCipWrite', () => {
  it('decodes a successful response', () => {
    const codec = codecOf(baseField({ wireType: 'bool8' }));
    expect(decodeCipResponse(codec, { generalStatus: 0, data: Uint8Array.of(1) })).toBe(true);
  });

  it('rejects a nonzero CIP general status', () => {
    const codec = codecOf(baseField({ wireType: 'bool8' }));
    expect(() => decodeCipResponse(codec, { generalStatus: 0x05, data: Uint8Array.of(1) })).toThrow(/general status/i);
  });

  it('encodes a write with range checks', () => {
    const codec = codecOf(baseField({ wireType: 'uint16', byteOrder: 'little' }));
    expect(Array.from(encodeCipWrite(codec, 258))).toEqual([2, 1]);
    expect(() => encodeCipWrite(codec, 70000)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Workflow requirement reporting — fully resolved profile                    */
/* -------------------------------------------------------------------------- */

describe('workflows on a fully resolved profile', () => {
  const profile = fullyResolvedProfile();

  it('reports no field-mapping issues for field-independent workflows', () => {
    expect(missingRequirementsForWorkflow(profile, 'discovery')).toEqual([]);
    expect(missingRequirementsForWorkflow(profile, 'identity')).toEqual([]);
    expect(missingRequirementsForWorkflow(profile, 'session')).toEqual([]);
  });

  it('reports every field-dependent workflow as ready', () => {
    expect(isWorkflowReady(profile, 'stateRead')).toBe(true);
    expect(isWorkflowReady(profile, 'enable')).toBe(true);
    expect(isWorkflowReady(profile, 'runtime')).toBe(true);
  });

  it('has no global blocking issues', () => {
    expect(missingRequirementsGlobal(profile)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Blocker tests — current lsn-v0.1 profile                                   */
/* -------------------------------------------------------------------------- */

describe('current lsn-v0.1 profile blockers', () => {
  it('keeps every field unresolved (all mappings TBD/null)', () => {
    for (const field of currentProfile.fields as HardwareProfileField[]) {
      expect(isFieldMappingResolved(field)).toBe(false);
    }
  });

  it('produces explicit blocking issues globally', () => {
    const issues = missingRequirementsGlobal(currentProfile);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.severity).toBe('blocking');
    }
    expect(issues.some(i => i.code === 'cip_service_unresolved')).toBe(true);
    expect(issues.some(i => i.code === 'class_unresolved')).toBe(true);
    expect(issues.some(i => i.code === 'wire_encoding_unresolved')).toBe(true);
  });

  it('blocks identity and field-dependent workflows but not discovery/session', () => {
    expect(missingRequirementsForWorkflow(currentProfile, 'discovery')).toEqual([]);
    expect(missingRequirementsForWorkflow(currentProfile, 'identity')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'identity_unresolved' }),
      ]),
    );
    expect(missingRequirementsForWorkflow(currentProfile, 'session')).toEqual([]);

    expect(isWorkflowReady(currentProfile, 'stateRead')).toBe(false);
    expect(isWorkflowReady(currentProfile, 'enable')).toBe(false);
    expect(isWorkflowReady(currentProfile, 'runtime')).toBe(false);
  });

  it('groups blocking issues by workflow', () => {
    const byWorkflow = missingRequirementsByWorkflow(currentProfile);
    expect(byWorkflow.discovery).toEqual([]);
    expect(byWorkflow.stateRead.length).toBeGreaterThan(0);
    expect(byWorkflow.enable.length).toBeGreaterThan(byWorkflow.stateRead.length);
    // enable additionally requires the write request + safety fields.
    expect(byWorkflow.enable.some(i => i.symbolicName === 'EmissionEnableRequest')).toBe(true);
    expect(byWorkflow.enable.some(i => i.symbolicName === 'InterlockOK')).toBe(true);
  });
});
