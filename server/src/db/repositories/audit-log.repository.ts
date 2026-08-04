import { prisma } from "../client";
import type { Prisma, AuditLog } from "../types";

export type AuditLogListFilters = {
  from?: Date;
  to?: Date;
  userId?: number;
  action?: string;
  entity?: string;
  outcome?: string;
  resourceId?: string;
  page: number;
  limit: number;
  sortBy: "timestamp" | "action" | "entity" | "outcome" | "userId";
  sortOrder: "asc" | "desc";
};

function buildWhere(filters: Omit<AuditLogListFilters, "page" | "limit" | "sortBy" | "sortOrder">): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.from || filters.to) {
    where.timestamp = {};
    if (filters.from) where.timestamp.gte = filters.from;
    if (filters.to) where.timestamp.lte = filters.to;
  }
  if (filters.userId !== undefined) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.entity) where.entity = filters.entity;
  if (filters.outcome) where.outcome = filters.outcome;
  if (filters.resourceId) where.resourceId = filters.resourceId;
  return where;
}

export const auditLogRepository = {
  create(data: Prisma.AuditLogUncheckedCreateInput) {
    return prisma.auditLog.create({ data });
  },

  findById(id: string) {
    return prisma.auditLog.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, role: true } } },
    });
  },

  findLatest() {
    return prisma.auditLog.findFirst({
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    });
  },

  /** Oldest-first for integrity chain walk. */
  listChronological(take: number) {
    return prisma.auditLog.findMany({
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take,
    });
  },

  async list(filters: AuditLogListFilters) {
    const where = buildWhere(filters);
    const skip = (filters.page - 1) * filters.limit;
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { [filters.sortBy]: filters.sortOrder },
        skip,
        take: filters.limit,
        include: { user: { select: { id: true, username: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  },

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await prisma.auditLog.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    return result.count;
  },

  countSince(since: Date) {
    return prisma.auditLog.count({ where: { timestamp: { gte: since } } });
  },
};

export type { AuditLog };
