import fs from "node:fs";
import path from "node:path";

// Repo-root /data directory (holds madrasa.db + generated files). Resolved from
// this file's location so it is stable regardless of the process CWD.
export const DATA_DIR = path.resolve(__dirname, "../../../data");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const RECEIPTS_DIR = path.join(FILES_DIR, "receipts");
export const PAYSLIPS_DIR = path.join(FILES_DIR, "payslips");
export const PHOTOS_DIR = path.join(FILES_DIR, "photos");
export const REPORTS_DIR = path.join(FILES_DIR, "reports");
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Ensure all standard output directories exist (called once at boot).
export function ensureDataDirs(): void {
  [FILES_DIR, RECEIPTS_DIR, PAYSLIPS_DIR, PHOTOS_DIR, REPORTS_DIR, BACKUPS_DIR].forEach(ensureDir);
}

/**
 * Resolve a stored relative path (e.g. `photos/foo.jpg`) under FILES_DIR.
 * Rejects absolute paths and `..` traversal so a tainted DB value cannot
 * escape the files tree when streaming uploads.
 */
export function resolveUnderFilesDir(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("invalid_file_path");
  }
  const root = path.resolve(FILES_DIR);
  const abs = path.resolve(FILES_DIR, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error("invalid_file_path");
  }
  return abs;
}
