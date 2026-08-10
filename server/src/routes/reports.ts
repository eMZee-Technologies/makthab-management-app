import type { Response } from "express";
import { Router } from "express";
import { feePaymentRepository, salaryPaymentRepository, expenseRepository, studentRepository, attendanceRepository, contributionRepository, monthlyProgressRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireResourcePermission } from "../middleware/auth";
import { validateQuery } from "../middleware/validate";
import { renderPdf } from "../lib/pdf";
import { renderXlsx, XLSX_CONTENT_TYPE } from "../lib/excel";
import { getOrgHeader } from "../lib/orgProfile";
import { MONTH_NAMES, MONTH_ABBR } from "../lib/monthNames";
import {
  feeCollectionSummaryQuery,
  salaryRegisterSummaryQuery,
  financialSummaryQuery,
  studentProgressReportQuery,
  type FeeCollectionSummaryQuery,
  type SalaryRegisterSummaryQuery,
  type FinancialSummaryQuery,
  type StudentProgressReportQuery,
  type StudentProgressReportRow,
  type MonthlyFeeBreakdownRow,
  type YearlyFeeBreakdownRow,
  type MonthlySalaryBreakdownRow,
  type YearlySalaryBreakdownRow,
  type FinancialSummaryYearData,
  type FinancialSummaryYearRow,
} from "@makthab/shared";

export const reportsRouter = Router();
// B5: reports are gated by the `reports.access` permission (held by Admin +
// Accountant, and grantable to any custom "management" role) rather than a
// hardcoded role list.
reportsRouter.use(requireAuth, requireResourcePermission("reports", "view"));


// Aggregate a single year's monthly-fee payments by month (all 12, zero-filled).
export async function monthlyFeeBreakdown(year: number): Promise<MonthlyFeeBreakdownRow[]> {
  const grouped = await feePaymentRepository.groupByMonth("monthly", year);
  const byMonth = new Map<number, { totalPaid: number; count: number }>();
  for (const g of grouped) {
    if (g.feeMonth == null) continue;
    byMonth.set(g.feeMonth, { totalPaid: g._sum.amountPaid ?? 0, count: g._count._all });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const cur = byMonth.get(month) ?? { totalPaid: 0, count: 0 };
    return { month, totalPaid: cur.totalPaid, count: cur.count };
  });
}

// Aggregate all monthly-fee payments by year, from the earliest year present
// through the current year (or the latest year with data, if later),
// zero-filled, ascending.
export async function yearlyFeeBreakdown(): Promise<YearlyFeeBreakdownRow[]> {
  const grouped = await feePaymentRepository.groupByYear("monthly");
  const byYear = new Map<number, { totalPaid: number; count: number }>();
  for (const g of grouped) {
    byYear.set(g.feeYear, { totalPaid: g._sum.amountPaid ?? 0, count: g._count._all });
  }
  const currentYear = new Date().getFullYear();
  const minYear = byYear.size ? Math.min(...byYear.keys()) : currentYear;
  // Upper bound is the current year, but never below the latest year with data
  // so future-dated (advance/mis-keyed) payments aren't silently dropped from
  // the range or the total.
  const maxYear = byYear.size ? Math.max(currentYear, ...byYear.keys()) : currentYear;
  const out: YearlyFeeBreakdownRow[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    const cur = byYear.get(y) ?? { totalPaid: 0, count: 0 };
    out.push({ year: y, totalPaid: cur.totalPaid, count: cur.count });
  }
  return out;
}

// Aggregate a single year's salary payments by month (all 12, zero-filled),
// summing net pay. Mirrors monthlyFeeBreakdown.
export async function monthlySalaryBreakdown(year: number): Promise<MonthlySalaryBreakdownRow[]> {
  const grouped = await salaryPaymentRepository.groupByMonth(year);
  const byMonth = new Map<number, { totalNet: number; count: number }>();
  for (const g of grouped) {
    byMonth.set(g.salaryMonth, { totalNet: g._sum.netAmount ?? 0, count: g._count._all });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const cur = byMonth.get(month) ?? { totalNet: 0, count: 0 };
    return { month, totalNet: cur.totalNet, count: cur.count };
  });
}

