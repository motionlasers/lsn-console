# LSN Engineering Console v0.3.0 — READY

## Decision

**READY — LSN Engineering Console v0.3.0 Development Preview**

Release:
<https://github.com/motionlasers/lsn-console/releases/tag/lsn-console-v0.3.0>

Immutable release tag commit:
`130107e24642ce39c9e6e1a744fa391a8fa14f2b`

## Published asset proof

```text
cffb64f3b6f18524a77090a3f3ecce8a823272902bbbc1223d0b6224cb25b8eb  LSN-Engineering-Console-Setup-0.3.0-dev.exe
d94931f8784bd06fe9b19572bc2a6aab67cab2f0c7f8bc62f2f212e7691080d1  LSN-Engineering-Console-Portable-0.3.0.zip
24a964fc55d16499b4024e6e603a2c3130057a3a6f06bc350ce5eb3affcc75f9  SHA256SUMS.txt
```

The released installer was independently downloaded, checked against the
published manifest, installed on a fresh Windows runner, and launched.

## Installed executable identity

The executable installed from the actual published installer reported:

```text
version  0.3.0
sha256   a574327148de46d648787baefbc3fa150dedbdcce37f09878f326915c53b236c
size     225533952 bytes
runtime  packaged win32
```

See `published-release/published-release-smoke.json`.

## Governed profile proof

The build-only Windows gate proved on the unchanged installed executable:

- unpublished channel detection;
- corrupt profile rejection with `digest_mismatch`;
- no corrupt staging or activation;
- exact `Ready` mapping diff;
- explicit apply;
- runtime CIP mapping Class `150`, Instance `7`, Attribute `42`;
- unchanged executable version/hash/process;
- no rebuild or reinstall;
- bundled rollback;
- redacted audit evidence.

See `build-gate/profile-only-publication-smoke.json`.

## Passed gates

- Local Console: 352/352 tests
- Local API: 85/85 tests
- Browser regression: 1,249/1,249 checks
- Local lint, typecheck, production build: passed
- Build-only Windows gate:
  <https://github.com/motionlasers/lsn-console/actions/runs/32547551224>
- Tag-triggered publication gate:
  <https://github.com/motionlasers/lsn-console/actions/runs/32547799945>
- Published-installer Windows gate with executable identity:
  <https://github.com/motionlasers/lsn-console/actions/runs/32548616125>

## Release-track integrity

Only the Console track advanced:

- Console: `0.3.0 Development Preview`
- LSN Protocol: `LSN v0.1` unchanged
- Device Profile: `0.1.0` / `lsn-v0.1.0` unchanged
- Firmware Interface: `v0.1` / `LSN-Firmware-Interface-v0.1` unchanged

The historical v0.2.1 release and evidence remain unchanged.

## Bundle contents

- `published-release/` — actual published-installer smoke JSON and screenshot
- `build-gate/` — install, clean-reinstall, profile lifecycle JSON/screenshots
- `published-assets/` — published manifest and GitHub release metadata
- `local-gate/` — local test/check summaries
- `source-evidence/` — separate v0.3.0 Windows evidence document
- `web-login-final.jpg` — final live app snapshot
- `BUNDLE-SHA256SUMS.txt` — SHA-256 for every evidence file

The installer and portable ZIP are not duplicated inside this evidence archive;
their immutable release URLs, sizes, GitHub digests, and independently verified
hashes are recorded in the bundle.