/**
 * migrate-from-xlsx.ts
 * --------------------
 * One-shot, idempotent import of the legacy workbook
 * (docs/source-data/Maktab Detailed - Report.xlsx) into the Makthab Prisma
 * database (schema.prisma).
 *
 * Run (from server/):  npm run migrate:xlsx
 *
 * Sheets consumed:
 *   Admission Details              -> Student
 *   Admission Fees Details         -> FeePayment (feeType=admission)
 *   AY- 2024-2025 Monthly Fees     -> FeePayment (feeType=monthly, unpivoted)
 *   AY- 2025-2026 Monthly Fees     -> FeePayment (feeType=monthly)
 *   AY- 2026-2027 Monthly Fees     -> FeePayment (feeType=monthly)
 *   Salary                         -> Staff + SalaryPayment
 *   Expense                        -> Expense
 * Skipped: "Copy of ..." duplicates, "Price Distribution ...", "Summary".
 *
 * Idempotent: every write is matched against existing rows and updated in
 * place rather than duplicated.
 *   Student       admissionNo
 *   FeePayment    matched by [studentId, feeType] (admission) or
 *                 [studentId, feeType, feeYear, feeMonth] (monthly) — NOT by
 *                 receiptNo. receiptNo is regenerated every run using the
 *                 same running-sequence scheme as live receipts (see
 *                 nextReceiptNo in src/lib/docNo.ts):
 *                   admission: ADM-<admNo>-<yyyy>-<seq>
 *                   monthly:   MF-<admNo>-<yyyymm>-<seq>
 *                 `seq` is one running receipt-book sequence per type,
 *                 assigned in chronological order (admission: sheet row
 *                 order; monthly: fee period, then row order within period)
 *                 — not derived from DB state, so it's stable across reruns.
 *   Staff         (matched by fullName)
 *   SalaryPayment [staffId, salaryMonth, salaryYear]
 *   Expense       voucherNo  (LEG-EXP-<row>)
 */

import "dotenv/config";
import path from "node:path";
import ExcelJS from "exceljs";

// Standalone CLI script (run via `tsx prisma/migrate-from-xlsx.ts`), outside
// the Express app — resolves its own provider-appropriate client rather than
// going through server/src/db/client.ts (an app-layer module).
const provider = process.env.DATABASE_PROVIDER ?? "sqlite";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } =
  provider === "postgresql" ? require("./generated/postgres-client") : require("./generated/sqlite-client");
const prisma = new PrismaClient({ log: ["warn", "error"] });
const WORKBOOK = path.resolve(__dirname, "../../docs/source-data/Maktab Detailed - Report.xlsx");

// ---------------------------------------------------------------------------
// Cell / value helpers
// ---------------------------------------------------------------------------

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown };
    if ("result" in o && o.result != null) return String(o.result).trim();
    if ("text" in o && o.text != null) return String(o.text).trim();
    if (v instanceof Date) return v.toISOString();
    return "";
  }
  return String(v).trim();
}

function cellDate(v: ExcelJS.CellValue): Date | null {
  if (v instanceof Date) return v;
  const s = cellText(v);
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const parts = s.split(/[/\-.]/).map(Number);
  if (parts.length === 3 && parts[0] <= 31) return new Date(parts[2], parts[1] - 1, parts[0]);
  return null;
}

