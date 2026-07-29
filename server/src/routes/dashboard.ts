import { Router } from "express";
import { studentRepository, attendanceRepository, feePaymentRepository, feeStructureRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";

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

    const [totalStudents, todayAttendance, monthCollection, recentFees] = await Promise.all([
      studentRepository.count({ status: "active" }),
      attendanceRepository.findFiltered({ dateFilter: { gte: todayStart, lt: todayEnd } }),
      feePaymentRepository.sumAmountPaid({ paymentDate: { gte: monthStart, lt: monthEnd } }),
      feePaymentRepository.findRecentWithStudent(8),
    ]);

    const todayPresent = todayAttendance.filter((a) => a.status === "present" || a.status === "late").length;
    const todayAbsent = todayAttendance.filter((a) => a.status === "absent").length;

    // Outstanding = active students without a payment this month × avg monthly fee.
    const paidThisMonthSet = await feePaymentRepository.studentIdsPaidInDateRange("monthly", { gte: monthStart, lt: monthEnd });
    const structures = await feeStructureRepository.findByType("monthly");
    const avgFee = structures.length
      ? structures.reduce((s, f) => s + f.amount, 0) / structures.length
      : 0;
    const unpaidCount = Math.max(0, totalStudents - paidThisMonthSet.size);

    res.json({
      data: {
        totalStudents,
        todayPresent,
        todayAbsent,
        monthCollection,
        outstanding: Math.round(unpaidCount * avgFee),
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
