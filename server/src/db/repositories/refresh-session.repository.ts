import { prisma } from "../client";
import type { Prisma, RefreshSession } from "../types";

export type { RefreshSession };

export const refreshSessionRepository = {
  create(data: Prisma.RefreshSessionUncheckedCreateInput) {
    return prisma.refreshSession.create({ data });
  },

  findById(id: string) {
    return prisma.refreshSession.findUnique({ where: { id } });
  },

  /** Active = not revoked and not past expiresAt. */
  async findActiveById(id: string) {
    const row = await prisma.refreshSession.findUnique({ where: { id } });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  },

  revokeById(id: string, at: Date = new Date()) {
    return prisma.refreshSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  },

  revokeAllForUser(userId: number, at: Date = new Date()) {
    return prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  },

  /** Best-effort cleanup of expired rows (optional maintenance). */
  deleteExpired(before: Date = new Date()) {
    return prisma.refreshSession.deleteMany({
      where: { expiresAt: { lt: before } },
    });
  },
};
