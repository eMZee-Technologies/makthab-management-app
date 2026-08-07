# Makthab — Multi-Tenant Migration Plan (Executable)

**Status:** Architecture decision record + phased execution plan  
**Audience:** Engineering leadership, product owners, implementers  
**Companion:** [04-multi-tenant-architecture.md](./04-multi-tenant-architecture.md) (design decisions),
[00-overview-and-prioritization.md](./00-overview-and-prioritization.md) (attack order),
[03-security.md](./03-security.md) (isolation preconditions)  
**Prerequisite gate:** Confirmed demand for a second Masjid customer
([overview §6.1](./00-overview-and-prioritization.md)) — do not start Phase 1 of
*this* plan until that gate is green.

---

## 1. Executive summary — recommended approach

**Recommendation: Shared database + shared schema with `tenantId` on every
tenant-scoped table, enforced by (1) a request-scoped Prisma Client Extension
and (2) Postgres Row-Level Security (RLS), with subdomain-per-tenant routing
(`{slug}.makthab.app`) and a platform-level Super Admin for tenant lifecycle.**

| Goal | How this approach delivers it |
|---|---|
| **Cost** | One RDS instance, one ECS service, one migration pipeline — lowest $/tenant at tens-to-low-hundreds of Masajid |
| **Scalability** | Horizontal via existing ECS autoscaling; DB indexes lead with `tenantId`; per-tenant rate limits prevent noisy neighbors |
| **Extensibility** | Escape hatch to dedicated RDS per outlier tenant without rewriting app code (connection router only) |
| **Zero downtime** | Additive nullable → backfill → dual-read → enforce → NOT NULL, each step reversible and deployable independently |
| **Data integrity** | Single backfill `Tenant` for the live Masjid; composite unique constraints preserve business keys; no table rebuilds that rewrite financial IDs |
| **Isolation** | App filter + RLS fail-closed; JWT `tenantId` must match subdomain; Super Admin operates on a platform plane, never via a tenant JWT |

**What we are not doing (yet):** schema-per-tenant (Prisma/ops tax too high at
this scale), database-per-tenant as the default (cost), or a microservice
split for tenancy alone (complexity without proportional value).

**Governance addition (beyond doc 04):** introduce a **Super Admin** (platform
operator) role and control plane for tenant provisioning, quotas, feature
toggles, suspension, and export/offboarding — distinct from each tenant's
existing `Admin` (Masjid-local).

---

## 2. Current-state baseline (as-built)

| Layer | Today | Tenancy seam |
|---|---|---|
| App | React + Express + Prisma 5, `/api/v1`, JWT resource×action matrix | No `tenantId` anywhere |
| Org | `OrgProfile` singleton-by-convention (`findActiveOrFirst`) | Schema comment already names `tenantId` + `req.tenantId` |
| Roles | Global `Role.name` `@unique`; system Admin/Accountant/Teacher | Must become `@@unique([tenantId, name])` |
| Users | Global unique `username` / `email` / `phone` | Must become tenant-scoped |
| DB | Dual provider: SQLite (dev/test) + Postgres (prod) | **RLS = Postgres-only**; SQLite tests use Prisma extension only |
| Files | `photos/`, `receipts/`, … under local disk or S3 | Prefix → `{tenantId}/…` |
| Deploy | ECS Fargate + ALB + RDS + S3 + Secrets Manager + WAF/KMS (Phases 2–3) | Wildcard DNS + subdomain middleware |
| Auth security | Refresh sessions, rate limits, audit log, backup token | Carry `tenantId`/`tenantSlug` in JWT; reject subdomain mismatch |
| Data access | Repository layer in `server/src/db/*` | Extension injects `tenantId` once; routes stay thin |

Phases 1–3 (dual-DB, AWS, security) are preconditions and are treated as
**already available** for this plan.

---

## 3. Architectural options compared

