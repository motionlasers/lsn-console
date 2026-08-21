import net from 'node:net';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface State {
  state: string;
  connected: boolean;
  address: string | null;
  sessionHandle: number | null;
}

const transport = require('../electron/ethernet-ip-transport.cjs') as {
  ENCAP_HEADER_LENGTH: number;
  COMMAND_REGISTER_SESSION: number;
  EnipSession: new (options?: Record<string, unknown>) => {
    connect: (address: string) => Promise<State>;
    disconnect: () => Promise<void>;
    isConnected: () => boolean;
    getState: () => State;
  };
  buildEncapsulation: (options: Record<string, unknown>) => Buffer;
  parseEncapsulation: (buffer: Buffer) => { command: number; sessionHandle: number };
};

const { HardwareService } = require('../electron/hardware-service.cjs') as {
  HardwareService: new (options?: Record<string, unknown>) => {
    connect: (address: string) => Promise<State>;
    disconnect: () => Promise<State>;
    armControl: () => Promise<{ armed: boolean }>;
    writeEnable: (enable: boolean) => Promise<unknown>;
    getState: () => State;
  };
};

const {
  ENCAP_HEADER_LENGTH,
  COMMAND_REGISTER_SESSION,
  EnipSession,
  buildEncapsulation,
  parseEncapsulation,
} = transport;

function registerSessionResponse(handle: number): Buffer {
  const body = Buffer.alloc(4);
  body.writeUInt16LE(1, 0);
  body.writeUInt16LE(0, 2);
  return buildEncapsulation({
    command: COMMAND_REGISTER_SESSION,
    sessionHandle: handle,
    data: body,
  });
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

/**
 * Fake EtherNet/IP TCP endpoint. `onFrame` receives each decoded frame and the
 * socket, letting a test reply, stay silent, or drop the connection.
 */
function startFakeTcp(
  onFrame: (frame: Buffer, socket: net.Socket) => void,
): Promise<{ port: number; sockets: net.Socket[] }> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= ENCAP_HEADER_LENGTH) {
        const len = buffer.readUInt16LE(2);
        const total = ENCAP_HEADER_LENGTH + len;
        if (buffer.length < total) break;
        const frame = buffer.subarray(0, total);
        buffer = buffer.subarray(total);
        onFrame(Buffer.from(frame), socket);
      }
    });
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          try {
            socket.destroy();
          } catch {
            /* already gone */
          }
        }
        server.close(() => resolve());
      }),
  );
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : 0,
        sockets,
      });
    });
  });
}

/** tcpFactory returning a fresh socket redirected to the fake endpoint. */
function tcpFactoryTo(port: number) {
  return () => {
    const socket = new net.Socket();
    const originalConnect = socket.connect.bind(socket);
    socket.connect = ((..._args: unknown[]) => {
      const cb = _args.find((a) => typeof a === 'function') as (() => void) | undefined;
      return originalConnect({ port, host: '127.0.0.1' }, cb);
    }) as typeof socket.connect;
    return socket;
  };
}

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

// A resolved profile fixture so armControl / writeEnable are reachable.
function boolReadField(symbolicName: string, attribute: number) {
  return {
    symbolicName,
    direction: 'LSN_TO_PC',
    access: 'READ',
    cipService: '0x0E',
    class: 0x64,
    instance: 1,
    attribute,
    implementationStatus: 'IMPLEMENTED',
    wireType: 'bool8',
  };
}
function resolvedProfileFixture() {
  return {
    profile: {
      profileVersion: '9.9.9-test',
      protocolVersion: 'LSN test',
      identity: {
        vendorId: 1,
        deviceType: 2,
        productCode: 3,
        mappingState: 'VERIFIED',
      },
      capabilities: {
        interlock: { enabled: false, phase: 'future', description: '' },
        remoteStop: { enabled: false, phase: 'future', description: '' },
      },
      fields: [
        boolReadField('Ready', 10),
        boolReadField('Faulted', 11),
        boolReadField('EmissionControlOutputActive', 12),
        {
          symbolicName: 'EmissionEnableRequest',
          direction: 'PC_TO_LSN',
          access: 'WRITE',
          cipService: '0x10',
          class: 0x64,
          instance: 1,
          attribute: 20,
          implementationStatus: 'IMPLEMENTED',
          wireType: 'bool8',
        },
        { ...boolReadField('InterlockOK', 13), capability: 'interlock' },
        { ...boolReadField('RemoteStopOK', 14), capability: 'remoteStop' },
      ],
    },
    digest: 'fixture-digest',
  };
}

