# File storage: local filesystem vs AWS S3

Makthab stores uploaded photos, signatures, org header images, and generated
receipt PDFs behind a **storage adapter**. Development keeps writing under
`data/files/` (or `LOCAL_UPLOAD_PATH`). Production (or any deploy with
`STORAGE_BACKEND=s3`) writes to an S3 bucket using the same relative keys
(`photos/…`, `receipts/…`, …).

This implements Phase 2 milestone M3 from
[`docs/architecture/redesign/02-cloud-deployment-aws.md`](../architecture/redesign/02-cloud-deployment-aws.md).

---

## 1. Design notes

### Environment detection and routing

| Condition | Backend |
|---|---|
| `STORAGE_BACKEND=local` | Local filesystem (always) |
| `STORAGE_BACKEND=s3` | S3 (requires `S3_BUCKET` + `AWS_REGION`) |
| unset + `NODE_ENV=production` | **S3** |
| unset + any other `NODE_ENV` | **Local** |

The factory (`server/src/lib/storage/factory.ts`) memoizes one adapter per
process and fails fast at boot if S3 is selected without bucket/region.

### Required infrastructure

**Bucket naming (suggested):** `makthab-files-<env>` (e.g. `makthab-files-prod`).
Keep the same logical prefixes as today:

- `photos/` — student/staff/org images + signatures  
- `receipts/` — fee receipt PDFs  
- `payslips/` — reserved  
- `reports/` — reserved  

**IAM (ECS task role preferred over long-lived keys):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MakthabFilesObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::makthab-files-prod/*"
    },
    {
      "Sid": "MakthabFilesListBucket",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::makthab-files-prod"
    }
  ]
}
```

On Fargate, attach this policy to the **task role** and omit
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (SDK default credential chain).
Static keys are supported for local S3 smoke tests only.

**Block public access** on the bucket. Enable default encryption (SSE-S3 or
SSE-KMS) and versioning (see cloud deploy doc §8).

### Environment variables

| Variable | Required when | Purpose |
|---|---|---|
| `NODE_ENV` | always | `production` auto-selects S3 if `STORAGE_BACKEND` unset |
| `STORAGE_BACKEND` | optional | Force `local` or `s3` |
| `LOCAL_UPLOAD_PATH` | optional (local) | Override root (default `data/files`) |
| `S3_BUCKET` | S3 | Bucket name |
| `AWS_REGION` | S3 | e.g. `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | optional | Static creds; prefer IAM role in AWS |
| `AWS_SECRET_ACCESS_KEY` | optional | Pair with access key |

### Security considerations

| Topic | Decision |
|---|---|
| **Upload path** | Clients still POST multipart to the authenticated API. The server validates MIME/size/role, then the adapter writes to local disk or S3. **No direct browser→S3 uploads** in this phase (avoids complex CORS/presign write policies for a small staff app). |
| **Download path** | API continues to **proxy** bytes through auth-gated GET routes (`/students/:id/photo`, `/fees/:id/receipt`, …). `S3StorageAdapter.getSignedUrl` exists for a future opt-in, but is not wired to clients yet — keeps access control identical to today. |
| **Key safety** | All keys must be relative; `..` and absolute paths are rejected (`assertSafeStorageKey`). |
| **Credentials** | Prefer task-role IAM over env keys. Never log secret values. |
| **Bucket ACL** | Private; no public-read. |

---

## 2. Implementation map

| Piece | Location |
|---|---|
| `StorageAdapter` interface | `server/src/lib/storage/types.ts` |
| `LocalStorageAdapter` | `server/src/lib/storage/local.ts` |
| `S3StorageAdapter` (multipart via `@aws-sdk/lib-storage`) | `server/src/lib/storage/s3.ts` |
| Factory | `server/src/lib/storage/factory.ts` |
| Key helpers + legacy absolute `pdfPath` normalize | `server/src/lib/storage/keys.ts` |
| Multer → memory → `saveUploadedFile` | `server/src/lib/upload.ts` |
| Fee receipts store relative `receipts/{receiptNo}.pdf` | `server/src/routes/fees.ts` |

---

## 3. Migration notes (existing local files)

**Photos / signatures / org images** already store relative keys (`photos/…`).
No DB migration needed; copy objects if you cut over to S3:

```bash
aws s3 sync ./data/files/s3://makthab-files-prod/ \
  --exclude "*" --include "photos/*" --include "receipts/*"
```

**Fee `pdfPath`:** older rows may hold absolute paths such as
`/app/data/files/receipts/R-….pdf`. New writes store `receipts/R-….pdf`.
`normalizeStoredKey()` strips a `/files/` prefix (or relativizes under
`FILES_DIR`) so both shapes resolve. Optionally backfill:

```sql
-- PostgreSQL example — only if you want clean relative keys in the DB
UPDATE "FeePayment"
SET "pdfPath" = regexp_replace("pdfPath", '^.*/files/', '')
WHERE "pdfPath" LIKE '%/files/%';
```

**Keep local files as-is:** run production with `STORAGE_BACKEND=local` and a
persistent volume on `LOCAL_UPLOAD_PATH` (not recommended on multi-task
Fargate — ephemeral disk). Prefer S3 for any multi-task deploy.

---

## 4. Deployment / run instructions

### Development (local FS)

```bash
# server/.env (or export)
NODE_ENV=development
# STORAGE_BACKEND=local   # optional; this is the default outside production
# LOCAL_UPLOAD_PATH=/absolute/path/to/files   # optional override

