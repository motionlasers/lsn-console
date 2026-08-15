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
