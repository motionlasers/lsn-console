import { beforeEach, test, expect } from 'vitest';
import {
  DEFAULT_CAPABILITIES,
  isProfileItemSupported,
  isTestSupported,
  isTransactionSupported,
  useStore,
  visibleLogicalState,
} from '../src/lib/store';

beforeEach(() => {
  useStore.setState({
    mode: 'simulation',
    hardwareUnlocked: false,
    connectionState: 'disconnected',
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
