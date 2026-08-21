# LSN Profile Workflow Verification Summary

**Verification date:** 2026-08-21
**Mode:** Verification only; no product functionality or database schema was changed.
**Source snapshot:** Task 48 merged at commit af80a47270c78d630d231f6d68d24ae1748b6e62. The working tree also contained a separate user-requested button-wrap fix that does not affect profile governance.

## Executive result

The merged source contains a substantial role, profile lifecycle, audit, and Electron profile-update implementation. However, the development database was not reconciled with that implementation: the users table lacks the role column and all governed-profile tables are absent. The API lifecycle tests fail during fixture setup, so role-specific API and UI workflows could not be exercised. This is a blocking verification failure, not a cosmetic limitation.

The Console's non-database automated tests passed (320/320), including 85 targeted tests for profile verification, staging, explicit activation, rollback storage, digest/schema checks, and runtime mapping operations. Those tests do not replace an installed Windows proof. No Windows runner or packaged Windows session was available in this verification pass, and the current UI lacks the requested NEW PROFILE AVAILABLE / VIEW CHANGES mapping-diff workflow.

## Required verification table

| Verification Item | Result | Evidence |
| --- | --- | --- |
| Exact three roles defined | PASS | 01-role-permission-matrix.csv; test-output/api-server-tests.txt (permission unit tests pass) |
| Firmware Admin can edit CIP mappings through required workflow | FAIL | Source inspection found no CIP Class/Instance/Attribute editor; database blocker prevented API runtime exercise |
| Client Reviewer cannot edit shared profile | NOT VERIFIED | 02-role-permission-test-results.json; API lifecycle suite blocked before direct denial tests |
| Client Reviewer can simulate review candidate | NOT VERIFIED | 03-profile-lifecycle-test-results.json |
| Review snapshot immutable | NOT VERIFIED | Existing integration test could not run because governed schema is absent |
| Client Reviewer can Accept/Request Changes | NOT VERIFIED | Database blocker prevented account/profile creation and UI exercise |
| Client Sandbox supports isolated value overrides | FAIL | UI only initializes/resets a snapshot; no override editor for timeout/RPI/command state |
| Firmware Admin can publish Development Profile | NOT VERIFIED | API integration suite blocked by schema mismatch |
| Production promotion restricted to Superadmin | NOT VERIFIED | Permission source/unit coverage exists; required direct API run was blocked |
| Firmware package generated from immutable published profile | FAIL | Generator uses the active working document, not a selected immutable Development publication |
| Windows Console detects new profile | NOT VERIFIED | 04-windows-profile-propagation-test-results.json |
| Windows Console displays mapping diff | FAIL | Requested diff data/UI is not implemented in the Electron renderer bridge |
| Windows Console applies profile without rebuild | NOT VERIFIED | No installed Windows runner/session was available |
| New mapping used by Windows runtime | NOT VERIFIED | Linux unit tests pass; packaged Windows runtime consumption was not exercised |
| Profile publish does not trigger Windows build | NOT VERIFIED | No successful runtime publication was possible; source contains no build invocation |
| Audit history complete | FAIL | No audit UI or Windows profile-applied event; runtime lifecycle audit could not be created |
| Profile publishing does not rewrite ESP firmware | CONFIRMED | Architecture and generated handoff documentation preserve this boundary |

## Blocking defect

Read-only schema inspection returned only the legacy users table. Its columns are id, username, password_hash, is_admin, force_password_change, and created_at. The merged code requires users.role and governed profile tables. The API tests therefore fail with PostgreSQL errors 42703 (missing users.role) and 42P01 (missing profiles relation). See test-output/development-schema-inspection.json and test-output/api-server-tests.txt.

## Windows proof boundary

Linux tests verify profile manifest/document validation, digest checks, same-origin artifact enforcement, version monotonicity, staging without activation, explicit apply, persisted active/staged/last-known-good slots, tamper rejection, rollback behavior, and symbolic mapping/codec resolution. They do not prove the same installed Windows executable detected and applied a new server-published profile. Requested installed-Windows screenshots are therefore absent and explicitly listed in screenshots/README.md.

## Dynamic field assessment

The profile document and update service can carry CIP class, instance, attribute, assembly/offset metadata, units, descriptions, update/RPI, timeout, expected behavior, tolerance, capability flags, implementation status, and profile/protocol versions. The protocol engine source supports a bounded codec set (bool8, uint16, uint32, uint64, string, enum) and fails closed on TBD or unsupported mappings. Dynamic consumption of these fields by a packaged Windows session remains NOT VERIFIED.

## Required firmware boundary statement

> Publishing a Device Profile changes the runtime configuration used by the web Console and Windows Console. It does not rewrite or automatically modify the ESP32 firmware. The firmware implementation must expose matching CIP objects/mappings before physical hardware testing can succeed.

## Known limitations

1. Development database reconciliation for Task 48 is absent.
2. Direct three-role API and browser workflows could not be executed.
3. The profile editor does not expose the requested CIP mapping, RPI, timeout, tolerance, and capability editing workflow.
4. The Client Sandbox lacks interactive value overrides.
5. Firmware package generation is tied to the working document rather than an immutable published version.
6. Electron update UI does not expose the requested availability banner, change viewer, or mapping diff.
7. No installed Windows before/after binary proof was produced.
8. Windows profile application is not recorded in server audit history.
9. No audit-history UI exists for the requested screenshot.

## Privacy

No passwords, session cookies, authentication tokens, keys, database credentials, or personal client data are included. Password hashes emitted by the failing test runner were redacted from retained logs.
