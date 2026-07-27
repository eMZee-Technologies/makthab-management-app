# Makthab v3 — Multi-Database Support (Phase 1)

**Status:** Proposal / discussion document. Companion to [00-overview-and-prioritization.md](./00-overview-and-prioritization.md).
**Feeds into:** [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) (needs a network database to deploy), [04-multi-tenant-architecture.md](./04-multi-tenant-architecture.md) (needs Postgres for row-level security).

---

## 1. Executive summary

Makthab runs on SQLite today (`data/madrasa.db`, one file, Prisma 5 as the
ORM). That's the right choice for a single-tenant, single-machine app — it's
zero-ops and fast for local dev/tests. It stops being the right choice the
moment the app needs to run on more than one machine at once: SQLite has no
real concurrent-write story, no network protocol, no managed-backup story,
and no row-level security primitive — all of which [Phase 2](./02-cloud-deployment-aws.md)'s
cloud deployment and [Phase 4](./04-multi-tenant-architecture.md)'s multi-tenancy need.

This phase adds **PostgreSQL as the primary production target**, keeps
SQLite for local dev/tests (fast, zero-setup, no Docker required to run
`npm run dev`), and designs the data-access layer so a third provider
(MySQL, if ever needed) is an additional adapter, not a rewrite. The
honest complication — and the one a hand-wavy "just change an env var"
answer glosses over — is that **Prisma pins one database provider per
`schema.prisma` file**; there is no single schema that runs unmodified
against both SQLite and Postgres at the type/migration level. §2.2 below
is this document's actual design decision, not a footnote.

---

## 2. Architecture & design decisions

### 2.1 Repository/DAO abstraction over Prisma

Introduce a repository interface per entity (`StudentRepository`,
`FeePaymentRepository`, etc.) that routes/services depend on, instead of
importing the Prisma client directly everywhere. This buys two things:
(a) call sites don't care which provider is active, and (b) it's the seam
where provider-specific query differences (see §2.4) get isolated instead
of leaking into route handlers. See §4 for concrete interface sketches.

**Trade-off acknowledged:** this is an extra layer over Prisma, which
already is an abstraction. For a codebase this size, the cost is a modest
amount of boilerplate; the payoff is that route/service code (the majority
of the codebase) never imports `@prisma/client` types directly, so a future
provider change or even an ORM change stays contained to the repository
implementations. Given this phase explicitly plans for two live providers
(SQLite + Postgres) starting immediately, the abstraction pays for itself
right away rather than being speculative.

### 2.2 The real constraint: Prisma is one-provider-per-schema

Prisma's `datasource db { provider = "postgresql" }` block is static per
`schema.prisma`; you cannot point one generated Prisma Client at either
SQLite or Postgres by flipping `DATABASE_URL` alone — the client is
generated against a specific provider's SQL dialect and type mapping, and
`prisma migrate` output (the actual SQL in each migration) is
provider-specific from the first migration onward. Three real options,
evaluated honestly:

| Option | How it works | Verdict |
|---|---|---|
| **A. Two schema files, one shared source of truth** | Maintain `schema.prisma` as Postgres-canonical; generate a second `schema.sqlite.prisma` for dev/test via a small script that swaps the `datasource` block and adjusts the handful of type differences (see §2.4) | **Recommended.** Both are real Prisma schemas with real generated clients and real migrations; no exotic tooling. The generation script is the one piece of new infra, and it's small (a datasource-block swap plus a type-mapping table). |
| **B. Commit to Postgres everywhere, including local dev** | Drop SQLite entirely; local dev uses a Dockerized Postgres (or a shared dev instance) | Rejected **for now** — it removes the "just `npm install` and run" simplicity `CLAUDE.md` explicitly values, and makes CI slower (needs a Postgres service container even for the fastest unit tests). Revisit if option A's dual-schema maintenance proves to be more friction than a Docker Compose file for contributors. |
| **C. Prisma driver adapters (`@prisma/adapter-*`) / `driverAdapters` preview feature** | Prisma's newer driver-adapter model lets the same schema target different drivers at the connection level for some providers | Rejected as the primary mechanism today — as of Prisma 5, driver adapters are strongest for edge/serverless connection scenarios (e.g. Neon, PlanetScale via HTTP) and don't cleanly solve "one schema, SQLite or Postgres, chosen at runtime" for a standard Node server. Worth re-evaluating on a future Prisma upgrade, but designing around a preview feature as this phase's foundation is the wrong risk trade-off for a production migration. |

