/**
 * QA test-DB reset helper. Creates a fresh, seeded DB isolated from dev.
 * Run from server/ dir:  node tests/reset-test-db.mjs
 * Postgres:               DATABASE_PROVIDER=postgresql node tests/reset-test-db.mjs
 *
 * Uses a separate DATABASE_URL so the dev DB (data/madrasa.db, or the dev
 * Postgres database) is never touched.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER = process.env.DATABASE_PROVIDER || "sqlite";
const SCHEMA = PROVIDER === "postgresql" ? "./prisma/schema.prisma" : "./prisma/sqlite/schema.prisma";
const DEFAULT_TEST_DB_URL =
  PROVIDER === "postgresql"
    ? "postgresql://postgres:postgres@localhost:5433/makthab_test"
    : "file:./test.db";
const TEST_DB_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DB_URL;

const env = { ...process.env, DATABASE_PROVIDER: PROVIDER, DATABASE_URL: TEST_DB_URL };
const sh = (cmd) => {
  console.log(`$ ${cmd}   (DATABASE_PROVIDER=${PROVIDER} DATABASE_URL=${TEST_DB_URL})`);
  execSync(cmd, { cwd: serverDir, env, stdio: "inherit" });
};

try {
  // Recreate schema from committed migrations, then seed.
  sh(`npx prisma migrate reset --force --skip-generate --schema=${SCHEMA}`);
  console.log(
    `\nTest DB ready. Run: DATABASE_PROVIDER=${PROVIDER} DATABASE_URL=${TEST_DB_URL} npm test`
  );
} catch (e) {
  console.error("Test DB reset failed:", e.message);
  process.exit(1);
}
