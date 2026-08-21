# Physical Hardware Acceptance

Operator checklist for validating a real WT32-ETH01 LSN controller against the
packaged Windows Console. Physical validation is **not yet claimed**: no
WT32-ETH01 is attached in this workspace, and no step below has been executed
against real hardware. Simulator and fake-endpoint evidence must never be
recorded here.

## Preconditions

- **Packaged Windows build only.** Raw UDP/TCP EtherNet/IP sockets exist solely
  in the Electron main process and only transmit when `app.isPackaged` and
  `process.platform === 'win32'`. A browser session is Simulation-only and can
  never open a socket.
- The bundled `profiles/lsn-v0.1.json` is loaded, deep-frozen, and pinned by the
  main process. Its identity and every field mapping are currently `TBD`.
- A WT32-ETH01 controller is on the same LAN segment, powered, and reachable by
  IPv4.
- The work area is safe and all personnel are clear of the emission-control
  output before any arm/enable step.

## Real-device readiness reality check

- Discovered identity is **Unverified**: `identity.vendorId/deviceType/
  productCode` in the profile are `null` (`mappingState: "TBD"`), so a
  ListIdentity response cannot be confirmed as *the* LSN controller.
- The main process directs ListIdentity to the exact requested TCP endpoint.
  Unresolved identity permits discovery/session diagnostics only; it blocks all
  symbolic reads and enable/disable writes. A resolved-but-mismatched identity
  rejects connection, and every disconnect/reconnect requires fresh identity
  verification.
- A successful RegisterSession establishes an EtherNet/IP session **only**. It
  does not validate control or telemetry semantics.
- Every field mapping (`cipService`, `class`, `instance`, `attribute`,
  `wireType`, `byteOrder`, `stringLength`, `enumMapping`) is `TBD`, so
  `readField`, `armControl`, and `writeEnable` all **fail closed** until a
  firmware engineer resolves the profile. Expect the readiness report to show
  `readReady: false` and `controlReady: false`.

Until the profile is resolved, only the transport-level steps (1–3) can pass on
real hardware; the mapping/read/enable steps will correctly refuse.

## Bench sequence

Record actual observed behavior, EtherNet/IP protocol evidence (frames/handles),
duration, and PASS/FAIL/WARNING for each numbered step.

1. **ListIdentity discovery.** Trigger discovery. Confirm a UDP ListIdentity
   (0x0063) is sent on port 44818 — LAN broadcast when no address is given, or
   strict manual IPv4 unicast when one is entered. Confirm the responder appears
   as a candidate with a decoded standard Identity Item. Record identity as
   **Unverified** (profile identity is TBD).
2. **Session establishment.** Connect to the controller's IPv4. Confirm a TCP
   connection on 44818 followed by RegisterSession (0x0065) returning a non-zero
   session handle and state `connected`. Note: session ≠ control/telemetry
   validation.
3. **Session teardown.** Disconnect. Confirm a best-effort UnRegisterSession
   (0x0066) and a clean return to `disconnected` with the handle cleared.
4. **Profile mapping gate.** Read the profile readiness report. Confirm it
   enumerates the exact blocking issues (unresolved CIP service/class/instance/
   attribute, wire encoding, implementation status) and that `readReady` and
   `controlReady` are `false` while the profile is TBD.
5. **Symbolic read validation** *(only after the profile is resolved)*. Read
   `Ready`, `Faulted`, `EmissionControlOutputActive`, and other telemetry
   fields. Confirm decoded values match the resolved `wireType`/`byteOrder`/
   `stringLength`/`enumMapping`, and that an unresolved field refuses instead of
   guessing.
6. **Guarded enable** *(only after the profile is resolved)*. Arm control:
   confirm the native confirmation dialog appears and only an explicit operator
   confirmation mints the one-shot token (≈30 s TTL). Then request enable and
   confirm the fresh preflight (`Ready=true`, `Faulted=false`,
   `OutputActive=false`, plus any enabled safety fields), exactly one
   `EmissionEnableRequest=true` write, and a `EmissionControlOutputActive`
   readback. Confirm no auto-retry and no auto-enable.
7. **Guarded disable.** With the session connected and mapping resolved, request
   disable. Confirm it proceeds without arm/preflight, writes
   `EmissionEnableRequest=false`, and reads back
   `EmissionControlOutputActive`.
8. **Network-loss fail-safe.** Physically remove the network link (or power the
   controller's link down) mid-session. Confirm the Console reports
   `disconnected`, clears any arm token, and does not auto-reconnect or
   auto-enable. Independently confirm the controller's own watchdog/fail-safe
   behavior on the bench.
9. **Reconnect.** Restore the link, rediscover, and re-establish a session.
   Confirm a fresh session handle and that control requires a new arm.
10. **Evidence collection.** Save discovery output, session handles, readiness
    report, read values, enable/disable readbacks, and network-loss observations
    as physical acceptance evidence. Mark each step PASS/FAIL/WARNING with the
    operator's name and date.

## Sign-off

Physical acceptance is complete only when steps 1–10 pass against a real
WT32-ETH01 with a resolved profile, and the evidence is attached. This document
must not be marked complete using simulator or fake-endpoint results.
