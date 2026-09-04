import { Router } from "express";
import {
  studentRepository,
  attendanceRepository,
  feePaymentRepository,
  feeStructureRepository,
  contributionRepository,
} from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

// GET /dashboard — headline KPIs for the landing page.
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const trendWindows = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1, start, end };
    });

    const [totalStudents, todayAttendance, monthCollection, recentFees, ...trendPairs] =
      await Promise.all([
        studentRepository.count({ status: "active" }),
        attendanceRepository.findFiltered({ dateFilter: { gte: todayStart, lt: todayEnd } }),
        feePaymentRepository.sumAmountPaid({ paymentDate: { gte: monthStart, lt: monthEnd } }),
        feePaymentRepository.findRecentWithStudent(8),
        ...trendWindows.flatMap((w) => [
          feePaymentRepository.sumAmountPaid({ paymentDate: { gte: w.start, lt: w.end } }),
          contributionRepository.sumByDateWindow({ gte: w.start, lt: w.end }),
        ]),
      ]);

    const collectionTrend = trendWindows.map((w, i) => ({
      year: w.year,
      month: w.month,
      fees: asNumber(trendPairs[i * 2]),
      contributions: asNumber(trendPairs[i * 2 + 1]),
    }));

    const todayPresent = todayAttendance.filter((a) => a.status === "present").length;
    const todayLate = todayAttendance.filter((a) => a.status === "late").length;
    const todayAbsent = todayAttendance.filter((a) => a.status === "absent").length;
    const todayLeave = todayAttendance.filter((a) => a.status === "leave").length;

    const paidThisMonthSet = await feePaymentRepository.studentIdsPaidInDateRange("monthly", {
      gte: monthStart,
      lt: monthEnd,
    });
    const structures = await feeStructureRepository.findByType("monthly");
    const avgFee = structures.length
      ? structures.reduce((s, f) => s + f.amount, 0) / structures.length
      : 0;
    const unpaidCount = Math.max(0, totalStudents - paidThisMonthSet.size);

    res.json({
      data: {
        totalStudents,
        todayPresent,
        todayLate,
        todayAbsent,
        todayLeave,
        monthCollection,
        outstanding: Math.round(unpaidCount * avgFee),
        collectionTrend,
        recentActivity: recentFees.map((f) => ({
          id: f.id,
          type: "fee",
          description: `${f.student?.fullName ?? "Student"} paid ${f.amountPaid.toFixed(2)} (${f.receiptNo})`,
          date: new Date(f.createdAt).toISOString(),
        })),
      },
    });
  })
);
