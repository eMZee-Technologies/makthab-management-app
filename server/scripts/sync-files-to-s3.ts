#!/usr/bin/env tsx
/**
 * Optional one-shot: sync local data/files into the configured S3 bucket.
 *
 * Usage (from repo root or server/):
 *   S3_BUCKET=… AWS_REGION=… npx tsx server/scripts/sync-files-to-s3.ts
 *
 * Dry-run (list only):
 *   DRY_RUN=1 S3_BUCKET=… AWS_REGION=… npx tsx server/scripts/sync-files-to-s3.ts
 */
import fs from "node:fs";
import path from "node:path";
import { FILES_DIR } from "../src/lib/paths";
import { S3StorageAdapter } from "../src/lib/storage/s3";

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".gitkeep") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs, base)));
    } else {
      out.push(path.relative(base, abs).replace(/\\/g, "/"));
    }
  }
  return out;
}

async function main() {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!bucket || !region) {
    console.error("S3_BUCKET and AWS_REGION are required");
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  const keys = await walk(FILES_DIR);
  console.log(`Found ${keys.length} file(s) under ${FILES_DIR}`);
  if (dryRun) {
    for (const k of keys) console.log(`  would upload ${k}`);
    return;
  }
  const storage = new S3StorageAdapter({
    bucket,
    region,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });
  for (const key of keys) {
    const buf = await fs.promises.readFile(path.join(FILES_DIR, key));
    const ext = path.extname(key).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".pdf"
            ? "application/pdf"
            : "image/jpeg";
    await storage.save(key, buf, { contentType });
    console.log(`uploaded ${key}`);
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
