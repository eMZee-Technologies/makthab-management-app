# makthab-management-app — Developer Context & Handoff Document

> **Prepared for:** Developer onboarding / project continuation  
> **Date:** 2026-05-13  
> **Project owner:** *(redacted — contact the repository maintainers)*  
> **Repo / workspace:** `makthab-management-app`

---

## 1. What This Project Is

**makthab-management-app** is a Madrasa (Islamic school) management system for a single institution
called "Maktab" (Masjid-O-Madarasa). It needs to:

- Manage student admissions and profiles
- Track monthly and one-time admission fees, with receipt generation
- Send receipts to parents/guardians via WhatsApp
- Record staff salaries and allowances
- Track operational expenses
- Generate flexible reports (monthly / quarterly / yearly)
- Track student attendance

The institution currently manages all this data in a **Google Sheet** (see §5). The goal
is to migrate that data into a proper database and build a modern web application on top.

**Constraints:** Tight deadline · Cost-sensitive · Must scale to hundreds of students

---

## 2. Existing Codebase (Legacy — Python/Tkinter)

The repo contains a working **Python prototype** that should be treated as reference, not production code.

```
src/
├── backend/
│   ├── main.py                  # Entry point for backend processing
│   ├── student_admission.py     # Admission processing logic
│   └── config.py
├── ui/
│   ├── student_admission_gui.py # Tkinter GUI
│   └── config.py
└── config.py
```

**Key legacy capabilities already working:**
- Excel/SQLite data storage toggle (`USE_EXCEL` flag in config)
- PDF generation with Arabic/RTL text (via `reportlab` + `bidi` + `arabic_reshaper`)
- WhatsApp notification URL template
- Student admission CRUD

**Python dependencies:** `pandas`, `openpyxl`, `reportlab`, `tkinter`, `sqlite3`, `bidi`, `arabic_reshaper`

**Virtual environment:** Python 3.11.3 — activate with `venv\Scripts\activate` (Windows)

---

## 3. Agreed Target Architecture — React + TypeScript

After evaluating options, the agreed production stack is:

### 3.1 Frontend

| Concern | Library |
|---|---|
| Framework | React 18 + TypeScript 5 |
| Build tool | Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Server state | TanStack Query (React Query v5) |
| Local state | Zustand |
| Forms | React Hook Form + Zod |
| Tables | TanStack Table |
| Charts | Recharts |
| Routing | React Router v6 |
| RTL/Arabic | CSS `dir="rtl"` + Tailwind logical properties |

### 3.2 Backend

| Concern | Library |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5 |
| Framework | Express 4 |
| ORM | Prisma 5 |
| Database | SQLite (dev) → PostgreSQL (prod) — swap via one `DATABASE_URL` line |
| Auth | JWT (access + refresh tokens) |
| PDF generation | Puppeteer (HTML → PDF; solves Arabic RTL natively) |
| Excel export | ExcelJS |
| WhatsApp | Abstracted `NotificationService`: `wa.me` free → WATI REST → Twilio |
| Validation | Zod (shared schemas between FE and BE via monorepo) |

### 3.3 Monorepo Structure

```
makthab-management-app/
├── frontend/                    # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui base components
│   │   │   ├── students/
│   │   │   ├── fees/
│   │   │   ├── attendance/
│   │   │   ├── reports/
│   │   │   ├── expenses/
│   │   │   └── staff/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── store/               # Zustand stores
│   │   └── lib/
│   └── package.json
├── server/                      # Express + Prisma backend
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── lib/
│   ├── prisma/
│   │   ├── schema.prisma        # Single source of truth for DB schema
│   │   ├── migrate-from-sheets.ts   # ← Migration script (see §5)
│   │   └── migrate-from-sheets.md   # ← Migration run guide
│   └── package.json
├── packages/
│   └── shared/                  # Zod schemas shared between FE and BE
│       └── src/
│           ├── schemas/
│           └── types/
├── DEVELOPER_CONTEXT.md         # ← This file
├── Madrasa_System_Architecture.docx      # Python-stack architecture doc
├── Madrasa_React_TS_Architecture.docx    # React+TS architecture doc  ← PRIMARY
├── Madrasa_Migration_Plan.docx           # Data migration plan
└── pnpm-workspace.yaml
```

### 3.4 Optional: Desktop Packaging

Wrap the web app in **Electron** for offline use on a single PC without needing a server.
This requires zero code changes — Electron loads `localhost:3000`.

---

## 4. Database Schema (Prisma)

