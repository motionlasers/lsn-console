import JSZip from 'jszip';
import consolePackage from '../../package.json' with { type: 'json' };
import type {
  DeviceProfileDocument,
  DeviceProfileField,
} from './profile-validation';

export const FIRMWARE_PACKAGE_FORMAT_VERSION = '1.0';

export interface FirmwarePackageSummary {
  profileVersion: string;
  protocolVersion: string;
  activeFieldCount: number;
  mappedFieldCount: number;
  tbdFieldCount: number;
  firmwareStatuses: Record<string, number>;
  simulationStatuses: Record<string, number>;
}

export interface FirmwarePackageResult {
  blob: Blob;
  filename: string;
  folderName: string;
  summary: FirmwarePackageSummary;
  files: Record<string, string>;
}

export interface FirmwarePackageOptions {
  generatedAt?: Date;
  consoleVersion?: string;
  packageFormatVersion?: string;
}

type ActiveCapabilities = Record<string, boolean>;

const C_AND_CPP_RESERVED_WORDS = new Set([
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'atomic_bool', 'atomic_char',
  'atomic_int', 'atomic_long', 'atomic_uint', 'atomic_ulong', 'auto', 'bitand',
  'bitor', 'bool', 'break', 'case', 'catch', 'char', 'char16_t', 'char32_t',
  'class', 'compl', 'concept', 'const', 'const_cast', 'consteval', 'constexpr',
  'constinit', 'continue', 'co_await', 'co_return', 'co_yield', 'decltype',
  'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum', 'explicit',
  'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline',
  'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq',
  'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected', 'public',
  'register', 'reinterpret_cast', 'requires', 'return', 'short', 'signed',
  'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch',
  'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef',
  'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void',
  'volatile', 'wchar_t', 'while', 'xor', 'xor_eq', '_alignas', '_alignof',
  '_atomic', '_bool', '_complex', '_generic', '_imaginary', '_noreturn',
  '_static_assert', '_thread_local',
]);

function isTbd(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim().toUpperCase() === 'TBD');
}

function isResolvedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hasResolvedAssembly(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

export function isFirmwareMappingResolved(field: DeviceProfileField): boolean {
  if (isTbd(field.cipService)) return false;
  const explicitMapping = isResolvedInteger(field.class)
    && isResolvedInteger(field.instance)
    && isResolvedInteger(field.attribute);
  return explicitMapping || hasResolvedAssembly(field.assembly);
}

export function effectiveDocumentFirmwareStatus(field: DeviceProfileField): string {
  return isFirmwareMappingResolved(field) ? field.implementationStatus : 'TBD';
}

export function getActiveProfileFields(
  document: DeviceProfileDocument,
  capabilities: ActiveCapabilities,
): DeviceProfileField[] {
  return document.fields.filter(field => !field.capability || capabilities[field.capability] === true);
}

function countStatuses(fields: DeviceProfileField[], selector: (field: DeviceProfileField) => string): Record<string, number> {
  return fields.reduce<Record<string, number>>((counts, field) => {
    const status = selector(field);
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

export function summarizeFirmwarePackage(
  document: DeviceProfileDocument,
  capabilities: ActiveCapabilities,
): FirmwarePackageSummary {
  const activeFields = getActiveProfileFields(document, capabilities);
  const mappedFieldCount = activeFields.filter(isFirmwareMappingResolved).length;
  return {
    profileVersion: document.profileVersion,
    protocolVersion: document.protocolVersion,
    activeFieldCount: activeFields.length,
    mappedFieldCount,
    tbdFieldCount: activeFields.length - mappedFieldCount,
    firmwareStatuses: countStatuses(activeFields, effectiveDocumentFirmwareStatus),
    simulationStatuses: countStatuses(activeFields, field => field.simulationStatus),
  };
}

function canonicalMacroName(symbolicName: string): string {
  const normalized = symbolicName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (!normalized) throw new Error(`Cannot generate a C identifier for symbolic name "${symbolicName}".`);
  return /^[A-Z_]/.test(normalized) ? normalized : `FIELD_${normalized}`;
}

function canonicalFieldName(symbolicName: string): string {
  const normalized = symbolicName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!normalized) throw new Error(`Cannot generate a C identifier for symbolic name "${symbolicName}".`);
  const validStart = /^[a-z_]/.test(normalized) ? normalized : `field_${normalized}`;
  return C_AND_CPP_RESERVED_WORDS.has(validStart) ? `field_${validStart}` : validStart;
}

function cString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded = '';
  for (const byte of bytes) {
    if (byte === 0x22) encoded += '\\"';
    else if (byte === 0x5c) encoded += '\\\\';
    else if (byte === 0x0a) encoded += '\\n';
    else if (byte === 0x0d) encoded += '\\r';
    else if (byte === 0x09) encoded += '\\t';
    else if (byte >= 0x20 && byte <= 0x7e) encoded += String.fromCharCode(byte);
    else encoded += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return `"${encoded}"`;
}

function cCommentText(value: unknown): string {
  return Array.from(String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\/\*/g, '/ *')
    .replace(/\*\//g, '* /'))
    .map(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');
}

function validateGeneratedIdentifiers(fields: DeviceProfileField[]): void {
  const fieldNames = new Map<string, string>();
  const macroNames = new Map<string, string>();
  for (const field of fields) {
    const fieldName = canonicalFieldName(field.symbolicName);
    const macroName = canonicalMacroName(field.symbolicName);
    const existingField = fieldNames.get(fieldName);
    const existingMacro = macroNames.get(macroName);
    if (existingField && existingField !== field.symbolicName) {
      throw new Error(
        `Symbolic names "${existingField}" and "${field.symbolicName}" collide as generated C field "${fieldName}".`,
      );
    }
    if (existingMacro && existingMacro !== field.symbolicName) {
      throw new Error(
        `Symbolic names "${existingMacro}" and "${field.symbolicName}" collide as generated C macro "${macroName}".`,
      );
    }
    fieldNames.set(fieldName, field.symbolicName);
    macroNames.set(macroName, field.symbolicName);
  }
}

function scalarCType(field: DeviceProfileField): string | null {
  switch (field.dataType.toLowerCase()) {
    case 'boolean':
    case 'momentary-boolean':
      return 'bool';
    case 'uint8':
    case 'uint8_t':
      return 'uint8_t';
    case 'uint16':
    case 'uint16_t':
      return 'uint16_t';
    case 'uint32':
    case 'uint32_t':
      return 'uint32_t';
    case 'uint64':
    case 'uint64_t':
      return 'uint64_t';
    default:
      return null;
  }
}

function unresolvedTypeReason(field: DeviceProfileField): string {
  if (field.dataType.toLowerCase() === 'enum') {
    return 'enum values and storage width are not assigned in the Device Profile';
  }
  if (field.dataType.toLowerCase() === 'string') {
    return 'string encoding and maximum length are not assigned in the Device Profile';
  }
  return `portable C representation for profile type "${cCommentText(field.dataType)}" is not assigned`;
}

function renderStruct(
  name: string,
  fields: DeviceProfileField[],
): string {
  const lines: string[] = [];
  let resolvedCount = 0;
  for (const field of fields) {
    const cType = scalarCType(field);
    if (cType) {
      resolvedCount += 1;
      lines.push(`    ${cType} ${canonicalFieldName(field.symbolicName)}; /* Canonical: ${cCommentText(field.symbolicName)} */`);
    } else {
      lines.push(`    /* TBD: ${cCommentText(field.symbolicName)} omitted; ${unresolvedTypeReason(field)}. */`);
    }
  }
  if (resolvedCount === 0) {
    return [
      `/* ${name} is not declared because no field has a complete portable C representation.`,
      ...fields.map(field => ` * TBD: ${cCommentText(field.symbolicName)} — ${unresolvedTypeReason(field)}.`),
      ' */',
    ].join('\n');
  }
  return [
    'typedef struct {',
    ...lines,
    `} ${name};`,
  ].join('\n');
}

export function generateProtocolTypesHeader(
  document: DeviceProfileDocument,
  capabilities: ActiveCapabilities,
  metadata: { generatedAt: string; consoleVersion: string; packageFormatVersion: string },
): string {
  const fields = getActiveProfileFields(document, capabilities);
  validateGeneratedIdentifiers(fields);
  const controlFields = fields.filter(field => field.direction === 'PC_TO_LSN');
  const statusFields = fields.filter(field => field.direction === 'LSN_TO_PC');
  const unresolved = fields.filter(field => scalarCType(field) == null);
  return `/*
 * AUTO-GENERATED FROM THE ACTIVE LSN DEVICE PROFILE. DO NOT EDIT.
 * Device Profile: ${cCommentText(document.profileVersion)}
 * Protocol: ${cCommentText(document.protocolVersion)}
 * Console: ${cCommentText(metadata.consoleVersion)}
 * Package format: ${cCommentText(metadata.packageFormatVersion)}
 * Generated: ${cCommentText(metadata.generatedAt)}
 *
 * No enum values, string sizes, packing, or offsets are inferred.
 */
#ifndef LSN_PROTOCOL_TYPES_H
#define LSN_PROTOCOL_TYPES_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

${renderStruct('lsn_control_t', controlFields)}

${renderStruct('lsn_status_t', statusFields)}

${unresolved.length > 0 ? `/*
 * Unresolved logical types:
${unresolved.map(field => ` * - ${cCommentText(field.symbolicName)}: ${unresolvedTypeReason(field)}.`).join('\n')}
 * Add the missing definitions to the Device Profile, then regenerate this package.
 */` : '/* All active field types have portable C representations. */'}

#ifdef __cplusplus
}
#endif

#endif /* LSN_PROTOCOL_TYPES_H */
`;
}

function macroOrTbd(
  lines: string[],
  macro: string,
  value: unknown,
  label: string,
): void {
  if (isResolvedInteger(value)) {
    lines.push(`#define ${macro} UINT32_C(${value})`);
  } else {
    lines.push(`/* TBD: ${macro} not defined; ${label} is not assigned in the Device Profile. */`);
  }
}

export function generateProtocolHeader(
  document: DeviceProfileDocument,
  capabilities: ActiveCapabilities,
  metadata: { generatedAt: string; consoleVersion: string; packageFormatVersion: string },
): string {
  const fields = getActiveProfileFields(document, capabilities);
  validateGeneratedIdentifiers(fields);
  const lines = [
    '/*',
    ' * AUTO-GENERATED FROM THE ACTIVE LSN DEVICE PROFILE. DO NOT EDIT.',
    ` * Device Profile: ${cCommentText(document.profileVersion)}`,
    ` * Protocol: ${cCommentText(document.protocolVersion)}`,
    ` * Console: ${cCommentText(metadata.consoleVersion)}`,
    ` * Package format: ${cCommentText(metadata.packageFormatVersion)}`,
    ` * Generated: ${cCommentText(metadata.generatedAt)}`,
    ' *',
    ' * A missing #define is intentional: unresolved mappings cannot be used',
    ' * accidentally as production values.',
    ' */',
    '#ifndef LSN_PROTOCOL_H',
    '#define LSN_PROTOCOL_H',
    '',
    '#include <stdint.h>',
    '#include "lsn_protocol_types.h"',
    '',
    `#define LSN_DEVICE_PROFILE_VERSION ${cString(document.profileVersion)}`,
    `#define LSN_PROTOCOL_VERSION ${cString(document.protocolVersion)}`,
    `#define LSN_HARDWARE_FAMILY ${cString(document.hardwareFamily)}`,
  ];

  const identity = document.identity ?? {};
  lines.push('');
  macroOrTbd(lines, 'LSN_CIP_VENDOR_ID', identity.vendorId, 'Vendor ID');
  macroOrTbd(lines, 'LSN_CIP_DEVICE_TYPE', identity.deviceType, 'Device Type');
  macroOrTbd(lines, 'LSN_CIP_PRODUCT_CODE', identity.productCode, 'Product Code');

  for (const field of fields) {
    const prefix = `LSN_${canonicalMacroName(field.symbolicName)}`;
    lines.push('', `/* Canonical field: ${cCommentText(field.symbolicName)} */`);
    if (!isTbd(field.cipService)) {
      lines.push(`#define ${prefix}_CIP_SERVICE ${cString(String(field.cipService))}`);
    } else {
      lines.push(`/* TBD: ${prefix}_CIP_SERVICE not defined; CIP Service is not assigned. */`);
    }
    macroOrTbd(lines, `${prefix}_CIP_CLASS`, field.class, 'CIP Class');
    macroOrTbd(lines, `${prefix}_CIP_INSTANCE`, field.instance, 'CIP Instance');
    macroOrTbd(lines, `${prefix}_CIP_ATTRIBUTE`, field.attribute, 'CIP Attribute');
    if (hasResolvedAssembly(field.assembly)) {
      lines.push(`/* Assembly mapping (profile-defined JSON): ${cCommentText(JSON.stringify(field.assembly))} */`);
    } else {
      lines.push(`/* TBD: ${prefix}_ASSEMBLY not defined; Assembly mapping is not assigned. */`);
    }
  }

  lines.push('', '#endif /* LSN_PROTOCOL_H */', '');
  return lines.join('\n');
}

function csvCell(value: unknown): string {
  const text = String(value ?? 'TBD').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

function displayValue(value: unknown): string {
  if (isTbd(value)) return 'TBD';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function mappingText(field: DeviceProfileField): string {
  return [
    `Service=${displayValue(field.cipService)}`,
    `Class=${displayValue(field.class)}`,
    `Instance=${displayValue(field.instance)}`,
    `Attribute=${displayValue(field.attribute)}`,
    `Assembly=${displayValue(field.assembly)}`,
  ].join(', ');
}

export function generateInterfaceCsv(fields: DeviceProfileField[]): string {
  const headers = [
    'Symbolic Name', 'Direction', 'Data Type', 'Access', 'CIP Service',
    'Class', 'Instance', 'Attribute', 'Assembly', 'Byte', 'Bit', 'Units',
    'Firmware Status', 'Simulation Status', 'Expected Behavior',
    'Expected Response', 'Description', 'Notes',
  ];
  const rows = fields.map(field => [
    field.symbolicName,
    field.direction,
    field.dataType,
    field.access,
    displayValue(field.cipService),
    displayValue(field.class),
    displayValue(field.instance),
    displayValue(field.attribute),
    displayValue(field.assembly),
    displayValue(field.byte),
    displayValue(field.bit),
    displayValue(field.units),
    effectiveDocumentFirmwareStatus(field),
    field.simulationStatus,
    field.expectedFirmwareBehavior,
    field.expectedReportedResponse,
    typeof field.description === 'string' ? field.description : 'TBD',
    field.notes ?? '',
  ]);
  return [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
  ].join('\n');
}

export function generateInterfaceMarkdown(
  document: DeviceProfileDocument,
  fields: DeviceProfileField[],
  metadata: { generatedAt: string; consoleVersion: string; packageFormatVersion: string },
): string {
  const sections = fields.map(field => `## ${field.symbolicName}

**Purpose:** ${typeof field.description === 'string' ? field.description : 'TBD — canonical description not assigned in the Device Profile.'}

**Direction:** ${field.direction === 'PC_TO_LSN' ? 'PC → LSN' : 'LSN → PC'}  
**Type:** ${field.dataType}  
**Access:** ${field.access}  
**CIP Mapping:** ${mappingText(field)}  
**Firmware Status:** ${effectiveDocumentFirmwareStatus(field)}  
**Simulation Status:** ${field.simulationStatus}  
**Units:** ${displayValue(field.units)}  
**Byte / Bit:** ${displayValue(field.byte)} / ${displayValue(field.bit)}

**Expected Firmware Behavior:** ${field.expectedFirmwareBehavior}

**Expected Response:** ${field.expectedReportedResponse}

**Notes:** ${field.notes || 'None.'}
`).join('\n');

  return `# LSN Firmware Interface

Generated from Device Profile **${document.profileVersion}** / Protocol **${document.protocolVersion}**.

- Console version: ${metadata.consoleVersion}
- Package format: ${metadata.packageFormatVersion}
- Generated: ${metadata.generatedAt}
- Target platform: ${document.hardwareFamily}

> Simulation validation is test-harness evidence only. It does not imply firmware implementation or physical validation.
>
> Unresolved mappings, enum values, string layouts, units, and byte/bit positions are intentionally marked **TBD**.

${sections}`;
}

export function generatePackageReadme(
  document: DeviceProfileDocument,
  summary: FirmwarePackageSummary,
  metadata: { generatedAt: string; consoleVersion: string; packageFormatVersion: string },
): string {
  return `LSN Firmware Integration Package
================================

Generated from:
- Device Profile: ${document.profileVersion}
- Protocol: ${document.protocolVersion}
- Console: ${metadata.consoleVersion}
- Package format: ${metadata.packageFormatVersion}
- Generated: ${metadata.generatedAt}
- Target platform: ${document.hardwareFamily}
- Active interface fields: ${summary.activeFieldCount}
- Resolved mappings: ${summary.mappedFieldCount}
- TBD mappings: ${summary.tbdFieldCount}

Purpose
-------
This package provides the canonical external LSN communications interface for
ESP32 firmware implementation. The complete machine-readable source profile is
included as lsn_protocol_profile.json.

Recommended workflow
--------------------
1. Review lsn_interface.md.
2. Use the generated C/C++ headers where their profile-defined types are complete.
3. Implement the logical fields in ESP32 firmware.
4. Assign real EtherNet/IP/CIP mappings and missing enum/string/layout definitions for TBD entries.
5. Return those decisions for entry into the LSN Device Profile, then regenerate this package.
6. Use LSN Engineering Console Hardware Mode to test the physical implementation.

Important boundaries
--------------------
- The Device Profile is the source of truth for the external LSN interface.
- This package defines the external interface; it is not firmware.
- The ESP32 programmer remains responsible for implementation details.
- Existing daughterboard GPIO mapping remains firmware-internal.
- The current daughterboard hardware is established and must not be redesigned as part of this interface work.
- This package does not dictate the internal state-machine architecture.
- Unresolved CIP mappings must be assigned by the firmware engineer.
- Generated headers never silently invent protocol, enum, packing, or identity values.
- Canonical Device Profile names remain authoritative even when local C field names use snake_case.

Disabled future capabilities
----------------------------
The complete lsn_protocol_profile.json may contain disabled future capabilities
such as Interlock Monitoring and Remote Stop Monitoring. Fields associated with
disabled capabilities are not part of the active Phase 1 implementation. Use
lsn_interface.md, lsn_interface.csv, and the generated active C/C++ headers as
the Phase 1 implementation checklist.
`;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/^v/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'TBD';
}

function interfaceVersionToken(document: DeviceProfileDocument): string {
  const protocolMatch = document.protocolVersion.match(/\bv?(\d+\.\d+)\b/i);
  if (protocolMatch) return sanitizeFilenamePart(protocolMatch[1]);
  return sanitizeFilenamePart(document.profileVersion).replace(/\.0$/, '');
}

export async function createFirmwareIntegrationPackage(
  document: DeviceProfileDocument,
  capabilities: ActiveCapabilities,
  options: FirmwarePackageOptions = {},
): Promise<FirmwarePackageResult> {
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const metadata = {
    generatedAt,
    consoleVersion: options.consoleVersion ?? consolePackage.version,
    packageFormatVersion: options.packageFormatVersion ?? FIRMWARE_PACKAGE_FORMAT_VERSION,
  };
  const activeFields = getActiveProfileFields(document, capabilities);
  const summary = summarizeFirmwarePackage(document, capabilities);
  const folderName = `LSN-Firmware-Interface-v${interfaceVersionToken(document)}`;
  const filename = `${folderName}.zip`;
  const files: Record<string, string> = {
    'lsn_protocol.h': generateProtocolHeader(document, capabilities, metadata),
    'lsn_protocol_types.h': generateProtocolTypesHeader(document, capabilities, metadata),
    'lsn_protocol_profile.json': `${JSON.stringify(document, null, 2)}\n`,
    'lsn_interface.csv': generateInterfaceCsv(activeFields),
    'lsn_interface.md': generateInterfaceMarkdown(document, activeFields, metadata),
    'README.md': generatePackageReadme(document, summary, metadata),
  };

  const zip = new JSZip();
  const folder = zip.folder(folderName);
  if (!folder) throw new Error('Unable to create firmware package folder.');
  for (const [path, content] of Object.entries(files)) {
    folder.file(path, content);
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { blob, filename, folderName, summary, files };
}