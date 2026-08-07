# Phase 4 — Multi-Tenant Architecture & Migration Plan

**Status:** Architecture decision + executable migration plan (proposal).
**Builds on:** [01-multi-database-support.md](./01-multi-database-support.md) (Postgres),
[02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) (ECS Fargate + RDS + S3),
[03-security.md](./03-security.md) (IAM/KMS/Secrets Manager baseline).
**See also:** [00-overview-and-prioritization.md](./00-overview-and-prioritization.md) for the
overall attack order and phase framework this document follows.
**Baseline contract:** [BUILD_CONTRACT.md](../BUILD_CONTRACT.md) (single-tenant today).

---

## 1. Executive summary — recommended approach

Convert Makthab from a hard-coded single organization into a **shared-schema,
row-isolated multi-tenant SaaS** hosted on one application deployment and one
Postgres cluster, with **Postgres Row-Level Security (RLS)** as a second
enforcement layer and a **platform Super Admin** control plane for tenant
lifecycle, quotas, and feature toggles.

| Decision | Choice |
|---|---|
| Tenancy model | **Shared DB + shared schema + `tenantId` column** (Option A) |
| Isolation | Application Prisma Client Extension **and** Postgres RLS |
| Escape hatch | Dedicated DB/RDS per outlier tenant later (same `tenantId` code path) |
| Tenant resolution | Subdomain `{slug}.makthab.app` → cached `Tenant` lookup |
| Control plane | New **Super Admin** (platform) role, separate from tenant Admin |
| Migration style | Additive, phased, **zero-downtime** cutover for the current Masjid |
| Do-not-start gate | Confirmed multi-Masjid demand (overview §6.1) before Phase 1 of *this* plan |

**Why this recommendation (cost / scale / extensibility):**

- **Cost:** One RDS instance + one ECS service for tens-to-low-hundreds of
  Masajid; no per-tenant schema runners or N connection pools.
- **Scalability:** Leading `tenantId` indexes + per-tenant rate limits +
  existing ECS autoscaling handle expected load; hybrid Model C escape hatch
  covers noisy-neighbor or data-residency outliers without rewriting app code.
- **Extensibility:** Quotas, feature flags, billing fields, and white-label
  branding attach to the `Tenant` / `OrgProfile` rows without topology changes.
- **Safety:** Current single tenant is backfilled as Tenant #1 and keeps
  working through every phase; isolation is proven before a second paying
  tenant is onboarded.

> **Caveat (unchanged from prior revision):** do not start this work until
> multi-Masjid demand is confirmed. Phases 1–3 of the redesign overview plus
> the UI track already ship a better single-tenant product; speculative
> tenancy is the largest item in the global risk register.

---

## 2. Current-state baseline (what we are migrating from)

Understood from the live codebase and companion docs — not assumptions.

| Area | Current state |
|---|---|
| **Stack** | `client/` React 18+Vite; `server/` Express+Prisma 5; `@makthab/shared` Zod DTOs; npm workspaces |
| **DB** | Canonical Postgres schema + generated SQLite schema for local/CI (`DATABASE_PROVIDER`); repository layer in `server/src/db/` |
| **Tenancy** | None. `OrgProfile` is single-row-by-convention (`id: 1`); schema comment already names the multi-tenant seam |
| **Auth / roles** | JWT Bearer + refresh sessions; DB-backed `Role` with permission matrix; system roles Admin / Accountant / Teacher (`Role.name` globally `@unique`) |
| **User flows** | Login → students/fees/attendance/expenses/staff/salaries/reports/dashboard; signup+OTP+tenant-admin approval; audit logs; admin backup |
| **Files** | Storage adapter: local `data/files/` or S3 (`STORAGE_BACKEND`); prefixes `photos/`, `receipts/`, `payslips/`, `reports/` — **not yet tenant-prefixed** |
| **Deploy / CI** | GitHub Actions CI (typecheck, SQLite Jest, Semgrep, terraform fmt); staging deploy to ECR/ECS + S3/CloudFront (`deploy-staging.yml`); Terraform under `infra/terraform` |
| **Data** | Real Masjid dataset via idempotent xlsx import (`docs/migration/MIGRATION.md`); financial + minor (student) data — isolation is safety-critical |

**Implications for migration:** every globally `@unique` field
(`Student.admissionNo`, `User.username`, `Role.name`, `Class.name`, …) must
become tenant-scoped; repositories (not raw route Prisma calls) are the
right injection point for automatic `tenantId` filtering; CI must gain a
Postgres+RLS isolation job before enforcement goes live.