File: `server/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"           // change to "postgresql" for production
  url      = env("DATABASE_URL")
}

model AcademicYear {
  id        Int       @id @default(autoincrement())
  label     String    @unique   // "2024-2025"
  startDate DateTime
  endDate   DateTime
  isActive  Boolean   @default(false)
  students  Student[]
  createdAt DateTime  @default(now())
}

model Class {
  id       Int       @id @default(autoincrement())
  name     String    @unique   // "Hifz", "Nazra", "Qaidah", "Tajweed", "Dars"
  level    Int
  students Student[]
}

model Student {
  id             Int          @id @default(autoincrement())
  admissionNo    String       @unique
  fullName       String
  fatherName     String
  whatsappNo     String
  address        String?
  gender         String       @default("male")
  classId        Int
  academicYearId Int
  admissionDate  DateTime     @default(now())
  monthlyFeeDue  Float        @default(0)
  status         String       @default("active")  // active | left | graduated
  class          Class        @relation(fields: [classId], references: [id])
  academicYear   AcademicYear @relation(fields: [academicYearId], references: [id])
  feePayments    FeePayment[]
  attendance     Attendance[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model FeePayment {
  id            Int      @id @default(autoincrement())
  receiptNo     String   @unique
  studentId     Int
  feeType       String   // "admission" | "monthly"
  feeMonth      Int?     // 1-12, null for admission fee
  feeYear       Int
  amountDue     Float
  amountPaid    Float
  balance       Float    @default(0)
  paymentMethod String   @default("cash")
  datePaid      DateTime?
  notes         String?
  student       Student  @relation(fields: [studentId], references: [id])
  createdAt     DateTime @default(now())
}

model Attendance {
  id        Int      @id @default(autoincrement())
  studentId Int
  date      DateTime
  status    String   // "present" | "absent" | "late" | "leave"
  notes     String?
  student   Student  @relation(fields: [studentId], references: [id])

  @@unique([studentId, date])
}

model Staff {
  id            Int              @id @default(autoincrement())
  name          String           @unique
  role          String           // "teacher" | "admin" | "other"
  basicSalary   Float
  allowance     Float            @default(0)
  phone         String?
  joiningDate   DateTime
  status        String           @default("active")
  salaryPayments SalaryPayment[]
  createdAt     DateTime         @default(now())
}

model SalaryPayment {
  id         Int      @id @default(autoincrement())
  staffId    Int
  month      Int
  year       Int
  amountDue  Float
  amountPaid Float
  txRef      String   @unique    // "SAL-{staffId}-{year}-{month}"
  paidOn     DateTime
  notes      String?
  staff      Staff    @relation(fields: [staffId], references: [id])
  createdAt  DateTime @default(now())
}

model Expense {
  id         Int      @id @default(autoincrement())
  receiptRef String   @unique
  date       DateTime
  description String
  category   String   // utilities | rent | maintenance | stationery | uniform | food | miscellaneous
  amount     Float
  paidBy     String   @default("admin")
  notes      String?
  createdAt  DateTime @default(now())
}
```

---

## 5. Google Sheet → Database Migration

### Source Sheet

- **URL:** https://docs.google.com/spreadsheets/d/1MxyG4d_fUCnbryQHLGyWOFpuBREIIGS0CCPiZLK3pxQ/
- **Tabs:** Admission Details · Admission Fee · Monthly Fees · Salary & Allowances · Expenses · Summary

### Approximate data volume

| Tab | Format | Est. rows | Target table |
|---|---|---|---|
| Admission Details | Flat | ~63 students | `Student` |
| Admission Fee | Flat | ~63 receipts | `FeePayment` (type=admission) |
| Monthly Fees | **Wide pivot** (months as columns) | ~63 × 12 = ~756 cells → ~400 paid | `FeePayment` (type=monthly) |
| Salary & Allowances | Flat | ~34 rows | `Staff` + `SalaryPayment` |
| Expenses | Flat | ~50 rows | `Expense` |
| Summary | Derived totals | — | skipped |

### Critical: Monthly Fee unpivot

The Monthly Fees tab stores data in wide format — each month is a column:

```
Sr | Adm No | Name | Fee/Month | Apr | May | Jun | Jul | … | Mar | Total
 1 | ADM001 | Ali  |    500    | 500 | 500 |     | 500 | … | 500 |  ...
```

The migration script detects month columns by name and converts each cell to one
`FeePayment` row with a synthetic receipt number: `MF-{admNo}-{year}-{month}`.

### Migration script

**File:** `server/prisma/migrate-from-sheets.ts`

```bash
# Run after: npx prisma migrate deploy
cd server
GOOGLE_SERVICE_ACCOUNT_JSON=./keys/sa-key.json \
  npx ts-node prisma/migrate-from-sheets.ts
```

