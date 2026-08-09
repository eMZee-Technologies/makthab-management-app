# Contributions / Income / Expenditure — QA Test Plan

**Branch:** `cursor/contributions-income-expenditure-0d5d`  
**Scope:** Contributions (income) feature; Fees→Income and Finance→Expenditure renames; permissions via existing `fees` resource matrix.  
**Out of scope for this doc:** Implementing product code (Backend/Frontend own that).

**Seeded roles (baseline):** Admin (full), Accountant (`fees.manage` → full fees CRUD), Teacher (attendance only — no fees view/create/update/delete).

**Receipt contract:** `CON-<dd-mm-yyyy>-<4-digit-seq>`  
Example: `CON-09-08-2026-0001` where `09-08-2026` is the contribution date and `0001` is a global running sequence among `CON-` receipts.

---

## 1. Receipt format

| ID | Check | Steps / assert |
| --- | --- | --- |
| R1 | Regex | Created contribution `receiptNo` matches `^CON-\d{2}-\d{2}-\d{4}-\d{4}$`. |
| R2 | Date segment | Middle `dd-mm-yyyy` equals the contribution’s date (not createdAt / payment clock skew). Use a non-today date (e.g. `05-01-2026`) and confirm the receipt embeds that date. |
| R3 | Sequence increments | Create two contributions; trailing 4-digit seq increases by 1 (derive from max existing `CON-` suffix, not `count()+1`, so deletes don’t collide). |
| R4 | PDF / filename | Receipt PDF generates; storage key / download name uses the same `receiptNo`. |
| R5 | Immutability | PATCH must not change `receiptNo` (ignore or omit from update schema — same as fees). |

---

## 2. Role access (`fees` matrix)

| ID | Role | Expect |
| --- | --- | --- |
| A1 | Admin | CRUD contributions; download receipt; WhatsApp send. |
| A2 | Accountant | Same as Admin for contributions (via `fees.manage` / fees create·update·delete). |
| A3 | Teacher — UI | Create / Edit / Delete / WhatsApp actions hidden on Income→Contributions (and no nav write affordances). |
| A4 | Teacher — API | `POST` / `PATCH` / `DELETE` on contributions → **403**. Receipt / WhatsApp mutations → **403**. |
| A5 | Teacher — view | Per matrix, Teacher has **no** `fees.view` → list/detail/receipt read also **403** (and Income nav hidden). Flag if product intends read-only Teacher access. |
| A6 | Unauthenticated | Contribution routes → **401** (not 403). |

---

## 3. Income page (Fees rename)

| ID | Check | Assert |
| --- | --- | --- |
| I1 | Nav | Sidebar label **Income** (i18n `nav.fees` / renamed key); route may remain `/fees` unless FE remaps. |
| I2 | Page title | Header reads Income (not “Fees”). |
| I3 | Monthly Fees tab | Tab still labeled **Monthly Fees** (fee flows unchanged). |
| I4 | Contributions tab | New tab present; Create / Edit / Delete / list / filters work for Admin & Accountant. |
| I5 | Admission / defaulters / structures | Still reachable; no regression from rename. |
| I6 | Permission gating | Collect / Contribute buttons only when `can('fees','create')`. |

**Contributions CRUD smoke (Accountant):**

1. Create with amount, date, payer/notes fields as shipped.  
2. List shows new row + `CON-…` receipt.  
3. Edit non-receipt fields; save; list refreshes.  
4. Download receipt PDF.  
5. Delete; row gone; re-create gets next seq (not reuse if other CON receipts remain).

---

## 4. Reports — Contributions

| ID | Check | Assert |
| --- | --- | --- |
| RC1 | Tab | Reports has a **Contributions** tab. |
| RC2 | Default | Default sub-view / year filter is **All**. |
| RC3 | Year view | Year filter / Year view lists or aggregates by year; PDF/XLSX export (if provided) respects filter. |
| RC4 | Auth | Accountant + Admin can open; Teacher denied (`reports` / fees as implemented). |

---

## 5. Expenditure (Finance rename) — Expense report default

| ID | Check | Assert |
| --- | --- | --- |
| E1 | Nav | Sidebar **Expenditure** (was Finance). |
| E2 | Page | Finance page header / copy updated to Expenditure; expense/staff/salary tabs still work. |
| E3 | Reports Expense year | Expense report year select **defaults to All** (baseline today: current calendar year — this is a required change). |
| E4 | All vs year | “All” omits year/period filter; choosing a year scopes list + export filenames. |

---

## 6. WhatsApp (contributions)

| ID | Check | Assert |
| --- | --- | --- |
| W1 | Prefill | WhatsApp / wa.me flow includes contribution receipt no, amount, date, and payer/contributor identity (parity with fee caption style). |
| W2 | Missing phone | No WhatsApp number on the related contact → clear **400** (or UI toast) — e.g. “no WhatsApp number on file”; do not open a blank wa.me link. |
| W3 | Idempotency | Re-send after success → **409** already sent (if same pattern as fees) or documented alternate. |

---

## 7. Regression

| ID | Check | Assert |
| --- | --- | --- |
| G1 | Fee receipts | New monthly/admission fees still mint `MF-…` / `ADM-…` (and `RC-…` for other types); historic numbers unchanged. |
| G2 | Fee WhatsApp | Fee receipt WhatsApp still works; caption still fee-oriented. |
| G3 | Expenses | Expenditure expenses still use `EXP-…` vouchers; create/list/PDF unchanged. |
| G4 | Reports fees | Monthly Fees / Admission Fees report tabs still work. |
| G5 | Permissions | `fees.manage` / matrix grants unchanged for fee endpoints; Teacher still blocked from fee writes. |
| G6 | Typecheck / shared | `@makthab/shared` builds; client+server+shared `typecheck` clean after schema land. |