---

## 3. Architectural options compared

Three tenancy shapes were evaluated against Makthab’s actual shape (~20+
Prisma models including auth/audit, financial + minor data, an existing
single-tenant schema, and a plausible customer count in the **tens to low
hundreds** of Masajid).

| Criterion | **A. Shared schema + row isolation** (`tenantId` + RLS) | **B. Schema-per-tenant** (Postgres `CREATE SCHEMA`) | **C. Microservice / DB-per-tenant fabric** |
|---|---|---|---|
| **Isolation strength** | Medium app-only; **High with RLS** | High (schema boundaries) | Highest (process + DB boundary) |
| **Migration cost from today** | **Lowest** — additive columns, backfill, indexes | High — Prisma has no native dynamic N-schema story; N clients or `search_path` juggling | Highest — tenant router, N DBs/services, fan-out admin queries |
| **Ops complexity** | **Low** — one schema, one pool, standard Prisma migrations | High — migrate every tenant schema on every release | Highest — N deployables, N backups, service mesh / gateway |
| **Per-tenant infra cost** | **Lowest** (shared compute + DB) | Medium (still one instance, but tooling scales with N) | Highest (idle cost of many small DBs/services) |
| **Blast radius of a bug** | High if unmitigated; **Low with RLS + isolation CI** | Medium (`search_path` mistakes) | Low for data, but ops surface creates its own risk |
| **Future extensibility** | Excellent for quotas/flags/billing on `Tenant` | Awkward for cross-tenant analytics / Super Admin views | Flexible per tenant, poor for platform-wide features |
| **Fits expected N** | **Yes** (tens–hundreds) | Overkill for expected N | Justified only for regulated/enterprise outliers |

### 3.1 Recommendation: Option A + RLS, with documented escape hatch

**Start with Option A (shared schema + `tenantId`) plus Postgres RLS**, and
document a **hybrid escape hatch** to a dedicated database (Option C shape)
for a single outlier tenant later.

Rationale:

1. **Lowest migration cost** from the current Prisma schema — additive, not a
   topology rewrite. Matches zero-downtime goals for the live Masjid.
2. **Cost-efficient at expected scale** — shared ECS + RDS; no per-tenant
   migration runners.
3. **RLS closes the classic shared-schema failure mode** (“forgot `WHERE
   tenantId`”) so a missed filter fails closed (zero rows), not open (leak).
4. **Option B** buys isolation we do not clearly need while fighting Prisma’s
   single-schema workflow and connection pooling.
5. **Option C (microservice / DB-per-tenant)** optimizes for thousands of
   tenants or hard regulatory isolation; it multiplies ops cost and delays MVP.
   Because application queries are always `tenantId`-scoped, moving one tenant
   to its own RDS later is a **connection-routing** change, not an app rewrite.

### 3.2 Rejected / deferred alternatives (explicit)

- Path-prefix tenancy (`/t/{slug}/...`) — more routing bugs; weaker
  white-label story for religious institutions.
- Header-only tenancy — easy to spoof; keep as internal Super Admin override
  only, never as the primary customer path.
- Big-bang microservice split of fees/attendance/etc. — orthogonal to tenancy
  and out of scope; keep the modular monolith.

---

## 4. Target architecture

### 4.1 Reference request path

```
Browser: masjid-umar.makthab.app
        │
        ▼
CloudFront ──▶ ALB ──▶ ECS Fargate (Express API)
        │                    │
        │           1. Extract subdomain → tenant slug
        │           2. Resolve Tenant (cached); reject if not active
        │           3. requireAuth: JWT.tenantId === resolved tenantId
        │           4. Prisma extension injects tenantId (Layer 1)
        │           5. BEGIN; SET LOCAL app.current_tenant_id; query; COMMIT (Layer 2)
        │                    ▼
        │           RDS PostgreSQL + RLS on all tenant-scoped tables
        │
        └──▶ S3 — s3://makthab-files/{tenantId}/{receipts|payslips|reports|photos}/…
             (IAM condition keys scope by prefix)
```

**Platform control plane (Super Admin)** uses a separate host
(`admin.makthab.app` or `platform.makthab.app`), never a customer subdomain.
Super Admin JWTs carry `isSuperAdmin: true` and **no** customer `tenantId`
(or an explicit `actingTenantId` when impersonating for support, audited).

### 4.2 Data isolation (defense in depth)

