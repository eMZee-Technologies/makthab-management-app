import { prisma } from "../client";
import { textContains } from "../textSearch";
import type { Prisma, Student } from "../types";

const withRelations = { class: true, category: true, academicYear: true } as const;

interface StudentListParams {
  class_id?: number;
  status?: string;
  q?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page: number;
  limit: number;
}

export const studentRepository = {
  findById(id: number) {
    return prisma.student.findUnique({ where: { id } });
  },

  findByIdWithRelations(id: number) {
    return prisma.student.findUnique({ where: { id }, include: withRelations });
  },

  findPhotoPath(id: number) {
    return prisma.student.findUnique({ where: { id }, select: { photoPath: true } });
  },

  findByAdmissionNo(admissionNo: string) {
    return prisma.student.findUnique({ where: { admissionNo } });
  },

  // Active students + class, for the defaulters computation (fees.ts, reports.ts).
  findActiveWithClass() {
    return prisma.student.findMany({ where: { status: "active" }, include: { class: true } });
  },

  async list(q: StudentListParams) {
    const where: Record<string, unknown> = {};
    if (q.class_id) where.classId = q.class_id;
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { fullName: textContains(q.q) },
        { admissionNo: textContains(q.q) },
        { fatherName: textContains(q.q) },
      ];
    }
    // "age" has no column of its own — it's derived client-side from
    // dateOfBirth — so sort by dateOfBirth with sortOrder flipped: the oldest
    // students have the EARLIEST dateOfBirth, so "age desc" (oldest first)
    // means dateOfBirth ascending, and vice versa. Students with no recorded
    // dateOfBirth (age unknown) always sort last, in either direction.
    const orderBy = q.sortBy
      ? q.sortBy === "class"
        ? { class: { name: q.sortOrder } }
        : q.sortBy === "age"
          ? { dateOfBirth: { sort: q.sortOrder === "asc" ? ("desc" as const) : ("asc" as const), nulls: "last" as const } }
          : { [q.sortBy]: q.sortOrder }
      : { admissionNo: "asc" as const };
    const [rows, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: {
          class: true,
          category: true,
          academicYear: true,
          feePayments: {
            where: { feeType: "admission" },
            orderBy: { paymentDate: "asc" },
            take: 1,
          },
        },
        orderBy: orderBy as Prisma.StudentOrderByWithRelationInput,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.student.count({ where }),
    ]);
    const items = rows.map(({ feePayments, ...student }) => ({
      ...student,
      admissionDate: feePayments[0]?.paymentDate ?? null,
    }));
    return { items, total };
  },

  create(data: Prisma.StudentUncheckedCreateInput) {
    return prisma.student.create({ data, include: withRelations });
  },

  update(id: number, data: Prisma.StudentUncheckedUpdateInput) {
    return prisma.student.update({ where: { id }, data, include: withRelations });
  },

  async softDelete(id: number): Promise<void> {
    await prisma.student.update({ where: { id }, data: { status: "inactive" } });
  },

  updatePhoto(id: number, photoPath: string) {
    return prisma.student.update({ where: { id }, data: { photoPath }, include: withRelations });
  },

  updateFeeOverride(id: number, amountDue: number) {
    return prisma.student.update({ where: { id }, data: { feeOverrideAmount: amountDue }, include: { class: true } });
  },

  countByClass(classId: number) {
    return prisma.student.count({ where: { classId } });
  },

  countByClassAndCategories(classId: number, categoryIds: number[]) {
    return prisma.student.count({ where: { classId, categoryId: { in: categoryIds } } });
  },

  countByCategory(categoryId: number) {
    return prisma.student.count({ where: { categoryId } });
  },

  count(where: Prisma.StudentWhereInput) {
    return prisma.student.count({ where });
  },
};

export type { Student };
