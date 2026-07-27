# Phase 4 — Multi-Tenant Architecture

**Builds on:** [01-multi-database-support.md](./01-multi-database-support.md) (Postgres),
[02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) (ECS Fargate + RDS + S3),
[03-security.md](./03-security.md) (IAM/KMS/Secrets Manager baseline).
**See also:** [00-overview-and-prioritization.md](./00-overview-and-prioritization.md) for the
overall attack order and phase framework this document follows.

---

## 1. Executive summary

This is the highest-risk, most speculative phase in the whole plan, and it
should be read that way. The overview doc's §0 already flags that the entire
brief is a pivot from "software for one Madrasa" to "SaaS sold to many
Masajid" — nowhere is that more true than here. Everything in this document
is buildable, but **do not start it until §6.1 of the overview
(confirmed multi-Masjid demand) is actually true.** If it isn't, Phases 1-3
plus the UI track already ship a materially better single-tenant product;
building tenancy on spec ahead of a second customer is the single biggest
line item in the global risk register (overview §8, "Multi-tenancy is built
but never sold").

With that caveat stated once: if the business case is confirmed, this phase
converts Makthab from a hard-coded single organization into a system that
can host N independent Masajid, each with isolated data, independent
branding, independent staff/roles, and independent billing, while sharing
one application deployment and one database cluster for operational
efficiency.

**Correction to the overview doc's baseline note:** the overview
characterizes the current `OrgProfile` model as "multi-row branding." Having
read `server/prisma/schema.prisma` directly, that's not quite right — it's a
**single-row-by-convention** table (`id: 1`), and its own schema comment
already names the seam: *"the seam for future multi-tenancy — add a
`tenantId` FK here... and scope the lookup by `req.tenantId` instead of 'the
one row'."* That comment is effectively a note-to-self from the team that
built it, and this document is the design that fulfills it. Similarly, the
`Role` model (commit `1551`) is DB-backed with JSON permission sets and
`isSystem` seed rows (Admin/Accountant/Teacher) — a good foundation, but
`Role.name` is currently globally unique, which needs to change for tenancy
(§3.3).

---

## 2. Tenancy model decision matrix

Three standard models, scored against this app's actual shape: ~9-10
Prisma models, financial + minor (student) data, an existing single-tenant
schema to migrate from, and a plausible customer count in the tens-to-low-
hundreds of Masajid (not thousands) even at optimistic growth.

| Model | Isolation strength | Migration cost from current schema | Operational complexity | Per-tenant infra cost | Blast radius of a bug |
|---|---|---|---|---|---|
| **A. Shared DB, shared schema** (`tenantId` column on every table) | Medium — enforced entirely by query correctness unless paired with RLS | **Low** — add a column, backfill, index. No schema-per-tenant tooling needed. | **Low** — one schema to migrate, one connection pool, standard Prisma workflow | **Lowest** — tenants share compute and DB instance | High if unmitigated (one bad `WHERE` clause = cross-tenant leak); mitigated to Low with RLS (see §3.2) |
| **B. Shared DB, separate schema per tenant** (Postgres `CREATE SCHEMA tenant_x`) | High — Postgres enforces schema boundaries natively | High — Prisma has no native "one schema per tenant, N tenants, dynamically" story; requires either N generated Prisma Client instances or raw SQL schema-switching, plus a migration runner that applies every migration to every tenant schema | High — provisioning = running the full migration set per new tenant; connection pooling gets awkward (pool per schema, or `search_path` juggling per request) | Medium — still one DB instance, but per-schema migration/backup tooling overhead scales with tenant count | Medium — a schema-switching bug can still leak across schemas if `search_path` is set wrong |
| **C. Separate database per tenant** | Highest — full engine-level isolation, can even live on different RDS instances | Highest — no code change to the schema itself, but application needs a tenant→connection-string router, and "list all tenants" cross-cutting admin queries become fan-out queries across N databases | Highest — N databases to patch, back up, monitor, and pay for individually; migrations must be run N times | Highest — either N small RDS instances (expensive at idle) or N databases on shared instances (loses some isolation benefit anyway) | Lowest, but the operational surface (N things to get right) creates its own risk |

### Recommendation: start with **Model A (shared schema) + Postgres Row-Level
Security as a second, DB-enforced layer**, with a documented escape hatch to
Model C for a single outlier tenant later.

Rationale:
- Model A has by far the lowest migration cost from the current schema — it
  is additive (`tenantId` columns + indexes), not a schema topology change.
  Given this app's realistic tenant count (tens, not thousands), Model B's
  extra operational complexity buys isolation the app doesn't clearly need,
  while Model C's per-tenant cost doesn't make sense until a tenant is large
  enough or sensitive enough to justify dedicated infrastructure (e.g. a
  future enterprise customer with a data-residency requirement).
- The one real weakness of Model A — "isolation is only as good as every
  query's `WHERE tenantId = ?`" — is exactly what Postgres RLS is for: a
  policy enforced by the database engine itself, so a missed filter in
  application code fails closed instead of leaking data. This is standard
  "defense in depth," not an either/or with careful application code — do
  both (§3.2).
- **Hybrid escape hatch:** because the `tenantId`-column design is identical
  regardless of which physical database a row lives in, a specific tenant
  can be migrated later to its own RDS instance (Model C) without changing
  application code — only the connection-routing layer changes for that one
  tenant. Document this now so it's a known lever, not a redesign, if a
  future customer needs it (e.g. a large tenant hitting noisy-neighbor
  limits, or a contractual isolation requirement).

---

## 3. Architecture & design decisions

### 3.1 Tenant identification: subdomain-per-tenant

Use `{tenant-slug}.makthab.app` (e.g. `masjid-umar.makthab.app`), resolved
at the edge (CloudFront/ALB → API middleware extracts the subdomain and
resolves it to a `tenantId` via a small, heavily-cached `Tenant` lookup
table).

Trade-off considered and rejected: a path prefix (`makthab.app/masjid-umar/`)
or a header-based scheme. Subdomain wins here because (a) it lets each
tenant's white-labeled UI (Phase 5's theming) feel like *their* installation
rather than a shared multi-tenant app with a URL-embedded slug, which
matters for a product being sold to religious institutions who value having
"their own" system, and (b) it keeps API route paths identical to today's
(`/api/v1/students`, etc.) — no path-prefix stripping logic threaded through
every route, which reduces the chance of a routing bug becoming a tenant
isolation bug.

