import dgram from 'node:dgram';
import net from 'node:net';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

interface Identity {
  socketAddress: string;
  socketPort: number;
  vendorId: number;
  deviceType: number;
  productCode: number;
  revision: string;
  status: number;
  serialNumber: number;
  productName: string;
  state: number | null;
  sourceAddress: string | null;
}

interface EnipSessionState {
  state: string;
  connected: boolean;
  address: string | null;
  sessionHandle: number | null;
}

const transport = require('../electron/ethernet-ip-transport.cjs') as {
  ENIP_PORT: number;
  ENCAP_HEADER_LENGTH: number;
  COMMAND_LIST_IDENTITY: number;
  COMMAND_REGISTER_SESSION: number;
  COMMAND_SEND_RR_DATA: number;
  CPF_ITEM_IDENTITY: number;
  CPF_ITEM_UNCONNECTED_DATA: number;
  MAX_CIP_REQUEST_BYTES: number;
  EnipSession: new (options?: Record<string, unknown>) => {
    connect: (address: string) => Promise<EnipSessionState>;
    disconnect: () => Promise<void>;
    getState: () => EnipSessionState;
    isConnected: () => boolean;
    sendExplicit: (request: {
      cipRequest: number[] | Uint8Array;
      path?: number[];
    }) => Promise<Buffer>;
  };
  isValidIpv4: (address: string) => boolean;
  buildEncapsulation: (options: Record<string, unknown>) => Buffer;
  parseEncapsulation: (buffer: Buffer, options?: Record<string, unknown>) => {
    command: number;
    dataLength: number;
    sessionHandle: number;
    status: number;
    data: Buffer;
  };
  buildListIdentityRequest: () => Buffer;
  parseListIdentityResponse: (buffer: Buffer) => Identity;
  discoverIdentities: (options?: Record<string, unknown>) => Promise<Identity[]>;
  buildRegisterSessionRequest: () => Buffer;
  parseRegisterSessionResponse: (buffer: Buffer) => {
    sessionHandle: number;
    protocolVersion: number;
  };
  buildSendRRDataRequest: (options: Record<string, unknown>) => Buffer;
  parseSendRRDataResponse: (buffer: Buffer, expected?: number) => Buffer;
  validateExplicitRequest: (request: unknown) => Buffer;
};

const {
  ENIP_PORT,
  ENCAP_HEADER_LENGTH,
  COMMAND_LIST_IDENTITY,
  COMMAND_REGISTER_SESSION,
  COMMAND_SEND_RR_DATA,
  CPF_ITEM_UNCONNECTED_DATA,
  MAX_CIP_REQUEST_BYTES,
  EnipSession,
  isValidIpv4,
  buildEncapsulation,
  parseEncapsulation,
  parseListIdentityResponse,
  discoverIdentities,
  parseRegisterSessionResponse,
  buildSendRRDataRequest,
  parseSendRRDataResponse,
  validateExplicitRequest,
} = transport;

// --- Frame builders for the fake endpoints ---------------------------------

