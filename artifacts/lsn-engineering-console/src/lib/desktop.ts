/**
 * Typed access to the narrow Electron preload bridge.
 *
 * The renderer never touches Node or Electron APIs directly; the packaged
 * desktop Console exposes only the allowlisted capabilities below through
 * `window.lsnDesktop` (see electron/preload.cjs).
 */

export interface DesktopPlatformInfo {
  platform: string;
  packaged: boolean;
  appVersion?: string;
}

export function getDefaultRuntimeMode(
  platform: DesktopPlatformInfo,
): 'hardware' | null {
  return platform.packaged && platform.platform === 'win32' ? 'hardware' : null;
}

export interface DesktopHardwareCapabilities {
  controlTransport: string;
  profileMapping: string;
  maintenanceTransport: string;
  physicalValidation: string;
  canTransmit: boolean;
  /** Standard EtherNet/IP discovery can transmit (packaged Windows). */
  discoveryTransport?: boolean;
  /** RegisterSession/session transport can transmit (packaged Windows). */
  sessionTransport?: boolean;
  /** Profile-driven control stays false until CIP mappings are resolved. */
  profileControl?: boolean;
}

/** A single EtherNet/IP ListIdentity discovery candidate. */
export interface DesktopHardwareIdentity {
  sourceAddress: string | null;
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
  encapProtocolVersion: number;
}

export interface DesktopHardwareDiscoverResult {
  candidates: DesktopHardwareIdentity[];
}

export type DesktopHardwareConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected';

export interface DesktopHardwareState {
  state: DesktopHardwareConnectionState;
  connected: boolean;
  address: string | null;
  sessionHandle: number | null;
}

/** A single blocking mapping issue reported by the profile layer in main. */
export interface DesktopMappingIssue {
  symbolicName: string;
  severity: 'blocking';
  code: string;
  message: string;
}

/** Readiness of a single profile-driven workflow. */
export interface DesktopWorkflowReadiness {
  ready: boolean;
  issues: DesktopMappingIssue[];
}

/**
 * Profile readiness reported by the main process. The renderer never provides
 * or interprets CIP mappings; it only observes whether main has resolved them.
 */
export interface DesktopProfileReadiness {
  profileDigest: string;
  profileVersion: string;
  protocolVersion: string;
  stateRead: DesktopWorkflowReadiness;
  enable: DesktopWorkflowReadiness;
  controlReady: boolean;
  readReady: boolean;
}

/** A decoded, typed symbolic field read. */
export interface DesktopFieldReadResult {
  symbolicName: string;
  value: boolean | number | string;
}

/** Result of minting a one-shot control arm token. */
export interface DesktopArmResult {
  armed: boolean;
  expiresAt?: number;
}

/** Result of a guarded emission enable/disable with hardware readback. */
export interface DesktopWriteEnableResult {
  requested: boolean;
  outputActive: boolean;
}

const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Strict dotted-quad IPv4 check mirroring the transport-layer validation. */
export function isValidIpv4(address: string): boolean {
  return typeof address === 'string' && IPV4_PATTERN.test(address);
}

export interface DesktopSaveResult {
  saved: boolean;
  path?: string;
  error?: string;
}

export interface DesktopAuthResponse {
  status: number;
  body: unknown;
}

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'deferred'
  | 'installing'
  | 'error'
  | 'unsupported';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  receivedBytes?: number;
  totalBytes?: number;
  percent?: number;
  message?: string;
  errorCode?: string;
  canRetry: boolean;
  checkedAt?: string;
  installerTrust?: 'trusted-publisher' | 'unsigned';
}

export interface LsnDesktopBridge {
  getPlatform: () => Promise<DesktopPlatformInfo>;
  authRequest: (
    path: string,
    method: string,
    body?: string,
  ) => Promise<DesktopAuthResponse>;
  getHardwareCapabilities: () => Promise<DesktopHardwareCapabilities>;
  hardwareDiscover: (
    address?: string,
  ) => Promise<DesktopHardwareDiscoverResult>;
  hardwareConnect: (address: string) => Promise<DesktopHardwareState>;
  hardwareDisconnect: () => Promise<DesktopHardwareState>;
  getHardwareState: () => Promise<DesktopHardwareState>;
  hardwareGetProfileReadiness: () => Promise<DesktopProfileReadiness>;
  hardwareReadField: (symbolicName: string) => Promise<DesktopFieldReadResult>;
  hardwareArmControl: () => Promise<DesktopArmResult>;
  hardwareWriteEnable: (enable: boolean) => Promise<DesktopWriteEnableResult>;
  onHardwareState: (
    listener: (state: DesktopHardwareState) => void,
  ) => () => void;
  selectFirmwarePackage: () => Promise<string | null>;
  saveFile: (filename: string, data: Uint8Array | string) => Promise<DesktopSaveResult>;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  deferUpdate: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<DesktopUpdateState>;
  onUpdateState: (
    listener: (state: DesktopUpdateState) => void,
  ) => () => void;
}

declare global {
  interface Window {
    lsnDesktop?: LsnDesktopBridge;
  }
}

/** The preload bridge, when running inside the Electron desktop shell. */
export function getDesktopBridge(): LsnDesktopBridge | null {
  return typeof window !== 'undefined' && window.lsnDesktop ? window.lsnDesktop : null;
}

/** True only inside the packaged desktop runtime (not the dev shell). */
export async function isPackagedDesktopRuntime(): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (!bridge) return false;
  try {
    const info = await bridge.getPlatform();
    return info.packaged === true;
  } catch {
    return false;
  }
}

/**
 * Run an EtherNet/IP discovery through the desktop bridge. In the browser (no
 * bridge) this resolves to an empty candidate list, preserving browser
 * behavior. An invalid probe address is rejected before touching the bridge.
 */
export async function discoverHardware(
  address?: string,
): Promise<DesktopHardwareDiscoverResult> {
  const bridge = getDesktopBridge();
  if (!bridge) return { candidates: [] };
  if (address !== undefined && !isValidIpv4(address)) {
    throw new Error('Invalid IPv4 address');
  }
  return bridge.hardwareDiscover(address);
}

/**
 * Connect to a controller by validated IPv4 through the desktop bridge. Returns
 * null in the browser where no transport exists.
 */
export async function connectHardware(
  address: string,
): Promise<DesktopHardwareState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  if (!isValidIpv4(address)) {
    throw new Error('Invalid IPv4 address');
  }
  return bridge.hardwareConnect(address);
}

/** The disconnected sentinel used when no desktop transport is present. */
export function disconnectedHardwareState(): DesktopHardwareState {
  return {
    state: 'disconnected',
    connected: false,
    address: null,
    sessionHandle: null,
  };
}
