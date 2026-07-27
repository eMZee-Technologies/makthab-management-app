# Makthab — Documentation

Documentation for **Makthab** (Makthab Management System), a single-tenant
Madrasa management application. Stack: React + TypeScript + Vite + Tailwind +
shadcn/ui (client); Node + Express + TypeScript + Prisma + SQLite (server);
shared Zod schemas in `packages/shared`.

## Layout

| Folder | Contents |
|---|---|
| [`architecture/`](./architecture) | System & React/TS architecture docs, diagrams, and the build contract (single source of truth for the API/data model). |
| [`architecture/redesign/`](./architecture/redesign) | **Proposal, not implemented.** Phased re-architecture plan (multi-DB, multi-tenant, security hardening, AWS deployment, UI redesign) — start at [redesign/00-overview-and-prioritization.md](./architecture/redesign/00-overview-and-prioritization.md). |
| [`migration/`](./migration) | How the legacy spreadsheet data was imported — see [MIGRATION.md](./migration/MIGRATION.md) — plus the original migration plan and mapping diagram. |
| [`reference/`](./reference) | Background study of the Maktab operation and developer context notes. |
| [`development/`](./development) | Developer-facing guides, e.g. [TESTING.md](./development/TESTING.md). |
| [`source-data/`](./source-data) | The legacy Excel workbook used as the migration source (and other source documents). |

## Key documents

- **[architecture/BUILD_CONTRACT.md](./architecture/BUILD_CONTRACT.md)** — the API contract, roles, data model, and definition of done. If code and this doc disagree, this doc wins.
- **[architecture/Madrasa_React_TS_Architecture.docx](./architecture/Madrasa_React_TS_Architecture.docx)** — the target architecture the build follows.
- **[migration/MIGRATION.md](./migration/MIGRATION.md)** — running the one-shot data import.

## Running the app

See the root [`README.md`](../README.md) for setup, dev servers, and scripts.