function buildIdentityResponse(overrides: Partial<Identity> = {}): Buffer {
  const productName = overrides.productName ?? 'LSN Dev Controller';
  const nameBuf = Buffer.from(productName, 'latin1');
  const item = Buffer.alloc(2 + 16 + 2 + 2 + 2 + 2 + 2 + 4 + 1 + nameBuf.length + 1);
  let p = 0;
  item.writeUInt16LE(1, p); // encap protocol version
  p += 2;
  // sockaddr_in: family(2 BE), port(2 BE), addr(4 BE), zero(8)
  item.writeUInt16BE(2, p); // AF_INET
  item.writeUInt16BE(overrides.socketPort ?? ENIP_PORT, p + 2);
  const addr = (overrides.socketAddress ?? '192.168.1.50').split('.').map(Number);
  item[p + 4] = addr[0];
  item[p + 5] = addr[1];
  item[p + 6] = addr[2];
  item[p + 7] = addr[3];
  p += 16;
  item.writeUInt16LE(overrides.vendorId ?? 0x1234, p);
  p += 2;
  item.writeUInt16LE(overrides.deviceType ?? 0x000c, p);
  p += 2;
  item.writeUInt16LE(overrides.productCode ?? 0x0001, p);
  p += 2;
  item[p] = 1; // rev major
  item[p + 1] = 2; // rev minor
  p += 2;
  item.writeUInt16LE(overrides.status ?? 0x0000, p);
  p += 2;
  item.writeUInt32LE(overrides.serialNumber ?? 0xdeadbeef, p);
  p += 4;
  item[p] = nameBuf.length;
  p += 1;
  nameBuf.copy(item, p);
  p += nameBuf.length;
  item[p] = overrides.state ?? 3;

  const cpf = Buffer.alloc(2 + 4 + item.length);
  cpf.writeUInt16LE(1, 0); // item count
  cpf.writeUInt16LE(transport.CPF_ITEM_IDENTITY, 2);
  cpf.writeUInt16LE(item.length, 4);
  item.copy(cpf, 6);

  return buildEncapsulation({ command: COMMAND_LIST_IDENTITY, data: cpf });
}

function buildRegisterSessionResponse(sessionHandle: number): Buffer {
  const body = Buffer.alloc(4);
  body.writeUInt16LE(1, 0);
  body.writeUInt16LE(0, 2);
  return buildEncapsulation({
    command: COMMAND_REGISTER_SESSION,
    sessionHandle,
    data: body,
  });
}

function buildSendRRDataResponse(
  sessionHandle: number,
  cipReply: Buffer,
): Buffer {
  const head = Buffer.alloc(6 + 2 + 4 + 4);
  let o = 0;
  head.writeUInt32LE(0, o);
  o += 4;
  head.writeUInt16LE(0, o);
  o += 2;
  head.writeUInt16LE(2, o); // item count
  o += 2;
  head.writeUInt16LE(0x0000, o); // null address item
  o += 2;
  head.writeUInt16LE(0, o);
  o += 2;
  head.writeUInt16LE(CPF_ITEM_UNCONNECTED_DATA, o);
  o += 2;
  head.writeUInt16LE(cipReply.length, o);
  return buildEncapsulation({
    command: COMMAND_SEND_RR_DATA,
    sessionHandle,
    data: Buffer.concat([head, cipReply]),
  });
}

// --- Fake endpoint lifecycles ----------------------------------------------

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

function startFakeUdp(
  handler: (msg: Buffer, socket: dgram.Socket, rinfo: dgram.RemoteInfo) => void,
): Promise<number> {
  const socket = dgram.createSocket('udp4');
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        try {
          socket.close(() => resolve());
        } catch {
          resolve();
        }
      }),
  );
  socket.on('message', (msg, rinfo) => handler(msg, socket, rinfo));
  return new Promise((resolve) => {
    socket.bind(0, '127.0.0.1', () => resolve(socket.address().port));
  });
}

function startFakeTcp(
  handler: (data: Buffer, socket: net.Socket) => void,
): Promise<number> {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= ENCAP_HEADER_LENGTH) {
        const len = buffer.readUInt16LE(2);
        const total = ENCAP_HEADER_LENGTH + len;
        if (buffer.length < total) break;
        const frame = buffer.subarray(0, total);
        buffer = buffer.subarray(total);
        handler(Buffer.from(frame), socket);
      }
    });
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

/**
 * Build a tcpFactory that returns a fresh unconnected socket whose connect()
 * is redirected to the fake endpoint's ephemeral localhost port. This lets the
 * session drive the connect handshake while ignoring the fixed 44818 port.
 */
function tcpFactoryTo(port: number) {
  return () => {
    const socket = new net.Socket();
    const originalConnect = socket.connect.bind(socket);
    socket.connect = ((..._args: unknown[]) => {
      const cb = _args.find((a) => typeof a === 'function') as
        | (() => void)
        | undefined;
      return originalConnect({ port, host: '127.0.0.1' }, cb);
    }) as typeof socket.connect;
    return socket;
  };
}

