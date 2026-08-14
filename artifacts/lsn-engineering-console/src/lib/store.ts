import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import profileJson from '../../profiles/lsn-v0.1.json';
import { validateDeviceProfile } from './profile-validation';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'faulted';
export type HardwareMode = 'simulation' | 'hardware';
export type ImplementationStatus = 'TBD' | 'IMPLEMENTING' | 'TESTING' | 'IMPLEMENTED' | 'VERIFIED';
export type SimulationStatus = 'NOT_TESTED' | 'TESTING' | 'VERIFIED';
export type CapabilityKey = 'interlock' | 'remoteStop' | 'sensors';
export type CapabilityModel = Record<CapabilityKey, boolean>;
export const TELEMETRY_STALE_AFTER_MS = 5_000;

export interface TelemetryFreshness {
  state: 'LIVE' | 'STALE' | 'UNKNOWN';
  isLive: boolean;
  ageMs: number | null;
  lastValidUpdateAt: number | null;
}

export function getTelemetryFreshness(
  connectionState: ConnectionState,
  lastValidUpdateAt: number | null,
  now = Date.now(),
  staleAfterMs = TELEMETRY_STALE_AFTER_MS,
): TelemetryFreshness {
  if (lastValidUpdateAt == null) {
    return { state: 'UNKNOWN', isLive: false, ageMs: null, lastValidUpdateAt: null };
  }
  const ageMs = Math.max(0, now - lastValidUpdateAt);
  const isLive = connectionState === 'connected' && ageMs <= staleAfterMs;
  return { state: isLive ? 'LIVE' : 'STALE', isLive, ageMs, lastValidUpdateAt };
}

export const DEFAULT_CAPABILITIES: CapabilityModel = {
  interlock: profileJson.capabilities.interlock.enabled,
  remoteStop: profileJson.capabilities.remoteStop.enabled,
  sensors: profileJson.capabilities.sensors.enabled,
};

export function shouldDropResponse(ratePercent: number, attempt: number): boolean {
  const rate = Math.max(0, Math.min(100, Math.floor(ratePercent)));
  return ((attempt * 37 + 17) % 100) < rate;
}

// Monotonic PC clock reading in milliseconds. Prefers performance.now() (immune
// to system-clock adjustments) and falls back to Date.now() where unavailable.
// Used by the guided timer test to MEASURE PC elapsed time rather than assuming it.
export function monotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// Simulated DEVICE wall-clock oscillator reading in milliseconds. This models the
// device's own free-running timer, which keeps counting through browser
// event-loop stalls (unlike callback counting). It reads Date.now() so it can be
// stubbed INDEPENDENTLY of the PC monotonic clock (performance.now) in tests.
export function deviceWallClockNowMs(): number {
  return Date.now();
}

export interface DeviceIdentity {
  name: string;
  product: string;
  ip: string;
  serial: string;
  platform: string;
  firmware: string;
  protocolVersion: string;
  hardwareRevision: string;
  profile: string;
  owner: string;
}

export interface LogicalState {
  ready: boolean;
  requestedEnable: boolean;
  reportedEnablePermitted: boolean;
  emissionControlOutputActive: boolean;
  interlockOK: boolean;
  remoteStopOK: boolean;
  faulted: boolean;
  faultCode: string | null;
  timerState: number;
  lifetimeEmissionTimeMs: number;
  enableCount: number;
  networkControlActive: boolean;
  lastDisableReason: string | null;
  storageFailure: boolean;
  commsLoss: boolean;
  modulesEnabled: boolean;
}

export interface ProfileItem {
  id: string;
  symbolicName: string;
  direction: 'PC_TO_LSN' | 'LSN_TO_PC';
  dataType: string;
  access: 'READ' | 'WRITE' | 'READ_WRITE';
  cipService: string | 'TBD';
  class: string | 'TBD';
  instance: string | 'TBD';
  attribute: string | 'TBD';
  assembly: string | 'TBD';
  implementationStatus: ImplementationStatus;
  simulationStatus: SimulationStatus;
  expectedFirmwareBehavior: string;
  expectedReportedResponse: string;
  notes: string;
  capability?: CapabilityKey;
}

export function effectiveFirmwareStatus(item: ProfileItem): ImplementationStatus {
  const mappingUnresolved =
    item.cipService === 'TBD' ||
    item.class === 'TBD' ||
    item.instance === 'TBD' ||
    item.attribute === 'TBD';
  return mappingUnresolved ? 'TBD' : item.implementationStatus;
}

export interface Transaction {
  id: string;
  timestamp: number;
  sequence: number;
  direction: 'tx' | 'rx' | 'bidirectional';
  operation: string;
  command: string;
  service: string;
  mapping: string | null;
  requestPayload: string;
  responsePayload: string;
  requestHex: string;
  responseHex: string;
  requestDecoded: string;
  responseDecoded: string;
  status: 'ok' | 'timeout' | 'error' | 'dropped';
  latency: number;
  relatedAction: string | null;
  expectedResult: string;
  actualResult: string;
  pass: boolean;
  capability?: CapabilityKey;
}

export interface TestResult {
  id: string;
  name: string;
  category: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  expected: string;
  actual: string;
  duration: number;
  evidence: string;
  manualObservation: boolean;
  manualNote?: string;
  capability?: CapabilityKey;
}

export function isProfileItemSupported(item: ProfileItem, capabilities: CapabilityModel): boolean {
  return !item.capability || capabilities[item.capability];
}

export function isTestSupported(test: TestResult, capabilities: CapabilityModel): boolean {
  return !test.capability || capabilities[test.capability];
}

export function isTransactionSupported(transaction: Transaction, capabilities: CapabilityModel): boolean {
  return !transaction.capability || capabilities[transaction.capability];
}

export function visibleLogicalState(logicalState: LogicalState, capabilities: CapabilityModel): Partial<LogicalState> {
  const visible: Partial<LogicalState> = { ...logicalState };
  if (!capabilities.interlock) delete visible.interlockOK;
  if (!capabilities.remoteStop) delete visible.remoteStopOK;
  if (!capabilities.sensors) delete visible.modulesEnabled;
  return visible;
}

export function sanitizeLogicalStateForCapabilities(
  logicalState: LogicalState,
  capabilities: CapabilityModel,
): LogicalState {
  return {
    ...logicalState,
    interlockOK: capabilities.interlock ? logicalState.interlockOK : true,
    remoteStopOK: capabilities.remoteStop ? logicalState.remoteStopOK : true,
    modulesEnabled: capabilities.sensors ? logicalState.modulesEnabled : false,
  };
}

export interface FirmwareUpdateState {
  isActive: boolean;
  stage: 'idle' | 'verifying_metadata' | 'transferring' | 'verifying' | 'rebooting' | 'validating' | 'completed' | 'failed';
  progress: number;
  scenarioId: string | null;
  failureStage: string | null;
  failureReason: string | null;
  resultingVersion: string | null;
  knownGoodAvailable: boolean;
  rollbackOccurred: boolean;
  recommendedNextStep: string | null;
  runningFirmwareAffected: boolean;
  deviceState: string;
  basicValidationStatus: 'not-run' | 'running' | 'passed' | 'failed';
}

export interface FirmwarePackageMetadata {
  id: string;
  version: string;
  target: string;
  protocol: string;
  size: number;
  checksum: string;
  signature: 'VALID' | 'INVALID' | 'UNSIGNED';
  scenario: string;
}

// ── Simulator-internal timer state ────────────────────────────────────────────
// IMPORTANT: These 0/1/2 values are SIMULATOR-INTERNAL ONLY. They are NOT a
// finalized firmware/wire enum. The real LSN LifetimeEmissionTime/timer-state
// numeric mapping remains TBD in the device profile. UI must present these as
// SIM labels (SIM NOT COUNTING / SIM COUNTING / SIM FAULT), never as confirmed
// wire values. deriveSimTimerState() enforces the following simulator mapping:
//   0 = SIM NOT COUNTING -> output inactive, session healthy (simulated)
//   1 = SIM COUNTING     -> emission output active and telemetry live (simulated)
//   2 = SIM FAULT        -> faulted or communication loss (simulated)
export const SimTimerState = {
  NotCounting: 0,
  Counting: 1,
  Fault: 2,
} as const;
export type SimTimerStateValue = (typeof SimTimerState)[keyof typeof SimTimerState];

// Simulator-facing display labels. These are the ONLY presentation-safe strings
// for the simulator-internal timer state; do not surface the raw 0/1/2 numbers
// as if they were finalized firmware/profile values.
export const SIM_TIMER_STATE_LABELS: Record<SimTimerStateValue, string> = {
  [SimTimerState.NotCounting]: 'SIM NOT COUNTING',
  [SimTimerState.Counting]: 'SIM COUNTING',
  [SimTimerState.Fault]: 'SIM FAULT',
};

export function simTimerStateLabel(value: number): string {
  return SIM_TIMER_STATE_LABELS[value as SimTimerStateValue] ?? `SIM UNKNOWN(${value})`;
}

// Backwards-compatible aliases (the previous names implied a canonical firmware
// enum, which is not accurate — kept only to avoid churn in callers).
export const TimerState = SimTimerState;
export type TimerStateValue = SimTimerStateValue;

/**
 * Derive the simulator-internal timer state from logical/connection conditions.
 * Counting only when output is active AND telemetry is live (connected, no comms loss).
 * Fault takes precedence when faulted or comms is lost. Simulator-internal only.
 */
export function deriveSimTimerState(
  logicalState: Pick<LogicalState, 'emissionControlOutputActive' | 'faulted' | 'commsLoss'>,
  telemetryLive: boolean,
): SimTimerStateValue {
  if (logicalState.faulted || logicalState.commsLoss) return SimTimerState.Fault;
  if (telemetryLive && logicalState.emissionControlOutputActive) return SimTimerState.Counting;
  return SimTimerState.NotCounting;
}

// Backwards-compatible alias.
export const deriveTimerState = deriveSimTimerState;

// ── Runtime engineering session ───────────────────────────────────────────────
export interface RuntimeReading {
  runtimeMs: number;
  enableCount: number;
  timerState: number;
  timestamp: number;
}

export interface RuntimeObservationSample {
  timestamp: number;
  runtimeMs: number;
  enableCount: number;
}

export interface RuntimeObservation {
  active: boolean;
  startedAt: number | null;
  stoppedAt: number | null;
  startRuntimeMs: number;
  currentRuntimeMs: number;
  startEnableCount: number;
  currentEnableCount: number;
  elapsedPcMs: number;
  lsnIncreaseMs: number;
  differenceMs: number;
  samples: RuntimeObservationSample[];
  sampleAccumMs: number;
}

export interface RuntimeSessionState {
  firstReading: RuntimeReading | null;
  lastReading: RuntimeReading | null;
  observation: RuntimeObservation;
}

// ── Guided Timer test ─────────────────────────────────────────────────────────
export interface TimerTestConfig {
  durationMs: number;
  toleranceMs: number;
}

export interface TimerTestResult {
  status: 'idle' | 'running' | 'passed' | 'failed' | 'blocked';
  startedAt: number | null;
  finishedAt: number | null;
  startRuntimeMs: number;
  endRuntimeMs: number;
  // Simulated device runtime increase, produced by an INDEPENDENT modeled device
  // clock that advances by a fixed nominal quantum per scheduled device tick (NOT
  // derived from PC/performance.now elapsed). This lets PC time and device time
  // drift apart genuinely when scheduled callbacks are delayed.
  lsnIncreaseMs: number;
  // PC elapsed time MEASURED with a monotonic clock (performance.now).
  pcMeasuredMs: number;
  differenceMs: number;
  toleranceMs: number;
  // Fixed nominal device timer quantum used for the modeled device clock (ms).
  deviceQuantumMs: number;
  // Number of device ticks that actually accrued runtime (output active + live).
  deviceTicksAccrued: number;
  // Whether the disable command at cleanup actually took effect. A cleanup command
  // failure (e.g. dropped disable response) forces the result to FAILED even when
  // timing was within tolerance, after a fail-safe direct simulator state cleanup.
  cleanupOk: boolean;
  // True when a competing stress run was detected (at start or mid-run). A conflict
  // forces the timer test to FAILED, discards device-elapsed as valid runtime, and
  // forces output inactive.
  conflict: boolean;
  // True only if the output was confirmed active immediately after enable AND stayed
  // continuously active with LIVE telemetry for the whole protected interval (durable
  // continuity latch unchanged and no interruption observed by sampling). This is a
  // hard PASS prerequisite independent of timing tolerance.
  continuousActiveLive: boolean;
  // True when output was confirmed active immediately after the enable attempt.
  outputActiveAtStart: boolean;
  pass: boolean;
  notes: string;
}

// ── Guided Persistence test ───────────────────────────────────────────────────
export interface PersistenceTestResult {
  status: 'idle' | 'running' | 'awaiting_continue' | 'passed' | 'failed' | 'blocked';
  phase: 'idle' | 'before' | 'restarting' | 'after' | 'complete';
  startedAt: number | null;
  finishedAt: number | null;
  runtimeBeforeMs: number;
  runtimeAfterMs: number;
  differenceMs: number;
  firmwareBefore: string;
  firmwareAfter: string;
  nonDecreasing: boolean;
  pass: boolean;
  manual: boolean;
  notes: string;
}

// ── Stress workflow ───────────────────────────────────────────────────────────
export interface StressConfig {
  cycles: number;
  onDur: number;
  offDur: number;
  faultProb: number;
  maxDuration?: number;
  stopOnMismatch?: boolean;
  stopOnFault?: boolean;
  runtimeReadEvery?: number;
  enableCountReadEvery?: number;
  operationDelay?: number;
}

export type StressStopReason =
  | null
  | 'CYCLES_COMPLETE'
  | 'MAX_DURATION'
  | 'FAULT'
  | 'MISMATCH'
  | 'ABORTED'
  | 'BLOCKED'
  | 'TELEMETRY_LOST';

export type StressFinalResult = null | 'PASS' | 'FAIL' | 'ABORTED' | 'BLOCKED';

export interface StressTestState {
  isActive: boolean;
  completedCycles: number;
  targetCycles: number;
  onDuration: number;
  offDuration: number;
  faultProbability: number;
  phase: 'on' | 'off';
  phaseElapsedMs: number;
  // expanded configuration
  maxDuration: number;
  stopOnMismatch: boolean;
  stopOnFault: boolean;
  runtimeReadEvery: number;
  enableCountReadEvery: number;
  operationDelay: number;
  // metrics / baselines
  startedAt: number | null;
  endedAt: number | null;
  baselineRuntimeMs: number;
  baselineEnableCount: number;
  endRuntimeMs: number;
  endEnableCount: number;
  elapsedMs: number;
  commErrors: number;
  mismatches: number;
  faults: number;
  latencySamples: number[];
  latencyMin: number | null;
  latencyMax: number | null;
  latencyAvg: number | null;
  stopReason: StressStopReason;
  finalResult: StressFinalResult;
}

