# Team task list — 2026-07-23 feature batch

Shared by three teammates: **Backend**, **Frontend**, **QA**. Update your own
rows as you go (`todo` → `in-progress` → `done` / `blocked`). If you're
blocked on another teammate's output, message them directly by name (they are
addressable via SendMessage) rather than guessing at a contract or waiting
silently — and note the blocker here too so it's visible.

Coordinator has already made the judgment calls below;
don't re-litigate them, but do flag via SendMessage if one turns out to be
unworkable once you're in the code.

## Context already gathered (don't re-derive)

- WhatsApp caption is built server-side only, in `server/src/routes/fees.ts`
  `POST /:id/whatsapp` (~line 416-418). There is no duplicate caption
  construction on the client (`client/src/lib/download.ts:34` just opens
  whatever `text` the server already gave it via `buildWhatsAppLink`). One
  fix site, not two.
- `receiptPdf()` / `layoutReceipt()` (`server/src/lib/pdf.ts:463-574`) already
  render the staff "Name (Role)" line unconditionally whenever
  `fee.collectedBy` is present — there is **no existing code-level
  distinction** between monthly and admission receipts in this path. Both
  `migrateAdmissionFees` and `migrateMonthlyFees` set the same
  `collectedById`. So the "missing on monthly" report needs to be
  **reproduced live first**, not fixed blind — see Backend task B2.
- **Dev DB was reset+remigrated in the prior turn of this session.** Only the
  3 seeded users (admin/accountant/teacher) exist; all staff
  `signaturePath`/`photoPath` are currently `null` (any previously-uploaded
  signature is gone locally). `OrgProfile` currently has exactly one row
  (id=1, name "Masjid-O-Madarasa Umar-E-Farooq"). Mention this to the user in
  the final summary — it's a real data-loss disclosure, not just FYI for the
  team.
- Currency symbol fix is **WhatsApp-caption text only**. Do **not** put ₹
  into the PDF writer (`server/src/lib/pdf.ts` is a dependency-free,
  ASCII-only writer per CLAUDE.md — non-ASCII glyphs will not render
  correctly there without a font-embed rework, which is out of scope). PDF
  keeps its current `formatCurrency` output as-is.
- Role system today is a **hardcoded 3-value zod enum**
  (`packages/shared/src/schemas/common.ts:4-5`, `RoleSchema`), not DB-backed.
  `Prisma.User.role` is already a plain `String` column (not a DB enum), so
  the storage layer already tolerates arbitrary role names — the enum is the
  only real constraint. Decision: convert to a DB-backed `Role` +
  permissions model (see Backend task B4) so admin can genuinely create new
  roles, rather than us hardcoding a 4th literal.
- `OrgProfile` today is a hand-seeded singleton (`id: 1`, no `isActive`
  field, no admin route). Decision: promote it to a real multi-row table
  with an `isActive` flag, mirroring the existing `AcademicYear.isActive`
  pattern already used elsewhere in this codebase — not a one-off settings
  form. Admin can create multiple org profiles and mark one active; the
  active one is what renders in the app header / PDFs / reports.

## Backend tasks (owner: Backend)

