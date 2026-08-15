/**
 * Canonical Console release identity and release history.
 *
 * This module is the single in-app source of truth for the Console's own
 * version and for the independently versioned external interface tracks
 * (LSN Protocol, Device Profile, Firmware Interface package). The full
 * human-readable history lives in CHANGELOG.md; tests/release.test.ts keeps
 * the two in lockstep so neither becomes a manually drifting copy.
 */
import consolePackage from '../../package.json' with { type: 'json' };

/** Impact of a Console release on the external LSN protocol / interface. */
export type ProtocolImpact = 'none' | 'additive' | 'breaking';

export interface ConsoleRelease {
  /** Semantic Console version, e.g. "0.2.0". */
  version: string;
  /** Human-readable display label, e.g. "v0.2.0 Development Preview". */
  label: string;
  /** Release classification. */
  releaseType: 'development-preview' | 'internal' | 'production';
  /** ISO release date. */
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  knownLimitations: string[];
  /** Impact on the LSN Protocol / external firmware interface. */
  protocolImpact: ProtocolImpact;
  /** Plain statement of the protocol impact shown to firmware engineers. */
  protocolImpactStatement: string;
  /** Plain statement of the Device Profile impact. */
  deviceProfileImpactStatement: string;
}

/** The four separately versioned tracks. Only the Console track moves here. */
export const VERSION_TRACKS = {
  console: {
    name: 'Console',
    version: consolePackage.version,
    label: `v${consolePackage.version} Development Preview`,
  },
  protocol: {
    name: 'LSN Protocol',
    version: 'LSN v0.1',
    label: 'LSN v0.1',
  },
  deviceProfile: {
    name: 'Device Profile',
    version: '0.1.0',
    label: 'lsn-v0.1.0',
  },
  firmwareInterface: {
    name: 'Firmware Interface Package',
    version: 'v0.1',
    label: 'LSN-Firmware-Interface-v0.1',
  },
} as const;

export const CONSOLE_VERSION = consolePackage.version;
export const CONSOLE_RELEASE_LABEL = VERSION_TRACKS.console.label;

/** Windows release artifact identity for the current Console release. */
export const WINDOWS_ARTIFACTS = {
  installer: `LSN-Engineering-Console-Setup-${CONSOLE_VERSION}-dev.exe`,
  portable: `LSN-Engineering-Console-Portable-${CONSOLE_VERSION}.zip`,
  releaseTag: `lsn-console-v${CONSOLE_VERSION}`,
  signed: false,
} as const;

const DEFAULT_RELEASE_ASSET_ROOT_URL =
  'https://github.com/motionlasers/lsn-console/releases/download';

/**
 * Convert legacy version-specific and moving "latest" configuration values
 * into the stable repository release root. The Console's own releaseTag is
 * appended separately so every deployed web revision remains pinned forever.
 */
export function normalizeReleaseAssetRoot(url: string): string {
  return url
    .replace(/\/+$/, '')
    .replace(
      /\/releases\/(?:latest\/download|download\/lsn-console-v[^/]+)$/,
      '/releases/download',
    );
}

export const RELEASE_ASSET_ROOT_URL = normalizeReleaseAssetRoot(
  (import.meta.env?.VITE_LSN_RELEASE_BASE_URL as string | undefined) ??
    DEFAULT_RELEASE_ASSET_ROOT_URL,
);

export const RELEASE_ASSET_BASE_URL =
  `${RELEASE_ASSET_ROOT_URL}/${WINDOWS_ARTIFACTS.releaseTag}`;

export function releaseAssetUrl(filename: string): string {
  return `${RELEASE_ASSET_BASE_URL}/${filename}`;
}