function toFloat(v: ExcelJS.CellValue): number {
  const n = parseFloat(cellText(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function cleanPhone(raw: string): string {
  const s = raw.replace(/[^\d]/g, "");
  return s || "0000000000";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const PAYMENT_METHODS = new Set(["cash", "upi", "bank", "cheque", "card", "unknown"]);
function toMethod(raw: string): string {
  const m = raw.toLowerCase().trim();
  return PAYMENT_METHODS.has(m) ? m : m ? "unknown" : "cash";
}

// Read an entire row as a 1-indexed array of strings, forward-filling merged
// cells (ExcelJS leaves non-master merged cells empty).
function rowValues(ws: ExcelJS.Worksheet, r: number, fill = false): string[] {
  const row = ws.getRow(r);
  const out: string[] = [];
  let last = "";
  for (let c = 1; c <= ws.columnCount; c++) {
    let v = cellText(row.getCell(c).value);
    if (fill) {
      if (v) last = v;
      else v = last;
    }
    out[c] = v;
  }
  return out;
}

const isStudentId = (s: string) => /^UF\d+/i.test(s.trim());

// ---------------------------------------------------------------------------
// Lookup caches (resolved against the seeded DB)
// ---------------------------------------------------------------------------

const classCache = new Map<string, number>();
async function classId(nameRaw: string): Promise<number | null> {
  const name = nameRaw.trim();
  if (!name) return null;
  if (classCache.has(name)) return classCache.get(name)!;
  const rec = await prisma.class.upsert({ where: { name }, update: {}, create: { name } });
  classCache.set(name, rec.id);
  return rec.id;
}

// Global study-track master list (e.g. "Noorani Qaida", "Naazira Quran",
// "Hifz Quran" — see schema.prisma's Category doc comment). Distinct from
// categoryId() below, which upserts ExpenseCategory, an unrelated model.
const studentCategoryCache = new Map<string, number>();
async function studentCategoryId(nameRaw: string): Promise<number | null> {
  const name = nameRaw.trim();
  if (!name) return null;
  if (studentCategoryCache.has(name)) return studentCategoryCache.get(name)!;
  const rec = await prisma.category.upsert({ where: { name }, update: {}, create: { name } });
  studentCategoryCache.set(name, rec.id);
  return rec.id;
}

// Record that `cls` offers `cat` (Class.categories, the implicit m2m) so the
// category actually shows up as a selectable option for that class in the
// StudentForm UI, not just on the raw Student.categoryId FK.
const linkedClassCategory = new Set<string>();
async function linkCategoryToClass(cls: number, cat: number): Promise<void> {
  const key = `${cls}:${cat}`;
  if (linkedClassCategory.has(key)) return;
  linkedClassCategory.add(key);
  await prisma.class.update({ where: { id: cls }, data: { categories: { connect: { id: cat } } } });
}

const CATEGORY_SYNONYMS: Record<string, string> = {
  stationary: "Stationery",
  stationery: "Stationery",
  book: "Books",
  books: "Books",
  uniform: "Uniform",
  rent: "Rent",
  salary: "Salary",
  food: "Food",
  transport: "Transport",
  maintenance: "Maintenance",
  utility: "Utilities",
  utilities: "Utilities",
};
const categoryCache = new Map<string, number>();
async function categoryId(nameRaw: string): Promise<number> {
  const key = nameRaw.trim().toLowerCase();
  const name = CATEGORY_SYNONYMS[key] ?? (nameRaw.trim() || "Miscellaneous");
  if (categoryCache.has(name)) return categoryCache.get(name)!;
  const rec = await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  categoryCache.set(name, rec.id);
  return rec.id;
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

async function migrateStudents(ws: ExcelJS.Worksheet, academicYearId: number) {
  // Header row 1; data from row 2. Column layout, verified against the sheet's
  // actual header row (not assumed): 1 Admission Number, 2 Bill Number,
  // 3 Student Name, 4 Age, 5 Gender, 6 Date of Birth, 7 Father/Guardian Name,
  // 8 Contact Number, 9 Occupation, 10 Address, 11 Previous Studies,
  // 12 Status, 13 Previous Madrasa, 14 Reason of leaving, 15 School,
  // 16 Class, 17 Category, 18 School Timings, 19 Time Slot.
  // Class/Category were previously misread (Class pulled School's column,
  // Category wasn't read at all) and every notes-column index from 14 on was
  // shifted by 1-2 — fixed below.
  let created = 0;
  const idByAdm = new Map<string, number>();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = rowValues(ws, r);
    const admissionNo = row[1]?.trim();
    if (!isStudentId(admissionNo)) continue;

    const gender = row[5]?.toLowerCase().startsWith("f") ? "female" : "male";
    const status = row[12]?.trim().toLowerCase() === "inactive" ? "inactive" : "active";
    const notesParts = [
      row[9] && `Occupation: ${row[9]}`,
      row[15] && `School: ${row[15]}`,
      row[18] && `School timings: ${row[18]}`,
      row[19] && `Time slot: ${row[19]}`,
      row[11] && `Previous studies: ${row[11]}`,
      row[13] && `Previous madrasa: ${row[13]}`,
      row[14] && row[14].toUpperCase() !== "NA" && `Reason of leaving: ${row[14]}`,
    ].filter(Boolean);

    const cid = (await classId(row[16])) ?? (await classId("1"))!;
    const catId = await studentCategoryId(row[17] ?? "");
    if (catId != null) await linkCategoryToClass(cid, catId);

    const data = {
      admissionNo,
      fullName: row[3] || admissionNo,
      fatherName: row[7] || "-",
      dateOfBirth: cellDate(ws.getRow(r).getCell(6).value),
      gender,
      contactNo: cleanPhone(row[8] ?? ""),
      whatsappNo: cleanPhone(row[8] ?? ""),
      address: row[10] || null,
      classId: cid,
      categoryId: catId,
      academicYearId,
      notes: notesParts.length ? notesParts.join(" | ") : null,
      legacyBillNo: row[2] || null,
      status,
    };
    const rec = await prisma.student.upsert({
      where: { admissionNo },
      update: data,
      create: data,
    });
    idByAdm.set(admissionNo, rec.id);
    created++;
  }
  console.log(`  Students: ${created} upserted`);
  return idByAdm;
}

// Students UF00037+ appear only in the fee sheets (not in "Admission Details").
// Backfill minimal Student records from the monthly-fee sheets, which carry
// name/gender/father/contact/class in fixed columns 1-6.
async function backfillStudentsFromFeeSheets(
  wb: ExcelJS.Workbook,
  idByAdm: Map<string, number>,
  academicYearId: number,
) {
  let created = 0;
  for (const name of ["AY- 2024-2025 Monthly Fees", "AY- 2025-2026 Monthly Fees", "AY- 2026-2027 Monthly Fees"]) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    for (let r = 7; r <= ws.rowCount; r++) {
      const row = rowValues(ws, r);
      const admissionNo = row[1]?.trim();
      if (!isStudentId(admissionNo) || idByAdm.has(admissionNo)) continue;

      const cid = (await classId(row[6])) ?? (await classId("1"))!;
      const data = {
        admissionNo,
        fullName: row[2] || admissionNo,
        fatherName: row[4] || "-",
        gender: row[3]?.toLowerCase().startsWith("f") ? "female" : "male",
        contactNo: cleanPhone(row[5] ?? ""),
        whatsappNo: cleanPhone(row[5] ?? ""),
        classId: cid,
        academicYearId,
        notes: "Backfilled from monthly-fee sheet (not in Admission Details).",
        status: "active",
      };
      const rec = await prisma.student.upsert({ where: { admissionNo }, update: {}, create: data });
      idByAdm.set(admissionNo, rec.id);
      created++;
    }
  }
  console.log(`  Backfilled ${created} students found only in fee sheets`);
}

// A handful of students appear only in the Admission Fees sheet (an admission
// payment but no monthly history and no Admission Details row). Backfill them
// from that sheet: col 5 = student name, col 6 = received-from (guardian).
async function backfillStudentsFromAdmissionFees(
  ws: ExcelJS.Worksheet,
  idByAdm: Map<string, number>,
  academicYearId: number,
) {
  let created = 0;
  const cid = (await classId("1"))!;
  for (let r = 7; r <= ws.rowCount; r++) {
    const row = rowValues(ws, r);
    const admissionNo = row[1]?.trim();
    if (!isStudentId(admissionNo) || idByAdm.has(admissionNo)) continue;
    const data = {
      admissionNo,
      fullName: row[5] || admissionNo,
      fatherName: row[6] || "-",
      gender: "male",
      contactNo: "0000000000",
      whatsappNo: "0000000000",
      classId: cid,
      academicYearId,
      notes: "Backfilled from admission-fee sheet (not in Admission Details / monthly sheets).",
      status: "active",
    };
    const rec = await prisma.student.upsert({ where: { admissionNo }, update: {}, create: data });
    idByAdm.set(admissionNo, rec.id);
    created++;
  }
  console.log(`  Backfilled ${created} students found only in the admission-fee sheet`);
}

async function migrateAdmissionFees(
  ws: ExcelJS.Worksheet,
  idByAdm: Map<string, number>,
  collectedById: number,
) {
  // Header row 6; data from row 7.
  let created = 0,
    skipped = 0,
    seq = 0;
  for (let r = 7; r <= ws.rowCount; r++) {
    const row = rowValues(ws, r);
    const admissionNo = row[1]?.trim();
    if (!isStudentId(admissionNo)) continue;
    const studentId = idByAdm.get(admissionNo);
    if (!studentId) {
      skipped++;
      continue;
    }
    const date = cellDate(ws.getRow(r).getCell(3).value) ?? new Date();
    const amount = toFloat(ws.getRow(r).getCell(4).value);
    seq++;
    const receiptNo = `ADM-${admissionNo}-${date.getFullYear()}-${String(seq).padStart(4, "0")}`;
    const data = {
      receiptNo,
      studentId,
      feeType: "admission",
      feeMonth: null,
      feeYear: date.getFullYear(),
      amountDue: amount,
      amountPaid: amount,
      paymentDate: date,
      paymentMethod: toMethod(row[8] ?? ""),
      collectedById,
    };
    const existing = await prisma.feePayment.findFirst({ where: { studentId, feeType: "admission" } });
    if (existing) await prisma.feePayment.update({ where: { id: existing.id }, data });
    else await prisma.feePayment.create({ data });
    created++;
  }
  console.log(`  Admission fees: ${created} upserted, ${skipped} skipped (unknown student)`);
}

function parseMonthYear(label: string): { month: number; year: number } | null {
  const m = label.match(/([A-Za-z]{3,})\s*(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return { month: mon, year: Number(m[2]) };
  }
  const d = new Date(label);
  if (!isNaN(d.getTime()) && /\d{4}/.test(label)) return { month: d.getMonth() + 1, year: d.getFullYear() };
  return null;
}

async function migrateMonthlyFees(
  ws: ExcelJS.Worksheet,
  idByAdm: Map<string, number>,
  collectedById: number,
  // Shared across every sheet/call so the receipt-book sequence is one
  // continuous run (matching the live global-sequence scheme), not reset
  // per sheet or per student.
  seqRef: { n: number },
) {
  // Group labels on row 5 (merged, forward-filled); sub-headers row 6; data row 7+.
  // Fixed student columns: 1=admNo 2=name 6=class. Repeating 4-col fee groups from col 7.
  const groupLabels = rowValues(ws, 5, true);
  const groups: Array<{ base: number; month: number; year: number }> = [];
  for (let base = 7; base + 2 <= ws.columnCount; base += 4) {
    const my = parseMonthYear(groupLabels[base] ?? "");
    if (my) groups.push({ base, month: my.month, year: my.year });
  }
  if (groups.length === 0) {
    console.log(`  [${ws.name}] no month groups detected — skipped`);
    return 0;
  }

  // Period outer, student inner: mirrors a receipt book being issued in
  // calendar order (all of a month's receipts before the next month's),
  // not "one student's whole history, then the next student's".
  let created = 0;
  for (const g of groups) {
    for (let r = 7; r <= ws.rowCount; r++) {
      const admissionNo = cellText(ws.getRow(r).getCell(1).value).trim();
      if (!isStudentId(admissionNo)) continue;
      const studentId = idByAdm.get(admissionNo);
      if (!studentId) continue;

      const amount = toFloat(ws.getRow(r).getCell(g.base + 2).value);
      if (amount <= 0) continue; // no payment that month
      const payDate = cellDate(ws.getRow(r).getCell(g.base).value) ?? new Date(g.year, g.month - 1, 1);
      const mode = cellText(ws.getRow(r).getCell(g.base + 3).value);
      seqRef.n++;
      const period = `${g.year}${String(g.month).padStart(2, "0")}`;
      const receiptNo = `MF-${admissionNo}-${period}-${String(seqRef.n).padStart(4, "0")}`;
      const data = {
        receiptNo,
        studentId,
        feeType: "monthly",
        feeMonth: g.month,
        feeYear: g.year,
        amountDue: amount,
        amountPaid: amount,
        paymentDate: payDate,
        paymentMethod: toMethod(mode),
        collectedById,
      };
      const existing = await prisma.feePayment.findFirst({
        where: { studentId, feeType: "monthly", feeYear: g.year, feeMonth: g.month },
      });
      if (existing) await prisma.feePayment.update({ where: { id: existing.id }, data });
      else await prisma.feePayment.create({ data });
      created++;
    }
  }
  console.log(`  [${ws.name}] monthly fees: ${created} payments across ${groups.length} months`);
  return created;
}

async function migrateSalaries(ws: ExcelJS.Worksheet) {
  // Header row 6: [1]Month(date) [2]Item(staff) [3]Salary [4]Month(label) [5]Total. Data row 7+.
  let staffCount = 0,
    payCount = 0;
  const staffByName = new Map<string, number>();

  for (let r = 7; r <= ws.rowCount; r++) {
    const name = cellText(ws.getRow(r).getCell(2).value).trim();
    if (!name || /^total/i.test(name)) continue;
    const amount = toFloat(ws.getRow(r).getCell(3).value);
    const payDate = cellDate(ws.getRow(r).getCell(1).value);
    const monthLabel = cellText(ws.getRow(r).getCell(4).value);
    if (!amount && !payDate) continue;

    let staffId = staffByName.get(name);
    if (staffId == null) {
      const staff = await prisma.staff.upsert({
        where: { id: (await prisma.staff.findFirst({ where: { fullName: name } }))?.id ?? -1 },
        update: {},
        create: {
          fullName: name,
          role: "Teacher",
          baseSalary: amount,
          contactNo: "0000000000",
          whatsappNo: "0000000000",
          status: "active",
        },
      });
      staffId = staff.id;
      staffByName.set(name, staffId);
      staffCount++;
    }

    const mon = MONTHS[monthLabel.slice(0, 3).toLowerCase()] ?? (payDate ? payDate.getMonth() : 0) + 1;
    const year = payDate?.getFullYear() ?? new Date().getFullYear();
    await prisma.salaryPayment.upsert({
      where: { staffId_salaryMonth_salaryYear: { staffId, salaryMonth: mon, salaryYear: year } },
      update: { grossAmount: amount, netAmount: amount, paymentDate: payDate ?? new Date(year, mon - 1, 25) },
      create: {
        staffId,
        salaryMonth: mon,
        salaryYear: year,
        grossAmount: amount,
        deductions: 0,
        netAmount: amount,
        paymentDate: payDate ?? new Date(year, mon - 1, 25),
      },
    });
    payCount++;
  }
  console.log(`  Staff: ${staffCount} upserted | Salary payments: ${payCount}`);
}

async function migrateExpenses(ws: ExcelJS.Worksheet, approvedById: number) {
  // Header row 6: [1]Date [2]Item [3]Cost [4]Quantity [5]Amount [6]Category. Data row 7+.
  let created = 0;
  for (let r = 7; r <= ws.rowCount; r++) {
    const item = cellText(ws.getRow(r).getCell(2).value).trim();
    const date = cellDate(ws.getRow(r).getCell(1).value);
    if (!item && !date) continue;
    if (!item) continue;

    const costCell = cellText(ws.getRow(r).getCell(3).value);
    const qtyCell = cellText(ws.getRow(r).getCell(4).value);
    const cost = toFloat(ws.getRow(r).getCell(3).value);
    const qty = toFloat(ws.getRow(r).getCell(4).value);
    const amount = toFloat(ws.getRow(r).getCell(5).value) || cost * qty;
    const voucherNo = `LEG-EXP-${String(r).padStart(4, "0")}`;
    const data = {
      voucherNo,
      categoryId: await categoryId(cellText(ws.getRow(r).getCell(6).value)),
      cost: costCell ? cost : null,
      quantity: qtyCell ? qty : null,
      amount,
      expenseDate: date ?? new Date(),
      payee: item,
      description: qty ? `${item} — qty ${qty} @ ${cost}` : item,
      approvedById,
    };
    await prisma.expense.upsert({ where: { voucherNo }, update: data, create: data });
    created++;
  }
  console.log(`  Expenses: ${created} upserted`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Reading workbook:", WORKBOOK);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORKBOOK);

  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`Sheet not found: ${name}`);
    return ws;
  };

  const activeYear = await prisma.academicYear.findFirst({ where: { isActive: true } });
  if (!activeYear) throw new Error("No active academic year — run the seed first (npm run db:seed).");
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!admin) throw new Error("No admin user — run the seed first.");
  const actorStaffId = admin.staffId;

  console.log("\n== Students ==");
  const idByAdm = await migrateStudents(sheet("Admission Details"), activeYear.id);
  await backfillStudentsFromFeeSheets(wb, idByAdm, activeYear.id);

  console.log("\n== Admission fees ==");
  await backfillStudentsFromAdmissionFees(sheet("Admission Fees Details"), idByAdm, activeYear.id);
  await migrateAdmissionFees(sheet("Admission Fees Details"), idByAdm, actorStaffId);

  console.log("\n== Monthly fees ==");
  const monthlySeq = { n: 0 };
  for (const name of ["AY- 2024-2025 Monthly Fees", "AY- 2025-2026 Monthly Fees", "AY- 2026-2027 Monthly Fees"]) {
    const ws = wb.getWorksheet(name);
    if (ws) await migrateMonthlyFees(ws, idByAdm, actorStaffId, monthlySeq);
    else console.log(`  (sheet "${name}" not present)`);
  }

  console.log("\n== Salaries ==");
  await migrateSalaries(sheet("Salary"));

  console.log("\n== Expenses ==");
  await migrateExpenses(sheet("Expense"), actorStaffId);

  console.log("\n== Final DB counts ==");
  const [students, fees, staff, salaries, expenses] = await Promise.all([
    prisma.student.count(),
    prisma.feePayment.count(),
    prisma.staff.count(),
    prisma.salaryPayment.count(),
    prisma.expense.count(),
  ]);
  console.log({ students, fees, staff, salaries, expenses });
  console.log("\nMigration complete.");
}

main()
  .catch((e) => {
    console.error("\nMigration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
