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

Use the in-app **Firmware Interface** generated from the active Device Profile as the implementation checklist. Do not copy mappings into firmware until the corresponding profile values are finalized.