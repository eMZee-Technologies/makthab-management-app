/**
 * Object storage adapter (Phase 2 / M3).
 *
 * Local disk (`FILE_STORAGE=local`, default) keeps current `data/files/*`
 * behaviour for offline/dev. S3 (`FILE_STORAGE=s3`) writes the same logical
 * keys (`receipts/…`, `photos/…`, …) to `S3_FILES_BUCKET` for Fargate.
 */
import fs from "node:fs";
import path from "node:path";
import { FILES_DIR, ensureDir } from "../paths";
import { env } from "../env";
import { logger } from "../logger";

export type StoredObject = {
  /** Logical key, e.g. `receipts/RCP-2026-0001.pdf` */
  key: string;
  contentType?: string;
};

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType?: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Short-lived HTTPS URL when backend supports it; otherwise null. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string | null>;
}

class LocalObjectStorage implements ObjectStorage {
  private abs(key: string): string {
    const root = path.resolve(FILES_DIR);
    const abs = path.resolve(FILES_DIR, key);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(prefix)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return abs;
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<StoredObject> {
    const abs = this.abs(key);
    ensureDir(path.dirname(abs));
    await fs.promises.writeFile(abs, body);
    return { key, contentType };
  }

  async get(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.abs(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.promises.access(this.abs(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.abs(key), { force: true });
  }

  async getSignedUrl(_key: string): Promise<string | null> {
    return null;
  }
}

class S3ObjectStorage implements ObjectStorage {
  private bucket: string;
  private region: string;

  constructor(bucket: string, region: string) {
    this.bucket = bucket;
    this.region = region;
  }

  private async client() {
    // Dynamic import so local/dev installs without AWS creds don't need the
    // SDK at module-load time when FILE_STORAGE=local.
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({ region: this.region });
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<StoredObject> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    return { key, contentType };
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`empty s3 object: ${key}`);
    return Buffer.from(bytes);
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

let singleton: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (singleton) return singleton;
  if (env.fileStorage === "s3") {
    if (!env.s3FilesBucket) {
      throw new Error("S3_FILES_BUCKET is required when FILE_STORAGE=s3");
    }
    logger.info(`object storage: s3 bucket=${env.s3FilesBucket}`);
    singleton = new S3ObjectStorage(env.s3FilesBucket, env.awsRegion);
  } else {
    logger.debug("object storage: local disk");
    singleton = new LocalObjectStorage();
  }
  return singleton;
}

/**
 * Read a stored object by DB value. Supports legacy absolute paths under
 * FILES_DIR as well as relative storage keys.
 */
export async function readStoredBytes(storedPath: string): Promise<Buffer | null> {
  if (!storedPath) return null;
  if (path.isAbsolute(storedPath)) {
    try {
      return await fs.promises.readFile(storedPath);
    } catch {
      return null;
    }
  }
  try {
    return await getObjectStorage().get(storedPath);
  } catch {
    return null;
  }
}

export async function deleteStored(storedPath: string): Promise<void> {
  if (!storedPath) return;
  if (path.isAbsolute(storedPath)) {
    await fs.promises.rm(storedPath, { force: true }).catch(() => undefined);
    return;
  }
  await getObjectStorage().delete(storedPath).catch(() => undefined);
}
