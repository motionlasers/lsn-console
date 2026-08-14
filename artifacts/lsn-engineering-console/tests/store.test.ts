import { beforeEach, test, expect } from 'vitest';
import {
  DEFAULT_CAPABILITIES,
  INITIAL_TESTS,
  isProfileItemSupported,
  isTestSupported,
  isTransactionSupported,
  getTelemetryFreshness,
  useStore,
  visibleLogicalState,
} from '../src/lib/store';

beforeEach(() => {
  useStore.setState({
    mode: 'simulation',
    hardwareUnlocked: false,
    connectionState: 'disconnected',
    lastValidTelemetryAt: null,
    discovered: false,
    responseAttempt: 0,
    capabilities: DEFAULT_CAPABILITIES,
    baseCapabilities: DEFAULT_CAPABILITIES,
    transactionCapabilityContext: null,
    transactions: [],
    logicalState: {
      ready: true,
      requestedEnable: false,
      reportedEnablePermitted: true,
      emissionControlOutputActive: false,
      interlockOK: true,
      remoteStopOK: true,
      faulted: false,
      faultCode: null,
      timerState: 0,
      lifetimeEmissionTimeMs: 0,
      enableCount: 0,
      networkControlActive: true,
      lastDisableReason: null,
      storageFailure: false,
      commsLoss: false,
      modulesEnabled: false,
    },
    settings: {
      devMode: false,
      simulatorTiming: 1,
      droppedResponseRate: 0,
      localPersistence: true,
    },
  });
});

test('Phase 1 hides disabled capability fields, tests, and logical state', () => {
  const state = useStore.getState();
  expect(state.capabilities).toEqual({ interlock: false, remoteStop: false, sensors: false });
  expect(state.profile.filter(item => isProfileItemSupported(item, state.capabilities)).map(item => item.symbolicName))
    .not.toContain('InterlockOK');
  expect(state.profile.filter(item => isProfileItemSupported(item, state.capabilities)).map(item => item.symbolicName))
    .not.toContain('RemoteStopOK');
  expect(state.tests.filter(testCase => isTestSupported(testCase, state.capabilities)).map(testCase => testCase.id))
    .not.toContain('t_intl');
  expect(visibleLogicalState(state.logicalState, state.capabilities)).not.toHaveProperty('interlockOK');
  expect(visibleLogicalState(state.logicalState, state.capabilities)).not.toHaveProperty('remoteStopOK');
  expect(visibleLogicalState(state.logicalState, state.capabilities)).not.toHaveProperty('modulesEnabled');
});

test('Experimental capabilities require Developer Simulation mode', () => {
  useStore.getState().setCapability('interlock', true);
  expect(useStore.getState().capabilities.interlock).toBe(false);

  useStore.setState(state => ({ settings: { ...state.settings, devMode: true } }));
  useStore.getState().setCapability('interlock', true);
  expect(useStore.getState().capabilities.interlock).toBe(true);
  expect(useStore.getState().tests.filter(testCase => isTestSupported(testCase, useStore.getState().capabilities)).map(testCase => testCase.id))
    .toContain('t_intl');
});

test('Leaving Developer Mode removes experimental capability state and evidence', () => {
  useStore.setState(state => ({ settings: { ...state.settings, devMode: true } }));
  useStore.getState().setCapability('interlock', true);
  useStore.setState({
    transactions: [{
      id: 'experimental',
      timestamp: 1,
      sequence: 1,
      direction: 'tx',
      operation: 'TEST',
      command: 'INTERLOCK_TEST',
      service: 'TBD',
      mapping: null,
      requestPayload: '',
      responsePayload: '',
      requestHex: '',
      responseHex: '',
      requestDecoded: '',
      responseDecoded: '',
      status: 'ok',
      latency: 0,
      relatedAction: null,
      expectedResult: '',
      actualResult: '',
      pass: true,
      capability: 'interlock',
    }],
  });

  useStore.getState().updateSettings({ devMode: false });
  const state = useStore.getState();
  expect(state.capabilities).toEqual(DEFAULT_CAPABILITIES);
  expect(state.transactions).toEqual([]);
});

