import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireResourceAny } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { env, isProd } from "../lib/env";
import { DATA_DIR, BACKUPS_DIR, ensureDir } from "../lib/paths";
import { recordAuditFromRequest } from "../lib/audit/auditLog";
import type { NextFunction, Request, Response } from "express";

// Admin-only maintenance endpoints (doc §13.3).
export const adminRouter = Router();
adminRouter.use(requireAuth, requireResourceAny("admin", ["view", "create"]));

/**
 * Second factor for backup (security redesign §3.2): in addition to Admin
 * permission, production requires `BACKUP_INTERNAL_TOKEN` and a matching
 * `X-Makthab-Backup-Token` header so the route is not callable like normal
 * CRUD from a stolen Admin session alone. Local/dev/test may omit the token.
 */
export function requireBackupInternalAccess(req: Request, _res: Response, next: NextFunction) {
  const expected = env.backupInternalToken;
  if (!expected) {
    if (isProd) {
      throw new AppError(
        503,
        "backup_disabled",
        "Backup route requires BACKUP_INTERNAL_TOKEN in production"
      );
    }
    return next();
  }
  const provided = req.headers["x-makthab-backup-token"];
  if (typeof provided !== "string" || provided !== expected) {
    throw new AppError(403, "forbidden", "Backup requires valid internal token");
  }
  next();
}

/**
 * Resolve the on-disk SQLite file from DATABASE_URL. Prisma resolves
 * `file:…` URLs relative to the active schema directory
 * (`server/prisma/sqlite/` for the sqlite schema).
 */
function resolveSqliteDatabaseFile(): string | null {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return null;
  const raw = url.slice("file:".length);
  if (path.isAbsolute(raw)) return raw;
  // Match Prisma's schema-relative resolution for the sqlite schema.
  return path.resolve(__dirname, "../../prisma/sqlite", raw);
}

// POST /admin/backup — snapshot the SQLite database file into data/backups.
// PostgreSQL deployments should use managed DB snapshots instead.
adminRouter.post(
  "/backup",
  requireBackupInternalAccess,
  asyncHandler(async (req, res) => {
    if (env.databaseProvider !== "sqlite") {
      throw new AppError(
        400,
        "unsupported",
        "File backup is only available for SQLite; use your Postgres provider's snapshot tooling"
      );
    }
    const dbPath =
      resolveSqliteDatabaseFile() ?? path.join(DATA_DIR, "madrasa.db");
    if (!fs.existsSync(dbPath)) throw new AppError(404, "not_found", "Database file not found");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${ts}.db`;
    const dest = path.join(ensureDir(BACKUPS_DIR), filename);
    fs.copyFileSync(dbPath, dest);
    await recordAuditFromRequest(req, {
      action: "backup",
      entity: "admin",
      outcome: "success",
      additionalDetails: { filename },
    });
    // Return the backup filename only — not an absolute server path.
    res.status(201).json({ data: { filename, createdAt: new Date().toISOString() } });
  })
);
