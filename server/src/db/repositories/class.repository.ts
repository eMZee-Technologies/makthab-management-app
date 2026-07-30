import { prisma } from "../client";
import type { Prisma, Class } from "../types";

const classInclude = { teacher: true, categories: { orderBy: { name: "asc" as const } } };

export const classRepository = {
  findById(id: number) {
    return prisma.class.findUnique({ where: { id } });
  },

  findByIdWithCategories(id: number) {
    return prisma.class.findUnique({ where: { id }, include: { categories: true } });
  },

  findByName(name: string) {
    return prisma.class.findUnique({ where: { name } });
  },

  listWithRelations() {
    return prisma.class.findMany({ orderBy: { id: "asc" }, include: classInclude });
  },

  create(data: Prisma.ClassUncheckedCreateInput) {
    return prisma.class.create({ data, include: classInclude });
  },

  update(id: number, data: Prisma.ClassUncheckedUpdateInput) {
    return prisma.class.update({ where: { id }, data, include: classInclude });
  },

  async delete(id: number): Promise<void> {
    await prisma.class.delete({ where: { id } });
  },

  countOffering(categoryId: number) {
    return prisma.class.count({ where: { categories: { some: { id: categoryId } } } });
  },
};

export type { Class };