Three options evaluated against Makthab's real shape (~15 Prisma models,
financial + minors' PII, existing single-tenant schema, likely **tens** of
Masajid not thousands).

### Option A — Shared schema + `tenantId` (+ RLS) ← **recommended**

| Dimension | Assessment |
|---|---|
| Isolation | Medium at app layer; **High** with RLS |
| Migration from today | **Lowest** — additive columns, backfill one tenant, composite uniques |
| Ops complexity | Low — one schema, one pool, standard Prisma migrate |
| Cost at N=50 | **Lowest** — shared compute/DB |
| Blast radius of a bug | High if only app filters; **Low** with RLS + isolation CI suite |
| Future-proofing | Escape hatch to Option C for one tenant without schema redesign |

### Option B — Shared DB, schema-per-tenant (`CREATE SCHEMA tenant_x`)

| Dimension | Assessment |
|---|---|
| Isolation | High (Postgres schema boundary) |
| Migration | High — N Prisma clients or `search_path` switching; migrate-every-schema tooling |
| Ops | High — provision = full migrate per tenant; pool/`search_path` hazards |
| Cost | Medium (one instance, heavy tooling) |
| Blast radius | Medium (`search_path` bugs still leak) |
| Fit | Poor for this team size and tenant count |

### Option C — Database per tenant / microservice tenancy

| Dimension | Assessment |
|---|---|
| Isolation | Highest |
| Migration | Highest — connection router, fan-out admin queries, N× migrations/backups |
| Ops | Highest — N targets to patch/monitor |
| Cost | Highest at idle (many small DBs) or loses isolation if many DBs on one instance |
| Microservices | Splitting "tenancy" into its own service adds network/auth surface without reducing the need to stamp `tenantId` on domain data |
| Fit | Reserve for **outlier** enterprise / residency requirements via documented escape hatch |

### Decision

**Ship Option A + RLS + Super Admin control plane.** Document Option C as a
per-tenant routing exception, not the default topology. Reject Option B for
v1 of multi-tenancy.

---

## 4. Target architecture (summary)

```
Browser: {slug}.makthab.app          Super Admin: admin.makthab.app (or /platform)
        │                                      │
        ▼                                      ▼
   CloudFront / ALB ──▶ ECS Express API
        │                    │
        │         Tenant path: subdomain → Tenant → JWT.tenantId match
        │         Platform path: Super Admin JWT (no tenant subdomain)
        │                    │
        │         Prisma extension injects tenantId (tenant requests)
        │         BEGIN; SET LOCAL app.current_tenant_id; …; COMMIT
        │                    │
        ▼                    ▼
   RDS PostgreSQL (RLS on all tenant tables)
   S3: s3://…/{tenantId}/photos|receipts|…
```

**Platform vs tenant planes**

| Plane | Actors | Data access |
|---|---|---|
| **Tenant** | Tenant Admin / Accountant / Teacher | Only own `tenantId` via extension + RLS |
| **Platform** | Super Admin | `Tenant`, quotas, feature flags, provisioning jobs; **no** casual read of student/fee rows (break-glass + audit only) |

---

## 5. Governance model — Super Admin & tenant lifecycle

### 5.1 Roles

| Role | Scope | Responsibilities |
|---|---|---|
| **Super Admin** | Platform (global) | Create/suspend/reactivate tenants; set slug/plan/quotas/feature toggles; trigger export/offboard; view platform audit; break-glass tenant support (time-boxed, audited) |
| **Tenant Admin** | One tenant | Existing Admin matrix (`isFullAccess`) — users, roles, org branding, backup *within* tenant |
| Accountant / Teacher / custom | One tenant | Unchanged semantics, resolved as `(tenantId, roleName)` |

Super Admin is **not** a tenant `Role` row with `isFullAccess`. It is a
separate account type (e.g. `PlatformUser` or `User.isPlatformAdmin`) that
authenticates on the platform host and never receives a tenant-scoped JWT
used on `{slug}.makthab.app` without an explicit, audited impersonation flow.

