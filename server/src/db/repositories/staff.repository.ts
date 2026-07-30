import { prisma } from "../client";
import type { Prisma, Staff } from "../types";

export const staffRepository = {
  findById(id: number) {
    return prisma.staff.findUnique({ where: { id } });
  },

  findPhotoPath(id: number) {
    return prisma.staff.findUnique({ where: { id }, select: { photoPath: true } });
  },

  findSignaturePath(id: number) {
    return prisma.staff.findUnique({ where: { id }, select: { signaturePath: true } });
  },

  async list(q: { sortBy?: string; sortOrder?: "asc" | "desc"; page: number; limit: number }) {
    const orderBy = q.sortBy ? { [q.sortBy]: q.sortOrder } : { fullName: "asc" as const };
    const [items, total] = await Promise.all([
      prisma.staff.findMany({
        orderBy: orderBy as Prisma.StaffOrderByWithRelationInput,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.staff.count(),
    ]);
    return { items, total };
  },

  create(data: Prisma.StaffCreateInput) {
    return prisma.staff.create({ data });
  },

  update(id: number, data: Prisma.StaffUpdateInput) {
    return prisma.staff.update({ where: { id }, data });
  },

  async softDelete(id: number): Promise<void> {
    await prisma.staff.update({ where: { id }, data: { status: "inactive" } });
  },

  updatePhoto(id: number, photoPath: string) {
    return prisma.staff.update({ where: { id }, data: { photoPath } });
  },

  updateSignature(id: number, signaturePath: string) {
    return prisma.staff.update({ where: { id }, data: { signaturePath } });
  },
};

export type { Staff };
