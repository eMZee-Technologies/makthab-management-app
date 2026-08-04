import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireResourceAny } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { env } from "../lib/env";
import { DATA_DIR, BACKUPS_DIR, ensureDir } from "../lib/paths";
import { recordAuditFromRequest } from "../lib/audit/auditLog";

// Admin-only maintenance endpoints (doc §13.3).
export const adminRouter = Router();
adminRouter.use(requireAuth, requireResourceAny("admin", ["view", "create"]));

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
