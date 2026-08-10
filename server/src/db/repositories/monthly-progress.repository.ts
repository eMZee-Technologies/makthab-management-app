import { prisma } from "../client";
import type { Prisma, MonthlyProgress } from "../types";

export type ProgressAttachmentMeta = {
  key: string;
  filename: string;
  mime: string;
  size: number;
  uploadedAt: string;
};

export type ProgressLinkMeta = { url: string; label?: string };

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function serializeLinks(links: ProgressLinkMeta[] | null | undefined): string | null {
  if (!links || links.length === 0) return null;
  return JSON.stringify(links);
}

export function serializeAttachments(
  attachments: ProgressAttachmentMeta[] | null | undefined
): string | null {
  if (!attachments || attachments.length === 0) return null;
  return JSON.stringify(attachments);
}

export function parseLinks(raw: string | null | undefined): ProgressLinkMeta[] {
  return parseJsonArray<ProgressLinkMeta>(raw);
}

export function parseAttachments(raw: string | null | undefined): ProgressAttachmentMeta[] {
  return parseJsonArray<ProgressAttachmentMeta>(raw);
}

const studentInclude = {
  student: { include: { class: true, category: true } },
  editedBy: { select: { id: true, fullName: true, role: true } },
} as const;

function buildListWhere(q: {
  studentId?: number;
  classId?: number;
  categoryId?: number;
  month?: number;
  year?: number;
  q?: string;
}): Prisma.MonthlyProgressWhereInput {
  const studentFilter: Prisma.StudentWhereInput = {
    ...(q.classId ? { classId: q.classId } : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.q
      ? {
          OR: [{ fullName: { contains: q.q } }, { admissionNo: { contains: q.q } }],
        }
      : {}),
  };
  const hasStudentFilter = Boolean(q.classId || q.categoryId || q.q);
  return {
    ...(q.studentId ? { studentId: q.studentId } : {}),
    ...(q.month ? { month: q.month } : {}),
    ...(q.year ? { year: q.year } : {}),
    ...(hasStudentFilter ? { student: studentFilter } : {}),
  };
}

function buildOrderBy(
  sortBy?: string,
  sortOrder: "asc" | "desc" = "asc"
): Prisma.MonthlyProgressOrderByWithRelationInput | Prisma.MonthlyProgressOrderByWithRelationInput[] {
  if (sortBy === "fullName") return { student: { fullName: sortOrder } };
  if (sortBy === "admissionNo") return { student: { admissionNo: sortOrder } };
  if (sortBy) {
    return { [sortBy]: sortOrder } as Prisma.MonthlyProgressOrderByWithRelationInput;
  }
  return [{ year: "asc" }, { month: "asc" }, { student: { fullName: "asc" } }];
}

export const monthlyProgressRepository = {
  findById(id: number) {
    return prisma.monthlyProgress.findUnique({
      where: { id },
      include: studentInclude,
    });
  },

  findByStudentMonthYear(studentId: number, month: number, year: number) {
    return prisma.monthlyProgress.findUnique({
      where: { studentId_month_year: { studentId, month, year } },
      include: studentInclude,
    });
  },

  create(data: Prisma.MonthlyProgressUncheckedCreateInput) {
    return prisma.monthlyProgress.create({ data, include: studentInclude });
  },

  update(id: number, data: Prisma.MonthlyProgressUncheckedUpdateInput) {
    return prisma.monthlyProgress.update({
      where: { id },
      data,
      include: studentInclude,
    });
  },

  async delete(id: number): Promise<MonthlyProgress> {
    return prisma.monthlyProgress.delete({ where: { id } });
  },

  markWhatsappSent(id: number) {
    return prisma.monthlyProgress.update({
      where: { id },
      data: { whatsappSent: true },
      include: studentInclude,
    });
  },

  async list(q: {
    studentId?: number;
    classId?: number;
    categoryId?: number;
    month?: number;
    year?: number;
    q?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const where = buildListWhere(q);
    const orderBy = buildOrderBy(q.sortBy, q.sortOrder ?? "asc");

    const [items, total] = await Promise.all([
      prisma.monthlyProgress.findMany({
        where,
        include: studentInclude,
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.monthlyProgress.count({ where }),
    ]);
    return { items, total };
  },

  /** Unpaginated list for PDF/XLSX exports (cap at 5000). */
  async findForReport(q: {
    classId?: number;
    categoryId?: number;
    month?: number;
    year?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) {
    return prisma.monthlyProgress.findMany({
      where: buildListWhere(q),
      include: studentInclude,
      orderBy: buildOrderBy(q.sortBy, q.sortOrder ?? "asc"),
      take: 5000,
    });
  },

  /** Active students for a board period, left-joined with that month's progress. */
  async board(q: {
    month: number;
    year: number;
    classId?: number;
    search?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const studentWhere: Prisma.StudentWhereInput = {
      status: "active",
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.search
        ? {
            OR: [
              { fullName: { contains: q.search } },
              { admissionNo: { contains: q.search } },
            ],
          }
        : {}),
    };

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where: studentWhere,
        include: { class: true, category: true },
        orderBy: { fullName: q.sortOrder ?? "asc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.student.count({ where: studentWhere }),
    ]);

    const ids = students.map((s) => s.id);
    const progressRows =
      ids.length === 0
        ? []
        : await prisma.monthlyProgress.findMany({
            where: { studentId: { in: ids }, month: q.month, year: q.year },
            include: studentInclude,
          });
    const byStudent = new Map(progressRows.map((p) => [p.studentId, p]));

    return {
      items: students.map((student) => ({
        student,
        progress: byStudent.get(student.id) ?? null,
      })),
      total,
    };
  },
};

export type { MonthlyProgress };
