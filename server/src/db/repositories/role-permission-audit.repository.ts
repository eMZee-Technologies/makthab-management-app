import { prisma } from "../client";
import type { Prisma, RolePermissionAudit } from "../types";

export const rolePermissionAuditRepository = {
  create(data: Prisma.RolePermissionAuditUncheckedCreateInput) {
    return prisma.rolePermissionAudit.create({ data });
  },

  listForRole(roleId: number, take = 50) {
    return prisma.rolePermissionAudit.findMany({
      where: { roleId },
      orderBy: { createdAt: "desc" },
      take,
    });
  },
};

export type { RolePermissionAudit };
