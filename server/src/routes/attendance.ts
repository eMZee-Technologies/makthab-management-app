import { Router } from "express";
import {
  attendanceBulkSchema,
  attendanceUpdateSchema,
  attendanceListQuery,
  type AttendanceListQuery,
} from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { actorStaffId } from "../lib/actor";

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth, requirePermission("attendance.mark"));

// Build a Prisma date-range filter for a month/year or a single date.
function dateFilter(q: AttendanceListQuery): Record<string, unknown> | undefined {
  if (q.date) {
    const d = new Date(q.date);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    return { gte: d, lt: next };
  }
  if (q.month && q.year) {
    return { gte: new Date(q.year, q.month - 1, 1), lt: new Date(q.year, q.month, 1) };
  }
  if (q.year) {
    return { gte: new Date(q.year, 0, 1), lt: new Date(q.year + 1, 0, 1) };
  }
  return undefined;
}

// POST /attendance — single record or a bulk array; upsert on (studentId, date).
attendanceRouter.post(
  "/",
  validateBody(attendanceBulkSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as typeof attendanceBulkSchema._output;
    const records = Array.isArray(body) ? body : [body];
    const markedById = actorStaffId(req);
    const saved = await Promise.all(
      records.map((r) =>
        prisma.attendance.upsert({
          where: { studentId_date: { studentId: r.studentId, date: r.date } },
          update: { status: r.status, notes: r.notes ?? null, markedById },
          create: {
            studentId: r.studentId,
            date: r.date,
            status: r.status,
            notes: r.notes ?? null,
            markedById,
          },
        })
      )
    );
    res.status(201).json({ data: Array.isArray(body) ? saved : saved[0] });
  })
);

// GET /attendance/summary — per-student present/absent totals + percentage.
attendanceRouter.get(
  "/summary",
  validateQuery(attendanceListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as AttendanceListQuery;
    const df = dateFilter(q);
    const rows = await prisma.attendance.findMany({
      where: {
        ...(df ? { date: df } : {}),
        ...(q.student_id ? { studentId: q.student_id } : {}),
        ...(q.class_id ? { student: { classId: q.class_id } } : {}),
      },
      include: { student: true },
    });
    const byStudent = new Map<number, { fullName: string; present: number; absent: number; total: number }>();
    for (const r of rows) {
      const cur = byStudent.get(r.studentId) ?? {
        fullName: r.student?.fullName ?? "",
        present: 0,
        absent: 0,
        total: 0,
      };
      cur.total += 1;
      if (r.status === "present" || r.status === "late") cur.present += 1;
      if (r.status === "absent") cur.absent += 1;
      byStudent.set(r.studentId, cur);
    }
    const summary = [...byStudent.entries()].map(([studentId, v]) => ({
      studentId,
      fullName: v.fullName,
      totalDays: v.total,
      present: v.present,
      absent: v.absent,
      percentage: v.total ? Math.round((v.present / v.total) * 100) : 0,
    }));

    const sortBy = q.sortBy ?? "fullName";
    const dir = q.sortOrder === "desc" ? -1 : 1;
    summary.sort((a, b) => {
      if (sortBy === "fullName") return a.fullName.localeCompare(b.fullName) * dir;
      return (a[sortBy] - b[sortBy]) * dir;
    });

    const total = summary.length;
    const items = summary.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);
    res.json({ data: { items, total, page: q.page, limit: q.limit } });
  })
);

// GET /attendance/low-alert — students below an attendance threshold (default 75%).
attendanceRouter.get(
  "/low-alert",
  asyncHandler(async (req, res) => {
    const threshold = Number(req.query.threshold ?? 75);
    const rows = await prisma.attendance.findMany({ include: { student: true } });
    const byStudent = new Map<number, { fullName: string; present: number; total: number }>();
    for (const r of rows) {
      const cur = byStudent.get(r.studentId) ?? { fullName: r.student?.fullName ?? "", present: 0, total: 0 };
      cur.total += 1;
      if (r.status === "present" || r.status === "late") cur.present += 1;
      byStudent.set(r.studentId, cur);
    }
    const low = [...byStudent.entries()]
      .map(([studentId, v]) => ({
        studentId,
        fullName: v.fullName,
        percentage: v.total ? Math.round((v.present / v.total) * 100) : 0,
      }))
      .filter((s) => s.percentage < threshold);
    res.json({ data: low });
  })
);

// GET /attendance — records filtered by student/class/date/month/year.
attendanceRouter.get(
  "/",
  validateQuery(attendanceListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as AttendanceListQuery;
    const df = dateFilter(q);
    const rows = await prisma.attendance.findMany({
      where: {
        ...(df ? { date: df } : {}),
        ...(q.student_id ? { studentId: q.student_id } : {}),
        ...(q.class_id ? { student: { classId: q.class_id } } : {}),
      },
      include: { student: true },
      orderBy: { date: "desc" },
    });
    res.json({ data: rows });
  })
);

// PATCH /attendance/:id — correct a record.
attendanceRouter.patch(
  "/:id",
  validateBody(attendanceUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const exists = await prisma.attendance.findUnique({ where: { id } });
    if (!exists) throw new AppError(404, "not_found", "Attendance record not found");
    const updated = await prisma.attendance.update({ where: { id }, data: req.body });
    res.json({ data: updated });
  })
);
