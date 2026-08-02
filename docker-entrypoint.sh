#!/bin/sh
# Container entrypoint: apply schema migrations, optionally run one-time seed
# (+ optional xlsx import), then hand off to the server process (exec, so it
# becomes PID 1 and receives SIGTERM/SIGINT directly for a clean shutdown).
#
# Idempotence guard: `server/prisma/check-seeded.ts` checks whether any User
# row exists. If present, seed is skipped. seed.ts itself never overwrites
# existing password hashes.
#
# Env vars:
#   SKIP_SEED=true         - never run seed (or xlsx), regardless of marker
#   FORCE_RESEED=true      - always (re-)run seed, ignoring marker (passwords
#                            of existing users are still NOT reset)
#   RUN_XLSX_IMPORT=true   - after seed, import docs/source-data/*.xlsx if
#                            present (file is NOT baked into the image; mount
#                            it at runtime when needed)
#   SEED_*_PASSWORD        - required when NODE_ENV=production and seed runs
#   DB_WAIT_RETRIES        - migrate-deploy retry attempts (default 30)
#   DB_WAIT_DELAY          - seconds between retries (default 2)
set -e

MAX_RETRIES="${DB_WAIT_RETRIES:-30}"
RETRY_DELAY="${DB_WAIT_DELAY:-2}"
PRISMA_BIN="./server/node_modules/.bin/prisma"
SCHEMA="server/prisma/schema.prisma"
XLSX_PATH="docs/source-data/Maktab Detailed - Report.xlsx"

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
  echo "[entrypoint] SKIP_SEED=true — skipping seed (+ xlsx import)."
elif [ "${FORCE_RESEED:-false}" != "true" ] && npm run --silent db:check-seeded:pg -w server; then
  echo "[entrypoint] Database already seeded — skipping seed (+ xlsx import)."
else
  # Seed MUST run before any xlsx import: migrate-from-xlsx.ts attaches fee
  # records to the active AcademicYear, which only exists once seed.ts has
  # created it (see docs/migration/MIGRATION.md).
  echo "[entrypoint] Running one-time seed..."
  npm run db:seed:pg -w server
  echo "[entrypoint] Seed complete."

  if [ "${RUN_XLSX_IMPORT:-false}" = "true" ]; then
    if [ -f "$XLSX_PATH" ]; then
      echo "[entrypoint] RUN_XLSX_IMPORT=true — importing $XLSX_PATH..."
      npm run migrate:xlsx:pg -w server
      echo "[entrypoint] xlsx import complete."
    else
      echo "[entrypoint] RUN_XLSX_IMPORT=true but $XLSX_PATH is missing." >&2
      echo "[entrypoint] Mount the spreadsheet at that path (it is intentionally not baked into the image)." >&2
      exit 1
    fi
  else
    echo "[entrypoint] RUN_XLSX_IMPORT not set — skipping xlsx import."
  fi
fi

echo "[entrypoint] Starting server..."
exec node server/dist/index.js