interface LSNStore {
  mode: HardwareMode;
  hardwareUnlocked: boolean;
  connectionState: ConnectionState;
  lastValidTelemetryAt: number | null;
  device: DeviceIdentity;
  discovered: boolean;
  logicalState: LogicalState;
  profile: ProfileItem[];
  baseCapabilities: CapabilityModel;
  capabilities: CapabilityModel;
  transactions: Transaction[];
  tests: TestResult[];
  settings: {
    devMode: boolean;
    simulatorTiming: number;
    droppedResponseRate: number;
    localPersistence: boolean;
    brandLogo: 'sia' | 'bls';
    navCollapsed: boolean;
  };
  firmwareState: FirmwareUpdateState;
  responseAttempt: number;
  transactionCapabilityContext: CapabilityKey | null;
  runtimeSession: RuntimeSessionState;
  timerTest: TimerTestResult;
  persistenceTest: PersistenceTestResult;
  stressTestState: StressTestState;
  // Durable continuity latch (store boundary). Incremented whenever a user-visible
  // path breaks the active/live emission output while a guided timer test is
  // running. Captured after a successful timer enable and compared before
  // finalization so a disable+re-enable between samples cannot erase an
  // interruption. Volatile: NOT persisted.
  timerOutputInterruptions: number;

  // Actions
  setMode: (mode: HardwareMode) => void;
  setHardwareUnlocked: (unlocked: boolean) => void;
  setCapability: (capability: CapabilityKey, enabled: boolean) => void;
  discover: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleEnable: (enable: boolean) => void;
  // Internal: latch a timer-run output interruption (increments the durable counter
  // only while a guided timer test is running). Idempotent-safe to call.
  latchTimerInterruption: (reason: string) => void;
  setInterlock: (ok: boolean) => void;
  setRemoteStop: (ok: boolean) => void;
  triggerFault: (code: string) => void;
  clearFault: () => void;
  updateLogicalState: (updates: Partial<LogicalState>) => void;
  updateProfileItem: (id: string, updates: Partial<ProfileItem>) => void;
  importProfile: (jsonString: string) => { success: boolean; error?: string; message?: string };
  addTransaction: (tx: Omit<Transaction, 'id' | 'timestamp' | 'sequence'>) => void;
  clearTransactions: () => void;
  updateSettings: (settings: Partial<LSNStore['settings']>) => void;
  resetSettings: () => void;
  runTest: (testId: string) => Promise<void>;
  runAllTests: () => Promise<void>;
  updateTestNote: (testId: string, note: string) => void;
  tick: (deltaMs: number) => void;
  startFirmwareUpdate: (scenarioId: string, pkgMetadata: FirmwarePackageMetadata) => Promise<void>;
  resetFirmwareState: () => void;
  runtimeRead: () => RuntimeReading | null;
  startRuntimeObservation: () => void;
  stopRuntimeObservation: () => void;
  runGuidedTimerTest: (config?: Partial<TimerTestConfig>) => Promise<TimerTestResult>;
  runGuidedPersistenceTest: (engineeringNote?: string) => Promise<PersistenceTestResult>;
  continuePersistenceTest: (manualNote?: string) => PersistenceTestResult;
  startStressTest: (config: StressConfig) => void;
  stopStressTest: () => void;
  importState: (json: string) => void;
}

const DEFAULT_DEVICE: DeviceIdentity = {
  name: 'LSN-SIM-001',
  product: 'LSN Development Controller',
  ip: '192.168.1.50',
  serial: 'SIM-001',
  platform: 'WT32-ETH01',
  firmware: '0.1.0-sim',
  protocolVersion: 'LSN v0.1',
  hardwareRevision: 'SIMULATED',
  profile: 'LSN v0.1',
  owner: 'Local Engineer',
};

const DEFAULT_STATE: LogicalState = {
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
};

export const DEFAULT_TIMER_CONFIG: TimerTestConfig = { durationMs: 1000, toleranceMs: 50 };

// Fixed nominal quantum for the modeled simulated-device timer clock. The device
// runtime counter advances by exactly this many ms per scheduled device tick when
// the emission output is active and telemetry is live — independent of how long
// the PC actually spent between callbacks (measured separately by performance.now).
export const DEVICE_TIMER_QUANTUM_MS = 10;

const INITIAL_RUNTIME_OBSERVATION: RuntimeObservation = {
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
};

const INITIAL_RUNTIME_SESSION: RuntimeSessionState = {
  firstReading: null,
  lastReading: null,
  observation: INITIAL_RUNTIME_OBSERVATION,
};

const INITIAL_TIMER_TEST: TimerTestResult = {
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  startRuntimeMs: 0,
  endRuntimeMs: 0,
  lsnIncreaseMs: 0,
  pcMeasuredMs: 0,
  differenceMs: 0,
  toleranceMs: DEFAULT_TIMER_CONFIG.toleranceMs,
  deviceQuantumMs: DEVICE_TIMER_QUANTUM_MS,
  deviceTicksAccrued: 0,
  cleanupOk: true,
  conflict: false,
  continuousActiveLive: false,
  outputActiveAtStart: false,
  pass: false,
  notes: '',
};

const INITIAL_PERSISTENCE_TEST: PersistenceTestResult = {
  status: 'idle',
  phase: 'idle',
  startedAt: null,
  finishedAt: null,
  runtimeBeforeMs: 0,
  runtimeAfterMs: 0,
  differenceMs: 0,
  firmwareBefore: '',
  firmwareAfter: '',
  nonDecreasing: false,
  pass: false,
  manual: false,
  notes: '',
};

const INITIAL_STRESS_STATE: StressTestState = {
  isActive: false,
  completedCycles: 0,
  targetCycles: 0,
  onDuration: 0,
  offDuration: 0,
  faultProbability: 0,
  phase: 'off',
  phaseElapsedMs: 0,
  maxDuration: 0,
  stopOnMismatch: true,
  stopOnFault: true,
  runtimeReadEvery: 0,
  enableCountReadEvery: 0,
  operationDelay: 0,
  startedAt: null,
  endedAt: null,
  baselineRuntimeMs: 0,
  baselineEnableCount: 0,
  endRuntimeMs: 0,
  endEnableCount: 0,
  elapsedMs: 0,
  commErrors: 0,
  mismatches: 0,
  faults: 0,
  latencySamples: [],
  latencyMin: null,
  latencyMax: null,
  latencyAvg: null,
  stopReason: null,
  finalResult: null,
};

const INITIAL_PROFILE: ProfileItem[] = profileJson.fields.map((item, index) => ({
  id: String(index + 1),
  symbolicName: item.symbolicName,
  direction: item.direction as ProfileItem['direction'],
  dataType: item.dataType,
  access: item.access as ProfileItem['access'],
  cipService: item.cipService ?? 'TBD',
  class: item.class == null ? 'TBD' : String(item.class),
  instance: item.instance == null ? 'TBD' : String(item.instance),
  attribute: item.attribute == null ? 'TBD' : String(item.attribute),
  assembly: item.assembly == null ? 'TBD' : JSON.stringify(item.assembly),
  implementationStatus: item.implementationStatus as ImplementationStatus,
  simulationStatus: item.simulationStatus as SimulationStatus,
  expectedFirmwareBehavior: item.expectedFirmwareBehavior,
  expectedReportedResponse: item.expectedReportedResponse,
  notes: item.notes,
  capability: 'capability' in item ? item.capability as CapabilityKey : undefined,
}));

export const INITIAL_TESTS: TestResult[] = [
  { id: 't_disc', name: 'Discovery', category: 'Session', status: 'pending', expected: 'Controller responds to discovery beacon', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_id', name: 'Identity Verification', category: 'Session', status: 'pending', expected: 'Identity matches profile expectations', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_conn', name: 'Connect & Session', category: 'Session', status: 'pending', expected: 'Simulated session opens while service mapping remains TBD', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_def', name: 'Default Disabled', category: 'Startup', status: 'pending', expected: 'Emission Output Active is FALSE on boot', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_en', name: 'Enable Request/Feedback', category: 'Control', status: 'pending', expected: 'Emission Output Active == TRUE after request', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_dis', name: 'Disable Request/Feedback', category: 'Control', status: 'pending', expected: 'Emission Output Active == FALSE after disable', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_intl', name: 'Interlock Block', category: 'Control', status: 'pending', expected: 'Enable blocked when interlock open', actual: '', duration: 0, evidence: '', manualObservation: false, capability: 'interlock' },
  { id: 't_rem', name: 'Remote Stop Block', category: 'Control', status: 'pending', expected: 'Enable blocked when remote stop asserted', actual: '', duration: 0, evidence: '', manualObservation: false, capability: 'remoteStop' },
  { id: 't_flt', name: 'Fault State & Reset', category: 'Diagnostics', status: 'pending', expected: 'Fault disables emission, clears on reset', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_rt', name: 'Runtime Accumulation', category: 'Runtime', status: 'pending', expected: 'Monotonic runtime increases while active', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_cnt', name: 'Enable Count', category: 'Runtime', status: 'pending', expected: 'Count increments exactly once per transition', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_loss', name: 'Comms Loss / Auto-Disable', category: 'Communication', status: 'pending', expected: 'Auto-disable on network timeout', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_pers', name: 'Persistence Failure', category: 'Diagnostics', status: 'pending', expected: 'Indicate SIMULATED FAILURE clearly', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_persrec', name: 'Persistence Recovery', category: 'Diagnostics', status: 'pending', expected: 'Storage failure clears and counters remain available', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_reconn', name: 'Reconnect', category: 'Communication', status: 'pending', expected: 'Session reconnects after simulated communication recovery', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_rtstop', name: 'Runtime Stops While Inactive', category: 'Runtime', status: 'pending', expected: 'Runtime remains unchanged while output is inactive', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_bv', name: 'Post-Update Basic Validation', category: 'Validation', status: 'pending', expected: 'Basic enable/disable succeeds post-update', actual: '', duration: 0, evidence: '', manualObservation: false },
];

let globalSequence = 0;

