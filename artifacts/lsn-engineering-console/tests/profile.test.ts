import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { generateMarkdownProfile } from '../src/lib/exports';
import { validateDeviceProfile } from '../src/lib/profile-validation';
import { effectiveFirmwareStatus } from '../src/lib/store';
import {
  createFirmwareIntegrationPackage,
  effectiveDocumentFirmwareStatus,
  summarizeFirmwarePackage,
} from '../src/lib/firmware-package';
import type { DeviceProfileDocument } from '../src/lib/profile-validation';

const profile = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../profiles/lsn-v0.1.json'), 'utf8'),
) as DeviceProfileDocument;

const capabilities = Object.fromEntries(
  Object.entries(profile.capabilities).map(([key, capability]) => [key, capability.enabled]),
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

  it('defines a canonical description for every active Phase 1 field', () => {
    const activeFields = profile.fields.filter(field => !field.capability || capabilities[field.capability]);
    expect(activeFields).toHaveLength(15);
    for (const field of activeFields) {
      expect(field.description, `${field.symbolicName} description`).toBeTypeOf('string');
      expect(field.description.trim(), `${field.symbolicName} description`).not.toBe('');
      expect(field.description, `${field.symbolicName} description must be distinct from expected response`)
        .not.toBe(field.expectedReportedResponse);
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

  it('summarizes only the active interface without upgrading firmware status', () => {
    const summary = summarizeFirmwarePackage(profile, capabilities);
    expect(summary.profileVersion).toBe('0.1.0');
    expect(summary.protocolVersion).toBe('LSN v0.1');
    expect(summary.activeFieldCount).toBe(
      profile.fields.filter(field => !field.capability || capabilities[field.capability]).length,
    );
    expect(summary.mappedFieldCount).toBe(0);
    expect(summary.tbdFieldCount).toBe(summary.activeFieldCount);
    expect(summary.firmwareStatuses).toEqual({ TBD: summary.activeFieldCount });
    expect(summary.simulationStatuses.VERIFIED).toBeGreaterThan(0);

    const stale = { ...profile.fields[0], implementationStatus: 'VERIFIED' as const };
    expect(effectiveDocumentFirmwareStatus(stale)).toBe('TBD');
  });

  it('builds the complete six-file firmware integration ZIP without invented values', async () => {
    const result = await createFirmwareIntegrationPackage(profile, capabilities, {
      generatedAt: new Date('2026-08-14T12:00:00.000Z'),
      consoleVersion: '0.1.0-test',
    });
    expect(result.filename).toBe('LSN-Firmware-Interface-v0.1.zip');
    expect(result.folderName).toBe('LSN-Firmware-Interface-v0.1');
    expect(result.summary.mappedFieldCount).toBe(0);

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const expectedFiles = [
      'README.md',
      'lsn_interface.csv',
      'lsn_interface.md',
      'lsn_protocol.h',
      'lsn_protocol_profile.json',
      'lsn_protocol_types.h',
    ];
    const actualFiles = Object.keys(zip.files)
      .filter(path => !zip.files[path].dir)
      .map(path => path.slice(`${result.folderName}/`.length))
      .sort();
    expect(actualFiles).toEqual(expectedFiles);

    const readEntry = async (name: string) => {
      const entry = zip.file(`${result.folderName}/${name}`);
      expect(entry, `${name} should exist`).not.toBeNull();
      return entry!.async('string');
    };
    const exportedProfile = JSON.parse(await readEntry('lsn_protocol_profile.json'));
    expect(exportedProfile).toEqual(profile);
    expect(exportedProfile.faults).toEqual(profile.faults);
    expect(exportedProfile.tests).toEqual(profile.tests);
    expect(exportedProfile.modules).toEqual(profile.modules);

    const protocolHeader = await readEntry('lsn_protocol.h');
    expect(protocolHeader).toContain('LSN_DEVICE_PROFILE_VERSION "0.1.0"');
    expect(protocolHeader).toContain('TBD: LSN_READY_CIP_CLASS not defined');
    expect(protocolHeader).not.toMatch(/^#define LSN_READY_CIP_CLASS /m);
    expect(protocolHeader).not.toMatch(/^#define LSN_CIP_VENDOR_ID /m);
    expect(protocolHeader).not.toMatch(/^#define LSN_CIP_PRODUCT_CODE /m);

    const typesHeader = await readEntry('lsn_protocol_types.h');
    expect(typesHeader).toContain('bool emission_enable_request; /* Canonical: EmissionEnableRequest */');
    expect(typesHeader).toContain('uint16_t fault_code; /* Canonical: FaultCode */');
    expect(typesHeader).toContain('uint64_t lifetime_emission_time_ms; /* Canonical: LifetimeEmissionTimeMs */');
    expect(typesHeader).toContain('TBD: TimerState omitted; enum values and storage width');
    expect(typesHeader).not.toContain('LSN_TIMER_COUNTING =');

    const csv = await readEntry('lsn_interface.csv');
    expect(csv).toContain('"Byte","Bit","Units"');
    expect(csv).toContain('"Firmware Status","Simulation Status"');
    expect(csv).toContain('"EmissionEnableRequest"');
    expect(csv).toContain('"Requests activation or deactivation of the LSN emission-control function."');
    expect(csv).toContain("\"Canonical logical device-identity field. Final representation and mapping remain TBD pending the firmware engineer's CIP Identity Object implementation.\"");
    expect(csv).not.toContain('"InterlockOK"');
    expect(csv).not.toContain('"RemoteStopOK"');

    const markdown = await readEntry('lsn_interface.md');
    expect(markdown).toContain('## LifetimeEmissionTimeMs');
    expect(markdown).toContain('**Firmware Status:** TBD');
    expect(markdown).toContain('**Purpose:** Requests activation or deactivation of the LSN emission-control function.');
    expect(markdown).toContain('**Expected Response:** Requested state is acknowledged; reported and hardware-control states remain independently readable.');
    expect(markdown).toContain('Simulation validation is test-harness evidence only');
    expect(markdown).not.toContain('## InterlockOK');

    const readme = await readEntry('README.md');
    expect(readme).toContain('Device Profile: 0.1.0');
    expect(readme).toContain('Protocol: LSN v0.1');
    expect(readme).toContain('Console: 0.1.0-test');
    expect(readme).toContain('Generated: 2026-08-14T12:00:00.000Z');
    expect(readme).toContain('Target platform: WT32-ETH01');
    expect(readme).toContain('never silently invent');
    expect(readme).toContain('Device Profile is the source of truth');
    expect(readme).toContain('Hardware Mode to test the physical implementation');
    expect(readme).toContain('daughterboard hardware is established');
    expect(readme).toContain('disabled future capabilities');
    expect(readme).toContain('not part of the active Phase 1 implementation');
  });

  it('emits constants only after mappings are explicitly resolved in the profile', async () => {
    const resolvedProfile = structuredClone(profile);
    const ready = resolvedProfile.fields.find(field => field.symbolicName === 'Ready')!;
    ready.cipService = 'Get_Attribute_Single';
    ready.class = 4;
    ready.instance = 100;
    ready.attribute = 3;
    ready.implementationStatus = 'IMPLEMENTED';

    const result = await createFirmwareIntegrationPackage(resolvedProfile, capabilities, {
      generatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });
    expect(result.files['lsn_protocol.h']).toContain('#define LSN_READY_CIP_SERVICE "Get_Attribute_Single"');
    expect(result.files['lsn_protocol.h']).toContain('#define LSN_READY_CIP_CLASS UINT32_C(4)');
    expect(result.files['lsn_protocol.h']).toContain('#define LSN_READY_CIP_INSTANCE UINT32_C(100)');
    expect(result.files['lsn_protocol.h']).toContain('#define LSN_READY_CIP_ATTRIBUTE UINT32_C(3)');
    expect(result.files['lsn_interface.csv']).toContain('"IMPLEMENTED"');
  });

  it('generates headers that compile as portable C11 and C++17', async () => {
    const result = await createFirmwareIntegrationPackage(profile, capabilities, {
      generatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });
    const directory = mkdtempSync(resolve(tmpdir(), 'lsn-firmware-package-'));
    try {
      writeFileSync(resolve(directory, 'lsn_protocol.h'), result.files['lsn_protocol.h']);
      writeFileSync(resolve(directory, 'lsn_protocol_types.h'), result.files['lsn_protocol_types.h']);
      writeFileSync(resolve(directory, 'compile.c'), [
        '#include "lsn_protocol.h"',
        'int main(void) {',
        '  lsn_control_t control = {0};',
        '  lsn_status_t status = {0};',
        '  return (control.emission_enable_request || status.ready) ? 0 : 0;',
        '}',
      ].join('\n'));
      writeFileSync(resolve(directory, 'compile.cpp'), [
        '#include "lsn_protocol.h"',
        'int main() {',
        '  lsn_control_t control{};',
        '  lsn_status_t status{};',
        '  return (control.emission_enable_request || status.ready) ? 0 : 0;',
        '}',
      ].join('\n'));

      const cResult = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-c', 'compile.c'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(cResult.status, cResult.stderr).toBe(0);
      const cppResult = spawnSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-c', 'compile.cpp'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(cppResult.status, cppResult.stderr).toBe(0);

      const hostileProfile = structuredClone(profile);
      hostileProfile.profileVersion = '0.1\r\u0000hostile';
      hostileProfile.protocolVersion = 'LSN\tv0.1';
      hostileProfile.hardwareFamily = 'WT32\u0001ETH01';
      const ready = hostileProfile.fields.find(field => field.symbolicName === 'Ready')!;
      ready.symbolicName = 'Class';
      ready.cipService = 'Get\r\u0000Attribute';
      const hostile = await createFirmwareIntegrationPackage(hostileProfile, capabilities, {
        generatedAt: new Date('2026-08-14T12:00:00.000Z'),
      });
      expect(hostile.files['lsn_protocol_types.h']).toContain('bool field_class; /* Canonical: Class */');
      expect(hostile.files['lsn_protocol.h']).toContain('"0.1\\r\\000hostile"');
      expect(hostile.files['lsn_protocol.h']).toContain('"Get\\r\\000Attribute"');
      writeFileSync(resolve(directory, 'lsn_protocol.h'), hostile.files['lsn_protocol.h']);
      writeFileSync(resolve(directory, 'lsn_protocol_types.h'), hostile.files['lsn_protocol_types.h']);
      writeFileSync(resolve(directory, 'hostile.c'), [
        '#include "lsn_protocol.h"',
        'int main(void) { lsn_status_t status = {0}; return status.field_class ? 0 : 0; }',
      ].join('\n'));
      writeFileSync(resolve(directory, 'hostile.cpp'), [
        '#include "lsn_protocol.h"',
        'int main() { lsn_status_t status{}; return status.field_class ? 0 : 0; }',
      ].join('\n'));
      const hostileC = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-c', 'hostile.c'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(hostileC.status, hostileC.stderr).toBe(0);
      const hostileCpp = spawnSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-c', 'hostile.cpp'], {
        cwd: directory,
        encoding: 'utf8',
      });
      expect(hostileCpp.status, hostileCpp.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000); // Windows CI runners invoke cc/c++ slowly; give them 30 s

  it('escapes profile-controlled comments and rejects generated identifier collisions', async () => {
    const adversarial = structuredClone(profile);
    adversarial.fields[0].symbolicName = '123Request*/\n#define LSN_INJECTED 1\n/*';
    adversarial.fields[0].dataType = 'boolean*/\n#error injected\n/*';
    const safe = await createFirmwareIntegrationPackage(adversarial, capabilities, {
      generatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });
    expect(safe.files['lsn_protocol.h']).not.toMatch(/^#define LSN_INJECTED 1$/m);
    expect(safe.files['lsn_protocol_types.h']).not.toMatch(/^#error injected$/m);
    expect(safe.files['lsn_protocol.h']).toContain('Canonical field: 123Request* /');

    const colliding = structuredClone(profile);
    colliding.fields[0].symbolicName = 'Duplicate-Name';
    colliding.fields[1].symbolicName = 'Duplicate_Name';
    await expect(
      createFirmwareIntegrationPackage(colliding, capabilities, {
        generatedAt: new Date('2026-08-14T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/collide as generated C/);
  });
});