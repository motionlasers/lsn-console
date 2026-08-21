# Source Inspection Findings (not runtime proof)

## Implemented source surfaces

- Three canonical roles and permission middleware.
- Mutable Drafts with optimistic revision checks.
- Immutable review snapshots, comments, decisions, Development publications, rollback records, Production/Frozen promotion guards, sandbox storage, and append-only profile audit inserts.
- Authenticated digest-addressed desktop profile channel.
- Electron-main-owned profile verification, staging, activation, persistence, last-known-good rollback, and hardware profile repinning.
- Fail-closed symbolic CIP mapping and bounded codec resolution.

## Material gaps against the requested workflow

- No reconciled development database schema.
- No full CIP/RPI/timeout/tolerance/capability editor.
- No interactive Client Sandbox overrides.
- No Superadmin user/role management UI.
- Client Reviewer authenticated read APIs are broader than Review Candidate scope.
- Firmware package export uses the working document, not an immutable publication selector.
- No Windows mapping diff in renderer state/UI.
- No Windows profile-applied server audit event.
- No installed Windows profile-propagation test in the existing Windows smoke.

## Principal references

- artifacts/api-server/src/lib/permissions.ts
- artifacts/api-server/src/middleware/require-auth.ts
- artifacts/api-server/src/routes/profiles.ts
- artifacts/api-server/src/routes/desktop.ts
- artifacts/api-server/src/lib/profile-service.ts
- lib/db/src/schema/users.ts
- lib/db/src/schema/profiles.ts
- artifacts/lsn-engineering-console/src/pages/profile.tsx
- artifacts/lsn-engineering-console/src/pages/profile-review.tsx
- artifacts/lsn-engineering-console/src/pages/downloads.tsx
- artifacts/lsn-engineering-console/src/lib/firmware-package.ts
- artifacts/lsn-engineering-console/electron/profile-update-service.cjs
- artifacts/lsn-engineering-console/electron/profile-operations.cjs
- artifacts/lsn-engineering-console/tests/profile-update-service.test.ts
- artifacts/api-server/tests/lifecycle.test.ts
