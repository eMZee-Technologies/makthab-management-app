import { env, isProd } from "../env";
import { FILES_DIR } from "../paths";
import { logger } from "../logger";
import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import type { StorageAdapter } from "./types";

let cached: StorageAdapter | undefined;

/**
 * Resolve which backend to use:
 * 1. Explicit `STORAGE_BACKEND=local|s3` wins.
 * 2. Otherwise production → S3, development/test → local filesystem.
 */
export function resolveStorageBackend(): "local" | "s3" {
  const explicit = env.storageBackend;
  if (explicit === "local" || explicit === "s3") return explicit;
  return isProd ? "s3" : "local";
}

/** Build (and memoize) the process-wide storage adapter. */
export function createStorageAdapter(): StorageAdapter {
  const backend = resolveStorageBackend();

  if (backend === "s3") {
    if (!env.s3Bucket) {
      throw new Error("S3_BUCKET is required when STORAGE_BACKEND=s3 (or NODE_ENV=production)");
    }
    if (!env.awsRegion) {
      throw new Error("AWS_REGION is required when STORAGE_BACKEND=s3 (or NODE_ENV=production)");
    }
    logger.info(`storage backend: s3 (bucket=${env.s3Bucket}, region=${env.awsRegion})`);
    return new S3StorageAdapter({
      bucket: env.s3Bucket,
      region: env.awsRegion,
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey,
    });
  }

  logger.info(`storage backend: local (root=${FILES_DIR})`);
  return new LocalStorageAdapter(FILES_DIR);
}

/** Singleton accessor used by routes/services. */
export function getStorage(): StorageAdapter {
  if (!cached) cached = createStorageAdapter();
  return cached;
}

/** Test helper — clear the memoized adapter between cases. */
export function resetStorageAdapter(): void {
  cached = undefined;
}
