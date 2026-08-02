# Makthab v2 — Build Contract (single source of truth)

This file is the coordination contract for the Frontend, Backend, and QA teammates.
It is derived from `Madrasa_React_TS_Architecture.docx`. If anything here conflicts with a
teammate's assumption, **this file wins** — propose a change here (and message the team) before diverging.

## 0. Decision
- **Stack = the docs.** React 18 + TS + Vite + Tailwind + shadcn/ui (client); Node 20 + Express + TS + Prisma 5 + SQLite (server); Zod in `packages/shared`.
- **Single-tenant.** The old `backend/` (Knex, multi-tenant) and `frontend/` (Next.js/MUI) dirs are **DEPRECATED** — do not build in them. Build in `client/`, `server/`, `packages/shared/`.
- **Scope = everything in the docs:** auth, students, fees, attendance, expenses, salary/staff, reports (PDF+Excel), Puppeteer PDF, WhatsApp (wa.me for MVP), dashboard, Arabic/RTL.

## 1. Monorepo layout (pnpm or npm workspaces)
```
packages/shared/    # Zod schemas + shared TS types/DTOs  (OWNER: Backend; CONSUMER: Frontend)
server/             # Express + Prisma API               (OWNER: Backend)
client/             # Vite + React SPA                    (OWNER: Frontend)
data/               # madrasa.db + files/{receipts,payslips,photos,reports}
```
Root `package.json` `workspaces` (or `pnpm-workspace.yaml`) must list: `packages/*`, `server`, `client`.

## 2. API contract  (Backend provides, Frontend consumes, QA verifies)
- Base URL: **`/api/v1`**. All JSON except file uploads (multipart) and PDF/XLSX downloads.
- Auth: **JWT Bearer** in `Authorization` header. Roles: **Admin**, **Accountant**, **Teacher**.
- Standard success envelope: `{ "data": ... }`. Standard error: `{ "error": { "code", "message", "details?" } }` with correct HTTP status.
- Endpoints (from doc §6): students, fees, attendance, expenses/staff/salaries, reports, auth. See doc §6 for the full method/path table — implement all of them.
- CORS: allow the client origin (dev: `http://localhost:5173`).

