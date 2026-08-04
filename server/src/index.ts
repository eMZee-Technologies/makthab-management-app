import { createApp } from "./app";
import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { ensureDataDirs } from "./lib/paths";
import { getStorage, resolveStorageBackend } from "./lib/storage";
import { startAuditRetentionJob } from "./lib/audit/retentionJob";

// Local backend needs on-disk directories; S3 does not.
if (resolveStorageBackend() === "local") {
  ensureDataDirs();
}
// Instantiate early so misconfigured S3 env fails at boot, not on first upload.
getStorage();

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`Makthab API listening on http://localhost:${env.port}`);
  logger.info(`Health check: http://localhost:${env.port}/health`);
  startAuditRetentionJob();
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