// Aggregate all salary payments by year (net pay), earliest year present
// through the current year (or later if data exists beyond it), zero-filled,
// ascending. Mirrors yearlyFeeBreakdown.
export async function yearlySalaryBreakdown(): Promise<YearlySalaryBreakdownRow[]> {
  const grouped = await salaryPaymentRepository.groupByYear();
  const byYear = new Map<number, { totalNet: number; count: number }>();
  for (const g of grouped) {
    byYear.set(g.salaryYear, { totalNet: g._sum.netAmount ?? 0, count: g._count._all });
  }
  const currentYear = new Date().getFullYear();
  const minYear = byYear.size ? Math.min(...byYear.keys()) : currentYear;
  const maxYear = byYear.size ? Math.max(currentYear, ...byYear.keys()) : currentYear;
  const out: YearlySalaryBreakdownRow[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    const cur = byYear.get(y) ?? { totalNet: 0, count: 0 };
    out.push({ year: y, totalNet: cur.totalNet, count: cur.count });
  }
  return out;
}

// Summarize a single year: monthly fee + admission fee + contributions income,
// expenses, salaries, and derived net balance. Fees window by feeYear (not
// paymentDate) so a payment counts toward the year it settles; contributions
// and expenses window by their date fields.
async function financialSummaryForYear(year: number): Promise<FinancialSummaryYearData> {
  const yearWindow = { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
  const [monthlyFee, admissionFee, contributions, expenses, salaries] = await Promise.all([
    feePaymentRepository.sumAmountPaid({ feeType: "monthly", feeYear: year }),
    feePaymentRepository.sumAmountPaid({ feeType: "admission", feeYear: year }),
    contributionRepository.sumByDateWindow(yearWindow),
    expenseRepository.sumByDateWindow(yearWindow),
    salaryPaymentRepository.sumByYear(year),
  ]);
  return {
    monthlyFee,
    admissionFee,
    contributions,
    expenses,
    salaries,
    netBalance: monthlyFee + admissionFee + contributions - expenses - salaries,
  };
}

// One row per year across all data, earliest year present through the current
// year (or later if data exists beyond it), zero-filled, ascending.
async function financialSummaryAllYears(): Promise<FinancialSummaryYearRow[]> {
  // Expense and Contribution have no year column (only date), so group in JS;
  // the other sources have feeYear/salaryYear and use groupBy like their siblings.
  const [monthlyG, admissionG, salaryG, expenses, contributions] = await Promise.all([
    feePaymentRepository.groupByYear("monthly"),
    feePaymentRepository.groupByYear("admission"),
    salaryPaymentRepository.groupByYear(),
    expenseRepository.findAllAmountsWithDate(),
    contributionRepository.findAllAmountsWithDate(),
  ]);
  const monthlyByYear = new Map(monthlyG.map((g) => [g.feeYear, g._sum.amountPaid ?? 0]));
  const admissionByYear = new Map(admissionG.map((g) => [g.feeYear, g._sum.amountPaid ?? 0]));
  const salaryByYear = new Map(salaryG.map((g) => [g.salaryYear, g._sum.netAmount ?? 0]));
  const expenseByYear = new Map<number, number>();
  for (const e of expenses) {
    const y = new Date(e.expenseDate).getFullYear();
    expenseByYear.set(y, (expenseByYear.get(y) ?? 0) + e.amount);
  }
  const contributionByYear = new Map<number, number>();
  for (const c of contributions) {
    const y = new Date(c.date).getFullYear();
    contributionByYear.set(y, (contributionByYear.get(y) ?? 0) + c.amount);
  }
  const currentYear = new Date().getFullYear();
  const allYears = [
    ...monthlyByYear.keys(),
    ...admissionByYear.keys(),
    ...salaryByYear.keys(),
    ...expenseByYear.keys(),
    ...contributionByYear.keys(),
  ];
  const minYear = allYears.length ? Math.min(...allYears) : currentYear;
  const maxYear = Math.max(currentYear, ...(allYears.length ? allYears : [currentYear]));
  const out: FinancialSummaryYearRow[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    const monthlyFee = monthlyByYear.get(y) ?? 0;
    const admissionFee = admissionByYear.get(y) ?? 0;
    const contrib = contributionByYear.get(y) ?? 0;
    const expensesTotal = expenseByYear.get(y) ?? 0;
    const salaries = salaryByYear.get(y) ?? 0;
    out.push({
      year: y,
      monthlyFee,
      admissionFee,
      contributions: contrib,
      expenses: expensesTotal,
      salaries,
      netBalance: monthlyFee + admissionFee + contrib - expensesTotal - salaries,
    });
  }
  return out;
}

interface ReportData {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  /** 0-based header indexes holding currency amounts — rendered as real numbers with a ₹ format. */
  currencyCols?: number[];
  /** Append a bold "Total" row summing each currencyCols column. */
  totalsRow?: boolean;
  summaryLines?: Array<[string, string]>;
}

// Emit a report as PDF (default) or XLSX (?format=xlsx). `pdfOnly` forces PDF.
// `filenameStem`, when given, is used verbatim as the download filename base
// (extension appended per format), bypassing the title/subtitle slug.
async function send(
  res: Response,
  format: unknown,
  d: ReportData,
  pdfOnly = false,
  filenameStem?: string
): Promise<void> {
  const wantXlsx = !pdfOnly && String(format).toLowerCase() === "xlsx";
  // Fold the subtitle (month/year, or class/year for attendance) into the
  // filename so e.g. two Fee Collection exports for different months don't
  // overwrite each other on disk.
  const slug =
    filenameStem ??
    [d.title, d.subtitle]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const org = await getOrgHeader();
  if (wantXlsx) {
    const buf = await renderXlsx({
      sheetName: d.title.slice(0, 31),
      org,
      title: d.subtitle ? `${d.title} — ${d.subtitle}` : d.title,
      headers: d.headers,
      rows: d.rows,
      currencyCols: d.currencyCols,
      totalsRow: d.totalsRow,
    });
    res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", `attachment; filename="${slug}.xlsx"`);
    res.end(buf);
    return;
  }
  const pdf = renderPdf({
    org,
    title: d.title,
    subtitle: d.subtitle,
    lines: d.summaryLines,
    table: { headers: d.headers, rows: d.rows, currencyCols: d.currencyCols, totalsRow: d.totalsRow },
    footer: "Generated by Makthab",
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${slug}.pdf"`);
  res.end(pdf);
}

const monthWindow = (month: number, year: number) => ({
  gte: new Date(year, month - 1, 1),
  lt: new Date(year, month, 1),
});

// GET /reports/fee-collection/summary?view=year|all&year — JSON for on-screen
// tables (no PDF/XLSX). Registered before /fee-collection so path matching is
// unambiguous (Express matches in registration order).
reportsRouter.get(
  "/fee-collection/summary",
  validateQuery(feeCollectionSummaryQuery),
  asyncHandler(async (_req, res) => {
    const { view, year } = res.locals.query as FeeCollectionSummaryQuery;
    if (view === "year") {
      const months = await monthlyFeeBreakdown(year as number);
      const totalPaid = months.reduce((s, m) => s + m.totalPaid, 0);
      res.json({ data: { view: "year", year, months, totalPaid } });
      return;
    }
    const years = await yearlyFeeBreakdown();
    const totalPaid = years.reduce((s, y) => s + y.totalPaid, 0);
    res.json({ data: { view: "all", years, totalPaid } });
  })
);

// GET /reports/fee-collection?month&year&view=month|year|all&format
// view=month (default): monthly-fee payment list for a given month/year.
// view=year: 12-month summary for a year. view=all: yearly summary across years.
reportsRouter.get(
  "/fee-collection",
  asyncHandler(async (req, res) => {
    const view = String(req.query.view ?? "month");
    if (view === "year") {
      const year = Number(req.query.year);
      const months = await monthlyFeeBreakdown(year);
      await send(
        res,
        req.query.format,
        {
          title: "Monthly Fee Collection Report",
          subtitle: String(year),
          headers: ["Month", "Payments", "Total Paid"],
          rows: months.map((m) => [MONTH_NAMES[m.month - 1], m.count, m.totalPaid]),
          currencyCols: [2],
          totalsRow: true,
        },
        false,
        `Monthly-Fee-Report-${year}`
      );
      return;
    }
    if (view === "all") {
      const years = await yearlyFeeBreakdown();
      await send(
        res,
        req.query.format,
        {
          title: "Monthly Fee Collection Report",
          subtitle: "All",
          headers: ["Year", "Payments", "Total Paid"],
          rows: years.map((y) => [y.year, y.count, y.totalPaid]),
          currencyCols: [2],
          totalsRow: true,
        },
        false,
        "Monthly-Fee-Report-All"
      );
      return;
    }
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const fees = await feePaymentRepository.findForReport({ feeType: "monthly", feeMonth: month, feeYear: year });
    await send(
      res,
      req.query.format,
      {
        title: "Monthly Fee Collection Report",
        subtitle: `${MONTH_ABBR[month - 1]}-${year}`,
        // "Type" is omitted here (unlike the on-screen table): every row in this
        // report is already scoped to feeType="monthly" above, so the column
        // would be constant dead weight — and on a fixed-width PDF, that weight
        // was crowding out Method/Date into illegible truncation.
        headers: ["Receipt", "Student", "Admission No", "Paid", "Method", "Date"],
        rows: fees.map((f) => [
          f.receiptNo,
          f.student?.fullName ?? "-",
          f.student?.admissionNo ?? "-",
          f.amountPaid,
          f.paymentMethod,
          new Date(f.paymentDate).toISOString().slice(0, 10),
        ]),
        currencyCols: [3],
        totalsRow: true,
        summaryLines: [["Payments", String(fees.length)]],
      },
      false,
      `Monthly-Fee-Report-${MONTH_ABBR[month - 1]}-${year}`
    );
  })
);

// GET /reports/admission-fee-collection?year&format — admission-fee payment
// list (all years if year omitted).
reportsRouter.get(
  "/admission-fee-collection",
  asyncHandler(async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const fees = await feePaymentRepository.findForReport({ feeType: "admission", feeYear: year });
    await send(
      res,
      req.query.format,
      {
        title: "Admission Fee Collection Report",
        subtitle: year ? String(year) : "All",
        headers: ["Receipt", "Student", "Admission No", "Paid", "Method", "Date"],
        rows: fees.map((f) => [
          f.receiptNo,
          f.student?.fullName ?? "-",
          f.student?.admissionNo ?? "-",
          f.amountPaid,
          f.paymentMethod,
          new Date(f.paymentDate).toISOString().slice(0, 10),
        ]),
        currencyCols: [3],
        totalsRow: true,
      },
      false,
      `Admission-Fee-Report-${year ?? "All"}`
    );
  })
);

// GET /reports/defaulters?month&year
reportsRouter.get(
  "/defaulters",
  asyncHandler(async (req, res) => {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const students = await studentRepository.findActiveWithClass();
    const paidSet = await feePaymentRepository.studentIdsPaidForPeriod("monthly", month, year);
    const defaulters = students.filter((s) => !paidSet.has(s.id));
    await send(
      res,
      req.query.format,
      {
        title: "Defaulters Report",
        subtitle: `${month}/${year}`,
        // Date/Amount/Mode are left blank on purpose — staff fill them in by
        // hand after following up with each defaulter.
        headers: ["Admission", "Student", "Class", "Contact", "Date", "Amount", "Mode"],
        rows: defaulters.map((s) => [
          s.admissionNo,
          s.fullName,
          s.class?.name ?? "-",
          Number(s.whatsappNo),
          "",
          "",
          "",
        ]),
        summaryLines: [["Total Defaulters", String(defaulters.length)]],
      },
      false,
      `Defaulters-Report-${MONTH_NAMES[month - 1] ?? month}-${year}`
    );
  })
);

// GET /reports/attendance?class_id&category_id&month&year
reportsRouter.get(
  "/attendance",
  asyncHandler(async (req, res) => {
    const classId = req.query.class_id ? Number(req.query.class_id) : undefined;
    const categoryId = req.query.category_id ? Number(req.query.category_id) : undefined;
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const rows = await attendanceRepository.findFiltered({
      dateFilter: monthWindow(month, year),
      classId,
      categoryId,
    });
    const byStudent = new Map<number, { name: string; present: number; total: number }>();
    for (const r of rows) {
      const cur = byStudent.get(r.studentId) ?? { name: r.student?.fullName ?? "", present: 0, total: 0 };
      cur.total += 1;
      if (r.status === "present" || r.status === "late") cur.present += 1;
      byStudent.set(r.studentId, cur);
    }
    await send(res, req.query.format, {
      title: "Attendance Report",
      subtitle: `${month}/${year}${classId ? ` — class ${classId}` : ""}${categoryId ? ` — category ${categoryId}` : ""}`,
      headers: ["Student", "Present", "Total", "%"],
      rows: [...byStudent.values()].map((v) => [
        v.name,
        v.present,
        v.total,
        v.total ? Math.round((v.present / v.total) * 100) : 0,
      ]),
    });
  })
);

// GET /reports/expenses?period — period given = that year; omitted = all years.
reportsRouter.get(
  "/expenses",
  asyncHandler(async (req, res) => {
    const period = req.query.period ? Number(req.query.period) : undefined;
    const expenses = await expenseRepository.findForReport(period);
    await send(
      res,
      req.query.format,
      {
        title: "Expense Report",
        subtitle: period ? String(period) : "All",
        headers: ["Voucher", "Category", "Payee", "Amount", "Date"],
        rows: expenses.map((e) => [
          e.voucherNo,
          e.category?.name ?? "-",
          e.payee,
          e.amount,
          new Date(e.expenseDate).toISOString().slice(0, 10),
        ]),
        currencyCols: [3],
        totalsRow: true,
      },
      false,
      `Expense-Report-${period ?? "All"}`
    );
  })
);

// GET /reports/salary-register/summary?view=year|all&year — JSON for on-screen
// tables (no PDF/XLSX). Registered before /salary-register so path matching is
// unambiguous (Express matches in registration order).
reportsRouter.get(
  "/salary-register/summary",
  validateQuery(salaryRegisterSummaryQuery),
  asyncHandler(async (_req, res) => {
    const { view, year } = res.locals.query as SalaryRegisterSummaryQuery;
    if (view === "year") {
      const months = await monthlySalaryBreakdown(year as number);
      const totalNet = months.reduce((s, m) => s + m.totalNet, 0);
      res.json({ data: { view: "year", year, months, totalNet } });
      return;
    }
    const years = await yearlySalaryBreakdown();
    const totalNet = years.reduce((s, y) => s + y.totalNet, 0);
    res.json({ data: { view: "all", years, totalNet } });
  })
);

// GET /reports/salary-register?month&year&view=month|year|all&format
// view=month (default): salary payment list for a given month/year.
// view=year: 12-month net breakdown for a year. view=all: yearly net breakdown.
reportsRouter.get(
  "/salary-register",
  asyncHandler(async (req, res) => {
    const view = String(req.query.view ?? "month");
    if (view === "year") {
      const year = Number(req.query.year);
      const months = await monthlySalaryBreakdown(year);
      await send(
        res,
        req.query.format,
        {
          title: "Salary Report",
          subtitle: String(year),
          headers: ["Month", "Payments", "Total Net"],
          rows: months.map((m) => [MONTH_NAMES[m.month - 1], m.count, m.totalNet]),
          currencyCols: [2],
          totalsRow: true,
        },
        false,
        `Salary-Report-${year}`
      );
      return;
    }
    if (view === "all") {
      const years = await yearlySalaryBreakdown();
      await send(
        res,
        req.query.format,
        {
          title: "Salary Report",
          subtitle: "All",
          headers: ["Year", "Payments", "Total Net"],
          rows: years.map((y) => [y.year, y.count, y.totalNet]),
          currencyCols: [2],
          totalsRow: true,
        },
        false,
        "Salary-Report-All"
      );
      return;
    }
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const salaries = await salaryPaymentRepository.findForReport(month, year);
    await send(
      res,
      req.query.format,
      {
        title: "Salary Report",
        subtitle: `${MONTH_ABBR[month - 1]}-${year}`,
        headers: ["Staff", "Gross", "Deductions", "Net", "Date"],
        rows: salaries.map((p) => [
          p.staff?.fullName ?? "-",
          p.grossAmount,
          p.deductions,
          p.netAmount,
          new Date(p.paymentDate).toISOString().slice(0, 10),
        ]),
        currencyCols: [1, 2, 3],
        totalsRow: true,
      },
      false,
      `Salary-Report-${MONTH_ABBR[month - 1]}-${year}`
    );
  })
);

// GET /reports/financial-summary/summary?view=year|all&year — JSON for on-screen
// tables (no PDF/XLSX). Registered before /financial-summary so path matching is
// unambiguous (Express matches in registration order).
reportsRouter.get(
  "/financial-summary/summary",
  validateQuery(financialSummaryQuery),
  asyncHandler(async (_req, res) => {
    const { view, year } = res.locals.query as FinancialSummaryQuery;
    if (view === "year") {
      const data = await financialSummaryForYear(year as number);
      res.json({ data: { view: "year", year, ...data } });
      return;
    }
    const years = await financialSummaryAllYears();
    const totals = years.reduce<FinancialSummaryYearData>(
      (acc, y) => ({
        monthlyFee: acc.monthlyFee + y.monthlyFee,
        admissionFee: acc.admissionFee + y.admissionFee,
        contributions: acc.contributions + y.contributions,
        expenses: acc.expenses + y.expenses,
        salaries: acc.salaries + y.salaries,
        netBalance: acc.netBalance + y.netBalance,
      }),
      { monthlyFee: 0, admissionFee: 0, contributions: 0, expenses: 0, salaries: 0, netBalance: 0 }
    );
    res.json({ data: { view: "all", years, totals } });
  })
);

// GET /reports/financial-summary?view=year|all&year&format=pdf|xlsx
// view=year (default): single-year line-item statement. view=all: one row per year.
reportsRouter.get(
  "/financial-summary",
  asyncHandler(async (req, res) => {
    const view = String(req.query.view ?? "year");
    if (view === "all") {
      const years = await financialSummaryAllYears();
      await send(
        res,
        req.query.format,
        {
          title: "Financial Summary",
          subtitle: "All",
          headers: ["Year", "Monthly Fee", "Admission Fee", "Contributions", "Expenses", "Salaries", "Net Balance"],
          rows: years.map((y) => [
            y.year,
            y.monthlyFee,
            y.admissionFee,
            y.contributions,
            y.expenses,
            y.salaries,
            y.netBalance,
          ]),
          currencyCols: [1, 2, 3, 4, 5, 6],
          totalsRow: true,
        },
        false,
        "Financial-Summary-All"
      );
      return;
    }
    const year = Number(req.query.year) || new Date().getFullYear();
    const { monthlyFee, admissionFee, contributions, expenses, salaries, netBalance } =
      await financialSummaryForYear(year);
    await send(
      res,
      req.query.format,
      {
        title: "Financial Summary",
        subtitle: String(year),
        headers: ["Line Item", "Amount"],
        rows: [
          ["Monthly Fee", monthlyFee],
          ["Admission Fee", admissionFee],
          ["Contributions", contributions],
          ["Expenses", expenses],
          ["Salaries", salaries],
          ["Net Balance", netBalance],
        ],
        // No totalsRow here: this is a line-item statement (Net Balance is
        // already a derived row), not a transaction list — auto-summing the
        // Amount column would double-count against Net Balance.
        currencyCols: [1],
      },
      false,
      `Financial-Summary-${year}`
    );
  })
);

function toProgressReportRow(p: {
  id: number;
  studentId: number;
  month: number;
  year: number;
  hoursStudied: number;
  topicsCovered: string;
  assessments: string;
  attendanceDays: number;
  moodEngagement: string;
  goals: string;
  notes: string;
  previousMonthComparison: string | null;
  progressPercent: number | null;
  assignmentsCompleted: string | null;
  softSkills: string | null;
  reminders: string | null;
  nextSteps: string | null;
  updatedAt: Date;
  student?: {
    admissionNo?: string;
    fullName?: string;
    class?: { name: string } | null;
    category?: { name: string } | null;
  } | null;
}): StudentProgressReportRow {
  return {
    id: p.id,
    studentId: p.studentId,
    admissionNo: p.student?.admissionNo ?? "-",
    fullName: p.student?.fullName ?? "-",
    className: p.student?.class?.name ?? null,
    categoryName: p.student?.category?.name ?? null,
    month: p.month,
    year: p.year,
    hoursStudied: p.hoursStudied,
    topicsCovered: p.topicsCovered,
    assessments: p.assessments,
    attendanceDays: p.attendanceDays,
    moodEngagement: p.moodEngagement,
    goals: p.goals,
    notes: p.notes,
    previousMonthComparison: p.previousMonthComparison,
    progressPercent: p.progressPercent,
    assignmentsCompleted: p.assignmentsCompleted,
    softSkills: p.softSkills,
    reminders: p.reminders,
    nextSteps: p.nextSteps,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function progressReportSubtitle(q: StudentProgressReportQuery): string {
  const parts = [
    q.month ? `${MONTH_NAMES[q.month - 1]} ${q.year}` : String(q.year),
    q.class_id ? `class ${q.class_id}` : null,
    q.category_id ? `category ${q.category_id}` : null,
  ].filter(Boolean);
  return parts.join(" — ");
}

function progressFilenameStem(q: StudentProgressReportQuery): string {
  const period = q.month
    ? `${MONTH_NAMES[q.month - 1] ?? q.month}-${q.year}`
    : String(q.year);
  return `Student-Progress-${period}`;
}

// GET /reports/student-progress/summary — JSON for on-screen Reports tab table.
// Registered before /student-progress so path matching is unambiguous.
reportsRouter.get(
  "/student-progress/summary",
  validateQuery(studentProgressReportQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as StudentProgressReportQuery;
    const { items, total } = await monthlyProgressRepository.list({
      year: q.year,
      month: q.month,
      classId: q.class_id,
      categoryId: q.category_id,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
      page: q.page,
      limit: q.limit,
    });
    res.json({
      data: {
        items: items.map(toProgressReportRow),
        total,
        page: q.page,
        limit: q.limit,
      },
    });
  })
);

// GET /reports/student-progress?year&month&class_id&category_id&format
// PDF uses a compact column set; XLSX includes the full progress field set.
reportsRouter.get(
  "/student-progress",
  validateQuery(studentProgressReportQuery),
  asyncHandler(async (req, res) => {
    const q = res.locals.query as StudentProgressReportQuery;
    const rows = await monthlyProgressRepository.findForReport({
      year: q.year,
      month: q.month,
      classId: q.class_id,
      categoryId: q.category_id,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    });
    const mapped = rows.map(toProgressReportRow);
    const wantXlsx = String(req.query.format).toLowerCase() === "xlsx";
    const subtitle = progressReportSubtitle(q);

    if (wantXlsx) {
      await send(
        res,
        "xlsx",
        {
          title: "Student Progress Report",
          subtitle,
          headers: [
            "Admission No.",
            "Student Name",
            "Class",
            "Category",
            "Month",
            "Year",
            "Hours Studied",
            "Topics / Portion",
            "Assessments",
            "Present Days",
            "Mood / Engagement",
            "Goals",
            "Notes",
            "Progress %",
            "Assignments",
            "Soft Skills",
            "Previous Month",
            "Reminders",
            "Next Steps",
          ],
          rows: mapped.map((r) => [
            r.admissionNo,
            r.fullName,
            r.className ?? "-",
            r.categoryName ?? "-",
            MONTH_NAMES[r.month - 1] ?? r.month,
            r.year,
            r.hoursStudied,
            r.topicsCovered,
            r.assessments,
            r.attendanceDays,
            r.moodEngagement.replace(/_/g, " "),
            r.goals,
            r.notes,
            r.progressPercent ?? "",
            r.assignmentsCompleted ?? "",
            r.softSkills ?? "",
            r.previousMonthComparison ?? "",
            r.reminders ?? "",
            r.nextSteps ?? "",
          ]),
        },
        false,
        progressFilenameStem(q)
      );
      return;
    }

    await send(
      res,
      req.query.format,
      {
        title: "Student Progress Report",
        subtitle,
        headers: [
          "Adm No.",
          "Student",
          "Class",
          "Category",
          "Month",
          "Hours",
          "Portion",
          "Present",
          "Mood",
          "Progress %",
        ],
        rows: mapped.map((r) => [
          r.admissionNo,
          r.fullName,
          r.className ?? "-",
          r.categoryName ?? "-",
          `${MONTH_ABBR[r.month - 1] ?? r.month} ${r.year}`,
          r.hoursStudied,
          r.topicsCovered,
          r.attendanceDays,
          r.moodEngagement.replace(/_/g, " "),
          r.progressPercent ?? "",
        ]),
        summaryLines: [["Total rows", String(mapped.length)]],
      },
      false,
      progressFilenameStem(q)
    );
  })
);
