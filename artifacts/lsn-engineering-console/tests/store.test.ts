import { beforeEach, test, expect } from 'vitest';
import {
  DEFAULT_CAPABILITIES,
  INITIAL_TESTS,
  TimerState,
  deriveTimerState,
  isProfileItemSupported,
  isTestSupported,
  isTransactionSupported,
  getTelemetryFreshness,
  migratePersistedLsnState,
  useStore,
  visibleLogicalState,
  type RuntimeSessionState,
  type TimerTestResult,
  type PersistenceTestResult,
  type StressTestState,
} from '../src/lib/store';

const INITIAL_RUNTIME_SESSION: RuntimeSessionState = {
  firstReading: null,
  lastReading: null,
  observation: {
    active: false,
    startedAt: null,
    stoppedAt: null,
    startRuntimeMs: 0,
    currentRuntimeMs: 0,
    startEnableCount: 0,
    currentEnableCount: 0,
    elapsedPcMs: 0,
    lsnIncreaseMs: 0,
    differenceMs: 0,
    samples: [],
    sampleAccumMs: 0,
  },
};

const INITIAL_TIMER_TEST: TimerTestResult = {
  status: 'idle', startedAt: null, finishedAt: null, startRuntimeMs: 0, endRuntimeMs: 0,
  lsnIncreaseMs: 0, pcMeasuredMs: 0, differenceMs: 0, toleranceMs: 50,
  deviceQuantumMs: 10, deviceTicksAccrued: 0, cleanupOk: true, conflict: false,
  continuousActiveLive: false, outputActiveAtStart: false, pass: false, notes: '',
};

const INITIAL_PERSISTENCE_TEST: PersistenceTestResult = {
  status: 'idle', phase: 'idle', startedAt: null, finishedAt: null, runtimeBeforeMs: 0, runtimeAfterMs: 0,
  differenceMs: 0, firmwareBefore: '', firmwareAfter: '', nonDecreasing: false, pass: false, manual: false, notes: '',
};

const INITIAL_STRESS_STATE: StressTestState = {
  isActive: false, completedCycles: 0, targetCycles: 0, onDuration: 0, offDuration: 0, faultProbability: 0,
  phase: 'off', phaseElapsedMs: 0, maxDuration: 0, stopOnMismatch: true, stopOnFault: true, runtimeReadEvery: 0,
  enableCountReadEvery: 0, operationDelay: 0, startedAt: null, endedAt: null, baselineRuntimeMs: 0,
  baselineEnableCount: 0, endRuntimeMs: 0, endEnableCount: 0, elapsedMs: 0, commErrors: 0, mismatches: 0,
  faults: 0, latencySamples: [], latencyMin: null, latencyMax: null, latencyAvg: null, stopReason: null, finalResult: null,
};

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
    runtimeSession: structuredClone(INITIAL_RUNTIME_SESSION),
    timerTest: structuredClone(INITIAL_TIMER_TEST),
    persistenceTest: structuredClone(INITIAL_PERSISTENCE_TEST),
    stressTestState: structuredClone(INITIAL_STRESS_STATE),
    timerOutputInterruptions: 0,
    settings: {
      devMode: false,
      simulatorTiming: 1,
      droppedResponseRate: 0,
      localPersistence: true,
      brandLogo: 'sia',
      navCollapsed: false,
    },
  });
});

test('Navigation preferences default correctly and reset together', () => {
  expect(useStore.getState().settings.brandLogo).toBe('sia');
  expect(useStore.getState().settings.navCollapsed).toBe(false);
  useStore.getState().updateSettings({ brandLogo: 'bls' });
  useStore.getState().updateSettings({ navCollapsed: true });
  expect(useStore.getState().settings.brandLogo).toBe('bls');
  expect(useStore.getState().settings.navCollapsed).toBe(true);
  useStore.getState().resetSettings();
  expect(useStore.getState().settings.brandLogo).toBe('sia');
  expect(useStore.getState().settings.navCollapsed).toBe(false);
});

test('Active profile document follows profile edits and preserves imported metadata', () => {
  const originalProfile = structuredClone(useStore.getState().profile);
  const originalDocument = structuredClone(useStore.getState().activeProfileDocument);
  const originalDevice = structuredClone(useStore.getState().device);
  try {
    const ready = useStore.getState().profile.find(item => item.symbolicName === 'Ready');
    expect(ready).toBeDefined();
    useStore.getState().updateProfileItem(ready!.id, { simulationStatus: 'TESTING' });
    expect(
      useStore.getState().activeProfileDocument.fields.find(field => field.symbolicName === 'Ready')?.simulationStatus,
    ).toBe('TESTING');

    const imported = structuredClone(originalDocument);
    imported.profileVersion = '0.1.1-test';
    imported.protocolVersion = 'LSN v0.1-test';
    imported.customHandoffMetadata = { source: 'store-test' };
    const result = useStore.getState().importProfile(JSON.stringify(imported));
    expect(result.success).toBe(true);
    expect(useStore.getState().activeProfileDocument.profileVersion).toBe('0.1.1-test');
    expect(useStore.getState().activeProfileDocument.customHandoffMetadata).toEqual({ source: 'store-test' });
    expect(useStore.getState().activeProfileDocument.modules).toEqual(imported.modules);
    expect(useStore.getState().device.protocolVersion).toBe('LSN v0.1-test');
  } finally {
    useStore.setState({
      profile: originalProfile,
      activeProfileDocument: originalDocument,
      device: originalDevice,
    });
  }
});

test('Persistence migration reconstructs the active profile document from legacy profile state', () => {
  const state = useStore.getState();
  const legacyProfile = structuredClone(state.profile);
  const ready = legacyProfile.find(item => item.symbolicName === 'Ready')!;
  ready.simulationStatus = 'TESTING';
  const migrated = migratePersistedLsnState({
    profile: legacyProfile,
    capabilities: state.capabilities,
    device: {
      ...state.device,
      profile: '0.1.legacy',
      protocolVersion: 'LSN v0.1-legacy',
      platform: 'WT32-ETH01-legacy',
    },
  }, 4);

  expect(migrated.activeProfileDocument?.profileVersion).toBe('0.1.legacy');
  expect(migrated.activeProfileDocument?.protocolVersion).toBe('LSN v0.1-legacy');
  expect(migrated.activeProfileDocument?.hardwareFamily).toBe('WT32-ETH01-legacy');
  expect(
    migrated.activeProfileDocument?.fields.find(field => field.symbolicName === 'Ready')?.simulationStatus,
  ).toBe('TESTING');
});