/** Discovery helper that lets us target a specific UDP port on localhost. */
function discoverAt(port: number, options: Record<string, unknown> = {}) {
  const udpFactory = () => {
    const socket = dgram.createSocket('udp4');
    const originalSend = socket.send.bind(socket);
    // Redirect the request to our fake endpoint's ephemeral port.
    socket.send = ((msg: Buffer, _p: number, addr: string, cb?: (e?: Error) => void) =>
      originalSend(msg, port, '127.0.0.1', cb)) as typeof socket.send;
    return socket;
  };
  return discoverIdentities({ udpFactory, timeoutMs: 300, ...options });
}

// --- IPv4 validation --------------------------------------------------------

describe('IPv4 validation', () => {
  it('accepts dotted quads and rejects everything else', () => {
    expect(isValidIpv4('192.168.1.1')).toBe(true);
    expect(isValidIpv4('10.0.0.255')).toBe(true);
    expect(isValidIpv4('256.1.1.1')).toBe(false);
    expect(isValidIpv4('192.168.1')).toBe(false);
    expect(isValidIpv4('example.com')).toBe(false);
    expect(isValidIpv4('')).toBe(false);
  });
});

// --- Encapsulation round-trip ----------------------------------------------

describe('encapsulation header', () => {
  it('round-trips a 24-byte header with data', () => {
    const frame = buildEncapsulation({
      command: 0x0063,
      sessionHandle: 0x11223344,
      data: Buffer.from([1, 2, 3]),
    });
    expect(frame.length).toBe(ENCAP_HEADER_LENGTH + 3);
    const parsed = parseEncapsulation(frame);
    expect(parsed.command).toBe(0x0063);
    expect(parsed.sessionHandle).toBe(0x11223344);
    expect(parsed.data).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects a length mismatch', () => {
    const frame = buildEncapsulation({ command: 0x0063, data: Buffer.from([1]) });
    frame.writeUInt16LE(99, 2); // corrupt declared length
    expect(() => parseEncapsulation(frame)).toThrow(/length/i);
  });

  it('rejects a short buffer', () => {
    expect(() => parseEncapsulation(Buffer.alloc(10))).toThrow(/shorter/i);
  });
});

// --- Discovery --------------------------------------------------------------

describe('ListIdentity discovery', () => {
  it('collects unique candidates from valid responses', async () => {
    const port = await startFakeUdp((msg, socket, rinfo) => {
      const parsed = parseEncapsulation(msg);
      expect(parsed.command).toBe(COMMAND_LIST_IDENTITY);
      const reply = buildIdentityResponse({ socketAddress: '192.168.1.50' });
      socket.send(reply, rinfo.port, rinfo.address);
      // Send a duplicate; should be de-duplicated by source address.
      socket.send(reply, rinfo.port, rinfo.address);
    });
    const results = await discoverAt(port);
    expect(results.length).toBe(1);
    expect(results[0].productName).toBe('LSN Dev Controller');
    expect(results[0].vendorId).toBe(0x1234);
    expect(results[0].serialNumber).toBe(0xdeadbeef);
  });

  it('rejects malformed responses without failing the scan', async () => {
    const port = await startFakeUdp((_msg, socket, rinfo) => {
      socket.send(Buffer.from([0xff, 0xff, 0x00]), rinfo.port, rinfo.address);
    });
    const results = await discoverAt(port);
    expect(results).toEqual([]);
  });

  it('supports a manual IPv4 probe target', async () => {
    let receivedAsUnicast = false;
    const port = await startFakeUdp((msg, socket, rinfo) => {
      receivedAsUnicast = true;
      socket.send(buildIdentityResponse(), rinfo.port, rinfo.address);
    });
    const results = await discoverAt(port, { address: '127.0.0.1' });
    expect(receivedAsUnicast).toBe(true);
    expect(results.length).toBe(1);
  });

  it('rejects an invalid manual probe address', async () => {
    await expect(discoverIdentities({ address: 'not-an-ip' })).rejects.toThrow(
      /IPv4/i,
    );
  });

  it('times out cleanly with no responder', async () => {
    const port = await startFakeUdp(() => {
      /* silent responder */
    });
    const results = await discoverAt(port, { timeoutMs: 150 });
    expect(results).toEqual([]);
  });

  it('parses the Identity Item socket address', () => {
    const identity = parseListIdentityResponse(
      buildIdentityResponse({ socketAddress: '10.20.30.40' }),
    );
    expect(identity.socketAddress).toBe('10.20.30.40');
    expect(identity.revision).toBe('1.2');
  });
});

