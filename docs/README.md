# Makthab — Documentation

Documentation for **Makthab** (Makthab Management System), a single-tenant
Madrasa management application. Stack: React + TypeScript + Vite + Tailwind +
shadcn/ui (client); Node + Express + TypeScript + Prisma + SQLite (server);
shared Zod schemas in `packages/shared`.

## Layout

| Folder | Contents |
|---|---|
| [`architecture/`](./architecture) | System & React/TS architecture docs, diagrams, and the build contract (single source of truth for the API/data model). |
| [`architecture/redesign/`](./architecture/redesign) | Phased re-architecture plan (multi-DB, multi-tenant, security, AWS, UI) — start at [redesign/00-overview-and-prioritization.md](./architecture/redesign/00-overview-and-prioritization.md). Phase 2 AWS IaC lives in [`../infra/terraform`](../infra/terraform). |
| [`deployment/`](./deployment) | Cloud runbooks — see [AWS_RUNBOOK.md](./deployment/AWS_RUNBOOK.md). |
| [`migration/`](./migration) | How the legacy spreadsheet data was imported — see [MIGRATION.md](./migration/MIGRATION.md) — plus the original migration plan and mapping diagram. |
| [`reference/`](./reference) | Background study of the Maktab operation and developer context notes. |
| [`development/`](./development) | Developer-facing guides, e.g. [TESTING.md](./development/TESTING.md). |
| [`source-data/`](./source-data) | The legacy Excel workbook used as the migration source (and other source documents). |

## Key documents

- **[architecture/BUILD_CONTRACT.md](./architecture/BUILD_CONTRACT.md)** — the API contract, roles, data model, and definition of done. If code and this doc disagree, this doc wins.
- **[architecture/USER_MANAGEMENT_AUTH.md](./architecture/USER_MANAGEMENT_AUTH.md)** — signup / OTP / admin approval / forgot-password plan, API contract, and phased rollout.
- **[deployment/AWS_RUNBOOK.md](./deployment/AWS_RUNBOOK.md)** — AWS backup/restore, smoke checklist, and storage modes.
- **[architecture/redesign/02-cloud-deployment-aws.md](./architecture/redesign/02-cloud-deployment-aws.md)** — Phase 2 AWS design; Terraform under `infra/terraform/`.
- **[architecture/Madrasa_React_TS_Architecture.docx](./architecture/Madrasa_React_TS_Architecture.docx)** — the target architecture the build follows.
- **[architecture/PRISMA_5_TO_7_UPGRADE_ANALYSIS.md](./architecture/PRISMA_5_TO_7_UPGRADE_ANALYSIS.md)** — breaking-change impact analysis for a future Prisma 5→7 upgrade, written after a real incident where an uncommitted, half-finished v7 drift broke the app. Not a proposal to do it now — read before ever touching the `prisma`/`@prisma/client` version again.
- **[migration/MIGRATION.md](./migration/MIGRATION.md)** — running the one-shot data import.

## Running the app

See the root [`README.md`](../README.md) for setup, dev servers, and scripts.