test('Persistence migration fills missing canonical descriptions without overwriting explicit ones', () => {
  const state = useStore.getState();
  const document = structuredClone(state.activeProfileDocument);
  const ready = document.fields.find(field => field.symbolicName === 'Ready')!;
  const faulted = document.fields.find(field => field.symbolicName === 'Faulted')!;
  delete ready.description;
  faulted.description = 'Imported custom fault description.';

  const migrated = migratePersistedLsnState({
    profile: state.profile,
    capabilities: state.capabilities,
    activeProfileDocument: document,
  }, 5);

  expect(
    migrated.activeProfileDocument?.fields.find(field => field.symbolicName === 'Ready')?.description,
  ).toBe('Reports whether LSN is initialized and ready to evaluate control requests.');
  expect(
    migrated.activeProfileDocument?.fields.find(field => field.symbolicName === 'Faulted')?.description,
  ).toBe('Imported custom fault description.');
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

test('Validation taxonomy does not expose a Safety category', () => {
  expect(INITIAL_TESTS.map(testCase => testCase.category)).not.toContain('Safety');
  expect(INITIAL_TESTS.find(testCase => testCase.id === 't_def')?.category).toBe('Startup');
  expect(INITIAL_TESTS.find(testCase => testCase.id === 't_intl')?.category).toBe('Control');
  expect(INITIAL_TESTS.find(testCase => testCase.id === 't_rem')?.category).toBe('Control');
});

test('Stress read intervals preserve periodic runtime and enable-count evidence', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().startStressTest({
    cycles: 2,
    onDur: 10,
    offDur: 10,
    faultProb: 0,
    maxDuration: 1000,
    stopOnMismatch: true,
    stopOnFault: true,
    runtimeReadEvery: 1,
    enableCountReadEvery: 2,
    operationDelay: 0,
  });
  useStore.getState().tick(100);

  const commands = useStore.getState().transactions.map(transaction => transaction.command);
  expect(commands.filter(command => command === 'STRESS_RUNTIME_READ')).toHaveLength(2);
  expect(commands.filter(command => command === 'STRESS_ENABLE_COUNT_READ')).toHaveLength(1);
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
    lastValidTelemetryAt: Date.now(),
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

test('Changing modes clears discovered and connected device state', () => {
  useStore.setState({
    connectionState: 'connected',
    discovered: true,
    lastValidTelemetryAt: 1_000,
    responseAttempt: 4,
    hardwareUnlocked: true,
  });

  useStore.getState().setMode('hardware');
  expect(useStore.getState()).toMatchObject({
    mode: 'hardware',
    connectionState: 'disconnected',
    discovered: false,
    lastValidTelemetryAt: null,
    responseAttempt: 0,
    hardwareUnlocked: false,
  });

  useStore.setState({
    connectionState: 'faulted',
    discovered: true,
    lastValidTelemetryAt: 2_000,
  });
  useStore.getState().setMode('simulation');
  expect(useStore.getState()).toMatchObject({
    mode: 'simulation',
    connectionState: 'disconnected',
    discovered: false,
    lastValidTelemetryAt: null,
  });
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

// ── INITIAL_TESTS category correction ─────────────────────────────────────────

test('Default Disabled test is categorized under Startup, not Safety', () => {
  const def = INITIAL_TESTS.find(t => t.id === 't_def');
  expect(def?.category).toBe('Startup');
  // Future capability-tagged tests remain hidden unless enabled and use Control (not Safety)
  const intl = INITIAL_TESTS.find(t => t.id === 't_intl');
  const rem = INITIAL_TESTS.find(t => t.id === 't_rem');
  expect(intl?.capability).toBe('interlock');
  expect(rem?.capability).toBe('remoteStop');
  expect(isTestSupported(intl!, DEFAULT_CAPABILITIES)).toBe(false);
  expect(isTestSupported(rem!, DEFAULT_CAPABILITIES)).toBe(false);
});

// ── timerState transitions ────────────────────────────────────────────────────

test('deriveTimerState maps NotCounting / Counting / Fault correctly', () => {
  expect(deriveTimerState({ emissionControlOutputActive: false, faulted: false, commsLoss: false }, true)).toBe(TimerState.NotCounting);
  expect(deriveTimerState({ emissionControlOutputActive: true, faulted: false, commsLoss: false }, true)).toBe(TimerState.Counting);
  // active but not live -> NotCounting
  expect(deriveTimerState({ emissionControlOutputActive: true, faulted: false, commsLoss: false }, false)).toBe(TimerState.NotCounting);
  // faulted -> Fault
  expect(deriveTimerState({ emissionControlOutputActive: true, faulted: true, commsLoss: false }, true)).toBe(TimerState.Fault);
  // comms loss -> Fault
  expect(deriveTimerState({ emissionControlOutputActive: false, faulted: false, commsLoss: true }, false)).toBe(TimerState.Fault);
});

test('tick keeps timerState consistent through enable / disable / fault', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: 1_000 });
  const store = useStore.getState();
  store.setInterlock(true);
  store.toggleEnable(true);
  store.tick(100);
  expect(useStore.getState().logicalState.timerState).toBe(TimerState.Counting);

  store.toggleEnable(false);
  store.tick(100);
  expect(useStore.getState().logicalState.timerState).toBe(TimerState.NotCounting);

  store.triggerFault('X');
  store.tick(10);
  expect(useStore.getState().logicalState.timerState).toBe(TimerState.Fault);
});

// ── Runtime read / observation ────────────────────────────────────────────────

test('runtimeRead is blocked unless connected live Simulation Mode', () => {
  // disconnected -> blocked
  expect(useStore.getState().runtimeRead()).toBeNull();
  expect(useStore.getState().runtimeSession.firstReading).toBeNull();

  // hardware -> blocked
  useStore.setState({ mode: 'hardware', connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  expect(useStore.getState().runtimeRead()).toBeNull();
});

test('runtimeRead records first + last reading with evidence', () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 1234, enableCount: 3, timerState: TimerState.NotCounting },
  }));
  const first = useStore.getState().runtimeRead();
  expect(first?.runtimeMs).toBe(1234);
  const s = useStore.getState();
  expect(s.runtimeSession.firstReading?.runtimeMs).toBe(1234);
  expect(s.runtimeSession.lastReading?.enableCount).toBe(3);
  expect(s.transactions.some(t => t.command === 'RUNTIME_READ' && t.pass)).toBe(true);

  // second read updates last but not first
  useStore.setState(state => ({ logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 2000 } }));
  useStore.getState().runtimeRead();
  const s2 = useStore.getState();
  expect(s2.runtimeSession.firstReading?.runtimeMs).toBe(1234);
  expect(s2.runtimeSession.lastReading?.runtimeMs).toBe(2000);
});

test('runtimeRead evidence uses SIM timer label + TBD context, never a raw wire value', () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 500, enableCount: 2, timerState: TimerState.Counting },
  }));
  const reading = useStore.getState().runtimeRead();
  // Internal object keeps the numeric state for logic.
  expect(reading?.timerState).toBe(TimerState.Counting);

  const tx = useStore.getState().transactions.find(t => t.command === 'RUNTIME_READ' && t.pass);
  expect(tx).toBeDefined();
  const evidence = `${tx?.responsePayload} ${tx?.responseDecoded}`;
  // SIM label + simulator-only / TBD firmware-enum context must be present.
  expect(evidence).toContain('SIM COUNTING');
  expect(tx?.responseDecoded).toContain('simulator-only');
  expect(tx?.responseDecoded).toMatch(/TBD/);
  // No raw numeric timer wire value exposed in user-visible evidence.
  expect(evidence).not.toMatch(/timerState/);
  expect(evidence).not.toMatch(/timer[=:]\s*[0-2]\b/);
});

test('runtime observation tracks elapsed PC time, LSN increase, difference, and samples', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  const store = useStore.getState();
  store.setInterlock(true);
  store.toggleEnable(true);
  store.startRuntimeObservation();
  expect(useStore.getState().runtimeSession.observation.active).toBe(true);

  store.tick(300); // one sample interval crossed (>=200ms)
  store.tick(300);
  store.stopRuntimeObservation();

  const obs = useStore.getState().runtimeSession.observation;
  expect(obs.active).toBe(false);
  expect(obs.elapsedPcMs).toBe(600);
  expect(obs.lsnIncreaseMs).toBe(600); // active whole time
  expect(obs.differenceMs).toBe(0);
  expect(obs.samples.length).toBeGreaterThan(0);
  expect(obs.startRuntimeMs).toBe(0);
  expect(obs.currentRuntimeMs).toBe(600);
});

test('runtime observation is blocked when disconnected', () => {
  useStore.getState().startRuntimeObservation();
  expect(useStore.getState().runtimeSession.observation.active).toBe(false);
});

// ── Guided Timer test ─────────────────────────────────────────────────────────

test('guided timer test passes: independent device wall clock ~= measured PC time (quantized)', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const startRuntime = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  // Short duration; generous tolerance accommodates real scheduler jitter.
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 30, toleranceMs: 40 });
  expect(result.status).toBe('passed');
  expect(result.pass).toBe(true);
  expect(result.cleanupOk).toBe(true);
  // Device runtime comes from the INDEPENDENT device wall clock, quantized to 10ms:
  // lsnIncrease === deviceTicksAccrued × deviceQuantumMs (a multiple of 10ms).
  expect(result.deviceQuantumMs).toBe(10);
  expect(result.lsnIncreaseMs).toBe(result.deviceTicksAccrued * result.deviceQuantumMs);
  expect(result.lsnIncreaseMs % 10).toBe(0);
  // The device counter delta equals the modeled increase (single owner, no double count).
  const actualDelta = Math.round(useStore.getState().logicalState.lifetimeEmissionTimeMs - startRuntime);
  expect(result.lsnIncreaseMs).toBe(actualDelta);
  // Both clocks track real elapsed time, so device runtime ~= PC measured.
  expect(result.pcMeasuredMs).toBeGreaterThanOrEqual(30);
  expect(Math.abs(result.differenceMs)).toBeLessThanOrEqual(40);
  expect(result.differenceMs).toBe(result.lsnIncreaseMs - result.pcMeasuredMs);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
  // Evidence explains independent device wall clock quantized in 10ms quanta vs PC monotonic.
  const stop = useStore.getState().transactions.find(t => t.command === 'TIMER_STOP');
  expect(stop).toBeDefined();
  expect(stop?.responseDecoded).toContain('Protected timer session runtime');
  expect(stop?.responseDecoded).toContain('independent device wall clock quantized in 10ms quanta');
  expect(stop?.responseDecoded).toContain('PC monotonic measured');
  expect(stop?.responseDecoded).toContain(`${result.lsnIncreaseMs}ms`);
  expect(stop?.responseDecoded).toContain(`${result.pcMeasuredMs}ms`);
});