### 5.2 Tenant lifecycle states

```
provisioning → active ⇄ suspended → offboarding → deleted
```

| State | Login | Data |
|---|---|---|
| `provisioning` | Blocked | Seed in progress |
| `active` | Allowed | Normal |
| `suspended` | Blocked (clear error) | Retained |
| `offboarding` | Blocked | Export available; retention clock running |
| `deleted` | N/A | Hard-deleted after retention |

### 5.3 Quotas & feature toggles (MVP fields on `Tenant`)

| Field | Purpose |
|---|---|
| `maxUsers`, `maxStudents` | Soft quotas (warn) → hard block on create |
| `featuresJson` | e.g. `{ whatsappBusinessApi, advancedReports, customRoles }` |
| `plan` | `starter` / `standard` / `enterprise` (billing later) |
| `slug`, `name`, `status` | Identity + lifecycle |

### 5.4 Control-plane APIs (MVP)

| Method | Path | Actor |
|---|---|---|
| POST | `/api/v1/platform/tenants` | Super Admin — provision |
| GET | `/api/v1/platform/tenants` | Super Admin — list |
| PATCH | `/api/v1/platform/tenants/:id` | Super Admin — quotas, features, status |
| POST | `/api/v1/platform/tenants/:id/export` | Super Admin — offboard export |
| POST | `/api/v1/platform/tenants/:id/impersonate` | Super Admin — break-glass (optional late phase) |

All platform mutations write `AuditLog` with `entity: "tenant"` / `platform`.

---

## 6. Data model changes (mechanical checklist)

### 6.1 New models

```text
Tenant
  id, slug @unique, name, status, plan,
  maxUsers, maxStudents, featuresJson,
  createdAt, updatedAt

PlatformUser (or User.platformRole)
  id, username @unique, passwordHash, status, …
```

### 6.2 Add `tenantId` (FK → Tenant) to all tenant-scoped tables

`Student`, `FeePayment`, `Attendance`, `Expense`, `Staff`, `SalaryPayment`,
`Class`, `Category`, `AcademicYear`, `ExpenseCategory`, `FeeStructure`,
`OrgProfile`, `User`, `Role`, `OtpChallenge`, `PasswordResetToken`,
`UserApprovalAudit`, `AdminNotification`, `RolePermissionAudit`,
`RefreshSession`, `AuditLog` (nullable userId still; always stamp tenant when known).

**Global (no tenantId):** `PERMISSION_CATALOG` / resource catalog in code;
`PlatformUser`; optionally a global feature-flag definition table.

### 6.3 Unique constraints → `@@unique([tenantId, …])`

| Current | Becomes |
|---|---|
| `Student.admissionNo` | `[tenantId, admissionNo]` |
| `FeePayment.receiptNo` | `[tenantId, receiptNo]` |
| `Expense.voucherNo` | `[tenantId, voucherNo]` |
| `Class.name`, `Category.name`, `AcademicYear.name`, `ExpenseCategory.name` | `[tenantId, name]` |
| `Role.name` | `[tenantId, name]` |
| `User.username`, `User.email`, `User.phone` | `[tenantId, …]` |
| `FeeStructure` compound unique | prefix `tenantId` |
| `Attendance` `[studentId, date]` | keep if student already tenant-scoped; still add `tenantId` index |
| `SalaryPayment` staff/month/year | prefix `tenantId` |

### 6.4 Indexes

Lead every hot path with `tenantId`, e.g. `@@index([tenantId, status])` on
`Student`, `@@index([tenantId, feeYear, feeMonth])` on `FeePayment`.

### 6.5 Files

Keys: `{tenantId}/photos/…`, `{tenantId}/receipts/…`, …  
IAM: condition key on `s3:prefix` where feasible; platform jobs use a broader role.

---

## 7. Single explicit migration strategy (zero-downtime)

**Strategy name: Expand → Contract (additive dual-read, then enforce).**

