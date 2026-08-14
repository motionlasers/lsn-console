---
name: Browser validation checks
description: Durable rules for headless-browser regression checks run through the validation runner.
---

- The validation runner has a hard time budget per run; a check that finishes its assertions but never exits still gets STOPPED and reported as failed.
- **Why:** a passing browser gate was killed twice purely because lingering dev-server child handles kept the process alive.
- **How to apply:** browser gates must own their server (fresh allocated port, verify the response is really the app, fail if the child dies), tear down the whole process group, and exit explicitly. Run independent browser contexts concurrently to stay inside the budget.
- Tour geometry: at narrow widths the coachmark often cannot fit beside a tall target — non-overlap assertions must be conditional on geometric feasibility, mirroring the positioning algorithm's own contract.