test('normal 300ms/50ms guided timer test passes even when a callback wakes late', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  // Simulate a late scheduler wake (300ms requested, callback returns ~379ms) by
  // stalling the event loop briefly during the wait. Because the device clock is a
  // free-running wall clock (Date.now), device elapsed ALSO reports ~the late time,
  // so both clocks agree and the test still PASSES (no false failure).
  const stall = setTimeout(() => {
    const end = Date.now() + 80;
    while (Date.now() < end) { /* busy-wait ~80ms event-loop stall */ }
  }, 50);
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 300, toleranceMs: 50 });
  clearTimeout(stall);
  expect(result.status).toBe('passed');
  expect(result.pass).toBe(true);
  expect(result.cleanupOk).toBe(true);
  expect(result.lsnIncreaseMs).toBe(result.deviceTicksAccrued * 10);
  // Device runtime tracked real (late) time, so it stays within tolerance of PC.
  expect(Math.abs(result.differenceMs)).toBeLessThanOrEqual(50);
});

test('guided timer test FAILS on induced clock divergence: Date.now and performance.now stubbed differently', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  // Stub the two clock SOURCES independently: the device wall clock (Date.now) runs
  // ~10x fast while the PC monotonic clock (performance.now) stays real. The device
  // oscillator therefore reports far more elapsed than the PC measured interval,
  // proving the sources are independent and forcing a FAIL outside a tight tolerance.
  const origDate = Date.now;
  const origPerf = performance.now.bind(performance);
  const dateBase = origDate();
  Date.now = () => dateBase + (origDate() - dateBase) * 10; // device clock 10x fast
  // performance.now left real (PC clock unchanged).
  try {
    const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 5 });
    expect(result.status).toBe('failed');
    expect(result.pass).toBe(false);
    expect(result.cleanupOk).toBe(true); // cleanup fine; failure is purely timing divergence
    // Device wall clock accrued (~10x), quantized to 10ms.
    expect(result.lsnIncreaseMs).toBeGreaterThan(0);
    expect(result.lsnIncreaseMs).toBe(result.deviceTicksAccrued * 10);
    // The two clock sources produced clearly DIFFERENT values, far beyond tolerance.
    expect(result.lsnIncreaseMs).toBeGreaterThan(result.pcMeasuredMs);
    expect(result.lsnIncreaseMs).not.toBe(result.pcMeasuredMs);
    expect(Math.abs(result.differenceMs)).toBeGreaterThan(5);
  } finally {
    Date.now = origDate;
    performance.now = origPerf;
  }
});

test('guided timer test: enable succeeds but disable is dropped -> cleanup failure forces FAILED + safe state', async () => {
  // rate=50, responseAttempt=2: enable(attempt 2) NOT dropped, disable(attempt 3) dropped.
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    responseAttempt: 2,
    settings: { ...state.settings, droppedResponseRate: 50 },
  }));
  useStore.getState().setInterlock(true);
  // Generous tolerance so timing alone would PASS; only the cleanup failure fails it.
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 1000 });
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.cleanupOk).toBe(false);
  // Timing on its own was within tolerance; the FAIL is due to cleanup.
  expect(Math.abs(result.differenceMs)).toBeLessThanOrEqual(1000);
  // Fail-safe direct cleanup forced safe state.
  const ls = useStore.getState().logicalState;
  expect(ls.emissionControlOutputActive).toBe(false);
  expect(ls.requestedEnable).toBe(false);
  expect(ls.timerState).toBe(TimerState.NotCounting);
  // Explicit cleanup-failure evidence recorded.
  const cleanupTx = useStore.getState().transactions.find(t => t.command === 'TIMER_CLEANUP');
  expect(cleanupTx).toBeDefined();
  expect(cleanupTx?.pass).toBe(false);
  expect(result.notes).toMatch(/CLEANUP FAILURE/);
  // No leftover active state -> a later global tick must not accrue runtime.
  const before = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  useStore.getState().tick(100);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(before);
});

test('guided timer test fails outside tolerance when output never activates (dropped enable)', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    settings: { ...state.settings, droppedResponseRate: 100 },
  }));
  useStore.getState().setInterlock(true);
  const startRuntime = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  // The enable request is dropped, so the output never activates. PC time still
  // elapses, creating a real discrepancy that must FAIL outside tolerance.
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 5 });
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  // No device quanta accrued because the output was never active.
  expect(result.deviceTicksAccrued).toBe(0);
  expect(result.lsnIncreaseMs).toBe(0);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(startRuntime);
  // PC time was measured and well beyond tolerance vs the zero device runtime.
  expect(result.pcMeasuredMs).toBeGreaterThanOrEqual(40);
  expect(Math.abs(result.differenceMs)).toBeGreaterThan(5);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('guided timer test does not double-count with the global tick while running', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const start = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  // Simulate the AppLayout global tick firing repeatedly during the test window.
  const interval = setInterval(() => useStore.getState().tick(10), 5);
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 25 });
  clearInterval(interval);
  // The generic tick is suppressed while running, so device runtime is exactly the
  // fixed-quantum accrual and equals the counter delta (no ballooning).
  const actualDelta = Math.round(useStore.getState().logicalState.lifetimeEmissionTimeMs - start);
  expect(result.lsnIncreaseMs).toBe(actualDelta);
  expect(result.lsnIncreaseMs).toBe(result.deviceTicksAccrued * 10);
  expect(Math.abs(result.differenceMs)).toBeLessThanOrEqual(25);
});

test('TIMER_START evidence: normal enable records pass=true only after output is actually active', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 30, toleranceMs: 40 });
  expect(result.status).toBe('passed');
  const start = useStore.getState().transactions.find(t => t.command === 'TIMER_START');
  expect(start).toBeDefined();
  // Evidence reflects the ACTUAL (active) output after the enable attempt.
  expect(start?.pass).toBe(true);
  expect(start?.status).toBe('ok');
  expect(start?.actualResult).toBe('Output active');
});

test('TIMER_START evidence: dropped enable records pass=false and inactive output, timer FAILED', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    settings: { ...state.settings, droppedResponseRate: 100 }, // enable request dropped
  }));
  useStore.getState().setInterlock(true);
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 5 });
  // No false "output active PASS" — request-only, non-pass semantics.
  const start = useStore.getState().transactions.find(t => t.command === 'TIMER_START');
  expect(start).toBeDefined();
  expect(start?.pass).toBe(false);
  expect(start?.status).toBe('error');
  expect(start?.actualResult).toContain('inactive');
  // Overall timer test fails and the output is left safely inactive.
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.lsnIncreaseMs).toBe(0);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('mutual exclusion: stress start is BLOCKED while a guided timer test is running', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  // Start the timer test without awaiting so it is in the 'running' state.
  const pending = useStore.getState().runGuidedTimerTest({ durationMs: 60, toleranceMs: 40 });
  expect(useStore.getState().timerTest.status).toBe('running');
  // Attempt to start stress mid-timer: must be blocked and stay inactive.
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });
  expect(useStore.getState().stressTestState.isActive).toBe(false);
  expect(useStore.getState().stressTestState.finalResult).toBe('BLOCKED');
  const blk = useStore.getState().transactions.find(t => t.command === 'STRESS_START' && t.actualResult === 'Blocked (Timer Test running)');
  expect(blk).toBeDefined();
  expect(blk?.pass).toBe(false);
  // The timer test itself still completes normally (no competing stress ran).
  const result = await pending;
  expect(result.status).toBe('passed');
  expect(result.conflict).toBe(false);
});

