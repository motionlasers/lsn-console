# LSN Engineering Console

A local-first engineering, firmware validation, diagnostic, and firmware-management console for Laser Safety Network hardware, distributed by Saber Industrial Applications.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/lsn-engineering-console run dev` — run the simulation UI through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- UI: React 19, Vite, Tailwind CSS
- Desktop distribution: Electron with isolated preload boundary and Electron Forge packaging

## Where things live

- `artifacts/lsn-engineering-console/` — shared simulation UI and Electron desktop shell
- `artifacts/lsn-engineering-console/profiles/lsn-v0.1.json` — active logical protocol/profile source of truth
- `artifacts/lsn-engineering-console/docs/` — firmware and engineering documentation

## Architecture decisions

- One React application serves Replit Simulation Mode and packaged Electron Hardware Mode.
- Device Profiles own protocol mappings; unresolved values remain TBD and block Hardware Mode transmission.
- EtherNet/IP control and firmware-maintenance transports are separate replaceable adapters.
- Simulation results are engineering evidence, never represented as physical hardware validation.

## Product

Discovery, control-state validation, runtime counters, faults, protocol inspection, automated and stress testing, firmware-update rehearsal, reports, support bundles, and firmware-facing profile specifications.

## User preferences

- Use LSN branding for the connected hardware platform and Saber Industrial Applications branding for the application distributor.
- Preserve precise safety terminology and never imply optical emission or safety certification.

## Gotchas

- Do not invent CIP mappings. Hardware Mode must remain non-transmitting until mappings and transports are physically validated.
- The bright LSN line-art logo requires a dark surface for legibility.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
