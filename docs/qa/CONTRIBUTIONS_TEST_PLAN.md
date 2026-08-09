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

- [ ] Admin: Income → Contributions CRUD + receipt + WhatsApp  
- [ ] Accountant: same  
- [ ] Teacher: no Income write UI; API 403 on mutations  
- [ ] Receipt `CON-dd-mm-yyyy-####` with date + seq  
- [ ] Reports → Contributions default All + Year view  
- [ ] Reports → Expense year default All  
- [ ] Nav: Income + Expenditure labels  
- [ ] Fees still MF-/ADM-; expenses still EXP-

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
```

Also re-run existing `fees`, `finance`, `authorization`, and `reports` suites for regression when time allows.

---

## Verification results

**Verified against** `e1d625f` (`feat(client): Income/Expenditure…`) on top of `8d70dfb` (`feat(server): Contributions API MVP`), after QA plan commit `98ae7f8`. Date: 2026-08-09.

| Check | Result | Notes |
| --- | --- | --- |
| Feature code present | **Pass** | Prisma `Contribution`, `/api/v1/contributions`, `ContributionForm` + Income tab, Reports Contributions tab, jest suite. |
| `npm run build:shared` | **Pass** | `@makthab/shared` build succeeded. |
| `npm run typecheck` | **Pass** | shared + server + client all clean. |
| Jest `contributions` | **Pass** | 4/4: create CON- regex + PDF; accountant CRUD; Teacher POST 403; WhatsApp missing number → 400 `no_whatsapp_number`. Runtime PDFs: `CON-09-08-2026-0001` / `0002` for `date: 2026-08-09` (UTC date segment + seq OK). |
| Fees regression (subset) | **Pass** | `POST /fees` receipt; `receiptNo` immutable; Teacher fee writes 403. |
| Static: Income / Monthly Fees | **Pass** | `nav.fees` / `fees.title` → Income; `fees.monthly` → “Monthly Fees”; Contributions tab + gated create/update/delete. |
| Static: Reports Contributions | **Pass** | Tab present; sub-tabs default **All** + Year view. |
| Static: Expense year default | **Pass** | `ExpenseTab` `useState('all')`. |
| Static: WhatsApp caption | **Pass (code review)** | Caption includes receiptNo, contributorName, type, amount, date. Phone lives on contribution row (`whatsappNo`). UI disables WhatsApp when empty; API returns clear 400. |
| Manual UI / E2E | **Not run** | No browser pass in this QA run. |
| Contributions PDF/XLSX export | **Gap** | Reports Contributions views set `buttons={null}` — list only, no download (unlike fee/expense reports). |

---

## Coordination flags

| Flag | Severity | Detail |
| --- | --- | --- |
| Contributions report exports missing | Medium | All/Year list UI ships, but no PDF/Excel download wiring or `report` schema entry for contributions. Confirm if MVP intentionally omits exports. |
| Jest coverage gaps | Low | Suite does not assert date-segment equality, seq increment, Teacher PATCH/DELETE/WhatsApp 403, or WhatsApp caption body. Runtime logs already showed correct `CON-09-08-2026-*` seq. |
| Teacher view of Income | Info | Teacher still has no `fees.view` → Income nav hidden + list 403 (A5). Matches attendance-only matrix; not a bug unless product wanted read-only. |
| WhatsApp phone on contribution | Resolved | Optional `whatsappNo` on the contribution DTO/row (not student lookup). Missing → `400` `no_whatsapp_number`. |
| Receipt date UTC | Resolved | `nextContributionReceiptNo` uses `getUTC*` so ISO date-only strings do not shift calendar day. |
| Expense year default All | Resolved | FE landed `'all'` default. |
| i18n / resource keys | Resolved | Labels Income/Expenditure (EN+AR); guards still `fees` / `finance`. |
| SQLite migrate for tests | Process | Default `prisma/schema.prisma` is PostgreSQL — use `--schema=./prisma/sqlite/schema.prisma` (or `npm run db:reset -w server`) with `DATABASE_URL="file:./test.db"`. |
