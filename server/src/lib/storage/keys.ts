import path from "node:path";
import { FILES_DIR } from "../paths";

/**
 * Reject absolute paths and any `..` traversal. Storage keys are always
 * relative POSIX-style paths (`photos/…`, `receipts/…`).
 */
export function assertSafeStorageKey(key: string): string {
  if (!key || typeof key !== "string") {
    throw new Error("invalid_file_path");
  }
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || path.isAbsolute(key) || path.isAbsolute(normalized)) {
    throw new Error("invalid_file_path");
  }
  const segments = normalized.split("/");
  if (segments.some((s) => s === ".." || s === "")) {
    throw new Error("invalid_file_path");
  }
  return normalized;
}

/**
 * Convert a DB-stored path into a storage key.
 *
 * Photos already use relative keys (`photos/…`). Fee receipt PDFs historically
 * stored absolute paths under `data/files/receipts/…` — strip that prefix so
 * both backends can resolve them.
 */
export function normalizeStoredKey(stored: string): string {
  if (!stored) throw new Error("invalid_file_path");

  if (!path.isAbsolute(stored)) {
    return assertSafeStorageKey(stored);
  }

  // Legacy absolute path under FILES_DIR (or any …/files/… marker).
  const posix = stored.replace(/\\/g, "/");
  const filesMarker = "/files/";
  const markerIdx = posix.lastIndexOf(filesMarker);
  if (markerIdx >= 0) {
    return assertSafeStorageKey(posix.slice(markerIdx + filesMarker.length));
  }

  const rel = path.relative(FILES_DIR, stored);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return assertSafeStorageKey(rel);
  }

  throw new Error("invalid_file_path");
}