One continuous strategy executed in Phases 0–6 below. No big-bang cutover.
The live Masjid never changes its business data IDs; it gains a `Tenant` row
and stamped `tenantId` values.

```
Phase 0  Gate + freeze checklist
Phase 1  Additive schema (nullable tenantId) + backfill Tenant #1
Phase 2  Dual-write / dual-read (app still single-tenant UX)
Phase 3  Enforcement (JWT + subdomain + Prisma extension + RLS)
Phase 4  Super Admin control plane + provisioning CLI
Phase 5  Second real tenant + isolation CI gate
Phase 6  Ops hardening (quotas, rate limits, offboarding, observability)
```

**Rollback principle:** every phase ships behind flags or reversible schema
steps. Prefer forward-fix with feature flags over restore-from-backup
unless data corruption is detected.

---

## 8. Phase-by-phase plan

### Phase 0 — Go/no-go gate & readiness (MVP: decision record)

**Objectives**

- Confirm second-customer demand (overview §6.1).
- Sign off Option A + Super Admin governance.
- Inventory every `@unique` / repository query / file key prefix.
- Define retention window for offboarding (legal input; default 30–90 days).

**Key changes:** None in production code — ADR + checklist only.

**MVP:** Signed ADR; unique-constraint inventory; RLS table list;
Super Admin threat model addendum (platform vs tenant).

**Risks:** Starting without demand (wasted spend).

**Rollback:** N/A (no deploy).

**Success metrics**

- [ ] Written go decision from product owner
- [ ] 100% of Prisma uniques inventoried
- [ ] Rollback owners named for Phases 1–3

---

### Phase 1 — Additive schema + backfill (MVP: invisible tenancy column)

**Objectives**

- Create `Tenant`; insert row for current Masjid (`slug` from existing
  `OrgProfile.name` slugified, or `default`).
- Add **nullable** `tenantId` to all tenant-scoped tables.
- Backfill `tenantId = 1` for every existing row (single transaction or
  batched; financial tables verified by row counts).
- Add composite indexes **without** dropping old uniques yet.

**Key changes**

| Area | Change |
|---|---|
| Prisma | `Tenant` model; nullable `tenantId` FKs; dual migration (Postgres + SQLite twin) |
| Seed | Idempotent: ensure default Tenant exists |
| App | **No behavior change** — queries ignore `tenantId` |
| Deploy | Migrate during normal release; no DNS change |

**MVP:** Production DB has `Tenant` + fully backfilled nullable `tenantId`;
app green; report totals unchanged vs pre-migrate snapshot.

**Risks:** Partial backfill; long locks on large `FeePayment` table.

**Rollback:** Drop new FKs/columns if needed (data unchanged aside from new
column); or leave nullable columns unused.

**Success metrics**

- [ ] `COUNT(*)` per table == `COUNT(*) WHERE tenantId = 1`
- [ ] Zero NULL `tenantId` after backfill job
- [ ] Fee collection totals for last 12 months match pre-migrate checksum
- [ ] Zero downtime (migrate online; no multi-hour maintenance window)

---

### Phase 2 — Dual-write / dual-read (MVP: stamp without enforcing)

**Objectives**

- All **creates** set `tenantId` from a process-wide default
  `DEFAULT_TENANT_ID=1` (env) — still one tenant in UX.
- Repositories optionally filter by default tenant (shadow read) in staging.
- Start S3 key dual-write or rewrite job: copy objects to `{tenantId}/…`
  while old keys still resolve (read fallback).

**Key changes**

| Area | Change |
|---|---|
| Repositories / thin helper | `withTenant(data)` on create |
| Storage | `normalizeStoredKey` accepts legacy or prefixed keys |
| Feature flag | `TENANCY_DUAL_WRITE=true` |

**MVP:** New rows always have `tenantId`; legacy reads still work; no
subdomain yet.