**Layer 1 — Prisma Client Extension (request-scoped):**

- Auto-inject `tenantId` into `where` for find/update/delete/count/aggregate.
- Auto-inject `tenantId` into create/createMany payloads.
- Fail closed if request context has no `tenantId` (except allow-listed
  platform/Super Admin repositories).

**Layer 2 — Postgres RLS:**

```sql
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Student"
  USING ("tenantId" = current_setting('app.current_tenant_id', true)::int)
  WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true)::int);
```

Generate policies mechanically for every tenant-scoped table. Use
**transaction-mode** pooling (RDS Proxy / pgbouncer) and set
`app.current_tenant_id` with `SET LOCAL` inside the same transaction as the
query so pooled connections cannot leak tenant context.

**Layer 3 — object storage:** keys under `{tenantId}/…`; bucket policy /
IAM condition keys deny cross-prefix access.

### 4.3 Tenant identification & JWT

- Edge: subdomain → slug → `Tenant.id` (in-process LRU cache; invalidate on
  tenant status change).
- Login issues JWT with `tenantId`, `tenantSlug`, role, permission matrix.
- Middleware rejects JWT whose `tenantId` ≠ subdomain-resolved tenant
  (blocks replay across tenants).
- Suspended / offboarding tenants fail resolution before auth succeeds.

### 4.4 Roles: tenant-scoped + platform Super Admin

| Role plane | Scope | Responsibilities |
|---|---|---|
| **Super Admin** (new) | Platform-wide | Tenant CRUD/provisioning, suspend/reactivate, quotas, feature toggles, cross-tenant health, support impersonation (audited), platform audit |
| **Tenant Admin** | One tenant | Existing Admin matrix: users, roles, org profile, full module access |
| **Accountant / Teacher / custom** | One tenant | Existing permission matrix, seeded per tenant |

Schema changes:

- `Role`: add `tenantId`; `@@unique([tenantId, name])`; system roles seeded
  **per tenant** at provision time (not shared global rows).
- `User.role` still stores role name; resolution is `(tenantId, roleName)`.
- Super Admin users live in a **platform** tenant (`slug: platform`) **or** a
  dedicated `isSuperAdmin` flag with `tenantId` null — prefer
  `isSuperAdmin` + null `tenantId` so platform users never appear in customer
  user lists. Platform routes bypass RLS via a DB role that is `BYPASSRLS`
  **only** for the Super Admin connection path (or use `SET LOCAL
  app.current_tenant_id` when acting on a specific tenant). Prefer the latter
  for least privilege.

### 4.5 `Tenant` model & configuration surface

```text
Tenant {
  id, slug (unique), name,
  status: provisioning | active | suspended | offboarding | deleted,
  planCode?,                        -- free | standard | enterprise (extensible)
  quotasJson,                       -- maxUsers, maxStudents, maxStorageMb, ...
  featureFlagsJson,                 -- { reportsExcel: true, selfSignup: false, ... }
  primaryContactEmail?,
  createdAt, updatedAt, provisionedAt?, suspendedAt?
}
```

- `OrgProfile` gains `tenantId` (one branding row per tenant) — fulfills the
  existing schema comment seam; integrates with Phase 5 white-label.
- Quotas enforced in middleware / service layer (soft warn + hard block).
- Feature flags read once per request into context; client receives a
  bootstrapped flag map from `/api/v1/tenant/config`.

### 4.6 Unique constraints & indexes (mechanical checklist)

Every current global uniqueness becomes tenant-prefixed:

| Model | Today | After |
|---|---|---|
| Student | `admissionNo` | `@@unique([tenantId, admissionNo])` |
| FeePayment | `receiptNo` | `@@unique([tenantId, receiptNo])` |
| Expense | `voucherNo` | `@@unique([tenantId, voucherNo])` |
| Class / Category / AcademicYear / ExpenseCategory | `name` | `@@unique([tenantId, name])` |
| Role | `name` | `@@unique([tenantId, name])` |
| User | `username`, `email`, `phone` | `@@unique([tenantId, …])` (null-safe email/phone strategy documented in migration) |
| Attendance | `[studentId, date]` | keep; student already tenant-scoped |
| FeeStructure / SalaryPayment | existing composites | add `tenantId` to model + leading index |

Indexes: `tenantId` as **leading** column on primary lookup indexes
(e.g. `@@index([tenantId, status])` on Student).

