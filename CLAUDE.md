# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Makthab** (Makthab Management System) — a single-tenant management app for a
Masjid-o-Madarasa: students, fees, attendance, expenses, staff/salaries, and
PDF/Excel reports, with Arabic/RTL-aware UI.

> The stack below is the **only** supported architecture. An older multi-tenant
> Next.js/Knex/PostgreSQL scaffold (previously in `backend/` + `frontend/`) has
> been removed — do not resurrect it.

## Architecture

- **Client** (`client/`): React 18 + TypeScript + Vite + Tailwind + shadcn/ui SPA. Port **5173**.
- **Server** (`server/`): Node 20 + Express + TypeScript + Prisma 5 + SQLite. Port **3000**, API base `/api/v1`.
- **Shared** (`packages/shared/`): Zod schemas + inferred TS DTOs, published as `@makthab/shared` (server owns, client consumes).
- **Data** (`data/`): `madrasa.db` + generated `files/{receipts,payslips,reports,photos}`.
- npm **workspaces** at the repo root (`packages/*`, `server`, `client`).

The API contract, roles, and Prisma data model are specified in
**`docs/architecture/BUILD_CONTRACT.md`** — treat it as the source of truth.

## Commands

```bash
npm install                    # install all workspaces
npm run build:shared           # compile @makthab/shared (needed before server build/tests)
npm run db:reset -w server     # prisma migrate + seed (local bootstrap users; see seed.ts)
npm run migrate:xlsx -w server # import docs/source-data/Maktab Detailed - Report.xlsx
npm run dev                    # server + client together
npm run typecheck              # all three workspaces
npm run test -w server         # Jest integration suite (needs a test DB — see below)
```

Jest uses an isolated DB: `DATABASE_URL="file:./test.db" npx prisma migrate reset --force`
then `DATABASE_URL="file:./test.db" npx jest` (run from `server/`).

## Conventions & gotchas

- **Roles** enforced on both tiers: Admin (full), Accountant (fees/finance/reports), Teacher (attendance). Guards: `requireAuth` / `requireRole`.
- **Validation errors return HTTP 400** (not 422). Two zod copies exist (root + server-local), so `errorHandler` detects `ZodError` **structurally by name**, and `validate` middleware types schemas as a minimal `{ parse }` interface — keep it that way.
- **PDFs** are produced by a dependency-free writer (`server/src/lib/pdf.ts`), not Puppeteer (offline-friendly; ASCII only — Arabic PDFs would need a font-embed/Puppeteer swap). Excel via ExcelJS.
- **Client resolves `@makthab/shared` to its TS source** via a `vite.config.ts` alias (the CJS dist isn't rollup-traceable). Consequence: after changing a shared schema, the client sees it live, but the **server needs `npm run build:shared`**.
- Success envelope `{ data }`; error envelope `{ error: { code, message } }`.
- Form schemas that coerce HTML strings live in `client/src/lib/schemas.ts` and reuse the shared enum schemas so values can't drift.

## Data migration

Legacy spreadsheet import is documented in **`docs/migration/MIGRATION.md`**
(`server/prisma/migrate-from-xlsx.ts`). It is idempotent. Note it backfills
students that appear only in the fee sheets (69 total vs 36 in "Admission Details").

## Code standards

- TypeScript strict across all workspaces; `npm run typecheck` must pass.
- Match the surrounding code's style and idioms.
