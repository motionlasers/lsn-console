# Source Inspection Findings

## Confirmed architecture

- The canonical roles are Superadmin, Firmware Admin, and Client Reviewer.
- Profile lifecycle data is persisted in dedicated Draft, immutable version, review, comment, decision, publication, validation, sandbox, and audit tables.
- Review snapshots and publications bind to immutable digests.
- Client sandboxes are owner-scoped and cannot mutate the shared Draft.
- The desktop channel serves the active immutable Development publication.
- Electron owns staging, verification, activation, persistence, rollback, diff, and local audit behavior.
- Hardware mapping consumption is designed to repin runtime configuration after explicit profile activation.

## Terminology and firmware boundary

This verification uses **hardware control integrity and recovery** terminology. It makes no safety-rated claim.

Publishing a Device Profile changes the Console/Electron runtime configuration channel. It does **not** rewrite ESP32/WT32 firmware. Firmware changes remain a separate firmware-team process.

## Remaining evidence gaps

- No current installed Windows workflow artifact exists.
- No physical ESP32/WT32 device was connected.
- The runtime hardware validation record in this package is explicitly a simulated governance fixture, not bench evidence.
- Server-side profile audit and local Electron apply audit are separate; only server-side audit was exercised live in this run.
- The post-merge script succeeds through `bash` but is not marked executable.