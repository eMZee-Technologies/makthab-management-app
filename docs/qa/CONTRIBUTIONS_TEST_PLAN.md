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

# Server Jest — contributions suite if present
cd server
DATABASE_URL="file:./test.db" npx prisma migrate reset --force
DATABASE_URL="file:./test.db" npx jest contributions --runInBand
# Fallback if file named differently:
# DATABASE_URL="file:./test.db" npx jest --testPathPattern=contribution --runInBand
```

Also re-run existing `fees`, `finance`, `authorization`, and `reports` suites for regression when time allows.

---

## Verification results

_Polled branch / workspace before Backend/Frontend land (HEAD `0396be4`, no Contribution model, no `*contribution*` files, remote branch not yet published)._

| Check | Result | Notes |
| --- | --- | --- |
| Feature code present | **Pending** | No Prisma `Contribution`, routes, client tabs, or jest file yet. |
| `npm run build:shared` | **Not run** | Waiting for shared schema / API contract from Backend. |
| `npm run typecheck` | **Not run** | Same. |
| Jest `contributions` | **N/A** | No `server/tests/*contribution*` file. |
| Baseline observation | Info | Reports `ExpenseTab` currently `useState(String(now.getFullYear()))` — must become `'all'` for E3. Fee WhatsApp missing-phone already returns `400` `no_whatsapp_number`. |

_Update this section after Backend/Frontend commits appear on the branch._

---

## Coordination flags

| Flag | Severity | Detail |
| --- | --- | --- |
| Feature not landed | Blocker | Branch tip matches `main`; Contributions API/UI/schema absent. QA cannot execute automated or product verification until Backend/Frontend push. |
| Receipt date encoding | Contract | Spec is `dd-mm-yyyy` inside the id (`CON-09-08-2026-0001`). Confirm timezone/UTC handling so “contribution date” ≠ server local midnight shift. |
| Permissions resource | Confirm | Product says reuse **`fees`** matrix (not a new `contributions` resource). Teacher has no `fees.view` today — A5; call out if UI still shows Income read-only for Teacher. |
| Expense year default | FE required | Current Reports Expense default is **current year**; ticket requires **All**. |
| WhatsApp contact field | Open | Fees use `student.whatsappNo`. Contributions may be non-student donors — confirm which entity holds the phone and that W2 still applies. |
| Route / i18n rename | FE | Nav keys still `nav.fees` / `nav.finance` in baseline; ensure EN+AR strings update to Income / Expenditure without breaking `resource: 'fees' \| 'finance'` guards. |
| Shared package rebuild | Process | After shared Zod/DTO changes, server needs `npm run build:shared` before jest/typecheck. |
