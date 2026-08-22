import { describe, expect, it } from 'vitest';
import {
  applyInputsToSandboxDocument,
  computeReviewDigest,
  deriveSandboxInputs,
  readInputsFromSandboxDocument,
  runSandboxSimulation,
  type ReviewSandboxInputs,
} from '../src/lib/client-review-sandbox';
import type { DeviceProfileDocument } from '../src/lib/profile-validation';

function makeSnapshot(): DeviceProfileDocument {
  return {
    profileVersion: '0.1.0',
    protocolVersion: 'LSN v0.1',
    hardwareFamily: 'WT32-ETH01',
    capabilities: {
      interlock: { enabled: false, phase: 'future', description: '' },
      remoteStop: { enabled: false, phase: 'future', description: '' },
      sensors: { enabled: false, phase: 'future', description: '' },
    },
    timing: {
      explicitMessageTimeoutMs: 1000,
      reconnectIntervalMs: 2000,
      runtimeToleranceMs: 250,
    },
    fields: [
      {
        symbolicName: 'EmissionEnableRequest',
        direction: 'PC_TO_LSN',
        dataType: 'boolean',
        access: 'WRITE',
        implementationStatus: 'TBD',
        simulationStatus: 'VERIFIED',
        expectedFirmwareBehavior: 'Validate the request.',
        expectedReportedResponse: 'Requested state is acknowledged.',
      },
    ],
  };
}

describe('deriveSandboxInputs', () => {
  it('derives isolated inputs from the snapshot without mutating it', () => {
    const snapshot = makeSnapshot();
    const inputs = deriveSandboxInputs(snapshot);
    expect(inputs.timeoutMs).toBe(1000);
    expect(inputs.toleranceMs).toBe(250);
    expect(inputs.requestedPacketIntervalMs).toBe(500);
    expect(inputs.representativeField).toBe('EmissionEnableRequest');
    expect(inputs.expectedResponseOverride).toBe('');
    // snapshot untouched
    expect((snapshot.timing as Record<string, unknown>).requestedPacketIntervalMs).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(deriveSandboxInputs(makeSnapshot())).toEqual(
      deriveSandboxInputs(makeSnapshot()),
    );
  });
});

describe('runSandboxSimulation', () => {
  it('passes when all edited inputs are internally consistent', () => {
    const inputs = deriveSandboxInputs(makeSnapshot());
    const result = runSandboxSimulation(makeSnapshot(), inputs);
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails when RPI is out of the supported window', () => {
    const inputs: ReviewSandboxInputs = {
      ...deriveSandboxInputs(makeSnapshot()),
      requestedPacketIntervalMs: 999999,
    };
    const result = runSandboxSimulation(makeSnapshot(), inputs);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'rpi-range')?.passed).toBe(false);
  });

  it('fails when timeout does not exceed the RPI', () => {
    const inputs: ReviewSandboxInputs = {
      ...deriveSandboxInputs(makeSnapshot()),
      requestedPacketIntervalMs: 500,
      timeoutMs: 500,
    };
    const result = runSandboxSimulation(makeSnapshot(), inputs);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'timeout-vs-rpi')?.passed).toBe(false);
  });

  it('fails when tolerance exceeds one packet interval', () => {
    const inputs: ReviewSandboxInputs = {
      ...deriveSandboxInputs(makeSnapshot()),
      requestedPacketIntervalMs: 500,
      toleranceMs: 600,
    };
    const result = runSandboxSimulation(makeSnapshot(), inputs);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'tolerance-range')?.passed).toBe(false);
  });

  it('fails when the representative field does not exist', () => {
    const inputs: ReviewSandboxInputs = {
      ...deriveSandboxInputs(makeSnapshot()),
      representativeField: 'DoesNotExist',
    };
    const result = runSandboxSimulation(makeSnapshot(), inputs);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.id === 'field-exists')?.passed).toBe(false);
    // expected-response also fails because there is no snapshot value to fall back to
    expect(result.checks.find((c) => c.id === 'expected-response')?.passed).toBe(false);
  });

  it('honors a reviewer expected-response override', () => {
    const inputs: ReviewSandboxInputs = {
      ...deriveSandboxInputs(makeSnapshot()),
      expectedResponseOverride: 'Custom expectation',
    };
    const result = runSandboxSimulation(makeSnapshot(), inputs);
    const responseCheck = result.checks.find((c) => c.id === 'expected-response');
    expect(responseCheck?.passed).toBe(true);
    expect(responseCheck?.detail).toContain('Override');
  });
});

describe('applyInputsToSandboxDocument / readInputsFromSandboxDocument', () => {
  it('round-trips edited inputs through an isolated document copy', () => {
    const snapshot = makeSnapshot();
    const inputs: ReviewSandboxInputs = {
      requestedPacketIntervalMs: 100,
      timeoutMs: 800,
      toleranceMs: 40,
      representativeField: 'EmissionEnableRequest',
      expectedResponseOverride: 'Reviewer override text',
    };
    const doc = applyInputsToSandboxDocument(snapshot, inputs);
    // original snapshot is not mutated
    expect((snapshot.timing as Record<string, unknown>).explicitMessageTimeoutMs).toBe(1000);
    expect(doc).not.toBe(snapshot);

    const restored = readInputsFromSandboxDocument(snapshot, doc);
    expect(restored).toEqual(inputs);
  });

  it('falls back to derived inputs when no sandbox document exists', () => {
    const snapshot = makeSnapshot();
    expect(readInputsFromSandboxDocument(snapshot, undefined)).toEqual(
      deriveSandboxInputs(snapshot),
    );
  });
});

describe('computeReviewDigest', () => {
  it('is stable and order-independent for the same content', () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    expect(computeReviewDigest(a)).toBe(computeReviewDigest(b));
  });

  it('changes when snapshot content changes', () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    (b.timing as Record<string, unknown>).explicitMessageTimeoutMs = 2000;
    expect(computeReviewDigest(a)).not.toBe(computeReviewDigest(b));
  });
});
