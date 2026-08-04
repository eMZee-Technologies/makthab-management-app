import { z } from "zod";
import { paginationQuery, sortOrderSchema } from "./common";

/** High-level audit actions recorded by the server. */
export const AUDIT_ACTIONS = [
  "login",
  "logout",
  "refresh",
  "create",
  "read",
  "update",
  "delete",
  "backup",
  "purge",
  "approve",
  "reject",
  "authz_denied",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export const AUDIT_OUTCOMES = ["success", "failure"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export const auditOutcomeSchema = z.enum(AUDIT_OUTCOMES);

/** Resource / domain entity names written into AuditLog.entity. */
export const AUDIT_ENTITIES = [
  "auth",
  "student",
  "fee",
  "attendance",
  "expense",
  "staff",
  "salary",
  "user",
  "role",
  "organisation",
  "admin",
  "audit",
  "class",
  "category",
  "report",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
export const auditEntitySchema = z.enum(AUDIT_ENTITIES);

export const auditLogSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime().or(z.date()),
  userId: z.number().int().positive().nullable(),
  action: z.string(),
  entity: z.string(),
  resourceId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  outcome: auditOutcomeSchema,
  additionalDetails: z.unknown().nullable(),
  contentHash: z.string(),
  prevHash: z.string().nullable(),
  username: z.string().nullable().optional(),
});
export type AuditLogDto = z.infer<typeof auditLogSchema>;

export const auditLogSortBySchema = z.enum([
  "timestamp",
  "action",
  "entity",
  "outcome",
  "userId",
]);
export type AuditLogSortBy = z.infer<typeof auditLogSortBySchema>;

export const auditLogListQuery = paginationQuery.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().min(1).optional(),
  entity: z.string().trim().min(1).optional(),
  outcome: auditOutcomeSchema.optional(),
  resourceId: z.string().trim().min(1).optional(),
  sortBy: auditLogSortBySchema.default("timestamp"),
  sortOrder: sortOrderSchema.default("desc"),
});
export type AuditLogListQuery = z.infer<typeof auditLogListQuery>;

export const auditIntegrityResultSchema = z.object({
  ok: z.boolean(),
  checked: z.number().int().nonnegative(),
  brokenAtId: z.string().nullable(),
  message: z.string(),
});
export type AuditIntegrityResult = z.infer<typeof auditIntegrityResultSchema>;

export const auditPurgeResultSchema = z.object({
  deleted: z.number().int().nonnegative(),
  olderThan: z.string().datetime().or(z.date()),
  retentionMonths: z.number().int().positive(),
});
export type AuditPurgeResult = z.infer<typeof auditPurgeResultSchema>;
