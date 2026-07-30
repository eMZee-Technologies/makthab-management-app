import { dbProvider } from "./client";

// SQLite's default text comparison is effectively case-insensitive for the
// ASCII data this app stores; Postgres's `contains` is case-sensitive unless
// `mode: "insensitive"` is set (a Postgres-only Prisma option — harmless to
// omit on sqlite, so it's only added when postgresql is active). See
// docs/architecture/redesign/01-multi-database-support.md §2.4.
export function textContains(value: string) {
  return dbProvider === "postgresql"
    ? { contains: value, mode: "insensitive" as const }
    : { contains: value };
}
