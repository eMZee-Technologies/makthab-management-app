import type { Readable } from "node:stream";

/** Metadata returned when an object is fetched from storage. */
export interface StoredObject {
  body: Readable;
  contentType?: string;
  contentLength?: number;
}

/** Options accepted by {@link StorageAdapter.save}. */
export interface SaveOptions {
  contentType?: string;
  /** Cache-Control / ACL hints — adapters may ignore unsupported fields. */
  cacheControl?: string;
}

/**
 * Backend-agnostic file storage. Keys are always relative POSIX paths under
 * the logical files tree, e.g. `photos/ADM-1-….jpg` or `receipts/R-….pdf`.
 * Adapters must reject absolute paths and `..` segments.
 */
export interface StorageAdapter {
  readonly kind: "local" | "s3";

  /** Persist bytes at `key`, overwriting any previous object. */
  save(key: string, data: Buffer | Readable, options?: SaveOptions): Promise<void>;

  /** Open a readable stream for `key`. Throws if missing / invalid. */
  get(key: string): Promise<StoredObject>;

  /** Best-effort delete; missing keys are not an error. */
  delete(key: string): Promise<void>;

  /** True when the object exists. */
  exists(key: string): Promise<boolean>;

  /**
   * Optional: return a short-lived HTTPS URL for direct client download.
   * Local adapter returns null (API continues to proxy bytes). S3 adapter
   * returns a presigned GET URL when called.
   */
  getSignedUrl?(key: string, expiresInSeconds?: number): Promise<string | null>;
}
