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
import { config as loadEnv } from "dotenv";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Match server/src/lib/env.ts — load server/.env before reading DATABASE_*.
// Without this, DATABASE_PROVIDER defaults to sqlite while Prisma still picks
// up a postgres DATABASE_URL from .env and fails with P1012 (file: required).
loadEnv({ path: path.resolve(__dirname, "../.env") });

type Provider = "sqlite" | "postgresql";

function inferProviderFromUrl(url: string | undefined): Provider | null {
  if (!url) return null;
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) return "postgresql";
  return null;
}

function resolveProvider(): Provider {
  const raw = (process.env.DATABASE_PROVIDER ?? "").toLowerCase().trim();
  const fromEnv: Provider | null =
    raw === "sqlite" || raw === "postgresql" ? (raw as Provider) : null;
  const fromUrl = inferProviderFromUrl(process.env.DATABASE_URL);

  if (fromEnv && fromUrl && fromEnv !== fromUrl) {
    console.error(
      `[db:deploy] Mismatch: DATABASE_PROVIDER=${fromEnv} but DATABASE_URL looks like ${fromUrl}.\n` +
        `  Fix server/.env so they agree, e.g.:\n` +
        `    SQLite:     DATABASE_PROVIDER=sqlite\n` +
        `                DATABASE_URL="file:../../../data/madrasa.db"\n` +
        `    PostgreSQL: DATABASE_PROVIDER=postgresql\n` +
        `                DATABASE_URL="postgresql://USER:PASS@HOST:5432/DB"`
    );
    process.exit(1);
  }

  // Prefer explicit provider; otherwise infer from URL; default sqlite.
  return fromEnv ?? fromUrl ?? "sqlite";
}

const provider = resolveProvider();
const schema =
  provider === "postgresql"
    ? path.join("prisma", "schema.prisma")
    : path.join("prisma", "sqlite", "schema.prisma");

const url = process.env.DATABASE_URL ?? "(unset)";
console.log(`[db:deploy] DATABASE_PROVIDER=${provider}`);
console.log(`[db:deploy] DATABASE_URL=${url.replace(/:([^:@/]+)@/, ":***@")}`);
console.log(`[db:deploy] prisma migrate deploy --schema=${schema}`);

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", `--schema=${schema}`],
  { stdio: "inherit", shell: true, env: process.env }
);

process.exit(result.status ?? 1);
