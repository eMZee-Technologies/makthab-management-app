import { Readable } from "node:stream";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "../logger";
import { assertSafeStorageKey } from "./keys";
import type { SaveOptions, StorageAdapter, StoredObject } from "./types";

export interface S3StorageAdapterOptions {
  bucket: string;
  region: string;
  /** When set, use static credentials; otherwise the default AWS chain (IAM role, etc.). */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Optional key prefix inside the bucket (no leading/trailing slash). */
  keyPrefix?: string;
}

/**
 * S3-backed storage. `save` uses `@aws-sdk/lib-storage` Upload which
 * automatically multipart-uploads objects above the part-size threshold
 * (and does a single PutObject for small files such as photos).
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;

  constructor(opts: S3StorageAdapterOptions) {
    const config: S3ClientConfig = { region: opts.region };
    if (opts.accessKeyId && opts.secretAccessKey) {
      config.credentials = {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      };
    }
    this.client = new S3Client(config);
    this.bucket = opts.bucket;
    this.keyPrefix = (opts.keyPrefix ?? "").replace(/^\/+|\/+$/g, "");
  }

  private objectKey(key: string): string {
    const safe = assertSafeStorageKey(key);
    return this.keyPrefix ? `${this.keyPrefix}/${safe}` : safe;
  }

  async save(key: string, data: Buffer | Readable, options?: SaveOptions): Promise<void> {
    const objectKey = this.objectKey(key);
    const body = Buffer.isBuffer(data) ? data : data;
    try {
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: objectKey,
          Body: body,
          ContentType: options?.contentType,
          CacheControl: options?.cacheControl,
        },
        // 5 MiB parts — AWS minimum for multipart; small files stay single-part.
        partSize: 5 * 1024 * 1024,
        queueSize: 4,
      });
      await upload.done();
      logger.info(`s3 storage: saved s3://${this.bucket}/${objectKey}`);
    } catch (err) {
      logger.error(`s3 storage: save failed for ${objectKey}: ${(err as Error).message}`);
      throw err;
    }
  }

  async get(key: string): Promise<StoredObject> {
    const objectKey = this.objectKey(key);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey })
      );
      if (!out.Body) {
        throw new Error("empty_s3_body");
      }
      // SDK v3 Body is a Readable in Node.
      const body = out.Body as Readable;
      return {
        body,
        contentType: out.ContentType,
        contentLength: out.ContentLength,
      };
    } catch (err) {
      logger.error(`s3 storage: get failed for ${objectKey}: ${(err as Error).message}`);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const objectKey = this.objectKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      logger.debug(`s3 storage: deleted s3://${this.bucket}/${objectKey}`);
    } catch (err) {
      logger.warn(`s3 storage: delete failed for ${objectKey}: ${(err as Error).message}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const objectKey = this.objectKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string | null> {
    const objectKey = this.objectKey(key);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds }
    );
    return url;
  }
}