/** Reverse-chronological Console release history (mirrors CHANGELOG.md). */
export const CONSOLE_RELEASES: ConsoleRelease[] = [
  {
    version: '0.2.1',
    label: 'v0.2.1 Development Preview',
    releaseType: 'development-preview',
    date: '2026-08-14',
    added: [],
    changed: [
      'Guided-tour coachmarks now stay clear of active navigation, keep controls visible on short screens, and support comma/period Back and Next hotkeys.',
      'Downloads now explains how firmware engineers resolve intentionally TBD protocol mappings before Hardware Mode can transmit.',
    ],
    fixed: [
      'Packaged Windows login now sends allowlisted authentication requests through the Electron main process to the published HTTPS API instead of resolving /api URLs under file://.',
    ],
    knownLimitations: [
      'The Windows installer is unsigned; Microsoft Defender SmartScreen will warn on first run ("More info" \u2192 "Run anyway"). Internal development use only.',
      'Hardware Mode remains truthfully non-functional: real WT32-ETH01 discovery, EtherNet/IP (CIP) sessions, physical control validation, and firmware upload are not implemented.',
      'Simulation Mode is the supported validation environment; simulation evidence never advances firmware implementation status.',
      'CIP Class/Instance/Attribute/Assembly values and other Device Profile mappings remain intentionally TBD for the firmware engineer.',
    ],
    protocolImpact: 'none',
    protocolImpactStatement:
      'No protocol impact. LSN Protocol remains v0.1 and the external firmware interface is unchanged; no firmware action is required for this Console release.',
    deviceProfileImpactStatement:
      'Device Profile unchanged. The active profile remains lsn-v0.1.0 and the generated package remains LSN-Firmware-Interface-v0.1.zip.',
  },
  {
    version: '0.2.0',
    label: 'v0.2.0 Development Preview',
    releaseType: 'development-preview',
    date: '2026-08-14',
    added: [
      'Windows Development Preview packaging: unsigned Squirrel installer and optional portable ZIP produced by the tagged CI workflow.',
      'Once-per-version "What\u2019s New" summary in the packaged desktop Console with a link to the full changelog.',
      'Changelog and version information available from Help / Firmware Guide and Downloads, covering all four version tracks.',
      'Native desktop save/export dialog for reports, logs, support bundles, and the Firmware Integration Package when running the packaged Windows Console.',
      'Release, protocol, Device Profile, and connected-firmware identity embedded in validation reports, support bundles, and engineering-log exports.',
    ],
    changed: [
      'Console release identity centralized in a single shared module driving the header, login screen, Downloads, exports, and desktop What\u2019s New.',
      'Downloads presents the current Windows Development Preview release, release notes, and the unchanged v0.1 Firmware Integration Package side by side.',
      'Guided tour closing steps now point to both v0.2.0 handoff resources (Windows Console preview and the v0.1 firmware package).',
    ],
    fixed: [],
    knownLimitations: [
      'The Windows installer is unsigned; Microsoft Defender SmartScreen will warn on first run ("More info" \u2192 "Run anyway"). Internal development use only.',
      'Hardware Mode remains truthfully non-functional: real WT32-ETH01 discovery, EtherNet/IP (CIP) sessions, physical control validation, and firmware upload are not implemented.',
      'Simulation Mode is the supported validation environment; simulation evidence never advances firmware implementation status.',
      'CIP Class/Instance/Attribute/Assembly values and other Device Profile mappings remain intentionally TBD for the firmware engineer.',
    ],
    protocolImpact: 'none',
    protocolImpactStatement:
      'No protocol impact. LSN Protocol remains v0.1 and the external firmware interface is unchanged; no firmware action is required for this Console release.',
    deviceProfileImpactStatement:
      'Device Profile unchanged. The active profile remains lsn-v0.1.0 and the generated package remains LSN-Firmware-Interface-v0.1.zip.',
  },
  {
    version: '0.1.0',
    label: 'v0.1.0',
    releaseType: 'internal',
    date: '2026-08-07',
    added: [
      'Added the simulation-first LSN engineering platform foundation.',
      'Added versioned Device Profiles and generated firmware-interface concepts.',
      'Added control, protocol inspection, validation, stress, firmware-update, reporting, and modular-extension workflows.',
      'Added secure Electron shell structure and Windows packaging workflow.',
    ],
    changed: [],
    fixed: [],
    knownLimitations: [
      'Web-only distribution; no packaged Windows build was published for this release.',
    ],
    protocolImpact: 'none',
    protocolImpactStatement: 'Initial release; defined the LSN v0.1 protocol track.',
    deviceProfileImpactStatement: 'Initial release; defined Device Profile lsn-v0.1.0.',
  },
];

export const CURRENT_RELEASE = CONSOLE_RELEASES[0];

/** Whether a release warrants prominent firmware-action messaging. */
export function releaseRequiresFirmwareAction(release: ConsoleRelease): boolean {
  return release.protocolImpact !== 'none';
}

/** Short protocol-impact banner text (empty label class when no impact). */
export function getProtocolImpactSummary(release: ConsoleRelease): {
  tone: 'info' | 'warning' | 'critical';
  headline: string;
  statement: string;
} {
  if (release.protocolImpact === 'breaking') {
    return {
      tone: 'critical',
      headline: 'PROTOCOL CHANGE — FIRMWARE ACTION REQUIRED',
      statement: release.protocolImpactStatement,
    };
  }
  if (release.protocolImpact === 'additive') {
    return {
      tone: 'warning',
      headline: 'ADDITIVE PROTOCOL CHANGE — REVIEW REQUIRED',
      statement: release.protocolImpactStatement,
    };
  }
  return {
    tone: 'info',
    headline: 'NO PROTOCOL IMPACT',
    statement: release.protocolImpactStatement,
  };
}

/** Compact metadata block for exports, reports, and support bundles. */
export function getReleaseExportMetadata(connectedFirmwareVersion?: string) {
  return {
    consoleVersion: CONSOLE_VERSION,
    consoleRelease: CONSOLE_RELEASE_LABEL,
    releaseType: CURRENT_RELEASE.releaseType,
    protocolVersion: VERSION_TRACKS.protocol.version,
    deviceProfileVersion: VERSION_TRACKS.deviceProfile.version,
    firmwareInterfacePackage: VERSION_TRACKS.firmwareInterface.label,
    ...(connectedFirmwareVersion !== undefined
      ? { connectedFirmwareVersion }
      : {}),
  };
}