### 3.2 Data isolation: `tenantId` column + Prisma Client Extension + Postgres RLS

Two independent, stacked layers — neither alone is sufficient:

**Layer 1 — application-enforced, via Prisma Client Extensions.** Prisma
does not have first-class multi-tenancy middleware (the older
`$use()` middleware API is deprecated in favor of Client Extensions as of
Prisma 5, which is what this app already runs). Build a request-scoped
Prisma Client Extension that:
- Auto-injects `tenantId: ctx.tenantId` into every `where` clause on
  tenant-scoped models, for `find*`, `update*`, `delete*`, `count`, `aggregate`.
- Auto-injects `tenantId: ctx.tenantId` into every `create`/`createMany`
  payload.
- Throws (fails closed) if a query somehow reaches the DB layer without a
  resolved `tenantId` in request context.

This is safer than hand-writing `where: { tenantId, ... }` on ~40+ query
call-sites across `server/src/routes/*`, which is exactly the kind of
repetitive, easy-to-forget pattern that produces the "Cross-tenant data
leak" entry in the overview's global risk register.

**Layer 2 — database-enforced, via Postgres RLS.** Independent of whether
the application layer gets it right, enable RLS on every tenant-scoped
table and set a session variable (`SET app.current_tenant_id = $1`) at the
top of each request/transaction. Example policy:

```sql
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Student"
  USING ("tenantId" = current_setting('app.current_tenant_id')::int)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id')::int);
```

Applied identically (mechanically, via a migration-generation script — not
hand-written per table) to `Student`, `FeePayment`, `Attendance`, `Expense`,
`Staff`, `SalaryPayment`, `SalaryPayment`, `Class`, `Category`,
`AcademicYear`, `ExpenseCategory`, `FeeStructure`, `OrgProfile`, `User`.
This means even a raw SQL query, an admin script, or a future engineer who
bypasses the Prisma extension cannot cross tenant boundaries — the failure
mode becomes "query returns zero rows" rather than "query returns another
tenant's financial records."

