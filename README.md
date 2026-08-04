# Makthab — Makthab Management System

A single-tenant management system for a Masjid-o-Madarasa (Makthab): student
admissions, fee collection, attendance, expenses, staff & salaries, and
PDF/Excel reporting — with Arabic/RTL-aware UI.

## Tech stack

| Layer | Stack |
|---|---|
| **Client** | React 18 + TypeScript + Vite + Tailwind + shadcn/ui (SPA) |
| **Server** | Node 20 + Express + TypeScript + Prisma 5 + SQLite (dev) **or** PostgreSQL (production) |
| **Shared** | Zod schemas + inferred TS DTOs (`@makthab/shared`) |
| **Auth** | JWT (access + refresh), roles: Admin / Accountant / Teacher |
| **Docs (PDF)** | Built-in dependency-free PDF writer; Excel via ExcelJS |

## Monorepo layout

```
packages/shared/   # @makthab/shared — Zod schemas + DTOs (server owns, client consumes)
server/            # @makthab/server*  — Express + Prisma API        (port 3000)
client/            # @makthab/client   — Vite + React SPA            (port 5173)
data/              # madrasa.db (SQLite) + generated files/{receipts,payslips,reports,photos}
infra/terraform/   # AWS Phase 2 IaC (VPC, RDS, ECS, S3, CloudFront, …)
docs/              # architecture, migration, reference, development, deployment docs
```
(*`server` is unscoped in package.json.) npm workspaces are declared at the repo root.

## Quick start (SQLite — default, zero-setup)

Prerequisites: **Node 20+**. No database server required — SQLite is the default.

```bash
# 1. Install all workspace dependencies
npm install

# 2. Build shared schemas, create + seed the database
npm run build:shared
npm run db:reset -w server        # prisma migrate + seed (idempotent)

# 3. (optional) Import the legacy Excel data — see docs/migration/MIGRATION.md
npm run migrate:xlsx -w server

# 4. Start both dev servers
npm run dev
```

- Client: <http://localhost:5173>
- API: <http://localhost:3000>  ·  health: <http://localhost:3000/health>

## PostgreSQL deployment

PostgreSQL is the production target. Local development defaults to SQLite
(zero-setup), but you can point the app at a local Postgres instance for
pre-deployment testing. See
[`docs/architecture/redesign/01-multi-database-support.md`](docs/architecture/redesign/01-multi-database-support.md)
for the full rationale and architecture.

### 1. Start a local Postgres instance

```bash
docker compose up -d
```
Creates a `postgres:18-alpine` container on port **5434** (not 5432 or 5433 —
the EDB Windows installer commonly registers natively-installed PostgreSQL
versions as auto-starting services on exactly those ports, e.g. PG17 on 5432
and PG18 on 5433; a Docker container "publishing" an already-claimed host
port can appear to start fine while every real connection actually reaches
the native service instead). Default credentials: `postgres` / `postgres`,
database `makthab_dev`.

If you're not sure whether something already owns a port, check before
trusting `docker compose up`'s success message:

```powershell
Get-NetTCPConnection -State Listen | Where LocalPort -in 5432,5433,5434
Get-Process -Id <OwningProcess>   # confirm it's actually this container
```

### 2. Set the provider and connection string

Two env vars control which database the app uses:

```bash
DATABASE_PROVIDER=postgresql
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5434/makthab_dev"
```

Copy credentials from `server/.env.example` / your local secrets — never commit
real passwords. You can set these in `server/.env`, or pass them inline with
`cross-env`. If you're using a natively-installed Postgres instead of this
Docker container, point `DATABASE_URL` at whatever host/port that service
actually listens on.

### 3. Migrate and seed

```bash
# Apply pending migrations only (keeps existing data):
npm run db:deploy:pg -w server

# OR wipe + migrate + seed (fresh DB):
npm run db:reset:pg -w server
```

`db:deploy` / `db:deploy:pg` use the **Postgres** schema at `server/prisma/schema.prisma`.
Do **not** use the SQLite migrate path when `DATABASE_PROVIDER=postgresql`.

### 4. Run the app with Postgres

```bash
DATABASE_PROVIDER=postgresql npm run dev -w server
```

Or set `DATABASE_PROVIDER=postgresql` in `server/.env` and run `npm run dev`
as usual — the flag is read at startup.

### 5. Run the test suite against Postgres

```bash
node tests/reset-test-db.mjs      # DATABASE_PROVIDER=postgresql picks the postgres schema + makthab_test db
npm run test:pg -w server
```

### 6. Import legacy data into Postgres

```bash
DATABASE_PROVIDER=postgresql npm run migrate:xlsx -w server
```

### Seed logins

