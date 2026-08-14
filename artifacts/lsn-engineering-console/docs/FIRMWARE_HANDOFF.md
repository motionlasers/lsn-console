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