**Tenant-scoped models (all of them except pure code constants):** Student,
FeePayment, Attendance, Expense, Staff, SalaryPayment, Class, Category,
AcademicYear, ExpenseCategory, FeeStructure, OrgProfile, User, Role,
RefreshSession, OtpChallenge, PasswordResetToken, UserApprovalAudit,
AdminNotification, RolePermissionAudit, AuditLog. `PERMISSION_CATALOG` in
`@makthab/shared` stays global (code, not data).

---

## 5. Governance model — Super Admin & tenant lifecycle

### 5.1 Organizational changes

| Change | Owner | Notes |
|---|---|---|
| Create **Platform Ops** function (even if 1 person) | Business | Owns Super Admin credentials, onboarding runbook, quota policy |
| Separate Super Admin from any customer Admin account | Security | No shared passwords; break-glass procedure in IR playbook (Phase 3) |
| Tenant onboarding SLA + checklist | Platform Ops | Scriptable provision → credential handoff (WhatsApp-first) → smoke test |
| Quota / plan catalog | Product + Platform Ops | Start with one paid plan + generous defaults; avoid billing engine until revenue exists |
| Feature-toggle ownership | Product | Flags defined in code catalog; values overridden per tenant in DB |
| Support impersonation policy | Security | Time-boxed, reason-coded, written to platform audit log |

### 5.2 Super Admin responsibilities (MVP → later)

**MVP (this plan):**

1. Create / activate / suspend tenants.
2. Trigger provisioning (seed roles, reference data, initial Admin user,
   OrgProfile, S3 prefix verification).
3. Set quotas and feature flags.
4. View platform dashboard: tenant list, status, basic usage counters.
5. Initiate offboarding export + schedule hard delete after retention.

**Later (post-MVP, not blocking Phase N exit):**

- Self-serve signup for new Masajid (paid).
- Billing / invoicing integration.
- Automated capacity recommendations.
- Customer-facing status page.

### 5.3 Tenant lifecycle

```
requested ──► provisioning ──► active ──┬──► suspended ──► active (reactivate)
                                        │
                                        └──► offboarding ──► retention hold ──► deleted
```

1. **Provision:** `Tenant` row → seed reference data + system roles → create
   initial Staff+User (Admin) → OrgProfile → verify S3 prefix IAM → wildcard
   DNS already covers `{slug}.makthab.app` → status `active`.
2. **Suspend:** immediate login/API block via status check; data retained.
3. **Offboard:** Excel full export (extend existing ExcelJS reports) → signed
   S3 URL → retention 30–90 days (align with security/compliance doc) →
   cascade delete DB rows + S3 prefix → audit event.
4. **Support access:** Super Admin “act as tenant” sets `actingTenantId`,
   all queries RLS-scoped; every action audited.

---

## 6. Single migration strategy (executable, zero-downtime)

**One strategy only:** *expand → backfill → dual-read → enforce → provision
second tenant → harden.* Never fork the live Masjid onto a parallel stack.

Principles:

1. **Additive schema first** — nullable `tenantId`, app ignores it.
2. **Backfill Tenant #1** representing the current live Masjid; all existing
   rows get that id in online batches (no table locks that block writes).
3. **Compatibility window** — old clients/JWTs without `tenantId` still work
   because middleware defaults to Tenant #1 when only one active tenant
   exists **or** when `LEGACY_SINGLE_TENANT=true` (feature flag, removed after
   cutover).
4. **Enforce only after** backfill verification + isolation suite green on
   staging with two synthetic tenants.
5. **Cutover** is a config/flag flip + JWT claim addition, not a data move.
6. **Rollback** at every phase means re-enabling the compatibility flag and/or
   deploying the previous ECS task definition; data migrations are
   expand/contract so roll-forward is preferred for schema, roll-back for app.

**Data integrity guarantees for the current tenant:**

- Pre/post row-count checksums per table (students, fee payments, expenses,
  attendance, salaries) must match after backfill.
- Financial totals (sum `amountPaid`, sum `Expense.amount`) must match within
  rounding tolerance of 0.
- No unique-constraint rewrite goes live until Tenant #1 backfill is 100%
  and verified (otherwise uniqueness widening could hide duplicates).

---

## 7. Phase-by-phase plan (Phase 0 → Phase 6)

Phases below are **this document’s** migration phases (0–6). They map to
overview “Phase 4” workstreams 4a–4d, expanded with governance, MVP scope,
rollback, and metrics. Prerequisites from redesign Phases 1–3 must be green
before Phase 1 here.

