#!/bin/sh
# Container entrypoint: apply schema migrations, run the one-time xlsx
# import + seed only on the first successful deployment, then hand off to
# the server process (exec, so it becomes PID 1 and receives SIGTERM/SIGINT
# directly for a clean shutdown).
#
# Idempotence guard: `server/prisma/check-seeded.ts` checks whether
# OrgProfile#1 exists (seed.ts always upserts it first). If present, the
# xlsx import + seed step is skipped. Both underlying scripts
# (migrate-from-xlsx.ts and seed.ts) are themselves idempotent, so this is
# a performance/safety gate, not a correctness requirement — it exists so
# steady-state deploys don't re-read the xlsx file and re-run every upsert,
# which is what was slowing down (and destabilizing) redeploys.
#
# Env vars:
#   SKIP_SEED=true     - never run xlsx import/seed, regardless of marker
#   FORCE_RESEED=true  - always (re-)run xlsx import/seed, ignoring marker
#   DB_WAIT_RETRIES     - migrate-deploy retry attempts while DB comes up (default 30)
#   DB_WAIT_DELAY       - seconds between retries (default 2)
set -e

MAX_RETRIES="${DB_WAIT_RETRIES:-30}"
RETRY_DELAY="${DB_WAIT_DELAY:-2}"
PRISMA_BIN="./server/node_modules/.bin/prisma"
SCHEMA="server/prisma/schema.prisma"

echo "[entrypoint] Applying database migrations (prisma migrate deploy)..."
attempt=0
until "$PRISMA_BIN" migrate deploy --schema="$SCHEMA"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[entrypoint] migrate deploy failed after $MAX_RETRIES attempts — giving up." >&2
    exit 1
  fi
  echo "[entrypoint] migrate deploy failed (attempt $attempt/$MAX_RETRIES) — DB likely still starting, retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done
echo "[entrypoint] Migrations applied."

if [ "${SKIP_SEED:-false}" = "true" ]; then
  echo "[entrypoint] SKIP_SEED=true — skipping xlsx import + seed."
elif [ "${FORCE_RESEED:-false}" != "true" ] && npm run --silent db:check-seeded:pg -w server; then
  echo "[entrypoint] Database already seeded — skipping xlsx import + seed."
else
  # Seed MUST run before the xlsx import: migrate-from-xlsx.ts attaches fee
  # records to the active AcademicYear, which only exists once seed.ts has
  # created it (see docs/migration/MIGRATION.md and CLAUDE.md's own command
  # order — db:reset [migrate+seed] precedes migrate:xlsx).
  echo "[entrypoint] Running one-time seed + xlsx import..."
  npm run db:seed:pg -w server
  npm run migrate:xlsx:pg -w server
  echo "[entrypoint] Seed + xlsx import complete."
fi

echo "[entrypoint] Starting server..."
exec node server/dist/index.js
