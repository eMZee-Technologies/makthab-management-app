import path from "node:path";
import multer, { MulterError } from "multer";
import type { NextFunction, Request, Response } from "express";
import { PHOTOS_DIR, ensureDir } from "./paths";
import { studentRepository, staffRepository, orgProfileRepository } from "../db";
import { AppError } from "../middleware/errorHandler";

// Accepted image mimetypes → canonical extension.
const ALLOWED_TYPES = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const MAX_BYTES = 3 * 1024 * 1024; // ~3MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureDir(PHOTOS_DIR));
  },
  filename: (req, file, cb) => {
    // Derive the filename from the student's admissionNo. Looking the student up
    // here also lets us reject unknown ids before any bytes hit disk.
    void (async () => {
      const id = Number(req.params.id);
      const student = await studentRepository.findById(id);
      if (!student) {
        return cb(new AppError(404, "not_found", "Student not found"), "");
      }
      const ext = ALLOWED_TYPES.get(file.mimetype) ?? path.extname(file.originalname);
      const safeAdmission = student.admissionNo.replace(/[^a-zA-Z0-9_-]/g, "_");
      cb(null, `${safeAdmission}-${Date.now()}${ext}`);
    })().catch((err) => cb(err as Error, ""));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "invalid_file", "Only JPEG, PNG, or WebP images are allowed"));
    }
    cb(null, true);
  },
});

// Runs multer.single("photo") and normalises multer's own rejections into
// AppErrors so they surface as the standard 400 envelope, not a raw stack trace.
export function uploadStudentPhoto(req: Request, res: Response, next: NextFunction) {
  upload.single("photo")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(400, "file_too_large", "Photo must be 3MB or smaller"));
      }
      return next(new AppError(400, "upload_error", err.message));
    }
    if (err) return next(err);
    next();
  });
}

// Staff photos mirror student photos, but Staff has no admissionNo, so the
// filename is keyed off the staff id (staff-${id}-${ts}).
const staffStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureDir(PHOTOS_DIR));
  },
  filename: (req, file, cb) => {
    void (async () => {
      const id = Number(req.params.id);
      const staff = await staffRepository.findById(id);
      if (!staff) {
        return cb(new AppError(404, "not_found", "Staff not found"), "");
      }
      const ext = ALLOWED_TYPES.get(file.mimetype) ?? path.extname(file.originalname);
      cb(null, `staff-${staff.id}-${Date.now()}${ext}`);
    })().catch((err) => cb(err as Error, ""));
  },
});

const staffUpload = multer({
  storage: staffStorage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "invalid_file", "Only JPEG, PNG, or WebP images are allowed"));
    }
    cb(null, true);
  },
});

export function uploadStaffPhoto(req: Request, res: Response, next: NextFunction) {
  staffUpload.single("photo")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(400, "file_too_large", "Photo must be 3MB or smaller"));
      }
      return next(new AppError(400, "upload_error", err.message));
    }
    if (err) return next(err);
    next();
  });
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

// Staff signatures, keyed off staff id like staff photos — but JPEG-only:
// the dependency-free PDF writer embeds signature images via JPEG's own
// DCTDecode filter (no PNG/WebP decoder), so only JPEG can be stamped onto
// a receipt.
const SIGNATURE_TYPES = new Map<string, string>([["image/jpeg", ".jpg"]]);

const signatureStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureDir(PHOTOS_DIR));
  },
  filename: (req, file, cb) => {
    void (async () => {
      const id = Number(req.params.id);
      const staff = await staffRepository.findById(id);
      if (!staff) {
        return cb(new AppError(404, "not_found", "Staff not found"), "");
      }
      const ext = SIGNATURE_TYPES.get(file.mimetype) ?? path.extname(file.originalname);
      cb(null, `staff-${staff.id}-signature-${Date.now()}${ext}`);
    })().catch((err) => cb(err as Error, ""));
  },
});

const signatureUpload = multer({
  storage: signatureStorage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!SIGNATURE_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "invalid_file", "Signature must be a JPEG image"));
    }
    cb(null, true);
  },
});

export function uploadStaffSignature(req: Request, res: Response, next: NextFunction) {
  signatureUpload.single("signature")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(400, "file_too_large", "Signature must be 3MB or smaller"));
      }
      return next(new AppError(400, "upload_error", err.message));
    }
    if (err) return next(err);
    next();
  });
}

// Org-profile header image (web app-header background only — NOT embedded in the
// ASCII PDF writer), so it follows the same JPEG/PNG/WebP rules as photos, keyed
// off the org profile id (org-${id}-${ts}).
const orgImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureDir(PHOTOS_DIR));
  },
  filename: (req, file, cb) => {
    void (async () => {
      const id = Number(req.params.id);
      const org = await orgProfileRepository.findById(id);
      if (!org) {
        return cb(new AppError(404, "not_found", "Organisation profile not found"), "");
      }
      const ext = ALLOWED_TYPES.get(file.mimetype) ?? path.extname(file.originalname);
      cb(null, `org-${org.id}-${Date.now()}${ext}`);
    })().catch((err) => cb(err as Error, ""));
  },
});

const orgImageUpload = multer({
  storage: orgImageStorage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, "invalid_file", "Only JPEG, PNG, or WebP images are allowed"));
    }
    cb(null, true);
  },
});

export function uploadOrgImage(req: Request, res: Response, next: NextFunction) {
  orgImageUpload.single("image")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new AppError(400, "file_too_large", "Image must be 3MB or smaller"));
      }
      return next(new AppError(400, "upload_error", err.message));
    }
    if (err) return next(err);
    next();
  });
}
