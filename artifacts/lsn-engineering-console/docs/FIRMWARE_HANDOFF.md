# Firmware Handoff

The Console defines and tests a logical LSN interface. Firmware owns the state machine and mapping from those logical functions to the established daughterboard.

## Bring-up order

1. Initialize WT32-ETH01 Ethernet and ListIdentity discovery.
2. Expose identity and a basic explicit CIP read.
3. Implement `Ready`, disable, enable request, and output-state feedback.
4. Add `TimerState`, `LifetimeEmissionTimeMs`, persistence, and `EnableCount`.
5. Add `Faulted`, `FaultCode`, connection-loss behavior, and reconnect.
6. Add the separate local firmware-maintenance endpoint.
7. Add OTA validation, acceptance, and rollback.

Use the in-app **Firmware Interface** generated from the active Device Profile as the implementation checklist. The **Firmware Status** column tracks real WT32-ETH01 implementation only; the separate **Simulation Status** column records simulator/test-harness coverage and must not be treated as firmware or hardware validation. Do not copy mappings into firmware until the corresponding profile values are finalized.

## Firmware Integration Package

Use **Device Profile → EXPORT FIRMWARE INTEGRATION PACKAGE** to create the current firmware handoff ZIP. Review the pre-export summary, then download the package even when mappings remain unresolved; those entries are intentionally marked `TBD`.

The package contains:

- Portable C/C++ headers for profile-defined logical types and resolved CIP mappings.
- The complete active Device Profile JSON as the machine-readable source of truth.
- CSV and Markdown implementation checklists for the currently enabled interface.
- A practical README with versions, target platform, regeneration steps, and implementation boundaries.

Regenerate the package whenever the Device Profile changes. Do not manually maintain a second interface definition. Missing CIP values, enum values, string sizes/encodings, byte/bit packing, endianness, and identity values must be selected by the firmware engineer and entered back into the Device Profile before another export.

The package defines the external LSN interface only. It does not modify firmware source, assign daughterboard GPIOs, dictate the internal state-machine architecture, or treat simulation evidence as firmware or physical validation.

## Physical transport the firmware must answer to

The packaged Windows Console main process now owns a standard EtherNet/IP
transport (UDP `ListIdentity` and TCP `RegisterSession`/`SendRRData`/
`UnRegisterSession` on port 44818). It carries generic unconnected explicit CIP
messaging with **no** built-in object/class/attribute assumptions and **no**
value encoding — the main-process profile layer supplies the CIP request bytes
entirely from the pinned Device Profile. Because the profile is all-`TBD`, the
Console cannot map, read, arm, or enable anything on real hardware yet; it fails
closed with precise blocking issues. Firmware bring-up unblocks these operations
only by resolving the profile values below.

## Resolving values without guessing

The Console never invents CIP values, wire formats, identity, or safety
semantics. The firmware engineer resolves each of the following and enters it
back into `profiles/lsn-v0.1.json`, then re-exports the integration package:

- **Identity.** Set `identity.vendorId`, `deviceType`, `productCode`, and change
  `mappingState` from `TBD`. Until then, discovered identity is **Unverified**:
  a ListIdentity response and a successful session cannot be confirmed as the
  LSN controller. The main process performs a directed ListIdentity check for
  the exact TCP endpoint before RegisterSession, binds the observed identity to
  that session, and compares all three IDs with the pinned profile. Unresolved
  identity blocks all symbolic telemetry and every enable/disable write;
  mismatched identity rejects the connection. Disconnect, socket loss, timeout,
  or reconnect clears the binding and requires fresh verification.
- **CIP addressing per field.** Assign an explicit `cipService`
  (GetAttributeSingle for reads, SetAttributeSingle for writes), `class`,
  `instance`, and `attribute`. Reads must map a read service to an `LSN_TO_PC`
  field; writes a write service to a `PC_TO_LSN` field. Set
  `implementationStatus` to `IMPLEMENTED`/`VERIFIED` to make the field
  resolvable.
- **Wire encoding per field.** Assign `wireType` (`bool8`, `uint16`, `uint32`,
  `uint64`, `string`, or `enum`). Multi-byte scalars and enums require an
  explicit `byteOrder` (`little`/`big`); `string` requires a fixed
  `stringLength` in bytes (fixed UTF-8, NUL-trimmed); `enum` requires an
  explicit `enumMapping` of symbol→code (no duplicate codes) and, for widths
  >1, a `byteOrder`.
- **Safety, watchdog, and ownership semantics.** Define the meaning and numeric
  codes for `Faulted`/`FaultCode`, the `InterlockOK`/`RemoteStopOK` safety
  fields (only enforced when their capability is enabled), `NetworkControlActive`
  ownership policy, and the connection-loss/watchdog fail-safe behavior. The
  Console reads these but never assumes their semantics.

## Guarded enable/disable contract

Once the enable workflow is fully resolved, the Console's guarded enable is:
resolved profile → connected session → an explicit **native** operator
confirmation that arms a **one-shot ~30 s** token → a fresh main-owned preflight
(`Ready=true`, `Faulted=false`, `EmissionControlOutputActive=false`, plus any
enabled safety fields) → exactly one `EmissionEnableRequest=true` write → a
`EmissionControlOutputActive` readback. There is no auto-retry and no
auto-enable. Disable remains available while connected with a resolved mapping,
bypassing arm/preflight, and also reads back the output. Socket loss clears the
arm token. Firmware must make these guard reads and the enable request behave
per the profile so the workflow is safe.

## Physical acceptance

Automated coverage uses local fake UDP/TCP endpoints only (see
`TEST_PLAN.md`); it is not physical validation. Physical validation is **not
yet claimed** because no WT32-ETH01 is attached in this workspace. The operator
bench sequence and sign-off checklist are in
`PHYSICAL_HARDWARE_ACCEPTANCE.md`.