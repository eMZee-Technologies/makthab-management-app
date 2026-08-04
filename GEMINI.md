# Makthab — Developer Instructions and Architecture Context

This file contains development guidelines, architecture contracts, build commands, database schemas, and testing procedures for **Makthab** (Makthab Management System). It serves as the primary instructions and context for Gemini CLI and developers working on this codebase.

---

## 1. Project Overview & Architecture

Makthab is a single-tenant management system for a Masjid-o-Madarasa (Makthab) featuring student admissions, fee collection with WhatsApp receipt links, class attendance tracking, financial expense tracking, staff payroll runs, and detailed reporting in both PDF and Excel formats with an Arabic/RTL-aware UI.

### Technology Stack
- **Client Workspace (`client/`):** Single Page Application (SPA) using React 18, TypeScript, Vite, Tailwind CSS, and shadcn/ui. Port `5173`.
- **Server Workspace (`server/`):** REST API using Node.js 20, Express, TypeScript, Prisma ORM, and SQLite. Port `3000`.
- **Shared Workspace (`packages/shared/`):** Zod schema validations and inferred TypeScript DTOs.
- **Database (`data/`):** SQLite database (`madrasa.db`) along with generated directories for receipts, payslips, reports, and student photos.

### Monorepo Structure
The codebase uses npm workspaces at the repo root:
```
packages/shared/     # Zod schemas + shared types/DTOs (Server owns, Client consumes)
server/              # Express API server + Prisma configuration & SQLite database models
client/              # Vite + React SPA client
data/                # SQLite DB and upload folders (receipts, payslips, photos, reports)
docs/                # Project system architecture and migration documentation
```

---

## 2. Setup, Building, and Running

### Prerequisites
- **Node.js** v20+
- **npm** (with workspaces support)

### Installation & Initialization
To install and set up the development environment from the repository root:
```bash
# 1. Install all dependencies across all workspaces
npm install

# 2. Build the shared schemas package
npm run build:shared

# 3. Apply Prisma migrations and seed the SQLite database (idempotent)
npm run db:reset -w server
```

### Seeding Accounts
Default seeded logins for testing:
| Username | Password | Role | Access Level |
|---|---|---|---|
| `admin` | *(local seed only — see `server/prisma/seed.ts` / `SEED_*_PASSWORD`)* | `Admin` | Full System Access |
| `accountant` | *(local seed only — see `server/prisma/seed.ts` / `SEED_*_PASSWORD`)* | `Accountant` | Fees, Expenses, Salaries, Reports (No student edits) |
| `teacher` | *(local seed only — see `server/prisma/seed.ts` / `SEED_*_PASSWORD`)* | `Teacher` | Attendance marking for assigned classes only |

Do **not** publish or reuse seed passwords outside local development.

### Development Scripts (Root)
Run these commands from the repository root:
```bash
npm run dev            # Start both backend and frontend servers concurrently
npm run dev:server     # Start Express server only (ports to http://localhost:3000)
npm run dev:client     # Start React frontend only (ports to http://localhost:5173)
npm run build          # Build shared package, backend server, and frontend client
npm run typecheck      # Run TypeScript compiler checks on all three workspaces
npm run db:migrate     # Execute prisma migrate dev inside the server workspace
npm run db:seed        # Seed tables (AcademicYear, Class, ExpenseCategory, etc.)
npm run db:reset       # Wipe database, run migrations, and re-seed the tables
```

---

## 3. Database Schema (Prisma)

The single source of truth for the database layout is defined in `server/prisma/schema.prisma`. It is built with SQLite as the primary provider:

