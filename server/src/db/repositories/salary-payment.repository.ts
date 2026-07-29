import { prisma } from "../client";
import type { Prisma, SalaryPayment } from "../types";

export const salaryPaymentRepository = {
  findById(id: number) {
    return prisma.salaryPayment.findUnique({ where: { id } });
  },

  findDuplicate(staffId: number, salaryMonth: number, salaryYear: number) {
    return prisma.salaryPayment.findUnique({
      where: { staffId_salaryMonth_salaryYear: { staffId, salaryMonth, salaryYear } },
    });
  },

  async list(q: {
    month?: number;
    year?: number;
    staff_id?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (q.month) where.salaryMonth = q.month;
    if (q.year) where.salaryYear = q.year;
    if (q.staff_id) where.staffId = q.staff_id;
    const orderBy = q.sortBy
      ? q.sortBy === "staff"
        ? { staff: { fullName: q.sortOrder } }
        : { [q.sortBy]: q.sortOrder }
      : { id: "desc" as const };
    const [items, total, agg] = await Promise.all([
      prisma.salaryPayment.findMany({
        where,
        include: { staff: true },
        orderBy: orderBy as Prisma.SalaryPaymentOrderByWithRelationInput,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.salaryPayment.count({ where }),
      prisma.salaryPayment.aggregate({ _sum: { netAmount: true }, where }),
    ]);
    return { items, total, totalNet: agg._sum.netAmount ?? 0 };
  },

  create(data: Prisma.SalaryPaymentUncheckedCreateInput) {
    return prisma.salaryPayment.create({ data, include: { staff: true } });
  },

  update(id: number, data: Prisma.SalaryPaymentUncheckedUpdateInput) {
    return prisma.salaryPayment.update({ where: { id }, data, include: { staff: true } });
  },

  async delete(id: number): Promise<void> {
    await prisma.salaryPayment.delete({ where: { id } });
  },

  findForReport(salaryMonth: number, salaryYear: number) {
    return prisma.salaryPayment.findMany({
      where: { salaryMonth, salaryYear },
      include: { staff: true },
      orderBy: { id: "asc" },
    });
  },

  async groupByMonth(salaryYear: number) {
    return prisma.salaryPayment.groupBy({
      by: ["salaryMonth"],
      where: { salaryYear },
      _sum: { netAmount: true },
      _count: { _all: true },
    });
  },

  async groupByYear() {
    return prisma.salaryPayment.groupBy({
      by: ["salaryYear"],
      _sum: { netAmount: true },
      _count: { _all: true },
    });
  },

  async sumByYear(salaryYear: number): Promise<number> {
    const agg = await prisma.salaryPayment.aggregate({ _sum: { netAmount: true }, where: { salaryYear } });
    return agg._sum.netAmount ?? 0;
  },
};

export type { SalaryPayment };