---

## Manual checklist (quick pass)

Automated / static coverage is noted below; **remaining browser checks** are still open:

- [ ] Admin: Income → Contributions CRUD + receipt + WhatsApp (browser)
- [ ] Accountant: same (browser)
- [ ] Teacher: Income nav hidden; no Contributions write UI (browser) — API Teacher create 403 covered by Jest
- [x] Receipt `CON-dd-mm-yyyy-####` with date + seq — Jest + observed `CON-09-08-2026-0001`
- [x] Reports → Contributions default All + Year view — static code review
- [x] Reports → Expense year default All — static code review
- [x] Nav: Income + Expenditure labels — static i18n review
- [ ] Fees still MF-/ADM-; expenses still EXP- — partial (fees Jest subset); full EXP smoke not run in browser
- [ ] WhatsApp prefill text readable in wa.me (browser)
- [ ] Anonymous vs individual create/edit UX (browser)

---

## Automated verification commands

```bash
# From repo root (after Backend/Frontend land + deps installed)
npm run build:shared
npm run typecheck

# Server Jest — contributions suite (SQLite schema required)
cd server
DATABASE_URL="file:./test.db" npx prisma migrate reset --force --schema=./prisma/sqlite/schema.prisma
DATABASE_URL="file:./test.db" npx jest contributions --runInBand
# Coordinator-equivalent one-liner also OK once DB already migrated/seeded:
# DATABASE_URL="file:./test.db" npx jest tests/contributions.test.ts --runInBand
```

Also re-run existing `fees`, `finance`, `authorization`, and `reports` suites for regression when time allows.

---

## Verification results

**Branch tip reviewed:** `e1d625f` (FE) + `8d70dfb` (BE), QA docs through `624877f`. Date: 2026-08-09.

**Coordinator confirmation (re-recorded here):**

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | **Pass** | shared / server / client green. |
| Jest `tests/contributions.test.ts` | **Pass** | 4/4 with `DATABASE_URL=file:./test.db`: CON receipt format, accountant CRUD, Teacher create → 403, WhatsApp without number → 400. |
| Receipt example | **Pass** | Observed `CON-09-08-2026-0001` for contribution date `2026-08-09`. |

**Additional QA agent runs / static skim:**

| Check | Result | Notes |
| --- | --- | --- |
| `npm run build:shared` | **Pass** | Ran successfully before typecheck/jest. |
| Fees regression (subset) | **Pass** | `POST /fees` receipt; `receiptNo` immutable; Teacher fee writes 403. |
| Income page Contributions tab (code skim) | **Pass w/ notes** | Tab + year filter (All default), Add/Edit/Delete gated by `fees` create/update/delete; receipt download always; WhatsApp gated by update. See Coordination flags. |
| Reports Contributions tab (code skim) | **Pass w/ notes** | Tab present; sub-tabs default **All** + Year (year = filtered list). No PDF/XLSX buttons. |
| Expense year default | **Pass** | `ExpenseTab` defaults to `'all'`. |
| WhatsApp caption (API) | **Pass (code review)** | Includes receiptNo, contributorName, type, amount, date. Phone on contribution row. Missing → 400 `no_whatsapp_number` (Jest). |
| Manual UI / E2E browser | **Not run** | Checklist items above still need a human/browser pass. |

---

## Coordination flags

| Flag | Severity | Detail |
| --- | --- | --- |
| Contributions report exports missing | Medium | Reports Contributions All/Year set `buttons={null}` — on-screen list only; no PDF/Excel (and no shared `report` type for contributions). Confirm intentional for MVP (RC3 “if provided”). |
| Reports Year view is list-only | Low | Unlike Monthly Fees Year summary, Contributions “Year” is a year-filtered detail table, not an aggregate-by-year summary. Acceptable if product only needed a year filter. |
| WhatsApp UI without phone | Low | Contributions WhatsApp action stays clickable when `whatsappNo` is empty (same pattern as fee rows); click → API 400 → toast. Not a blank wa.me link, but no proactive disable/hide. |
| Jest coverage gaps | Low | Committed suite covers create regex + CRUD + Teacher create 403 + missing WhatsApp. Still light on explicit seq-increment, Teacher PATCH/DELETE/WhatsApp 403, and caption body asserts. |
| Teacher view of Income | Info | Teacher has no `fees.view` → Income nav hidden + reads 403 (A5). Matches attendance-only matrix. |
| Remaining manual UI | Info | Browser not exercised: Admin/Accountant CRUD+WhatsApp flow, Teacher UI hide, wa.me prefill readability, anonymous/individual form UX, EXP voucher smoke. |
| WhatsApp phone on contribution | Resolved | Optional `whatsappNo` on the contribution itself (not student lookup). |
| Receipt date UTC | Resolved | `getUTC*` used; observed `CON-09-08-2026-0001` for `2026-08-09`. |
| Expense year default All | Resolved | FE landed `'all'`. |
| i18n / resource keys | Resolved | Income / Expenditure labels (EN+AR); guards still `fees` / `finance`. |
| SQLite migrate for tests | Process | Use `--schema=./prisma/sqlite/schema.prisma` (or `npm run db:reset -w server`) with `DATABASE_URL="file:./test.db"`. |
