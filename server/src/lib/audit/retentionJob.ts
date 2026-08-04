import cron from "node-cron";
import { env } from "../env";
import { logger } from "../logger";
import { purgeExpiredAuditLogs } from "./auditLog";

let started = false;

/**
 * Schedule the AuditLog retention purge. Safe to call once at process boot.
 * Disabled when AUDIT_LOG_PURGE_CRON=off|disabled|false.
 */
export function startAuditRetentionJob(): void {
  if (started) return;
  const expr = env.auditLogPurgeCron.trim().toLowerCase();
  if (expr === "off" || expr === "disabled" || expr === "false") {
    logger.info("Audit log retention purge cron disabled via AUDIT_LOG_PURGE_CRON");
    return;
  }
  if (!cron.validate(env.auditLogPurgeCron)) {
    logger.error(`Invalid AUDIT_LOG_PURGE_CRON "${env.auditLogPurgeCron}" — purge job not started`);
    return;
  }
  started = true;
  cron.schedule(env.auditLogPurgeCron, () => {
    void (async () => {
      try {
        const result = await purgeExpiredAuditLogs();
        logger.info(
          `Audit log purge complete: deleted=${result.deleted} olderThan=${result.olderThan.toISOString()} retentionMonths=${result.retentionMonths}`
        );
      } catch (err) {
        logger.error("Audit log purge failed", err);
      }
    })();
  });
  logger.info(
    `Audit log retention purge scheduled (${env.auditLogPurgeCron}, retain ${env.auditLogRetentionMonths} months)`
  );
}