```
Phase 0  Readiness & governance design
   │
Phase 1  Additive schema + Tenant #1 backfill          (compat mode)
   │
Phase 2  App tenancy plumbing (resolve, JWT, repos)    (still one tenant)
   │
Phase 3  Enforcement (NOT NULL, uniques, RLS) + CI isolation suite
   │
Phase 4  Super Admin control plane + provisioning MVP
   │
Phase 5  Second real tenant + production isolation proof
   │
Phase 6  Ops hardening (quotas, rate limits, DR drills, offboarding)
```

---

### Phase 0 — Readiness, go/no-go, and governance design

| | |
|---|---|
| **Objective** | Confirm business case; freeze tenancy model; define Super Admin org duties; inventory schema/API blast radius. |
| **MVP scope** | Demand confirmation checklist; decision record (Option A+RLS); inventory of all `@unique` / repositories / file key writers; Super Admin RACI; success metric baseline from staging. |
| **Key changes** | No production code required. Update this ADR with sign-off. Ensure Postgres path is production-proven (redesign Ph.1–2), security baseline live (Ph.3), S3 adapter in use. |
| **Data model** | None. |
| **Services / deploy / monitoring** | Document required CloudWatch dimensions (`tenantId` to be added later). Confirm wildcard cert / CloudFront plan for `*.makthab.app`. |
| **Risks** | Starting without demand (wasted spend). Incomplete inventory → missed unique constraint in Phase 3. |
| **Rollback** | N/A (docs only). Gate: do not open Phase 1 without §6.1 demand sign-off. |
| **Success criteria / metrics** | Signed go/no-go; complete table/endpoint inventory checked into docs; RACI named; staging Postgres availability ≥99.5% over prior 14 days. |

---

### Phase 1 — Additive schema & Tenant #1 backfill (zero behavior change)

| | |
|---|---|
| **Objective** | Introduce `Tenant` and nullable `tenantId` everywhere without changing runtime behavior. |
| **MVP scope** | `Tenant` model; nullable `tenantId` FK on all tenant-scoped tables; composite indexes added **non-uniquely** alongside existing uniques; online backfill job; dual-provider migrations (Postgres + generated SQLite). |
| **Key changes** | Prisma schema expand; migration SQL; one-shot/batch backfill script; seed creates Tenant #1 for fresh installs. App code still ignores `tenantId`. |
| **Data model** | `Tenant` + nullable `tenantId` columns; existing `@unique` **unchanged** yet (avoid blocking inserts mid-migration). |
| **Services** | Optional admin-only backfill status endpoint (Super Admin later); otherwise CLI runbook. |
| **Deploy** | Rolling ECS deploy; migration runs as expand-only (`ADD COLUMN` nullable). |
| **Monitoring** | Backfill progress gauge; alert if null `tenantId` count > 0 after job completes. |
| **Risks** | Long locks on large tables — mitigate with batched `UPDATE … WHERE id BETWEEN`. SQLite test DB drift — regenerate sqlite schema in CI. |
| **Rollback** | Redeploy previous app (still ignores column). Columns may remain (safe). Do not drop columns in emergency rollback. |
| **Success criteria / metrics** | 0 downtime (health checks green throughout); null `tenantId` count = 0; row-count and financial checksums match pre-backfill snapshot; existing Jest suite green; single-tenant UX unchanged. |

---

### Phase 2 — Tenancy plumbing (compat mode, still one logical tenant)

| | |
|---|---|
| **Objective** | Wire resolution, JWT claims, and repository scoping behind a flag while production remains single-tenant. |
| **MVP scope** | Subdomain (or Host header) resolver; `req.tenantId`; JWT `tenantId`/`tenantSlug`; Prisma extension or repository helper injecting filters; S3 key prefix helper `{tenantId}/…` writing **new** objects under prefix while reading old unprefixed keys (compat); `LEGACY_SINGLE_TENANT` default true. |
| **Key changes** | Middleware order: resolve tenant → auth → set RLS session var (no-op until RLS on) → handlers. Login includes claims. Client may ignore new claims. |
| **Data model** | No breaking constraint changes. |
| **Services** | All routes receive context; platform routes stubbed/disabled. |
| **Deploy** | Feature flag off for enforcement; staging enables subdomain for Tenant #1 slug. |
| **Monitoring** | Log `tenantId` on every request (structured); metric `requests_by_tenant`. |
| **Risks** | Partial filter injection (some repos missed) — mitigate with inventory checklist + shadow mode: log queries that would have returned cross-tenant rows (none expected). |
| **Rollback** | Set `LEGACY_SINGLE_TENANT=true` and/or disable resolver; previous task definition. |
| **Success criteria / metrics** | p95 latency regression &lt; 10% vs baseline; 100% of authenticated requests carry resolved `tenantId` in logs; zero functional regressions on smoke path (login→admit→fee→attendance→expense→report→backup). |