**Connection pooling implication:** setting a per-request session variable
means the DB connection carrying that session cannot be silently reused for
a different tenant's request without resetting it first — this affects how
RDS Proxy / pgbouncer pooling is configured. Use **transaction-mode
pooling** (reset session state between transactions, which RDS Proxy and
pgbouncer both support) rather than a naive "session pooling" mode, and set
`app.current_tenant_id` inside the same transaction as the query, not as a
separate connection-level `SET`.

### 3.3 Roles become tenant-scoped

Today, `Role.name` is globally `@unique` (Admin/Accountant/Teacher seeded
as `isSystem` rows, per schema comment on `Role`). Two changes:
- Add `tenantId` to `Role`, change the uniqueness constraint to
  `@@unique([tenantId, name])`.
- Keep the three system roles as a **template seeded per tenant at
  provisioning time** (§6), not shared global rows — this lets a future
  tenant customize a role's permission set without affecting others, while
  still starting every tenant with the same Admin/Accountant/Teacher
  baseline the app already ships.
- `User.role` continues to store the role name; resolution to a permission
  set becomes `(tenantId, roleName) → permissions` instead of just
  `roleName → permissions`.

### 3.4 JWT claims carry tenant context

Add `tenantId` (and `tenantSlug`, to avoid a lookup on every request) to the
JWT payload at login. `requireAuth` middleware sets `req.tenantId` from the
verified token; this is the value both the Prisma Client Extension (§3.2
Layer 1) and the RLS session variable (§3.2 Layer 2) consume. Reject any
token whose `tenantId` doesn't match the resolved subdomain's tenant (§3.1)
— this specifically prevents a stolen/replayed token for Tenant A being
used against Tenant B's subdomain.

### 3.5 `OrgProfile` becomes the tenant's branding row

Per the schema comment already in the codebase, `OrgProfile` gains
`tenantId` and stops being a singleton-by-convention — one row per tenant,
looked up by `req.tenantId` instead of "the row with `id: 1`." This is the
integration point with Phase 5's white-label theming (logo, header image,
institution name/address already exist on this model; colors/theme tokens
would be new fields added in Phase 5).

---

## 4. Reference architecture diagram (textual)

```
Browser: masjid-umar.makthab.app
        │
        ▼
CloudFront (Phase 2) ──▶ ALB ──▶ ECS Fargate task (Express API)
        │                              │
        │                     1. Extract subdomain → tenant slug
        │                     2. Look up tenantId (cached: Class/
        │                        AcademicYear-style reference-data
        │                        cache, see §7)
        │                     3. requireAuth: verify JWT, confirm
        │                        token.tenantId === resolved tenantId
        │                     4. Prisma Client Extension injects
        │                        tenantId into every query (§3.2 L1)
        │                     5. BEGIN; SET app.current_tenant_id;
        │                        run query; COMMIT  (§3.2 L2, via
        │                        RDS Proxy, transaction-mode pooling)
        │                              │
        │                              ▼
        │                     RDS PostgreSQL (Phase 1)
        │                     — RLS policies enforce tenant boundary
        │                       even if step 4 is bypassed
        │
        └──▶ S3 (Phase 2) — objects under
             s3://makthab-files/{tenantId}/receipts/...
             s3://makthab-files/{tenantId}/payslips/...
             s3://makthab-files/{tenantId}/reports/...
             s3://makthab-files/{tenantId}/photos/...
             (bucket policy / IAM condition keys scope access by prefix,
              same defense-in-depth principle as RLS for the DB)
```

---

## 5. Data partitioning strategy

- **Column placement:** `tenantId Int` (FK to a new `Tenant` model) added to
  every model currently listed in `schema.prisma` except pure reference
  data that's genuinely global across the whole product (there isn't much —
  even `ExpenseCategory` and `Category` need to become tenant-scoped, since
  different Masajid will want different category lists; only the
  `PERMISSION_CATALOG` constant in `@makthab/shared` stays global, since
  it's code, not data).
- **New `Tenant` model:** `id`, `slug` (unique, used for subdomain
  resolution), `name`, `status` (active/suspended/offboarding), `createdAt`,
  plan/billing fields as needed later.
