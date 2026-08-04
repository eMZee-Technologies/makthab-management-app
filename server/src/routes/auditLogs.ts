import { Router } from "express";
import {
  auditLogListQuery,
  type AuditLogListQuery,
} from "@makthab/shared";
import { auditLogRepository } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateQuery } from "../middleware/validate";
import { requireAuth, requireResourcePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import {
  recordAuditFromRequest,
  retentionCutoff,
  verifyAuditIntegrity,
} from "../lib/audit/auditLog";
import { env } from "../lib/env";

function serializeLog(row: {
  id: string;
  timestamp: Date;
  userId: number | null;
  action: string;
  entity: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  outcome: string;
  additionalDetails: string | null;
  contentHash: string;
  prevHash: string | null;
  user?: { username: string } | null;
}) {
  let details: unknown = null;
  if (row.additionalDetails) {
    try {
      details = JSON.parse(row.additionalDetails);
    } catch {
      details = row.additionalDetails;
    }
  }
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    userId: row.userId,
    username: row.user?.username ?? null,
    action: row.action,
    entity: row.entity,
    resourceId: row.resourceId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    outcome: row.outcome,
    additionalDetails: details,
    contentHash: row.contentHash,
    prevHash: row.prevHash,
  };
}

export const auditLogsRouter = Router();

// Admin-only: viewing audit logs is an admin utility (admin.view).
auditLogsRouter.use(requireAuth, requireResourcePermission("admin", "view"));

/**
 * GET /admin/audit-logs
 * Filtered, sorted, paginated audit trail for the admin dashboard.
 */
auditLogsRouter.get(
  "/",
  validateQuery(auditLogListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as AuditLogListQuery;
    const { items, total } = await auditLogRepository.list({
      from: q.from,
      to: q.to,
      userId: q.userId,
      action: q.action,
      entity: q.entity,
      outcome: q.outcome,
      resourceId: q.resourceId,
      page: q.page,
      limit: q.limit,
      sortBy: q.sortBy,
      sortOrder: q.sortOrder,
    });
    res.json({
      data: {
        items: items.map(serializeLog),
        total,
        page: q.page,
        limit: q.limit,
      },
    });
  })
);

/**
 * GET /admin/audit-logs/integrity
 * Verify the tamper-evident hash chain (admin.view).
 */
auditLogsRouter.get(
  "/integrity",
  asyncHandler(async (_req, res) => {
    const result = await verifyAuditIntegrity();
    res.json({ data: result });
  })
);

/**
 * POST /admin/audit-logs/purge
 * Manually run retention purge (admin.create — same bar as backup).
 */
auditLogsRouter.post(
  "/purge",
  requireResourcePermission("admin", "create"),
  asyncHandler(async (req, res) => {
    await recordAuditFromRequest(req, {
      action: "purge",
      entity: "audit",
      outcome: "success",
      additionalDetails: {
        source: "manual",
        retentionMonths: env.auditLogRetentionMonths,
      },
    });
    const olderThan = retentionCutoff();
    const deleted = await auditLogRepository.deleteOlderThan(olderThan);
    res.json({
      data: {
        deleted,
        olderThan: olderThan.toISOString(),
        retentionMonths: env.auditLogRetentionMonths,
      },
    });
  })
);

/**
 * GET /admin/audit-logs/:id
 * Single entry detail.
 */
auditLogsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = await auditLogRepository.findById(req.params.id);
    if (!row) throw new AppError(404, "not_found", "Audit log entry not found");
    res.json({ data: serializeLog(row) });
  })
);