export const useStore = create<LSNStore>()(
  persist(
    (set, get) => ({
      mode: 'simulation',
      hardwareUnlocked: false,
      connectionState: 'disconnected',
      lastValidTelemetryAt: null,
      discovered: false,
      device: DEFAULT_DEVICE,
      logicalState: DEFAULT_STATE,
      profile: INITIAL_PROFILE,
      baseCapabilities: DEFAULT_CAPABILITIES,
      capabilities: DEFAULT_CAPABILITIES,
      transactions: [],
      tests: INITIAL_TESTS,
      firmwareState: {
        isActive: false, stage: 'idle', progress: 0, scenarioId: null, failureStage: null, failureReason: null, resultingVersion: null, knownGoodAvailable: false, rollbackOccurred: false, recommendedNextStep: null, runningFirmwareAffected: false, deviceState: 'ready', basicValidationStatus: 'not-run'
      },
      responseAttempt: 0,
      transactionCapabilityContext: null,
      runtimeSession: INITIAL_RUNTIME_SESSION,
      timerTest: INITIAL_TIMER_TEST,
      persistenceTest: INITIAL_PERSISTENCE_TEST,
      stressTestState: INITIAL_STRESS_STATE,
      timerOutputInterruptions: 0,
      settings: {
        devMode: false,
        simulatorTiming: 100,
        droppedResponseRate: 0,
        localPersistence: true,
        brandLogo: 'sia',
        navCollapsed: false,
      },

      setMode: (mode) => set(state => ({
        mode,
        connectionState: 'disconnected',
        hardwareUnlocked: false,
        capabilities: mode === 'hardware' ? state.baseCapabilities : state.capabilities,
        logicalState: mode === 'hardware' ? {
          ...state.logicalState,
          interlockOK: true,
          remoteStopOK: true,
          modulesEnabled: false,
        } : state.logicalState,
      })),
      setHardwareUnlocked: (unlocked) => set({ hardwareUnlocked: unlocked }),
      setCapability: (capability, enabled) => {
        if (get().mode !== 'simulation' || !get().settings.devMode) return;
        set(state => ({
          capabilities: { ...state.capabilities, [capability]: enabled },
          logicalState: {
            ...state.logicalState,
            ...(capability === 'interlock' && !enabled ? { interlockOK: true } : {}),
            ...(capability === 'remoteStop' && !enabled ? { remoteStopOK: true } : {}),
            ...(capability === 'sensors' && !enabled ? { modulesEnabled: false } : {}),
          },
        }));
      },

      discover: async () => {
        if (get().mode === 'hardware') return;
        set({ discovered: false });
        await new Promise(r => setTimeout(r, get().settings.simulatorTiming));
        set({ discovered: true });
        get().addTransaction({
          direction: 'bidirectional', operation: 'DISCOVER', command: 'BROADCAST', service: 'TBD', mapping: null,
          requestPayload: '{}', responsePayload: JSON.stringify(get().device),
          requestHex: 'SIM 00', responseHex: 'SIM FF', requestDecoded: 'Simulated discovery request; service TBD', responseDecoded: `Simulated identity: ${get().device.name}`,
          status: 'ok', latency: get().settings.simulatorTiming, relatedAction: 'discover', expectedResult: 'One simulated identity response', actualResult: 'One simulated identity response', pass: true
        });
      },

      connect: async () => {
        const { mode, settings } = get();
        if (mode === 'hardware') {
          set({ connectionState: 'faulted' });
          get().addTransaction({
            direction: 'tx', operation: 'CONNECT', command: 'INIT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '', requestDecoded: 'Hardware transmit blocked', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'connect', expectedResult: 'Connected', actualResult: 'Hardware validation required', pass: false
          });
          return;
        }

        if (get().logicalState.commsLoss) {
          set({ connectionState: 'faulted' });
          get().addTransaction({
            direction: 'tx', operation: 'CONNECT', command: 'INIT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '', requestDecoded: 'Connection Failed (Comms Loss)', responseDecoded: '',
            status: 'error', latency: settings.simulatorTiming, relatedAction: 'connect', expectedResult: 'ACK', actualResult: 'TIMEOUT', pass: false
          });
          return;
        }

        set({ connectionState: 'connecting' });
        await new Promise(r => setTimeout(r, settings.simulatorTiming * 2));
        set({ connectionState: 'connected', lastValidTelemetryAt: Date.now() });
        
        get().addTransaction({
          direction: 'tx', operation: 'CONNECT', command: 'INIT', service: 'TBD', mapping: null,
          requestPayload: '{}', responsePayload: '{}', requestHex: 'SIM 01 00', responseHex: 'SIM 81 00', requestDecoded: 'Simulated session request; CIP service TBD', responseDecoded: 'Simulated session accepted',
          status: 'ok', latency: settings.simulatorTiming, relatedAction: 'connect', expectedResult: 'Simulated session connected', actualResult: 'Simulated session connected', pass: true
        });
      },

      disconnect: () => {
        // Disconnecting breaks the LIVE-telemetry continuity a timer run depends on.
        get().latchTimerInterruption('disconnect broke live session');
        set({ connectionState: 'disconnected', discovered: false });
        get().addTransaction({
          direction: 'tx', operation: 'DISCONNECT', command: 'CLOSE', service: 'TBD', mapping: null,
          requestPayload: '{}', responsePayload: '{}', requestHex: 'SIM 02 00', responseHex: 'SIM 82 00', requestDecoded: 'Simulated session close; CIP service TBD', responseDecoded: 'Simulated close acknowledged',
          status: 'ok', latency: 5, relatedAction: 'disconnect', expectedResult: 'ACK', actualResult: 'ACK', pass: true
        });
      },

      latchTimerInterruption: (_reason) => {
        // Durable latch: only meaningful while a guided timer test is running. This
        // records that the protected active/live output was broken at some point, so
        // a later re-enable cannot hide the interruption from finalization. The
        // reason arg documents the call site (not otherwise consumed).
        if (get().timerTest.status !== 'running') return;
        set(state => ({ timerOutputInterruptions: state.timerOutputInterruptions + 1 }));
      },

      toggleEnable: (enable) => {
        const { connectionState, mode, settings, responseAttempt } = get();
        
        if (mode === 'hardware') {
          // Controls visibly blocked in UI, but if reached, record as blocked
          get().addTransaction({
            direction: 'tx', operation: 'WRITE', command: 'ENABLE_REQ', service: 'TBD', mapping: 'RequestedEnable',
            requestPayload: enable ? '1' : '0', responsePayload: '', requestHex: '', responseHex: '', requestDecoded: 'Hardware Transmit Blocked', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'toggleEnable', expectedResult: 'Block', actualResult: 'Block', pass: false
          });
          return;
        }
        if (connectionState !== 'connected') return;

        const dropResponse = get().logicalState.commsLoss || shouldDropResponse(settings.droppedResponseRate, responseAttempt);
        set({ responseAttempt: responseAttempt + 1 });
        if (dropResponse) {
           get().addTransaction({
            direction: 'tx', operation: 'WRITE', command: 'ENABLE_REQ', service: 'TBD', mapping: 'RequestedEnable',
            requestPayload: enable ? '1' : '0', responsePayload: '', requestHex: enable ? '01' : '00', responseHex: '', requestDecoded: `Set RequestedEnable = ${enable} (LOST)`, responseDecoded: '',
            status: 'dropped', latency: settings.simulatorTiming, relatedAction: 'toggleEnable', expectedResult: 'Simulated state acknowledgement', actualResult: 'Response intentionally dropped', pass: false
          });
          return;
        }

        set(state => {
          const reqEnable = enable;
          let permitted = true;
          let outputActive = false;
          const interlockBlocks = reqEnable && state.capabilities.interlock && !state.logicalState.interlockOK;
          const remoteStopBlocks = reqEnable && state.capabilities.remoteStop && !state.logicalState.remoteStopOK;
          
          if (reqEnable) {
            if (interlockBlocks || remoteStopBlocks || state.logicalState.faulted) {
              permitted = false;
            } else {
              outputActive = true;
            }
          }

          get().addTransaction({
            direction: 'tx', operation: 'WRITE', command: 'ENABLE_REQ', service: 'TBD', mapping: 'RequestedEnable',
            requestPayload: enable ? '1' : '0', responsePayload: permitted ? 'ACK' : 'NACK', requestHex: enable ? '01' : '00', responseHex: permitted ? '06' : '15',
            requestDecoded: `Set RequestedEnable = ${enable}`, responseDecoded: permitted ? (outputActive ? 'OUTPUT ACTIVE' : 'PERMITTED') : 'BLOCKED',
            status: 'ok', latency: settings.simulatorTiming, relatedAction: 'toggleEnable', expectedResult: enable ? 'Output follows request only when permitted' : 'Output becomes inactive', actualResult: outputActive ? 'Output active' : (permitted ? 'Output inactive' : 'Request blocked'), pass: enable ? outputActive === permitted : !outputActive,
            capability: interlockBlocks ? 'interlock' : remoteStopBlocks ? 'remoteStop' : undefined,
          });

          return {
            lastValidTelemetryAt: Date.now(),
            logicalState: {
              ...state.logicalState,
              requestedEnable: reqEnable,
              reportedEnablePermitted: permitted,
              emissionControlOutputActive: outputActive,
              enableCount: outputActive && !state.logicalState.emissionControlOutputActive ? state.logicalState.enableCount + 1 : state.logicalState.enableCount,
              lastDisableReason: !reqEnable
                ? 'User Requested'
                : interlockBlocks
                  ? 'Interlock Blocked'
                  : remoteStopBlocks
                    ? 'Remote Stop Blocked'
                    : state.logicalState.faulted
                      ? 'Fault Blocked'
                      : state.logicalState.lastDisableReason
            }
          };
        });
        // Latch a continuity break if this command left the output inactive while a
        // timer test is running (a disable, or a blocked enable request).
        if (!get().logicalState.emissionControlOutputActive) {
          get().latchTimerInterruption('toggleEnable left output inactive');
        }
      },

      setInterlock: (ok) => {
        if (!get().capabilities.interlock || get().mode !== 'simulation') return;
        let brokeOutput = false;
        set(state => {
          const newState = { ...state.logicalState, interlockOK: ok };
          if (!ok && newState.emissionControlOutputActive) {
            newState.emissionControlOutputActive = false;
            newState.reportedEnablePermitted = false;
            newState.lastDisableReason = 'Interlock Broken';
            brokeOutput = true;
          }
          return {
            logicalState: newState,
            lastValidTelemetryAt: state.connectionState === 'connected' ? Date.now() : state.lastValidTelemetryAt,
          };
        });
        if (brokeOutput) get().latchTimerInterruption('interlock broke active output');
      },

      setRemoteStop: (ok) => {
        if (!get().capabilities.remoteStop || get().mode !== 'simulation') return;
        let brokeOutput = false;
        set(state => {
          const newState = { ...state.logicalState, remoteStopOK: ok };
          if (!ok && newState.emissionControlOutputActive) {
            newState.emissionControlOutputActive = false;
            newState.reportedEnablePermitted = false;
            newState.lastDisableReason = 'Remote Stop Asserted';
            brokeOutput = true;
          }
          return {
            logicalState: newState,
            lastValidTelemetryAt: state.connectionState === 'connected' ? Date.now() : state.lastValidTelemetryAt,
          };
        });
        if (brokeOutput) get().latchTimerInterruption('remote stop broke active output');
      },

      triggerFault: (code) => {
        get().addTransaction({
            direction: 'rx', operation: 'NOTIFY', command: 'FAULT_EVENT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: `{"code": "${code}"}`, requestHex: '', responseHex: 'SIM FF', requestDecoded: '', responseDecoded: `Simulated fault: ${code}; field mapping TBD`,
          status: 'error', latency: 0, relatedAction: 'fault_injection', expectedResult: 'None', actualResult: 'Fault registered', pass: false
        });

        const wasActive = get().logicalState.emissionControlOutputActive;
        set(state => ({
          lastValidTelemetryAt: state.connectionState === 'connected' ? Date.now() : state.lastValidTelemetryAt,
          logicalState: {
            ...state.logicalState,
            faulted: true,
            faultCode: code,
            emissionControlOutputActive: false,
            reportedEnablePermitted: false,
            lastDisableReason: `Fault: ${code}`
          }
        }));
        if (wasActive) get().latchTimerInterruption(`fault ${code} broke active output`);
      },

      clearFault: () => {
        get().addTransaction({
          direction: 'tx', operation: 'WRITE', command: 'CLEAR_FAULT', service: 'TBD', mapping: 'FaultReset',
          requestPayload: '1', responsePayload: 'ACK', requestHex: '01', responseHex: '06', requestDecoded: `Clear fault request`, responseDecoded: 'ACK',
          status: 'ok', latency: 8, relatedAction: 'clearFault', expectedResult: 'Success', actualResult: 'Success', pass: true
        });

        set(state => ({
          logicalState: { ...state.logicalState, faulted: false, faultCode: null },
          lastValidTelemetryAt: state.connectionState === 'connected' ? Date.now() : state.lastValidTelemetryAt,
        }));
      },

      updateLogicalState: (updates) => {
        // A comms loss, an explicit output-off, or an explicit storage failure all
        // break the active/live continuity a timer run depends on. Latch before the
        // state change so the durable counter records it.
        if (get().timerTest.status === 'running') {
          const breaksContinuity =
            updates.commsLoss === true ||
            (updates.emissionControlOutputActive === false && get().logicalState.emissionControlOutputActive) ||
            updates.storageFailure === true;
          if (breaksContinuity) get().latchTimerInterruption('updateLogicalState broke active/live output');
        }
        set(state => ({
          logicalState: { ...state.logicalState, ...updates },
          connectionState: updates.commsLoss === true ? 'faulted' : state.connectionState,
          discovered: updates.commsLoss === true ? false : state.discovered,
          lastValidTelemetryAt:
            updates.commsLoss === true || state.connectionState !== 'connected'
              ? state.lastValidTelemetryAt
              : Date.now(),
        }));
      },
      
      updateProfileItem: (id, updates) => set(state => ({
        profile: state.profile.map(p => p.id === id ? { ...p, ...updates } : p)
      })),

      importProfile: (jsonString) => {
        try {
          const parsed: unknown = JSON.parse(jsonString);
          const validation = validateDeviceProfile(parsed);
          if (!validation.valid) {
            return { success: false, error: `JSON Schema validation failed: ${validation.errors.join('; ')}` };
          }
          const validated = parsed as typeof profileJson;
          if (validated.fields.length === 0) {
            return { success: false, error: 'JSON Schema validation passed, but fields must not be empty.' };
          }
          const imported: ProfileItem[] = validated.fields.map((item) => ({
            id: uuidv4(),
            symbolicName: item.symbolicName,
            direction: item.direction as ProfileItem['direction'],
            dataType: item.dataType,
            access: item.access as ProfileItem['access'],
            cipService: item.cipService ?? 'TBD',
            class: item.class == null ? 'TBD' : String(item.class),
            instance: item.instance == null ? 'TBD' : String(item.instance),
            attribute: item.attribute == null ? 'TBD' : String(item.attribute),
            assembly: item.assembly == null ? 'TBD' : JSON.stringify(item.assembly),
            implementationStatus: item.implementationStatus as ImplementationStatus,
            simulationStatus: item.simulationStatus as SimulationStatus,
            expectedFirmwareBehavior: item.expectedFirmwareBehavior,
            expectedReportedResponse: item.expectedReportedResponse,
            notes: item.notes,
            capability: 'capability' in item ? item.capability as CapabilityKey : undefined,
          }));
          const importedCapabilities: CapabilityModel = {
            interlock: validated.capabilities.interlock.enabled,
            remoteStop: validated.capabilities.remoteStop.enabled,
            sensors: validated.capabilities.sensors.enabled,
          };
          set({ profile: imported, baseCapabilities: importedCapabilities, capabilities: importedCapabilities });
          return { success: true, message: `JSON Schema validated; loaded ${imported.length} interface fields.` };
        } catch (error) {
          return { success: false, error: `Invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}` };
        }
      },

      addTransaction: (txData) => {
        const tx: Transaction = {
          ...txData,
          capability: txData.capability ?? get().transactionCapabilityContext ?? undefined,
          id: uuidv4(),
          timestamp: Date.now(),
          sequence: globalSequence++
        };
        set(state => ({ transactions: [tx, ...state.transactions].slice(0, 1000) }));
      },

      clearTransactions: () => set({ transactions: [] }),

      updateSettings: (newSettings) => set(state => {
        const settings = { ...state.settings, ...newSettings };
        if (newSettings.devMode === false) {
          return {
            settings,
            capabilities: state.baseCapabilities,
            logicalState: sanitizeLogicalStateForCapabilities(state.logicalState, state.baseCapabilities),
            transactions: state.transactions.filter(transaction => isTransactionSupported(transaction, state.baseCapabilities)),
          };
        }
        return { settings };
      }),
      resetSettings: () => set(state => ({
        settings: {
          devMode: false,
          simulatorTiming: 100,
          droppedResponseRate: 0,
          localPersistence: true,
          brandLogo: 'sia',
          navCollapsed: false,
        },
        capabilities: state.baseCapabilities,
        logicalState: sanitizeLogicalStateForCapabilities(state.logicalState, state.baseCapabilities),
        transactions: state.transactions.filter(transaction => isTransactionSupported(transaction, state.baseCapabilities)),
      })),
      importState: (json) => {
        try {
          const parsed = JSON.parse(json) as {
            logicalState?: Partial<LogicalState>;
            transactions?: Transaction[];
            tests?: TestResult[];
          };
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('State export must be a JSON object.');
          }
          const current = get();
          const logicalState = sanitizeLogicalStateForCapabilities(
            { ...current.logicalState, ...(parsed.logicalState && typeof parsed.logicalState === 'object' ? parsed.logicalState : {}) },
            current.capabilities,
          );
          const transactions = Array.isArray(parsed.transactions)
            ? parsed.transactions.filter(transaction =>
                transaction &&
                typeof transaction.id === 'string' &&
                typeof transaction.command === 'string' &&
                (!transaction.capability || ['interlock', 'remoteStop', 'sensors'].includes(transaction.capability)) &&
                isTransactionSupported(transaction, current.capabilities))
            : current.transactions;
          const importedTests = Array.isArray(parsed.tests) ? parsed.tests : [];
          const tests = current.tests.map(test => {
            if (!isTestSupported(test, current.capabilities)) return test;
            const imported = importedTests.find(candidate => candidate?.id === test.id);
            if (!imported) return test;
            return {
              ...test,
              status: imported.status,
              actual: String(imported.actual ?? ''),
              duration: Number(imported.duration) || 0,
              evidence: String(imported.evidence ?? ''),
              manualNote: imported.manualNote ? String(imported.manualNote) : undefined,
            };
          });
          set({ logicalState, transactions, tests, lastValidTelemetryAt: null, connectionState: 'disconnected' });
        } catch (error) {
          console.error('Failed to import state', error);
        }
      },

      updateTestNote: (testId, note) => {
        set(state => ({ tests: state.tests.map(t => t.id === testId ? { ...t, manualNote: note } : t) }));
      },

      runTest: async (testId) => {
        const { toggleEnable, setInterlock, setRemoteStop, connect, discover, triggerFault, clearFault, updateLogicalState } = get();
        const selectedTest = get().tests.find(test => test.id === testId);
        if (!selectedTest || !isTestSupported(selectedTest, get().capabilities)) {
          set(state => ({ tests: state.tests.map(test => test.id === testId ? { ...test, status: 'skipped', actual: 'Capability disabled in active profile', evidence: 'Not part of the active Phase 1 interface' } : test) }));
          return;
        }
        set({ transactionCapabilityContext: selectedTest.capability ?? null });
        set(state => ({ tests: state.tests.map(t => t.id === testId ? { ...t, status: 'running' } : t) }));
        
        let passed = false;
        let evidence = '';
        const startTime = Date.now();

        await new Promise(r => setTimeout(r, 500)); // simulate work

        try {
          if (get().mode === 'hardware') throw new Error('Hardware transport is locked; hardware validation is required.');
          if (testId !== 't_disc' && get().connectionState !== 'connected') {
            if (!get().discovered) await discover();
            await connect();
          }
          switch(testId) {
            case 't_disc':
              await discover();
              passed = get().discovered === true;
              evidence = passed ? `Discovered ${get().device.name}` : 'Discovery failed';
              break;
            case 't_id':
              passed = get().device.firmware !== '';
              evidence = `Profile: ${get().device.profile}, Firmware: ${get().device.firmware}`;
              break;
            case 't_conn':
              if (get().connectionState !== 'connected') await connect();
              passed = get().connectionState === 'connected';
              evidence = passed ? 'Simulated session established; production service mapping remains TBD' : 'Failed to connect';
              break;
            case 't_def':
              // Disconnect and reset to simulate boot state
              get().disconnect();
              await new Promise(r => setTimeout(r, 100));
              passed = get().logicalState.emissionControlOutputActive === false;
              evidence = passed ? 'Emission Output Active is FALSE on reset' : 'Output was active initially';
              await connect();
              break;
            case 't_en':
              if (!get().logicalState.interlockOK) setInterlock(true);
              if (!get().logicalState.remoteStopOK) setRemoteStop(true);
              if (get().logicalState.faulted) clearFault();
              
              toggleEnable(true);
              await new Promise(r => setTimeout(r, 200));
              passed = get().logicalState.emissionControlOutputActive === true;
              evidence = passed ? 'Output active successfully reported' : 'Output failed to assert';
              break;
            case 't_dis':
              toggleEnable(false);
              await new Promise(r => setTimeout(r, 200));
              passed = get().logicalState.emissionControlOutputActive === false;
              evidence = passed ? 'Output cleanly disabled' : 'Output remained active';
              break;
            case 't_intl':
              setInterlock(false);
              toggleEnable(true);
              await new Promise(r => setTimeout(r, 200));
              passed = get().logicalState.emissionControlOutputActive === false;
              evidence = passed ? 'Enable blocked by open interlock' : 'Output bypassed interlock';
              setInterlock(true);
              break;
            case 't_rem':
              setRemoteStop(false);
              toggleEnable(true);
              await new Promise(r => setTimeout(r, 200));
              passed = get().logicalState.emissionControlOutputActive === false;
              evidence = passed ? 'Enable blocked by remote stop' : 'Output bypassed remote stop';
              setRemoteStop(true);
              break;
            case 't_flt':
              triggerFault('TEST-FAULT');
              await new Promise(r => setTimeout(r, 200));
              const faultAsserted = get().logicalState.faulted === true;
              clearFault();
              await new Promise(r => setTimeout(r, 200));
              passed = faultAsserted && get().logicalState.faulted === false;
              evidence = passed ? 'Fault properly asserted and cleared' : 'Fault logic failed';
              break;
            case 't_rt':
              const startRuntime = get().logicalState.lifetimeEmissionTimeMs;
              toggleEnable(true);
              get().tick(500);
              toggleEnable(false);
              const endRuntime = get().logicalState.lifetimeEmissionTimeMs;
              passed = endRuntime > startRuntime;
              evidence = `Runtime accumulated: ${endRuntime - startRuntime}ms`;
              break;
            case 't_cnt':
              const startCount = get().logicalState.enableCount;
              toggleEnable(true);
              await new Promise(r => setTimeout(r, 200));
              toggleEnable(false);
              await new Promise(r => setTimeout(r, 200));
              const endCount = get().logicalState.enableCount;
              passed = endCount === startCount + 1;
              evidence = `Enable count transitioned from ${startCount} to ${endCount}`;
              break;
            case 't_loss':
              toggleEnable(true);
              updateLogicalState({ commsLoss: true });
              get().tick(600);
              passed = get().logicalState.emissionControlOutputActive === false;
              evidence = passed ? 'Active output auto-disabled after simulated communication loss' : 'Output remained active during communication loss';
              updateLogicalState({ commsLoss: false });
              break;
            case 't_pers':
              updateLogicalState({ storageFailure: true });
              await new Promise(r => setTimeout(r, 200));
              passed = get().logicalState.storageFailure === true;
              evidence = 'Storage failure state successfully injected and detected';
              updateLogicalState({ storageFailure: false });
              break;
            case 't_persrec':
              updateLogicalState({ storageFailure: true });
              updateLogicalState({ storageFailure: false });
              passed = !get().logicalState.storageFailure && Number.isFinite(get().logicalState.lifetimeEmissionTimeMs);
              evidence = passed ? 'Storage recovered and runtime counters remain readable' : 'Storage recovery failed';
              break;
            case 't_reconn':
              updateLogicalState({ commsLoss: true });
              get().disconnect();
              updateLogicalState({ commsLoss: false });
              await discover();
              await connect();
              passed = get().connectionState === 'connected';
              evidence = passed ? 'Rediscovered and reconnected after simulated communication recovery' : 'Reconnect failed';
              break;
            case 't_rtstop':
              toggleEnable(false);
              const runtimeBefore = get().logicalState.lifetimeEmissionTimeMs;
              get().tick(500);
              const runtimeAfter = get().logicalState.lifetimeEmissionTimeMs;
              passed = runtimeAfter === runtimeBefore;
              evidence = `Inactive runtime stayed at ${runtimeAfter} ms`;
              break;
            case 't_bv':
              // Assumes we can enable and disable cleanly
              toggleEnable(true);
              await new Promise(r => setTimeout(r, 200));
              const act = get().logicalState.emissionControlOutputActive;
              toggleEnable(false);
              passed = act === true;
              evidence = passed ? 'Basic control verified successfully' : 'Basic control failed post-update';
              break;
          }
        } catch (e: any) {
          passed = false;
          evidence = `Test threw error: ${e.message}`;
        }

        // Reset state slightly just in case
        if (get().logicalState.requestedEnable) {
          get().toggleEnable(false);
        }

        const duration = Date.now() - startTime;
        set(state => ({
          tests: state.tests.map(t => t.id === testId ? { 
            ...t, status: passed ? 'passed' : 'failed', duration, actual: evidence, evidence
          } : t),
          transactionCapabilityContext: null,
        }));
      },

      runAllTests: async () => {
        const tests = get().tests.filter(test => isTestSupported(test, get().capabilities));
        for (const t of tests) {
          await get().runTest(t.id);
        }
      },

      tick: (deltaMs) => {
        const tickNow = Date.now();
        const finalStressEvidence: { reason: StressStopReason; result: StressFinalResult } | null = { reason: null, result: null };
        const stressPeriodicReads: Array<{
          command: 'STRESS_RUNTIME_READ' | 'STRESS_ENABLE_COUNT_READ';
          mapping: 'LifetimeEmissionTimeMs' | 'EnableCount';
          cycle: number;
          value: number;
        }> = [];
        set(state => {
          const ls = state.logicalState;
          const telemetryLive = state.connectionState === 'connected' && !ls.commsLoss;
          const wasActive = telemetryLive && ls.emissionControlOutputActive;
          const stressActive = state.stressTestState.isActive && telemetryLive;
          // While a guided timer test is running it OWNS runtime accrual (it advances
          // lifetime in measured PC-time slices via its own guarded path). The generic
          // AppLayout global tick must therefore NOT also accumulate runtime for the
          // same active output, or the counter would be double-counted.
          const timerTestRunning = state.timerTest.status === 'running';
          // Generic (non-stress) runtime accumulation adds the whole delta when the
          // output was active for the tick. During an active stress run the output
          // toggles ON/OFF within a single tick, so we instead partition deltaMs
          // across phase boundaries below and accumulate only the ON portions.
          const newLS = {
            ...ls,
            lifetimeEmissionTimeMs: ls.lifetimeEmissionTimeMs + (!stressActive && !timerTestRunning && wasActive ? deltaMs : 0),
            emissionControlOutputActive: ls.commsLoss ? false : ls.emissionControlOutputActive,
            reportedEnablePermitted: ls.commsLoss ? false : ls.reportedEnablePermitted,
            lastDisableReason: ls.commsLoss && wasActive ? 'Communication Loss' : ls.lastDisableReason,
          };
          const newStress: StressTestState = { ...state.stressTestState, latencySamples: [...state.stressTestState.latencySamples] };
          let stressOperations = 0;

          const recordLatency = (latency: number) => {
            newStress.latencySamples.push(latency);
            newStress.latencyMin = newStress.latencyMin == null ? latency : Math.min(newStress.latencyMin, latency);
            newStress.latencyMax = newStress.latencyMax == null ? latency : Math.max(newStress.latencyMax, latency);
            const sum = newStress.latencySamples.reduce((a, b) => a + b, 0);
            newStress.latencyAvg = sum / newStress.latencySamples.length;
          };

          const finalizeStress = (reason: StressStopReason, result: StressFinalResult) => {
            newStress.isActive = false;
            newStress.phaseElapsedMs = 0;
            newStress.stopReason = reason;
            newStress.finalResult = result;
            newStress.endedAt = tickNow;
            newStress.endRuntimeMs = newLS.lifetimeEmissionTimeMs;
            newStress.endEnableCount = newLS.enableCount;
            // Keep output off when stopped.
            newLS.requestedEnable = false;
            newLS.emissionControlOutputActive = false;
            finalStressEvidence.reason = reason;
            finalStressEvidence.result = result;
          };

          // Mid-run liveness guard: an active stress run REQUIRES live telemetry
          // (connected, no comms loss, and not stale). If liveness is lost while a
          // run is active, finalize immediately with a distinct TELEMETRY_LOST stop
          // reason and a safe non-PASS (FAIL) result, force output inactive, and log
          // evidence. This must never leave isActive hung.
          if (newStress.isActive) {
            const stressFreshness = getTelemetryFreshness(state.connectionState, state.lastValidTelemetryAt, tickNow);
            if (!stressFreshness.isLive || !telemetryLive) {
              finalizeStress('TELEMETRY_LOST', 'FAIL');
            }
          }

          if (newStress.isActive) {
            // Partition deltaMs across OFF/ON phase boundaries. Within each phase
            // we consume the minimum of the remaining tick time and the remaining
            // phase time. Lifetime runtime accumulates ONLY for time spent in the
            // ON phase, so a stress runtime delta always matches the configured ON
            // duration (independent of tick granularity). operationDelay is treated
            // as command latency only and does not consume phase wall-clock time.
            let remaining = deltaMs;
            let guard = 0;
            while (newStress.isActive && remaining > 0 && guard++ < 1_000_000) {
              const phaseDuration = newStress.phase === 'off' ? newStress.offDuration : newStress.onDuration;

              // Cap the slice by the remaining max-duration budget FIRST so a
              // maxDuration that bisects a long phase stops elapsedMs (and any ON
              // runtime accrual) exactly at maxDuration rather than overshooting to
              // the next phase boundary.
              const maxBudgetRemaining = newStress.maxDuration > 0
                ? Math.max(0, newStress.maxDuration - newStress.elapsedMs)
                : Infinity;

              // Degenerate zero-length phase: transition immediately without
              // consuming wall-clock time (guard bounds the loop).
              const phaseRemaining = Math.max(0, phaseDuration - newStress.phaseElapsedMs);
              const consumed = phaseDuration <= 0
                ? 0
                : Math.min(remaining, phaseRemaining, maxBudgetRemaining);

              // Accrue elapsed time for every slice, but accrue lifetime runtime
              // based on the ACTUAL device output state, independent of the scripted
              // phase. Normally the output is active only during the ON phase, but if
              // a disable response was DROPPED (stopOnMismatch=false), the device
              // output stays active through the following configured OFF phase — and
              // that OFF span must accrue runtime because the output really is on. A
              // dropped/blocked ON attempt likewise leaves the output inactive, so
              // those ON slices accrue nothing.
              newStress.phaseElapsedMs += consumed;
              newStress.elapsedMs += consumed;
              remaining -= consumed;
              if (newLS.emissionControlOutputActive) {
                newLS.lifetimeEmissionTimeMs += consumed;
              }

              const budgetHit = newStress.maxDuration > 0 && newStress.elapsedMs >= newStress.maxDuration;
              const phaseComplete = phaseDuration > 0 && newStress.phaseElapsedMs >= phaseDuration;

              // Max-duration guard when the budget bisects a phase (phase did NOT
              // finish exactly at maxDuration): FAIL because work still remains in
              // the current phase. The slice was capped above, so elapsedMs lands
              // exactly on maxDuration.
              if (budgetHit && !phaseComplete) {
                finalizeStress('MAX_DURATION', 'FAIL');
                break;
              }

              // Ran out of tick time mid-phase (no more slices this tick).
              if (!phaseComplete) {
                break;
              }

              // The phase completed exactly. Fall through to process the phase
              // transition / cycle completion BELOW before applying any pending
              // max-duration finalization, so a run whose final cycle completes
              // exactly at maxDuration is recorded as CYCLES_COMPLETE (PASS), not
              // MAX_DURATION. A pending budgetHit is re-checked after processing.
              newStress.phaseElapsedMs = 0;

              const responseDropped = shouldDropResponse(
                state.settings.droppedResponseRate,
                state.responseAttempt + stressOperations,
              );
              stressOperations += 1;

              if (newStress.phase === 'off') {
                // OFF -> ON: request enable.
                newStress.phase = 'on';
                if (responseDropped) {
                  newStress.commErrors += 1;
                  newStress.mismatches += 1;
                  recordLatency(state.settings.simulatorTiming + newStress.operationDelay);
                  if (newStress.stopOnMismatch) {
                    finalizeStress('MISMATCH', 'FAIL');
                    break;
                  }
                  continue;
                }
                const interlockPermits = !state.capabilities.interlock || newLS.interlockOK;
                const remoteStopPermits = !state.capabilities.remoteStop || newLS.remoteStopOK;
                if (interlockPermits && remoteStopPermits && !newLS.faulted) {
                  // Count increments only on a real inactive -> active transition.
                  const wasOutputActive = newLS.emissionControlOutputActive;
                  newLS.requestedEnable = true;
                  newLS.emissionControlOutputActive = true;
                  if (!wasOutputActive) newLS.enableCount += 1;
                  recordLatency(newStress.operationDelay > 0 ? newStress.operationDelay : 1);
                } else {
                  // Requested but blocked -> mismatch against expectation of active output.
                  newStress.mismatches += 1;
                  if (newStress.stopOnMismatch) {
                    finalizeStress('MISMATCH', 'FAIL');
                    break;
                  }
                }
              } else {
                // ON -> OFF: disable, complete a cycle.
                newStress.phase = 'off';
                newStress.completedCycles += 1;
                if (responseDropped) {
                  // The disable command's response was dropped. Consistent with
                  // toggleEnable dropped-response semantics, the command is NOT
                  // applied: the device output remains in its prior (active) state.
                  // We record the comm error / mismatch and, when stopOnMismatch is
                  // false, DELIBERATELY leave requestedEnable / output active so the
                  // following OFF phase accrues runtime while the device is really on.
                  newStress.commErrors += 1;
                  newStress.mismatches += 1;
                  recordLatency(state.settings.simulatorTiming + newStress.operationDelay);
                  if (newStress.stopOnMismatch) {
                    // Safe finalization forces output inactive (see finalizeStress).
                    finalizeStress('MISMATCH', 'FAIL');
                    break;
                  }
                  // Do NOT clear output here — dropped command was never applied.
                } else {
                  // Disable acknowledged: clear output normally.
                  newLS.requestedEnable = false;
                  newLS.emissionControlOutputActive = false;
                }
                recordLatency(newStress.operationDelay > 0 ? newStress.operationDelay : 1);
                if (
                  newStress.runtimeReadEvery > 0 &&
                  newStress.completedCycles % newStress.runtimeReadEvery === 0
                ) {
                  stressPeriodicReads.push({
                    command: 'STRESS_RUNTIME_READ',
                    mapping: 'LifetimeEmissionTimeMs',
                    cycle: newStress.completedCycles,
                    value: newLS.lifetimeEmissionTimeMs,
                  });
                }
                if (
                  newStress.enableCountReadEvery > 0 &&
                  newStress.completedCycles % newStress.enableCountReadEvery === 0
                ) {
                  stressPeriodicReads.push({
                    command: 'STRESS_ENABLE_COUNT_READ',
                    mapping: 'EnableCount',
                    cycle: newStress.completedCycles,
                    value: newLS.enableCount,
                  });
                }

                if (newStress.completedCycles >= newStress.targetCycles) {
                  // PASS only if the run was clean (no comm errors, mismatches, or faults).
                  const clean = newStress.commErrors === 0 && newStress.mismatches === 0 && newStress.faults === 0;
                  finalizeStress('CYCLES_COMPLETE', clean ? 'PASS' : 'FAIL');
                  break;
                }
                if (shouldDropResponse(newStress.faultProbability, newStress.completedCycles)) {
                  newLS.faulted = true;
                  newLS.faultCode = `STRESS-FAULT-${newStress.completedCycles}`;
                  newStress.faults += 1;
                  if (newStress.stopOnFault) {
                    finalizeStress('FAULT', 'FAIL');
                    break;
                  }
                }
              }

              // Deferred max-duration finalization: the phase that just completed
              // ended exactly at maxDuration but did NOT satisfy the cycle target
              // (nor otherwise finalize the run above). Work still remains, so this
              // is FAIL/MAX_DURATION. If the phase completion above already reached
              // the cycle target, the run was finalized as CYCLES_COMPLETE and we
              // never get here.
              if (newStress.isActive && budgetHit) {
                finalizeStress('MAX_DURATION', 'FAIL');
                break;
              }
            }
          }

          // Update runtime observation deterministically from the tick loop.
          const obs = state.runtimeSession.observation;
          let newObs = obs;
          if (obs.active) {
            const currentRuntimeMs = newLS.lifetimeEmissionTimeMs;
            const elapsedPcMs = obs.elapsedPcMs + deltaMs;
            const lsnIncreaseMs = currentRuntimeMs - obs.startRuntimeMs;
            const sampleAccumMs = obs.sampleAccumMs + deltaMs;
            const samples = obs.samples;
            const SAMPLE_INTERVAL_MS = 200;
            const nextSamples = sampleAccumMs >= SAMPLE_INTERVAL_MS
              ? [...samples, { timestamp: elapsedPcMs, runtimeMs: currentRuntimeMs, enableCount: newLS.enableCount }]
              : samples;
            newObs = {
              ...obs,
              currentRuntimeMs,
              currentEnableCount: newLS.enableCount,
              elapsedPcMs,
              lsnIncreaseMs,
              differenceMs: lsnIncreaseMs - elapsedPcMs,
              sampleAccumMs: sampleAccumMs >= SAMPLE_INTERVAL_MS ? 0 : sampleAccumMs,
              samples: nextSamples,
            };
          }

          // Polling continuity latch: while a timer test is running, any tick that
          // observes the protected output inactive or telemetry non-live records a
          // durable interruption so a later re-enable cannot hide it.
          const timerPollBreak =
            timerTestRunning && (!telemetryLive || newLS.commsLoss || !newLS.emissionControlOutputActive);

          return {
            logicalState: {
              ...newLS,
              timerState: deriveTimerState(newLS, telemetryLive && !newLS.commsLoss),
            },
            stressTestState: newStress,
            runtimeSession: newObs === obs ? state.runtimeSession : { ...state.runtimeSession, observation: newObs },
            responseAttempt: state.responseAttempt + stressOperations,
            connectionState: ls.commsLoss ? 'faulted' : state.connectionState,
            discovered: ls.commsLoss ? false : state.discovered,
            lastValidTelemetryAt: telemetryLive ? Date.now() : state.lastValidTelemetryAt,
            timerOutputInterruptions: state.timerOutputInterruptions + (timerPollBreak ? 1 : 0),
          };
        });

        for (const reading of stressPeriodicReads) {
          get().addTransaction({
            direction: 'rx',
            operation: 'STRESS',
            command: reading.command,
            service: 'TBD',
            mapping: reading.mapping,
            requestPayload: '',
            responsePayload: String(reading.value),
            requestHex: '',
            responseHex: 'SIM READ',
            requestDecoded: '',
            responseDecoded: `Cycle ${reading.cycle}: ${reading.mapping}=${reading.value}`,
            status: 'ok',
            latency: get().stressTestState.latencyAvg ?? 1,
            relatedAction: 'stress',
            expectedResult: `Periodic ${reading.mapping} reading`,
            actualResult: String(reading.value),
            pass: true,
          });
        }

        if (finalStressEvidence.reason) {
          get().addTransaction({
            direction: 'bidirectional', operation: 'STRESS', command: 'STRESS_STOP', service: 'TBD', mapping: null,
            requestPayload: 'STOP', responsePayload: finalStressEvidence.result ?? '',
            requestHex: 'SIM STRESS', responseHex: 'SIM STRESS',
            requestDecoded: `Stress run ended: ${finalStressEvidence.reason}`,
            responseDecoded: `Simulated final result ${finalStressEvidence.result}; cycles=${get().stressTestState.completedCycles}, faults=${get().stressTestState.faults}, mismatches=${get().stressTestState.mismatches}`,
            status: finalStressEvidence.result === 'PASS' ? 'ok' : 'error', latency: 0, relatedAction: 'stress',
            expectedResult: 'Deterministic simulated stress cycle completion', actualResult: `${finalStressEvidence.reason} / ${finalStressEvidence.result}`, pass: finalStressEvidence.result === 'PASS',
          });
        }
      },

      startFirmwareUpdate: async (scenarioId, pkgMetadata) => {
        const logFwTx = (stage: string, payload: string, decoded: string, status: 'ok' | 'error', expected: string, actual: string) => {
          get().addTransaction({
            direction: 'bidirectional', operation: 'FIRMWARE', command: 'UPDATE_STAGE', service: 'TBD', mapping: null,
            requestPayload: stage, responsePayload: payload, requestHex: `SIM FW ${stage}`, responseHex: `SIM FW ${payload}`,
            requestDecoded: `Firmware stage: ${stage}`, responseDecoded: decoded,
            status, latency: 50, relatedAction: 'firmware', expectedResult: expected, actualResult: actual, pass: status === 'ok'
          });
        };

        set({ firmwareState: { isActive: true, stage: 'verifying_metadata', progress: 0, scenarioId, failureStage: null, failureReason: null, resultingVersion: null, knownGoodAvailable: true, rollbackOccurred: false, recommendedNextStep: null, runningFirmwareAffected: false, deviceState: 'maintenance', basicValidationStatus: 'not-run' } });
        
        const updateProgress = async (stage: any, duration: number, targetProgress: number) => {
          set(s => ({ firmwareState: { ...s.firmwareState, stage } }));
          const steps = 10;
          const stepTime = duration / steps;
          const currentProgress = get().firmwareState.progress;
          const increment = (targetProgress - currentProgress) / steps;
          
          for (let i = 0; i < steps; i++) {
            if (!get().firmwareState.isActive) return false;
            await new Promise(r => setTimeout(r, stepTime));
            set(s => ({ firmwareState: { ...s.firmwareState, progress: s.firmwareState.progress + increment } }));
          }
          return true;
        };

        const fail = (reason: string, stage: string, rollback: boolean, nextStep: string, runningFirmwareAffected = false, deviceState = 'recoverable') => {
          logFwTx(stage, reason, 'Failed', 'error', 'Success', reason);
          set(s => ({ firmwareState: { ...s.firmwareState, isActive: false, stage: 'failed', failureReason: reason, failureStage: stage, rollbackOccurred: rollback, knownGoodAvailable: true, recommendedNextStep: nextStep, resultingVersion: runningFirmwareAffected ? 'UNKNOWN' : get().device.firmware, runningFirmwareAffected, deviceState, basicValidationStatus: 'not-run' } }));
        };

        // Validate metadata
        await new Promise(r => setTimeout(r, 1000));
        if (!pkgMetadata.version || !pkgMetadata.target || !pkgMetadata.protocol || !pkgMetadata.checksum || pkgMetadata.size <= 0) {
          return fail('Required package metadata is missing or invalid', 'verifying_metadata', false, 'Select a complete firmware package');
        }
        if (pkgMetadata.signature !== 'VALID') return fail('Package signature validation failed', 'verifying_metadata', false, 'Use a signed, trusted firmware package');
        if (pkgMetadata.target !== get().device.platform || scenarioId === 'incompat_hw' || scenarioId === 'incompatible_firmware') {
          return fail('Hardware target is incompatible', 'verifying_metadata', false, 'Use a WT32-ETH01 firmware package');
        }
        if (pkgMetadata.protocol !== 'LSN v0.1') {
          return fail('Protocol compatibility check failed', 'verifying_metadata', false, 'Use a package compatible with LSN v0.1');
        }

        logFwTx('verifying_metadata', 'VALID', 'Metadata valid', 'ok', 'VALID', 'VALID');

        // Transfer
        if (!await updateProgress('transferring', 2000, 40)) return;
        if (['network_loss', 'interrupted_network', 'incomplete_transfer'].includes(scenarioId)) {
          return fail(
            scenarioId === 'incomplete_transfer' ? 'Transfer ended before all bytes were received' : 'Simulated network interruption during transfer',
            'transferring',
            false,
            'Restore network connectivity and retry; running firmware is unchanged',
          );
        }
        logFwTx('transferring', 'DONE', 'Transfer complete', 'ok', 'DONE', 'DONE');

        // Verify
        if (!await updateProgress('verifying', 1000, 60)) return;
        if (['corrupt_image', 'image_corruption', 'checksum_failure'].includes(scenarioId)) {
          return fail('Image checksum validation failed', 'verifying', false, 'Discard the package and retry with a verified image');
        }
        logFwTx('verifying', 'VERIFIED', 'Image Verified', 'ok', 'VERIFIED', 'VERIFIED');

        // Reboot
        set(s => ({ firmwareState: { ...s.firmwareState, stage: 'rebooting', progress: 70 } }));
        logFwTx('rebooting', 'REBOOT', 'Rebooting device', 'ok', 'REBOOT', 'REBOOT');
        get().disconnect();
        await new Promise(r => setTimeout(r, 1500));
        
        if (scenarioId === 'power_loss_before_activation' || scenarioId === 'power_loss_before') {
          return fail('Power loss before activating the new image', 'rebooting', false, 'Restore power; known-good firmware remains selected', false, 'offline');
        }
        if (scenarioId === 'power_loss_after_activation') {
          return fail('Power loss after new image activation', 'rebooting', true, 'Restore power; bootloader rollback selects known-good firmware', true, 'offline');
        }

        // Rediscover
        await get().discover();
        await get().connect();
        
        if (scenarioId === 'reboot_failure') return fail('Device did not rediscover after reboot', 'rebooting', true, 'Use known-good recovery and verify power/network', true, 'unreachable');
        if (scenarioId === 'post_boot_fail') return fail('Post-boot validation failed', 'validating', true, 'Reverted to known-good version automatically', true, 'recovery');
        if (scenarioId === 'known_good_recovery') return fail('Recovery scenario forced rollback to known-good firmware', 'validating', true, 'Validate the known-good image before retrying', false, 'recovered');

        // Success
        logFwTx('validating', 'PASS', 'Validation Passed', 'ok', 'PASS', 'PASS');
        set(s => ({ 
          firmwareState: { ...s.firmwareState, stage: 'completed', progress: 100, resultingVersion: pkgMetadata.version, rollbackOccurred: false, knownGoodAvailable: true, recommendedNextStep: 'Review the automatic Basic Validation result', runningFirmwareAffected: true, deviceState: 'validating', basicValidationStatus: 'running' },
          device: { ...s.device, firmware: pkgMetadata.version }
        }));

        // Run basic validation
        get().addTransaction({
          direction: 'bidirectional', operation: 'FIRMWARE', command: 'AUTO_VALIDATION', service: 'TBD', mapping: null,
          requestPayload: 'START', responsePayload: 'RUNNING', requestHex: '', responseHex: '',
          requestDecoded: `Initiate Basic Validation`, responseDecoded: 'Executing tests...',
          status: 'ok', latency: 0, relatedAction: 'firmware', expectedResult: 'Complete', actualResult: 'Complete', pass: true
        });
        await get().runTest('t_bv');
        const validationPassed = get().tests.find(test => test.id === 't_bv')?.status === 'passed';
        logFwTx('post_update_basic_validation', validationPassed ? 'PASS' : 'FAIL', validationPassed ? 'Basic Validation passed' : 'Basic Validation failed', validationPassed ? 'ok' : 'error', 'PASS', validationPassed ? 'PASS' : 'FAIL');
        set(state => ({
          firmwareState: {
            ...state.firmwareState,
            isActive: false,
            deviceState: validationPassed ? 'ready' : 'recovery',
            basicValidationStatus: validationPassed ? 'passed' : 'failed',
            recommendedNextStep: validationPassed ? 'Update complete; review and export evidence' : 'Run recovery and investigate validation evidence',
          },
        }));
      },

      resetFirmwareState: () => set({ firmwareState: { isActive: false, stage: 'idle', progress: 0, scenarioId: null, failureStage: null, failureReason: null, resultingVersion: null, knownGoodAvailable: false, rollbackOccurred: false, recommendedNextStep: null, runningFirmwareAffected: false, deviceState: 'ready', basicValidationStatus: 'not-run' } }),

      startStressTest: (config) => {
        // Require connected Simulation Mode. Hardware Mode stays blocked even if unlocked
        // because CIP/service mappings remain TBD.
        if (get().mode === 'hardware') {
          set({ stressTestState: { ...INITIAL_STRESS_STATE, stopReason: 'BLOCKED', finalResult: 'BLOCKED' } });
          get().addTransaction({
            direction: 'tx', operation: 'STRESS', command: 'STRESS_START', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Hardware transmit blocked; stress requires live data (mappings TBD)', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'stress', expectedResult: 'Blocked', actualResult: 'Blocked', pass: false,
          });
          return;
        }
        // Mutual exclusion (checked BEFORE the liveness gate so the specific competing
        // -workflow reason wins even when the competitor has already dropped the
        // connection, e.g. a Persistence restart). A guided Timer Test owns the
        // emission output and runtime accrual while running; refuse to start stress so
        // the two cannot race over the same output/counter.
        if (get().timerTest.status === 'running') {
          set({ stressTestState: { ...INITIAL_STRESS_STATE, stopReason: 'BLOCKED', finalResult: 'BLOCKED' } });
          get().addTransaction({
            direction: 'tx', operation: 'STRESS', command: 'STRESS_START', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Stress blocked: a guided Timer Test is currently running (mutual exclusion)',
            responseDecoded: 'Stop or finish the Timer Test before starting Stress',
            status: 'error', latency: 0, relatedAction: 'stress', expectedResult: 'No competing Timer Test', actualResult: 'Blocked (Timer Test running)', pass: false,
          });
          return;
        }
        // A guided Persistence Test performs a scripted disconnect / restart while
        // running. Refuse to start stress against a device that is being restarted
        // underneath it. Only status==='running' locks; a Hardware manual
        // 'awaiting_continue' persistence does not block Simulation-only stress.
        if (get().persistenceTest.status === 'running') {
          set({ stressTestState: { ...INITIAL_STRESS_STATE, stopReason: 'BLOCKED', finalResult: 'BLOCKED' } });
          get().addTransaction({
            direction: 'tx', operation: 'STRESS', command: 'STRESS_START', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Stress blocked: a guided Persistence Test is currently running (mutual exclusion)',
            responseDecoded: 'Stop or finish the Persistence Test before starting Stress',
            status: 'error', latency: 0, relatedAction: 'stress', expectedResult: 'No competing Persistence Test', actualResult: 'Blocked (Persistence Test running)', pass: false,
          });
          return;
        }
        // Require LIVE telemetry, not merely "connected". A connected-but-stale or
        // unknown-freshness session must be BLOCKED so the run never starts against
        // data that cannot be trusted. Uses the same freshness rule as the runtime
        // observation / guided tests.
        const startFreshness = getTelemetryFreshness(get().connectionState, get().lastValidTelemetryAt);
        if (!startFreshness.isLive) {
          set({ stressTestState: { ...INITIAL_STRESS_STATE, stopReason: 'BLOCKED', finalResult: 'BLOCKED' } });
          get().addTransaction({
            direction: 'tx', operation: 'STRESS', command: 'STRESS_START', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Stress requires a LIVE Simulation session (connected with fresh telemetry)',
            responseDecoded: `Telemetry freshness: ${startFreshness.state}${startFreshness.ageMs != null ? ` (age ${startFreshness.ageMs}ms)` : ''}`,
            status: 'error', latency: 0, relatedAction: 'stress', expectedResult: 'Live Simulation telemetry', actualResult: `Not live (${startFreshness.state})`, pass: false,
          });
          return;
        }
        // Deterministic pre-run cleanup: establish a known inactive output before
        // capturing baselines so a run started while emission is active does not
        // skew ON/OFF phase accounting. This must NOT increment enableCount or
        // lose accumulated lifetime runtime.
        const pre = get().logicalState;
        const wasActiveAtStart = pre.requestedEnable || pre.emissionControlOutputActive;
        if (wasActiveAtStart) {
          set(state => ({
            logicalState: {
              ...state.logicalState,
              requestedEnable: false,
              emissionControlOutputActive: false,
              // Clean, non-counting timer state; lifetime runtime is preserved.
              timerState: deriveSimTimerState(
                { ...state.logicalState, emissionControlOutputActive: false },
                state.connectionState === 'connected' && !state.logicalState.commsLoss,
              ),
              lastDisableReason: 'Stress pre-run cleanup',
            },
          }));
        }

        const ls = get().logicalState; // read AFTER cleanup so baselines are clean
        set(() => ({
          stressTestState: {
            ...INITIAL_STRESS_STATE,
            isActive: true,
            targetCycles: config.cycles,
            onDuration: config.onDur,
            offDuration: config.offDur,
            faultProbability: config.faultProb,
            phase: 'off',
            maxDuration: config.maxDuration ?? 0,
            stopOnMismatch: config.stopOnMismatch ?? true,
            stopOnFault: config.stopOnFault ?? true,
            runtimeReadEvery: config.runtimeReadEvery ?? 0,
            enableCountReadEvery: config.enableCountReadEvery ?? 0,
            operationDelay: config.operationDelay ?? 0,
            startedAt: Date.now(),
            baselineRuntimeMs: ls.lifetimeEmissionTimeMs,
            baselineEnableCount: ls.enableCount,
            endRuntimeMs: ls.lifetimeEmissionTimeMs,
            endEnableCount: ls.enableCount,
          },
        }));
        if (wasActiveAtStart) {
          get().addTransaction({
            direction: 'tx', operation: 'STRESS', command: 'STRESS_PRE_CLEANUP', service: 'TBD', mapping: 'RequestedEnable',
            requestPayload: '0', responsePayload: 'ACK', requestHex: 'SIM STRESS', responseHex: 'SIM STRESS',
            requestDecoded: 'Deterministic stress pre-run cleanup; disable emission output before baseline',
            responseDecoded: `Output inactive; baseline runtime=${ls.lifetimeEmissionTimeMs}ms count=${ls.enableCount} (preserved)`,
            status: 'ok', latency: 1, relatedAction: 'stress', expectedResult: 'Output inactive before baseline', actualResult: 'Output inactive', pass: true,
          });
        }
        get().addTransaction({
          direction: 'tx', operation: 'STRESS', command: 'STRESS_START', service: 'TBD', mapping: null,
          requestPayload: JSON.stringify({ cycles: config.cycles, onDur: config.onDur, offDur: config.offDur }),
          responsePayload: 'ACK', requestHex: 'SIM STRESS', responseHex: 'SIM STRESS',
          requestDecoded: `Simulated stress start; ${config.cycles} cycles`,
          responseDecoded: `Simulated stress accepted; baseline runtime=${ls.lifetimeEmissionTimeMs}ms count=${ls.enableCount}`,
          status: 'ok', latency: 1, relatedAction: 'stress', expectedResult: 'Started', actualResult: 'Started', pass: true,
        });
      },

      stopStressTest: () => {
        const s = get().stressTestState;
        if (!s.isActive) return;
        set(state => ({
          stressTestState: {
            ...state.stressTestState,
            isActive: false,
            phaseElapsedMs: 0,
            endedAt: Date.now(),
            endRuntimeMs: state.logicalState.lifetimeEmissionTimeMs,
            endEnableCount: state.logicalState.enableCount,
            stopReason: 'ABORTED',
            finalResult: 'ABORTED',
          },
          logicalState: {
            ...state.logicalState,
            requestedEnable: false,
            emissionControlOutputActive: false,
          },
        }));
        get().addTransaction({
          direction: 'tx', operation: 'STRESS', command: 'STRESS_STOP', service: 'TBD', mapping: null,
          requestPayload: 'ABORT', responsePayload: 'ACK', requestHex: 'SIM STRESS', responseHex: 'SIM STRESS',
          requestDecoded: 'Operator aborted stress run', responseDecoded: 'Simulated stress aborted; output inactive',
          status: 'ok', latency: 1, relatedAction: 'stress', expectedResult: 'Aborted', actualResult: 'Aborted', pass: true,
        });
      },

      runtimeRead: () => {
        const { mode, connectionState, logicalState, lastValidTelemetryAt } = get();
        const freshness = getTelemetryFreshness(connectionState, lastValidTelemetryAt);
        if (mode !== 'simulation' || connectionState !== 'connected' || !freshness.isLive) {
          get().addTransaction({
            direction: 'tx', operation: 'READ', command: 'RUNTIME_READ', service: 'TBD', mapping: 'LifetimeEmissionTime',
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Runtime read blocked; requires connected live Simulation Mode', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'runtimeRead', expectedResult: 'Live reading', actualResult: 'Blocked (not live)', pass: false,
          });
          return null;
        }
        const reading: RuntimeReading = {
          runtimeMs: logicalState.lifetimeEmissionTimeMs,
          enableCount: logicalState.enableCount,
          timerState: logicalState.timerState,
          timestamp: Date.now(),
        };
        set(state => ({
          runtimeSession: {
            ...state.runtimeSession,
            firstReading: state.runtimeSession.firstReading ?? reading,
            lastReading: reading,
          },
        }));
        // User-visible evidence must NOT expose the raw simulator-internal timer
        // value (0/1/2). Emit the simulator-only label plus explicit context that
        // the real firmware/wire enum is still TBD. The numeric `reading.timerState`
        // remains available on the returned object for internal logic only.
        const simTimerLabel = simTimerStateLabel(reading.timerState);
        get().addTransaction({
          direction: 'bidirectional', operation: 'READ', command: 'RUNTIME_READ', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: '{}',
          responsePayload: JSON.stringify({ runtimeMs: reading.runtimeMs, enableCount: reading.enableCount, simTimerState: simTimerLabel }),
          requestHex: 'SIM RT', responseHex: 'SIM RT',
          requestDecoded: 'Simulated runtime read; CIP service TBD',
          responseDecoded: `Simulated runtime=${reading.runtimeMs}ms count=${reading.enableCount} timer=${simTimerLabel} (simulator-only; firmware/wire enum TBD)`,
          status: 'ok', latency: 1, relatedAction: 'runtimeRead', expectedResult: 'Simulated runtime reading', actualResult: 'Simulated runtime reading', pass: true,
        });
        return reading;
      },

      startRuntimeObservation: () => {
        const { mode, connectionState, logicalState, lastValidTelemetryAt } = get();
        // Mutual exclusion (checked BEFORE the liveness gate so the specific reason
        // wins even after persistence has dropped the connection for its restart): a
        // guided Persistence Test performs a scripted disconnect / restart that would
        // invalidate a passive runtime observation. Refuse to start an observation
        // while persistence is running so its evidence stays coherent. (Observation
        // alongside a Stress run remains allowed — passive reads are useful there.)
        // Only status==='running' locks.
        if (get().persistenceTest.status === 'running') {
          get().addTransaction({
            direction: 'tx', operation: 'READ', command: 'RUNTIME_OBS_START', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Runtime observation blocked: a guided Persistence Test is currently running (mutual exclusion)',
            responseDecoded: 'Stop or finish the Persistence Test before starting a runtime observation',
            status: 'error', latency: 0, relatedAction: 'runtimeObservation', expectedResult: 'No competing Persistence Test', actualResult: 'Blocked (Persistence Test running)', pass: false,
          });
          return;
        }
        const freshness = getTelemetryFreshness(connectionState, lastValidTelemetryAt);
        if (mode !== 'simulation' || connectionState !== 'connected' || !freshness.isLive) {
          get().addTransaction({
            direction: 'tx', operation: 'READ', command: 'RUNTIME_OBS_START', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Runtime observation blocked; requires connected live Simulation Mode', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'runtimeObservation', expectedResult: 'Observation started', actualResult: 'Blocked (not live)', pass: false,
          });
          return;
        }
        set(state => ({
          runtimeSession: {
            ...state.runtimeSession,
            observation: {
              ...INITIAL_RUNTIME_OBSERVATION,
              active: true,
              startedAt: Date.now(),
              startRuntimeMs: logicalState.lifetimeEmissionTimeMs,
              currentRuntimeMs: logicalState.lifetimeEmissionTimeMs,
              startEnableCount: logicalState.enableCount,
              currentEnableCount: logicalState.enableCount,
            },
          },
        }));
        get().addTransaction({
          direction: 'bidirectional', operation: 'READ', command: 'RUNTIME_OBS_START', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: '{}', responsePayload: JSON.stringify({ startRuntimeMs: logicalState.lifetimeEmissionTimeMs }),
          requestHex: 'SIM RTO', responseHex: 'SIM RTO',
          requestDecoded: 'Simulated runtime observation start', responseDecoded: `Simulated starting runtime=${logicalState.lifetimeEmissionTimeMs}ms`,
          status: 'ok', latency: 1, relatedAction: 'runtimeObservation', expectedResult: 'Observation started', actualResult: 'Observation started', pass: true,
        });
      },

      stopRuntimeObservation: () => {
        const obs = get().runtimeSession.observation;
        if (!obs.active) return;
        set(state => ({
          runtimeSession: {
            ...state.runtimeSession,
            observation: { ...state.runtimeSession.observation, active: false, stoppedAt: Date.now() },
          },
        }));
        const final = get().runtimeSession.observation;
        get().addTransaction({
          direction: 'bidirectional', operation: 'READ', command: 'RUNTIME_OBS_STOP', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: '{}',
          responsePayload: JSON.stringify({ elapsedPcMs: final.elapsedPcMs, lsnIncreaseMs: final.lsnIncreaseMs, differenceMs: final.differenceMs, samples: final.samples.length }),
          requestHex: 'SIM RTO', responseHex: 'SIM RTO',
          requestDecoded: 'Simulated runtime observation stop',
          responseDecoded: `Simulated elapsedPc=${final.elapsedPcMs}ms lsnIncrease=${final.lsnIncreaseMs}ms diff=${final.differenceMs}ms over ${final.samples.length} samples`,
          status: 'ok', latency: 1, relatedAction: 'runtimeObservation', expectedResult: 'Observation stopped', actualResult: 'Observation stopped', pass: true,
        });
      },

      runGuidedTimerTest: async (config) => {
        const durationMs = config?.durationMs ?? DEFAULT_TIMER_CONFIG.durationMs;
        const toleranceMs = config?.toleranceMs ?? DEFAULT_TIMER_CONFIG.toleranceMs;
        const { mode, connectionState, toggleEnable } = get();

        if (mode === 'hardware') {
          const blocked: TimerTestResult = {
            ...INITIAL_TIMER_TEST, status: 'blocked', toleranceMs,
            notes: 'Hardware Mode is non-transmitting; guided timer test blocked (no live data).',
          };
          set({ timerTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'TIMER', command: 'TIMER_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Hardware transmit blocked; guided timer test not executed', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'timerTest', expectedResult: 'Blocked', actualResult: 'Blocked', pass: false,
          });
          return blocked;
        }
        // Mutual exclusion (checked BEFORE the liveness gate so the specific competing
        // -workflow reason wins even when the competitor has already dropped the
        // connection, e.g. a Persistence restart). Refuse to start while a stress run
        // is active so the two cannot race over the same emission output / counter.
        if (get().stressTestState.isActive) {
          const blocked: TimerTestResult = {
            ...INITIAL_TIMER_TEST, status: 'blocked', toleranceMs, conflict: true,
            notes: 'Guided timer test blocked: a Stress run is active (mutual exclusion).',
          };
          set({ timerTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'TIMER', command: 'TIMER_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Timer test blocked: a Stress run is currently active (mutual exclusion)',
            responseDecoded: 'Stop the Stress run before starting the Timer Test',
            status: 'error', latency: 0, relatedAction: 'timerTest', expectedResult: 'No competing Stress run', actualResult: 'Blocked (Stress active)', pass: false,
          });
          return blocked;
        }
        // Refuse to start while a guided Persistence Test is running. Persistence
        // performs a scripted disconnect/restart that would race with the timer's
        // protected active-output interval. Only status==='running' locks.
        if (get().persistenceTest.status === 'running') {
          const blocked: TimerTestResult = {
            ...INITIAL_TIMER_TEST, status: 'blocked', toleranceMs, conflict: true,
            notes: 'Guided timer test blocked: a guided Persistence Test is running (mutual exclusion).',
          };
          set({ timerTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'TIMER', command: 'TIMER_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Timer test blocked: a guided Persistence Test is currently running (mutual exclusion)',
            responseDecoded: 'Stop or finish the Persistence Test before starting the Timer Test',
            status: 'error', latency: 0, relatedAction: 'timerTest', expectedResult: 'No competing Persistence Test', actualResult: 'Blocked (Persistence Test running)', pass: false,
          });
          return blocked;
        }
        const timerFreshness = getTelemetryFreshness(connectionState, get().lastValidTelemetryAt);
        if (connectionState !== 'connected' || !timerFreshness.isLive) {
          const blocked: TimerTestResult = {
            ...INITIAL_TIMER_TEST, status: 'blocked', toleranceMs,
            notes: 'Guided timer test requires a connected live Simulation session.',
          };
          set({ timerTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'TIMER', command: 'TIMER_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Guided timer test blocked; telemetry not live', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'timerTest', expectedResult: 'Live session', actualResult: 'Blocked (not live)', pass: false,
          });
          return blocked;
        }
        const startedAt = Date.now();
        const startRuntimeMs = get().logicalState.lifetimeEmissionTimeMs;
        set({ timerTest: { ...INITIAL_TIMER_TEST, status: 'running', startedAt, startRuntimeMs, toleranceMs } });

        // Request output. toggleEnable respects dropped responses / interlocks, so
        // the output may or may not become active.
        toggleEnable(true);

        // Record TIMER_START evidence AFTER the enable attempt so it reflects the
        // ACTUAL output state. A dropped/blocked enable is a non-pass request-only
        // outcome — never a false "output active PASS".
        const afterEnable = get().logicalState;
        const enableLive = get().connectionState === 'connected' && !afterEnable.commsLoss;
        const outputActiveAtStart = enableLive && afterEnable.emissionControlOutputActive;
        get().addTransaction({
          direction: 'tx', operation: 'TIMER', command: 'TIMER_START', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: JSON.stringify({ durationMs }),
          responsePayload: outputActiveAtStart ? 'ACK' : 'NO-OUTPUT',
          requestHex: 'SIM TMR', responseHex: 'SIM TMR',
          requestDecoded: `Simulated timer test start; requested enable output for ${durationMs}ms`,
          responseDecoded: outputActiveAtStart
            ? `Output active; starting runtime=${startRuntimeMs}ms`
            : `Enable did not activate output (dropped/blocked); request-only, runtime will not accrue`,
          status: outputActiveAtStart ? 'ok' : 'error', latency: 1, relatedAction: 'timerTest',
          expectedResult: 'Output active for timer measurement',
          actualResult: outputActiveAtStart ? 'Output active' : 'Output inactive (request-only)',
          pass: outputActiveAtStart,
        });

        // Capture the durable continuity latch AFTER the enable attempt. Any later
        // increment (from any user-visible disable/disconnect/fault/comms-loss path,
        // even a disable+re-enable between samples) means the protected interval was
        // interrupted. The timer's own final cleanup runs AFTER we snapshot this, so
        // it cannot invalidate the captured interval.
        const continuityBaseline = get().timerOutputInterruptions;

        // TWO INDEPENDENT CLOCKS:
        //  (1) PC time is MEASURED with the monotonic clock (performance.now).
        //  (2) The simulated DEVICE clock is an INDEPENDENT free-running wall-clock
        //      oscillator read via deviceWallClockNowMs() (Date.now). It keeps
        //      counting through browser event-loop stalls, so its elapsed tracks
        //      real time regardless of how many callbacks actually fired — this is
        //      what a hardware oscillator does. Device elapsed is then QUANTIZED to
        //      fixed 10ms quanta to model the device's timer resolution.
        //
        // Because the device clock (Date.now) and the PC clock (performance.now)
        // are read from separate sources, they can be stubbed independently and
        // genuinely diverge; under a normal browser they stay ~equal even if a
        // callback wakes late (e.g. 300ms requested but wakes at 379ms -> both
        // clocks report ~379ms, so the test still PASSES).
        //
        // The generic AppLayout tick is suppressed while timerTest.status ===
        // 'running' (see tick), so this routine is the SOLE device-runtime owner
        // and there is no double counting.
        const quantum = DEVICE_TIMER_QUANTUM_MS;
        const SAMPLE_MS = DEVICE_TIMER_QUANTUM_MS; // sample at 10ms granularity
        const monoStart = monotonicNowMs();

        // Observe active/live state and read the two independent clocks.
        const observe = () => {
          const s = get();
          const live = s.connectionState === 'connected' && !s.logicalState.commsLoss
            && getTelemetryFreshness(s.connectionState, s.lastValidTelemetryAt).isLive
            && !s.logicalState.storageFailure;
          const active = live && s.logicalState.emissionControlOutputActive;
          return { active, live, wall: deviceWallClockNowMs() };
        };

        // Sample the protected interval at ~10ms. Accumulate INDEPENDENT device
        // wall-clock (Date.now) elapsed spans ONLY across sample pairs where BOTH the
        // previous and current samples were active+live. A browser scheduler stall
        // that skips wakeups still credits the full wall span between two active/live
        // samples (the device oscillator kept counting). Any span where either end
        // was inactive/non-live contributes ZERO — so dropped enable or a mid-run
        // interruption cannot be credited even under a generous tolerance.
        let guard = 0;
        let conflict = false;
        let observedBreak = false;
        let activeWallAccumMs = 0;
        let prev = observe();
        if (!prev.active) observedBreak = true; // never became active
        while (guard++ < 1_000_000) {
          if (get().stressTestState.isActive) { conflict = true; break; }
          const remaining = durationMs - (monotonicNowMs() - monoStart);
          if (remaining <= 0) break;
          await new Promise(r => setTimeout(r, Math.max(1, Math.min(SAMPLE_MS, Math.ceil(remaining)))));
          if (get().stressTestState.isActive) { conflict = true; break; }
          const cur = observe();
          if (prev.active && prev.live && cur.active && cur.live) {
            activeWallAccumMs += Math.max(0, cur.wall - prev.wall);
          } else {
            observedBreak = true;
          }
          prev = cur;
        }
        // Final re-check after the wait completes.
        if (get().stressTestState.isActive) conflict = true;
        const pcMeasuredMs = Math.round(monotonicNowMs() - monoStart);

        // End-of-interval state (must be active+live for a pass).
        const atEnd = observe();
        const endActive = !conflict && atEnd.active && atEnd.live;

        // Durable continuity: PASS requires the latch to be unchanged since enable AND
        // no observed break during sampling. This is captured BEFORE the timer's own
        // fail-safe cleanup so cleanup cannot invalidate the interval.
        const latchUnchanged = get().timerOutputInterruptions === continuityBaseline;
        const continuousActiveLive =
          outputActiveAtStart && endActive && latchUnchanged && !observedBreak && !conflict;

        // Device runtime credits ONLY the observed active/live wall span, quantized to
        // fixed 10ms quanta. On any interruption / non-continuous run this is naturally
        // small or zero and cannot masquerade as a full-duration pass. A stress
        // CONFLICT discards accrual entirely (a competing run may have touched the
        // output/counter, so no span can be trusted).
        const deviceTicksAccrued = conflict
          ? 0
          : (continuousActiveLive ? Math.round(activeWallAccumMs / quantum) : Math.floor(activeWallAccumMs / quantum));
        const deviceElapsedMs = deviceTicksAccrued * quantum;
        if (deviceElapsedMs > 0) {
          set(state => ({
            logicalState: { ...state.logicalState, lifetimeEmissionTimeMs: state.logicalState.lifetimeEmissionTimeMs + deviceElapsedMs },
            lastValidTelemetryAt: Date.now(),
          }));
        }

        // ── Conflict evidence ────────────────────────────────────────────────
        if (conflict) {
          get().addTransaction({
            direction: 'tx', operation: 'TIMER', command: 'TIMER_CONFLICT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: 'CONFLICT', requestHex: 'SIM TMR', responseHex: 'SIM TMR',
            requestDecoded: 'Competing Stress run detected during Timer Test window (mutual-exclusion violation)',
            responseDecoded: 'Discarding device-elapsed as valid timer runtime; forcing safe output state and FAILING the timer test',
            status: 'error', latency: 1, relatedAction: 'timerTest',
            expectedResult: 'Exclusive Timer Test session', actualResult: 'Stress became active mid-run', pass: false,
          });
        }

        // ── Fail-safe cleanup ────────────────────────────────────────────────
        // Attempt a normal disable command first (for wire command + evidence).
        toggleEnable(false);
        // Detect whether the disable actually took effect (a dropped response can
        // leave requestedEnable / emissionControlOutputActive stuck true).
        const afterDisable = get().logicalState;
        const disableTookEffect = !afterDisable.requestedEnable && !afterDisable.emissionControlOutputActive;
        const cleanupOk = disableTookEffect;
        // Force a safe simulator state directly when the disable did not take effect
        // OR when a conflict was detected (guaranteeing no leftover active state can
        // accrue runtime on later ticks). This never touches lifetimeEmissionTimeMs.
        if (!disableTookEffect || conflict) {
          set(state => {
            const forced = {
              ...state.logicalState,
              requestedEnable: false,
              reportedEnablePermitted: false,
              emissionControlOutputActive: false,
              lastDisableReason: conflict ? 'Timer test aborted (stress conflict)' : 'Timer test fail-safe cleanup',
            };
            const live = state.connectionState === 'connected' && !forced.commsLoss;
            forced.timerState = deriveSimTimerState(forced, live);
            return { logicalState: forced };
          });
          if (!disableTookEffect) {
            get().addTransaction({
              direction: 'tx', operation: 'TIMER', command: 'TIMER_CLEANUP', service: 'TBD', mapping: 'RequestedEnable',
              requestPayload: '0', responsePayload: 'FORCED', requestHex: 'SIM TMR', responseHex: 'SIM TMR',
              requestDecoded: 'Disable command did not take effect (e.g. dropped response); forcing safe simulator state',
              responseDecoded: 'Forced requestedEnable=false, emissionControlOutputActive=false, timer SIM NOT COUNTING',
              status: 'error', latency: 1, relatedAction: 'timerTest',
              expectedResult: 'Output disabled by command', actualResult: 'Cleanup command failed; forced safe state', pass: false,
            });
          }
        }

        const endRuntimeMs = Math.round(get().logicalState.lifetimeEmissionTimeMs);
        // The valid timer runtime is the ACTUAL protected-session counter delta
        // (endRuntime - startRuntime), not merely the assigned device-elapsed. On a
        // conflict no device elapsed was accrued, so this is 0 and cannot masquerade
        // as valid runtime. The independent device/PC clock metadata is retained.
        const lsnIncreaseMs = Math.round(endRuntimeMs - startRuntimeMs);
        const differenceMs = lsnIncreaseMs - pcMeasuredMs;
        const withinTolerance = Math.abs(differenceMs) <= toleranceMs;
        // PASS HARD PREREQUISITES (independent of tolerance):
        //   - output confirmed active immediately after enable (outputActiveAtStart)
        //   - output active + telemetry live at end of interval (endActive)
        //   - continuously active + live for the whole protected interval
        //     (continuousActiveLive: durable latch unchanged, no observed break)
        //   - no stress conflict (!conflict)
        //   - cleanup succeeded (cleanupOk)
        //   - timing within tolerance (withinTolerance)
        // ALL must hold; a generous tolerance can never rescue an interrupted or
        // never-active run.
        const pass =
          outputActiveAtStart &&
          endActive &&
          continuousActiveLive &&
          !conflict &&
          cleanupOk &&
          withinTolerance;
        const finishedAt = Date.now();
        const timingNote = `Protected timer session runtime +${lsnIncreaseMs}ms (independent device wall clock quantized in ${quantum}ms quanta, ${deviceTicksAccrued}×${quantum}ms observed active/live device-elapsed) vs PC monotonic measured ${pcMeasuredMs}ms (Δ${differenceMs}ms, tol ±${toleranceMs}ms).`;
        const startNote = outputActiveAtStart ? '' : ' PREREQUISITE FAIL: output was not active immediately after enable (dropped/blocked) -> result FAILED.';
        const continuityNote = (outputActiveAtStart && !continuousActiveLive)
          ? ` PREREQUISITE FAIL: output/telemetry was NOT continuously active+live for the interval (endActive=${endActive}, latchUnchanged=${latchUnchanged}, observedBreak=${observedBreak}) -> result FAILED.`
          : '';
        const cleanupNote = cleanupOk
          ? ' Output disabled by command.'
          : ' CLEANUP FAILURE: disable command did not take effect; safe simulator state forced -> result FAILED.';
        const conflictNote = conflict
          ? ' CONFLICT: competing Stress run detected; device-elapsed discarded, output forced inactive -> result FAILED.'
          : '';
        const result: TimerTestResult = {
          status: pass ? 'passed' : 'failed', startedAt, finishedAt,
          startRuntimeMs, endRuntimeMs, lsnIncreaseMs, pcMeasuredMs, differenceMs, toleranceMs,
          deviceQuantumMs: quantum, deviceTicksAccrued, cleanupOk, conflict,
          continuousActiveLive, outputActiveAtStart, pass,
          notes: timingNote + startNote + continuityNote + cleanupNote + conflictNote,
        };
        set({ timerTest: result });
        get().addTransaction({
          direction: 'bidirectional', operation: 'TIMER', command: 'TIMER_STOP', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: '{}', responsePayload: JSON.stringify({ lsnIncreaseMs, pcMeasuredMs, differenceMs, deviceQuantumMs: quantum, cleanupOk, conflict, pass }),
          requestHex: 'SIM TMR', responseHex: 'SIM TMR',
          requestDecoded: 'Simulated timer test stop; PC monotonic measurement vs independent device clock',
          responseDecoded: result.notes,
          status: pass ? 'ok' : 'error', latency: 1, relatedAction: 'timerTest',
          expectedResult: `Device runtime within ±${toleranceMs}ms of PC time, clean disable, no stress conflict`,
          actualResult: `${pass ? 'PASS' : 'FAIL'} (Δ${differenceMs}ms${cleanupOk ? '' : ', cleanup failed'}${conflict ? ', stress conflict' : ''})`, pass,
        });
        return result;
      },

      runGuidedPersistenceTest: async (engineeringNote) => {
        const { mode, connectionState, discover, connect } = get();

        if (mode === 'hardware') {
          const awaiting: PersistenceTestResult = {
            ...INITIAL_PERSISTENCE_TEST, status: 'awaiting_continue', phase: 'before', startedAt: Date.now(),
            runtimeBeforeMs: get().logicalState.lifetimeEmissionTimeMs,
            firmwareBefore: get().device.firmware, manual: true,
            notes: 'Hardware Mode is non-transmitting. Power-cycle the device manually, then press Continue to record manual evidence.',
          };
          set({ persistenceTest: awaiting });
          get().addTransaction({
            direction: 'tx', operation: 'PERSIST', command: 'PERSIST_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Hardware transmit blocked; awaiting manual power-cycle continue', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'persistenceTest', expectedResult: 'Manual continue', actualResult: 'Awaiting manual continue', pass: false,
          });
          return awaiting;
        }
        // ── Simulation Mode pre-flight gates (never simulate restart / claim
        //    persistence unless the session is genuinely LIVE and storage is OK) ──
        if (connectionState !== 'connected') {
          const blocked: PersistenceTestResult = {
            ...INITIAL_PERSISTENCE_TEST, status: 'blocked', phase: 'complete', startedAt: Date.now(), finishedAt: Date.now(),
            notes: 'Guided persistence test requires a connected Simulation session.',
          };
          set({ persistenceTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'PERSIST', command: 'PERSIST_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Persistence blocked: not connected', responseDecoded: '',
            status: 'error', latency: 0, relatedAction: 'persistenceTest', expectedResult: 'Connected live session', actualResult: 'Blocked (not connected)', pass: false,
          });
          return blocked;
        }
        // Require LIVE telemetry before the before-read. Connected-but-stale or
        // UNKNOWN-freshness must BLOCK: we must not simulate a restart or claim
        // persistence against data that cannot be trusted.
        const preFreshness = getTelemetryFreshness(connectionState, get().lastValidTelemetryAt);
        if (!preFreshness.isLive) {
          const blocked: PersistenceTestResult = {
            ...INITIAL_PERSISTENCE_TEST, status: 'blocked', phase: 'complete', startedAt: Date.now(), finishedAt: Date.now(),
            notes: `Guided persistence test requires a LIVE Simulation session; telemetry freshness=${preFreshness.state}. No restart simulated, no persistence claimed.`,
          };
          set({ persistenceTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'PERSIST', command: 'PERSIST_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Persistence blocked: telemetry not live',
            responseDecoded: `Telemetry freshness: ${preFreshness.state}${preFreshness.ageMs != null ? ` (age ${preFreshness.ageMs}ms)` : ''}`,
            status: 'error', latency: 0, relatedAction: 'persistenceTest', expectedResult: 'Live telemetry', actualResult: `Blocked (not live: ${preFreshness.state})`, pass: false,
          });
          return blocked;
        }
        // If a simulated storage failure is active, BLOCK at start: persistence cannot
        // be validated and must never PASS. (Blocking is safer than modelling reset.)
        if (get().logicalState.storageFailure) {
          const blocked: PersistenceTestResult = {
            ...INITIAL_PERSISTENCE_TEST, status: 'blocked', phase: 'complete', startedAt: Date.now(), finishedAt: Date.now(),
            notes: 'Simulated storage failure active; persistence cannot be validated. Clear the storage fault and retry. No restart simulated, no persistence claimed.',
          };
          set({ persistenceTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'PERSIST', command: 'PERSIST_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: 'Persistence blocked: simulated storage failure active', responseDecoded: 'logicalState.storageFailure=true',
            status: 'error', latency: 0, relatedAction: 'persistenceTest', expectedResult: 'Healthy non-volatile store', actualResult: 'Blocked (storage failure active)', pass: false,
          });
          return blocked;
        }
        // Mutual exclusion: a guided Persistence Test performs a scripted disconnect /
        // restart. It must not run concurrently with any other disruptive workflow
        // that owns the emission output / runtime counter, nor with a passive runtime
        // observation whose evidence the restart would invalidate. BLOCK before any
        // read/restart. Timer only locks while status==='running' (a manual Hardware
        // 'awaiting_continue' persistence never reaches here — Hardware returns above).
        const blockPersistence = (why: string, actual: string): PersistenceTestResult => {
          const blocked: PersistenceTestResult = {
            ...INITIAL_PERSISTENCE_TEST, status: 'blocked', phase: 'complete', startedAt: Date.now(), finishedAt: Date.now(),
            notes: `Guided persistence test blocked: ${why}. No restart simulated, no persistence claimed.`,
          };
          set({ persistenceTest: blocked });
          get().addTransaction({
            direction: 'tx', operation: 'PERSIST', command: 'PERSIST_TEST', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '',
            requestDecoded: `Persistence blocked: ${why} (mutual exclusion)`, responseDecoded: 'Stop the competing workflow before running the Persistence Test',
            status: 'error', latency: 0, relatedAction: 'persistenceTest', expectedResult: 'No competing disruptive workflow', actualResult: actual, pass: false,
          });
          return blocked;
        };
        if (get().stressTestState.isActive) {
          return blockPersistence('a Stress run is currently active', 'Blocked (Stress active)');
        }
        if (get().timerTest.status === 'running') {
          return blockPersistence('a guided Timer Test is currently running', 'Blocked (Timer Test running)');
        }
        if (get().runtimeSession.observation.active) {
          return blockPersistence('a runtime observation is currently active', 'Blocked (runtime observation active)');
        }

        // Helper to finalize a mid-run abort as a safe non-pass FAILED result.
        const abortPersistence = (reason: string, actual: string): PersistenceTestResult => {
          const abortResult: PersistenceTestResult = {
            ...INITIAL_PERSISTENCE_TEST, status: 'failed', phase: 'complete',
            startedAt: get().persistenceTest.startedAt, finishedAt: Date.now(),
            runtimeBeforeMs: get().persistenceTest.runtimeBeforeMs,
            firmwareBefore: get().persistenceTest.firmwareBefore,
            pass: false, manual: false,
            notes: `Persistence ABORTED before after-read: ${reason}. No persistence PASS claimed.`,
          };
          set({ persistenceTest: abortResult });
          get().addTransaction({
            direction: 'tx', operation: 'PERSIST', command: 'PERSIST_ABORT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: 'ABORT', requestHex: 'SIM PST', responseHex: 'SIM PST',
            requestDecoded: `Persistence aborted mid-run: ${reason}`, responseDecoded: 'Terminated safely; no after-read, no persistence pass',
            status: 'error', latency: 1, relatedAction: 'persistenceTest', expectedResult: 'Live session through restart', actualResult: actual, pass: false,
          });
          return abortResult;
        };

        const startedAt = Date.now();
        const runtimeBeforeMs = get().logicalState.lifetimeEmissionTimeMs;
        const firmwareBefore = get().device.firmware;
        set({ persistenceTest: { ...INITIAL_PERSISTENCE_TEST, status: 'running', phase: 'before', startedAt, runtimeBeforeMs, firmwareBefore } });
        get().addTransaction({
          direction: 'bidirectional', operation: 'PERSIST', command: 'PERSIST_READ_BEFORE', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: '{}', responsePayload: JSON.stringify({ runtimeBeforeMs, firmwareBefore }),
          requestHex: 'SIM PST', responseHex: 'SIM PST',
          requestDecoded: 'Simulated read runtime before restart', responseDecoded: `Simulated runtime=${runtimeBeforeMs}ms firmware=${firmwareBefore}`,
          status: 'ok', latency: 1, relatedAction: 'persistenceTest', expectedResult: 'Runtime captured', actualResult: 'Runtime captured', pass: true,
        });

        // Detects a competing disruptive workflow that appeared mid-run. Starts are
        // normally blocked above, but a direct state mutation / race could set one; if
        // so, abort persistence without an after-read or PASS and ensure no active
        // output survives.
        const competingWorkflow = (): string | null => {
          if (get().stressTestState.isActive) return 'a Stress run became active mid-run';
          if (get().timerTest.status === 'running') return 'a guided Timer Test became active mid-run';
          return null;
        };
        const abortOnConflict = (): PersistenceTestResult | null => {
          const conflict = competingWorkflow();
          if (!conflict) return null;
          // Ensure no active output survives the conflict abort.
          set(state => ({
            logicalState: { ...state.logicalState, requestedEnable: false, emissionControlOutputActive: false },
          }));
          return abortPersistence(`competing workflow conflict — ${conflict}`, 'Aborted (competing workflow conflict)');
        };

        // A storage failure appearing between the before-read and the restart is a
        // hard fail: abort before touching the restart workflow.
        if (get().logicalState.storageFailure) {
          return abortPersistence('simulated storage failure appeared before restart', 'Aborted (storage failure mid-run)');
        }
        { const c = abortOnConflict(); if (c) return c; }

        // Simulate disconnect / restart while preserving the lifetime counter. NOTE:
        // this INTENTIONALLY drives connectionState to 'disconnected' as part of the
        // simulated reboot. That expected internal transition must NOT be treated as
        // an unexpected failure — we only re-validate liveness AFTER the intentional
        // reconnect below.
        set(state => ({ persistenceTest: { ...state.persistenceTest, phase: 'restarting' } }));
        // Guard: an EXTERNAL communication loss (commsLoss) is not part of the
        // scripted restart and must abort before we simulate the reboot.
        if (get().logicalState.commsLoss) {
          return abortPersistence('unexpected communication loss before restart', 'Aborted (comms loss mid-run)');
        }
        get().disconnect();
        await new Promise(r => setTimeout(r, 1));
        // A competing workflow appearing during the restart window aborts safely.
        { const c = abortOnConflict(); if (c) return c; }
        // If a comms loss was injected during the restart window, the reconnect below
        // will fault; detect it early for clearer evidence.
        if (get().logicalState.commsLoss) {
          return abortPersistence('unexpected communication loss during restart window', 'Aborted (comms loss during restart)');
        }
        // A storage failure surfacing during the restart window also aborts before we
        // record the (would-be pass) restart step.
        if (get().logicalState.storageFailure) {
          return abortPersistence('simulated storage failure appeared during restart window', 'Aborted (storage failure during restart)');
        }
        get().addTransaction({
          direction: 'rx', operation: 'PERSIST', command: 'PERSIST_RESTART', service: 'TBD', mapping: null,
          requestPayload: '', responsePayload: 'REBOOT', requestHex: '', responseHex: 'SIM PST',
          requestDecoded: '', responseDecoded: 'Simulated device restart; lifetime counter preserved in non-volatile store',
          status: 'ok', latency: 1, relatedAction: 'persistenceTest', expectedResult: 'Counter preserved', actualResult: 'Counter preserved', pass: true,
        });

        // Rediscover / reconnect as part of the INTENTIONAL simulator reconnect. The
        // connect() call refreshes lastValidTelemetryAt only because this is the
        // scripted reconnect, not a blanket freshness reset.
        await discover();
        await connect();
        // Validate that the intentional reconnect actually re-established a LIVE
        // session before the after-read. If reconnect faulted (e.g. commsLoss) or
        // telemetry is not live, terminate safely without claiming persistence.
        if (get().connectionState !== 'connected') {
          return abortPersistence(`reconnect did not re-establish a connected session (state=${get().connectionState})`, 'Aborted (reconnect failed)');
        }
        const postFreshness = getTelemetryFreshness(get().connectionState, get().lastValidTelemetryAt);
        if (!postFreshness.isLive) {
          return abortPersistence(`telemetry not live after reconnect (freshness=${postFreshness.state})`, `Aborted (not live after reconnect: ${postFreshness.state})`);
        }
        // A competing workflow appearing after reconnect but before the after-read
        // aborts safely (no after-read / PASS, no active output survivor).
        { const c = abortOnConflict(); if (c) return c; }
        // A storage failure surfacing after reconnect but before the after-read must
        // also fail: persistence cannot be validated against a failed store.
        if (get().logicalState.storageFailure) {
          return abortPersistence('simulated storage failure active after reconnect', 'Aborted (storage failure after reconnect)');
        }
        set(state => ({ persistenceTest: { ...state.persistenceTest, phase: 'after' } }));
        const runtimeAfterMs = get().logicalState.lifetimeEmissionTimeMs;
        const firmwareAfter = get().device.firmware;
        const differenceMs = runtimeAfterMs - runtimeBeforeMs;
        const nonDecreasing = runtimeAfterMs >= runtimeBeforeMs;
        // Final belt-and-suspenders: PASS requires non-decreasing runtime, a still
        // connected+live session, and a healthy (non-failed) storage.
        const finalFreshness = getTelemetryFreshness(get().connectionState, get().lastValidTelemetryAt);
        const pass = nonDecreasing
          && get().connectionState === 'connected'
          && finalFreshness.isLive
          && !get().logicalState.storageFailure;
        const finishedAt = Date.now();
        const result: PersistenceTestResult = {
          status: pass ? 'passed' : 'failed', phase: 'complete', startedAt, finishedAt,
          runtimeBeforeMs, runtimeAfterMs, differenceMs, firmwareBefore, firmwareAfter, nonDecreasing, pass, manual: false,
           notes: `${engineeringNote ? `${engineeringNote} — ` : ''}Simulated runtime before=${runtimeBeforeMs}ms after=${runtimeAfterMs}ms (Δ${differenceMs}ms); ${nonDecreasing ? 'non-decreasing' : 'DECREASED'}; firmware ${firmwareBefore}→${firmwareAfter}.`,
        };
        set({ persistenceTest: result });
        get().addTransaction({
          direction: 'bidirectional', operation: 'PERSIST', command: 'PERSIST_READ_AFTER', service: 'TBD', mapping: 'LifetimeEmissionTime',
          requestPayload: '{}', responsePayload: JSON.stringify({ runtimeAfterMs, nonDecreasing, pass }),
          requestHex: 'SIM PST', responseHex: 'SIM PST',
          requestDecoded: 'Simulated read runtime after restart', responseDecoded: result.notes,
          status: pass ? 'ok' : 'error', latency: 1, relatedAction: 'persistenceTest',
          expectedResult: 'Runtime non-decreasing across restart', actualResult: `${pass ? 'PASS' : 'FAIL'} (Δ${differenceMs}ms)`, pass,
        });
        return result;
      },

      continuePersistenceTest: (manualNote) => {
        const pt = get().persistenceTest;
        if (pt.status !== 'awaiting_continue') return pt;
        const runtimeAfterMs = get().logicalState.lifetimeEmissionTimeMs;
        const firmwareAfter = get().device.firmware;
        const differenceMs = runtimeAfterMs - pt.runtimeBeforeMs;
        const nonDecreasing = runtimeAfterMs >= pt.runtimeBeforeMs;
        // A manual Hardware-origin awaiting_continue is UNCONDITIONALLY non-pass. It
        // records observational evidence only and can NEVER become a persistence PASS,
        // regardless of the CURRENT mode / connection / freshness. This closes a
        // false-PASS path where switching Hardware->Simulation and reconnecting would
        // otherwise make `pass` true. Real simulation validation requires a NEW
        // runGuidedPersistenceTest with full LIVE before/restart/reconnect/after checks.
        const pass = false;
        const finishedAt = Date.now();
        const switchedToSim = get().mode === 'simulation';
        const conversionNote = switchedToSim
          ? ' This manual Hardware workflow CANNOT be converted into simulation validation: start a new guided persistence run (Simulation, LIVE) for a validated before/restart/after result.'
          : ' Hardware Mode is non-transmitting; no live data, so no persistence pass is claimed.';
        const result: PersistenceTestResult = {
          ...pt,
          status: 'failed',
          phase: 'complete',
          finishedAt,
          runtimeAfterMs,
          firmwareAfter,
          differenceMs,
          nonDecreasing,
          pass,
          manual: true,
          notes: `${manualNote ? manualNote + ' — ' : ''}Manual evidence recorded (observational only; no persistence PASS claimed).${conversionNote}`,
        };
        set({ persistenceTest: result });
        get().addTransaction({
          direction: 'rx', operation: 'PERSIST', command: 'PERSIST_MANUAL_CONTINUE', service: 'TBD', mapping: null,
          requestPayload: '', responsePayload: JSON.stringify({ manual: true, runtimeAfterMs, nonDecreasing, pass }),
          requestHex: '', responseHex: 'SIM PST',
          requestDecoded: '', responseDecoded: result.notes,
          status: 'error', latency: 0, relatedAction: 'persistenceTest',
          expectedResult: 'Manual observation recorded (never a persistence pass)', actualResult: 'Manual observation recorded (non-pass)', pass: false,
        });
        return result;
      }
    }),
    {
      name: 'lsn-console-storage',
      version: 4,
      migrate: (persistedState) => {
        const state = persistedState as Partial<LSNStore>;
        return {
          ...state,
          // Reset tests to the canonical current set so stale records from older
          // app versions (different IDs, names, or missing capability fields) do
          // not survive a version bump and cause every test to fail immediately.
          tests: INITIAL_TESTS,
          profile: Array.isArray(state.profile)
            ? state.profile.map(item => {
                const canonical = INITIAL_PROFILE.find(candidate => candidate.symbolicName === item.symbolicName);
                return {
                  ...item,
                  implementationStatus: 'TBD' as ImplementationStatus,
                  simulationStatus: canonical?.simulationStatus ?? 'NOT_TESTED',
                };
              })
            : INITIAL_PROFILE,
        };
      },
      partialize: (state) => state.settings.localPersistence ? {
        device: state.device,
        logicalState: sanitizeLogicalStateForCapabilities(state.logicalState, state.capabilities),
        profile: state.profile,
        transactions: state.transactions.filter(transaction => isTransactionSupported(transaction, state.capabilities)),
        tests: state.tests,
        baseCapabilities: state.baseCapabilities,
        capabilities: state.capabilities,
        settings: state.settings
      } : {} as Partial<LSNStore>,
    }
  )
);
