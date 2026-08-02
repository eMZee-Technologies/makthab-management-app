#!/usr/bin/env tsx
/**
 * Apply pending Prisma migrations for the active DATABASE_PROVIDER.
 *
 * Usage (from server/):  npx tsx prisma/deploy-migrations.ts
 * Or:                   npm run db:deploy -w server
 *
 * Why this exists: `npm run db:migrate` targets the Postgres schema only.
 * Pulling auth/user-management changes without deploying the matching
 * migration leaves the DB missing columns like User.phone and surfaces as:
 *   "The column `User.phone` does not exist in the current database."
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const provider = (process.env.DATABASE_PROVIDER ?? "sqlite").toLowerCase();
const schema =
  provider === "postgresql"
    ? path.join("prisma", "schema.prisma")
    : path.join("prisma", "sqlite", "schema.prisma");

console.log(`[db:deploy] DATABASE_PROVIDER=${provider}`);
console.log(`[db:deploy] prisma migrate deploy --schema=${schema}`);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", `--schema=${schema}`],
  { stdio: "inherit", shell: true, env: process.env }
);

process.exit(result.status ?? 1);
