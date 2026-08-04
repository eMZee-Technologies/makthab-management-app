import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import type { AuditAction, AuditEntity, AuditOutcome } from "@makthab/shared";
import { auditLogRepository } from "../../db";
import { env } from "../env";
import { logger } from "../logger";

/** Fields never persisted in additionalDetails (case-insensitive key match). */
const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "newpassword",
  "oldpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "secret",
  "mfasecret",
  "otp",
  "code",
  "ssn",
  "creditcard",
  "cardnumber",
]);

const GENESIS_PREV = "GENESIS";

export type RecordAuditInput = {
  userId?: number | null;
  action: AuditAction | string;
  entity: AuditEntity | string;
  resourceId?: string | number | null;
  outcome: AuditOutcome;
  additionalDetails?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Override timestamp (tests / backfill). */
  timestamp?: Date;
  id?: string;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Deep-clone and redact sensitive keys; truncate oversized payloads. */
export function redactDetails(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return null;
  if (depth > 6) return "[truncated]";
  if (typeof input === "string") {
    return input.length > 500 ? `${input.slice(0, 500)}…` : input;
  }
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.slice(0, 50).map((v) => redactDetails(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redactDetails(val, depth + 1);
    }
  }
  return out;
}

export function clientMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined) ||
    req.socket.remoteAddress ||
    null;
  const ua = req.headers["user-agent"] ?? null;
  return {
    ipAddress: ip ? ip.slice(0, 128) : null,
    userAgent: ua ? String(ua).slice(0, 512) : null,
  };
}

function computeContentHash(parts: {
  id: string;
  timestamp: string;
  userId: number | null;
  action: string;
  entity: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  outcome: string;
  additionalDetails: string | null;
  prevHash: string | null;
}): string {
  const canonical = [
    parts.id,
    parts.timestamp,
    parts.userId ?? "",
    parts.action,
    parts.entity,
    parts.resourceId ?? "",
    parts.ipAddress ?? "",
    parts.userAgent ?? "",
    parts.outcome,
    parts.additionalDetails ?? "",
    parts.prevHash ?? GENESIS_PREV,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

let volumeWindowStart = Date.now();
let volumeCount = 0;

function noteVolume(): void {
  const now = Date.now();
  if (now - volumeWindowStart > 60_000) {
    volumeWindowStart = now;
    volumeCount = 0;
  }
  volumeCount += 1;
  if (volumeCount === env.auditLogVolumeWarnPerMinute) {
    logger.warn(
      `Audit log volume elevated: ${volumeCount}+ entries in the last minute (threshold=${env.auditLogVolumeWarnPerMinute})`
    );
  }
}

/**
 * Append an audit log entry. Failures are logged but never throw to callers —
 * audit must not break the primary request path.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    const id = input.id ?? randomUUID().replace(/-/g, "").slice(0, 25);
    const timestamp = input.timestamp ?? new Date();
    const resourceId =
      input.resourceId === null || input.resourceId === undefined
        ? null
        : String(input.resourceId);
    const details =
      input.additionalDetails === undefined
        ? null
        : JSON.stringify(redactDetails(input.additionalDetails));

    // Serialize chain appends via a short retry loop on concurrent writes.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const latest = await auditLogRepository.findLatest();
        const prevHash = latest?.contentHash ?? null;
        const contentHash = computeContentHash({
          id,
          timestamp: timestamp.toISOString(),
          userId: input.userId ?? null,
          action: input.action,
          entity: input.entity,
          resourceId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          outcome: input.outcome,
          additionalDetails: details,
          prevHash,
        });
        await auditLogRepository.create({
          id,
          timestamp,
          userId: input.userId ?? null,
          action: input.action,
          entity: input.entity,
          resourceId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          outcome: input.outcome,
          additionalDetails: details,
          contentHash,
          prevHash,
        });
        noteVolume();
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    logger.error("Failed to record audit log after retries", lastErr);
  } catch (err) {
    logger.error("Failed to record audit log", err);
  }
}

export async function recordAuditFromRequest(
  req: Request,
  input: Omit<RecordAuditInput, "ipAddress" | "userAgent" | "userId"> & {
    userId?: number | null;
  }
): Promise<void> {
  const meta = clientMeta(req);
  const userId = input.userId !== undefined ? input.userId : req.user?.sub ?? null;
  await recordAudit({ ...input, ...meta, userId });
}

export type IntegrityCheckResult = {
  ok: boolean;
  checked: number;
  brokenAtId: string | null;
  message: string;
};

/** Walk the chain in insertion order and verify hashes. */
export async function verifyAuditIntegrity(limit = 10_000): Promise<IntegrityCheckResult> {
  const rows = await auditLogRepository.listChronological(limit);
  let prev: string | null = null;
  let checked = 0;
  for (const row of rows) {
    const expectedPrev = prev;
    if ((row.prevHash ?? null) !== expectedPrev) {
      return {
        ok: false,
        checked,
        brokenAtId: row.id,
        message: `Chain break at ${row.id}: prevHash mismatch`,
      };
    }
    const recomputed = computeContentHash({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      userId: row.userId,
      action: row.action,
      entity: row.entity,
      resourceId: row.resourceId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      outcome: row.outcome,
      additionalDetails: row.additionalDetails,
      prevHash: row.prevHash,
    });
    if (recomputed !== row.contentHash) {
      return {
        ok: false,
        checked,
        brokenAtId: row.id,
        message: `Tamper detected at ${row.id}: contentHash mismatch`,
      };
    }
    prev = row.contentHash;
    checked += 1;
  }
  return {
    ok: true,
    checked,
    brokenAtId: null,
    message: checked === 0 ? "No audit entries" : `Verified ${checked} entries`,
  };
}

export function retentionCutoff(months = env.auditLogRetentionMonths): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

export async function purgeExpiredAuditLogs(months = env.auditLogRetentionMonths): Promise<{
  deleted: number;
  olderThan: Date;
  retentionMonths: number;
}> {
  const olderThan = retentionCutoff(months);
  // Record the purge event BEFORE deleting so the chain tip stays after the
  // retention window (purge itself is an audit-worthy admin action).
  await recordAudit({
    userId: null,
    action: "purge",
    entity: "audit",
    outcome: "success",
    additionalDetails: { olderThan: olderThan.toISOString(), retentionMonths: months, source: "job" },
  });
  const deleted = await auditLogRepository.deleteOlderThan(olderThan);
  return { deleted, olderThan, retentionMonths: months };
}

/** Exported for unit tests. */
export const _auditInternals = { computeContentHash, GENESIS_PREV, stableStringify };