test('mutual exclusion: timer test start is BLOCKED while a stress run is active', async () => {
  useStore.setState({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    stressTestState: { ...INITIAL_STRESS_STATE, isActive: true, targetCycles: 5, phase: 'on' },
  });
  useStore.getState().setInterlock(true);
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 40 });
  expect(result.status).toBe('blocked');
  expect(result.conflict).toBe(true);
  expect(result.pass).toBe(false);
  const tx = useStore.getState().transactions.find(t => t.command === 'TIMER_TEST' && t.actualResult === 'Blocked (Stress active)');
  expect(tx).toBeDefined();
  expect(tx?.pass).toBe(false);
});

test('mutual exclusion: competing stress becoming active mid-run FAILS the timer safely (no misleading runtime pass)', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  // Start the timer test; then force a competing stress run active mid-window by
  // directly mutating state (simulating a race / external mutation).
  const pending = useStore.getState().runGuidedTimerTest({ durationMs: 80, toleranceMs: 40 });
  setTimeout(() => {
    useStore.setState({ stressTestState: { ...INITIAL_STRESS_STATE, isActive: true, targetCycles: 5, phase: 'on' } });
  }, 20);
  const result = await pending;
  // Safe FAILED result, conflict recorded, no device-elapsed accrued as valid runtime.
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.conflict).toBe(true);
  expect(result.deviceTicksAccrued).toBe(0);
  // Output is forced inactive.
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
  expect(useStore.getState().logicalState.requestedEnable).toBe(false);
  // Conflict evidence recorded.
  const conflictTx = useStore.getState().transactions.find(t => t.command === 'TIMER_CONFLICT');
  expect(conflictTx).toBeDefined();
  expect(conflictTx?.pass).toBe(false);
  expect(result.notes).toMatch(/CONFLICT/);
});

// ── Persistence ↔ Stress / Timer / Observation mutual exclusion (regression) ──

test('mutual exclusion: persistence start is BLOCKED while a stress run is active (no restart/after-read)', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    stressTestState: { ...INITIAL_STRESS_STATE, isActive: true, targetCycles: 5, phase: 'on' },
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/Stress run/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_READ_BEFORE');
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  const blk = useStore.getState().transactions.find(t => t.command === 'PERSIST_TEST' && t.actualResult === 'Blocked (Stress active)');
  expect(blk?.pass).toBe(false);
});

test('mutual exclusion: stress start is BLOCKED while a guided persistence test is running', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  // Start persistence without awaiting so it is in the 'running' state (its async
  // body suspends at the first await after the before-read / disconnect).
  const pending = useStore.getState().runGuidedPersistenceTest();
  expect(useStore.getState().persistenceTest.status).toBe('running');
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });
  expect(useStore.getState().stressTestState.isActive).toBe(false);
  expect(useStore.getState().stressTestState.finalResult).toBe('BLOCKED');
  const blk = useStore.getState().transactions.find(t => t.command === 'STRESS_START' && t.actualResult === 'Blocked (Persistence Test running)');
  expect(blk?.pass).toBe(false);
  await pending;
});

test('mutual exclusion: persistence start is BLOCKED while a guided timer test is running', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  useStore.getState().setInterlock(true);
  const pending = useStore.getState().runGuidedTimerTest({ durationMs: 60, toleranceMs: 40 });
  expect(useStore.getState().timerTest.status).toBe('running');
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/Timer Test/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  // Timer test still finishes cleanly.
  const timer = await pending;
  expect(timer.conflict).toBe(false);
});

test('mutual exclusion: timer test start is BLOCKED while a guided persistence test is running', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  useStore.getState().setInterlock(true);
  const pending = useStore.getState().runGuidedPersistenceTest();
  expect(useStore.getState().persistenceTest.status).toBe('running');
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 40 });
  expect(result.status).toBe('blocked');
  expect(result.conflict).toBe(true);
  expect(result.pass).toBe(false);
  const tx = useStore.getState().transactions.find(t => t.command === 'TIMER_TEST' && t.actualResult === 'Blocked (Persistence Test running)');
  expect(tx?.pass).toBe(false);
  await pending;
});

test('mutual exclusion: persistence start is BLOCKED while a runtime observation is active', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  useStore.getState().startRuntimeObservation();
  expect(useStore.getState().runtimeSession.observation.active).toBe(true);
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/observation/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
});

test('mutual exclusion: runtime observation start is BLOCKED while a guided persistence test is running', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const pending = useStore.getState().runGuidedPersistenceTest();
  expect(useStore.getState().persistenceTest.status).toBe('running');
  useStore.getState().startRuntimeObservation();
  expect(useStore.getState().runtimeSession.observation.active).toBe(false);
  const blk = useStore.getState().transactions.find(t => t.command === 'RUNTIME_OBS_START' && t.actualResult === 'Blocked (Persistence Test running)');
  expect(blk?.pass).toBe(false);
  await pending;
});

test('mutual exclusion: competing stress forced active mid-persistence ABORTS with no PASS and no active output survivor', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000, emissionControlOutputActive: true, requestedEnable: true },
  }));
  const pending = useStore.getState().runGuidedPersistenceTest();
  // Force a competing stress run active mid-window via direct mutation (race guard).
  setTimeout(() => {
    useStore.setState({ stressTestState: { ...INITIAL_STRESS_STATE, isActive: true, targetCycles: 5, phase: 'on' } });
  }, 0);
  const result = await pending;
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/conflict/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).toContain('PERSIST_ABORT');
  // Never produces the after-read that gates a persistence PASS.
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  // No active output survives the conflict abort.
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
  expect(useStore.getState().logicalState.requestedEnable).toBe(false);
  // No persistence-VALIDATION pass survives. Intermediate step evidence
  // (PERSIST_READ_BEFORE / a simulated PERSIST_RESTART that occurred before the
  // conflict was detected) may be pass=true, but the conflict must abort before any
  // after-read that could validate/claim persistence.
  const validationPass = useStore.getState().transactions.some(
    t => t.relatedAction === 'persistenceTest' && t.pass === true
      && t.command !== 'PERSIST_READ_BEFORE' && t.command !== 'PERSIST_RESTART',
  );
  expect(validationPass).toBe(false);
});

test('mutual exclusion: Hardware manual persistence (awaiting_continue) does NOT block Simulation stress', () => {
  // Hardware manual persistence lands in 'awaiting_continue', which must not lock
  // other workflows (only status==='running' locks). A subsequent Simulation stress
  // start must be permitted.
  useStore.setState({ mode: 'hardware', connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  // Kick off the manual Hardware persistence (synchronous return path).
  void useStore.getState().runGuidedPersistenceTest();
  expect(useStore.getState().persistenceTest.status).toBe('awaiting_continue');
  // Switch to Simulation and start stress; the awaiting_continue persistence must not block it.
  useStore.setState({ mode: 'simulation', connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 2, onDur: 10, offDur: 10, faultProb: 0 });
  expect(useStore.getState().stressTestState.isActive).toBe(true);
});

test('timer FAILS with dropped enable even under generous tolerance (tol > duration)', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    settings: { ...state.settings, droppedResponseRate: 100 }, // enable dropped
  }));
  useStore.getState().setInterlock(true);
  // Tolerance vastly exceeds duration; only the hard prerequisites can fail it.
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 10_000 });
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.outputActiveAtStart).toBe(false);
  expect(result.continuousActiveLive).toBe(false);
  expect(result.deviceTicksAccrued).toBe(0);
  expect(result.lsnIncreaseMs).toBe(0);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('timer FAILS with blocked enable (interlock open) even under generous tolerance', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    capabilities: { ...state.capabilities, interlock: true },
  }));
  // Interlock is open (interlockOK=false) so enable is blocked: output never active.
  useStore.getState().setInterlock(false);
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 40, toleranceMs: 10_000 });
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.outputActiveAtStart).toBe(false);
  expect(result.continuousActiveLive).toBe(false);
  expect(result.deviceTicksAccrued).toBe(0);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('timer FAILS on mid-run output loss then re-enable, even under generous tolerance', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const pending = useStore.getState().runGuidedTimerTest({ durationMs: 120, toleranceMs: 10_000 });
  // Mid-run: disable then re-enable the output. The durable continuity latch must
  // record the interruption so the re-enable cannot hide it.
  setTimeout(() => useStore.getState().toggleEnable(false), 30);
  setTimeout(() => useStore.getState().toggleEnable(true), 60);
  const result = await pending;
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.continuousActiveLive).toBe(false);
  // Only observed active/live spans were credited (never the whole interval).
  expect(result.lsnIncreaseMs).toBeLessThan(120);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

