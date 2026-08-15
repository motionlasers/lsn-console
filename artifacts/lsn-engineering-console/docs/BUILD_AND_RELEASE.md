# Build and Release

## Web simulation

Run the managed Replit workflow for `@workspace/lsn-engineering-console`.

## Release identity

`src/lib/release.ts` is the single in-app source of truth for Console release
metadata (version, label, date, protocol/Device Profile impact, Windows
artifact names). `CHANGELOG.md` is the canonical human-readable release
history; `tests/release.test.ts` keeps package.json, the changelog, the Forge
config, and the shared release module in lockstep and fails on drift.

The Console version moves independently of the external interface tracks:
LSN Protocol (v0.1), Device Profile (lsn-v0.1.0), and the generated
`LSN-Firmware-Interface-v0.1.zip` package.

## Desktop

The Electron main process owns all future TCP/UDP and maintenance networking,
the filesystem, and native save dialogs. The renderer has no Node integration
and accesses only the narrow allowlisted preload API (`window.lsnDesktop`).
Packaged authentication and user-administration requests are also sent through
that bridge to the published HTTPS API at `https://lsn.saberindustrial.net`.
`LSN_API_BASE_URL` may override that origin at desktop runtime, but packaged
builds reject non-HTTPS origins.

Windows builds are produced by `.github/workflows/lsn-console-windows.yml`,
triggered manually or by pushing a `lsn-console-vX.Y.Z` tag (the tag must match
the package version; CI enforces this). Release artifacts:

- `LSN-Engineering-Console-Setup-<version>-dev.exe` — unsigned Squirrel installer
- `LSN-Engineering-Console-Portable-<version>.zip` — optional portable ZIP
- `SHA256SUMS.txt` — checksums for both

Tagged builds publish these as GitHub release assets with release notes. To
surface direct download buttons on the Downloads page, set
`VITE_LSN_RELEASE_BASE_URL` at build time to the stable release-asset base URL.

Builds are unsigned Development Previews: Microsoft Defender SmartScreen warns
on first run ("More info" → "Run anyway"). They are for internal development
only and must not be represented as production installers.
