---
name: Browser validation checks
description: Durable rules for headless-browser regression checks run through the validation runner.
---

- The validation runner has a hard time budget per run; a check that finishes its assertions but never exits still gets STOPPED and reported as failed.
- **Why:** a passing browser gate was killed twice purely because lingering dev-server child handles kept the process alive.
- **How to apply:** browser gates must own their server (fresh allocated port, verify the response is really the app, fail if the child dies), tear down the whole process group, and exit explicitly. Run independent browser contexts concurrently to stay inside the budget.
- Tour geometry: at narrow widths the coachmark often cannot fit beside a tall target — non-overlap assertions must be conditional on geometric feasibility, mirroring the positioning algorithm's own contract.
- Browser scripts that import TypeScript directly under Node 24 must use explicit `.ts` relative extensions, and imported JSON must include `with { type: 'json' }`.
- **Why:** Vite's resolver accepts extensionless TypeScript and implicit JSON imports, while Node's native ESM/TypeScript loader rejects both before the browser test starts.
- **How to apply:** when a browser test imports application `.ts` modules directly, keep the entire transitive import chain valid for strict Node ESM as well as Vite.
- Authorization checks in browser gates must send HTTP requests through the production router and permission middleware; an in-page API mock or copied permission map cannot prove route wiring.
- **Why:** a deterministic mock stayed green while it could not detect a missing or incorrect `requirePermission` on the real route.
- **How to apply:** mount the production router with a narrowly scoped pre-resolved test session, assert its real denial contract, and bypass only external setup such as the DB session lookup.