// ── Hardware Mode Store Integration ──────────────────────────────────────────

test('discover fails when desktop bridge is missing', async () => {
  useStore.setState({ mode: 'hardware' });
  // window.lsnDesktop is undefined natively in this test environment
  await useStore.getState().discover();
  const state = useStore.getState();
  expect(state.discoveryStatus).toBe('error');
  expect(state.discoveryError).toMatch(/packaged Windows desktop app/);
});

test('discover calls hardware bridge and populates candidates', async () => {
  useStore.setState({ mode: 'hardware' });
  let calledAddress = '';
  // Mock bridge
  (global as any).window = {
    lsnDesktop: {
      hardwareDiscover: async (addr?: string) => {
        calledAddress = addr || 'all';
        return {
          candidates: [{
            sourceAddress: '192.168.1.100', socketAddress: '', socketPort: 0, vendorId: 1, deviceType: 2, productCode: 3, revision: '1.0', status: 0, serialNumber: 1234, productName: 'TestDevice', state: 0, encapProtocolVersion: 1
          }]
        };
      }
    }
  };

  await useStore.getState().discover();
  let state = useStore.getState();
  expect(calledAddress).toBe('all');
  expect(state.hardwareCandidates.length).toBe(1);
  expect(state.hardwareCandidates[0].productName).toBe('TestDevice');
  expect(state.device.ip).toBe('192.168.1.100'); // populated from candidate
  expect(state.device.firmware).toBe('Unverified'); // conservatively unverified

  // test manual probe
  await useStore.getState().discover('10.0.0.5');
  expect(calledAddress).toBe('10.0.0.5');
  state = useStore.getState();
  expect(state.hardwareCandidates[0].productName).toBe('TestDevice');

  delete (global as any).window;
});

test('connect uses selected candidate and fetches profile readiness but leaves telemetry UNKNOWN if TBD', async () => {
  useStore.setState({ mode: 'hardware' });
  (global as any).window = {
    lsnDesktop: {
      hardwareConnect: async (addr: string) => ({ state: 'connected', connected: true, address: addr, sessionHandle: 1 }),
      hardwareGetProfileReadiness: async () => ({ readReady: false }), // Not ready for reads
    }
  };

  useStore.getState().selectCandidate({
    sourceAddress: '192.168.1.200', socketAddress: '', socketPort: 0, vendorId: 1, deviceType: 2, productCode: 3, revision: '1.0', status: 0, serialNumber: 1234, productName: 'TestDevice', state: 0, encapProtocolVersion: 1
  });

  await useStore.getState().connect();
  const state = useStore.getState();
  expect(state.connectionState).toBe('connected');
  // Telemetry should NOT be live yet since we couldn't read fields
  expect(state.lastValidTelemetryAt).toBeNull();

  delete (global as any).window;
});

test('connect explicitly reads fields if profile is ready and updates telemetry', async () => {
  useStore.setState({ mode: 'hardware' });
  (global as any).window = {
    lsnDesktop: {
      hardwareConnect: async (addr: string) => ({ state: 'connected', connected: true, address: addr, sessionHandle: 1 }),
      hardwareGetProfileReadiness: async () => ({ readReady: true }),
      hardwareReadField: async (name: string) => {
        if (name === 'Ready') return { value: true, symbolicName: name };
        if (name === 'Faulted') return { value: false, symbolicName: name };
        if (name === 'EmissionControlOutputActive') return { value: true, symbolicName: name }; // e.g. already active
        throw new Error('Unsupported');
      }
    }
  };

  useStore.getState().setManualProbeIp('10.0.0.1');
  await useStore.getState().connect();
  const state = useStore.getState();
  expect(state.connectionState).toBe('connected');
  expect(state.lastValidTelemetryAt).not.toBeNull();
  expect(state.logicalState.ready).toBe(true);
  expect(state.logicalState.emissionControlOutputActive).toBe(true);

  delete (global as any).window;
});

test('hardware toggleEnable(true) requires arm and guarded write', async () => {
  useStore.setState({ mode: 'hardware', connectionState: 'connected' });
  let armed = false;
  let writeCalled = false;
  (global as any).window = {
    lsnDesktop: {
      hardwareArmControl: async () => { armed = true; return { armed: true }; },
      hardwareWriteEnable: async (enable: boolean) => {
         writeCalled = true;
         return { requested: enable, outputActive: enable };
      },
      hardwareReadField: async (name: string) => ({ value: name === 'EmissionControlOutputActive' ? true : false, symbolicName: name }), // mock refresh
    }
  };

  await useStore.getState().toggleEnable(true);
  const state = useStore.getState();
  expect(armed).toBe(true);
  expect(writeCalled).toBe(true);
  expect(state.logicalState.requestedEnable).toBe(true);
  expect(state.logicalState.emissionControlOutputActive).toBe(true);

  delete (global as any).window;
});

test('hardware toggleEnable(false) directly writes without arm', async () => {
  useStore.setState({ mode: 'hardware', connectionState: 'connected' });
  let armed = false;
  let writeCalled = false;
  (global as any).window = {
    lsnDesktop: {
      hardwareArmControl: async () => { armed = true; return { armed: true }; },
      hardwareWriteEnable: async (enable: boolean) => {
         writeCalled = true;
         return { requested: enable, outputActive: enable };
      },
      hardwareReadField: async () => ({ value: false, symbolicName: 'test' }),
    }
  };

  await useStore.getState().toggleEnable(false);
  const state = useStore.getState();
  expect(armed).toBe(false); // Should not arm on disable
  expect(writeCalled).toBe(true);
  expect(state.logicalState.requestedEnable).toBe(false);

  delete (global as any).window;
});

test('hardware state disconnected clears connection and live evidence', () => {
  useStore.getState().timerTest.status = 'running'; // force latch block evaluation
  let hardwareStateCb: any;
  (global as any).window = {
    lsnDesktop: {
      onHardwareState: (cb: any) => { hardwareStateCb = cb; return () => {}; }
    }
  };

  useStore.setState({ mode: 'hardware', connectionState: 'connected', lastValidTelemetryAt: 12345 });
  useStore.getState().initializeHardwareSubscriptions();

  // fire mock socket loss
  hardwareStateCb({ state: 'disconnected' });

  const state = useStore.getState();
  expect(state.connectionState).toBe('faulted');
  expect(state.lastValidTelemetryAt).toBeNull();
  expect(state.timerOutputInterruptions).toBe(1); // Latched the interruption

  delete (global as any).window;
});


test('timer FAILS on mid-run telemetry loss then reconnect, even under generous tolerance', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const pending = useStore.getState().runGuidedTimerTest({ durationMs: 120, toleranceMs: 10_000 });
  // Mid-run: lose telemetry liveness (comms loss) then restore connection.
  setTimeout(() => useStore.getState().updateLogicalState({ commsLoss: true }), 30);
  setTimeout(() => useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now(), logicalState: { ...useStore.getState().logicalState, commsLoss: false } }), 60);
  const result = await pending;
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.continuousActiveLive).toBe(false);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('guided timer test is blocked in Hardware Mode without transmission', async () => {
  useStore.setState({ mode: 'hardware', connectionState: 'connected' });
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 100 });
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  const tx = useStore.getState().transactions.find(t => t.command === 'TIMER_TEST');
  expect(tx?.status).toBe('error');
  expect(tx?.responseHex).toBe(''); // no simulated wire response = non-transmitting
});

test('guided timer test requires connected Simulation Mode', async () => {
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 100 });
  expect(result.status).toBe('blocked');
});

// ── Guided Persistence test ───────────────────────────────────────────────────

test('guided persistence test captures before/after and validates non-decrease', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('passed');
  expect(result.runtimeBeforeMs).toBe(5000);
  expect(result.runtimeAfterMs).toBe(5000); // preserved across simulated restart
  expect(result.differenceMs).toBe(0);
  expect(result.nonDecreasing).toBe(true);
  expect(result.pass).toBe(true);
  expect(useStore.getState().connectionState).toBe('connected'); // reconnected
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).toContain('PERSIST_READ_BEFORE');
  expect(cmds).toContain('PERSIST_RESTART');
  expect(cmds).toContain('PERSIST_READ_AFTER');
});

