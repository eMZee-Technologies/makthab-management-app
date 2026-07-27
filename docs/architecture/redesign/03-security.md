# Makthab v3 — Security Architecture (Phase 3)

**Status:** Proposal / discussion document. Nothing here is implemented yet.
**Depends on:** [01-multi-database-support.md](./01-multi-database-support.md) (Postgres),
[02-cloud-deployment-aws.md](./02-cloud-deployment-aws.md) (ECS Fargate, RDS PostgreSQL,
S3, Secrets Manager, VPC with public/private subnets).
**Feeds into:** [04-multi-tenant-architecture.md](./04-multi-tenant-architecture.md) — every
control here is a precondition for tenancy, since tenancy multiplies the blast radius of any gap.

---

## 1. Executive summary

Makthab currently runs as a trusted, single-operator deployment: secrets live in
`server/.env`, JWT signing keys are static, there's no rate limiting, no audit log, and no
formal authorization test suite — all reasonable for a single Masjid running it on one
machine, and all insufficient once the app moves to shared cloud infrastructure and holds
data (student PII for minors, financial records) that would hurt real people if leaked. This
document defines the production-grade control set for Phase 3: infra hardening (VPC/IAM/KMS),
application hardening (token revocation, rate limiting, audit logging), an OWASP Top 10
control mapping, a secure SDLC, and incident-response playbooks sized for a small team, not
an enterprise SOC.

The guiding principle is **proportionate hardening**: every control below is justified against
the actual data this app holds and the actual team size that will operate it. We are not
building a bank; we're protecting fee records and children's names and dates of birth to a
standard that would survive a serious incident review.

---

## 2. Threat model

**Assets:**
- Student PII (name, date of birth, guardian contact, photos, attendance) — minors' data.
- Financial records (fee payments, salary payments, receipts) — mapped to real money.
- Auth credentials (JWT secrets, `admin/admin123`-style seeded passwords — must not survive
  into any real deployment).
- Generated documents (PDF receipts/payslips, Excel reports) — contain the above in exportable form.
- The backup/restore capability itself (an `admin/backup` route per `CLAUDE.md` — a single
  endpoint that can exfiltrate or overwrite the entire dataset if under-protected).

**Entry points & actors:**