- **Indexing:** every tenant-scoped table gets `tenantId` as the **leading
  column** of its primary lookup indexes, e.g. `@@index([tenantId, status])`
  on `Student` (currently just `@@index([status])`), `@@index([tenantId,
  feeYear, feeMonth])` on `FeePayment`. This matches the query pattern
  every request will actually use (always filtered by tenant first) and
  keeps index scans cheap as tenant count grows — without this, a global
  index on `status` alone gets progressively less selective as more
  tenants' data accumulates in the same table.
- **Unique constraints need `tenantId` prefixed in:** `Student.admissionNo`,
  `FeePayment.receiptNo`, `Expense.voucherNo`, `Class.name`,
  `Category.name`, `AcademicYear.name`, `ExpenseCategory.name`,
  `Role.name` (§3.3), `User.username`/`User.email` — every one of these is
  currently globally unique and must become `@@unique([tenantId, x])`,
  otherwise Tenant B can't reuse "LKG" as a class name or "admin" as a
  username just because Tenant A already has one. This is the single
  largest mechanical change in the migration (§8).
- **RLS policy design:** see §3.2 for the canonical policy shape; generate
  one per tenant-scoped table via a small script rather than hand-writing
  ~13 nearly-identical policies (reduces the chance of one table being
  missed — a missed RLS policy is silently no worse than today, but it's a
  gap worth catching with a CI check, see §10).
- **Connection pooling:** RDS Proxy in transaction-mode pooling (§3.2),
  sized for the concurrency profile described in
  [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) — this doc
  doesn't re-derive those numbers, just notes that pool sizing needs
  revisiting once real tenant-count/concurrency assumptions exist, since
  "N tenants sharing a pool" behaves differently under load than the
  single-tenant baseline that doc sizes for.

---

## 6. Tenant provisioning / onboarding & offboarding

### Onboarding (target: fully scriptable, manual trigger initially; self-serve UI is Phase 4c, see §8)

1. Create `Tenant` row (slug, name, status = `provisioning`).
2. Seed reference data scoped to the new `tenantId`, following the exact
   pattern the app already uses for its single-tenant seed (academic years,
   classes, expense categories) — reuse that seed script's structure,
   parameterized by `tenantId` instead of hard-coded.
3. Seed the three system `Role` rows (Admin/Accountant/Teacher) with the
   default `PERMISSION_CATALOG`-derived permission sets, scoped to the new
   `tenantId` (§3.3).
4. Create the initial `Staff` + `User` (Admin role) record for the
   customer's first login; deliver credentials out-of-band (not email,
   given no email infra is assumed yet — matches the app's existing
   WhatsApp-first communication pattern).
5. Create an `OrgProfile` row for the tenant (§3.5) — name/address at
   minimum; branding assets added by the customer post-login.
6. Provision the S3 prefix (`s3://makthab-files/{tenantId}/...`) — no
   explicit "creation" needed for an S3 prefix, but apply/verify the IAM
   bucket policy condition scoping access to it (Phase 3's security
   baseline).
7. Register the subdomain (`{slug}.makthab.app`) — either a wildcard
   CloudFront/ALB config (provisioned once, covers all tenants) or a
   per-tenant DNS record, depending on what Phase 2's actual CloudFront
   setup allows; prefer the wildcard approach so onboarding doesn't require
   an infra change per tenant.
8. Flip `Tenant.status` to `active`.

### Offboarding

1. Flip `Tenant.status` to `suspended` immediately (blocks login via the
   tenant-resolution check in §3.1/3.4) if this is an involuntary/non-payment
   offboarding; skip straight to step 2 for a voluntary customer-initiated
   export.
2. **Data export:** generate a full export of the tenant's data — reuse the
   app's existing Excel report infrastructure (ExcelJS is already a
   dependency for reports) rather than building new export tooling; a
   "full data dump" is a natural extension of the existing per-report Excel
   generation, one workbook per entity or one multi-sheet workbook.
3. Deliver the export to the customer (a signed, time-limited S3 URL is
   simplest given files are already in S3 post-Phase-2).
4. **Retention window:** hold the tenant's data (DB rows + S3 objects) for
   a defined period post-offboarding (align this with whatever [03-security.md](./03-security.md)'s
   compliance section lands on for data-retention policy — this doc doesn't
   set that number, since it's a compliance/legal decision, not an
   architecture one — but a reasonable operational default is 30-90 days
   before hard deletion, giving the customer a recovery window).
