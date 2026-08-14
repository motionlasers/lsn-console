import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import profileSchema from '../../schemas/device-profile.schema.json';

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

const validate = ajv.compile(profileSchema);

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