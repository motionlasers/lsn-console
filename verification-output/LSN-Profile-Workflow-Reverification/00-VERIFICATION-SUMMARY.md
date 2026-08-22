# LSN Profile Workflow Re-verification

**Verification date (UTC):** 2026-08-22  
**Verified commit:** `c7fe430ced3a68e7ad991ec9e8ee076a68bf0c89`  
**Overall conclusion:** **NOT READY**

## Executive conclusion

The database, three-role governance model, Firmware Admin mapping editor, immutable Client Review snapshot, reviewer sandbox isolation, Development publication, immutable firmware package, permission enforcement, audit history, desktop profile channel, and Linux/Chromium regression suites all passed.

The required core chain is still incomplete because no GitHub Actions Windows run exists at either the Task 52 commit (`702f9fd5be94720c0e88accf9d64d4fe11b1f871`) or the verified current commit. Consequently, this package does **not** contain installed-Windows proof that the same packaged executable:

1. detects the published profile,
2. displays the mapping diff,
3. applies it without rebuild or reinstall,
4. changes the live runtime mapping,
5. preserves its executable hash/version/process identity, and
6. rejects or rolls back a bad profile in an installed environment.

The governing brief says any unverified core step requires **NOT READY**. Unit tests and source inspection are not substituted for that missing Windows execution.

## Passed evidence

- Development database contains all governed profile tables, role column, keys, and foreign-key constraints.
- `bash scripts/post-merge.sh` completed successfully and reported `No changes detected`.
- Disposable `TEST_*` users covered Superadmin, Firmware Admin, and two Client Reviewer sessions.
- Firmware Admin edited and reloaded the artificial `TimerState` mapping:
  - Class `112` (`0x70`)
  - Instance `1`
  - Attribute `4`
- Submission produced an immutable review snapshot and digest.
- The working Draft was later changed to Attribute `5`; the review snapshot and published version remained Attribute `4`.
- Reviewer-one sandbox stored a `750 ms` value; reviewer-two did not receive it.
- Client Reviewer comment, simulation, acceptance, duplicate-decision rejection, and separate changes-requested routing passed.
- Client Reviewer and Firmware Admin prohibited operations returned `403`; Superadmin governance reads returned `200`.
- Development publication and digest-addressed desktop channel passed.
- The downloaded firmware package contains the immutable published digest and Attribute `4`, and excludes later-Draft Attribute `5`.
- Append-only audit evidence includes create, Draft save, review submit/comment/acceptance, simulation validation, Development publication, hardware-record transition, and Production promotion.
- All disposable users and profiles were deleted after evidence capture.

## Important limitations

- The hardware record in this run is deliberately labeled `SIMULATED_FIXTURE_ONLY`, `physicalHardware: false`, and `deviceIdentity: NOT VERIFIED`. It exercises governance transitions only and is **not** physical ESP32/WT32 validation.
- Development Profile publication changes Console runtime configuration; it does not rewrite ESP32/WT32 firmware.
- Linux-compatible Electron profile tests passed, but installed Windows execution remains `NOT VERIFIED`.
- `scripts/post-merge.sh` lacks its executable bit. Direct execution returned `126`; invoking it with `bash`, as a shell script, passed and confirmed zero schema drift.

## Automated results

| Check | Result |
|---|---:|
| Workspace typecheck | PASS |
| API tests | 85/85 PASS |
| Console lint | PASS |
| Console unit/regression tests | 341/341 PASS |
| Browser checks | 1,249/1,249 PASS |
| Targeted profile/Electron-compatible tests | 106/106 PASS |
| Database reconciliation second pass | PASS — no changes detected |
| Installed Windows profile propagation | NOT VERIFIED |
| Physical hardware mapping | NOT VERIFIED |

See the CSV matrices, runtime JSON, package inspection, screenshots, and raw test output in this directory.