describe('EnipSession sanitized onStateChange', () => {
  it('emits connecting then connected, and disconnected on socket close', async () => {
    const events: State[] = [];
    const fake = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(registerSessionResponse(0x321));
        // Drop the connection shortly after establishing it.
        setTimeout(() => socket.destroy(), 20);
      }
    });
    const session = new EnipSession({
      tcpFactory: tcpFactoryTo(fake.port),
      identityDiscover: matchingIdentityDiscover,
      onStateChange: (state: State) => events.push(state),
    });
    await session.connect('127.0.0.1');
    await new Promise((r) => setTimeout(r, 80));

    const sequence = events.map((e) => e.state);
    expect(sequence).toEqual(['connecting', 'connected', 'disconnected']);
    // Exactly one connected event (no duplicate/false connected broadcasts).
    expect(events.filter((e) => e.connected === true)).toHaveLength(1);
    // The final disconnected event carries no stale identity.
    const last = events[events.length - 1];
    expect(last.connected).toBe(false);
    expect(last.address).toBeNull();
    expect(last.sessionHandle).toBeNull();
    expect(session.isConnected()).toBe(false);
  });

  it('emits a single disconnected on request timeout during connect', async () => {
    const events: State[] = [];
    const fake = await startFakeTcp(() => {
      /* never reply to RegisterSession */
    });
    const session = new EnipSession({
      requestTimeoutMs: 100,
      tcpFactory: tcpFactoryTo(fake.port),
      identityDiscover: matchingIdentityDiscover,
      onStateChange: (state: State) => events.push(state),
    });
    await expect(session.connect('127.0.0.1')).rejects.toThrow(/timed out/i);
    const sequence = events.map((e) => e.state);
    expect(sequence).toEqual(['connecting', 'disconnected']);
    expect(events.filter((e) => e.connected === true)).toHaveLength(0);
  });
});

describe('HardwareService propagates transport loss', () => {
  it('broadcasts disconnected and clears arm on async socket close', async () => {
    const broadcasts: State[] = [];
    let dropSocket: (() => void) | null = null;
    const fake = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(registerSessionResponse(0x777));
        dropSocket = () => socket.destroy();
      }
    });
    const service = new HardwareService({
      profileLoader: resolvedProfileFixture,
      confirmArm: async () => true,
      onStateChange: (state: State) => broadcasts.push(state),
      sessionFactory: (options?: Record<string, unknown>) =>
        new EnipSession({
          ...options,
          tcpFactory: tcpFactoryTo(fake.port),
          identityDiscover: matchingIdentityDiscover,
        }),
    });

    await service.connect('127.0.0.1');
    expect(service.getState().connected).toBe(true);
    const armed = await service.armControl();
    expect(armed.armed).toBe(true);

    // Simulate transport loss: the device drops the TCP connection.
    dropSocket?.();
    await new Promise((r) => setTimeout(r, 80));

    // The renderer received a disconnected broadcast without polling.
    const last = broadcasts[broadcasts.length - 1];
    expect(last.connected).toBe(false);
    expect(last.state).toBe('disconnected');
    // No duplicate connected broadcasts.
    expect(broadcasts.filter((b) => b.connected === true)).toHaveLength(1);
    expect(service.getState().connected).toBe(false);

    // The arm token was cleared: a subsequent enable is refused as unarmed
    // (also blocked by disconnection). Prove arm is gone by reconnecting.
    // Reconnect uses a fresh session; an enable without a new arm must fail.
    await service.connect('127.0.0.1');
    await expect(service.writeEnable(true)).rejects.toThrow(/not armed/i);
    await service.disconnect();
  });

  it('broadcasts disconnected and clears arm on async request timeout', async () => {
    const broadcasts: State[] = [];
    let firstFrame = true;
    const fake = await startFakeTcp((frame, socket) => {
      const parsed = parseEncapsulation(frame);
      if (parsed.command === COMMAND_REGISTER_SESSION) {
        socket.write(registerSessionResponse(0x999));
      } else if (firstFrame) {
        // Go silent on the first explicit request -> request timeout.
        firstFrame = false;
      }
    });
    const service = new HardwareService({
      profileLoader: resolvedProfileFixture,
      confirmArm: async () => true,
      onStateChange: (state: State) => broadcasts.push(state),
      sessionFactory: (options?: Record<string, unknown>) =>
        new EnipSession({
          ...options,
          requestTimeoutMs: 100,
          tcpFactory: tcpFactoryTo(fake.port),
          identityDiscover: matchingIdentityDiscover,
        }),
    });

    await service.connect('127.0.0.1');
    await service.armControl();

    // The enable preflight read will time out -> session resets to disconnected.
    await expect(service.writeEnable(true)).rejects.toThrow(/timed out/i);
    await new Promise((r) => setTimeout(r, 20));

    const last = broadcasts[broadcasts.length - 1];
    expect(last.connected).toBe(false);
    expect(last.state).toBe('disconnected');
    expect(service.getState().connected).toBe(false);
  });
});
