#!/usr/bin/env tsx
/**
 * Apply pending Prisma migrations for the active DATABASE_PROVIDER.
 *
 * Usage (from repo root):  npm run db:deploy -w server
 * Postgres only:           npm run db:deploy:pg -w server
 * SQLite only:             npm run db:deploy:sqlite -w server
 */
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

type Provider = "sqlite" | "postgresql";

/** Resolve server/ whether invoked from repo root or server/. */
function serverRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "prisma", "schema.prisma"))) return cwd;
  if (fs.existsSync(path.join(cwd, "server", "prisma", "schema.prisma"))) {
    return path.join(cwd, "server");
  }
  // tsx/__dirname fallback: this file lives in server/prisma/
  return path.resolve(__dirname, "..");
}

const root = serverRoot();
const envPath = path.join(root, ".env");

if (!fs.existsSync(envPath)) {
  console.error(
    `[db:deploy] No .env at ${envPath}\n` +
      `  Copy server/.env.example → server/.env and set Postgres values for docker compose:\n` +
      `    DATABASE_PROVIDER=postgresql\n` +
      `    DATABASE_URL="postgresql://postgres:postgres@localhost:5434/makthab_dev"`
  );
  process.exit(1);
}

// override:true so a stale shell DATABASE_PROVIDER=sqlite cannot win over .env
const loaded = loadEnv({ path: envPath, override: true });
if (loaded.error) {
  console.error(`[db:deploy] Failed to load ${envPath}:`, loaded.error);
  process.exit(1);
}
console.log(`[db:deploy] loaded env from ${envPath}`);

function inferProviderFromUrl(url: string | undefined): Provider | null {
  if (!url) return null;
  const trimmed = url.trim().replace(/^"|"$/g, "");
  if (trimmed.startsWith("file:")) return "sqlite";
  if (trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://")) {
    return "postgresql";
  }
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
        `  Edit ${envPath} so both agree.\n` +
        `  Docker Compose Postgres (host):\n` +
        `    DATABASE_PROVIDER=postgresql\n` +
        `    DATABASE_URL="postgresql://postgres:postgres@localhost:5434/makthab_dev"\n` +
        `  Or force Postgres migrate:  npm run db:deploy:pg -w server`
    );
    process.exit(1);
  }

  return fromEnv ?? fromUrl ?? "sqlite";
}

const provider = resolveProvider();
const schema =
  provider === "postgresql"
    ? path.join(root, "prisma", "schema.prisma")
    : path.join(root, "prisma", "sqlite", "schema.prisma");

const url = (process.env.DATABASE_URL ?? "(unset)").replace(/^"|"$/g, "");
console.log(`[db:deploy] DATABASE_PROVIDER=${provider}`);
console.log(`[db:deploy] DATABASE_URL=${url.replace(/:([^:@/]+)@/, ":***@")}`);
console.log(`[db:deploy] prisma migrate deploy --schema=${schema}`);

if (provider === "postgresql" && !/^postgres(ql)?:\/\//.test(url)) {
  console.error(
    `[db:deploy] PostgreSQL requires DATABASE_URL starting with postgresql://\n` +
      `  For docker compose up (port 5434):\n` +
      `  DATABASE_URL="postgresql://postgres:postgres@localhost:5434/makthab_dev"`
  );
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", `--schema=${schema}`],
  {
    stdio: "inherit",
    shell: true,
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_PROVIDER: provider,
    },
  }
);

process.exit(result.status ?? 1);
