import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const ops = require('../electron/profile-operations.cjs') as {
  parseCipService: (value: unknown) => number | null;
  buildEpath: (c: number, i: number, a: number) => Uint8Array;
  resolveWireCodec: (field: Record<string, unknown>) =>
    | { codec: Record<string, unknown> }
    | { error: string };
  resolveFieldMapping: (
    field: Record<string, unknown>,
    kind?: string,
  ) => { mapping?: Record<string, unknown>; issues?: unknown[] };
  encodeValue: (codec: unknown, value: unknown) => Uint8Array;
  decodeValue: (codec: unknown, payload: Uint8Array) => unknown;
  buildMessageRouterRequest: (mapping: unknown, data: number[]) => Uint8Array;
  parseCipReply: (bytes: number[]) => {
    replyService: number;
    generalStatus: number;
    additionalStatus: number[];
    data: Uint8Array;
  };
  decodeCipReply: (codec: unknown, reply: unknown) => unknown;
  loadBundledProfile: () => { profile: Record<string, unknown>; digest: string };
  computeReadiness: (doc: unknown) => {
    controlReady: boolean;
    readReady: boolean;
    enable: { ready: boolean; issues: unknown[] };
  };
};

describe('profile-operations codec parity', () => {
  it('parses CIP service aliases and numeric forms', () => {
    expect(ops.parseCipService('GetAttributeSingle')).toBe(0x0e);
    expect(ops.parseCipService('SetAttributeSingle')).toBe(0x10);
    expect(ops.parseCipService('0x0E')).toBe(0x0e);
    expect(ops.parseCipService(16)).toBe(0x10);
    expect(ops.parseCipService('TBD')).toBeNull();
    expect(ops.parseCipService(null)).toBeNull();
  });

  it('builds word-aligned EPATH bytes for 8-bit and 16-bit segments', () => {
    const small = ops.buildEpath(0x64, 1, 3);
    expect(Array.from(small)).toEqual([0x20, 0x64, 0x24, 0x01, 0x30, 0x03]);
    const large = ops.buildEpath(0x1234, 1, 3);
    expect(large.length % 2).toBe(0);
    expect(large[0]).toBe(0x21); // 16-bit class segment
  });

  it('round-trips bool8', () => {
    const r = ops.resolveWireCodec({ wireType: 'bool8' });
    const codec = (r as { codec: unknown }).codec;
    expect(Array.from(ops.encodeValue(codec, true))).toEqual([1]);
    expect(ops.decodeValue(codec, Uint8Array.of(0))).toBe(false);
    expect(() => ops.decodeValue(codec, Uint8Array.of(2))).toThrow();
  });

  it('round-trips uint16/uint32 with byte order', () => {
    const c16 = (ops.resolveWireCodec({ wireType: 'uint16', byteOrder: 'little' }) as {
      codec: unknown;
    }).codec;
    expect(Array.from(ops.encodeValue(c16, 0x0102))).toEqual([0x02, 0x01]);
    expect(ops.decodeValue(c16, Uint8Array.of(0x02, 0x01))).toBe(0x0102);

    const c32 = (ops.resolveWireCodec({ wireType: 'uint32', byteOrder: 'big' }) as {
      codec: unknown;
    }).codec;
    expect(Array.from(ops.encodeValue(c32, 0x01020304))).toEqual([1, 2, 3, 4]);
  });

  it('round-trips uint64 as bigint', () => {
    const c = (ops.resolveWireCodec({ wireType: 'uint64', byteOrder: 'little' }) as {
      codec: unknown;
    }).codec;
    const encoded = ops.encodeValue(c, 0x0102030405060708n);
    expect(ops.decodeValue(c, encoded)).toBe(0x0102030405060708n);
  });

  it('round-trips a fixed UTF-8 string', () => {
    const c = (ops.resolveWireCodec({ wireType: 'string', stringLength: 8 }) as {
      codec: unknown;
    }).codec;
    const encoded = ops.encodeValue(c, 'LSN');
    expect(encoded.length).toBe(8);
    expect(ops.decodeValue(c, encoded)).toBe('LSN');
  });

  it('round-trips an explicit enum', () => {
    const c = (ops.resolveWireCodec({
      wireType: 'enum',
      enumWidth: 1,
      enumMapping: { NotCounting: 0, Counting: 1, Fault: 2 },
    }) as { codec: unknown }).codec;
    expect(Array.from(ops.encodeValue(c, 'Counting'))).toEqual([1]);
    expect(ops.decodeValue(c, Uint8Array.of(2))).toBe('Fault');
    expect(() => ops.decodeValue(c, Uint8Array.of(9))).toThrow();
  });

  it('rejects missing wire metadata', () => {
    expect('error' in ops.resolveWireCodec({ wireType: 'uint16' })).toBe(true);
    expect('error' in ops.resolveWireCodec({ wireType: 'TBD' })).toBe(true);
  });

  it('the bundled TBD profile fails closed', () => {
    const { profile, digest } = ops.loadBundledProfile();
    expect(typeof digest).toBe('string');
    expect(digest.length).toBe(64);
    const readiness = ops.computeReadiness(profile);
    expect(readiness.controlReady).toBe(false);
    expect(readiness.readReady).toBe(false);
    expect(readiness.enable.issues.length).toBeGreaterThan(0);
  });

  it('decodeCipReply rejects nonzero status', () => {
    const codec = (ops.resolveWireCodec({ wireType: 'bool8' }) as { codec: unknown }).codec;
    const reply = ops.parseCipReply([0x8e, 0x00, 0x05, 0x00]);
    expect(() => ops.decodeCipReply(codec, reply)).toThrow(/status 0x5/i);
  });
});
