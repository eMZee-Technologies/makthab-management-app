# User Management — Signup, OTP, Admin Approval, Forgot Password

**Status:** MVP scaffolding implemented on branch `cursor/user-management-admin-approval-0884`.
**Stack (confirmed):** Makthab’s existing architecture — **not** a greenfield Node/Postgres app.

| Layer | Choice | Why |
|---|---|---|
| API | Node 20 + Express + TypeScript | Already the BUILD_CONTRACT stack |
| DB | Prisma 5 + **SQLite (dev/test) / PostgreSQL (prod)** | Dual-provider already wired (`DATABASE_PROVIDER`) |
| Auth tokens | JWT Bearer (`Authorization` header) + refresh token | Existing login/refresh; Bearer-in-header avoids classic CSRF |
| Password hashing | bcryptjs (cost 12) | Already used; OTP codes hashed at cost 10 |
| Client | React 18 + Vite + Tailwind + shadcn | Existing SPA |
| Shared contracts | Zod in `@makthab/shared` | Single source for request DTOs |

## Scope decisions (vs the original assumptions)

1. **No separate Admins table** — use `User.role` + `users.manage` permission (existing RBAC).
2. **Self-signup is additive** — Admin `POST /users` still creates **active** accounts immediately.
3. **Email OR phone** — `User.email` and `User.phone` are both optional/unique; signup Zod requires at least one and that it matches `otpMethod`.
4. **CSRF** — not required while tokens stay in memory/`Authorization` (not cookies). If refresh moves to httpOnly cookies, add double-submit CSRF before that change ships.
5. **MFA** — columns `mfaEnabled` / `mfaSecret` are scaffolded; TOTP enroll/verify is Phase 2.
6. **OTP delivery** — console/Winston logger MVP; optional `SMTP_*` / `SMS_*` env hooks for Phase 2 providers.

## Account lifecycle

```
signup ──► pending_verification ──(OTP ok)──► pending_approval ──(admin approve)──► active
                │                                      │
                │                                      └──(admin reject)──► rejected
                └── login blocked (same 401 as bad password — anti-enumeration)
```

Forgot password: `forgot-password` → OTP → `resetToken` → `reset-password` (active / pending_approval only).

## API contract (`/api/v1`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/signup` | public + rate limit | Creates Staff+User `pending_verification`, sends OTP |
| POST | `/auth/verify-otp` | public + rate limit | signup → `pending_approval` + admin notification; password_reset → `resetToken` |
| POST | `/auth/resend-otp` | public + rate limit | 60s cooldown |
| POST | `/auth/forgot-password` | public + rate limit | Always 200; anti-enumeration |
| POST | `/auth/reset-password` | public + rate limit | Consumes `resetToken` |
| POST | `/auth/login` | public + rate limit | Lockout after `LOGIN_MAX_FAILURES`; inactive statuses → 401; issues refresh session (`RefreshSession`) |
| POST | `/auth/refresh` | public + rate limit | Verifies jti against `RefreshSession`; rotates refresh token |
| POST | `/auth/logout` | public | Body `{ refreshToken?, allDevices? }` — revokes session(s) |
| GET | `/users?status=pending_approval` | `users.manage` | Approval queue |
| POST | `/users/:id/approve` | `users.manage` | Audit row `approved` |
| POST | `/users/:id/reject` | `users.manage` | Audit row `rejected` |
| GET | `/users/:id/approval-audit` | `users.manage` | Audit history |
| POST | `/users/:id/revoke-sessions` | `users.update` | Force-logout — revoke all refresh sessions |
| GET | `/users/notifications` | `users.manage` | In-app admin alerts |
| POST | `/users/notifications/:id/read` | `users.manage` | Mark read |

### Example: signup → OTP → approve → login

```http
POST /api/v1/auth/signup
{ "fullName":"<Full Name>","username":"<username>","password":"<strong-password>",
  "email":"user@example.com","otpMethod":"email" }

→ { "data": { "challengeId":"…", "message":"…", "devOtp":"<otp>" } }  # devOtp non-prod only

POST /api/v1/auth/verify-otp
{ "challengeId":"…", "code":"<otp>" }

→ { "data": { "purpose":"signup", "status":"pending_approval", "message":"…" } }

POST /api/v1/users/42/approve   Authorization: Bearer <admin-access-token>
{ "role":"Teacher", "note":"Verified" }

POST /api/v1/auth/login
{ "username":"<username>", "password":"<strong-password>" }
→ { "data": { "accessToken","refreshToken","user" } }
```

### Example: forgot password

```http
POST /api/v1/auth/forgot-password
{ "username":"<username>" }   # or email / phone

POST /api/v1/auth/verify-otp
{ "challengeId":"…", "code":"…" }
→ { "data": { "purpose":"password_reset", "resetToken":"…" } }

POST /api/v1/auth/reset-password
{ "resetToken":"…", "password":"<new-strong-password>" }
```

## Data model (additions)

- **User** — `phone`, `otpMethod`, `emailVerifiedAt`, `phoneVerifiedAt`, `failedLoginAttempts`, `lockedUntil`, `mfaEnabled`, `mfaSecret`; `email` nullable; expanded `status`.
- **OtpChallenge** — hashed 6-digit codes, attempt limits, expiry.
- **PasswordResetToken** — issued after password-reset OTP success.
- **UserApprovalAudit** — immutable approve/reject trail.
- **AdminNotification** — in-app queue for admins.