**Risks:** Code paths that bypass repositories (raw Prisma) miss stamps —
ban raw access outside `server/src/db` (already BUILD_CONTRACT rule; audit CI).

**Rollback:** Turn off dual-write flag; continue reading unscoped.

**Success metrics**

- [ ] 7 days of creates with 0 NULL `tenantId` on new rows
- [ ] Storage read fallback hit rate trending down after prefix migration
- [ ] No customer-visible URL/API change

---

### Phase 3 — Enforcement (MVP: single tenant through the new path)

**Objectives**

- Make `tenantId` **NOT NULL**; replace global uniques with tenant-prefixed.
- Ship Prisma Client Extension (auto `where`/`create` inject; fail closed).
- Enable Postgres RLS policies (generated script per table); `SET LOCAL`
  in transaction-mode pooling (RDS Proxy).
- JWT gains `tenantId` + `tenantSlug`; subdomain middleware resolves Tenant;
  reject mismatch.
- Wildcard DNS `*.makthab.app` → same CloudFront/ALB as today; map default
  slug for current customer so bookmarks keep working (apex redirect to
  `{default-slug}.makthab.app`).

**Key changes**

| Area | Change |
|---|---|
| Auth | Login resolves user's tenant; tokens carry claims |
| Middleware | `resolveTenant` → `requireAuth` tenant match |
| DB | RLS + extension |
| Client | Auth/bootstrap uses tenant host; `OrgProfile` by tenant |
| SQLite CI | Extension-only isolation tests (no RLS); Postgres job in CI for RLS |

**MVP:** Current Masjid works end-to-end on subdomain + tenant JWT; isolation
suite exists (passes with one tenant); RLS verified with raw SQL probe.

**Risks:** Connection-pool session leak; missed unique rewrite; client hard-coded
origins.

**Rollback:** Feature flag `TENANCY_ENFORCE=false` reverts to default-tenant
injection without subdomain check; keep NOT NULL columns (safe). DNS apex can
point back to previous host header behavior.

**Success metrics**

- [ ] p95 latency within +10% of pre-enforce baseline
- [ ] Isolation suite green in CI
- [ ] Raw SQL with `app.current_tenant_id=1` returns 0 rows for synthetic
      tenant-2 fixtures in staging
- [ ] Zero Sev-1 incidents for 14 days

---

### Phase 4 — Super Admin control plane (MVP: scripted onboard + platform API)

**Objectives**

- `PlatformUser` + Super Admin login on platform host.
- `POST /platform/tenants` runs provisioning pipeline (design doc 04 §6):
  Tenant → seed roles/reference → Admin user → OrgProfile → S3 prefix verify →
  status `active`.
- Quotas/feature toggles on PATCH; suspend/reactivate.
- Platform audit stream.

**Key changes**

| Area | Change |
|---|---|
| Auth | Separate platform JWT issuer or `tokenType: "platform"` claim |
| Seed | Parameterize existing `seed.ts` by `tenantId` (single source of truth) |
| UI | Minimal Super Admin console (list tenants, create, suspend) — can be CLI-first |

**MVP:** Super Admin can provision a **staging** second tenant via CLI or UI;
tenant Admin can log in on its subdomain; quotas stored (enforcement can be soft).

**Risks:** Seed drift vs production schema; Super Admin over-privilege into
tenant PII.

**Rollback:** Disable platform routes; tenants already created remain
(manual cleanup script).

**Success metrics**

- [ ] Provisioning runbook: < 15 minutes, zero manual SQL
- [ ] Seed parity test: provisioned tenant has same system roles/matrix as
      default tenant templates
- [ ] All platform mutations audited

---

### Phase 5 — Second real tenant + isolation hard gate (MVP: two live tenants)

**Objectives**

- Onboard a real (or contracted pilot) second Masjid.
- Run full cross-tenant isolation suite against two datasets (design doc 04 §10).
- Enforce quotas on create endpoints.
- Per-tenant rate limit middleware.