npm run dev -w server
```

Uploads land under `data/files/photos/…` and `data/files/receipts/…`.

### Production (S3)

```bash
NODE_ENV=production
STORAGE_BACKEND=s3          # optional when NODE_ENV=production
S3_BUCKET=makthab-files-prod
AWS_REGION=ap-south-1
# Omit keys on ECS — use the task role. For a laptop smoke test:
# AWS_ACCESS_KEY_ID=…
# AWS_SECRET_ACCESS_KEY=…
```

Docker Compose `app` profile sets `NODE_ENV=production` for JWT hardening;
it defaults `STORAGE_BACKEND=local` so a laptop container still works without
AWS. Override with real S3 vars when exercising the cloud path.

### Local testing both backends

```bash
# 1) Unit tests (LocalStorageAdapter + key safety)
npm run test -w server -- --testPathPattern=storage

# 2) Integration (local backend, default)
DATABASE_URL="file:./test.db" npx prisma migrate reset --force --schema=./prisma/sqlite/schema.prisma
DATABASE_URL="file:./test.db" npm run test -w server -- --testPathPattern='finance|fees'

# 3) Force S3 against a real/dev bucket (manual smoke)
STORAGE_BACKEND=s3 S3_BUCKET=… AWS_REGION=… AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
  npm run dev -w server
# Then POST a staff photo and confirm the object appears in the bucket under photos/
```

### Build steps

No special scripts beyond the usual:

```bash
npm install
npm run build:shared
npm run typecheck
npm run build -w server
```

Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`,
`@aws-sdk/s3-request-presigner` (server workspace).

---

## 5. Validation checklist

- [ ] `NODE_ENV=development` (or `STORAGE_BACKEND=local`): upload a staff/student
      photo → file appears under `data/files/photos/` (or `LOCAL_UPLOAD_PATH`).
- [ ] Same upload’s `photoPath` in the API response is a relative key
      (`photos/…`) and `GET …/photo` streams the image.
- [ ] Collect a fee → `pdfPath` is `receipts/{receiptNo}.pdf` and
      `GET /fees/:id/receipt` returns the PDF.
- [ ] `STORAGE_BACKEND=s3` with valid creds: same flows create objects in the
      bucket under `photos/` / `receipts/`; GET routes still stream via the API.
- [ ] Invalid keys / path traversal are rejected (see `storage.test.ts`).
- [ ] Boot with `NODE_ENV=production` and missing `S3_BUCKET` fails fast with a
      clear error (does not silently write to ephemeral container disk).
