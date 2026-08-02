import { prisma } from "../client";

export const approvalAuditRepository = {
  create(data: {
    userId: number;
    actorId: number;
    action: "approved" | "rejected";
    reason?: string | null;
    previousStatus: string;
    newStatus: string;
    roleAssigned?: string | null;
  }) {
    return prisma.userApprovalAudit.create({ data });
  },

  listForUser(userId: number) {
    return prisma.userApprovalAudit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  },
};

export const adminNotificationRepository = {
  createMany(
    rows: Array<{
      userId: number;
      type: string;
      title: string;
      body: string;
      metaJson?: string | null;
    }>
  ) {
    return prisma.adminNotification.createMany({ data: rows });
  },

  listForUser(userId: number, opts?: { unreadOnly?: boolean; limit?: number }) {
    return prisma.adminNotification.findMany({
      where: {
        userId,
        ...(opts?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts?.limit ?? 50,
    });
  },

  markRead(id: number, userId: number) {
    return prisma.adminNotification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  },
};