After `db:seed` / `db:reset`, local bootstrap users are created for roles
**Admin**, **Accountant**, and **Teacher**. Default passwords live only in
`server/prisma/seed.ts` (override with `SEED_ADMIN_PASSWORD`,
`SEED_ACCOUNTANT_PASSWORD`, `SEED_TEACHER_PASSWORD`). **Do not reuse seed
credentials outside local development**, and never commit production passwords.

## Scripts (root)

```bash
npm run dev            # server + client together (concurrently)
npm run dev:server     # API only
npm run dev:client     # SPA only
npm run build          # build shared, server, client
npm run typecheck      # typecheck all three workspaces
npm run db:migrate     # prisma migrate dev (Postgres)   (-w server)
npm run db:seed        # seed lookup tables + logins
npm run db:reset       # reset + migrate + seed (SQLite — default)
```

### Server-only scripts

| Script | Purpose | Default provider |
|---|---|---|
| `npm run test -w server` | Jest integration suite | SQLite |
| `npm run test:pg -w server` | Jest against Postgres | PostgreSQL |
| `npm run migrate:xlsx -w server` | Import legacy Excel data | SQLite |
| `npm run migrate:xlsx:pg -w server` | Import into Postgres | PostgreSQL |
| `npm run db:deploy -w server` | Apply pending migrations (reads `server/.env`) | from `.env` |
| `npm run db:deploy:pg -w server` | Apply pending **Postgres** migrations | PostgreSQL |
| `npm run db:deploy:sqlite -w server` | Apply pending **SQLite** migrations | SQLite |
| `npm run db:reset:pg -w server` | Reset + migrate + seed Postgres | PostgreSQL |
| `npm run db:seed:pg -w server` | Seed Postgres only | PostgreSQL |

## Modules

- **Students** — admissions, profiles, soft-delete, admission-letter PDF
- **Fees** — record payments (receipt PDF + wa.me WhatsApp link), defaulters, fee structures
- **Attendance** — per-class marking (single/bulk), monthly summary, low-attendance alerts
- **Finance** — expenses, staff, salary/payroll runs
- **Reports** — fee-collection, defaulters, attendance, expenses, salary register, financial summary (PDF + Excel)
- **Dashboard** — headline KPIs and recent activity

## API

Base URL `http://localhost:3000/api/v1`. JWT Bearer auth; standard envelopes
`{ data }` / `{ error: { code, message } }`. See
[`docs/architecture/BUILD_CONTRACT.md`](docs/architecture/BUILD_CONTRACT.md)
for the full endpoint and data-model contract.

## Configuration

`server/.env` (see `server/.env.example`):

```
DATABASE_PROVIDER=sqlite           # "sqlite" (default, zero-setup) | "postgresql"
DATABASE_URL="file:../../../data/madrasa.db"   # SQLite path; for Postgres use "postgresql://..."
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=...
JWT_REFRESH_SECRET=...
WHATSAPP_GATEWAY=walink
```

> SQLite `DATABASE_URL` is resolved relative to `server/prisma/sqlite/schema.prisma` —
> `../../../data/madrasa.db` points at the repo-root `data/` dir.
> For PostgreSQL, set `DATABASE_URL` to a standard connection string and
> change `DATABASE_PROVIDER=postgresql`.

`client/.env`: `VITE_API_URL=http://localhost:3000/api/v1`.

## Database provider

The app supports two database backends, selected at startup:

| Provider | Use case | Schema file | Migration dir |
|---|---|---|---|
| `sqlite` (default) | Local dev, CI, single-machine | `server/prisma/sqlite/schema.prisma` (auto-generated) | `server/prisma/sqlite/migrations/` |
| `postgresql` | Production, staging | `server/prisma/schema.prisma` (canonical) | `server/prisma/migrations/` |

The SQLite schema is **auto-generated** from the canonical Postgres schema via
`npm run db:generate:sqlite-schema -w server` and checked into the repo
like a lockfile. See
[`docs/architecture/redesign/01-multi-database-support.md`](docs/architecture/redesign/01-multi-database-support.md)
for the full design.

## Documentation

See [`docs/`](docs/) — architecture, the build contract, the data-migration
guide, and testing notes.

## AWS deployment (Phase 2)

Terraform under [`infra/terraform/`](infra/terraform/) provisions VPC, RDS
PostgreSQL, ECS Fargate + ALB, S3, CloudFront, Secrets Manager, and alarms.
GitHub Actions: `.github/workflows/ci.yml` (PR checks) and
`deploy-staging.yml` (ECR + S3 + ECS). Operational steps:
[`docs/deployment/AWS_RUNBOOK.md`](docs/deployment/AWS_RUNBOOK.md).

```bash
cd infra/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars   # fill secrets
terraform init && terraform plan
```

Set `STORAGE_BACKEND=s3` and `S3_BUCKET` on ECS (Terraform does this);
local/dev omits `STORAGE_BACKEND` (or sets `local`) so files stay under `data/files/`.

---

**Built for a Masjid-o-Madarasa.**
