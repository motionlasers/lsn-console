# Windows Release Evidence — v0.3.0

## READY decision

**READY — LSN Engineering Console v0.3.0 Development Preview**

The immutable release is:

- Release: <https://github.com/motionlasers/lsn-console/releases/tag/lsn-console-v0.3.0>
- Published: 2026-08-21 CDT (`2026-08-22T03:05:41Z`)
- Release tag commit: `130107e24642ce39c9e6e1a744fa391a8fa14f2b`
- Installer: `LSN-Engineering-Console-Setup-0.3.0-dev.exe`
- Portable archive: `LSN-Engineering-Console-Portable-0.3.0.zip`
- Checksum manifest: `SHA256SUMS.txt`

The historical v0.2.1 evidence remains unchanged in
`docs/WINDOWS_RELEASE_EVIDENCE.md`.

## Published asset integrity

Independent downloads of the published assets matched the release manifest and
GitHub's asset digests:

```text
cffb64f3b6f18524a77090a3f3ecce8a823272902bbbc1223d0b6224cb25b8eb  LSN-Engineering-Console-Setup-0.3.0-dev.exe
d94931f8784bd06fe9b19572bc2a6aab67cab2f0c7f8bc62f2f212e7691080d1  LSN-Engineering-Console-Portable-0.3.0.zip
24a964fc55d16499b4024e6e603a2c3130057a3a6f06bc350ce5eb3affcc75f9  SHA256SUMS.txt
```

## Published installer identity

The published-release smoke downloaded the immutable release assets, verified
the installer against `SHA256SUMS.txt`, installed that exact installer on a
fresh Windows runner, and launched the installed application.

- Workflow run:
  <https://github.com/motionlasers/lsn-console/actions/runs/32548616125>
- Installed app version: `0.3.0`
- Installed executable SHA-256:
  `a574327148de46d648787baefbc3fa150dedbdcce37f09878f326915c53b236c`
- Installed executable size: `225533952` bytes
- Runtime: packaged `win32`
- Physical discovery/session boundary: available only in packaged Windows
- Profile control/read: fail closed
- Maintenance endpoint: not implemented
- Windows updater: initialized at version `0.3.0`

## Complete Windows gate

The build-only release candidate gate passed in:

<https://github.com/motionlasers/lsn-console/actions/runs/32547551224>

That run:

1. linted, typechecked, and ran the Console tests;
2. packaged the Windows installer and portable archive;
3. installed and launched the generated Squirrel package;
4. verified packaged preload, login, updater, and hardware boundaries;
5. uninstalled and cleanly reinstalled the package;
6. repeated the installed launch smoke;
7. executed the governed Device Profile workflow against the unchanged
   installed executable.

The tag-triggered publication gate also passed:

<https://github.com/motionlasers/lsn-console/actions/runs/32547799945>

## Governed Device Profile proof

The installed profile-only publication smoke proved:

- unpublished channel detection;
- corrupt/digest-mismatched profile rejection with
  `error.code === "digest_mismatch"`;
- no staging or activation of the corrupt artifact;
- valid Development profile detection and exact scalar mapping diff;
- explicit apply through the installed preload IPC boundary;
- runtime `Ready` mapping repinned to CIP Class `150`, Instance `7`,
  Attribute `42`;
- unchanged executable version, SHA-256, size, timestamp, and process;
- no rebuild or reinstall triggered;
- rollback to bundled profile `0.1.0`;
- redacted apply and rollback audit records.

The unchanged executable identity during profile apply was:

```text
version  0.3.0
sha256   a574327148de46d648787baefbc3fa150dedbdcce37f09878f326915c53b236c
size     225533952
```

## Release-track integrity

Only the Console track advanced to `0.3.0`. These independently versioned
tracks remain unchanged:

- LSN Protocol: `LSN v0.1`
- Device Profile: `0.1.0` / `lsn-v0.1.0`
- Firmware Interface: `v0.1` / `LSN-Firmware-Interface-v0.1`

No production TLS verification bypass was added. The Windows localhost fixture
uses process-scoped CA trust and a strict packaged-Windows/GitHub-Actions/profile
smoke guard. Production profile traffic remains on Electron `net.fetch`, and
production desktop-auth traffic remains on the persistent Electron session.