5. **Hard deletion:** after the retention window, delete the tenant's rows
   (a `tenantId`-scoped cascade delete, or a scripted per-table delete) and
   the S3 prefix. Log the deletion event (who/when/why) for audit purposes.

---

## 7. Scalability patterns

- **Autoscaling:** ECS Fargate service auto-scaling (established in Phase 2)
  with target-tracking policies on CPU utilization and ALB request count
  per target — this doesn't change structurally for multi-tenancy, since
  all tenants share the same Fargate service/task pool in Model A. The
  thing that *does* change is capacity planning: size baseline task count
  and scaling thresholds off aggregate multi-tenant load, not the
  single-tenant baseline Phase 2 was sized for.
- **Caching:** the app's genuinely global-ish reference data (per tenant:
  `Class`, `Category`, `AcademicYear`, `ExpenseCategory`, `Role`
  permission sets, `OrgProfile` branding) changes rarely and is read on
  nearly every request (e.g. every student list render needs class names).
  Cache these per-tenant with a short TTL or explicit invalidation on
  write (an in-process LRU cache is enough at this scale; do not reach for
  ElastiCache/Redis until there's a measured need — matches the overview's
  "don't over-engineer for an app this size" principle). **Financial data
  (`FeePayment`, `SalaryPayment`, `Expense`) and `Student`/`Attendance`
  records are not cached** — they're written frequently and correctness
  matters more than shaving a query.
- **Per-tenant rate limiting:** protect against one noisy or misbehaving
  tenant (buggy integration, scraping, or a runaway report-generation loop)
  degrading service for others. Implement a token-bucket limiter keyed by
  `tenantId` at the Express middleware layer (a small, well-understood
  library-based approach is sufficient here — no need for API-Gateway-level
  throttling given the ALB→Fargate architecture from Phase 2). Set limits
  generously for normal usage (this app's per-tenant traffic is inherently
  low — a school office, not a high-traffic consumer app) and alert (not
  just block) when a tenant approaches its limit, since it's more likely a
  bug than abuse at this product's scale.
- **Observability per tenant:** tag CloudWatch log entries and custom
  metrics with `tenantId` (structured logging, not just free text) so
  per-tenant dashboards and noisy-neighbor detection are queryable without
  re-architecting logging later. This is cheap to add now and expensive to
  retrofit — treat it as part of Phase 4's definition of done, not a
  follow-up.

---

## 8. Migration/implementation plan

Fits the overview's **8-12 week** window for Phase 4, split into four
sub-phases so risk is introduced incrementally rather than in one big-bang
migration:

| Sub-phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| **4a — Additive schema change** | 1-3 | Add `tenantId` (nullable) to every model in §5; create `Tenant` model; backfill every existing row with a single `Tenant` record representing the current live Masjid, so the running app doesn't break mid-migration. Add composite indexes. | App still runs exactly as today (single implicit tenant), `tenantId` present but not yet enforced. |
| **4b — Enforcement** | 3-6 | Make `tenantId` `NOT NULL`; ship the Prisma Client Extension (§3.2 L1); enable RLS policies (§3.2 L2) table-by-table with a verification query after each; update all `@unique` constraints (§5) to be tenant-prefixed; add `tenantId`/`tenantSlug` to JWT (§3.4); wire subdomain resolution (§3.1). | The existing single tenant continues working end-to-end through the new tenant-aware path; the cross-tenant isolation test suite (§10) exists and passes trivially (only one tenant exists, but the plumbing is exercised). |
| **4c — Provisioning + a second real tenant** | 6-9 | Build the onboarding script (§6) — CLI/admin-triggered is enough for now, a self-serve UI is a later product decision, not an architecture requirement of this phase; provision a genuine second tenant (even a demo/staging one) end-to-end; run the isolation test suite (§10) against real two-tenant data for the first time. | Two tenants coexist with verified isolation; onboarding runbook is documented and repeatable. |
| **4d — Scale/ops hardening** | 9-12 | Per-tenant rate limiting, autoscaling threshold review, per-tenant observability tagging (§7); offboarding workflow (§6) implemented and dry-run tested. | Phase 4 exit criteria from the overview's §5 table met: isolation tests in CI, rate limits + autoscaling live. |

