# Test Plan

Tests are grouped into Communications, Control, Runtime, Faults, Network Loss, Firmware Update, and Module Loading.

Automated results record expected behavior, actual behavior, duration, protocol evidence, and PASS/FAIL/WARNING. Guided tests separately record engineer-observed physical behavior. Simulator results are never represented as physical validation.

The validation suite covers discovery, identity, session establishment, default disabled state, enable/disable feedback, blocking conditions, counter monotonicity, persistence, faults, reconnect, firmware compatibility, transfer/reboot/rediscovery, post-update validation, and rollback.

## Physical EtherNet/IP transport

The physical transport lives entirely in the Electron main process. Raw UDP/TCP
sockets exist only in a **packaged Windows** runtime (`app.isPackaged` and
`process.platform === 'win32'`); a browser session is Simulation-only and can
never open a socket. The transport implements only standard EtherNet/IP
encapsulation: UDP `ListIdentity` (0x0063) on port 44818 — LAN broadcast by
default or strict manual IPv4 unicast — and TCP `RegisterSession` (0x0065),
`SendRRData` (0x006F), and `UnRegisterSession` (0x0066) on 44818. The renderer
supplies only an optional validated IPv4 probe target and symbolic field names;
it never sets a host/port, touches raw sockets, or supplies a CIP
service/EPATH/raw bytes/profile.

Identity and mapping trust boundaries:

- Discovered identity is **Unverified**. Profile identity (`vendorId`,
  `deviceType`, `productCode`) is `TBD`, so a ListIdentity response cannot be
  confirmed as the LSN controller.
- A successful RegisterSession establishes a session **only**; it is not proof
  of control or telemetry validation.
- Every field mapping is `TBD`, so mapped reads, arm, and enable **fail closed**
  with precise blocking issues.

### Automated (fake-endpoint) coverage

`tests/ethernet-ip-transport.test.ts` exercises the transport against local
fake UDP/TCP endpoints via injectable `udpFactory`/`tcpFactory`, with no
Electron and no real hardware. It covers: strict IPv4 validation; 24-byte
encapsulation round-trip and rejection of length mismatch/short buffers;
ListIdentity discovery with de-duplication, manual unicast probe, invalid probe
rejection, silent-timeout, and malformed-packet rejection that does not abort
the scan; RegisterSession handshake including zero-handle rejection and clean
disconnect/reconnect; request timeout and socket-close both returning to
`disconnected` without stale connected state; validated `SendRRData` explicit
messaging with CPF framing, empty/oversized/zero-handle rejection, and reply
parsing. `tests/electron-security.test.ts` asserts the renderer isolation
boundary (no raw sockets or host/port in preload; profile pinned in main).

Fake-endpoint and simulator results are **automated coverage only** and are
never represented as physical validation.

### Failure behavior

- **Malformed packet** — discovery rejects the frame silently and continues the
  scan; session-layer parse failures reject the in-flight request.
- **Timeout** — bounded discovery timeout returns collected candidates; a
  RegisterSession/SendRRData request timeout tears the session down to
  `disconnected`.
- **Socket loss** — socket `error`/`close` resets to `disconnected`, clears the
  session handle and any arm token; connected state is never stale.
- **Identity uncertainty** — identity stays Unverified against the TBD profile.
- **Arm expiry** — the one-shot arm token (≈30 s TTL) is single-use and consumed
  on the next enable attempt regardless of validity; an expired/absent token
  refuses enable.
- **Failed preflight** — enable aborts before any write when
  `Ready≠true`, `Faulted≠false`, `OutputActive≠false`, or an enabled safety
  field is not satisfied.
- **Deterministic teardown** — disconnect/close performs a best-effort
  UnRegisterSession, destroys the socket, clears the arm, and broadcasts state;
  window-close and before-quit both invoke transport shutdown.

### Real-device acceptance

Physical validation is **not yet claimed**: no WT32-ETH01 is attached in this
workspace and no step has run against real hardware. The operator checklist and
exact bench sequence (ListIdentity → session → profile mapping gate → read
validation → guarded enable/disable → network-loss fail-safe → reconnect →
evidence collection) live in `PHYSICAL_HARDWARE_ACCEPTANCE.md`.