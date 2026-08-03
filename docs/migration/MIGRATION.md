# Data Migration — Legacy Excel → Makthab DB

The legacy Maktab records live in **`docs/source-data/Maktab Detailed - Report.xlsx`**.
They are imported into the Prisma/SQLite database by a single idempotent script:

```
server/prisma/migrate-from-xlsx.ts   →   npm run migrate:xlsx -w server
```

> The older `migrate-from-sheets.ts` (Google Sheets → old Knex schema) has been
> removed. It targeted a deprecated schema and data source. This xlsx script is
> the only supported migration path.

## Prerequisites

The database schema must exist and the lookup tables must be seeded first
(academic years, classes, expense categories, admin/accountant/teacher logins):

```bash
npm run db:reset -w server     # migrate + seed a clean DB
```

Then run the import:

```bash
npm run migrate:xlsx -w server
```

## Sheet → table mapping

| Sheet | Target | Notes |
|---|---|---|
| `Admission Details` | `Student` | 36 students with full demographics. |
| `Admission Fees Details` | `FeePayment` (admission) | `receiptNo = ADM-<admNo>`. |
| `AY- 2024-2025 / 2025-2026 / 2026-2027 Monthly Fees` | `FeePayment` (monthly) | Wide-pivot unpivoted; `receiptNo = MF-<admNo>-<yyyy>-<mm>`. |
| `Salary` | `Staff` + `SalaryPayment` | Staff matched by name; payments keyed on `[staffId, month, year]`. |
| `Expense` | `Expense` | `voucherNo = LEG-EXP-<row>`; category synonyms normalised, unknowns created. |
| `Copy of …`, `Price Distribution …`, `Summary` | — | Skipped (duplicates / derived). |

## Student backfill (important)

The **`Admission Details`** tab lists only **36** students, but the fee sheets
reference **69** (UF00001–UF00069). The script backfills the missing 33:

- **27** from the monthly-fee sheets (which carry name / gender / father /
  contact / class in columns 1–6), and
- **6** from the admission-fee sheet (name + guardian only).

Backfilled students are flagged in `Student.notes` so they can be distinguished
from the fully-documented 36. Without this step, ~33 students and hundreds of
their fee rows would be silently dropped.

## Result (clean run)

| Table | Rows |
|---|---|
| Students | 69 |
| Fee payments | 672 (69 admission + 603 monthly) |
| Staff | 5 (3 seed + 2 migrated) |
| Salary payments | 35 |
| Expenses | 52 |

## Idempotency & re-running

Every write is an `upsert` on a unique key, so the script is safe to re-run — it
updates in place without creating duplicates. For a fully clean slate:

```bash
npm run db:reset -w server
npm run migrate:xlsx -w server
```

## Production (PostgreSQL) — secure one-time cutover

Do **not** bake the workbook into the Docker image. For PRD RDS, follow the
dedicated runbook:

**[PRODUCTION_XLSX_CUTOVER.md](./PRODUCTION_XLSX_CUTOVER.md)**

Summary: stage the xlsx in a private S3 bucket → run a **one-off** job
(`migrate:xlsx:pg`) with Secrets Manager `DATABASE_URL` → reconcile row counts
→ disable `RUN_XLSX_IMPORT` and delete/archive the source file.

## Mapping decisions

- Synthetic receipt / voucher numbers guarantee uniqueness and idempotency.
- Monthly sheets are wide-pivot: 4-column `Date / RN / Amount / Mode` groups,
  with month & year read from the merged row-5 label (forward-filled).
- Expense `Item` → `payee`; category synonyms map e.g. "Stationary" → "Stationery"; unknown categories are created on the fly (e.g. "Exam").
- All students are assigned the active academic year (2025-2026) with `status = active`.
- The actor stamped on migrated fees/expenses is the seeded **admin** staff.
