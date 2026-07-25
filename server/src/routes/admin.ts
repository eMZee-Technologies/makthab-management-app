import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { DATA_DIR, BACKUPS_DIR, ensureDir } from "../lib/paths";

// Admin-only maintenance endpoints (doc §13.3).
export const adminRouter = Router();
adminRouter.use(requireAuth, requirePermission("admin.access"));

// POST /admin/backup — snapshot the SQLite database file into data/backups.
adminRouter.post(
  "/backup",
  asyncHandler(async (_req, res) => {
    const dbPath = path.join(DATA_DIR, "madrasa.db");
    if (!fs.existsSync(dbPath)) throw new AppError(404, "not_found", "Database file not found");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(ensureDir(BACKUPS_DIR), `backup-${ts}.db`);
    fs.copyFileSync(dbPath, dest);
    res.status(201).json({ data: { path: dest, createdAt: new Date().toISOString() } });
  })
);
