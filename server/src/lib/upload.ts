import path from "node:path";
import { randomUUID } from "node:crypto";
import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import { studentRepository, staffRepository, orgProfileRepository } from "../db";
import { AppError } from "../middleware/errorHandler";
import { getStorage, normalizeStoredKey } from "./storage";
import { logger } from "./logger";

// Accepted image mimetypes → canonical extension.
const ALLOWED_TYPES = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const MAX_BYTES = 3 * 1024 * 1024; // ~3MB

// Staff signatures are JPEG-only: the dependency-free PDF writer embeds
// signature images via JPEG's DCTDecode filter (no PNG/WebP decoder).
const SIGNATURE_TYPES = new Map<string, string>([["image/jpeg", ".jpg"]]);

// Memory storage so the same buffer can be written to local disk or S3.
const memory = multer.memoryStorage();

/**
 * Magic-byte sniff for JPEG / PNG / WebP (security redesign §3.2).
 * Do not trust client Content-Type or filename alone.
 */
export function detectImageMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Assert buffer matches an allowed image type; optionally restrict further. */
export function assertAllowedImageBuffer(
  buf: Buffer,
  allowed: Map<string, string> = ALLOWED_TYPES
): { mime: string; ext: string } {
  const mime = detectImageMime(buf);
  if (!mime || !allowed.has(mime)) {
    const label =
      allowed === SIGNATURE_TYPES
        ? "Signature must be a JPEG image"
        : "Only JPEG, PNG, or WebP images are allowed";
    throw new AppError(400, "invalid_file", label);
  }
  return { mime, ext: allowed.get(mime)! };
}

function imageFileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    return cb(new AppError(400, "invalid_file", "Only JPEG, PNG, or WebP images are allowed"));
  }
  cb(null, true);
}

function wrapMulter(
  middleware: ReturnType<ReturnType<typeof multer>["single"]>,
  tooLargeMessage: string,
  allowed: Map<string, string> = ALLOWED_TYPES
) {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new AppError(400, "file_too_large", tooLargeMessage));
        }
        return next(new AppError(400, "upload_error", err.message));
      }
      if (err) return next(err);
      // Magic-byte check after multer buffers the file.
      const file = req.file;
      if (file?.buffer) {
        try {
          const { mime, ext } = assertAllowedImageBuffer(file.buffer, allowed);
          file.mimetype = mime;
          // Keep originalname extension aligned with sniffed type for key builders.
          file.originalname = `upload${ext}`;
        } catch (e) {
          return next(e);
        }
      }
      next();
    });
  };
}

function extFor(file: Express.Multer.File, allowed: Map<string, string>): string {
  return allowed.get(file.mimetype) ?? (path.extname(file.originalname) || ".bin");
}

/** Build a randomized relative storage key (no user-controlled filename). */
function randomPhotoKey(prefix: string, file: Express.Multer.File, allowed: Map<string, string>): string {
  return `photos/${prefix}-${randomUUID()}${extFor(file, allowed)}`;
}

/** Build the relative storage key for a student photo upload. */
export function studentPhotoKey(admissionNo: string, file: Express.Multer.File): string {
  const safeAdmission = admissionNo.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  return randomPhotoKey(`stu-${safeAdmission}`, file, ALLOWED_TYPES);
}

/** Build the relative storage key for a staff photo upload. */
export function staffPhotoKey(staffId: number, file: Express.Multer.File): string {
  return randomPhotoKey(`staff-${staffId}`, file, ALLOWED_TYPES);
}

/** Build the relative storage key for a staff signature (JPEG only). */
export function staffSignatureKey(staffId: number, file: Express.Multer.File): string {
  return randomPhotoKey(`staff-${staffId}-sig`, file, SIGNATURE_TYPES);
}

/** Build the relative storage key for an org-profile header image. */
export function orgImageKey(orgId: number, file: Express.Multer.File): string {
  return randomPhotoKey(`org-${orgId}`, file, ALLOWED_TYPES);
}