Migrations: `server/prisma/migrations/20260802140000_user_management_auth` (Postgres) and `server/prisma/sqlite/migrations/20260802140000_user_management_auth` (SQLite).

## Security controls (MVP)

| Control | Implementation |
|---|---|
| Password hashing | bcryptjs cost 12 |
| OTP hashing | bcryptjs cost 10; never store plaintext |
| Password strength | `strongPasswordSchema` on signup / self-reset |
| Rate limiting | `express-rate-limit` on auth + OTP routes |
| Account lockout | `failedLoginAttempts` + `lockedUntil` |
| Anti-enumeration | Uniform login / forgot-password / inactive-status errors |
| Validation | Zod via existing `validateBody` (HTTP 400) |
| Audit | `UserApprovalAudit` on approve/reject |
| CSRF | N/A for Bearer header; revisit if cookie auth ships |
| MFA | Schema only (Phase 2) |

## Environment variables

See `server/.env.example`. New keys: `SMTP_*`, `SMS_*`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`, `SIGNUP_DEFAULT_ROLE`.

## File map

```
packages/shared/src/schemas/auth.ts     # signup/OTP/forgot/approve DTOs
packages/shared/src/schemas/user.ts     # status enum + phone on UserDto
server/prisma/schema.prisma             # User extensions + new models
server/src/lib/auth/{otp,notifier,passwordReset,rateLimit}.ts
server/src/routes/auth.ts               # public auth lifecycle
server/src/routes/users.ts              # approve/reject/notifications
server/tests/auth-lifecycle.test.ts
docs/architecture/USER_MANAGEMENT_AUTH.md  # this file
```

## Phased rollout

### Phase 1 — MVP (this PR)
- Signup + OTP + admin approve/reject + audit + in-app notification
- Forgot / reset password
- Rate limit + lockout + strong password on self-service
- Integration tests in `auth-lifecycle.test.ts`
- Client: links on login + thin signup/forgot pages (scaffolding)

### Phase 2 — Hardening
- Real SMTP (SES/Nodemailer) + SMS (Twilio/MSG91)
- Refresh-token revocation table (security redesign §3.2)
- Optional TOTP MFA enroll/verify
- Cookie-based refresh + CSRF if product requires it
- Admin email digest / WhatsApp alert for pending signups

### Phase 3 — Product polish
- Approval queue UI with bulk actions
- Signup analytics / abandonment metrics
- CAPTCHA on signup when abuse appears

## Applying migrations after pull (fixes `User.phone` does not exist)

The Prisma client was regenerated with new `User` columns (`phone`, lockout,
OTP timestamps, etc.). If you pull this branch but **do not deploy migrations**,
login/signup fail with:

```
The column `User.phone` does not exist in the current database.
```

Your stack trace shows `postgres-client` → the **running API** was on PostgreSQL.
`db:deploy` must use the same provider as `server/.env`. Typical Windows failure:

```
Error: the URL must start with the protocol `file:`
[db:deploy] DATABASE_PROVIDER=sqlite
```

That means either:
1. `DATABASE_PROVIDER` was missing when the script ran (fixed: script now loads `.env`), or
2. `server/.env` has a **mismatch** — e.g. `DATABASE_PROVIDER=sqlite` with a `postgresql://…` URL
   (or the reverse).

**Fix `server/.env` (must be this file, not a root `.env`)** for Docker Compose:

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5434/makthab_dev"
```

Note the host port is **5434** (see `docker-compose.yml`), not 5432 or 5433 —
those are commonly claimed by a natively-installed Postgres service on
Windows (the EDB installer auto-starts one per version). If you're pointing
at a native install instead of this Docker container, use whatever port that
service is actually listening on, not 5434.

Then use the **Postgres-specific** migrate command (avoids the sqlite schema entirely):

```powershell
git pull
docker compose up -d
npm run db:deploy:pg -w server
# first time / empty DB, also seed:
npm run db:seed:pg -w server
npm run dev
```

Equivalent explicit command:

```powershell
cd server
npx cross-env DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://USER:PASSWORD@localhost:5434/makthab_dev" prisma migrate deploy --schema=./prisma/schema.prisma
```

## Branch & PR checklist

```bash
git checkout -b cursor/user-management-admin-approval-0884   # cloud agent naming
# (preferred product name was feature/user-management-admin-approval —
#  use cursor/*-0884 in this environment)

npm install
npm run build:shared
npm run db:generate -w server && npm run db:generate:sqlite -w server
# Apply migrations for your active provider:
npm run db:deploy -w server
# SQLite local (alternative wipe):
#   npm run db:reset -w server
npm run typecheck
cd server && DATABASE_URL="file:./test.db" npx prisma migrate reset --force --schema=./prisma/sqlite/schema.prisma
cd server && DATABASE_URL="file:./test.db" npx jest tests/auth-lifecycle.test.ts --runInBand
```

PR checklist:
- [ ] Shared schemas exported; client alias picks them up
- [ ] Both Postgres + SQLite migrations present
- [ ] `npm run typecheck` green
- [ ] Auth lifecycle Jest suite green
- [ ] Seeded admin can approve; pending user cannot login before approve
- [ ] `devOtp` absent when `NODE_ENV=production`
- [ ] BUILD_CONTRACT changelog updated
