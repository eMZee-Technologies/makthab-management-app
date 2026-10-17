# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

**Makthab** — single-tenant management app for a Masjid-o-Madarasa (students, fees, attendance, expenses, staff/salaries, PDF/Excel reports). See `CLAUDE.md` and `README.md` for the full stack and conventions.

## Cursor Cloud specific instructions

### Services

| Service | Port | How to start |
|---------|------|--------------|
| Express API | 3000 | `npm run dev -w server` or root `npm run dev` |
| Vite client | 5173 | `npm run dev -w client` or root `npm run dev` |
| SQLite DB | — | File at `data/madrasa.db`; not a separate process |

Start both with `npm run dev` from the repo root (uses `concurrently`).

### First-time / fresh DB setup

After `npm install` and `npm run build:shared`, reset and seed the dev database:

```bash
npm run db:reset -w server
```

Copy env templates if missing: `server/.env.example` → `server/.env`, `client/.env.example` → `client/.env`.

Default logins (from seed): `admin`/`admin123`, `accountant`/`accountant123`, `teacher`/`teacher123`.

### Lint / test / typecheck

```bash
npm run typecheck          # all workspaces
npm run test -w server     # Jest integration suite (uses isolated test.db in server/)
```

The client `lint` script references `eslint`, but ESLint is not listed in `client/package.json` devDependencies — lint is not currently runnable without adding that dependency.

Server tests use an isolated DB. From `server/`:

```bash
DATABASE_URL="file:./test.db" npx prisma migrate reset --force --schema=./prisma/sqlite/schema.prisma
DATABASE_URL="file:./test.db" npm test
```

### E2E smoke

With the server running on :3000 and a seeded DB:

```bash
node server/tests/e2e-smoke.mjs
```

Note: the smoke script's expense step sends `{ amount }` but the API expects `{ cost, quantity }` (see `server/tests/finance.test.ts`). Jest finance tests pass; the smoke script may fail on that step until updated.

### Shared package rebuild

After changing `packages/shared/`, run `npm run build:shared` before server build/tests. The client picks up shared TS source via Vite alias live.

### PostgreSQL (optional)

Not required for local dev. Use `docker compose up -d` (port 5433) and `DATABASE_PROVIDER=postgresql` only when testing the Postgres path. See `README.md` § PostgreSQL deployment.
