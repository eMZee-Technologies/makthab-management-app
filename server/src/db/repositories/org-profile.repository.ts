import { prisma } from "../client";
import type { Prisma, OrgProfile } from "../types";

export const orgProfileRepository = {
  // The active profile is the institution letterhead. Falls back to the
  // lowest-id row if none is flagged active (e.g. a partially-migrated DB).
  async findActiveOrFirst(): Promise<OrgProfile | null> {
    return (
      (await prisma.orgProfile.findFirst({ where: { isActive: true } })) ??
      (await prisma.orgProfile.findFirst({ orderBy: { id: "asc" } }))
    );
  },

  findAll(orderBy: Prisma.OrgProfileOrderByWithRelationInput) {
    return prisma.orgProfile.findMany({ orderBy });
  },

  findById(id: number) {
    return prisma.orgProfile.findUnique({ where: { id } });
  },

  findImagePath(id: number) {
    return prisma.orgProfile.findUnique({ where: { id }, select: { headerImagePath: true } });
  },

  create(data: { name: string; address: string }) {
    return prisma.orgProfile.create({ data });
  },

  // Setting isActive:true unsets every other row's active flag in the same
  // transaction (single-active invariant). isActive:false is written as-is.
  updateWithActivation(
    id: number,
    dto: { name?: string; address?: string; isActive?: boolean }
  ) {
    return prisma.$transaction(async (tx) => {
      if (dto.isActive === true) {
        await tx.orgProfile.updateMany({ where: { id: { not: id } }, data: { isActive: false } });
      }
      return tx.orgProfile.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    });
  },

  updateImage(id: number, headerImagePath: string) {
    return prisma.orgProfile.update({ where: { id }, data: { headerImagePath } });
  },

  async delete(id: number): Promise<void> {
    await prisma.orgProfile.delete({ where: { id } });
  },
};

export type { OrgProfile };
