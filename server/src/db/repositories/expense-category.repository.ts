import { prisma } from "../client";
import type { ExpenseCategory } from "../types";

export const expenseCategoryRepository = {
  findAll() {
    return prisma.expenseCategory.findMany();
  },

  findAllSortedByName() {
    return prisma.expenseCategory.findMany({ orderBy: { name: "asc" } });
  },
};

export type { ExpenseCategory };