test('guided persistence BLOCKS on connected-but-stale telemetry (no restart, no pass)', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now() - 6000, // older than 5s stale threshold => STALE
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/LIVE/i);
  // No restart was simulated and no PASS evidence emitted.
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  expect(useStore.getState().transactions.some(t => t.relatedAction === 'persistenceTest' && t.pass === true)).toBe(false);
});

test('guided persistence BLOCKS on UNKNOWN telemetry freshness (no restart, no pass)', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: null, // UNKNOWN freshness
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  expect(useStore.getState().transactions.some(t => t.relatedAction === 'persistenceTest' && t.pass === true)).toBe(false);
});

test('guided persistence BLOCKS when simulated storage failure is active at start', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000, storageFailure: true },
  }));
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/storage failure/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  expect(useStore.getState().transactions.some(t => t.relatedAction === 'persistenceTest' && t.pass === true)).toBe(false);
});

test('guided persistence FAILS safely when a fault is injected mid-run (before after-read)', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  // Start the workflow; its synchronous prefix runs the before-read and disconnect.
  const pending = useStore.getState().runGuidedPersistenceTest();
  // Inject an unexpected communication loss mid-run (after the before-read); this is
  // NOT part of the scripted restart and must abort before any after-read.
  useStore.setState(state => ({ logicalState: { ...state.logicalState, commsLoss: true } }));
  const result = await pending;
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  expect(result.notes).toMatch(/ABORTED/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  // A safe abort was recorded and NO after-read / PASS was produced.
  expect(cmds).toContain('PERSIST_ABORT');
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  // No persistence PASS transaction of any kind after the before-read.
  const passAfterBefore = useStore.getState().transactions.some(
    t => t.relatedAction === 'persistenceTest' && t.pass === true && t.command !== 'PERSIST_READ_BEFORE',
  );
  expect(passAfterBefore).toBe(false);
});

test('guided persistence FAILS safely when storage failure appears mid-run before after-read', async () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const pending = useStore.getState().runGuidedPersistenceTest();
  // Inject a storage failure mid-run; must abort before the after-read (no pass).
  useStore.setState(state => ({ logicalState: { ...state.logicalState, storageFailure: true } }));
  const result = await pending;
  expect(result.status).toBe('failed');
  expect(result.pass).toBe(false);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  expect(cmds).not.toContain('PERSIST_RESTART');
  expect(cmds).toContain('PERSIST_ABORT');
  // No persistence PASS transaction of any kind was emitted after the before-read.
  const passAfterBefore = useStore.getState().transactions.some(
    t => t.relatedAction === 'persistenceTest' && t.pass === true && t.command !== 'PERSIST_READ_BEFORE',
  );
  expect(passAfterBefore).toBe(false);
});

test('guided persistence in Hardware Mode awaits manual continue and never claims hardware pass', async () => {
  useStore.setState({ mode: 'hardware', connectionState: 'disconnected' });
  const pending = await useStore.getState().runGuidedPersistenceTest();
  expect(pending.status).toBe('awaiting_continue');
  expect(pending.manual).toBe(true);

  const continued = useStore.getState().continuePersistenceTest('operator observed reboot');
  expect(continued.status).toBe('failed'); // no live data => not a pass
  expect(continued.pass).toBe(false);
  expect(continued.manual).toBe(true);
});

test('Hardware manual persistence CANNOT false-PASS after switching to Simulation + reconnect with FRESH telemetry', async () => {
  // Hardware run -> awaiting_continue.
  useStore.setState({ mode: 'hardware', connectionState: 'disconnected' });
  const awaiting = await useStore.getState().runGuidedPersistenceTest();
  expect(awaiting.status).toBe('awaiting_continue');
  const runtimeBefore = awaiting.runtimeBeforeMs;
  // Operator switches to Simulation and establishes a LIVE session, then presses
  // Continue with a NON-DECREASING (equal) runtime — the classic false-PASS setup.
  useStore.setState(state => ({
    mode: 'simulation',
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: runtimeBefore },
  }));
  const continued = useStore.getState().continuePersistenceTest('observed reboot; now in sim');
  expect(continued.pass).toBe(false);
  expect(continued.status).toBe('failed');
  expect(continued.nonDecreasing).toBe(true); // runtime did not decrease...
  // ...yet it is STILL not a pass, and the notes direct the user to a new guided run.
  expect(continued.notes).toMatch(/new guided persistence run|cannot be converted/i);
  // No simulated persistence after-read / PASS evidence was emitted.
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  const anyPass = useStore.getState().transactions.some(
    t => t.relatedAction === 'persistenceTest' && t.pass === true,
  );
  expect(anyPass).toBe(false);
});

test('Hardware manual persistence CANNOT false-PASS after switching to Simulation with STALE telemetry', async () => {
  useStore.setState({ mode: 'hardware', connectionState: 'disconnected' });
  const awaiting = await useStore.getState().runGuidedPersistenceTest();
  expect(awaiting.status).toBe('awaiting_continue');
  const runtimeBefore = awaiting.runtimeBeforeMs;
  // Switch to Simulation but with STALE telemetry (old lastValidTelemetryAt).
  useStore.setState(state => ({
    mode: 'simulation',
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now() - 10 * 60 * 1000, // stale
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: runtimeBefore },
  }));
  const continued = useStore.getState().continuePersistenceTest();
  expect(continued.pass).toBe(false);
  expect(continued.status).toBe('failed');
  expect(continued.notes).toMatch(/new guided persistence run|cannot be converted/i);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).not.toContain('PERSIST_READ_AFTER');
  const anyPass = useStore.getState().transactions.some(
    t => t.relatedAction === 'persistenceTest' && t.pass === true,
  );
  expect(anyPass).toBe(false);
});

test('after Hardware->Simulation, a NEW guided persistence run can validate normally (LIVE before/restart/after)', async () => {
  // A fresh guided run in Simulation still PASSES (regression guard: the false-PASS
  // fix must not break the legitimate simulation path).
  useStore.setState({ mode: 'hardware', connectionState: 'disconnected' });
  await useStore.getState().runGuidedPersistenceTest();
  useStore.setState(state => ({
    mode: 'simulation',
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 5000 },
  }));
  const result = await useStore.getState().runGuidedPersistenceTest();
  expect(result.status).toBe('passed');
  expect(result.pass).toBe(true);
  const cmds = useStore.getState().transactions.map(t => t.command);
  expect(cmds).toContain('PERSIST_READ_AFTER');
});

// ── Stress workflow ───────────────────────────────────────────────────────────

test('stress is blocked when disconnected and when in Hardware Mode', () => {
  useStore.getState().startStressTest({ cycles: 5, onDur: 10, offDur: 10, faultProb: 0 });
  expect(useStore.getState().stressTestState.isActive).toBe(false);
  expect(useStore.getState().stressTestState.finalResult).toBe('BLOCKED');

  useStore.setState({ mode: 'hardware', hardwareUnlocked: true, connectionState: 'connected' });
  useStore.getState().startStressTest({ cycles: 5, onDur: 10, offDur: 10, faultProb: 0 });
  expect(useStore.getState().stressTestState.isActive).toBe(false);
  expect(useStore.getState().stressTestState.finalResult).toBe('BLOCKED');
});