// --- Session (TCP) ----------------------------------------------------------

const matchingIdentityDiscover = async ({ address }: { address: string }) => [{
  sourceAddress: address,
  socketAddress: address,
  vendorId: 1,
  deviceType: 2,
  productCode: 3,
  serialNumber: 4,
  productName: 'Test Controller',
  revision: '1.0',
}];

describe('EnipSession', () => {
  it('rejects a manual address when ListIdentity comes from another endpoint', async () => {
    const tcpFactory = vi.fn(() => new net.Socket());
    const session = new EnipSession({
      tcpFactory,
      identityDiscover: async () => [{
        sourceAddress: '127.0.0.2',
        socketAddress: '127.0.0.2',
        vendorId: 1,
        deviceType: 2,
        productCode: 3,
        serialNumber: 4,
      }],
    });
    await expect(session.connect('127.0.0.1')).rejects.toThrow(/requested endpoint/i);
    expect(tcpFactory).not.toHaveBeenCalled();
  });

  it('connects and RegisterSession yields a non-zero handle', async () => {
    const port = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(buildRegisterSessionResponse(0xabcd1234));
      }
    });
    const session = new EnipSession({
      tcpFactory: tcpFactoryTo(port),
      identityDiscover: matchingIdentityDiscover,
    });
    const state = await session.connect('127.0.0.1');
    expect(state.connected).toBe(true);
    expect(state.sessionHandle).toBe(0xabcd1234);
    expect(session.isConnected()).toBe(true);
    await session.disconnect();
    expect(session.isConnected()).toBe(false);
    expect(session.getState().state).toBe('disconnected');
  });

  it('rejects a zero session handle', async () => {
    const port = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(buildRegisterSessionResponse(0));
      }
    });
    const session = new EnipSession({
      tcpFactory: tcpFactoryTo(port),
      identityDiscover: matchingIdentityDiscover,
    });
    await expect(session.connect('127.0.0.1')).rejects.toThrow(/zero session/i);
    expect(session.isConnected()).toBe(false);
    expect(session.getState().state).toBe('disconnected');
  });

  it('disconnects and reconnects cleanly', async () => {
    let handle = 0x1000;
    const port = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(buildRegisterSessionResponse((handle += 1)));
      }
    });
    const session = new EnipSession({
      tcpFactory: tcpFactoryTo(port),
      identityDiscover: matchingIdentityDiscover,
    });
    await session.connect('127.0.0.1');
    await session.disconnect();
    const state = await session.connect('127.0.0.1');
    expect(state.connected).toBe(true);
    await session.disconnect();
  });

  it('times out a silent RegisterSession and reports disconnected', async () => {
    const port = await startFakeTcp(() => {
      /* never reply */
    });
    const session = new EnipSession({
      requestTimeoutMs: 150,
      tcpFactory: tcpFactoryTo(port),
      identityDiscover: matchingIdentityDiscover,
    });
    await expect(session.connect('127.0.0.1')).rejects.toThrow(/timed out/i);
    expect(session.isConnected()).toBe(false);
  });

  it('does not retain connected state after a socket close', async () => {
    const port = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(buildRegisterSessionResponse(0x55));
        setTimeout(() => socket.destroy(), 20);
      }
    });
    const session = new EnipSession({
      tcpFactory: tcpFactoryTo(port),
      identityDiscover: matchingIdentityDiscover,
    });
    await session.connect('127.0.0.1');
    await new Promise((r) => setTimeout(r, 60));
    expect(session.isConnected()).toBe(false);
    expect(session.getState().state).toBe('disconnected');
  });

  it('performs a validated explicit SendRRData request', async () => {
    const cipReply = Buffer.from([0x80, 0x00, 0x00, 0x00, 0x42]);
    const port = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(buildRegisterSessionResponse(0x777));
      } else if (parsed.command === COMMAND_SEND_RR_DATA) {
        socket.write(buildSendRRDataResponse(parsed.sessionHandle, cipReply));
      }
    });
    const session = new EnipSession({
      tcpFactory: tcpFactoryTo(port),
      identityDiscover: matchingIdentityDiscover,
    });
    await session.connect('127.0.0.1');
    const reply = await session.sendExplicit({ cipRequest: [0x0e, 0x03, 0x20, 0x01] });
    expect(Buffer.from(reply)).toEqual(cipReply);
    await session.disconnect();
  });

  it('refuses an explicit request while disconnected', async () => {
    const session = new EnipSession();
    await expect(
      session.sendExplicit({ cipRequest: [0x0e] }),
    ).rejects.toThrow(/not connected/i);
  });
});

