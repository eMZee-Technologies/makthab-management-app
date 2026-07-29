import { env } from "../lib/env";
import type { PrismaClient as PostgresPrismaClient } from "../../prisma/generated/postgres-client";

// Single shared Prisma Client instance for the whole server process, resolved
// once at startup per DATABASE_PROVIDER. This module is imported ONLY by
// server/src/db/repositories/* — route/service code must go through the
// repositories in server/src/db/index.ts instead of importing this directly.
export type DbProvider = "postgresql" | "sqlite";
export const dbProvider: DbProvider = env.databaseProvider;

// Both generated clients are structurally identical (same models, same field
// types — Decimal/Numeric conversion is deferred, see
// docs/architecture/redesign/01-multi-database-support.md §2.2/§2.4), so
// repositories type against one canonical source (Postgres) and only the
// runtime *value* is swapped here.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const generatedModule =
  dbProvider === "postgresql"
    ? require("../../prisma/generated/postgres-client")
    : require("../../prisma/generated/sqlite-client");

export const prisma: PostgresPrismaClient = new generatedModule.PrismaClient();

// The two generated clients each define their OWN PrismaClientKnownRequestError
// class — `instanceof` against a class imported from a *different* generated
// client (e.g. a static `import { Prisma } from "../../prisma/generated/postgres-client"`)
// would silently fail at runtime when DATABASE_PROVIDER=sqlite. This helper
// always checks against the class from whichever client is actually active.
const PrismaClientKnownRequestError = generatedModule.Prisma.PrismaClientKnownRequestError;

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof PrismaClientKnownRequestError &&
    (err as { code?: string }).code === "P2002"
  );
}