test('stress completes on cycles, tracks metrics, and keeps output off', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });
  expect(useStore.getState().stressTestState.isActive).toBe(true);
  expect(useStore.getState().stressTestState.baselineRuntimeMs).toBe(0);

  useStore.getState().tick(60); // 3 full cycles (20ms each)
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.completedCycles).toBe(3);
  expect(s.stopReason).toBe('CYCLES_COMPLETE');
  expect(s.finalResult).toBe('PASS');
  expect(s.latencySamples.length).toBeGreaterThan(0);
  expect(s.latencyAvg).not.toBeNull();
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('stress stops at max duration before cycle completion and is not a PASS', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 1000, onDur: 10, offDur: 10, faultProb: 0, maxDuration: 100 });
  useStore.getState().tick(120);
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.stopReason).toBe('MAX_DURATION');
  // Ended before the requested 1000 cycles -> FAIL (never PASS).
  expect(s.finalResult).toBe('FAIL');
  expect(s.completedCycles).toBeLessThan(1000);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('stress: cycle completing exactly at maxDuration is CYCLES_COMPLETE / PASS', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  // One cycle OFF=10 + ON=10 = 20ms, and maxDuration=20ms lands exactly on the
  // cycle boundary. The completed cycle must be recorded before MAX_DURATION.
  useStore.getState().startStressTest({ cycles: 1, onDur: 10, offDur: 10, faultProb: 0, maxDuration: 20 });
  useStore.getState().tick(10_000);
  const s = useStore.getState().stressTestState;
  expect(s.completedCycles).toBe(1);
  expect(s.targetCycles).toBe(1);
  expect(s.stopReason).toBe('CYCLES_COMPLETE');
  expect(s.finalResult).toBe('PASS');
  expect(s.elapsedMs).toBe(20);
  // 10ms OFF (no accrual) + 10ms ON.
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs - runtimeBefore).toBe(10);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('stress: maxDuration bisecting a long ON phase stops exactly at the budget', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  // OFF=10ms then ON=150ms, but maxDuration=100ms falls mid-ON.
  useStore.getState().startStressTest({ cycles: 1000, onDur: 150, offDur: 10, faultProb: 0, maxDuration: 100 });
  // One large tick that would otherwise overshoot into the ON phase far past 100ms.
  useStore.getState().tick(10_000);
  const s = useStore.getState().stressTestState;
  // Elapsed lands exactly on the budget; runtime = 10ms OFF (no accrual) + 90ms ON.
  expect(s.elapsedMs).toBe(100);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs - runtimeBefore).toBe(90);
  expect(s.completedCycles).toBe(0); // first ON phase (150ms) never completed
  expect(s.completedCycles).toBeLessThan(1000);
  expect(s.stopReason).toBe('MAX_DURATION');
  expect(s.finalResult).toBe('FAIL');
  expect(s.isActive).toBe(false);
  // Output finishes inactive even though maxDuration hit during an active ON phase.
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
  expect(useStore.getState().logicalState.requestedEnable).toBe(false);
});

test('stress stops on fault when configured', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 1000, onDur: 10, offDur: 10, faultProb: 100, stopOnFault: true });
  useStore.getState().tick(40);
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.stopReason).toBe('FAULT');
  expect(s.finalResult).toBe('FAIL');
  expect(s.faults).toBeGreaterThan(0);
  expect(useStore.getState().logicalState.faulted).toBe(true);
});

test('stopStressTest finalizes an ABORTED result with output inactive', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 1000, onDur: 10, offDur: 10, faultProb: 0 });
  useStore.getState().tick(15);
  useStore.getState().stopStressTest();
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.stopReason).toBe('ABORTED');
  expect(s.finalResult).toBe('ABORTED');
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('new session/timer/persistence/stress state defaults are safe', () => {
  const s = useStore.getState();
  expect(s.runtimeSession.observation.active).toBe(false);
  expect(s.timerTest.status).toBe('idle');
  expect(s.persistenceTest.status).toBe('idle');
  expect(s.stressTestState.finalResult).toBeNull();
});

// ── Stress runtime partitioning (regression) ──────────────────────────────────

test('stress: 3 cycles at 10ms ON/10ms OFF in one 60ms tick yields exactly 30ms runtime and 3 cycles', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });

  // A single coarse tick that spans all six phase boundaries.
  useStore.getState().tick(60);

  const s = useStore.getState().stressTestState;
  const runtimeAfter = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  expect(s.completedCycles).toBe(3);
  expect(s.stopReason).toBe('CYCLES_COMPLETE');
  expect(s.finalResult).toBe('PASS');
  // Runtime increase must equal exactly 3 × ON duration = 30ms (only ON portions accrue).
  expect(runtimeAfter - runtimeBefore).toBe(30);
});

test('stress: periodic runtime read matches configured ON duration accrual', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({
    cycles: 2, onDur: 25, offDur: 15, faultProb: 0, runtimeReadEvery: 1,
  });
  useStore.getState().tick(200);

  const reads = useStore.getState().transactions
    .filter(t => t.command === 'STRESS_RUNTIME_READ')
    .map(t => Number(t.responsePayload))
    .sort((a, b) => a - b);
  // After cycle 1: 25ms ON; after cycle 2: 50ms ON.
  expect(reads).toEqual([25, 50]);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(50);
});

test('generic (non-stress) runtime accumulation remains correct', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().toggleEnable(true);
  useStore.getState().tick(100);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(100);
  useStore.getState().tick(50);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(150);
  useStore.getState().toggleEnable(false);
  useStore.getState().tick(200);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(150);
});

// ── Stress ON-slice runtime accrual (regression) ──────────────────────────────

test('stress: dropped ON attempts (stopOnMismatch=false) do not accrue runtime', () => {
  useStore.setState({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    settings: { devMode: false, simulatorTiming: 1, droppedResponseRate: 100, localPersistence: true, brandLogo: 'sia', navCollapsed: false },
  });
  useStore.getState().setInterlock(true);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  useStore.getState().startStressTest({
    cycles: 2, onDur: 10, offDur: 10, faultProb: 0, stopOnMismatch: false, stopOnFault: false,
  });
  useStore.getState().tick(80);
  const s = useStore.getState().stressTestState;
  // Every enable request is dropped, so the emission output never becomes active
  // and lifetime runtime must not advance despite time spent in the ON phase.
  expect(s.commErrors).toBeGreaterThan(0);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(runtimeBefore);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('stress: dropped DISABLE (stopOnMismatch=false) keeps output active and accrues OFF-phase runtime; no enableCount double-count; FAIL; final output inactive', () => {
  // Deterministic drop schedule with rate=30 and responseAttempt=2:
  //   transition 0 OFF->ON enable (attempt 2): val 91 >= 30 -> NOT dropped (output active)
  //   transition 1 ON->OFF disable (attempt 3): val 28 <  30 -> DROPPED (command not applied; output STAYS active)
  //   transition 2 OFF->ON enable (attempt 4): val 65 >= 30 -> NOT dropped (output already active; no enableCount++)
  //   transition 3 ON->OFF disable (attempt 5): val  2 <  30 -> DROPPED; completes cycle 2 -> finalize (forces output inactive)
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    responseAttempt: 2,
    settings: { ...state.settings, simulatorTiming: 1, droppedResponseRate: 30 },
    logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: 0 },
  }));
  useStore.getState().setInterlock(true);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  const countBefore = useStore.getState().logicalState.enableCount;
  useStore.getState().startStressTest({
    cycles: 2, onDur: 10, offDur: 10, faultProb: 0, stopOnMismatch: false, stopOnFault: false,
  });
  // One large tick walks: OFF(start,inactive) ON1(active,+10) [disable dropped -> stays active]
  // OFF1(active,+10) ON2(active,+10) [disable dropped -> cycle 2 -> finalize].
  useStore.getState().tick(1000);
  const s = useStore.getState().stressTestState;
  const ls = useStore.getState().logicalState;

  // Dropped disable is recorded as a comm error + mismatch.
  expect(s.commErrors).toBeGreaterThan(0);
  expect(s.mismatches).toBeGreaterThan(0);
  // Runtime accrued for ON1 + OFF1 (output stayed active through OFF) + ON2 = 30ms.
  // The key proof: it exceeds the 20ms that two ON phases alone would give, i.e. the
  // dropped-disable OFF span (10ms) accrued because the device output really was on.
  expect(ls.lifetimeEmissionTimeMs - runtimeBefore).toBe(30);
  // enableCount incremented exactly once (only the first real inactive->active), not
  // again on the OFF->ON where output was already active from the dropped disable.
  expect(ls.enableCount - countBefore).toBe(1);
  // Non-PASS result and finalization forced the output safely inactive.
  expect(s.finalResult).toBe('FAIL');
  expect(s.isActive).toBe(false);
  expect(ls.emissionControlOutputActive).toBe(false);
  expect(ls.requestedEnable).toBe(false);
});

