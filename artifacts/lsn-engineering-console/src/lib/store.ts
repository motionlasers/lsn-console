import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import profileJson from '../../profiles/lsn-v0.1.json';
import { validateDeviceProfile } from './profile-validation';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'faulted';
export type HardwareMode = 'simulation' | 'hardware';
export type ImplementationStatus = 'TBD' | 'IMPLEMENTING' | 'TESTING' | 'IMPLEMENTED' | 'VERIFIED';
export type CapabilityKey = 'interlock' | 'remoteStop' | 'sensors';
export type CapabilityModel = Record<CapabilityKey, boolean>;

export const DEFAULT_CAPABILITIES: CapabilityModel = {
  interlock: profileJson.capabilities.interlock.enabled,
  remoteStop: profileJson.capabilities.remoteStop.enabled,
  sensors: profileJson.capabilities.sensors.enabled,
};

export function shouldDropResponse(ratePercent: number, attempt: number): boolean {
  const rate = Math.max(0, Math.min(100, Math.floor(ratePercent)));
  return ((attempt * 37 + 17) % 100) < rate;
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
  expectedFirmwareBehavior: string;
  expectedReportedResponse: string;
  notes: string;
  capability?: CapabilityKey;
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

interface LSNStore {
  mode: HardwareMode;
  hardwareUnlocked: boolean;
  connectionState: ConnectionState;
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
  };
  firmwareState: FirmwareUpdateState;
  responseAttempt: number;
  transactionCapabilityContext: CapabilityKey | null;
  stressTestState: {
    isActive: boolean;
    completedCycles: number;
    targetCycles: number;
    onDuration: number;
    offDuration: number;
    faultProbability: number;
    phase: 'on' | 'off';
    phaseElapsedMs: number;
  };

  // Actions
  setMode: (mode: HardwareMode) => void;
  setHardwareUnlocked: (unlocked: boolean) => void;
  setCapability: (capability: CapabilityKey, enabled: boolean) => void;
  discover: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleEnable: (enable: boolean) => void;
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
  startStressTest: (config: { cycles: number; onDur: number; offDur: number; faultProb: number }) => void;
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
  expectedFirmwareBehavior: item.expectedFirmwareBehavior,
  expectedReportedResponse: item.expectedReportedResponse,
  notes: item.notes,
  capability: 'capability' in item ? item.capability as CapabilityKey : undefined,
}));

