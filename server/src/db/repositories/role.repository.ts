import { prisma } from "../client";
import type { Prisma, Role } from "../types";

export const roleRepository = {
  findByName(name: string) {
    return prisma.role.findUnique({ where: { name } });
  },

  findById(id: number) {
    return prisma.role.findUnique({ where: { id } });
  },

  findAll() {
    return prisma.role.findMany({ orderBy: { name: "asc" } });
  },

  create(data: Prisma.RoleCreateInput) {
    return prisma.role.create({ data });
  },

  update(id: number, data: Prisma.RoleUpdateInput) {
    return prisma.role.update({ where: { id }, data });
  },

  async delete(id: number): Promise<void> {
    await prisma.role.delete({ where: { id } });
  },
};

export type { Role };