**MVP:** Two active tenants; CI fails any PR that breaks isolation; pilot
customer completing admission → fee → attendance → report.

**Risks:** First cross-tenant leak; noisy neighbor on shared RDS.

**Rollback:** Suspend tenant B; export data; investigate; do **not** disable
RLS to "fix" issues.

**Success metrics**

- [ ] Isolation suite: 100% endpoints return 403/404 on cross-tenant IDs
- [ ] List endpoints contain 0 foreign-tenant rows
- [ ] JWT/subdomain mismatch → 401
- [ ] Pilot sign-off checklist complete

---

### Phase 6 — Ops hardening & offboarding (MVP: suspend → export → retain → delete)

**Objectives**

- Offboarding workflow + Excel/full dump export (reuse ExcelJS).
- Retention job deletes tenant rows + S3 prefix after window.
- Per-tenant CloudWatch metrics/logs (`tenantId` dimension).
- Autoscaling threshold review under dual-tenant load test.
- Document Option C escape hatch runbook (dedicated RDS).

**MVP:** Dry-run offboard on a disposable tenant in staging; production
observability dashboards per tenant; DR restore tested for shared RDS.

**Risks:** Accidental hard-delete; incomplete S3 cleanup.

**Rollback:** Retention job behind flag; soft-delete only until dry-run passes.

**Success metrics**

- [ ] Offboard dry-run: export checksum verified; delete removes 100% of
      `tenantId` rows (assert `COUNT = 0`)
- [ ] Alert on tenant rate-limit approaching threshold
- [ ] Availability ≥ 99.5% during Phase 5–6 window; target 99.9% once GA

---

## 9. Data migration strategy (detail)

### 9.1 Live Masjid (Tenant 1)

1. Snapshot RDS (or SQLite backup) before Phase 1.
2. Create `Tenant` (`id=1`, slug agreed with customer).
3. Backfill in dependency order: reference tables → Staff/User/Role →
   Student → FeePayment/Attendance/Expense/Salary → sessions/audit.
4. Checksums: counts, sum(`amountPaid`), sum(`netAmount`), active student count
   vs pre-migrate report.
5. Only then enable Phase 2 dual-write.

### 9.2 Files

1. Inventory keys under `data/files` / S3.
2. Copy to `{tenantId}/…` (no delete of legacy until Phase 3+ read metrics show
   zero legacy hits).
3. Update DB path columns in a controlled batch (or resolve at read time).

### 9.3 Second tenant onward

- **No migration of legacy data** — greenfield seed via provisioning.
- Optional: import tools (`migrate-from-xlsx`) accept `--tenantId`.

### 9.4 Integrity guarantees

- No renumbering of fee/student IDs for Tenant 1.
- Uniques expanded, not dropped, in a two-step migrate where needed
  (add new unique → verify → drop old unique).
- RLS enabled only after NOT NULL + backfill complete.

---

## 10. Testing plan

| Suite | When | Pass criteria |
|---|---|---|
| Unit: Prisma extension inject/fail-closed | Phase 3+ every PR | Throws without tenant context |
| Integration: single-tenant regression | All phases | Existing Jest suite green |
| **Cross-tenant isolation** | Phase 3 skeleton → Phase 5 full | No cross-tenant 200/body leak |
| RLS raw-SQL probe | Phase 3+ (Postgres CI job) | Zero foreign rows |
| Provisioning golden path | Phase 4+ | Seed parity |
| Load: 2 tenants concurrent | Phase 5–6 | p95 budget; pool saturation alerts |
| Offboard dry-run | Phase 6 | Count-zero after delete |

**CI rule:** any PR touching `server/src/db/**`, `schema.prisma`, tenancy
middleware, or routes **must** run isolation suite (fail build on failure).

---

## 11. Observability, backups, DR