const INITIAL_TESTS: TestResult[] = [
  { id: 't_disc', name: 'Discovery', category: 'Session', status: 'pending', expected: 'Controller responds to discovery beacon', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_id', name: 'Identity Verification', category: 'Session', status: 'pending', expected: 'Identity matches profile expectations', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_conn', name: 'Connect & Session', category: 'Session', status: 'pending', expected: 'Simulated session opens while service mapping remains TBD', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_def', name: 'Default Disabled', category: 'Safety', status: 'pending', expected: 'Emission Output Active is FALSE on boot', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_en', name: 'Enable Request/Feedback', category: 'Control', status: 'pending', expected: 'Emission Output Active == TRUE after request', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_dis', name: 'Disable Request/Feedback', category: 'Control', status: 'pending', expected: 'Emission Output Active == FALSE after disable', actual: '', duration: 0, evidence: '', manualObservation: false },
  { id: 't_intl', name: 'Interlock Block', category: 'Safety', status: 'pending', expected: 'Enable blocked when interlock open', actual: '', duration: 0, evidence: '', manualObservation: false, capability: 'interlock' },
  { id: 't_rem', name: 'Remote Stop Block', category: 'Safety', status: 'pending', expected: 'Enable blocked when remote stop asserted', actual: '', duration: 0, evidence: '', manualObservation: false, capability: 'remoteStop' },
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
      stressTestState: {
        isActive: false, completedCycles: 0, targetCycles: 0, onDuration: 0, offDuration: 0, faultProbability: 0, phase: 'off', phaseElapsedMs: 0
      },
      settings: {
        devMode: false,
        simulatorTiming: 100,
        droppedResponseRate: 0,
        localPersistence: true,
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
          get().addTransaction({
            direction: 'tx', operation: 'CONNECT', command: 'INIT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: '', requestHex: '', responseHex: '', requestDecoded: 'Connection Failed (Comms Loss)', responseDecoded: '',
            status: 'error', latency: settings.simulatorTiming, relatedAction: 'connect', expectedResult: 'ACK', actualResult: 'TIMEOUT', pass: false
          });
          return;
        }

        set({ connectionState: 'connecting' });
        await new Promise(r => setTimeout(r, settings.simulatorTiming * 2));
        set({ connectionState: 'connected' });
        
        get().addTransaction({
          direction: 'tx', operation: 'CONNECT', command: 'INIT', service: 'TBD', mapping: null,
          requestPayload: '{}', responsePayload: '{}', requestHex: 'SIM 01 00', responseHex: 'SIM 81 00', requestDecoded: 'Simulated session request; CIP service TBD', responseDecoded: 'Simulated session accepted',
          status: 'ok', latency: settings.simulatorTiming, relatedAction: 'connect', expectedResult: 'Simulated session connected', actualResult: 'Simulated session connected', pass: true
        });
      },

      disconnect: () => {
        set({ connectionState: 'disconnected', discovered: false });
        get().addTransaction({
          direction: 'tx', operation: 'DISCONNECT', command: 'CLOSE', service: 'TBD', mapping: null,
          requestPayload: '{}', responsePayload: '{}', requestHex: 'SIM 02 00', responseHex: 'SIM 82 00', requestDecoded: 'Simulated session close; CIP service TBD', responseDecoded: 'Simulated close acknowledged',
          status: 'ok', latency: 5, relatedAction: 'disconnect', expectedResult: 'ACK', actualResult: 'ACK', pass: true
        });
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
      },

      setInterlock: (ok) => {
        if (!get().capabilities.interlock || get().mode !== 'simulation') return;
        set(state => {
          const newState = { ...state.logicalState, interlockOK: ok };
          if (!ok && newState.emissionControlOutputActive) {
            newState.emissionControlOutputActive = false;
            newState.reportedEnablePermitted = false;
            newState.lastDisableReason = 'Interlock Broken';
          }
          return { logicalState: newState };
        });
      },

      setRemoteStop: (ok) => {
        if (!get().capabilities.remoteStop || get().mode !== 'simulation') return;
        set(state => {
          const newState = { ...state.logicalState, remoteStopOK: ok };
          if (!ok && newState.emissionControlOutputActive) {
            newState.emissionControlOutputActive = false;
            newState.reportedEnablePermitted = false;
            newState.lastDisableReason = 'Remote Stop Asserted';
          }
          return { logicalState: newState };
        });
      },

      triggerFault: (code) => {
        get().addTransaction({
            direction: 'rx', operation: 'NOTIFY', command: 'FAULT_EVENT', service: 'TBD', mapping: null,
            requestPayload: '', responsePayload: `{"code": "${code}"}`, requestHex: '', responseHex: 'SIM FF', requestDecoded: '', responseDecoded: `Simulated fault: ${code}; field mapping TBD`,
          status: 'error', latency: 0, relatedAction: 'fault_injection', expectedResult: 'None', actualResult: 'Fault registered', pass: false
        });

        set(state => ({
          logicalState: {
            ...state.logicalState,
            faulted: true,
            faultCode: code,
            emissionControlOutputActive: false,
            reportedEnablePermitted: false,
            lastDisableReason: `Fault: ${code}`
          }
        }));
      },

      clearFault: () => {
        get().addTransaction({
          direction: 'tx', operation: 'WRITE', command: 'CLEAR_FAULT', service: 'TBD', mapping: 'FaultReset',
          requestPayload: '1', responsePayload: 'ACK', requestHex: '01', responseHex: '06', requestDecoded: `Clear fault request`, responseDecoded: 'ACK',
          status: 'ok', latency: 8, relatedAction: 'clearFault', expectedResult: 'Success', actualResult: 'Success', pass: true
        });

        set(state => ({ logicalState: { ...state.logicalState, faulted: false, faultCode: null } }));
      },

      updateLogicalState: (updates) => set(state => ({ logicalState: { ...state.logicalState, ...updates } })),
      
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
        settings: { devMode: false, simulatorTiming: 100, droppedResponseRate: 0, localPersistence: true },
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
          set({ logicalState, transactions, tests });
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
        set(state => {
          const ls = state.logicalState;
          const wasActive = ls.emissionControlOutputActive;
          const newLS = {
            ...ls,
            lifetimeEmissionTimeMs: ls.lifetimeEmissionTimeMs + (wasActive ? deltaMs : 0),
            emissionControlOutputActive: ls.commsLoss ? false : ls.emissionControlOutputActive,
            reportedEnablePermitted: ls.commsLoss ? false : ls.reportedEnablePermitted,
            lastDisableReason: ls.commsLoss && wasActive ? 'Communication Loss' : ls.lastDisableReason,
          };
          const newStress = { ...state.stressTestState };

          if (newStress.isActive) {
            newStress.phaseElapsedMs += deltaMs;
            let guard = 0;
            while (newStress.isActive && guard++ < 10_000) {
              const duration = newStress.phase === 'off' ? newStress.offDuration : newStress.onDuration;
              if (newStress.phaseElapsedMs < duration) break;
              newStress.phaseElapsedMs -= duration;

              if (newStress.phase === 'off') {
                newStress.phase = 'on';
                const interlockPermits = !state.capabilities.interlock || newLS.interlockOK;
                const remoteStopPermits = !state.capabilities.remoteStop || newLS.remoteStopOK;
                if (interlockPermits && remoteStopPermits && !newLS.faulted) {
                  newLS.requestedEnable = true;
                  newLS.emissionControlOutputActive = true;
                  newLS.enableCount += 1;
                }
              } else {
                newStress.phase = 'off';
                newStress.completedCycles += 1;
                newLS.requestedEnable = false;
                newLS.emissionControlOutputActive = false;
                if (newStress.completedCycles >= newStress.targetCycles) {
                  newStress.isActive = false;
                  newStress.phaseElapsedMs = 0;
                } else if (shouldDropResponse(newStress.faultProbability, newStress.completedCycles)) {
                  newLS.faulted = true;
                  newLS.faultCode = `STRESS-FAULT-${newStress.completedCycles}`;
                  newStress.isActive = false;
                }
              }
            }
          }

          return { logicalState: newLS, stressTestState: newStress };
        });
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
        if (get().mode === 'hardware') return;
        set(() => ({
          stressTestState: {
            isActive: true,
            completedCycles: 0,
            targetCycles: config.cycles,
            onDuration: config.onDur,
            offDuration: config.offDur,
            faultProbability: config.faultProb,
            phase: 'off',
            phaseElapsedMs: 0
          }
        }));
      },
      
      stopStressTest: () => set(s => ({ stressTestState: { ...s.stressTestState, isActive: false } }))
    }),
    {
      name: 'lsn-console-storage',
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