| Entry point | Actor | Primary risk |
|---|---|---|
| `/api/v1/auth/login`, `/refresh` | Anonymous attacker | Credential stuffing, brute force, token theft |
| Any `requireAuth` route | Authenticated low-privilege user (e.g. Teacher) | Privilege escalation — hitting Accountant/Admin-only routes or records outside assigned classes |
| Fee/receipt/payslip PDF & Excel download routes | Authenticated user | IDOR — guessing/incrementing another record's ID to download someone else's receipt/payslip |
| Photo upload (student profile) | Authenticated user | Malicious file upload (path traversal, oversized files, non-image payloads served back as if images) |
| `admin/backup` route | Admin (or a compromised Admin session) | Full-dataset exfiltration or destructive restore |
| Dependencies (npm packages, Prisma, ExcelJS, the in-house PDF writer) | Supply chain | Known-CVE exploitation via an unpatched dependency |
| WhatsApp `wa.me` links (CLAUDE.md mentions WhatsApp caption fixes) | N/A (outbound only) | Low risk — no inbound trust boundary, but caption content must not leak more than intended (e.g., another student's data via a copy-paste bug) |
| (Forward-looking, Phase 4) tenant boundary | Authenticated user of Tenant A | Cross-tenant data leak via a missing `tenantId` filter — see [04](./04-multi-tenant-architecture.md) §3. Not in scope for Phase 3's single-tenant baseline, but every control below is written to make Phase 4 additive, not a rewrite. |

**Notable current gaps (from the existing implementation, to close in Phase 3):**
- No refresh-token revocation list — a stolen refresh token is valid until natural expiry.
- No rate limiting on `/auth/login` — brute force is unbounded.
- Secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`) live in a `.env` file, not a
  managed secret store — fine for local dev, not for a shared cloud deployment.
- No audit trail of who changed/deleted a financial record or a student profile.
- Seeded credentials (`admin/admin123` per `docs/architecture/BUILD_CONTRACT.md`) must be
  excluded from any environment beyond local dev/test.

---

## 3. Architecture & design decisions

### 3.1 Infrastructure security

| Decision | Rationale | Trade-off |
|---|---|---|
| VPC with public subnets (ALB only) + private subnets (ECS tasks, RDS) | Standard defense-in-depth; nothing but the load balancer is internet-reachable | Slightly more networking setup (NAT gateway for outbound from private subnets) — budget ~$32/mo for a single NAT gateway, or use NAT instance / VPC endpoints for S3/Secrets Manager to avoid NAT entirely at this scale |
| Security groups scoped per-tier (ALB→ECS on app port only; ECS→RDS on 5432 only) | Least privilege at the network layer, cheap to set up, high leverage | None significant |
| AWS WAF on CloudFront/ALB with the AWS Managed Rules baseline (Core rule set + Known Bad Inputs) | Blocks common automated exploitation (SQLi/XSS patterns, bad bots) before it reaches the app | ~$5-10/mo + per-request cost; worth it for an internet-facing auth endpoint. Skip the more expensive managed rule groups (bot control, account takeover) at this scale — revisit if login abuse becomes a real problem |
| VPC endpoints for S3 and Secrets Manager | Keeps traffic to those services off the public internet, reduces NAT gateway cost/dependency | Slightly more Terraform/CDK to write; worth it since Phase 2 already uses both services heavily |

### 3.2 Application security

| Decision | Rationale | Trade-off |
|---|---|---|
| Rotate to short-lived access tokens (15 min) + refresh tokens (7-30 days) with a **revocation list** (a `RevokedToken` or `Session` table keyed by refresh-token JTI, checked on `/refresh`) | Closes the "no revocation" gap; lets an Admin force-logout a compromised account | One more DB table + a check on every refresh — cheap given Postgres is already in place post-Phase-1 |
| Rate limit `/auth/login` and `/auth/refresh` (e.g. `express-rate-limit`, 5 attempts/15 min per IP+username pair) | Directly closes the brute-force gap; trivial to add, no new infra | Must tune to avoid locking out legitimate users behind shared IPs (e.g. school office NAT) — use a generous per-account threshold, not just per-IP |
| Keep the existing dual-Zod validation pattern (`errorHandler` detects `ZodError` structurally) but add **request size limits** (`express.json({ limit: '1mb' })` or similar) at the Express layer | Zod already stops malformed input; size limits stop a resource-exhaustion vector Zod doesn't cover | None — this is a one-line config change |
| CORS locked to the known client origin(s) (env-configured, not `*`) | Already implied by `CLAUDE.md`'s dev CORS note; must be explicit and origin-listed in every environment | None |
| File upload validation: enforce MIME type + magic-byte check (not just extension) and a max size on photo uploads, store uploads under S3 with a randomized key (not user-controlled filename) | Prevents path traversal and "upload a script, serve it as an image" attacks | Small library addition (e.g. `file-type` for magic-byte sniffing) |
| Restrict the `admin/backup` route to Admin role **and** add a second factor of protection — e.g., require it to run from an internal-only path (VPC-internal ALB listener or a separate authenticated CLI/Lambda invocation) rather than being reachable the same way as normal API routes | A full-dataset export/restore endpoint is the single highest-impact route in the app; treat it differently from CRUD routes | More deployment complexity for one route — justified given the blast radius |

### 3.3 Database security

| Decision | Rationale | Trade-off |
|---|---|---|
| RDS PostgreSQL encrypted at rest via a customer-managed KMS key (not the default AWS-managed key) | Customer-managed keys give you rotation control and an audit trail (CloudTrail logs key usage) | Slightly more KMS setup; negligible cost (~$1/mo per key + usage) |
| TLS enforced on the Postgres connection (`sslmode=require` in `DATABASE_URL`) | Protects data in transit inside the VPC too — defense in depth, not just perimeter trust | None — RDS supports this natively |
| Least-privilege DB role for the app (no `CREATEDB`/`CREATEROLE`/superuser; only DML + the specific schema it owns) | The app's Postgres user should not be able to do more than the app needs, limiting damage from a SQL-injection-adjacent bug (even though Prisma parameterizes queries) | One extra role to manage in migration tooling |
| `DATABASE_URL` sourced from Secrets Manager at container start (ECS task definition secret injection), not baked into an image or `.env` file | Removes DB credentials from source control and from the deployed artifact entirely | Requires the ECS task execution role to have `secretsmanager:GetSecretValue` scoped to just that secret ARN |

### 3.4 Secrets & key management

- **KMS key hierarchy:** one CMK for RDS encryption, one CMK for S3 bucket encryption (can be
  the same key if operational simplicity is preferred over blast-radius separation — for this
  app's scale, one shared "data-at-rest" CMK is a reasonable simplification).
- **Secrets Manager** holds: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and any
  WhatsApp gateway credentials. Enable automatic rotation for the JWT secrets on a 90-day
  schedule (requires a small Lambda rotation function, or manual rotation initially if that's
  too much upfront work — flag as a fast-follow, not a Phase 3 blocker).
- **`server/.env` pattern retired in every non-local environment.** Local dev keeps `.env` for
  simplicity (per `CLAUDE.md` conventions); staging/production read exclusively from Secrets
  Manager via the ECS task definition.

---

## 4. OWASP Top 10 (2021) control matrix

| Category | Control in Makthab |
|---|---|
| **A01 Broken Access Control** | `requireAuth`/`requireRole` middleware on every route (already exists); Phase 3 adds an automated authorization test suite that asserts, per role, which routes/records are reachable — run in CI on every PR touching a route file. IDOR closed by scoping record lookups to the requesting user's permitted records (e.g., Teacher can only fetch attendance for assigned classes), not just checking role. |
| **A02 Cryptographic Failures** | TLS everywhere (ALB↔client via ACM cert, ECS↔RDS via `sslmode=require`); RDS + S3 encrypted at rest via customer-managed KMS keys; JWT signed with a strong random secret from Secrets Manager, not a checked-in default. |
| **A03 Injection** | Prisma's parameterized query builder (no raw SQL in the app); Zod validation on every request body/query/param via the existing dual-Zod `validate` middleware pattern. |
| **A04 Insecure Design** | This threat model (§2) plus the OWASP mapping itself are the design-review artifact; the `admin/backup` route gets extra isolation per §3.2 precisely because a generic "require Admin role" check is insufficient design for that specific route's blast radius. |
| **A05 Security Misconfiguration** | IaC (Terraform/CDK from Phase 2) makes infra config reviewable and repeatable instead of click-ops; security groups default-deny; S3 buckets block public access by default; a secure-deployment checklist (§9) gates every release. |
| **A06 Vulnerable and Outdated Components** | Dependabot (or Snyk) enabled on the repo for `npm audit`-class alerts; CI fails on new Critical/High advisories in direct dependencies; documented patch-review cadence (monthly, or immediately for Critical). |
| **A07 Identification and Authentication Failures** | Rate limiting on login/refresh (§3.2); refresh-token revocation list (§3.2); no default/seeded credentials outside local dev; password hashing already via a standard library (verify `bcrypt`/`argon2` is in use, not a custom scheme — confirm during Phase 3 kickoff). |
| **A08 Software and Data Integrity Failures** | CI pipeline builds from a pinned lockfile (`package-lock.json`); Docker images built from pinned base image digests, not floating tags; ECR image scanning enabled; no unsigned/unverified third-party scripts loaded client-side. |
| **A09 Security Logging and Monitoring Failures** | Structured audit logging (§6) for auth events, role changes, financial-record mutations, and backup/restore invocations, shipped to CloudWatch Logs with retention + alarms (§7). Today there is effectively no security-relevant logging — this is a genuine gap to close, not a refinement. |
| **A10 Server-Side Request Forgery (SSRF)** | Low surface area today (no user-supplied URLs fetched server-side); if the WhatsApp gateway integration or any future integration accepts a user-influenced URL/webhook, validate/allowlist destinations before fetching. Flag for re-review if that integration grows. |

---

## 5. Security architecture diagram (textual)

```
Internet
   │
   ▼
CloudFront (static client) ──┐
   │                         │
   ▼                         ▼
  WAF ─────────────────▶  ALB (public subnet)
                             │  (HTTPS only, ACM cert)
                             ▼
                   ECS Fargate tasks (private subnet)
                   - task execution role: pull image, read
                     specific Secrets Manager ARNs only
                   - task role: least-privilege S3 + RDS access
                             │
              ┌──────────────┼───────────────────┐
              ▼                                   ▼
   RDS PostgreSQL (private subnet)        S3 (files: receipts,
   - KMS-encrypted at rest                payslips, reports, photos)
   - TLS in transit                       - KMS-encrypted at rest
   - least-privilege app DB role          - public access blocked
              │                                   │
              └──────────────┬────────────────────┘
                              ▼
                     CloudWatch Logs/Alarms
                     (auth events, admin actions,
                      financial-record mutations)
                              │
                              ▼
                     SNS → on-call notification
                     (small-team incident response, §7)
```

---

## 6. Secure SDLC practices

- **Dependency scanning:** Dependabot enabled on the GitHub repo (free, minimal setup) for
  `npm`, covering `client/`, `server/`, `packages/shared`. Escalate to Snyk only if Dependabot's
  signal quality proves insufficient — don't add tooling cost the team doesn't need yet.
- **SAST:** add a lightweight static-analysis step to CI (e.g., `eslint-plugin-security` or
  Semgrep's free OSS ruleset) running alongside the existing `npm run typecheck`. Keep the rule
  set small and high-signal to avoid alert fatigue on a small team.
- **Secret scanning:** enable GitHub secret scanning (free on public repos, available on
  private repos with GitHub Advanced Security or via a pre-commit hook using `gitleaks` as a
  no-cost alternative) to catch accidental `.env`/key commits before they land.
- **CI gates:** extend the existing pipeline (`npm run typecheck`, `npm run test -w server`)
  with: dependency-audit step (fails on new Critical/High), SAST step, and the new
  authorization test suite from §4/A01. All four gate merges to `main`.
- **Code review:** require at least one review on PRs touching `server/src/middleware/`,
  `server/src/routes/`, or anything under `packages/shared` (schema changes) — these are the
  highest-leverage files for introducing an access-control or validation bug.

---

## 7. Logging, monitoring, and incident response

### What to log (structured, to CloudWatch Logs)
- Auth events: login success/failure, token refresh, token revocation, logout.
- Authorization failures: any `requireRole` rejection (potential probing signal).
- Admin actions: role/permission changes, org-branding changes, and every `admin/backup` invocation (who, when, export vs. restore).
- Financial-record mutations: fee payment create/edit/delete, salary payment create/edit/delete — enough to answer "who changed this receipt and when" without a separate audit-log table if the structured log is retained long enough; a dedicated `AuditLog` table is a reasonable upgrade if compliance requirements (§8) demand queryable history rather than log-search.

### CloudWatch alarms worth having at this scale (and no more)
- 5xx error rate on the ALB above a threshold (app is broken).
- Login failure rate spike (possible credential-stuffing attempt).
- RDS CPU/storage/connection-count thresholds (capacity issue).
- `admin/backup` invocation (informational alarm → SNS, not a page — just visibility, since it's rare and high-impact).

Skip: multi-metric anomaly-detection ML alarms, full SIEM stack, dedicated security
operations tooling — none of that is proportionate for a small-team, single-tenant-scale
deployment. Revisit if/when Phase 4 multi-tenancy substantially raises the stakes and the
team.

### Incident-response playbooks (small-team scale)

**Suspected credential compromise (e.g., a staff account may be compromised):**
1. Revoke all refresh tokens for the account (delete/mark-revoked rows in the revocation table).
2. Force a password reset for the account; disable login until reset completes.
3. Review the audit log for the account's recent auth events and admin/financial actions.
4. If any unauthorized data change is found, document it and assess scope (which records, which timeframe).
5. Rotate `JWT_SECRET`/`JWT_REFRESH_SECRET` only if there's evidence of secret-level (not just single-account) compromise — this invalidates all sessions, so don't do it reflexively.
6. Notify affected stakeholders per §8 if student/financial data was exposed.
7. Write a short post-incident note: root cause, what was accessed, what changed as a result.

**Suspected data breach (broader than one account — e.g., a leaked DB credential or S3 exposure):**
1. Rotate the affected credential/key immediately via Secrets Manager/KMS.
2. If S3: check bucket public-access settings and access logs for the exposure window.
3. If RDS: check security-group history and CloudTrail for unexpected network access.
4. Identify the blast radius: which tables/records/files, which time window.
5. Preserve logs (CloudWatch, CloudTrail, S3 access logs) before they age out of retention — export if needed.
6. Assess whether affected individuals (families whose children's data may be exposed) need
   to be notified — this is a judgment call informed by §8; don't assume a specific legal
   deadline without confirming which jurisdiction's rules apply.
7. Patch the root cause; add a regression test/control before considering the incident closed.
8. Post-incident review with the full team, even if the team is small — the goal is a durable process change, not just a fix.

---

## 8. Compliance considerations

Makthab holds **student PII for minors** and **financial records**. This document does not
assert which specific data-protection regime applies (that depends on where the operating
Masjid/Madrasa and its students are located, and is a legal question, not an architecture
one) — but a few practices are good hygiene regardless of jurisdiction and are worth building
in now rather than retrofitting later:

- **Data minimization:** collect only the student/guardian fields actually used by the app's
  workflows (admission, fees, attendance, reports) — resist adding "might be useful someday" PII fields.
- **Retention policy:** define how long a withdrawn/graduated student's record is retained
  before anonymization or deletion, and implement it as a scheduled job, not a manual process
  someone has to remember. Consult whoever owns compliance posture (per the overview doc §6.3) before setting a concrete number.
- **Right to access/export:** the existing report-generation infrastructure (PDF/Excel) is
  already close to what's needed to hand a guardian their child's own record on request — worth explicitly scoping as a supported workflow rather than an ad-hoc DB query.
- **Parental/guardian consent:** if the product is sold to other Masajid (per the multi-tenant
  direction), each tenant organization — not Makthab the vendor — is typically the data
  controller responsible for consent; document this responsibility split clearly in any
  tenant-facing terms once Phase 4 is underway. This is a business/legal decision to make explicitly, not an assumption to bake into the architecture silently.
- **If GDPR-equivalent rules end up applicable** (e.g., serving EU-resident families, or a
  jurisdiction with similar law): the controls in this document (encryption, access control,
  audit logging, breach-notification-capable incident response) cover most of the technical
  baseline such regimes expect, but a formal DPIA and legal review would still be needed —
  out of scope for this architecture document.

---

## 9. Secure deployment checklist

Pre-launch, verify all of the following:

- [ ] No seeded/default credentials (`admin/admin123` or equivalent) exist outside local dev/test databases.
- [ ] `JWT_SECRET`/`JWT_REFRESH_SECRET`/`DATABASE_URL` sourced from Secrets Manager, not baked into images or committed `.env` files.
- [ ] TLS enforced end-to-end (client↔CloudFront, CloudFront↔ALB, ALB↔ECS if applicable, ECS↔RDS).
- [ ] RDS and S3 encrypted at rest with customer-managed KMS keys.
- [ ] S3 buckets have Block Public Access enabled at the bucket and account level.
- [ ] Security groups default-deny with explicit least-privilege allow rules only.
- [ ] WAF attached to CloudFront/ALB with the AWS managed baseline rule groups.
- [ ] Rate limiting active on `/auth/login` and `/auth/refresh`.
- [ ] Refresh-token revocation implemented and tested (revoke → subsequent refresh fails).
- [ ] Automated authorization test suite passing in CI (per-role route/record access assertions).
- [ ] Dependabot/secret-scanning enabled on the repository.
- [ ] CI gates (typecheck, tests, dependency audit, SAST) all green and required for merge to `main`.
- [ ] CloudWatch alarms (§7) configured and routed to an actual on-call notification channel.
- [ ] Audit logging live for auth, admin actions, and financial-record mutations.
- [ ] `admin/backup` route isolated per §3.2 and tested (both export and restore paths).
- [ ] IAM roles for ECS tasks scoped to specific resource ARNs, not wildcard `*` policies.
- [ ] Incident-response playbooks (§7) reviewed by whoever will actually be on call.
- [ ] Data retention policy documented, even if enforcement automation is a fast-follow.
- [ ] Backup/restore procedure tested end-to-end at least once before go-live (not just assumed to work).

---

## 10. Migration/implementation plan

Fits the overview doc's **4-8 week, overlapping Phase 2/4** window.

| Sub-phase | Weeks | Work |
|---|---|---|
| 3a. Threat model + secure-SDLC baseline | 1-2 (can start immediately, no infra dependency) | Finalize this threat model with the team; enable Dependabot/secret-scanning; add SAST + audit CI gates. |
| 3b. Application hardening | 2-4 (parallel with Phase 2 infra work) | Refresh-token revocation table + checks; rate limiting; file-upload validation; audit logging plumbing. |
| 3c. Infra hardening (needs Phase 2 infra to exist) | 4-6 | VPC security groups, WAF, KMS keys, Secrets Manager wiring, least-privilege IAM roles/DB roles. |
| 3d. Authorization test suite + `admin/backup` isolation | 5-7 | Automated per-role tests in CI; redesign backup route's access path. |
| 3e. Checklist sign-off + (optional) external pen test | 7-8 | Run the §9 checklist; if budget allows, a scoped external pen test focused on auth flows, IDOR on document downloads, and the backup route — the highest-value targets given this app's attack surface. |

---

## 11. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refresh-token revocation shipped late, stolen token remains valid in the interim | Medium | Medium | Prioritize 3b early; it's independent of infra and cheap to implement |
| Rate limiting misconfigured, locks out legitimate shared-IP users (e.g. school office) | Medium | Low | Key rate limit on username+IP, not IP alone; generous threshold; alert (don't silently block) on trip |
| `admin/backup` isolation adds enough friction that it's skipped under deadline pressure | Low-Med | Critical | Treat as a Phase 3 exit-criterion, not optional polish, given it's the single highest-blast-radius route |
| Compliance section is treated as legal advice and acted on without actual legal review | Low | High | Explicit hedging in §8; recommend legal review before any public claims about compliance status |
| Alert fatigue from over-broad SAST/audit rules causes the team to start ignoring CI security gates | Medium | Medium | Keep rule sets small and high-signal (§6); tune based on false-positive rate in the first month |

---

## 12. Testing / validation plan

- **Automated authorization test suite:** for each role (Admin/Accountant/Teacher), assert
  which routes return 200 vs. 403, and that record-level scoping works (e.g., a Teacher
  fetching another teacher's assigned-class attendance gets 403/404, not the data). Runs in
  CI on every PR touching routes/middleware — this is the single highest-value automated
  security test for this app given its RBAC model.
- **IDOR regression tests:** for receipt/payslip download endpoints, assert that a user
  cannot fetch a document ID outside their permitted scope.
- **Dependency/SAST gates:** already covered as CI gates in §6/§10 — "testing" here means
  verifying they actually fail the build on a known-bad injected dependency/pattern during
  Phase 3 setup (don't just enable the tool and assume it works).
- **Backup/restore drill:** perform a full export → restore cycle against a staging
  environment before go-live, and verify the isolated-access-path change from §3.2 actually
  blocks a non-privileged-path request.
- **External pen test (recommended scope if budget allows):** authentication/session
  management, IDOR on document downloads, the backup/restore route, and file-upload handling
  — these four areas concentrate most of this app's realistic attack surface; a full
  enterprise-scope pen test isn't proportionate at this stage.
- **Incident-response tabletop exercise:** walk through both playbooks in §7 with the actual
  on-call team once, before a real incident, to confirm the steps are executable in practice
  (e.g., "does whoever is on call actually have Secrets Manager rotate permissions?").
