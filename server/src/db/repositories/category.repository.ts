import { prisma } from "../client";
import type { Prisma, Category } from "../types";

export const categoryRepository = {
  findById(id: number) {
    return prisma.category.findUnique({ where: { id } });
  },

  findAll() {
    return prisma.category.findMany({ orderBy: { name: "asc" } });
  },

  create(data: Prisma.CategoryCreateInput) {
    return prisma.category.create({ data });
  },

  update(id: number, data: Prisma.CategoryUpdateInput) {
    return prisma.category.update({ where: { id }, data });
  },

  async delete(id: number): Promise<void> {
    await prisma.category.delete({ where: { id } });
  },
};

export type { Category };