---

### Phase 3 — Enforcement (NOT NULL, tenant uniques, RLS) + isolation CI

| | |
|---|---|
| **Objective** | Make tenancy mandatory and DB-enforced without admitting a second customer yet. |
| **MVP scope** | `tenantId NOT NULL`; rewrite `@unique` → `@@unique([tenantId, …])`; enable+force RLS table-by-table; transaction `SET LOCAL`; isolation Jest suite in CI (Postgres job); remove reliance on legacy JWT without tenant claims after dual-issue window. |
| **Key changes** | Migration contract phase; CI: add `DATABASE_PROVIDER=postgresql` job with RLS; fail PRs that touch data-access without isolation tests. |
| **Data model** | All checklist uniques updated; leading indexes finalized. |
| **Services** | Fail closed if missing tenant context. |
| **Deploy** | Expand→constrain migrations during low-traffic window; app that understands constraints deployed **before** NOT NULL if needed. |
| **Monitoring** | Alert on RLS policy errors / `insufficient_privilege`; isolation suite required green. |
| **Risks** | Missed unique → second tenant blocked later; RLS session leak across pool — transaction-mode pooling + concurrency test; SQLite cannot express RLS — keep SQLite for unit speed but **gate merges on Postgres isolation job**. |
| **Rollback** | App rollback to Phase 2 build with `LEGACY_SINGLE_TENANT`; RLS policies can stay (still set session var). Reverting NOT NULL only if emergency and after assessing duplicates — prefer forward fix. |
| **Success criteria / metrics** | Isolation suite 100% pass (even with one real + one synthetic tenant in staging); raw SQL RLS probe returns 0 cross-tenant rows; production Tenant #1 checksums unchanged; zero Sev-1 incidents during soak (min 7 days). |

---

### Phase 4 — Super Admin control plane & provisioning MVP

| | |
|---|---|
| **Objective** | Platform operators can provision and configure tenants without engineering runbooks as the only path. |
| **MVP scope** | Super Admin auth; `POST/PATCH /platform/tenants`; provisioning service (seed roles, reference data, Admin user, OrgProfile); quotas + featureFlags CRUD; platform audit log; minimal platform UI **or** CLI + thin UI list (CLI-first acceptable for MVP). |
| **Key changes** | Platform router mounted only on platform host; permissions catalog entry `platform.tenants`; WhatsApp/out-of-band credential delivery for first Admin. |
| **Data model** | `quotasJson`, `featureFlagsJson`, `planCode` on `Tenant` if not already present; platform audit table or `AuditLog` with `tenantId` null + `entity=platform`. |
| **Services** | Provisioning idempotent by `slug`; status state machine enforced. |
| **Deploy** | Platform DNS + optional separate CloudFront behavior; no customer impact. |
| **Monitoring** | Provisioning success/fail metrics; alert on stuck `provisioning` &gt; N minutes. |
| **Risks** | Seed drift vs `seed.ts` — **derive provisioning from shared seed module**. Over-privileged Super Admin — MFA required (Phase 3 security MFA path). |
| **Rollback** | Disable platform routes via flag; provisioning CLI remains. No customer data change. |
| **Success criteria / metrics** | Repeatable provision of staging tenant in &lt; 15 minutes; state machine rejects illegal transitions; all platform mutating actions audited; Tenant #1 untouched. |

---

### Phase 5 — Second real tenant & production isolation proof

| | |
|---|---|
| **Objective** | Prove two tenants coexist safely in production (demo or paying). |
| **MVP scope** | Provision second tenant end-to-end; migrate any demo data; run full isolation suite against prod-like data; customer smoke tests on both subdomains; remove `LEGACY_SINGLE_TENANT`. |
| **Key changes** | Wildcard DNS verified live; file writes only under `{tenantId}/`; optional background job to copy legacy unprefixed files into Tenant #1 prefix. |
| **Data model** | Stable. |
| **Services** | Rate-limit stubs keyed by tenant (full limits in Phase 6). |
| **Deploy** | Standard rolling deploy; feature flag off for legacy mode. |
| **Monitoring** | Per-tenant dashboards; error budget burn per tenant. |
| **Risks** | Cross-tenant leak under real concurrency; noisy neighbor — mitigate with preliminary rate limits. |
| **Rollback** | Suspend Tenant #2 (status) immediately — Tenant #1 unaffected; re-enable legacy flag only if Tenant #1 path regresses. |
| **Success criteria / metrics** | Isolation suite green on staging **and** pre-prod; 0 cross-tenant reads/writes in 14-day soak; both tenants’ smoke paths pass; Tenant #1 financial checksums stable; availability ≥99.5% during soak. |

