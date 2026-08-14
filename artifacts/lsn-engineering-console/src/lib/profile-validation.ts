import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import profileSchema from '../../schemas/device-profile.schema.json';

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

const validate = ajv.compile(profileSchema);

export interface DeviceProfileCapability {
  enabled: boolean;
  phase: string;
  description: string;
}

export interface DeviceProfileField {
  symbolicName: string;
  direction: 'PC_TO_LSN' | 'LSN_TO_PC';
  dataType: string;
  access: 'READ' | 'WRITE' | 'READ_WRITE';
  cipService?: string | null;
  class?: number | null;
  instance?: number | null;
  attribute?: number | null;
  assembly?: Record<string, unknown> | null;
  capability?: 'interlock' | 'remoteStop' | 'sensors';
  implementationStatus: 'TBD' | 'IMPLEMENTING' | 'TESTING' | 'IMPLEMENTED' | 'VERIFIED';
  simulationStatus: 'NOT_TESTED' | 'TESTING' | 'VERIFIED';
  description?: string;
  expectedFirmwareBehavior: string;
  expectedReportedResponse: string;
  notes?: string;
  units?: string;
  byte?: number;
  bit?: number;
  [key: string]: unknown;
}

export interface DeviceProfileDocument {
  $schema?: string;
  profileVersion: string;
  protocolVersion: string;
  displayName?: string;
  hardwareFamily: string;
  supportedFirmware?: string[];
  identity?: Record<string, unknown>;
  capabilities: Record<string, DeviceProfileCapability>;
  timing?: Record<string, unknown>;
  fields: DeviceProfileField[];
  faults?: unknown[];
  tests?: unknown[];
  modules?: unknown[];
  [key: string]: unknown;
}

export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
}

function formatError(error: ErrorObject): string {
  const location = error.instancePath || '/';
  return `${location} ${error.message ?? 'is invalid'}`;
}

export function validateDeviceProfile(value: unknown): ProfileValidationResult {
  const valid = validate(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : (validate.errors ?? []).map(formatError),
  };
}