/** Persist an uploaded multer buffer and return the storage key. */
export async function saveUploadedFile(
  key: string,
  file: Express.Multer.File
): Promise<string> {
  if (!file.buffer) {
    throw new AppError(500, "upload_error", "Upload buffer missing");
  }
  // Re-check magic bytes at persist time (defense in depth).
  assertAllowedImageBuffer(
    file.buffer,
    file.fieldname === "signature" ? SIGNATURE_TYPES : ALLOWED_TYPES
  );
  try {
    await getStorage().save(key, file.buffer, { contentType: file.mimetype });
    return key;
  } catch (err) {
    logger.error(`upload save failed for ${key}: ${(err as Error).message}`);
    throw new AppError(500, "storage_error", "Failed to store uploaded file");
  }
}

/** Best-effort delete of a previously stored object (ignores missing/invalid). */
export async function deleteStoredFile(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) return;
  try {
    const key = normalizeStoredKey(storedPath);
    await getStorage().delete(key);
  } catch (err) {
    logger.debug(`deleteStoredFile skipped for ${storedPath}: ${(err as Error).message}`);
  }
}

// Runs multer.single("photo") after confirming the student exists, so unknown
// ids are rejected before any bytes are buffered.
const studentUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_BYTES },
  fileFilter: imageFileFilter,
});

export function uploadStudentPhoto(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const id = Number(req.params.id);
    const student = await studentRepository.findById(id);
    if (!student) {
      return next(new AppError(404, "not_found", "Student not found"));
    }
    // Stash for the route handler so it doesn't re-query just for admissionNo.
    (req as Request & { uploadStudent?: typeof student }).uploadStudent = student;
    wrapMulter(studentUpload.single("photo"), "Photo must be 3MB or smaller")(req, res, next);
  })().catch(next);
}

// Staff photos mirror student photos, but Staff has no admissionNo, so the
// filename is keyed off the staff id (staff-${id}-${uuid}).
const staffUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_BYTES },
  fileFilter: imageFileFilter,
});

export function uploadStaffPhoto(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const id = Number(req.params.id);
    const staff = await staffRepository.findById(id);
    if (!staff) {
      return next(new AppError(404, "not_found", "Staff not found"));
    }
    (req as Request & { uploadStaff?: typeof staff }).uploadStaff = staff;
    wrapMulter(staffUpload.single("photo"), "Photo must be 3MB or smaller")(req, res, next);
  })().catch(next);
}

// Content-Type for streaming a stored photo back, inferred from its extension.
export function photoContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

const signatureUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!SIGNATURE_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "invalid_file", "Signature must be a JPEG image"));
    }
    cb(null, true);
  },
});

export function uploadStaffSignature(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const id = Number(req.params.id);
    const staff = await staffRepository.findById(id);
    if (!staff) {
      return next(new AppError(404, "not_found", "Staff not found"));
    }
    (req as Request & { uploadStaff?: typeof staff }).uploadStaff = staff;
    wrapMulter(
      signatureUpload.single("signature"),
      "Signature must be 3MB or smaller",
      SIGNATURE_TYPES
    )(req, res, next);
  })().catch(next);
}

// Org-profile header image (web app-header background only — NOT embedded in the
// ASCII PDF writer), so it follows the same JPEG/PNG/WebP rules as photos, keyed
// off the org profile id (org-${id}-${uuid}).
const orgImageUpload = multer({
  storage: memory,
  limits: { fileSize: MAX_BYTES },
  fileFilter: imageFileFilter,
});

export function uploadOrgImage(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const id = Number(req.params.id);
    const org = await orgProfileRepository.findById(id);
    if (!org) {
      return next(new AppError(404, "not_found", "Organisation profile not found"));
    }
    (req as Request & { uploadOrg?: typeof org }).uploadOrg = org;
    wrapMulter(orgImageUpload.single("image"), "Image must be 3MB or smaller")(req, res, next);
  })().catch(next);
}
