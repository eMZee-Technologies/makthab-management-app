import type { Response } from "express";
import { Readable } from "node:stream";
import { getStorage } from "./factory";
import { normalizeStoredKey } from "./keys";
import { AppError } from "../../middleware/errorHandler";
import { logger } from "../logger";

/** Stream a stored object to an Express response (auth-gated proxy). */
export async function streamStoredFile(
  res: Response,
  storedPath: string,
  contentType: string,
  notFoundMessage = "File missing"
): Promise<void> {
  let key: string;
  try {
    key = normalizeStoredKey(storedPath);
  } catch {
    throw new AppError(404, "not_found", notFoundMessage);
  }

  const storage = getStorage();
  if (!(await storage.exists(key))) {
    throw new AppError(404, "not_found", notFoundMessage);
  }

  try {
    const obj = await storage.get(key);
    res.setHeader("Content-Type", obj.contentType ?? contentType);
    if (obj.contentLength != null) {
      res.setHeader("Content-Length", String(obj.contentLength));
    }
    obj.body.on("error", (err: Error) => {
      logger.error(`stream error for ${key}: ${err.message}`);
      res.destroy(err);
    });
    obj.body.pipe(res);
  } catch (err) {
    logger.error(`failed to stream ${key}: ${(err as Error).message}`);
    throw new AppError(404, "not_found", notFoundMessage);
  }
}

/** Read a stored object fully into a Buffer (receipts, signature embed, etc.). */
export async function readStoredFile(storedPath: string): Promise<Buffer | null> {
  let key: string;
  try {
    key = normalizeStoredKey(storedPath);
  } catch {
    return null;
  }
  const storage = getStorage();
  if (!(await storage.exists(key))) return null;
  try {
    const obj = await storage.get(key);
    return await streamToBuffer(obj.body);
  } catch (err) {
    logger.warn(`readStoredFile failed for ${key}: ${(err as Error).message}`);
    return null;
  }
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer | string) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
