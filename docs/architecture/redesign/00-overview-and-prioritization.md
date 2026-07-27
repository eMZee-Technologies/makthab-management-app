# Makthab v3 — Re-Architecture Overview & Prioritization Plan

**Status:** Proposal / discussion document. Nothing here is implemented yet.
**Audience:** Engineering leadership + implementation team.
**Companion documents:** see [Document Index](#document-index) at the bottom.

---

## 0. Why this document exists, and one flag before reading further

Makthab today is a **deliberately narrow, single-tenant** system: one Masjid,
one SQLite file, one deployment, no cloud dependency. That scope is a
documented decision (`CLAUDE.md`, `docs/architecture/BUILD_CONTRACT.md` §0)
and it is *why* the app is simple, cheap to run, and offline-friendly (the
PDF writer is dependency-free specifically to avoid a Puppeteer/Chromium
dependency for this reason).

Everything requested in this scope — multi-database support, multi-tenant
SaaS architecture, cloud deployment, a marketable UI for "multiple customer
segments" — is a **product pivot**: from "software that runs one Madrasa" to
"a SaaS product sold to many Masajid." That's a legitimate and common
trajectory, but it is a business decision with real cost (cloud spend,
operational burden, security surface, multi-tenant support load), not a
pure engineering upgrade. This document treats that pivot as the working
assumption per the brief, but §6 calls out the specific go/no-go decision
points where it's worth re-confirming the business case before spending
engineering time — cheapest to check before Phase 4 (multi-tenancy), not
after.

With that flagged, here is the plan.

---

## 1. Executive summary

We re-architect Makthab in five phases, each independently shippable and
individually valuable even if later phases are deferred or cancelled:

| # | Phase | Delivers | Doc |
|---|-------|----------|-----|
| 1 | Multi-database abstraction | DB-agnostic data layer; Postgres becomes a first-class target alongside SQLite | [01](./01-multi-database-support.md) |
| 2 | AWS cloud deployment | Repeatable, IaC-defined deployment of the *current* (still single-tenant) system to AWS | [02](./02-cloud-deployment-aws.md) |
| 3 | Security hardening | Production-grade controls: IAM, KMS, Secrets Manager, OWASP mapping, logging/IR | [03](./03-security.md) |
| 4 | Multi-tenancy | Shared-schema tenancy, provisioning, isolation, autoscaling | [04](./04-multi-tenant-architecture.md) |
| 5 | UI redesign | Design system, accessibility, theming/white-label, i18n | [05](./05-ui-redesign.md) |

The **numbering is the attack order**, not the order the requirements were
listed in the brief. Rationale is in §3. Phase 5 (UI) runs on a **parallel
track** starting in Phase 1 — it doesn't block or get blocked by the backend
phases except for tenant white-labeling, which needs Phase 4's tenant model.

Total estimated elapsed time: **~7-9 months** with a small team (2-3
backend engineers, 1 frontend engineer, fractional DevOps/security), assuming
phases 2/3 and the UI track overlap as described. This is a rough planning
estimate, not a committed schedule — treat the per-phase breakdowns in each
topic doc as the source for re-estimation once a team is staffed.

---

## 2. Current state (baseline, for contrast)

- **Client:** React 18 + TS + Vite + Tailwind + shadcn/ui SPA, port 5173.
- **Server:** Node 20 + Express + TS + Prisma 5, port 3000, `/api/v1`.
- **Database:** SQLite, single file (`data/madrasa.db`), no network layer.
- **Shared:** Zod schemas in `packages/shared`, npm workspaces.
- **Auth:** JWT bearer, three roles (Admin, Accountant, Teacher).
- **Files:** generated PDFs/Excel/photos live on local disk under `data/files/`.
- **Deployment:** none — runs on a local machine / single VM, manually.
- **Tenancy:** hard-coded single organization (one `OrgProfile`-style branding
  row, per recent commit `40041ce`).
- **i18n:** Arabic/RTL-aware UI exists, but PDFs are ASCII-only (the
  dependency-free PDF writer can't embed fonts — Arabic PDFs need a
  font-embedding or Puppeteer swap, called out already in `CLAUDE.md`).

This baseline is intentionally lean. Every phase below should be judged
against "does this justify its added operational cost over the current
setup," not just "is this best practice for a generic SaaS."

---

## 3. Attack order — rationale

**Phase 1 before Phase 4 (DB abstraction before multi-tenancy):**
SQLite has no real concurrent-write story and no row-level security
primitive — both are load-bearing for multi-tenancy. Trying to bolt tenancy
onto SQLite first would mean redoing the data-access layer twice. Do it once.

**Phase 1 before Phase 2 (DB abstraction before cloud deployment):**
Deploying to AWS with SQLite-on-EBS is a dead end (no managed backups, no
read replicas, single point of failure, file-locking issues under any real
concurrency). Cloud deployment is only worth doing against a real network
database, so the DB abstraction has to land first, even if Phase 2 only
proves it out with a single-tenant Postgres instance.

**Phase 2 before Phase 3 in *emphasis*, but overlapping in practice:**
Most of the highest-leverage security controls (IAM roles, KMS, Secrets
Manager, VPC isolation, WAF) are AWS-native and have nothing to attach to
until infrastructure exists. Phase 3 starts threat-modeling and secure-SDLC
work immediately (it doesn't need infra to start), but the cloud-control
implementation work is sequenced after Phase 2's infra lands. Treat these as
one extended overlapping phase in a real schedule.

**Phase 3 before Phase 4 (security before multi-tenancy):**
Multi-tenancy multiplies the blast radius of every security gap — a broken
authorization check now leaks Masjid A's financial data to Masjid B, not
just a bug in one org's data. Ship the hardened baseline first.

**Phase 4 last among backend phases (multi-tenancy is the biggest, riskiest change):**
Tenancy touches nearly every table, every query, every report, and the
provisioning/billing surface. It's the most invasive and the most
speculative (see §0) — sequencing it last means the first four phases
already deliver a more robust, deployable, secure *single-tenant* product
even if the business decides not to pursue multi-tenancy at all.

**Phase 5 (UI) runs in parallel starting Day 1:**
Design tokens, component catalog, accessibility audit, and most visual
redesign work touch the client only and don't depend on backend phases.
Keep it on its own track so it isn't gated behind backend risk. The one
piece that *does* depend on Phase 4 is per-tenant white-label theming
(logo/colors per Masjid) — that lands at the end, once tenant branding
config exists server-side.

---

## 4. Cross-phase dependency diagram (textual)

```
                    ┌─────────────────────────────┐
                    │ Phase 5: UI Redesign         │
                    │ (design tokens, a11y, i18n)  │──────┐
                    └─────────────────────────────┘      │ (white-label
                                                            │  theming needs
Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4 ─────────────┘  tenant model)
DB          Cloud        Security    Multi-tenancy
Abstraction Deployment   Hardening
   │            │            │            │
   │            │            │            │
   ▼            ▼            ▼            ▼
Postgres    VPC/RDS/ECS  IAM/KMS/WAF  tenant_id isolation,
adapter,    S3, CI/CD    Secrets Mgr  provisioning, per-tenant
pooling,    CloudWatch   threat model rate-limits/autoscaling
migrations                            caching
```

Phase 2 and Phase 3 overlap heavily in practice (see §3). Phase 5 runs
alongside all of them and converges with Phase 4 only for theming.

---

## 5. Phase summary table

| Phase | Duration (est.) | Team | Exit criteria | Key risk if skipped |
|---|---|---|---|---|
| 1. Multi-DB | 4-6 wks | 1-2 backend | App runs identically against SQLite (dev/test) and Postgres (staging) via one Prisma schema + config flag; DAO interface documented; CI runs the test suite against both. | Every later phase (cloud, tenancy) has no viable database target. |
| 2. AWS Cloud | 4-6 wks (overlaps Ph.1 tail) | 1 backend + DevOps | App deployed end-to-end on AWS via IaC (Terraform/CDK); CI/CD pipeline green; backups + basic DR runbook exist; **real reference dataset from `docs/source-data/Maktab Detailed - Report.xlsx` loaded and reconciled, not just seed data**. | No repeatable deployment; every future phase is validated by hand. Skipping the data reconciliation step specifically means going live on incomplete records for the one real Masjid this app serves today. |
| 3. Security | 4-8 wks (overlaps Ph.2/4) | 1 backend + security review | OWASP Top 10 control matrix complete and verified; secrets out of source/env files and in Secrets Manager; logging/alerting live; incident-response playbook exists. | Multi-tenancy launches on an unaudited base; regulatory/reputational risk given the app holds financial + minor (student) data. |
| 4. Multi-tenant | 8-12 wks | 2 backend + 1 frontend | New tenant can self-provision (or be provisioned) with full data isolation verified by automated tests; per-tenant rate limits and autoscaling policy in place. | N/A unless business confirms SaaS direction — see §0/§6. |
| 5. UI redesign | 6-10 wks, parallel | 1-2 frontend/design | New design system shipped; WCAG 2.1 AA audit passes; i18n framework covers Arabic RTL + at least one more locale; component catalog documented. | Product stays functional but hard to market to new (non-technical) customers — directly undercuts the multi-tenant SaaS goal. |

Estimates assume the team is already familiar with this codebase (per
`CLAUDE.md` conventions) — add ramp-up time otherwise.

---

## 6. Decision points to confirm before committing further spend

These aren't blockers to *starting* — Phases 1-3 and the UI track are worth
doing regardless of the multi-tenancy decision, since they harden and
modernize the existing single-tenant product. But confirm before Phase 4:

1. **Is there an actual pipeline of other Masajid wanting this product?**
   If it's speculative, consider shipping Phases 1-3+5 as "Makthab v2.5"
   (a hardened, cloud-deployable, better-looking single-tenant app) and
   revisit multi-tenancy when there's a second paying customer, rather than
   building tenancy speculatively.
2. **Tenancy model choice** (shared-schema vs. separate-schema vs.
   separate-database) has cost/isolation trade-offs detailed in
   [04](./04-multi-tenant-architecture.md) §2 — this is a decision the business
   should sign off on given it affects both security posture and per-tenant
   infra cost.
3. **Who owns ongoing security/compliance posture post-launch?** Phase 3
   stands up controls; someone needs to own key rotation, dependency
   patching, and incident response afterward. This is an org decision, not
   an architecture one.
4. **Budget ceiling for AWS spend.** Phase 2/4 designs in the companion docs
   include cost estimates and cheaper/more-expensive variants (e.g.,
   Aurora Serverless v2 vs. provisioned RDS) — pick a ceiling before
   Phase 2 so the reference architecture is right-sized instead of
   generic "enterprise" AWS.

---

## 7. Success metrics (roll-up; see each doc for phase-specific NFRs)

- **Availability:** ≥99.5% after Phase 2 (single-tenant), ≥99.9% after
  Phase 4 (multi-tenant, revenue-bearing).
- **Latency:** p95 API response < 300ms for list/detail endpoints,
  < 2s for report generation (PDF/Excel), measured under Phase 2's
  reference load.
- **Security:** zero Critical/High findings open >30 days post Phase 3;
  100% of OWASP Top 10 categories have a mapped, tested control.
- **Tenant isolation (Phase 4):** automated cross-tenant-leak test suite
  runs in CI on every PR touching a data-access path; zero tolerance for
  failures.
- **Accessibility (Phase 5):** WCAG 2.1 AA conformance on all primary
  workflows (student admission, fee collection, attendance, reports).

---

## 8. Global risk register (top cross-cutting risks)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multi-tenancy is built but never sold (wasted spend) | Medium | High | Sequence last (Phase 4); confirm §6.1 before starting it. |
| Data migration from SQLite to Postgres loses/corrupts financial records | Low-Med | High | Dual-write/shadow-read validation window; the existing idempotent `migrate-from-xlsx.ts` pattern (see `docs/migration/MIGRATION.md`) is a good template to reuse for the DB migration tooling too. |
| First production cutover ships without the real reference dataset (`docs/source-data/Maktab Detailed - Report.xlsx` — the actual Masjid's 69 students / 672 fee records, already imported once into `data/madrasa.db`) — e.g. the new environment goes live on empty/seed-only tables | Low-Med | High | Explicit go-live gate in Phase 2, not an afterthought: reconcile the loaded dataset against xlsx-derived counts before cutover — see [01-multi-database-support.md](./01-multi-database-support.md) §6-7 and [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) §9 (M7.5) / §11. |
| Cross-tenant data leak (auth/query bug) | Low | Critical | Automated isolation test suite (Phase 4 exit criteria); defense-in-depth via Postgres RLS, not just application-level `WHERE tenantId = ?` filters — see [04](./04-multi-tenant-architecture.md) §3. |
| Arabic PDF rendering still ASCII-only after redesign | Med | Medium | Explicitly scope the PDF font-embedding swap (Puppeteer or a font-embedding library) into Phase 5, not silently dropped — flagged already in `CLAUDE.md`, easy to lose track of during a big redesign. |
| Scope creep turns this into a 18-month rewrite before anything ships | Med | High | Each phase is independently shippable; ship Phase 1+2 as an internal milestone before starting Phase 4. |

---

## 9. Document index

| Doc | Topic | Maps to brief item |
|---|---|---|
| [01-multi-database-support.md](./01-multi-database-support.md) | Multi-database abstraction, DAO interfaces, migrations | Brief §1 |
| [02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) | AWS reference architecture, IaC, CI/CD, DR | Brief §5 |
| [03-security.md](./03-security.md) | Threat model, OWASP mapping, IAM/KMS/Secrets Manager, IR | Brief §3 |
| [04-multi-tenant-architecture.md](./04-multi-tenant-architecture.md) | Tenancy model, isolation, provisioning, autoscaling | Brief §2 |
| [05-ui-redesign.md](./05-ui-redesign.md) | Design system, accessibility, i18n, theming | Brief §4 |
| This document | Prioritization / attack order | Brief §6 |

Each topic doc follows the same internal structure: executive summary →
architecture & design decisions (with trade-offs) → reference diagrams
(textual) → phased implementation plan with milestones → risks & mitigations
→ testing/validation plan → AWS deployment considerations.
