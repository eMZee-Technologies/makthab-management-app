import { z } from "zod";

// GET /reports/fee-collection/summary query params.
// view='year' aggregates a single year's monthly-fee payments by month;
// view='all' aggregates monthly-fee payments by year. `year` is required
// when view==='year' (enforced by the refine below).
export const feeCollectionSummaryQuery = z
  .object({
    view: z.enum(["year", "all"]),
    year: z.coerce.number().int().optional(),
  })
  .refine((v) => v.view !== "year" || v.year !== undefined, {
    message: "year is required when view is 'year'",
    path: ["year"],
  });
export type FeeCollectionSummaryQuery = z.infer<typeof feeCollectionSummaryQuery>;

// One month's monthly-fee total within a year.
export interface MonthlyFeeBreakdownRow {
  month: number;
  totalPaid: number;
  count: number;
}

// One year's monthly-fee total across all years.
export interface YearlyFeeBreakdownRow {
  year: number;
  totalPaid: number;
  count: number;
}

export interface FeeCollectionYearSummary {
  view: "year";
  year: number;
  months: MonthlyFeeBreakdownRow[];
  totalPaid: number;
}

export interface FeeCollectionAllSummary {
  view: "all";
  years: YearlyFeeBreakdownRow[];
  totalPaid: number;
}

export type FeeCollectionSummary = FeeCollectionYearSummary | FeeCollectionAllSummary;

// GET /reports/salary-register/summary query params — mirrors
// feeCollectionSummaryQuery. view='year' aggregates a single year's salary
// payments by month; view='all' aggregates by year. `year` required for 'year'.
export const salaryRegisterSummaryQuery = z
  .object({
    view: z.enum(["year", "all"]),
    year: z.coerce.number().int().optional(),
  })
  .refine((v) => v.view !== "year" || v.year !== undefined, {
    message: "year is required when view is 'year'",
    path: ["year"],
  });
export type SalaryRegisterSummaryQuery = z.infer<typeof salaryRegisterSummaryQuery>;

// One month's net-salary total within a year.
export interface MonthlySalaryBreakdownRow {
  month: number;
  totalNet: number;
  count: number;
}

// One year's net-salary total across all years.
export interface YearlySalaryBreakdownRow {
  year: number;
  totalNet: number;
  count: number;
}

export interface SalaryRegisterYearSummary {
  view: "year";
  year: number;
  months: MonthlySalaryBreakdownRow[];
  totalNet: number;
}

export interface SalaryRegisterAllSummary {
  view: "all";
  years: YearlySalaryBreakdownRow[];
  totalNet: number;
}

export type SalaryRegisterSummary = SalaryRegisterYearSummary | SalaryRegisterAllSummary;

// GET /reports/financial-summary(/summary) query params. view='year' summarizes
// a single year (monthly fee, admission fee, expenses, salaries, net balance);
// view='all' returns one row per year plus totals. `year` required for 'year'.
export const financialSummaryQuery = z
  .object({
    view: z.enum(["year", "all"]),
    year: z.coerce.number().int().optional(),
  })
  .refine((v) => v.view !== "year" || v.year !== undefined, {
    message: "year is required when view is 'year'",
    path: ["year"],
  });
export type FinancialSummaryQuery = z.infer<typeof financialSummaryQuery>;

export interface FinancialSummaryYearData {
  monthlyFee: number;
  admissionFee: number;
  contributions: number;
  expenses: number;
  salaries: number;
  netBalance: number;
}
export interface FinancialSummaryYearSummary extends FinancialSummaryYearData {
  view: "year";
  year: number;
}
export interface FinancialSummaryYearRow extends FinancialSummaryYearData {
  year: number;
}
export interface FinancialSummaryAllSummary {
  view: "all";
  years: FinancialSummaryYearRow[];
  totals: FinancialSummaryYearData;
}
export type FinancialSummary = FinancialSummaryYearSummary | FinancialSummaryAllSummary;

// GET /reports/student-progress(/summary) — monthly talimi progress rows.
// year is required; month/class_id/category_id optional. When month is omitted
// the summary/export includes every month in that year (one row per student×month).
export const studentProgressReportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  class_id: z.coerce.number().int().positive().optional(),
  category_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: z
    .enum([
      "admissionNo",
      "fullName",
      "month",
      "hoursStudied",
      "attendanceDays",
      "progressPercent",
      "updatedAt",
    ])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
export type StudentProgressReportQuery = z.infer<typeof studentProgressReportQuery>;

export type StudentProgressReportRow = {
  id: number;
  studentId: number;
  admissionNo: string;
  fullName: string;
  className: string | null;
  categoryName: string | null;
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
  updatedAt: string;
};