| Concern | Plan |
|---|---|
| Logging | Structured JSON already (Winston); add `tenantId`, `tenantSlug`, `plane: tenant\|platform` |
| Metrics | Per-tenant request count, 5xx, rate-limit hits; platform provision/fail counts |
| Alarms | Existing ALB/RDS + login-failure; optional cross-tenant anomaly alerts |
| Backups | Shared RDS automated backups + PITR (Phase 2); tenant export is logical DR for offboard |
| DR | Restore RDS to staging; verify Tenant 1 checksums; document RTO/RPO |
| Break-glass | Super Admin impersonation time-boxed + audit (late phase); default deny |

---

## 12. High-level rollout & communication

1. **Internal:** Phase 1–2 on staging → production (invisible).
2. **Customer (Tenant 1):** announce subdomain cutover window for Phase 3
   (apex redirect); support channel for bookmark updates.
3. **Pilot Tenant 2:** Phase 5 under contract; isolation report shared.
4. **GA:** Phase 6 complete; Super Admin runbooks signed off; sales allowed
   to onboard without engineering SQL.

---

## 13. Rollback cheat sheet

| Phase | Fast rollback | Last-resort |
|---|---|---|
| 1 | Stop using columns; optional drop in follow-up migrate | Restore RDS snapshot |
| 2 | `TENANCY_DUAL_WRITE=false` | — |
| 3 | `TENANCY_ENFORCE=false` + apex host | Snapshot restore if unique migrate fails mid-way (avoid by expand-contract) |
| 4 | Disable `/platform/*` routes | Delete unfinished `provisioning` tenants |
| 5 | Suspend Tenant 2 | Export + delete Tenant 2 |
| 6 | Disable retention cron | Restore from pre-delete export |

---

## 14. MVP scope map (one glance)

| Phase | Customer-visible? | MVP slice |
|---|---|---|
| 0 | No | Go decision + inventories |
| 1 | No | Nullable `tenantId` + backfill |
| 2 | No | Stamp on create + file prefix dual-read |
| 3 | Soft (subdomain) | Enforce for Tenant 1 only |
| 4 | Internal | Super Admin provisions staging tenant |
| 5 | Yes (pilot) | Two tenants + isolation CI gate |
| 6 | Ops | Offboard + quotas hard-enforce + dashboards |

---

## 15. Success criteria (program-level)

- [ ] Zero downtime releases across Phases 1–3 (no multi-hour maintenance window)
- [ ] Tenant 1 financial checksums unchanged through enforcement
- [ ] Automated isolation suite is a **merge blocker**
- [ ] Super Admin can provision a tenant without engineering SQL
- [ ] Documented escape hatch to dedicated DB for one enterprise tenant
- [ ] Offboarding dry-run proven in staging
- [ ] Cost remains within agreed AWS ceiling at N=10 tenants (revisit sizing)

---

## 16. Explicit non-goals (this program)

- Billing/payment gateway (store `plan` only)
- Self-serve public signup of new Masajid (Phase 4 is operator-provisioned)
- Schema-per-tenant or default database-per-tenant
- Splitting the monolith into microservices for tenancy
- Building tenancy on SQLite production (Postgres + RLS required for Phase 3+)

---

## 17. Relationship to existing `04-multi-tenant-architecture.md`

| Topic | Doc 04 | This plan |
|---|---|---|
| Options A/B/C | §2 | §3 (reaffirmed + microservice note) |
| Prisma extension + RLS | §3.2 | Phases 2–3 |
| Subdomain routing | §3.1 | Phase 3 |
| Provisioning steps | §6 | Phase 4–5 + Super Admin governance §5 |
| Isolation tests | §10 | §10 + Phase 5 gate |
| Super Admin / quotas / feature flags | Not detailed | **§5, Phase 4–6** |
| Zero-downtime expand/contract | Implied in 4a–4b | **§7–8 explicit** |
| Phase 0 business gate | Overview §6 | **Phase 0** |

Treat **this document as the execution plan**; treat **04 as the design
rationale**. Update both when decisions change.
