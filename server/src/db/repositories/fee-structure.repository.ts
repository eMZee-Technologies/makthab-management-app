import { prisma } from "../client";
import type { Prisma, FeeStructure } from "../types";

export const feeStructureRepository = {
  findAll() {
    return prisma.feeStructure.findMany({
      include: { academicYear: true, category: true },
      orderBy: { id: "asc" },
    });
  },

  // Plain amounts only — dashboard's avg-monthly-fee calculation.
  findByType(feeType: string) {
    return prisma.feeStructure.findMany({ where: { feeType } });
  },

  // With academicYear — the defaulters pickAmount fallback logic needs
  // academicYear.startDate to pick the most recent matching structure.
  findByTypeWithYear(feeType: string) {
    return prisma.feeStructure.findMany({ where: { feeType }, include: { academicYear: true } });
  },

  // Prisma's generated compound-unique key type doesn't accept null for a
  // nullable field (categoryId), so upsert-by-compound-key isn't usable here
  // — look the row up as a plain filter (which does accept null) instead.
  findMatch(classId: number, categoryId: number | null, academicYearId: number, feeType: string) {
    return prisma.feeStructure.findFirst({ where: { classId, categoryId, academicYearId, feeType } });
  },

  findById(id: number) {
    return prisma.feeStructure.findUnique({ where: { id } });
  },

  create(data: Prisma.FeeStructureUncheckedCreateInput) {
    return prisma.feeStructure.create({ data });
  },

  updateAmount(id: number, amount: number) {
    return prisma.feeStructure.update({ where: { id }, data: { amount } });
  },

  async delete(id: number): Promise<void> {
    await prisma.feeStructure.delete({ where: { id } });
  },

  countByCategory(categoryId: number) {
    return prisma.feeStructure.count({ where: { categoryId } });
  },
};

export type { FeeStructure };
