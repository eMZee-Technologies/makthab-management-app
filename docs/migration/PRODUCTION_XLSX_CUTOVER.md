# Production cutover — xlsx → PostgreSQL (one-time)

Secure procedure for loading
`docs/source-data/Maktab Detailed - Report.xlsx` into **production RDS**
exactly once. Day-to-day deploys must **not** re-run this.

The importer already exists and is idempotent:

```bash
npm run migrate:xlsx:pg -w server   # DATABASE_PROVIDER=postgresql
# script: server/prisma/migrate-from-xlsx.ts
```

Sheet mapping and expected counts: [MIGRATION.md](./MIGRATION.md)
(69 students, 672 fees, …).

---

## Security principles

| Rule | Why |
|---|---|
| **Never bake the xlsx into the Docker image** | It contains student/guardian PII and financial history. `.dockerignore` already excludes `docs/source-data/`. |
| **Never commit production `DATABASE_URL` / passwords** | Use Secrets Manager (or a short-lived CI secret). |
| **Run import as a one-off job**, not on every ECS boot | Steady-state tasks should have `RUN_XLSX_IMPORT` unset / `false`. |
| **Encrypt at rest and in transit** | S3 SSE + RDS encryption; `DATABASE_URL` with `sslmode=require`. |
| **Least privilege** | Job role: `s3:GetObject` on one key + DB DML only; no public S3. |
| **Delete / archive the source after success** | Remove the live copy from the migration bucket (or move to a locked archive with retention). |
| **Reconcile before go-live** | Count mismatches are a cutover blocker, not a follow-up ticket. |

---

## Recommended flow (AWS PRD)

```
┌─────────────┐     put (SSE)      ┌──────────────────┐
│ Operator PC │ ─────────────────▶ │ S3 (private)     │
│  xlsx file  │                    │ makthab-prd-mig/ │
└─────────────┘                    └────────┬─────────┘
                                            │ get (task role)
                                            ▼
                                   ┌──────────────────┐
                                   │ One-off ECS task │
                                   │ or CI job        │
                                   │ seed → xlsx import│
                                   └────────┬─────────┘
                                            │ SSL
                                            ▼
                                   ┌──────────────────┐
                                   │ RDS PostgreSQL   │
                                   └──────────────────┘
```

### 1. Prepare RDS (empty app schema)

- Terraform (or equivalent) has created RDS; Secrets Manager holds `DATABASE_URL`.
- First API deploy may run **schema migrations + seed only**  
  (`RUN_XLSX_IMPORT` **not** set). Seed creates Admin/roles/years/classes.

### 2. Stage the workbook securely

```bash
# From a trusted machine — do not email the file or put it in a public bucket
aws s3 cp "./Maktab Detailed - Report.xlsx" \
  "s3://makthab-prd-migration/Maktab Detailed - Report.xlsx" \
  --sse AES256 \
  --acl bucket-owner-full-control
```

- Bucket: private, Block Public Access on, versioning optional.
- Object key known only to operators + the import job role.

### 3. Run a one-off import job (preferred over “always-on” ECS)

**Option A — ECS RunTask (recommended)**  
Same image as the API, override command / env for a single task in the private subnet:

| Env | Value |
|---|---|
| `DATABASE_PROVIDER` | `postgresql` |
| `DATABASE_URL` | from Secrets Manager |
| `NODE_ENV` | `production` |
| `SKIP_SEED` | `false` (first time) or rely on check-seeded |
| `RUN_XLSX_IMPORT` | `true` |
| `SEED_*_PASSWORD` | required in production seed (see seed.ts) |

Mount or download the file to:

`/app/docs/source-data/Maktab Detailed - Report.xlsx`

Example download step inside the one-off command:

```bash
mkdir -p docs/source-data
aws s3 cp "s3://makthab-prd-migration/Maktab Detailed - Report.xlsx" \
  "docs/source-data/Maktab Detailed - Report.xlsx"
npm run db:seed:pg -w server          # no-op if already seeded
npm run migrate:xlsx:pg -w server
rm -f "docs/source-data/Maktab Detailed - Report.xlsx"
```

**Option B — GitHub Actions / operator laptop with VPN**  
Only if the runner can reach RDS privately (bastion, SSM port-forward, or
temporary public + IP allowlist — prefer private). Same npm commands; delete
local xlsx when done.

**Option C — First ECS boot with bind/mount (compose-style only)**  
`RUN_XLSX_IMPORT=true` + mount the xlsx (see `docker-entrypoint.sh`).  
Acceptable for a controlled first boot; **turn the flag off** on the next
task definition revision so later deploys skip import.

### 4. Reconcile (go-live gate)

Against production RDS:

```sql
SELECT COUNT(*) FROM "Student";          -- expect 69
SELECT COUNT(*) FROM "FeePayment";       -- expect 672
SELECT COUNT(*) FROM "SalaryPayment";    -- expect 35
SELECT COUNT(*) FROM "Expense";          -- expect 52
```

Also spot-check fee sum / a few admission numbers against the workbook.
If counts disagree: **do not cut traffic over**; fix and re-run (idempotent
upserts) or restore from snapshot and retry.

### 5. Lock down after success

1. Set `RUN_XLSX_IMPORT=false` (or remove) on the ECS task definition.
2. Delete the S3 object (or move to a Glacier/archive prefix with deny-delete IAM).
3. Confirm steady-state deploys only run `prisma migrate deploy` (+ skip seed).
4. Take an RDS snapshot labeled `post-xlsx-cutover-YYYYMMDD`.

---

## What not to do

- Do **not** copy the xlsx into the image or into git for “convenience”.
- Do **not** leave `RUN_XLSX_IMPORT=true` on the long-running API service.
- Do **not** run the import against production from a random public Wi‑Fi
  laptop without VPN/SSM — prefer a private-subnet task.
- Do **not** treat a successful seed-only deploy as “data loaded”.

---

## Local dry-run (before PRD)

```bash
docker compose up -d   # Postgres on :5433
# server/.env:
#   DATABASE_PROVIDER=postgresql
#   DATABASE_URL="postgresql://USER:PASSWORD@localhost:5433/makthab_dev"

npm run db:reset:pg -w server
npm run migrate:xlsx:pg -w server
# verify counts, then practice the same commands you will use in the one-off job
```

---

## Related

- [MIGRATION.md](./MIGRATION.md) — sheet → table mapping  
- [AWS_RUNBOOK.md](../deployment/AWS_RUNBOOK.md) — RDS restore / smoke tests  
- `docker-entrypoint.sh` — `RUN_XLSX_IMPORT` gate  
- Redesign M7.5 — [02-cloud-deployment-aws.md](../architecture/redesign/02-cloud-deployment-aws.md) §9
