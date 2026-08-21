# Windows Release Evidence

## Published v0.2.1 Development Preview

The immutable release is:

- Release: <https://github.com/motionlasers/lsn-console/releases/tag/lsn-console-v0.2.1>
- Published: 2026-08-15
- Installer: `LSN-Engineering-Console-Setup-0.2.1-dev.exe`
- Portable archive: `LSN-Engineering-Console-Portable-0.2.1.zip`
- Checksum manifest: `SHA256SUMS.txt`

Published SHA-256 values:

```text
8f683e27a138bfe3f0a9199a45cf424304e7ed96e477ff388bdb08eacf0f68fd  LSN-Engineering-Console-Setup-0.2.1-dev.exe
55bc0e3c0163e474c76f69ae1fe673d6dea5d491770a9b490a58f41810fb4290  LSN-Engineering-Console-Portable-0.2.1.zip
```

The installer, portable archive, and manifest permanent URLs returned HTTP 200
on 2026-08-21. GitHub's asset digests match the manifest.
The release smoke job additionally pins v0.2.1 to tag commit
`b0707fafa100d8df6a8b56f5a454e2a070955bda`, the installer hash above, and
manifest SHA-256
`91f245548d8fb155590a4dcf056ecb83e076f8198da17178a5894bc68bec66ec`.
Tag-triggered publication refuses to replace any existing release or asset.

## Windows runner acceptance

The 2026-08-21 Windows workflow run is retained at:

<https://github.com/motionlasers/lsn-console/actions/runs/32466707746>

Both independent Windows jobs passed:

1. `build-windows` built the current tree, verified the unsigned installer
   status, collected installer/portable/checksum artifacts, installed the
   generated Squirrel package, launched the versioned installed executable,
   verified the packaged preload/login/update/hardware boundaries, uninstalled,
   cleanly reinstalled, and repeated the launch smoke test.
2. `smoke-published-release` downloaded the immutable v0.2.1 installer and
   checksum manifest from the GitHub release, verified the installer SHA-256,
   installed that exact asset on a fresh Windows runner, and launched it.

Each job retains JSON evidence and a screenshot as a GitHub Actions artifact.
The published-release evidence confirms:

- installed executable version `0.2.1`
- packaged `win32` runtime
- visible username, password, and sign-in controls
- narrow packaged preload bridge
- fail-closed control/read behavior
- maintenance endpoint still not implemented

The immutable v0.2.1 release predates physical EtherNet/IP transport and the
automatic-updater bridge. Its smoke expectations intentionally preserve those
historical limitations. Current `main` has both the updater bridge and guarded
physical discovery/session support, and its separate install/reinstall job
verifies those newer boundaries.

## Remaining manual release acceptance

The current tree must not be republished under or moved onto the immutable
`lsn-console-v0.2.1` tag. Publishing it requires a version bump and a new tag.

A live updater handoff from v0.2.1 to a newer installer is not yet possible
because no newer Console release exists. The updater's selection, download
progress, checksum/signature classification, deferral, consent, launch, and
failure paths are covered by automated tests, and current Windows packaging
proves the updater initializes. The next release must additionally perform a
manual Windows acceptance run for:

1. install published v0.2.1
2. discover and download the newer release
3. choose **Later**, restart, and confirm the prepared update persists
4. choose **Install now**
5. complete the unsigned SmartScreen consent when applicable
6. confirm the newer version launches and retains the expected session state

Live authenticated session restoration also requires an approved non-production
smoke account. The Windows smoke gate verifies login rendering and packaged
session plumbing without storing or exposing credentials in CI.