# Changelog

Canonical reverse-chronological release history for the **LSN Engineering Console**.

The Console is versioned independently from the external interface tracks, which
are unchanged unless a release entry explicitly states otherwise:

- **LSN Protocol**: LSN v0.1
- **Device Profile**: lsn-v0.1.0
- **Firmware Interface Package**: LSN-Firmware-Interface-v0.1

## 0.3.0 — Development Preview (2026-08-21)

Release type: Windows Development Preview (unsigned, internal development use only).

### Added

- Governed Device Profile lifecycle with revision-safe Drafts, immutable review snapshots, Development publications, audit history, and role-scoped workflows.
- Installed Windows profile-update workflow for detecting, reviewing, applying, and rolling back signed profile publications without rebuilding or reinstalling the Console.

### Changed

- Firmware Integration Packages are generated only from immutable Development-published profile versions and their governed digests.
- Client Reviewers use isolated per-user sandboxes while shared Draft editing and publication remain restricted to authorized roles.

### Fixed

- Database reconciliation now applies the governed-profile schema non-interactively and verifies that no schema drift remains.
- Review submission and decisions now preserve exact revision and digest bindings across concurrent Draft changes.

### Known limitations

- The Windows installer is unsigned; Microsoft Defender SmartScreen will warn on first run ("More info" → "Run anyway"). Internal development use only.
- Physical ESP32/WT32 mapping validation remains a separate firmware-team and bench process; this Console release does not claim physical-device verification.
- Publishing or applying a Device Profile changes Console runtime configuration only and does not rewrite ESP32/WT32 firmware.
- Simulation evidence remains distinct from physical hardware evidence and never substitutes for hardware validation.

### Protocol impact

No protocol impact. LSN Protocol remains v0.1 and the external firmware interface is unchanged; no firmware action is required for this Console release.

### Device Profile impact

Device Profile version unchanged. The schema track remains lsn-v0.1.0 and the generated package remains LSN-Firmware-Interface-v0.1.zip.

## 0.2.1 — Development Preview (2026-08-14)

Release type: Windows Development Preview patch (unsigned, internal development use only).

### Added

- None.

### Changed

- Guided-tour coachmarks now stay clear of active navigation, keep controls visible on short screens, and support comma/period Back and Next hotkeys.
- Downloads now explains how firmware engineers resolve intentionally TBD protocol mappings before Hardware Mode can transmit.

### Fixed

- Packaged Windows login now sends allowlisted authentication requests through the Electron main process to the published HTTPS API instead of resolving /api URLs under file://.

### Known limitations

- The Windows installer is unsigned; Microsoft Defender SmartScreen will warn on first run ("More info" → "Run anyway"). Internal development use only.
- Hardware Mode remains truthfully non-functional: real WT32-ETH01 discovery, EtherNet/IP (CIP) sessions, physical control validation, and firmware upload are not implemented.
- Simulation Mode is the supported validation environment; simulation evidence never advances firmware implementation status.
- CIP Class/Instance/Attribute/Assembly values and other Device Profile mappings remain intentionally TBD for the firmware engineer.

### Protocol impact

No protocol impact. LSN Protocol remains v0.1 and the external firmware interface is unchanged; no firmware action is required for this Console release.

### Device Profile impact

Device Profile unchanged. The active profile remains lsn-v0.1.0 and the generated package remains LSN-Firmware-Interface-v0.1.zip.

## 0.2.0 — Development Preview (2026-08-14)

Release type: Windows Development Preview (unsigned, internal development use only).

### Added

- Windows Development Preview packaging: unsigned Squirrel installer and optional portable ZIP produced by the tagged CI workflow.
- Once-per-version "What’s New" summary in the packaged desktop Console with a link to the full changelog.
- Changelog and version information available from Help / Firmware Guide and Downloads, covering all four version tracks.
- Native desktop save/export dialog for reports, logs, support bundles, and the Firmware Integration Package when running the packaged Windows Console.
- Release, protocol, Device Profile, and connected-firmware identity embedded in validation reports, support bundles, and engineering-log exports.

### Changed

- Console release identity centralized in a single shared module driving the header, login screen, Downloads, exports, and desktop What’s New.
- Downloads presents the current Windows Development Preview release, release notes, and the unchanged v0.1 Firmware Integration Package side by side.
- Guided tour closing steps now point to both v0.2.0 handoff resources (Windows Console preview and the v0.1 firmware package).

### Fixed

- None.

### Known limitations

- The Windows installer is unsigned; Microsoft Defender SmartScreen will warn on first run ("More info" → "Run anyway"). Internal development use only.
- Hardware Mode remains truthfully non-functional: real WT32-ETH01 discovery, EtherNet/IP (CIP) sessions, physical control validation, and firmware upload are not implemented.
- Simulation Mode is the supported validation environment; simulation evidence never advances firmware implementation status.
- CIP Class/Instance/Attribute/Assembly values and other Device Profile mappings remain intentionally TBD for the firmware engineer.

### Protocol impact

No protocol impact. LSN Protocol remains v0.1 and the external firmware interface is unchanged; no firmware action is required for this Console release.

### Device Profile impact

Device Profile unchanged. The active profile remains lsn-v0.1.0 and the generated package remains LSN-Firmware-Interface-v0.1.zip.

## 0.1.0 (2026-08-07)

### Added

- Added the simulation-first LSN engineering platform foundation.
- Added versioned Device Profiles and generated firmware-interface concepts.
- Added control, protocol inspection, validation, stress, firmware-update, reporting, and modular-extension workflows.
- Added secure Electron shell structure and Windows packaging workflow.

### Known limitations

- Web-only distribution; no packaged Windows build was published for this release.

### Protocol impact

Initial release; defined the LSN v0.1 protocol track.

### Device Profile impact

Initial release; defined Device Profile lsn-v0.1.0.
