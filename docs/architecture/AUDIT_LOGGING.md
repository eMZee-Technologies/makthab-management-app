# Audit Logging — Implementation Plan & Contract

Makthab’s application-level audit trail for authentication and mutating
operations. Complements (does not replace) the existing domain-specific tables
`RolePermissionAudit` and `UserApprovalAudit`, and the structured Winston
application logger.

Aligned with `docs/architecture/redesign/03-security.md` §7 (A09 Security
Logging) and BUILD_CONTRACT roles/permissions.

---

## 1. Data model and schema

### `AuditLog` (Prisma — Postgres canonical; SQLite generated)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `String` (cuid-like) | Primary key |
| `timestamp` | `DateTime` | Default `now()` |
| `userId` | `Int?` | Actor; null for anonymous / system jobs |
| `action` | `String` | `login`, `create`, `update`, `delete`, `backup`, `purge`, … |
| `entity` | `String` | Resource type: `auth`, `student`, `fee`, `admin`, … |
| `resourceId` | `String?` | Stringified entity id |
| `ipAddress` | `String?` | From `X-Forwarded-For` / socket |
| `userAgent` | `String?` | Truncated |
| `outcome` | `String` | `success` \| `failure` |
| `additionalDetails` | `String?` | Redacted JSON |
| `contentHash` | `String` | SHA-256 of canonical fields |
| `prevHash` | `String?` | Previous row’s `contentHash` (tamper-evident chain) |

### Indexing (admin query paths)

| Index | Supports |
| --- | --- |
| `timestamp` | Date-range list + retention purge |
| `userId`, `(userId, timestamp)` | “What did this user do?” |
| `action`, `(action, timestamp)` | Action filters |
| `entity`, `(entity, resourceId)` | Resource history |
| `outcome`, `(timestamp, outcome)` | Failure spikes |

Migration: `server/prisma/migrations/20260804180000_audit_log/` (and SQLite twin).

---

## 2. Core functionality

### Recording

- `recordAudit` / `recordAuditFromRequest` in `server/src/lib/audit/auditLog.ts`.
- Never throws to callers (audit must not break primary flows).
- Wired today for: **login** success/failure, **student** create/update/delete,
  **fee** create, **admin backup**, **purge**. Extend the same helper on other
  routers as needed.

### Admin API (`admin.view` / `admin.create`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/audit-logs` | Filtered list + pagination |
| `GET` | `/api/v1/admin/audit-logs/:id` | Detail |
| `GET` | `/api/v1/admin/audit-logs/integrity` | Hash-chain verification |
| `POST` | `/api/v1/admin/audit-logs/purge` | Manual retention purge (`admin.create`) |

#### List query

```
?from=&to=&userId=&action=&entity=&outcome=&resourceId=&page=&limit=&sortBy=&sortOrder=
```

#### List response

```json
{
  "data": {
    "items": [
      {
        "id": "…",
        "timestamp": "2026-08-04T12:00:00.000Z",
        "userId": 1,
        "username": "admin",
        "action": "create",
        "entity": "student",
        "resourceId": "42",
        "ipAddress": "127.0.0.1",
        "userAgent": "…",
        "outcome": "success",
        "additionalDetails": { "admissionNo": "A-001" },
        "contentHash": "…",
        "prevHash": "…"
      }
    ],
    "total": 100,
    "page": 1,
    "limit": 50
  }
}
```

### Admin UI

| Component | Role |
| --- | --- |
| `AuditLogsPage` | Page shell + integrity button |
| `AuditFilters` | Date range, user, action, entity, outcome |
| `AuditLogTable` | Sortable paginated table |
| `AuditLogDetail` | Side/below detail panel |

Route: `/audit-logs` (gated by `admin.view`). Nav item under Admin tools.

---

## 3. Purging and retention

| Env | Default | Meaning |
| --- | --- | --- |
| `AUDIT_LOG_RETENTION_MONTHS` | `12` | Keep this many months |
| `AUDIT_LOG_PURGE_CRON` | `15 3 * * *` | Daily 03:15; set `off` to disable |
| `AUDIT_LOG_VOLUME_WARN_PER_MINUTE` | `200` | Winston warn threshold |

`startAuditRetentionJob()` runs from `server/src/index.ts` on boot.
Purge deletes rows with `timestamp < now - retention`; a purge audit entry is
written first so the action itself is recorded.

### Compliance notes

- **Immutable where feasible:** app code only *creates* rows; no update API.
  Deletes only via retention purge.
- **Tamper-evident:** `contentHash` + `prevHash` chain; `GET …/integrity`.
- **Secure storage:** rely on DB encryption at rest (Postgres/RDS KMS in prod
  per security redesign). For stronger guarantees, ship copies to append-only
  object storage / CloudWatch Logs Insights.
- Domain audits (`RolePermissionAudit`, `UserApprovalAudit`) remain for
  fine-grained permission/approval history.

---

## 4. Security and access control

- Read: `requireResourcePermission("admin", "view")`.
- Manual purge: `admin.create` (same bar as backup).
- Teachers/Accountants without `admin` grants cannot list logs.
- Integrity check is read-only and admin-gated.
- **Write-once suggestions (ops):** Postgres role without `UPDATE`/`DELETE` on
  `AuditLog` for the app user except a dedicated purge role; optional WORM
  S3 export of nightly dumps.

---

## 5. Observability and reliability

- **Redaction:** passwords, tokens, OTP, secrets stripped via `redactDetails`
  before JSON persistence; strings truncated.
- **Volume alert:** rolling 60s counter → Winston `warn` (hook CloudWatch metric
  filter / SNS in production).
- Prefer not logging full student PII in `additionalDetails` — ids +
  non-sensitive keys only (admission no., field names changed, amounts).

---

## 6. Tech stack (Makthab-specific)

| Layer | Choice |
| --- | --- |
| API | Node 20 + Express (existing) |
| ORM / DB | Prisma 5 + SQLite (dev) / PostgreSQL (prod) |
| Shared DTOs | Zod in `@makthab/shared` (`schemas/audit.ts`) |
| Jobs | `node-cron` retention job |
| UI | React + Vite + existing shadcn table/filter patterns |

**Alternatives (not used here):** NestJS modules; TypeORM; DynamoDB TTL;
EventStoreDB event-sourcing; OpenSearch/ELK as primary store. Those remain
valid if Makthab later outgrows a single relational audit table — export the
same envelope to a centralized logger and keep the DB table for admin UX.

---

## 7. Example snippets

### Record a CRUD action

```ts
await recordAuditFromRequest(req, {
  action: "create",
  entity: "student",
  resourceId: student.id,
  outcome: "success",
  additionalDetails: { admissionNo: student.admissionNo },
});
```

### Fetch filtered logs

```http
GET /api/v1/admin/audit-logs?from=2026-01-01&action=login&outcome=failure&page=1&limit=50
Authorization: Bearer <admin-access-token>
```

---

## Rollout checklist

- [x] Prisma model + dual migrations
- [x] Shared Zod schemas
- [x] `recordAudit` + redaction + hash chain
- [x] Admin list / detail / integrity / purge API
- [x] Retention cron
- [x] Instrument auth + students + fees + backup
- [x] Admin UI (`AuditFilters`, `AuditLogTable`, `AuditLogDetail`)
- [ ] Extend instrumentation to remaining routers (attendance, finance, roles, users)
- [ ] CloudWatch metric/alarm on volume warn + login-failure spike
