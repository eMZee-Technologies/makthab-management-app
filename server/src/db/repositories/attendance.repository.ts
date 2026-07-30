import { prisma } from "../client";
import type { Prisma, Attendance } from "../types";

interface AttendanceUpsertInput {
  studentId: number;
  date: Date;
  status: string;
  notes?: string | null;
}

interface AttendanceFilter {
  dateFilter?: { gte: Date; lt: Date };
  studentId?: number;
  classId?: number;
  categoryId?: number;
  orderByDateDesc?: boolean;
}

function buildWhere(f: AttendanceFilter): Prisma.AttendanceWhereInput {
  return {
    ...(f.dateFilter ? { date: f.dateFilter } : {}),
    ...(f.studentId ? { studentId: f.studentId } : {}),
    ...(f.classId || f.categoryId
      ? {
          student: {
            ...(f.classId ? { classId: f.classId } : {}),
            ...(f.categoryId ? { categoryId: f.categoryId } : {}),
          },
        }
      : {}),
  };
}

export const attendanceRepository = {
  findById(id: number) {
    return prisma.attendance.findUnique({ where: { id } });
  },

  bulkUpsert(records: AttendanceUpsertInput[], markedById: number) {
    return Promise.all(
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
  },

  // Covers /summary, /low-alert (no filters at all -> empty where, matching
  // today's unfiltered `findMany`), the plain list GET /, and reports.ts's
  // attendance report — all share the same where-shape + student include.
  findFiltered(f: AttendanceFilter) {
    return prisma.attendance.findMany({
      where: buildWhere(f),
      include: { student: true },
      ...(f.orderByDateDesc ? { orderBy: { date: "desc" as const } } : {}),
    });
  },

  async countsByStatus(studentId: number) {
    return prisma.attendance.groupBy({
      by: ["status"],
      where: { studentId },
      _count: { _all: true },
    });
  },

  update(id: number, data: Prisma.AttendanceUpdateInput) {
    return prisma.attendance.update({ where: { id }, data });
  },
};

export type { Attendance };
