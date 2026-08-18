import path from "node:path";
import { randomUUID } from "node:crypto";
import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import { monthlyProgressRepository } from "../db";
import { AppError } from "../middleware/errorHandler";
import { getStorage } from "./storage";
import { logger } from "./logger";
import { detectImageMime } from "./upload";

const MAX_PROGRESS_BYTES = 5 * 1024 * 1024; // 5MB

const PROGRESS_TYPES = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
]);

function detectPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-";
}

export function assertProgressAttachmentBuffer(buf: Buffer): { mime: string; ext: string } {
  const imageMime = detectImageMime(buf);
  if (imageMime && PROGRESS_TYPES.has(imageMime)) {
    return { mime: imageMime, ext: PROGRESS_TYPES.get(imageMime)! };
  }
  if (detectPdf(buf)) {
    return { mime: "application/pdf", ext: ".pdf" };
  }
  throw new AppError(400, "invalid_file", "Only PDF, JPEG, PNG, or WebP files are allowed");
}

const memory = multer.memoryStorage();
const progressUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_PROGRESS_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!PROGRESS_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "invalid_file", "Only PDF, JPEG, PNG, or WebP files are allowed"));
    }
    cb(null, true);
  },
});

export function progressAttachmentKey(progressId: number, ext: string): string {
  return `progress/prog-${progressId}-${randomUUID()}${ext}`;
}

export async function saveProgressAttachment(
  key: string,
  file: Express.Multer.File,
  mime: string
): Promise<string> {
  if (!file.buffer) {
    throw new AppError(500, "upload_error", "Upload buffer missing");
  }
  try {
    await getStorage().save(key, file.buffer, { contentType: mime });
    return key;
  } catch (err) {
    logger.error(`progress attachment save failed for ${key}: ${(err as Error).message}`);
    throw new AppError(500, "storage_error", "Failed to store uploaded file");
  }
}

export function uploadProgressAttachment(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const id = Number(req.params.id);
    const row = await monthlyProgressRepository.findById(id);
    if (!row) {
      return next(new AppError(404, "not_found", "Progress record not found"));
    }
    (req as Request & { uploadProgress?: typeof row }).uploadProgress = row;
    progressUpload.single("file")(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new AppError(400, "file_too_large", "Attachment must be 5MB or smaller"));
        }
        return next(new AppError(400, "upload_error", err.message));
      }
      if (err) return next(err);
      const file = req.file;
      if (file?.buffer) {
        try {
          const { mime, ext } = assertProgressAttachmentBuffer(file.buffer);
          file.mimetype = mime;
          file.originalname = path.basename(file.originalname || `upload${ext}`).slice(0, 120);
        } catch (e) {
          return next(e);
        }
      }
      next();
    });
  })().catch(next);
}