---

### Phase 6 — Scale, quotas, offboarding, DR (ops hardening)

| | |
|---|---|
| **Objective** | Production-grade multi-tenant operations: fairness, observability, exit path, disaster recovery. |
| **MVP scope** | Per-tenant token-bucket rate limits; enforce quotas (users/students/storage); offboarding export + retention job; autoscaling threshold review under dual-tenant load; backup/restore drill **for a single tenant export** and full RDS restore; runbooks. |
| **Key changes** | Middleware rate limits; usage counters; offboarding worker; CloudWatch alarms on per-tenant 5xx and throttle events. |
| **Data model** | Optional `TenantUsage` daily rollup for quotas. |
| **Services / deploy / monitoring** | Load test with concurrent tenants; document RPO/RTO (align with cloud deploy doc); drill annually. |
| **Risks** | Throttles too aggressive → false positives — alert before hard block. Incomplete offboarding leaving PII — checklist + automated verify-empty queries. |
| **Rollback** | Raise/disable rate limits via config; pause retention job. |
| **Success criteria / metrics** | Overview Phase 4 exit criteria met: isolation in CI, rate limits + autoscaling live; offboarding dry-run verified; RPO/RTO drill signed off; availability target path to ≥99.9%; p95 list/detail &lt; 300ms under dual-tenant reference load. |

---

## 8. Data migration strategy (detail)

### 8.1 Online backfill (Phase 1)

```text
1. Snapshot checksums: COUNT(*), SUM(amountPaid), SUM(amount), …
2. INSERT Tenant { slug: <current>, name: <OrgProfile.name>, status: active }
3. For each table in FK-safe order:
     UPDATE "Student" SET "tenantId" = $id WHERE "tenantId" IS NULL AND id BETWEEN …;
4. Re-run checksums; assert equality
5. Assert COUNT(*) FILTER (WHERE "tenantId" IS NULL) = 0 for every table
```

FK-safe order sketch: `Tenant` → independent refs (AcademicYear, ExpenseCategory,
Category, Class, Role, OrgProfile, Staff) → User → Student → FeeStructure /
FeePayment / Attendance / Expense / SalaryPayment → auth satellite tables →
AuditLog / RolePermissionAudit.

### 8.2 Constraint cutover (Phase 3)

1. Create new unique indexes concurrently (`CREATE UNIQUE INDEX CONCURRENTLY`
   on Postgres) on `(tenantId, …)`.
2. Deploy app that uses new constraints.
3. Drop old single-column uniques.
4. Set `NOT NULL` on `tenantId`.
5. Enable RLS + FORCE; verify with policy probe.

### 8.3 File objects

1. New writes: `{tenantId}/{prefix}/{file}`.
2. Reads: try prefixed key, fall back to legacy key for Tenant #1.
3. Optional copy job; delete legacy only after verification.

### 8.4 Second tenant

No data move from Tenant #1. Provision empty tenant + seed. If a second
existing Masjid must import history, reuse `migrate-from-xlsx.ts` parameterized
by `tenantId` (idempotent).

---

## 9. Testing plan

### 9.1 Cross-tenant isolation suite (release-blocking)

1. Provision Tenant A and Tenant B with distinct students, fees, attendance,
   expenses, staff, salaries, roles, OrgProfiles.
2. Authenticate as Tenant A Admin.
3. For **every** `/api/v1` route: attempt read/update/delete of Tenant B IDs.
4. **Expect 403/404 only** — never 200 with B’s payload; never successful mutate.
5. List/search endpoints must not include B rows.
6. JWT/subdomain mismatch rejected.
7. Raw SQL with RLS session = A returns zero B rows (Layer 2 proof).
8. Concurrent A+B requests show no session-variable bleed.

**CI:** Postgres job on every PR touching `server/src/**`, Prisma schema, or
platform routes. Treat failure as build-breaking.

### 9.2 Compatibility & regression

