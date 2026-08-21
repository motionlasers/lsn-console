#!/bin/bash
set -euo pipefail

if [[ -n "${REPLIT_DEPLOYMENT:-}" ]]; then
  echo "Refusing to reconcile the database from a deployment environment." >&2
  exit 1
fi

pnpm install --frozen-lockfile

# drizzle-kit 0.31 prompts even with --force when adding a unique constraint
# to a populated table, then reports success when no TTY is available. Add the
# legacy users constraint safely first so the schema push stays non-interactive.
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.users'::regclass
         AND conname = 'users_username_unique'
     )
  THEN
    EXECUTE 'ALTER TABLE public.users
             ADD CONSTRAINT users_username_unique UNIQUE (username)';
  END IF;
END
$$;
SQL

pnpm --filter @workspace/db run push-force
