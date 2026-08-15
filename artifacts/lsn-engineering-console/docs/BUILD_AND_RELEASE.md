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

- `LSN-Engineering-Console-Setup-<version>-dev.exe` — Authenticode-signed Squirrel installer
- `LSN-Engineering-Console-Portable-<version>.zip` — optional portable ZIP
- `SHA256SUMS.txt` — checksums for both

Tagged builds publish these as GitHub release assets with release notes. The
Downloads page derives permanent URLs from the Console version's matching tag,
so a newer GitHub release cannot break links in an older deployed web build.
`VITE_LSN_RELEASE_BASE_URL` may override the version-neutral repository root
(ending in `/releases/download`); it must not contain a release tag. Legacy
tagged and `latest/download` values are normalized to that stable root.

The original v0.2.1 Development Preview remains an unsigned historical
release. New tagged builds fail before packaging unless the protected GitHub
secrets `WINDOWS_CERTIFICATE_PFX_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` are configured. CI verifies that the final
installer has a valid Authenticode signature from Saber Industrial
Applications before generating checksums or publishing any release asset.

## Packaged Windows updates

The packaged Windows app checks the repository's latest normal GitHub release
shortly after launch. A strictly newer stable Console version downloads in the
background, reports byte/percentage progress, and is offered with **Install
now** and **Later** actions. Update failures never block the installed app.

The updater accepts only the exact Setup filename and `SHA256SUMS.txt` asset
under the matching `lsn-console-v<version>` tag. Before offering installation,
it verifies both the published SHA-256 and a valid Windows Authenticode
signature whose subject contains `Saber Industrial Applications`. An unsigned
or differently signed installer is rejected and the current version continues
running. Therefore the current unsigned Development Preview assets are never
eligible for automatic installation.

The app launches the verified Squirrel `Setup.exe` without renderer-provided
arguments, paths, or URLs. Downloaded installers are kept in private per-user
app data so choosing **Later** remains available after restart.