| # | Task | Status |
|---|------|--------|
| B1 | *(done — Backend: added `captionPeriodClause` helper in fees.ts; monthly/admission/fallback branches, ₹ + /- added. WhatsApp caption text only, PDF untouched. Per user decision 2026-07-23, caption date now uses receipt DD-Mon-YYYY style via `formatReceiptDate()`, e.g. "paid on 15-Jun-2026", not ISO. Verified live.)* WhatsApp caption: branch by `fee.feeType`. Monthly → `... for ${student.fullName} for Period of ${periodLabel(feeMonth, feeYear)}: ₹ ${amountPaid.toFixed(2)}/- paid on ${date}. JazakAllah.` Admission → `... for Admission Year ${feeYear}: ₹ ${amountPaid.toFixed(2)}/- paid on ${date}. JazakAllah.` Reuse the existing `periodLabel`/`feeTypeLabel` helpers in fees.ts where sensible; decide a reasonable fallback clause for annual/other fee types (not specified by the user — keep it coherent, note your choice). Exact examples to match are in the user's own message (`MF-<admissionNo>-YYYYMM-<seq> ... for Period of June 2026: ₹ 200.00/- ...` and `ADM-<admissionNo>-YYYY-<seq> ... for Admission Year 2024: ₹ 500.00/- ...`). | done |
| B2 | *(Backend finding: reproduced live — created monthly fee for student 1 (id 743), diffed receipt text vs admission fee 5. **Identical** in the signature region: both render `Administrator (Admin)` name+role line and `Receiver's Signature` label. No monthly/admission divergence in code; the signature IMAGE is absent on both only because staff `signaturePath` is null in the reset DB — it would embed equally for both types once uploaded. Closed as already-correct, no code change. Test fees deleted.)* **Reproduce, then fix (if real)**: create a monthly fee payment via the running dev server's API for any student, `GET /fees/:id/receipt`, extract text, diff against the admission receipt for fee id 5 (`ADM-<admissionNo>-YYYY-<seq>`, already whatsapp-sent, in the current DB). If genuinely identical (name+role line present on both) — say so plainly in your report, no code change needed, this closes as "already correct." If you find a real divergence, root-cause it (check `fee.pdfPath` caching at fees.ts:386/421 first — a fee whose PDF was generated and cached to disk *before* some future signature-related edit would keep serving a stale file) and fix without breaking the existing "receipt is immutable / 409 on re-send once `whatsappSent`" behavior. | done — already correct |
| B3 | `OrgProfile` schema migration: add `isActive Boolean @default(false)` and `headerImagePath String?` (mirror `Staff.photoPath`/`signaturePath` convention). Backfill migration: set the existing row's `isActive = true`. Add `orgProfileRouter` (new route file, `requireAuth` + Admin-only for writes): `GET /org-profile` (list, Admin-only), `GET /org-profile/active` (any authed role — this is what the header fetches), `POST /org-profile` (create), `PATCH /org-profile/:id` (update, including a way to set `isActive` — setting one row active must unset any other, single-active-row invariant, same idea as how `AcademicYear.isActive` is presumably kept exclusive elsewhere — check that code for the pattern), `DELETE /org-profile/:id` (block deleting the currently-active row, or auto-fallback — your call, document it), `POST /org-profile/:id/image` (multer upload for `headerImagePath`, JPEG/PNG/WebP — this is web-header-only, not embedded in the ASCII PDF writer, so it can follow the student/staff-photo multer config in `server/src/lib/upload.ts`, not the JPEG-only signature one). Add the zod schemas in `packages/shared/src/schemas/orgProfile.ts` (new file) following `user.ts`'s shape. Tell Frontend the exact response shapes as soon as they're stable — don't make Frontend guess. | done — routes live + verified; contract sent to Frontend |
| B4 | Role/permission system. New Prisma `Role` model: `id, name (unique), permissions (String — JSON-encoded array of permission-key strings), isSystem (Boolean @default(false)), createdAt, updatedAt`. **First**, grep every `requireRole(...)` call site across `server/src/routes/*` and note the exact role sets per router (fees, reports, attendance, finance/staff/salaries, classes, students, users, admin, and the new org-profile/roles routers) — this is a hard regression constraint, the seeded Admin/Accountant/Teacher permission sets must reproduce today's authorization exactly, QA will test this. Design permission keys 1:1 against what you find (e.g. `users.manage`, `org.manage`, `roles.manage`, `fees.manage`, `attendance.mark`, `finance.manage`, `classes.manage`, `students.manage`, `reports.access`, `admin.access` — adjust to match reality, don't guess). Seed the 3 existing roles as `isSystem: true` rows with permission sets that exactly reproduce current behavior (regression-critical). Add a `requirePermission(...keys)` middleware alongside (not necessarily replacing) `requireRole`, and migrate route guards to it. Embed the resolved permissions array into the JWT at login (role-name claim can stay too, for display) — document the tradeoff that permission edits apply on next login, not live. Add `rolesRouter` (Admin/`roles.manage`-only): `GET /roles`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` (block deleting `isSystem` rows, 400 with a clear message). Add zod schemas in `packages/shared/src/schemas/role.ts`. This is the biggest single task here — flag Frontend and QA early with the finalized permission-key list and API shapes so they're not blocked. | done — 10 permission keys, requirePermission migrated, JWT carries permissions, roles CRUD live; authz regression matrix verified (see notes) |
| B5 | Once B4's permission keys are final, update `reportsRouter`'s guard (`server/src/routes/reports.ts:27`) so a role with `reports.access` (not just literal `Admin`/`Accountant`) gets read+download — this is the concrete "management, view+download reports" example the user gave; admin creates that role themselves via the new Roles UI once B4+F-roles-UI ship, we don't hardcode it. | done — reports guard now requirePermission("reports.access"); verified a custom role with only reports.access gets reports 200 / everything else 403 |

## Frontend tasks (owner: Frontend)

| # | Task | Status |
|---|------|--------|
| F1 | App header branding (`client/src/components/layout/Header.tsx`, currently a bare 16-line topbar with no org branding). Fetch the active org profile (`GET /org-profile/active` once Backend ships B3) and render: **Name** — bold, large (e.g. `text-xl`/`text-2xl` scale), centered. **Address** — smaller, muted color, centered, directly below the name. If `headerImagePath` is set, use it as a background layer behind the centered text with enough of an overlay/scrim that text stays legible in both light and dark theme (this app has a theme toggle already — check `prefers-color-scheme`/theme context usage elsewhere in `client/src` for the existing pattern). Keep the existing sidebar-toggle / academic-year switcher / locale+theme toggle / user-menu elements intact — you may need to restructure the bar into two rows (branding row + controls row) or adjust height; use your judgement on layout, this is a real design task, not just a data-binding one. Image needs the same authed-blob-fetch pattern as `UsersPage.tsx`'s `UserAvatar` (plain `<img src>` can't carry the Bearer token). | in-progress (code complete; B3 contract confirmed FINAL by Backend and matches my wiring exactly — awaiting live endpoints + a browser visual pass. Note: I can't run a live browser check here, so QA Q6 is the visual sign-off) |
| F2 | New Admin-only "Organisation" management page, mirroring `client/src/features/users/UsersPage.tsx`'s structure (table + add/edit dialog + delete confirm): list org profiles, create, edit (name/address/image upload), delete, "set active" action. Route + nav entry, Admin-gated. Wait for Backend's B3 response shapes before wiring the API layer — ask Backend directly if the contract isn't posted yet by the time you get here. | in-progress (page/form/route/nav built; B3 contract confirmed FINAL and matches my wiring — no changes needed. Awaiting live endpoints + browser pass, QA Q5) |
| F3 | New Admin-only "Roles" management page: list roles (flag `isSystem` ones visually, e.g. a badge, and disable/hide their delete action), create/edit a role (name + permission checkboxes sourced from Backend's finalized permission-key list from B4 — ask Backend for the list, don't hardcode a guess), delete (non-system only). Route + nav entry, Admin-gated. | in-progress (page/form/route/nav built; permission checkboxes render from a `GET /roles/permissions` catalogue hook — no keys hardcoded, empty until B4 confirms endpoint/shape. isSystem badge + delete hidden for system roles) |
| F4 | Once Backend's B4 permission model is live, replace the hardcoded role-array gates in `client/src/components/layout/nav.ts` and the `RequireRole` usages in `client/src/App.tsx` with permission-key checks (source of truth: whatever Backend exposes from login/`/me` — coordinate the exact field name/shape with Backend rather than assuming). This is required for a custom "management" role to actually see the Reports nav item / route. | blocked (awaiting B4: need the permission model live + the exact login/`/me` field carrying the user's permission keys before swapping the role-array gates) |

## QA tasks (owner: QA)

Do this against the running dev server (`npm run dev` from repo root — check
if it's already running before starting a new one) plus the browser where
useful. File every genuine bug you find as a row here with enough repro
detail that Backend/Frontend don't have to ask what you meant; message them
directly for anything urgent rather than only writing it down.

| # | Task | Status |
|---|------|--------|
| Q1 | Verify WhatsApp captions (B1) exactly match the user's two example strings (period/year clause, ₹ symbol, spacing) for a real monthly fee and the existing admission fee (id 5, `ADM-<admissionNo>-YYYY-<seq>` — note it's already `whatsappSent: true`, so re-triggering it will 409; use a different admission fee row or reset that flag in a test DB copy, don't mutate the shared dev DB destructively). | **PASS** |
| Q2 | Independently verify Backend's B2 finding (reproduce it yourself, don't just trust the report) — confirm whether monthly vs admission receipts genuinely differ in the signature/name+role line, before and after Backend's fix. | **PASS (no divergence)** |
| Q3 | Regression-test authorization: confirm every existing route still enforces exactly the same access for Admin/Accountant/Teacher after B4's `requirePermission` migration (this is the highest-risk change in this batch — a mistake here is a security regression, not just a bug). Spot-check at minimum: fees, reports, attendance, users, admin routes, for all 3 roles, both allow and deny cases. | todo |
| Q4 | End-to-end test the new "management-style" role: create a custom role via the new Roles UI (F3) with only `reports.access`, create a user with that role, log in as them, confirm they can view+download every report and cannot reach any Admin/Accountant/Teacher-only screen or API route. | todo |
| Q5 | Test OrgProfile CRUD (F2/B3): create/edit/delete profiles, image upload, switching the active profile, and confirm the app header (F1) picks up the change (new name/address/background image visible after switching active + refresh). Confirm exactly one row can be active at a time. | todo |
| Q6 | Visual check of F1 in both light and dark theme, with and without a header image set, at a couple of viewport widths — confirm text stays legible over the image and the existing header controls (sidebar toggle, academic-year switcher, theme toggle, user menu) still all work. | todo |
| Q7 | `npm run typecheck` (all 3 workspaces) and `npm run test -w server` (per CLAUDE.md's isolated-test-DB steps) clean before sign-off. | todo |

### QA findings / evidence

**Q1 (PASS)** — Verified live via the walink gateway on two fresh test fees (created + deleted, no fixture mutation). Decoded captions exactly matched the user's examples:
- Monthly (`MF-<admissionNo>-YYYYMM-<seq>`, June 2026, ₹200): `Assalamu Alaikum. Fee receipt MF-<admissionNo>-YYYYMM-<seq> for <student-name> for Period of June 2026: ₹ 200.00/- paid on 2026-06-15. JazakAllah.`
- Admission (`ADM-<admissionNo>-YYYY-<seq>`, year 2025, ₹500): `Assalamu Alaikum. Fee receipt ADM-<admissionNo>-YYYY-<seq> for <student-name> for Admission Year 2025: ₹ 500.00/- paid on 2025-04-10. JazakAllah.`
- ₹ symbol, `/-` suffix, period/year clause and spacing all correct. Note: caption date is ISO `YYYY-MM-DD` (user's examples truncated the date, so no format was specified — flagging in case a `DD-Mon-YYYY` format is preferred to match the PDF's date style).

**Q2 (PASS — no divergence)** — Independently reproduced (fee 744 monthly vs 747 admission, distinct from Backend's 743). `pdftotext` of both receipts is identical in the signature region: both render `Administrator (Admin)` (staff name+role) bottom-left and `Receiver's Signature` bottom-right. Confirms Backend's finding. Signature *image* absent on both only because all staff `signaturePath` is null in the reset DB — not a monthly-specific bug.

**Q3 pre-B4 golden baseline** (captured live now; B4's `requirePermission` migration must reproduce this exactly — allow = guard-pass, 403 = guard-deny):

| Route (router-level guard) | Admin | Accountant | Teacher |
|---|---|---|---|
| `/fees`, `/reports/*`, `/expenses`,`/staff`,`/salaries` | pass | pass | **403** |
| `/attendance` | pass | **403** | pass |
| `/users`, `/admin/*` | pass | **403** | **403** |
| `/students` (GET), `/classes` (GET), `/reference`, `/dashboard` | pass | pass | pass |

(Note: `/classes`,`/students`,`/expenses`,`/staff` have additional per-route `requireRole("Admin")` on write sub-routes — those Admin-only writes are also part of the regression surface.)