test('stress: blocked ON attempts (interlock open, stopOnMismatch=false) do not accrue runtime or count', () => {
  useStore.setState(state => ({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    settings: { ...state.settings, devMode: true },
  }));
  // Enable interlock capability then break the interlock so ON is blocked.
  useStore.getState().setCapability('interlock', true);
  useStore.getState().setInterlock(false);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  const countBefore = useStore.getState().logicalState.enableCount;
  useStore.getState().startStressTest({
    cycles: 3, onDur: 10, offDur: 10, faultProb: 0, stopOnMismatch: false, stopOnFault: false,
  });
  useStore.getState().tick(120);
  const s = useStore.getState().stressTestState;
  expect(s.mismatches).toBeGreaterThan(0);
  // Output was never permitted -> no runtime accrual and no count increments.
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(runtimeBefore);
  expect(useStore.getState().logicalState.enableCount).toBe(countBefore);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

test('stress: enable count increments exactly once per successful ON transition', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  const countBefore = useStore.getState().logicalState.enableCount;
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });
  useStore.getState().tick(60);
  // 3 clean cycles -> exactly 3 real inactive->active transitions.
  expect(useStore.getState().logicalState.enableCount).toBe(countBefore + 3);
});

// ── Stress pre-run cleanup / baselines (regression) ───────────────────────────

test('stress: starting while output is active performs deterministic cleanup before baseline', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  // Make the output active and accrue some lifetime runtime first.
  useStore.getState().toggleEnable(true);
  useStore.getState().tick(40);
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(true);
  const runtimeBefore = useStore.getState().logicalState.lifetimeEmissionTimeMs;
  const countBefore = useStore.getState().logicalState.enableCount;
  expect(runtimeBefore).toBe(40);

  useStore.getState().startStressTest({ cycles: 2, onDur: 10, offDur: 10, faultProb: 0 });

  // Cleanup established an inactive, non-counting baseline without losing runtime
  // or bumping counts, and logged a pre-cleanup transaction.
  const afterStart = useStore.getState();
  expect(afterStart.logicalState.emissionControlOutputActive).toBe(false);
  expect(afterStart.logicalState.requestedEnable).toBe(false);
  expect(afterStart.logicalState.timerState).toBe(TimerState.NotCounting);
  expect(afterStart.logicalState.lifetimeEmissionTimeMs).toBe(runtimeBefore); // preserved
  expect(afterStart.logicalState.enableCount).toBe(countBefore); // not incremented
  expect(afterStart.stressTestState.baselineRuntimeMs).toBe(runtimeBefore);
  expect(afterStart.stressTestState.baselineEnableCount).toBe(countBefore);
  expect(afterStart.transactions.some(t => t.command === 'STRESS_PRE_CLEANUP')).toBe(true);

  // The subsequent run advances runtime exactly by ON slices from the clean baseline.
  useStore.getState().tick(40);
  expect(useStore.getState().logicalState.lifetimeEmissionTimeMs).toBe(runtimeBefore + 20);
  expect(useStore.getState().stressTestState.completedCycles).toBe(2);
});

// ── Stress final-result correctness (regression) ──────────────────────────────

test('stress CYCLES_COMPLETE is FAIL when errors accumulated with stops disabled', () => {
  useStore.setState({
    connectionState: 'connected',
    lastValidTelemetryAt: Date.now(),
    settings: { devMode: false, simulatorTiming: 1, droppedResponseRate: 100, localPersistence: true, brandLogo: 'sia', navCollapsed: false },
  });
  useStore.getState().setInterlock(true);
  // Drops force comm errors/mismatches every operation, but stops are disabled so
  // the run reaches the requested cycle count. Result must still be FAIL.
  useStore.getState().startStressTest({
    cycles: 2, onDur: 10, offDur: 10, faultProb: 0, stopOnMismatch: false, stopOnFault: false,
  });
  useStore.getState().tick(80);
  const s = useStore.getState().stressTestState;
  expect(s.stopReason).toBe('CYCLES_COMPLETE');
  expect(s.commErrors + s.mismatches).toBeGreaterThan(0);
  expect(s.finalResult).toBe('FAIL');
});

test('stress continues past faults when stopOnFault is false but reports FAIL', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({
    cycles: 3, onDur: 10, offDur: 10, faultProb: 100, stopOnFault: false, stopOnMismatch: false,
  });
  useStore.getState().tick(80);
  const s = useStore.getState().stressTestState;
  expect(s.faults).toBeGreaterThan(0);
  // Reached cycle target but with faults -> FAIL.
  expect(s.finalResult).toBe('FAIL');
});

// ── LIVE freshness enforcement (regression) ───────────────────────────────────

test('startRuntimeObservation blocks when connected but telemetry is stale', () => {
  // Connected but lastValidTelemetryAt is far in the past -> not live.
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: 1 });
  useStore.getState().startRuntimeObservation();
  expect(useStore.getState().runtimeSession.observation.active).toBe(false);
  const tx = useStore.getState().transactions.find(t => t.command === 'RUNTIME_OBS_START');
  expect(tx?.pass).toBe(false);
});

test('runGuidedTimerTest blocks when connected but telemetry is stale', async () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: 1 });
  const result = await useStore.getState().runGuidedTimerTest({ durationMs: 100 });
  expect(result.status).toBe('blocked');
  expect(result.pass).toBe(false);
});

test('startStressTest blocks (not just "connected") when telemetry is stale', () => {
  // Connected but stale telemetry must BLOCK, not start.
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: 1 });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.stopReason).toBe('BLOCKED');
  expect(s.finalResult).toBe('BLOCKED');
  const tx = useStore.getState().transactions.find(t => t.command === 'STRESS_START');
  expect(tx?.pass).toBe(false);
});

test('startStressTest blocks when connected but telemetry freshness is unknown', () => {
  // Connected with no recorded valid telemetry (null) -> UNKNOWN -> BLOCKED.
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: null });
  useStore.getState().startStressTest({ cycles: 3, onDur: 10, offDur: 10, faultProb: 0 });
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.stopReason).toBe('BLOCKED');
});

test('active stress finalizes TELEMETRY_LOST/FAIL when connection drops mid-run (no hung isActive)', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 1000, onDur: 10, offDur: 10, faultProb: 0 });
  useStore.getState().tick(10); // advance a bit while live
  expect(useStore.getState().stressTestState.isActive).toBe(true);
  // Connection drops mid-run.
  useStore.setState({ connectionState: 'disconnected' });
  useStore.getState().tick(20);
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false); // never hung
  expect(s.stopReason).toBe('TELEMETRY_LOST');
  expect(s.finalResult).toBe('FAIL');
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
  const tx = useStore.getState().transactions.find(t => t.command === 'STRESS_STOP' && t.actualResult.includes('TELEMETRY_LOST'));
  expect(tx?.pass).toBe(false);
});

test('active stress finalizes TELEMETRY_LOST/FAIL when telemetry goes stale mid-run', () => {
  useStore.setState({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
  useStore.getState().setInterlock(true);
  useStore.getState().startStressTest({ cycles: 1000, onDur: 10, offDur: 10, faultProb: 0 });
  useStore.getState().tick(10);
  expect(useStore.getState().stressTestState.isActive).toBe(true);
  // Still connected, but telemetry becomes stale (far in the past).
  useStore.setState({ lastValidTelemetryAt: 1 });
  useStore.getState().tick(20);
  const s = useStore.getState().stressTestState;
  expect(s.isActive).toBe(false);
  expect(s.stopReason).toBe('TELEMETRY_LOST');
  expect(s.finalResult).toBe('FAIL');
  expect(useStore.getState().logicalState.emissionControlOutputActive).toBe(false);
});

// ── Simulator timer-state labelling (regression) ──────────────────────────────

test('sim timer-state labels are simulator-only and never bare numbers', async () => {
  const { simTimerStateLabel, SimTimerState } = await import('../src/lib/store');
  expect(simTimerStateLabel(SimTimerState.NotCounting)).toBe('SIM NOT COUNTING');
  expect(simTimerStateLabel(SimTimerState.Counting)).toBe('SIM COUNTING');
  expect(simTimerStateLabel(SimTimerState.Fault)).toBe('SIM FAULT');
  // Values are simulator-internal 0/1/2; firmware/wire enum is not asserted here.
  expect(SimTimerState.NotCounting).toBe(0);
  expect(SimTimerState.Counting).toBe(1);
  expect(SimTimerState.Fault).toBe(2);
});