### Key Models
- **Student:** Stores demographics, photos, class association, academic year, and status. Supports soft-delete (`status = 'inactive'`).
- **FeePayment:** Logs collected tuition/admission fees, payment methods, waiver amounts, references, and `receiptNo` (unique).
- **Attendance:** Marks daily attendance status (`present`, `absent`, etc.) per student.
- **Expense:** Details operational costs with specific category associations and voucher records.
- **Staff:** Stores staff information, base salary, and contacts.
- **User:** Application credential accounts linked 1-to-1 with a `Staff` record to identify the actor who performs transactions (such as fee collection, attendance marking, or expense approvals).
- **SalaryPayment:** Registers payroll records per staff member, per month.
- **Class:** Maps class divisions (e.g., LKG, UKG, I, II) to their class teachers.
- **AcademicYear:** Academic term config (e.g., 2024-2025, 2025-2026).
- **ExpenseCategory:** Grouping labels for school/mosque expenses.
- **FeeStructure:** Configures fee amounts per class and academic year.

---

## 4. API Contract & Conventions

### Endpoint Base Route
All JSON endpoints reside under: **`/api/v1`**.

### Standard JSON Envelopes
- **Success Responses:** `{ "data": ... }`
- **Error Responses:** `{ "error": { "code": "SOME_ERROR_CODE", "message": "Human readable message", "details": ... } }`

### Error Validation (Zod)
Validation errors structurally return **HTTP 400** (not 422). Because multiple local/nested copies of the `zod` package may exist in production/monorepo, the global error handler (`server/src/middleware/errorHandler.ts`) matches `ZodError` structurally by checking `err.name === 'ZodError'` instead of using the `instanceof` operator.

### Role Enforcement (Both Tiers)
Role boundaries must be strictly validated both on the client UI layer and the Express controller layer:
- **`Admin`:** Complete system read and write.
- **`Accountant`:** Read/write on fees, finance (expenses, salaries), and reports. Reading of students is permitted, but editing student profiles is restricted.
- **`Teacher`:** Marking and viewing attendance only.

---

## 5. Key Conventions & Implementation Gotchas

### Outdated Documentation Alert
> ⚠️ **IMPORTANT DEVELOPER WARNING:** The file `docs/development/TESTING.md` contains outdated instructions referencing PostgreSQL, Docker, Redis, and a `backend`/`frontend` folder layout. This layout belonged to a legacy multi-tenant Next.js project. **Do not resurrect or attempt to use PostgreSQL/Redis/Docker components.**
>
> The modern Makthab v2 stack runs strictly on **React SPA (`client/`), Node/Express TypeScript (`server/`), and SQLite (`data/madrasa.db`)**.

### Shared Schemas & Vite Compilation
- Changing any shared Zod schema in `packages/shared/src/schemas/` will instantly update the frontend client due to a Vite alias rule pointing directly to the TS source.
- However, **the server requires compiling the shared package**. You must run:
  ```bash
  npm run build:shared
  ```
  after updating any shared schema so that the server's node modules resolve the updated Javascript build target.

### PDF & Excel Export Architecture
- **PDF Generation:** Documents are produced using a **dependency-free built-in PDF writer** in `server/src/lib/pdf.ts` (offline-friendly, ASCII only) instead of heavier libraries like Puppeteer or PDFKit. Avoid importing external heavy rendering modules for PDFs.
- **Excel Generation:** Spreadsheet exports are generated on the server using **ExcelJS**.

---

## 6. Testing Strategy

Tests are run using **Jest** and **Supertest** on the Express API.

### Execution
Run tests from the `server/` workspace or using the workspace flags:
```bash
# Execute Jest integration suite
npm run test -w server

# Run Jest in watch mode
npm run test:watch -w server
```

### Important Testing Requirements
1. **Isolated Database:** The integration suite relies on an isolated test SQLite file (`test.db`) rather than the active workspace DB.
2. **Setup Pipeline:** Before running Jest, ensure the test database is reset, migrated, and seeded correctly:
   ```bash
   # From the server/ directory:
   DATABASE_URL="file:./test.db" npx prisma migrate reset --force
   DATABASE_URL="file:./test.db" npm run test
   ```
3. **Database URL Validation:** The global test setup utility (`server/tests/setup.ts`) alerts you if `DATABASE_URL` is not explicitly set to point to a test database file. Never run tests against the primary development SQLite databases.