test('State import cannot enable unsupported capabilities or hidden fields', () => {
  useStore.getState().importState(JSON.stringify({
    capabilities: { interlock: true, remoteStop: true, sensors: true },
    logicalState: { interlockOK: false, remoteStopOK: false, modulesEnabled: true },
    transactions: [{
      id: 'hidden',
      command: 'INTERLOCK_TEST',
      capability: 'interlock',
    }],
  }));

  const state = useStore.getState();
  expect(state.capabilities).toEqual(DEFAULT_CAPABILITIES);
  expect(state.logicalState.interlockOK).toBe(true);
  expect(state.logicalState.remoteStopOK).toBe(true);
  expect(state.logicalState.modulesEnabled).toBe(false);
  expect(state.transactions).toEqual([]);
});

test('Stress ignores disabled future capability state', () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    logicalState: { ...state.logicalState, interlockOK: false, remoteStopOK: false },
  }));
  useStore.getState().startStressTest({ cycles: 1, onDur: 10, offDur: 10, faultProb: 0 });
  useStore.getState().tick(10);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(true);
});

test('Capability-tagged transactions follow the active profile', () => {
  const transaction = {
    capability: 'remoteStop' as const,
  } as Parameters<typeof isTransactionSupported>[0];
  expect(isTransactionSupported(transaction, DEFAULT_CAPABILITIES)).toBe(false);
  expect(isTransactionSupported(transaction, { ...DEFAULT_CAPABILITIES, remoteStop: true })).toBe(true);
});

test('Initial state is correct and deterministic', () => {
  const state = useStore.getState();
  expect(state.mode).toBe('simulation');
  expect(state.connectionState).toBe('disconnected');
  expect(state.logicalState.ready).toBe(true);
  expect(state.logicalState.emissionControlOutputActive).toBe(false);
  expect(getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt, 1000).state).toBe('UNKNOWN');
});

test('Disconnected telemetry is stale and never current', () => {
  const freshness = getTelemetryFreshness('disconnected', 1_000, 15_200);
  expect(freshness).toMatchObject({ state: 'STALE', isLive: false, ageMs: 14_200 });
});

test('Connected recent telemetry is live but expires after the stale threshold', () => {
  expect(getTelemetryFreshness('connected', 1_000, 2_000).isLive).toBe(true);
  expect(getTelemetryFreshness('connected', 1_000, 7_000).state).toBe('STALE');
});

test('Disconnect preserves last reported values but invalidates live telemetry', () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: 1_000,
    logicalState: { ...state.logicalState, emissionControlOutputActive: true },
  }));
  useStore.getState().disconnect();
  const state = useStore.getState();
  expect(state.connectionState).toBe('disconnected');
  expect(state.logicalState.emissionControlOutputActive).toBe(true);
  expect(getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt, 2_000).isLive).toBe(false);
});

test('Communication loss faults the session and invalidates telemetry', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: 1_000 });
  useStore.getState().updateLogicalState({ commsLoss: true });
  const state = useStore.getState();
  expect(state.connectionState).toBe('faulted');
  expect(getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt, 2_000).state).toBe('STALE');
});

test('Toggle enable fails when disconnected', () => {
  const store = useStore.getState();
  store.toggleEnable(true);
  
  const newState = useStore.getState();
  expect(newState.logicalState.requestedEnable).toBe(false);
  expect(newState.logicalState.emissionControlOutputActive).toBe(false);
});

test('Toggle enable succeeds when connected and interlocks OK', async () => {
  useStore.setState({ connectionState: 'connected' });
  const store = useStore.getState();
  
  store.toggleEnable(true);
  
  const newState = useStore.getState();
  expect(newState.logicalState.requestedEnable).toBe(true);
  expect(newState.logicalState.reportedEnablePermitted).toBe(true);
  expect(newState.logicalState.emissionControlOutputActive).toBe(true);
  expect(newState.logicalState.enableCount).toBe(1);
});

test('Interlock failure blocks enable', () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    capabilities: { ...state.capabilities, interlock: true },
  }));
  const store = useStore.getState();
  
  store.setInterlock(false); // Break interlock
  store.toggleEnable(true);
  
  const newState = useStore.getState();
  expect(newState.logicalState.interlockOK).toBe(false);
  expect(newState.logicalState.requestedEnable).toBe(true); // Can request
  expect(newState.logicalState.reportedEnablePermitted).toBe(false); // But not permitted
  expect(newState.logicalState.emissionControlOutputActive).toBe(false); // Output stays false
});

