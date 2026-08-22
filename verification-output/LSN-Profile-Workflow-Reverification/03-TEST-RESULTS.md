# Test and Runtime Results

## Automated suites

- Workspace typecheck: PASS
- API server: 5 files, 85 tests passed
- Console lint: PASS
- Console regression suite: 16 files, 341 tests passed
- Browser suite:
  - Guided tour: 1,180 checks passed
  - Downloads warning: 25 checks passed
  - Role workflows: 44 checks passed
- Targeted profile/update suite: 5 files, 106 tests passed

## Live development runtime

The API workflow was restarted after schema reconciliation and remained healthy on port 8080. Real browser sessions used the running Console/API, not the in-page mocks used by the regression role-workflow test.

The browser driver completed:

1. Firmware Admin edit, save, and reload.
2. Immutable review submission.
3. Working Draft mutation after submission.
4. Client sandbox save and PASS simulation.
5. Review comment and acceptance.
6. Development publication.
7. Published-version firmware package download.
8. Superadmin governance and audit views.

The first browser attempt stopped after the acceptance endpoint succeeded because the verifier expected a nonexistent confirmation button. The resumed run used the actual direct-submit UI and completed. Raw logs preserve both attempts.

## Database reconciliation

Direct execution of `scripts/post-merge.sh` returned exit code 126 because the file is not executable. Running `bash scripts/post-merge.sh` succeeded and Drizzle reported `No changes detected`. This confirms the development schema is reconciled while preserving the file-mode limitation as evidence.

## Windows

The GitHub workflow inventory contains no run at Task 52 commit `702f9fd5be94720c0e88accf9d64d4fe11b1f871` or current commit `c7fe430ced3a68e7ad991ec9e8ee076a68bf0c89`. The latest successful retained Windows run predates the profile-propagation remediation. Installed Windows results are therefore `NOT VERIFIED`.