- Existing SQLite Jest suite remains for fast feedback (RLS not available).
- Full smoke: login → admit → fee+PDF → attendance → expense → reports → backup
  on Tenant #1 after every phase.
- Checksum job in staging after each migration.

### 9.3 Non-functional

- Dual-tenant load test (cloud deploy doc methodology).
- Rate-limit tests (Phase 6).
- Provisioning idempotency tests (Phase 4).

---

## 10. Rollout, monitoring, and rollback (ops)

### 10.1 High-level rollout

| Wave | Environment | Gate |
|---|---|---|
| W0 | Dev / CI | Phase 0 inventory + Phase 1 migrations green |
| W1 | Staging | Phases 1–3 complete; isolation suite green; Tenant #1 clone verified |
| W2 | Production | Phase 1–2 only (compat); soak |
| W3 | Production | Phase 3 enforcement after staging soak ≥7 days |
| W4 | Production | Phase 4 platform; provision staging-like demo tenant in prod **or** first customer in Phase 5 |
| W5 | Production | Phase 5 second tenant; Phase 6 hardening |

Prefer **weekday low-traffic** windows for constraint/RLS enablement; use ECS
circuit breaker / previous task definition for app rollback.

### 10.2 Observability

- Structured logs: `tenantId`, `tenantSlug`, `requestId`, `userId`, `route`.
- Metrics: request rate/latency/5xx **by tenant**; pool wait time; rate-limit
  hits; provisioning duration; null-tenant-id gauge (should stay 0).
- Alerts: isolation test failure (CI), RLS errors, tenant stuck provisioning,
  single-tenant error-budget burn, cross-tenant auth mismatch count &gt; 0.
- Dashboards: platform overview (Super Admin) + per-tenant health.

### 10.3 Backups & DR

- Continue automated RDS snapshots + S3 versioning (Phase 2/3 baseline).
- **Tenant-level:** export workbook + S3 prefix sync for offboarding and
  logical recovery.
- **Platform-level:** full RDS point-in-time restore runbook; annual drill.
- RPO/RTO targets: inherit from [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md);
  multi-tenant does not relax them.

### 10.4 Universal rollback cheat sheet

| Symptom | Immediate action |
|---|---|
| Customer outage after app deploy | ECS rollback to previous task definition |
| Suspected cross-tenant leak | Suspend affected tenant(s); rotate JWTs; preserve DB for forensics; hotfix |
| Bad migration | Stop roll-forward; restore from PITR only if data corrupted (last resort) |
| Second tenant mis-provisioned | Set status `suspended` / `offboarding`; Tenant #1 continues |
| Rate-limit storm | Disable limiter via config flag |

---

## 11. Risk register (tenancy-specific)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cross-tenant data leak | Low–Med during Phase 3 | Critical | Dual layers + CI isolation suite + code-review checklist for new tables |
| Missed `@@unique([tenantId, …])` | Med in Phase 3 | Med | Inventory from Phase 0 as checklist |
| RLS session leak via pool | Low | Critical | `SET LOCAL` + transaction pooling + concurrency test |
| Provisioning seed drift | Med over time | Med | Shared module with `seed.ts` |
| Multi-tenancy built but unsold | Med | High | Phase 0 go/no-go; sequence after Ph.1–3 |
| Super Admin credential compromise | Low | Critical | MFA, platform host only, break-glass, audit |
| Zero-downtime violation during NOT NULL | Low–Med | High | Expand/contract; concurrent indexes; soak on staging |

---

## 12. Mapping to overview Phase 4 sub-phases

| This plan | Overview §8 label | Notes |
|---|---|---|
| Phase 0 | (preamble) | Demand + governance |
| Phase 1 | 4a Additive schema | Backfill Tenant #1 |
| Phase 2 | 4a/4b bridge | Plumbing + compat |
| Phase 3 | 4b Enforcement | RLS + uniques + CI |
| Phase 4 | 4c Provisioning (platform) | Super Admin MVP |
| Phase 5 | 4c Second tenant | Production proof |
| Phase 6 | 4d Scale/ops | Quotas, limits, DR, offboarding |

---

## 13. Document history

| Date | Change |
|---|---|
| 2026-08-07 | Expanded into full Phase 0–6 migration plan: Option A/B/C comparison (incl. microservice fabric), Super Admin governance, zero-downtime strategy, MVP/risks/rollback/metrics per phase, data migration & ops sections. Preserves prior recommendation (shared schema + RLS + subdomain + hybrid escape hatch). |