The script is fully idempotent — safe to re-run. Full instructions in
`server/prisma/migrate-from-sheets.md`.

### Known data quality issues to handle

1. **Phone numbers** — inconsistent format (92xxxxxxxxxx / 0xxx / with spaces); script normalises to `0xxxxxxxxxx`
2. **Blank rows** — interspersed throughout all tabs; script skips rows where all cells are empty
3. **Missing admission numbers** on some fee rows — rows are skipped with a warning
4. **Duplicate student names** — admission number is the unique key, not name
5. **Month columns without year suffix** — script infers Apr–Mar → 2024–2025
6. **Mixed Urdu/English labels** — column header matching uses fuzzy normalisation

---

## 6. REST API Design

Base URL: `http://localhost:4000/api/v1`

### Authentication
```
POST /auth/login              → { accessToken, refreshToken }
POST /auth/refresh            → { accessToken }
POST /auth/logout
```

### Students
```
GET    /students              ?page=1&limit=20&search=&classId=&status=
POST   /students
GET    /students/:id
PUT    /students/:id
DELETE /students/:id          (soft-delete: sets status="left")
GET    /students/:id/fees
GET    /students/:id/attendance
```

### Fees
```
GET    /fees                  ?month=&year=&type=&studentId=
POST   /fees                  → creates payment + generates receipt PDF
GET    /fees/:id
GET    /fees/:id/receipt       → returns PDF blob
POST   /fees/:id/whatsapp      → sends receipt to student's WhatsApp
GET    /fees/defaulters        ?month=&year=   → students with balance > 0
```

### Attendance
```
GET    /attendance            ?date=&classId=
POST   /attendance/bulk       → [{ studentId, date, status }]
GET    /attendance/report     ?from=&to=&studentId=
```

### Staff & Salary
```
GET    /staff
POST   /staff
GET    /staff/:id
PUT    /staff/:id
POST   /salary                → record salary payment
GET    /salary                ?staffId=&month=&year=
```

### Expenses
```
GET    /expenses              ?from=&to=&category=
POST   /expenses
PUT    /expenses/:id
```

### Reports
```
GET    /reports/fee-collection ?from=&to=&format=json|xlsx|pdf
GET    /reports/defaulters     ?month=&year=
GET    /reports/income-expense ?from=&to=&format=json|xlsx|pdf
GET    /reports/attendance     ?from=&to=&classId=&format=json|xlsx|pdf
GET    /reports/salary         ?month=&year=
```

---

## 7. WhatsApp Integration — Three Tiers

The `NotificationService` is abstracted so the WhatsApp provider can be swapped without touching business logic.

| Tier | Method | Cost | Limitation |
|---|---|---|---|
| **Tier 1 (current)** | `wa.me` deep-link URL | Free | Manual tap required |
| **Tier 2** | WATI REST API | ~$40/month | Automated, template messages |
| **Tier 3** | Twilio WhatsApp | Pay-per-message | Enterprise SLA |

Configure via `WHATSAPP_PROVIDER=wame|wati|twilio` env var.

---

## 8. Arabic / RTL Support

The app serves an Urdu/Arabic-speaking audience.

**Frontend:** Set `<html dir="rtl" lang="ur">` and use Tailwind CSS logical properties (`ms-`, `me-`, `ps-`, `pe-` instead of `ml-`, `mr-`, `pl-`, `pr-`).

**PDF generation:** Puppeteer renders HTML to PDF through Chromium, which handles Arabic/RTL natively. No need for the Python `bidi` / `arabic_reshaper` libraries. Receipt HTML template uses Arabic font (e.g., Noto Naskh Arabic via Google Fonts).

---

## 9. User Roles & Permissions

| Role | Access |
|---|---|
| **Admin** | Full access — all modules, reports, settings |
| **Accountant** | Fees, expenses, salary, reports — no student delete |
| **Teacher** | Attendance entry, view student list — no financial data |

JWT payload: `{ userId, role, iat, exp }`

---

## 10. Deliverables Already Created

| File | Description |
|---|---|
| `Madrasa_System_Architecture.docx` | Full architecture for Python/Tkinter stack (reference) |
| `Madrasa_React_TS_Architecture.docx` | **PRIMARY** — Full architecture for React+TS stack |
| `Madrasa_Migration_Plan.docx` | 10-step data migration plan with field mappings |
| `server/prisma/migrate-from-sheets.ts` | TypeScript migration script (Google Sheets → Prisma DB) |
| `server/prisma/migrate-from-sheets.md` | Run guide for migration script |
| `google_sheet_to_db_migration_map.svg` | Visual diagram: 6 sheet tabs → 4 DB tables |
| `madrasa_react_ts_architecture.svg` | Architecture overview diagram |
| `DEVELOPER_CONTEXT.md` | This file |