// --- SendRRData framing/validation -----------------------------------------

describe('SendRRData framing and validation', () => {
  it('frames a CIP request with the standard CPF items', () => {
    const frame = buildSendRRDataRequest({
      sessionHandle: 0x1234,
      cipRequest: Buffer.from([0x0e, 0x03, 0x20, 0x01, 0x24, 0x01]),
    });
    const parsed = parseEncapsulation(frame);
    expect(parsed.command).toBe(COMMAND_SEND_RR_DATA);
    expect(parsed.sessionHandle).toBe(0x1234);
    // interface handle(4) + timeout(2) + item count(2) = 8, count == 2
    expect(parsed.data.readUInt16LE(6)).toBe(2);
  });

  it('rejects an empty CIP request', () => {
    expect(() =>
      buildSendRRDataRequest({ sessionHandle: 1, cipRequest: [] }),
    ).toThrow(/non-empty/i);
  });

  it('rejects an oversized CIP request', () => {
    expect(() =>
      buildSendRRDataRequest({
        sessionHandle: 1,
        cipRequest: new Uint8Array(MAX_CIP_REQUEST_BYTES + 1),
      }),
    ).toThrow(/size limit/i);
  });

  it('rejects a zero session handle', () => {
    expect(() =>
      buildSendRRDataRequest({ sessionHandle: 0, cipRequest: [1] }),
    ).toThrow(/session handle/i);
  });

  it('validates an explicit request descriptor', () => {
    expect(() => validateExplicitRequest({ cipRequest: [1, 2, 3] })).not.toThrow();
    expect(() => validateExplicitRequest({})).toThrow(/cipRequest/i);
    expect(() =>
      validateExplicitRequest({ cipRequest: new Uint8Array(MAX_CIP_REQUEST_BYTES + 1) }),
    ).toThrow(/size limit/i);
    expect(() =>
      validateExplicitRequest({ cipRequest: [1], path: new Uint8Array(200) }),
    ).toThrow(/path/i);
  });

  it('parses a SendRRData reply and extracts CIP bytes', () => {
    const reply = buildSendRRDataResponse(0x99, Buffer.from([0x8e, 0x00, 0x00, 0x00]));
    const cip = parseSendRRDataResponse(reply, 0x99);
    expect(cip).toEqual(Buffer.from([0x8e, 0x00, 0x00, 0x00]));
  });

  it('parses a RegisterSession reply', () => {
    const parsed = parseRegisterSessionResponse(buildRegisterSessionResponse(0x42));
    expect(parsed.sessionHandle).toBe(0x42);
    expect(parsed.protocolVersion).toBe(1);
  });
});