## 3. Ports & env
- Server API: **`http://localhost:3000`** (`PORT=3000`). Client dev (Vite): **`http://localhost:5173`**.
- Client talks to API via `VITE_API_URL=http://localhost:3000/api/v1`.
- `server/.env`: `DATABASE_URL="file:../data/madrasa.db"`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WHATSAPP_GATEWAY=walink`.

## 4. Shared package (`packages/shared`)
- Backend defines one Zod schema per entity (student, fee, attendance, expense, staff, salary, auth) and exports inferred TS types.
- Frontend imports these schemas for React Hook Form validation and imports the types for API responses.
- **Contract change protocol:** whoever changes a shared schema messages the other two teammates immediately and updates this file's changelog (§8).

## 5. Data model (Prisma) — Backend owns `server/prisma/schema.prisma`
Implement all models from doc §7.1: **Student, FeePayment, Attendance, Expense, Staff, SalaryPayment, Class, AcademicYear, ExpenseCategory**, plus a **User/auth** model for login (staff login with `passwordHash`, `role`). Seed: AcademicYears (2024-25, 2025-26), Classes (LKG, UKG, I, II, 1–7), ExpenseCategories, one admin Staff/User. Migration script already scaffolded at `server/prisma/migrate-from-sheets.ts`.

**Dual-schema layout (multi-database support, see `docs/architecture/redesign/01-multi-database-support.md`):**
`server/prisma/schema.prisma` is now the **canonical PostgreSQL schema**; `server/prisma/sqlite/schema.prisma` is **generated** from it (`npm run db:generate:sqlite-schema -w server`) and must never be hand-edited. Each variant keeps its own migration history (`server/prisma/migrations/` for Postgres, `server/prisma/sqlite/migrations/` for SQLite — the latter holds the original, real migration history applied to `data/madrasa.db`). `DATABASE_PROVIDER=sqlite|postgresql` (default `sqlite`) selects which generated client (`server/prisma/generated/{postgres,sqlite}-client`) the app loads at startup via `server/src/db/client.ts`. All data access outside `server/src/db/*` goes through the repository layer in `server/src/db/index.ts` — route/service code never imports `@prisma/client` or a generated-client path directly.

## 6. Roles / access (enforce on BOTH tiers)
- Admin: full. Accountant: fees, expenses, salaries (no student profile edit). Teacher: attendance for assigned classes only.

## 7. Definition of Done (QA gate)
- `pnpm install` (or `npm install`) clean at root.
- `server`: `prisma migrate dev` + seed succeed; API boots on :3000; `/health` OK; every doc §6 endpoint returns real data (not "coming soon").
- `client`: Vite dev server boots on :5173; login works against real API; each module page loads, lists, and can create a record end-to-end.
- Typecheck passes on client, server, shared. A smoke/e2e pass covers: login → admit student → collect fee (receipt PDF generated) → mark attendance → add expense → run a report.
- No console errors on the happy path. RTL toggle does not break layout.

## 8. Contract changelog (append when you change the contract)
- 2026-07-03 — Initial contract created by the coordinator.
- 2026-07-04 (Backend) — Scaffold done (#1): npm workspaces (`packages/*`,`server`,`client`); root scripts `dev`/`build`/`typecheck`/`db:*`. Server boots on :3000, `/health` returns `{data:{status:"ok",...}}`.
- 2026-07-04 (Backend) — Prisma schema stable (#2). Models: Student, FeePayment, Attendance, Expense, Staff, SalaryPayment, Class, AcademicYear, ExpenseCategory + **User** (auth) + **FeeStructure**. Notes: (a) `User` holds login (`username`,`passwordHash`,`role`) and links 1:1 to `Staff` via `staffId`; the actor FKs `FeePayment.collectedById`/`Attendance.markedById`/`Expense.approvedById` reference **Staff.id** (use the logged-in user's `staffId`). (b) Student adds `notes` + `legacyBillNo` (migration overflow) beyond doc §7.1. (c) `Class.name`, `AcademicYear.name`, `ExpenseCategory.name` are `@unique`. Seed: years 2024-2025/2025-2026, classes LKG,UKG,I,II,1–7, 10 expense categories, admin login **admin / admin123**.
- 2026-07-04 (Backend) — Shared Zod schemas published in `@makthab/shared` (#3): auth/student/fee/attendance/finance/common. See message to Frontend for the export list. Login response = `{ accessToken, refreshToken, user:{id,fullName,username,role} }`.
- 2026-07-05 — **Build complete (#4–#6).** All doc §6 domain routers implemented + mounted in `apiRouter`: auth (login/refresh/logout), students (CRUD + soft-delete + admission PDF), fees (record + receipt PDF + wa.me + defaulters + structures), attendance (single/bulk upsert + summary + low-alert), expenses/staff/salaries, reports (fee-collection/defaulters/attendance/expenses/salary-register PDF+XLSX, financial-summary PDF-only), reference (classes/academic-years/expense-categories), dashboard, admin/backup. Documents render via a **dependency-free built-in PDF writer** (`server/src/lib/pdf.ts`) instead of Puppeteer — installable offline; swap later for rich Arabic HTML. Reports XLSX via ExcelJS. **Contract adjustments:** validation errors now return **400** (was 422) to match the QA suite; `errorHandler` detects `ZodError` structurally (two zod copies exist — root + server-local — so `instanceof` fails cross-package). Client: added the four missing feature pages (dashboard, attendance, finance = expenses/staff/salaries, reports) + `fees/FeeStructures`. Fixed `tsconfig.node.json` (composite+noEmit was invalid) and aliased `@makthab/shared` → its TS source in `vite.config.ts` (CJS `__exportStar` dist isn't rollup-traceable). **Verified:** `npm run typecheck` green across shared/server/client; jest integration suite **45 passed / 8 todo**; server boots :3000 + happy-path smoke (login→admit→fee+PDF→attendance→expense→reports→backup) all pass; client production build succeeds; Vite dev boots :5173; CORS + credentialed login from :5173 confirmed.
- 2026-08-02 (Backend) — **User management / self-signup + admin approval.** Public auth lifecycle: `POST /auth/signup`, `/verify-otp`, `/resend-otp`, `/forgot-password`, `/reset-password` (existing `/login`/`/refresh`/`/logout` hardened with rate limits + account lockout). Admin: `POST /users/:id/approve|reject`, `GET /users/:id/approval-audit`, `GET /users/notifications`. Models: `OtpChallenge`, `PasswordResetToken`, `UserApprovalAudit`, `AdminNotification`; User gains phone/OTP/lockout/MFA scaffold fields and statuses `pending_verification` | `pending_approval` | `rejected`. See `docs/architecture/USER_MANAGEMENT_AUTH.md`.
