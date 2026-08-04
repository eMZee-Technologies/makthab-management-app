import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir } from "../paths";
import { logger } from "../logger";
import { assertSafeStorageKey } from "./keys";
import type { SaveOptions, StorageAdapter, StoredObject } from "./types";

/**
 * Local-filesystem storage under `rootDir` (default: `data/files`).
 * Used for development and any non-S3 deployment.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = "local" as const;

  constructor(private readonly rootDir: string) {
    ensureDir(this.rootDir);
  }

  private resolve(key: string): string {
    const safe = assertSafeStorageKey(key);
    const root = path.resolve(this.rootDir);
    const abs = path.resolve(this.rootDir, safe);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(prefix)) {
      throw new Error("invalid_file_path");
    }
    return abs;
  }

  async save(key: string, data: Buffer | Readable, options?: SaveOptions): Promise<void> {
    const abs = this.resolve(key);
    ensureDir(path.dirname(abs));
    if (Buffer.isBuffer(data)) {
      await fs.promises.writeFile(abs, data);
    } else {
      await pipeline(data, fs.createWriteStream(abs));
    }
    logger.debug(`local storage: saved ${key}${options?.contentType ? ` (${options.contentType})` : ""}`);
  }

  async get(key: string): Promise<StoredObject> {
    const abs = this.resolve(key);
    await fs.promises.access(abs, fs.constants.R_OK);
    const stat = await fs.promises.stat(abs);
    return {
      body: fs.createReadStream(abs),
      contentLength: stat.size,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      const abs = this.resolve(key);
      await fs.promises.rm(abs, { force: true });
      logger.debug(`local storage: deleted ${key}`);
    } catch (err) {
      // Missing / invalid keys are best-effort.
      logger.debug(`local storage: delete skipped for ${key}: ${(err as Error).message}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const abs = this.resolve(key);
      await fs.promises.access(abs, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(_key: string, _expiresInSeconds?: number): Promise<string | null> {
    // Local files are always proxied through authenticated API routes.
    return null;
  }
}
