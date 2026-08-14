import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMarkdownProfile } from '../src/lib/exports';
import { validateDeviceProfile } from '../src/lib/profile-validation';
import { effectiveFirmwareStatus } from '../src/lib/store';

const profile = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../profiles/lsn-v0.1.json'), 'utf8'),
);

describe('LSN v0.1 device profile', () => {
  it('keeps every unresolved CIP mapping explicitly TBD or null', () => {
    for (const field of profile.fields) {
      expect(field.cipService).toBe('TBD');
      expect(field.class).toBeNull();
      expect(field.instance).toBeNull();
      expect(field.attribute).toBeNull();
      expect(field.assembly).toBeNull();
    }
  });

  it('contains the required independent request and reported output fields', () => {
    const names = profile.fields.map((field: { symbolicName: string }) => field.symbolicName);
    expect(names).toContain('EmissionEnableRequest');
    expect(names).toContain('EmissionControlOutputActive');
    expect(names).toContain('LifetimeEmissionTimeMs');
    expect(names).toContain('EnableCount');
  });

  it('separates firmware implementation from simulation validation', () => {
    for (const field of profile.fields) {
      expect(field.implementationStatus).toBe('TBD');
      expect(['NOT_TESTED', 'TESTING', 'VERIFIED']).toContain(field.simulationStatus);
    }
  });

  it('describes the Phase 1 output without future Interlock terminology', () => {
    const output = profile.fields.find((field: { symbolicName: string }) =>
      field.symbolicName === 'EmissionControlOutputActive',
    );
    expect(output.expectedFirmwareBehavior).toBe(
      'Report the current state of the LSN emission-control hardware output.',
    );
    expect(output.expectedFirmwareBehavior.toLowerCase()).not.toContain('interlock');
  });

  it('never presents cached implementation success while protocol mapping is unresolved', () => {
    const staleCachedField = {
      ...profile.fields[0],
      id: 'cached',
      class: 'TBD',
      instance: 'TBD',
      attribute: 'TBD',
      assembly: 'TBD',
      implementationStatus: 'VERIFIED',
    };
    expect(effectiveFirmwareStatus(staleCachedField)).toBe('TBD');
    expect(generateMarkdownProfile([staleCachedField])).toContain('| TBD |');
  });

  it('generates a firmware-facing specification with behavior and response columns', () => {
    const activeFields = profile.fields.filter((field: { capability?: string }) =>
      !field.capability || profile.capabilities[field.capability].enabled,
    );
    const markdown = generateMarkdownProfile(activeFields);
    expect(markdown).toContain('Expected Firmware Behavior');
    expect(markdown).toContain('Expected Reported Response');
    expect(markdown).toContain('Firmware Status');
    expect(markdown).toContain('Simulation Status');
    expect(markdown).toContain('does not imply firmware implementation');
    expect(markdown).toContain('EmissionEnableRequest');
    expect(markdown).toContain('TBD');
    expect(markdown).not.toContain('InterlockOK');
    expect(markdown).not.toContain('RemoteStopOK');
  });

  it('validates imports against the shipped JSON Schema', () => {
    expect(validateDeviceProfile(profile)).toEqual({ valid: true, errors: [] });
    const invalid = { ...profile };
    delete invalid.protocolVersion;
    const result = validateDeviceProfile(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('protocolVersion');
  });
});