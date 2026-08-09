import { prisma } from "../client";
import type { Prisma, Contribution } from "../types";

export const contributionRepository = {
  findById(id: number) {
    return prisma.contribution.findUnique({
      where: { id },
      include: { recordedBy: true },
    });
  },

  create(data: Prisma.ContributionUncheckedCreateInput) {
    return prisma.contribution.create({ data, include: { recordedBy: true } });
  },

  update(id: number, data: Prisma.ContributionUncheckedUpdateInput) {
    return prisma.contribution.update({
      where: { id },
      data,
      include: { recordedBy: true },
    });
  },

  setPdfPath(id: number, pdfPath: string) {
    return prisma.contribution.update({
      where: { id },
      data: { pdfPath },
      include: { recordedBy: true },
    });
  },

  markWhatsappSent(id: number) {
    return prisma.contribution.update({
      where: { id },
      data: { whatsappSent: true },
    });
  },

  async delete(id: number): Promise<void> {
    await prisma.contribution.delete({ where: { id } });
  },

  async findReceiptNosStartingWith(prefix: string): Promise<string[]> {
    const rows = await prisma.contribution.findMany({
      where: { receiptNo: { startsWith: prefix } },
      select: { receiptNo: true },
    });
    return rows.map((r) => r.receiptNo);
  },

  async list(q: {
    year?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const where: Prisma.ContributionWhereInput = {};
    if (q.year !== undefined) {
      where.date = {
        gte: new Date(q.year, 0, 1),
        lt: new Date(q.year + 1, 0, 1),
      };
    }
    const orderBy = q.sortBy
      ? { [q.sortBy]: q.sortOrder }
      : { id: "desc" as const };
    const [items, total, agg] = await Promise.all([
      prisma.contribution.findMany({
        where,
        include: { recordedBy: true },
        orderBy: orderBy as Prisma.ContributionOrderByWithRelationInput,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.contribution.count({ where }),
      prisma.contribution.aggregate({ _sum: { amount: true }, where }),
    ]);
    return { items, total, totalAmount: agg._sum.amount ?? 0 };
  },
};

export type { Contribution };
