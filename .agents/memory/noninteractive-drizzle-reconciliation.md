---
name: Non-interactive Drizzle reconciliation
description: Safe handling of Drizzle schema pushes in unattended post-merge setup.
---

Treat unattended Drizzle reconciliation as successful only when its output confirms changes were applied or no drift was detected; an exit code alone is insufficient when populated tables trigger advisory prompts.

**Why:** A Drizzle CLI release emitted a no-TTY prompt error while its package command still returned success, allowing post-merge setup to appear healthy without applying schema changes.

**How to apply:** Keep post-merge database commands non-interactive, fail before any SQL in deployment-marked environments, and validate both first-run application and a second idempotent run whenever the schema reconciliation path changes.