**Decision: Option A.** One canonical `server/prisma/schema.prisma` targeting
PostgreSQL (this becomes "the" schema — production, staging, CI integration
tests). A generated `server/prisma/schema.sqlite.prisma` (via a checked-in
generator script, not hand-maintained) serves local dev and fast unit
tests. Both are committed (the generated file included, like a lockfile) so
`npm install && npm run dev` keeps working with zero setup — SQLite stays
the zero-ops default for anyone just cloning the repo.

### 2.3 Runtime/build-time selection

`DATABASE_PROVIDER=postgresql|sqlite` (new env var, default `sqlite` for
local dev) selects which schema's generated client gets imported, resolved
at **build/start time**, not per-request:

```ts
// server/src/db/client.ts
const provider = process.env.DATABASE_PROVIDER ?? 'sqlite';
export const prisma = provider === 'postgresql'
  ? new (require('../../prisma/generated/pg-client').PrismaClient)()
  : new (require('../../prisma/generated/sqlite-client').PrismaClient)();
```

(Two `generator client { output = ... }` blocks, one per schema file, so
the two generated clients don't collide.) This is a process-startup
decision, matching how the app is actually deployed — one process, one
provider, for its whole lifetime. No request-level provider switching is
needed or designed for.

### 2.4 Schema/migration portability gotchas

Prisma Migrate generates provider-specific SQL, so migrations are **not**
interchangeable files — each schema variant keeps its own `migrations/`
history. The type/behavior differences that actually bite in practice, and
how this phase handles each:

| Concern | SQLite | PostgreSQL | Handling |
|---|---|---|---|
| Autoincrement PK | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL`/`IDENTITY` sequence | Prisma's `@id @default(autoincrement())` maps correctly on both — no schema change needed, just confirm both generated migrations are reviewed at each schema change |
| Case sensitivity on text comparison/sort | Case-insensitive by default (`BINARY`/`NOCASE` collation quirks) | Case-sensitive by default | Any `contains`/`equals` filter or `orderBy` on a text field (e.g. student name search) can behave differently — audit search/sort code paths (relevant to the recently-added Age-column sort work) and pin explicit `mode: 'insensitive'` where Postgres needs it |
| `DateTime` precision & timezone handling | Stored as ISO text/real, no native TZ awareness | Native `timestamp`/`timestamptz` | Standardize on UTC storage + `timestamptz` in Postgres (matches the existing UTC-safe `computeAge`/date-sort conventions already established in the codebase); the SQLite dev schema keeps behaving the same as long as the app-layer UTC discipline is followed everywhere, not just relied upon by the DB |
| `Decimal`/money fields | No native decimal type (stored as text/real, precision risk) | Native `NUMERIC`/`DECIMAL` | If fee/salary amounts are currently stored as `Float` or `Int` (cents), this phase should confirm the Postgres schema uses `Decimal`/`Numeric` for currency fields — a correctness improvement that comes essentially free with the migration, worth doing even though SQLite's dev schema keeps its current representation |
| Foreign key enforcement | Off by default unless `PRAGMA foreign_keys=ON` | Always enforced | Confirm Prisma's SQLite connector enables FK pragmas (it does by default in recent versions) so dev/test behavior matches Postgres's stricter enforcement — otherwise a bug (orphaned row) could pass locally and fail in CI/prod |
| Full-text/ILIKE search | `LIKE` only | `ILIKE`, trigram indexes available | Not currently used, but if search features grow, Postgres offers strictly more here — no portability tax for the Postgres-canonical direction |

**General migration discipline:** review Postgres migration SQL by eye at
each `prisma migrate dev` (against the canonical Postgres schema) —
don't assume the SQLite dev schema's behavior generalizes.

### 2.5 Connection pooling (Postgres)

Prisma Client's own connection pool is process-local and doesn't coordinate
across multiple ECS Fargate tasks — with N tasks each holding their own
pool, total connections to RDS can spike past `max_connections` limits on
small instance classes. Two real options:

| Option | Trade-off |
|---|---|
| **RDS Proxy** | Managed, pools/multiplexes connections across all app instances; adds a small per-hour cost and a touch of latency; simplest to operate (no extra container/process) |
| **PgBouncer** (self-run, e.g. as a sidecar or its own small ECS service) | Cheaper, more configurable (transaction vs. session pooling modes), but is one more thing to deploy/monitor |

**Decision:** start with **RDS Proxy** for Phase 2's single-tenant scale —
it's a checkbox in the RDS console/Terraform, not infrastructure to
operate. Revisit PgBouncer only if Phase 4's shared-schema multi-tenancy
(all tenants sharing one pool, per [04](./04-multi-tenant-architecture.md) §6) needs pooling
behavior RDS Proxy doesn't offer at that point.

### 2.6 ORM choice re-evaluation

**Staying on Prisma.** It already fits this codebase well (shared Zod
schemas pattern, generated types feeding `packages/shared`, existing team
familiarity per `CLAUDE.md`). Alternatives considered and rejected:

- **Drizzle ORM** — genuinely better multi-dialect story (one schema
  definition, SQL-dialect-aware query builder, no separate schema files
  per provider) — this is the strongest counter-argument to the Option A
  design in §2.2. Rejected for *this* phase specifically because it's a
  full rewrite of the data layer with no functional payoff beyond solving
  the multi-provider problem more elegantly; Option A solves the same
  problem with additive, reviewable changes to the existing Prisma setup.
  Worth a real bake-off if a future team finds the dual-schema-file
  approach too costly to maintain.
- **Knex/raw query builder** — this is literally the *deprecated*
  multi-tenant scaffold `CLAUDE.md` explicitly says not to resurrect.
  Rejected outright.
- **TypeORM** — no meaningful advantage over Prisma for this use case,
  loses the Zod-schema-generation synergy already built. Rejected.

---

## 3. Reference architecture (textual diagram)

```
┌─────────────────────────────────────────────────────────┐
│ Express routes (server/src/routes/*)                     │
│   - unchanged by this phase; still call service functions│
└───────────────────────┬───────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Service layer (business logic, role checks, PDF/Excel)   │
└───────────────────────┬───────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Repository interfaces (server/src/db/repositories/*.ts)  │
│   StudentRepository, FeePaymentRepository, ...            │
│   — the ONLY layer that imports a generated Prisma client │
└───────────────────────┬───────────────────────────────────┘
                         ▼
        ┌────────────────┴────────────────┐
        ▼                                  ▼
┌──────────────────────┐        ┌──────────────────────────┐
│ PostgresRepository    │        │ SqliteRepository          │
│ impl (Prisma pg client)│        │ impl (Prisma sqlite client)│
└──────────┬─────────────┘        └───────────┬───────────────┘
           ▼                                   ▼
   RDS PostgreSQL (prod/staging)        data/madrasa.db or
   via RDS Proxy                        data/test.db (dev/CI)
```

Chosen at process start via `DATABASE_PROVIDER` (§2.3); no per-request
branching anywhere in the stack above the repository layer.

---

## 4. API/DAO interface definitions

A small generic base plus entity-specific extensions, grounded in the
actual models (`Student`, `FeePayment`, `Attendance`, `Expense`, `Staff`,
`SalaryPayment`, `Class`, `AcademicYear`, `ExpenseCategory`, `User`,
`FeeStructure`):

```ts
// server/src/db/repositories/types.ts

export interface Repository<TEntity, TCreateInput, TUpdateInput, TWhere = Partial<TEntity>> {
  findById(id: number): Promise<TEntity | null>;
  findMany(where?: TWhere, opts?: { skip?: number; take?: number; orderBy?: unknown }): Promise<TEntity[]>;
  create(data: TCreateInput): Promise<TEntity>;
  update(id: number, data: TUpdateInput): Promise<TEntity>;
  softDelete?(id: number): Promise<void>; // Student already supports soft-delete per BUILD_CONTRACT.md
}

// server/src/db/repositories/student-repository.ts
import type { Student, Prisma } from '../generated/pg-client'; // or sqlite-client, per active provider

export interface StudentRepository
  extends Repository<Student, Prisma.StudentCreateInput, Prisma.StudentUpdateInput> {
  findByClass(classId: number): Promise<Student[]>;
  search(query: string): Promise<Student[]>; // must apply `mode: 'insensitive'` on Postgres, per §2.4
  computeAgeSortedList(direction: 'asc' | 'desc'): Promise<Student[]>; // wraps the existing dateOfBirth-based age sort with nulls-last handling
}

// server/src/db/repositories/fee-payment-repository.ts
export interface FeePaymentRepository
  extends Repository<FeePayment, Prisma.FeePaymentCreateInput, Prisma.FeePaymentUpdateInput> {
  findByStudent(studentId: number): Promise<FeePayment[]>;
  findDefaulters(academicYearId: number): Promise<Student[]>;
  recordPayment(input: RecordPaymentInput): Promise<FeePayment>; // wraps create + receipt PDF generation trigger
}
```

**Injection point:** a single `server/src/db/index.ts` module resolves the
active provider's concrete repository implementations once at startup and
exports them; route/service code imports from there, never from a
provider-specific path directly:

```ts
// server/src/db/index.ts
import { provider } from './client';
import * as pg from './repositories/postgres';
import * as sqlite from './repositories/sqlite';

const impl = provider === 'postgresql' ? pg : sqlite;
export const studentRepository: StudentRepository = impl.studentRepository;
export const feePaymentRepository: FeePaymentRepository = impl.feePaymentRepository;
// ... one export per entity
```

In practice, since both implementations wrap the same Prisma query API
shape, most of `postgres/student-repository.ts` and `sqlite/student-repository.ts`
are near-identical — the split exists for the handful of places §2.4's
table calls out (search case-sensitivity, decimal handling), not because
every method needs two different implementations.

---

## 5. Cloud deployment considerations

### 5.1 RDS PostgreSQL vs. Aurora PostgreSQL Serverless v2

| | RDS PostgreSQL (provisioned, e.g. db.t4g.micro/small) | Aurora Serverless v2 |
|---|---|---|
| Cost model | Fixed hourly + storage, predictable | Scales 0.5-N ACUs with load, pay for what's used |
| Right fit for | Phase 2's single-tenant, low/steady traffic | Phase 4's multi-tenant, spikier/growing traffic |
| Cold-start/scale-to-zero | N/A (always on) | Can scale down but not to true zero without added latency risk |
| Ops complexity | Slightly simpler mental model | Slightly more moving parts (capacity units, scaling policy) |

**Recommendation:** start on **RDS PostgreSQL, db.t4g.micro** (Phase 2,
single-tenant) — cheapest, simplest, entirely adequate for the realistic
load in §5.2. Migrate to **Aurora Serverless v2** only when Phase 4's
multi-tenant traffic pattern (many small tenants, variable load) makes
its autoscaling genuinely pay for itself — don't pre-pay for Aurora's
flexibility before there's a workload that needs it.

### 5.2 Non-functional requirements (right-sized, not enterprise-inflated)

This app serves **one Madrasa's office** today — realistically single-digit
concurrent users (an Admin, an Accountant, a couple of Teachers marking
attendance) with bursty load around fee-collection days and report
generation. Even a "grows to dozens of tenants" Phase 4 future is still a
small-business-software workload, not a consumer-scale one:

| NFR | Phase 2 target (single-tenant) | Phase 4+ target (multi-tenant, dozens of orgs) |
|---|---|---|
| Sustained TPS | <5 write TPS, <20 read TPS | <50 write TPS, <200 read TPS |
| Peak burst (report generation) | ~10 concurrent report jobs | ~50 concurrent report jobs |
| API p95 latency (list/detail) | <300ms | <300ms (same target — Postgres/RDS Proxy scale before this needs to move) |
| Report generation (PDF/Excel) | <2s | <2s per report; queued if concurrency spikes (not designed in this phase — flag for Phase 4 if it becomes real) |
| DB connections needed | <10 concurrent (well under RDS Proxy or even direct Prisma pool limits) | <50 concurrent, RDS Proxy pooling required |

These numbers exist to right-size instance classes (§5.1) and pooling
(§2.5) — not as marketing claims. Re-measure against real usage once
Phase 2 is live rather than trusting these estimates indefinitely.

### 5.3 Network isolation & IAM

Consumed from [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) §2.5 — RDS in a private
data subnet, security group allowing inbound only from the ECS task
security group on 5432, no public endpoint. For database authentication,
prefer **IAM database authentication** for any human/operational access
(e.g. a one-off admin query) over long-lived DB passwords, while the
**application's** connection uses a Secrets-Manager-stored password
(rotated per [03-security.md](./03-security.md) §6) via RDS Proxy — IAM auth token
lifetimes (15 min) don't fit a long-running app connection pool well, so
this is a deliberate split: humans use IAM auth, the app uses a rotated
secret.

### 5.4 Cost estimate

Already covered in [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) §6's cost tables
(RDS db.t4g.micro ~$15-25/mo single-tenant; Aurora Serverless v2
~$50-200/mo usage-dependent post-Phase-4) — not duplicated here to avoid
the two docs drifting out of sync; that doc owns the cost numbers.

---

## 6. Migration/implementation plan (target: 4-6 weeks)

| Week | Milestone |
|---|---|
| 1 | Canonical `schema.prisma` (Postgres) finalized; write the schema-generation script producing `schema.sqlite.prisma`; confirm both generate working Prisma clients locally |
| 1-2 | Repository interface layer introduced (§3-4); existing route/service code refactored to call repositories instead of the Prisma client directly — mechanical but touches every domain module (students, fees, attendance, expenses, staff/salaries) |
| 2-3 | Postgres-specific fixes applied per §2.4's gotcha table (case-insensitive search, `Decimal` for money fields, `timestamptz` handling); local Postgres (Docker) used to validate against a real instance before touching RDS |
| 3-4 | `DATABASE_PROVIDER` env var + startup client-selection logic (§2.3); CI updated to run the Jest integration suite against **both** providers (§8) |
| 4-5 | Data migration tool: adapt the existing idempotent pattern from `server/prisma/migrate-from-xlsx.ts` (already proven — see `docs/migration/MIGRATION.md`) into a `migrate-sqlite-to-postgres.ts` script: read every table from the SQLite DB, upsert into Postgres, verify row counts and spot-check financial totals (fee sums, salary sums) match exactly before/after |
| 5-6 | Dry-run migration against a copy of production `data/madrasa.db` into a scratch RDS instance; full smoke test (login → admit student → collect fee → attendance → expense → reports) against the migrated Postgres data; cutover plan written for [Phase 2](./02-cloud-deployment-aws.md)'s deployment |

**Note on what "production data" actually means here.** `data/madrasa.db` is not
fixture data — it's the real Masjid's operational record, already imported once via
`migrate-from-xlsx.ts` from `docs/source-data/Maktab Detailed - Report.xlsx` (69
students: 36 from "Admission Details" + 33 backfilled from fee sheets, 672 fee
records — see `docs/migration/MIGRATION.md`). That xlsx is the ultimate reference
dataset, not the SQLite file. This matters for the *first* production cutover
specifically (subsequent deployments just carry forward whatever's live in
Postgres by then):

- **Row-count/sum parity between SQLite and Postgres is necessary but not
  sufficient.** It proves the copy tool didn't corrupt data; it doesn't prove
  the *original* xlsx import was complete. Week 4-5's validation should
  additionally reconcile against the xlsx directly (known totals above), not
  just against SQLite as if it were ground truth.
- **A second, simpler path exists and is worth considering instead of/alongside
  the copy tool:** once the `DATABASE_PROVIDER` switch (§2.3) lands, the
  already-proven, already-idempotent `migrate-from-xlsx.ts` can be pointed at a
  Postgres `DATABASE_URL` and re-run directly against a fresh RDS instance —
  no SQLite-to-Postgres copy tool needed at all for the *first* cutover. This
  avoids writing and trusting a second migration tool for a one-time job; the
  `migrate-sqlite-to-postgres.ts` copy tool remains useful for later
  re-migrations of whatever *new* data has since been entered through the app
  (which only exists in SQLite, not the xlsx). Decide which path to use for
  cutover once Phase 2's target RDS instance exists — either is compatible
  with this plan.
- Whichever path is used, the go-live checklist in
  [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) §11 must reconcile
  the loaded data against the xlsx-derived counts before cutover, not just
  against SQLite.

---

## 7. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| First production cutover loads incomplete/stale data because the team treats `data/madrasa.db` as the source of truth instead of reconciling against the original `docs/source-data/Maktab Detailed - Report.xlsx` | Low-Medium | High (this is the one real Masjid's actual student/fee history — a silent gap wouldn't be caught by a synthetic test) | Reconcile the loaded dataset against xlsx-derived counts (69 students, 672 fees) as an explicit go-live gate (§6, week 5-6), not just SQLite↔Postgres parity — see the note in §6 |
| Case-sensitivity difference silently changes search/sort results between SQLite (dev) and Postgres (prod) | Medium | Medium | Explicit `mode: 'insensitive'` audit (§2.4) + integration tests that assert specific case-mixed search results, run against both providers |
| Money fields lose precision if left as `Float` during migration | Low-Medium | High (financial data) | Explicit schema review converting fee/salary amount fields to `Decimal`/`Numeric` as part of the Postgres schema, verified by a migration script row-count *and* sum-total check (§6, week 4-5) |
| Dual-schema-file maintenance (§2.2 Option A) drifts out of sync over time as new migrations are added | Medium | Medium | Generation script (not hand-editing) keeps `schema.sqlite.prisma` derived from the canonical file; CI fails if the generated file is stale relative to the canonical schema (a simple diff check) |
| RDS Proxy connection limits underestimated | Low | Medium | §5.2's NFR table sizes this conservatively; load-test (per [02](./02-cloud-deployment-aws.md) §10) before declaring the phase done |
| Migration script corrupts or drops financial records during SQLite→Postgres cutover | Low | Critical | Dry-run against a copy of production data first (§6 week 5-6), never against live data directly; keep the SQLite file as an untouched rollback source until Postgres is verified in production for a full billing/fee cycle |

---

## 8. Testing plan

- **Dual-provider CI matrix:** the existing Jest integration suite
  (`npm run test -w server`) runs twice in CI — once against SQLite
  (`DATABASE_URL="file:./test.db"`, current default) and once against a
  Postgres service container (`DATABASE_URL="postgresql://..."` pointed at
  the CI-provisioned Postgres, `DATABASE_PROVIDER=postgresql`). Any test
  passing on one provider and failing on the other is exactly the class of
  bug §2.4 exists to prevent, and this is what catches it before deploy.
- **Migration script tests:** the `migrate-sqlite-to-postgres.ts` tool gets
  its own test — run it against a small fixture SQLite DB with known data,
  assert every row lands correctly in the target Postgres schema, including
  edge cases already known to matter in this codebase (null `dateOfBirth`
  values per the existing nulls-last age-sort work, soft-deleted students).
- **Financial-integrity check:** after any migration run (test fixture or
  real dry-run), sum every `FeePayment.amount` and `SalaryPayment.amount`
  in both source and target and assert exact equality — a cheap, high-value
  check given the stakes of getting financial data wrong.
- **Contract/typecheck:** `npm run typecheck` must stay green across all
  three workspaces throughout — the repository interface refactor (§6
  week 1-2) is the riskiest change to typecheck cleanly since it touches
  the most call sites; land it as its own PR before the Postgres-specific
  changes, so a typecheck failure is easy to bisect.