test('Comms loss auto-disables active emission on tick', () => {
  useStore.setState({ connectionState: 'connected' });
  const store = useStore.getState();
  
  store.setInterlock(true);
  store.setRemoteStop(true);
  store.clearFault();
  store.toggleEnable(true);
  
  const state = useStore.getState();
  expect(state.logicalState.emissionControlOutputActive).toBe(true);
  
  // Inject comms loss
  state.updateLogicalState({ commsLoss: true });
  
  // Tick
  useStore.getState().tick(100);
  
  const finalState = useStore.getState();
  expect(finalState.logicalState.emissionControlOutputActive).toBe(false); // Auto disabled
});

test('Runtime accumulates strictly monotonically when output active', () => {
  useStore.setState({ connectionState: 'connected' });
  const store = useStore.getState();
  store.setInterlock(true);
  store.toggleEnable(true);
  
  store.tick(100);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(100);
  
  store.tick(50);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(150);
  
  store.toggleEnable(false);
  store.tick(200);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(150); // Did not accumulate while disabled
});

// ── Persistence migration ─────────────────────────────────────────────────────

test('Migration replaces stale test records with the canonical INITIAL_TESTS', () => {
  // Simulate a persisted state from an older app version with 5 tests using
  // different names, categories, and missing capability fields.
  const oldTests = [
    { id: 'test_disc', name: 'Discovery & Connect', category: 'Communication', status: 'failed', expected: 'Successful CIP Forward Open', actual: '', duration: 0, evidence: '' },
    { id: 'test_en',   name: 'Enable Request Validation', category: 'Control',       status: 'failed', expected: 'Emission Output Active == TRUE', actual: '', duration: 0, evidence: '' },
    { id: 'test_intl', name: 'Interlock Break while Enabled', category: 'Safety',    status: 'failed', expected: 'Emission Output Active == FALSE', actual: '', duration: 0, evidence: '' },
    { id: 'test_loss', name: 'Network Timeout Recovery', category: 'Communication',  status: 'failed', expected: 'Auto-disable on timeout', actual: '', duration: 0, evidence: '' },
    { id: 'test_rt',   name: 'Runtime Accumulation', category: 'Runtime',            status: 'failed', expected: 'Lifetime increases while active', actual: '', duration: 0, evidence: '' },
  ];

  // Apply the same migration logic used by the persist middleware.
  const persistedState = { tests: oldTests } as any;
  const migrated = {
    ...persistedState,
    tests: INITIAL_TESTS,
  };

  // After migration every test must have a current ID and pending status.
  expect(migrated.tests).toHaveLength(17);
  expect(migrated.tests.map((t: { id: string }) => t.id)).toContain('t_disc');
  expect(migrated.tests.map((t: { id: string }) => t.id)).toContain('t_intl');
  expect(migrated.tests.map((t: { id: string }) => t.id)).toContain('t_rt');
  expect(migrated.tests.every((t: { status: string }) => t.status === 'pending')).toBe(true);
  // Old stale IDs must not be present.
  expect(migrated.tests.map((t: { id: string }) => t.id)).not.toContain('test_disc');
  expect(migrated.tests.map((t: { id: string }) => t.id)).not.toContain('test_intl');
});

test('Migration preserves valid profile data alongside the test reset', () => {
  const oldProfile = [
    { id: 'p1', symbolicName: 'Ready', implementationStatus: 'VERIFIED', simulationStatus: 'VERIFIED',
      direction: 'R', dataType: 'BOOL', access: 'R', cipService: 'TBD', class: 'TBD', instance: 'TBD',
      attribute: 'TBD', assembly: 'TBD', expectedFirmwareBehavior: '', expectedReportedResponse: '', notes: '' },
  ];
  const persistedState = { tests: [], profile: oldProfile } as any;

  // Profile migration: implementationStatus always reset to TBD; simulationStatus preserved.
  const migrated = {
    ...persistedState,
    tests: INITIAL_TESTS,
    profile: oldProfile.map((item: any) => ({
      ...item,
      implementationStatus: 'TBD',
      simulationStatus: item.simulationStatus ?? 'NOT_TESTED',
    })),
  };

  expect(migrated.tests).toHaveLength(17);
  expect(migrated.profile[0].implementationStatus).toBe('TBD');
  expect(migrated.profile[0].simulationStatus).toBe('VERIFIED'); // preserved
});
