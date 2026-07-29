import { prisma } from "../client";
import type { Prisma, Expense } from "../types";

export const expenseRepository = {
  findById(id: number) {
    return prisma.expense.findUnique({ where: { id } });
  },

  create(data: Prisma.ExpenseUncheckedCreateInput) {
    return prisma.expense.create({ data, include: { category: true } });
  },

  update(id: number, data: Prisma.ExpenseUncheckedUpdateInput) {
    return prisma.expense.update({ where: { id }, data, include: { category: true } });
  },

  async delete(id: number): Promise<void> {
    await prisma.expense.delete({ where: { id } });
  },

  async findAllVoucherNos(): Promise<string[]> {
    const rows = await prisma.expense.findMany({ select: { voucherNo: true } });
    return rows.map((r) => r.voucherNo);
  },

  async list(q: {
    category_id?: number;
    date_from?: string;
    date_to?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (q.category_id) where.categoryId = q.category_id;
    if (q.date_from || q.date_to) {
      where.expenseDate = {
        ...(q.date_from ? { gte: new Date(q.date_from) } : {}),
        ...(q.date_to ? { lte: new Date(q.date_to) } : {}),
      };
    }
    const orderBy = q.sortBy
      ? q.sortBy === "category"
        ? { category: { name: q.sortOrder } }
        : { [q.sortBy]: q.sortOrder }
      : { id: "desc" as const };
    const [items, total, agg] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: { category: true },
        orderBy: orderBy as Prisma.ExpenseOrderByWithRelationInput,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ _sum: { amount: true }, where }),
    ]);
    return { items, total, totalAmount: agg._sum.amount ?? 0 };
  },

  summaryByCategory(period?: number) {
    const where = period
      ? { expenseDate: { gte: new Date(period, 0, 1), lt: new Date(period + 1, 0, 1) } }
      : {};
    return prisma.expense.groupBy({
      by: ["categoryId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
  },

  async sumByDateWindow(window: { gte: Date; lt: Date }): Promise<number> {
    const agg = await prisma.expense.aggregate({ _sum: { amount: true }, where: { expenseDate: window } });
    return agg._sum.amount ?? 0;
  },

  findAllAmountsWithDate() {
    return prisma.expense.findMany({ select: { amount: true, expenseDate: true } });
  },

  findForReport(period?: number) {
    return prisma.expense.findMany({
      where: period ? { expenseDate: { gte: new Date(period, 0, 1), lt: new Date(period + 1, 0, 1) } } : {},
      include: { category: true },
      orderBy: { expenseDate: "asc" },
    });
  },
};

export type { Expense };