---

## 9. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Cross-tenant data leak** (missed `tenantId` filter, RLS policy gap, or subdomain-spoofing) | Low-Med during 4b, should trend to Low after | Critical | Two independent enforcement layers (§3.2); automated isolation test suite in CI (§10) as a hard gate, not just a manual QA pass; code-review checklist item requiring any new table/query to justify its tenant-scoping. |
| **A missed `@@unique` constraint** blocks a second tenant from using a name the first tenant already used (e.g. class "I") | Medium during 4b | Medium (functional bug, not a security leak) | Enumerate every current `@unique`/`@@unique` in `schema.prisma` explicitly (done in §5) and treat each as a checklist item during 4b, not something to catch ad hoc. |
| **RLS session-variable leak across pooled connections** (a connection reused for Tenant B without resetting `app.current_tenant_id`) | Low, but high-severity if it happens | Critical | Transaction-mode pooling (§3.2) specifically to avoid this class of bug; add a regression test that opens two rapid concurrent requests from different tenants and asserts no cross-contamination. |
| **Provisioning script drifts from the real seed requirements** as the schema evolves post-launch (someone adds a new reference-data table and forgets to update onboarding) | Medium over time | Medium | Keep the provisioning script co-located with and derived from the same seed logic the single-tenant app already uses (§6 step 2), rather than a hand-maintained duplicate. |
| **Multi-tenancy ships but isn't sold** | Medium | High (wasted engineering spend) | Already the top entry in the overview's global risk register — the mitigation is sequencing (confirm demand before starting this phase at all), not anything inside this document's technical design. |

---

## 10. Testing/validation plan

The **cross-tenant isolation test suite is the centerpiece** of validating
this phase — more important than conventional feature test coverage, given
what's at stake (financial + minor data for potentially many independent
customers on shared infrastructure).

**What it tests, concretely:**
- Provision two test tenants (Tenant A, Tenant B) with distinct data:
  students, fee payments, attendance, expenses, staff, salary payments,
  roles, and an `OrgProfile` row each.
- Authenticate as a Tenant A user (Admin role, to rule out permission
  checks masking a tenancy bug).
- For **every** API endpoint the app exposes (walk the full route table —
  students, fees, attendance, expenses, staff, salaries, reports,
  reference/classes/academic-years/expense-categories, dashboard,
  admin/backup, auth), attempt to read, update, and delete Tenant B's
  record IDs using Tenant A's authenticated session.
- **Expected result for every single one: 403 or 404, never 200 and never
  Tenant B's data in the response body.** Any endpoint returning Tenant B
  data, or successfully mutating/deleting it, is a release-blocking failure.
- Additionally test the **list/search endpoints** specifically (not just
  get-by-id) — confirm Tenant A's student list, defaulters report, etc.
  never contains a Tenant B row, since list endpoints are the easiest place
  to miss a filter.
- Test the **JWT/subdomain mismatch** case from §3.4 directly: a valid
  Tenant A token presented against Tenant B's subdomain must be rejected.
- Test the **RLS layer in isolation** from the application layer: run a raw
  SQL query (bypassing Prisma entirely, simulating "what if the app-layer
  filter has a bug") with the RLS session variable set to Tenant A, and
  confirm zero Tenant B rows are returned — this is what proves Layer 2
  (§3.2) is actually load-bearing and not just theoretical defense-in-depth.

**Where it runs:** added to the existing Jest integration suite pattern
(`server/`, run via `DATABASE_URL=... npx jest`, per `CLAUDE.md`), and per
the overview's §7 success metrics, **must run in CI on every PR that
touches a data-access path** (routes, Prisma schema, the Client Extension
itself) — not just before release. Treat a failure here with the same
severity as a broken build, not a flaky test to retry.

**Non-functional validation:** once 4c's second real tenant exists, run the
same load-test approach [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md)
defines for the single-tenant baseline, but with concurrent traffic from
both tenants simultaneously, to validate the rate-limiting (§7) and
connection-pool-sizing assumptions (§5) under realistic multi-tenant
concurrency rather than assuming they hold.
