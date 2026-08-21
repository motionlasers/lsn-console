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

- `LSN-Engineering-Console-Setup-<version>-dev.exe` — signed when a certificate is configured, otherwise unsigned
- `LSN-Engineering-Console-Portable-<version>.zip` — optional portable ZIP
- `SHA256SUMS.txt` — checksums for both

Tagged builds publish these as GitHub release assets with release notes. The
Downloads page derives permanent URLs from the Console version's matching tag,
so a newer GitHub release cannot break links in an older deployed web build.
`VITE_LSN_RELEASE_BASE_URL` may override the version-neutral repository root
(ending in `/releases/download`); it must not contain a release tag. Legacy
tagged and `latest/download` values are normalized to that stable root.

Every Windows workflow build now installs the generated Squirrel package,
launches the installed executable through Playwright, verifies the packaged
preload/login/update/hardware boundaries, captures a login screenshot and JSON
evidence, uninstalls it, then repeats the smoke test after a clean reinstall.
The retained `LSN-Engineering-Console-Windows-Smoke-Evidence` workflow artifact
is the Windows installation proof; Linux packaging is not equivalent evidence.

The protected GitHub secrets `WINDOWS_CERTIFICATE_PFX_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` are optional but must be configured together.
When present, CI signs the installer and verifies the Saber Industrial
Applications publisher. When absent, CI publishes an explicitly unsigned
Development Preview and its release notes explain the expected Windows
SmartScreen **More info → Run anyway** steps.

## Packaged Windows updates

The packaged Windows app checks the repository's latest normal GitHub release
shortly after launch. A strictly newer stable Console version downloads in the
background, reports byte/percentage progress, and is offered with **Install
now** and **Later** actions. Update failures never block the installed app.

The updater accepts only the exact Setup filename and `SHA256SUMS.txt` asset
under the matching `lsn-console-v<version>` tag. Before offering installation,
it always verifies the published SHA-256. A truly unsigned Development Preview
is eligible after the consent prompt clearly explains the expected Windows
SmartScreen warning. A signed installer is eligible only when Authenticode is
valid and its subject contains `Saber Industrial Applications`; a broken
signature or a valid signature from another publisher is rejected.
Immediately before launching an unsigned installer, the app fetches the exact
immutable release tag's checksum manifest again and compares it with the
cached file. This prevents altered local update metadata from authorizing a
replacement unsigned executable after a restart.

The app launches the verified Squirrel `Setup.exe` without renderer-provided
arguments, paths, or URLs. Downloaded installers are kept in private per-user
app data so choosing **Later** remains available after restart.