---

## 11. Development Roadmap

The project has been planned in 13 phases. Priority phases for MVP:

| Phase | Scope | Est. effort |
|---|---|---|
| 1 | Monorepo scaffold, Prisma schema, DB migrations | 2 days |
| 2 | Auth (JWT login, role middleware) | 1 day |
| 3 | Student CRUD API + React list/form UI | 3 days |
| 4 | **Data migration** (run migrate-from-sheets.ts) | 1 day |
| 5 | Fee management — record payments, generate receipts | 3 days |
| 6 | WhatsApp receipt delivery (Tier 1 wa.me first) | 1 day |
| 7 | Attendance tracking | 2 days |
| 8 | Staff & salary management | 2 days |
| 9 | Expenses tracking | 1 day |
| 10 | Reports (fee collection, defaulters, income/expense) | 3 days |
| 11–13 | Dashboard, notifications, Electron packaging | 3 days |

**Recommended first sprint:** Phases 1–4 (get existing data into the DB with a working API).

---

## 12. Environment Variables

Create a `.env` file at `server/.env`:

```env
# Database
DATABASE_URL="file:./dev.db"           # SQLite for dev
# DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/makthab_dev"  # Prod

# Auth
JWT_SECRET=<set-a-long-random-value>
JWT_REFRESH_SECRET=<set-a-long-random-value>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# WhatsApp
WHATSAPP_PROVIDER=wame                  # wame | wati | twilio
WATI_API_URL=
WATI_API_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=

# Google Sheets (for migration only)
GOOGLE_SERVICE_ACCOUNT_JSON=./keys/service-account.json
# OR: GOOGLE_SHEETS_API_KEY=<from-secrets-manager>

# App
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

---

## 13. Getting Started (from scratch)

```bash
# 1. Clone / open workspace
cd makthab-management-app

# 2. Install pnpm (if not installed)
npm install -g pnpm

# 3. Install all workspace dependencies
pnpm install

# 4. Set up server environment
cp server/.env.example server/.env
# Edit server/.env with your values

# 5. Create and migrate the database
cd server
npx prisma migrate dev --name init

# 6. Run the migration from Google Sheets
GOOGLE_SERVICE_ACCOUNT_JSON=./keys/sa-key.json \
  npx ts-node prisma/migrate-from-sheets.ts

# 7. Start backend (from server/)
pnpm dev                               # http://localhost:4000

# 8. Start frontend (from frontend/)
cd ../frontend
pnpm dev                               # http://localhost:5173
```

---

## 14. Key Architectural Decisions

### ADR-001: React + TypeScript over Python/Tkinter
**Decision:** Replace Tkinter GUI with React web app.  
**Reason:** Web deployment, richer UI, better Arabic/RTL support, larger developer ecosystem, WhatsApp previews in browser.

### ADR-002: Prisma over raw SQL
**Decision:** Use Prisma ORM with SQLite initially.  
**Reason:** Type-safe DB access, schema-as-code, zero-cost migration to PostgreSQL when scale demands it — only `DATABASE_URL` changes.

### ADR-003: Puppeteer for PDF over ReportLab
**Decision:** Generate receipts as HTML → PDF via Puppeteer.  
**Reason:** Chromium handles Arabic/Urdu RTL text natively without `bidi`/`arabic_reshaper` hacks. HTML receipt templates are easier to style than ReportLab code.

### ADR-004: Monorepo with shared Zod schemas
**Decision:** `packages/shared/` contains Zod schemas used by both frontend and backend.  
**Reason:** Single source of truth for validation — form errors on the frontend match API errors exactly.

### ADR-005: Abstracted NotificationService
**Decision:** WhatsApp delivery is behind an interface, not hard-coded.  
**Reason:** Start free with `wa.me` links, upgrade to WATI/Twilio when the institution is ready to pay, without refactoring.

---

## 15. Reference Documents

All documents are in the workspace root (`C:\Workspaces\makthab-management-app`):

- **`Madrasa_React_TS_Architecture.docx`** — Full technical architecture (start here)
- **`Madrasa_Migration_Plan.docx`** — Step-by-step Google Sheet migration plan
- **`server/prisma/migrate-from-sheets.ts`** — The actual migration script to run
- **`server/prisma/migrate-from-sheets.md`** — How to run it

---

*Document generated from design session, 2026-05-13.*
