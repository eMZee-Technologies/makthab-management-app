# Prisma 5 → 7 Upgrade: Impact Analysis

**Status:** Analysis only — no upgrade has been performed. The application
currently runs on **Prisma 5.19.1** (client resolves to 5.22.0), matching
`CLAUDE.md`. This document exists because of a real incident on 2026-07-28,
recorded here as primary evidence, not a hypothetical.

**Audience:** Whoever owns this decision next — could be future-me picking
this back up, could be a teammate.

---

## 0. Why this document exists (the incident)

On 2026-07-28, `node_modules` and `server/package.json` were found to have
**silently drifted** to `prisma@7.9.1` / `@prisma/client@7.9.1` — uncommitted,
undocumented, and never completed. The generated client output was still
stale v5.22.0 code (every `prisma generate` had been failing on a Windows
file-lock `EPERM` error and failing silently). Running `npx prisma studio`
surfaced the drift as `Error: The datasource property 'url' is no longer
supported in schema files`.

Attempting to migrate forward to v7 syntax (`prisma.config.ts`, schema
changes) and then running `npx prisma generate` produced a **genuinely
v7-consistent client** — which then failed to construct at all:

```
PrismaClientInitializationError: PrismaClient was instantiated without any
options. A driver adapter is required to connect to your database.
```

This broke the entire backend. The break was **silent** in the Jest suite —
`server/tests/helpers.ts`'s `loadApp()` wraps `require("../src/app")` in a
try/catch and returns `null` on any error, so `describeApi()` falls back to
`describe.skip(...)` instead of failing loudly. All 157 tests reported
"skipped," not "failed," which nearly masked a fully broken application.

A second, independent bug surfaced along the way: Prisma Studio's v7
relative-path resolution for `DATABASE_URL=file:../../data/madrasa.db`
resolved one directory level higher than the classic schema-relative
convention, **creating a new empty database file outside the repository**
(`C:\Workspaces\data\madrasa.db`). The real database was never touched
(confirmed by file size), but the stray file is direct evidence that a naive
lift-and-shift of the existing `.env`-relative `DATABASE_URL` string is not
safe under v7's config-based path resolution — it must be re-verified, not
assumed.

Both were reverted; the app is back on Prisma 5.19.1, verified working
(typecheck clean, full Jest suite 151/157 passed + 6 todo, `prisma studio`
starts cleanly). See commits `247c225` (revert) and the surrounding session
for the full incident trail.

**The takeaway:** this is not a routine dependency bump. It is a major
architectural change to how the app talks to its database, and the failure
modes are silent enough (masked test skips, wrong-path file creation) that a
rushed attempt is genuinely dangerous to data integrity and app availability.

---

## 1. Executive summary

Prisma 7 is not additive to Prisma 5 — it is a **rewrite of the client
architecture**: the classic Rust query-engine binary is gone, replaced by a
TypeScript+WASM engine that connects only through an explicitly-instantiated
**driver adapter**. Getting from 5 to 7 means passing through every breaking
change introduced in 6 as well. For this specific application, the two
highest-impact changes are:

1. **Mandatory driver adapters** — every `new PrismaClient()` call site (3 in
   this codebase, plus the shared instance 17+ routes depend on
   transitively) must be rewritten to construct and pass a SQLite adapter.
   The needed adapter, `@prisma/adapter-better-sqlite3`, wraps a **native
   Node module** (`better-sqlite3`) that needs a compiled binary — and this
   environment has already been observed blocking native postinstall scripts
   via an allow-scripts policy during this incident. That is a concrete,
   already-demonstrated installation risk, not a theoretical one.

2. **Mandatory ESM** — Prisma 7 ships ESM-only. This server is CommonJS
   top-to-bottom (`server/tsconfig.json`: `"module": "CommonJS"`, no
   `"type": "module"` anywhere in `server/` or `packages/shared/`, Jest runs
   via `ts-jest` in CJS mode). Consuming an ESM-only package from a CJS
   codebase is possible but not free — `tsx` and modern Node handle
   `import()` for ESM deps from CJS reasonably, but `ts-jest` + Prisma's own
   new import-path convention (imports become relative paths into a
   generated output folder, not a package import) needs to be verified
   working under this project's exact Jest/ts-node configuration before
   trusting it, not assumed.

Every other v6/v7 breaking change was checked against this specific schema
and codebase and found **not applicable** (details in §4) — this app doesn't
use `Buffer`/`Bytes` fields, `NotFoundError`, `$use()` middleware, MongoDB, or
any reserved model names, and its one implicit many-to-many relation
(`Class.categories` ↔ `Category.classes`) is SQLite, not the Postgres
relation table this app doesn't use. those are cleanly ruled out.

**Recommendation:** do not attempt this opportunistically or as a side
effect of an unrelated task (which is exactly how the 2026-07-28 incident
started). Treat it as its own scoped, tested, reversible piece of work — see
§7 for a phased plan. There is no urgency: Prisma 5 is not end-of-life, the
app works correctly on it today, and nothing in the current roadmap
(`docs/architecture/redesign/`) requires v7 specifically. If/when the
[multi-database support work](./redesign/01-multi-database-support.md)
moves this app to Postgres, that is the more natural moment to also take the
driver-adapter jump, since a Postgres adapter (`@prisma/adapter-pg`) has more
production mileage than the SQLite adapter and the schema/DAO layer is being
touched anyway.

---

## 2. Current state (verified 2026-07-28)

| Aspect | Value |
|---|---|
| Declared version (`server/package.json`) | `prisma@^5.19.1`, `@prisma/client@^5.19.1` |
| Actually resolved/installed | `5.22.0` |
| Generator | `provider = "prisma-client-js"` (classic, binary query engine) |
| Datasource | `sqlite`, `url = env("DATABASE_URL")` directly in `schema.prisma` |
| `prisma.config.ts` | Does not exist (not needed pre-v7) |
| Node.js installed | v24.18.0 |
| TypeScript (`server`) | `^5.5.4` |
| Module system (`server`, `packages/shared`) | CommonJS (`server/tsconfig.json`: `"module": "CommonJS"`; no `"type": "module"`) |
| Module system (`client`) | ESM (`"type": "module"` — irrelevant to Prisma, client never imports `@prisma/client`) |
| Test runner | Jest 29 via `ts-jest`, CJS-mode `jest.config.js` |
| `.gitignore` | Already contains `**/.prisma/` and `prisma/generated/` — **evidence a v7 migration was attempted once before and abandoned**, consistent with the drift found in this incident |

### 2.1 Every Prisma touchpoint in this codebase

**Direct `new PrismaClient()` instantiation (3 sites — each needs a driver adapter under v7):**

| File | Role |
|---|---|
| `server/src/lib/prisma.ts` | The single shared instance; imported by essentially every route (17+ call sites via `import { prisma } from "../lib/prisma"`) |
| `server/prisma/seed.ts` | Seed script, run via `db:seed` / auto-run by `migrate reset` |
| `server/prisma/migrate-from-xlsx.ts` | The legacy-data import script (just modified this session) |

**Type/namespace-only imports from `@prisma/client` (5 files, 6 statements — import path changes under v7's new generated-output convention, since `@prisma/client` package imports become relative imports into a generated folder):**

| File | Imports |
|---|---|
| `server/src/routes/categories.ts` | `Prisma` (namespace, for `Prisma.PrismaClientKnownRequestError`) |
| `server/src/routes/roles.ts` | `Prisma`, `Role as RoleRow` |
| `server/src/routes/users.ts` | `Prisma`, `Staff`, `User` |
| `server/src/routes/orgProfile.ts` | `OrgProfile` (type-only) |

**CLI-driven, not code-driven (behavior changes under v7 even with zero code changes):**

| npm script | Command | v7 impact |
|---|---|---|
| `db:migrate` | `prisma migrate dev` | No longer auto-runs `generate` — must add an explicit `prisma generate` step |
| `db:generate` | `prisma generate` | Unaffected in spirit, but output location and generator provider change (§3) |
| `db:seed` | `tsx prisma/seed.ts` | Unaffected directly (already explicit, not relying on CLI auto-seed) |
| `db:reset` | `prisma migrate reset --force` | **Auto-seeding after reset is removed in v7.** This script currently relies on that (`CLAUDE.md`: "npm run db:reset -w server # prisma migrate + seed"). Under v7 this becomes two steps, and `CLAUDE.md` itself needs updating. |
| Jest suite's own reset step | `DATABASE_URL="file:./test.db" npx prisma migrate reset --force` | Same auto-seed removal — the documented test setup command in `CLAUDE.md` breaks silently (DB resets, but comes back unseeded) unless updated |
| — | `npx prisma studio` | Path-resolution behavior changed (confirmed by this incident) — must be re-verified against this app's exact relative `DATABASE_URL`, not assumed safe |

**Housekeeping found during this inventory, unrelated to the version itself:**
`migrate:sheets` (`tsx prisma/migrate-from-sheets.ts`) is a dead npm script —
the target file doesn't exist (leftover from the deprecated old multi-tenant
scaffold `CLAUDE.md` already says was removed). Worth deleting regardless of
what happens with this upgrade, so it doesn't get mistaken for something the
v7 migration needs to touch.

---

## 3. What actually changes, version by version

### 3.1 Prisma 5 → 6

| Change | Applies to this app? |
|---|---|
| Node.js minimum raised (18.18+/20.9+/22.11+, no 16/17/19/21) | ✅ N/A — running Node 24.18.0 |
| TypeScript minimum 5.1.0 | ✅ N/A — running 5.5.4 |
| PostgreSQL implicit m2m relation tables switch from unique-index to primary-key | **Not applicable** — this app is SQLite, not Postgres. **Flag for later:** this app *does* have one implicit m2m relation (`Class.categories` ↔ `Category.classes`, added 2026-07-25) — if the [Postgres migration](./redesign/01-multi-database-support.md) happens before or alongside a Prisma upgrade, this specific v6 change becomes directly relevant and needs its own migration step at that time. |
| `Buffer` → `Uint8Array` for `Bytes` fields | **Not applicable** — grepped the schema, no `Bytes` fields exist (`photoPath`/`signaturePath` etc. are all `String`) |
| `NotFoundError` class removed (use `PrismaClientKnownRequestError` + code `P2025`) | **Not applicable** — grepped the codebase, `NotFoundError` is never imported or used |
| `fullTextSearch` preview flag renamed / `fullTextSearchPostgres` | **Not applicable** — no `previewFeatures` in the generator block at all |
| `async`, `await`, `using` can no longer be model names | **Not applicable** — verified against the full model list (Student, FeePayment, Attendance, Expense, Staff, SalaryPayment, Class, Category, AcademicYear, ExpenseCategory, User, OrgProfile, Role, FeeStructure) |

**Net effect of the 5→6 leg alone: zero required code changes for this app.**
This is good news but also a trap — it's tempting to conclude "the upgrade is
easy" from this leg and not budget properly for the 6→7 leg, which is where
all the real work is.

### 3.2 Prisma 6 → 7 (the substantial part)

| Change | Detail | Applies to this app? |
|---|---|---|
| **Driver adapters mandatory** | `new PrismaClient()` with no adapter throws `PrismaClientInitializationError` at construction time — confirmed directly in this incident | ✅ **Yes — 3 instantiation sites, highest-effort item** |
| **ESM-only package** | Prisma ships as ESM; `package.json` typically needs `"type": "module"`, `tsconfig` needs `"module": "ESNext"` / `"moduleResolution": "bundler"` in the conventional migration path | ✅ **Yes — server + shared are CommonJS today; this is the other highest-effort item** |
| **New generator provider + required `output`** | `provider = "prisma-client-js"` → `provider = "prisma-client"`, with a now-*required* `output` path (client no longer generates into `node_modules` by default) | ✅ Yes — schema change, plus every import site (6 statements, 5 files) changes from `from "@prisma/client"` to a relative path like `from "./generated/prisma/client"` |
| **`prisma.config.ts` required for CLI/Migrate** | `url`/`directUrl`/`shadowDatabaseUrl` deprecated directly in `schema.prisma`'s datasource block | ✅ Yes — confirmed directly in this incident (`npx prisma validate` hard-errors on the schema's `url` line under v7) |
| **Automatic seeding removed** | `migrate dev` / `migrate reset` no longer auto-run the seed script | ✅ Yes — breaks `db:reset`'s documented one-shot behavior and the Jest suite's documented setup command (§2.1) |
| **`migrate dev` / `db push` no longer auto-`generate`** | Must add an explicit `prisma generate` step to any workflow relying on the old auto-generate | ✅ Yes — affects `db:migrate` script and any future CI pipeline |
| **CLI flags removed**: `--skip-generate` (`migrate dev`, `db push`), `--skip-seed` (`migrate dev`), `--schema`/`--url` (`db execute`) | Config-file-based alternatives only | Low — not currently used in any script here, but would block a naive copy-paste of common Prisma troubleshooting advice found online, which still assumes these flags exist |
| **`migrate diff` flag renames**: `--from-url`→`--from-config-datasource`, `--to-url`→`--to-config-datasource`, `--shadow-database-url` moves to config | Not used in this codebase's scripts today | Low |
| **Environment variables not auto-loaded** | Must explicitly load `.env` (e.g. via `dotenv`) — Bun is the exception | ✅ Partially already handled — `server/src/lib/env.ts` already does `import "dotenv/config"`, and the migration/seed scripts already do the same. **But** `prisma.config.ts` itself needs its own explicit `dotenv` import at the top (confirmed directly in this incident — this was exactly right in the reverted attempt) |
| **SSL certificate validation default flips** (accept-invalid → reject-invalid) | Postgres/MySQL-relevant | **Not applicable to SQLite** — no network TLS involved. **Flag for later:** directly relevant once the [Postgres/RDS migration](./redesign/02-cloud-deployment-aws.md) happens |
| **Connection pool defaults inherited from the underlying driver, not Prisma** | Can cause new timeout behavior vs. v6 defaults | Low direct impact for SQLite (no real "pool" in the same sense), but worth a load-test sanity check post-migration regardless |
| **Client middleware (`prisma.$use()`) removed**, replaced by Client Extensions | **Not applicable** — grepped the codebase, `$use(` is never called |
| **Metrics feature removed** | **Not applicable** — not used |
| **Mapped enum values reverted to v6 behavior** (schema names, not DB-mapped values) | **Not applicable** — this schema doesn't use Prisma `enum` blocks at all (statuses/types are plain `String` columns, e.g. `feeType`, `paymentMethod`) |
| **MongoDB not supported yet in v7** | **Not applicable** — SQLite today, Postgres/Aurora planned, never MongoDB |

---

## 4. Impact analysis — mapped to concrete file changes

This is the checklist a real PR would need to satisfy. Nothing here is
speculative; every row was checked against this codebase's actual current
content during this analysis.

### 4.1 Dependencies

- [ ] `server/package.json`: bump `prisma` and `@prisma/client` to a v7.x range
- [ ] Add `better-sqlite3` (peer dependency of the adapter) and
      `@prisma/adapter-better-sqlite3` to `server/package.json`
- [ ] **Verify `better-sqlite3`'s native postinstall build actually succeeds
      in this environment.** This is not a formality — during this incident,
      the exact same class of postinstall script (`@prisma/engines`'s own
      postinstall) was blocked by an environment-level allow-scripts policy
      (`npm warn allow-scripts ... not yet covered by allowScripts`). A
      native module with a compiled binary is a strictly harder case than a
      pure-JS postinstall. Confirm this *before* committing to the adapter
      choice, or the upgrade is blocked on day one for reasons unrelated to
      Prisma itself.

### 4.2 Schema (`server/prisma/schema.prisma`)

- [ ] `generator client { provider = "prisma-client-js" }` → `provider = "prisma-client"` with a required `output` (e.g. `output = "./generated/prisma"`)
- [ ] `datasource db { ... url = env("DATABASE_URL") }` → drop the `url` line entirely (moves to `prisma.config.ts`)
- [ ] No enum/model-name/Bytes-field changes needed (§3.1 — all not applicable)

### 4.3 New file: `server/prisma.config.ts`

- [ ] Create it, `import "dotenv/config"` at the top, `defineConfig({ schema, datasource: { url: env("DATABASE_URL") }, migrations: { seed: "tsx prisma/seed.ts" } })`
- [ ] **Explicitly re-verify the relative-path resolution of `DATABASE_URL=file:../../data/madrasa.db`** against whatever base directory v7's config-driven tooling actually uses at the time of migration (this incident found it resolves differently than the classic schema-relative convention — one directory level higher, which silently created a stray file outside the repo). Do not assume this incident's specific finding still holds without re-testing on the exact adapter/config combination the migration actually uses (best) — treat "does this exact path resolve to `data/madrasa.db` inside the repo, on this exact command, from this exact cwd" as a first-class test case, run before touching the real database.

### 4.4 Code — driver adapter wiring (3 files)

- [ ] `server/src/lib/prisma.ts`: construct a `PrismaBetterSqlite3` adapter from `DATABASE_URL` (needs its own path resolution — same caution as §4.3, since this now happens in application code, at every server start, not just CLI tooling) and pass `{ adapter }` to `new PrismaClient()`
- [ ] `server/prisma/seed.ts`: same adapter wiring
- [ ] `server/prisma/migrate-from-xlsx.ts`: same adapter wiring

### 4.5 Code — import path changes (5 files, 6 statements)

- [ ] `server/src/routes/categories.ts`, `roles.ts` (×2), `users.ts` (×2), `orgProfile.ts`: `from "@prisma/client"` → `from "<relative-path-to-generated-output>"`, matching whatever `output` was set in §4.2. Consider whether this benefits from a single re-exporting module (e.g. `server/src/lib/prisma-types.ts`) so a future output-path change is a one-file edit, not a 6-statement find/replace again.

### 4.6 Module system (the open question this analysis could not fully resolve without attempting it)

- [ ] Determine whether Prisma 7's ESM-only package can be consumed from
      this server's CommonJS codebase via Node's/`tsx`'s CJS-importing-ESM
      interop *without* converting the whole server to `"type": "module"`,
      or whether a full ESM conversion is actually required. The vendor
      guidance defaults to recommending an ESM `tsconfig`/`package.json`,
      but that default assumes projects are starting closer to ESM already.
      **This must be spiked in isolation (a throwaway branch, not the real
      app) before committing to a plan**, because the answer changes the
      effort estimate by an order of magnitude:
      - If CJS-consuming-ESM interop works cleanly: mostly confined to §4.1–4.5.
      - If full ESM conversion is required: also touches `server/tsconfig.json`,
        `server/jest.config.js` (ts-jest's ESM story is its own separate can of
        worms), every relative import's extension conventions, `tsx` invocation
        flags, and possibly `packages/shared`'s build output (currently
        `"type": "commonjs"`, consumed via a Vite alias to source on the client
        side and a build step on the server side per `CLAUDE.md` — a shared-package
        module-format mismatch would break that alias trick).

### 4.7 Workflow / documentation

- [ ] `CLAUDE.md`'s `npm run db:reset -w server` comment ("prisma migrate +
      seed") needs updating for the auto-seed removal, plus the Jest setup
      instructions ("`DATABASE_URL="file:./test.db" npx prisma migrate reset
      --force` then `npx jest`") — both currently rely on the CLI
      auto-running the seed step
- [ ] `server/package.json`'s `db:reset` script itself likely needs to become
      a two-step script (`prisma migrate reset --force && npm run db:seed`)
      or equivalent, or every consumer of that script needs to know to run
      seed separately
- [ ] Delete the dead `migrate:sheets` script (§2.1) — unrelated cleanup,
      but do it in the same pass so it isn't mistaken later for something
      the v7 migration needs to handle

---

## 5. Breaking changes requiring the most careful handling

Ranked by a combination of blast radius and how silently each one fails:

1. **Driver adapter requirement.** Fails loudly at `PrismaClient`
   construction — but in this app, that construction happens at module load
   time inside `server/src/lib/prisma.ts`, imported transitively by
   `server/src/app.ts`. Any code path that does `require("../app")` (which
   is exactly what `server/tests/helpers.ts`'s `loadApp()` does) will catch
   that construction error and **silently skip instead of fail** — this is
   the single most dangerous failure mode found in this whole analysis,
   because a broken app can look like a clean, if slightly smaller, test
   run. **Any migration attempt must first patch (or temporarily disable)
   that try/catch-and-skip pattern in `helpers.ts` so a broken client fails
   the suite loudly, not quietly, for the duration of the migration.**

2. **Native module install risk (`better-sqlite3`).** Already directly
   observed blocking a *simpler* postinstall script in this exact
   environment during this incident. This should be the very first thing
   verified in any migration spike — before schema changes, before code
   changes — because if it doesn't install cleanly, the whole plan needs a
   different adapter or a different environment strategy before anything
   else is worth doing.

3. **Silent auto-seed removal.** `db:reset` currently gives one command that
   leaves you with a known-good, seeded database. Post-migration, a stale
   memory of that one-liner (by a person, or by an AI agent reading
   `CLAUDE.md` literally) produces a migrated-but-unseeded database that
   *looks* fine (schema is right, tables exist) but has no admin user, no
   classes, no expense categories — a subtle, hard-to-immediately-diagnose
   state. Fix the script and the docs in the same commit as the schema
   change, not as a follow-up.

4. **Relative `DATABASE_URL` path resolution.** Directly demonstrated in
   this incident to differ from the classic convention, in a way that
   created a file outside the repository entirely. The specific `file:../../data/madrasa.db`
   value in `.env` was designed for the classic schema-relative convention;
   it must be re-validated (not assumed) against whatever convention the
   config/adapter combination actually in use resolves relative paths
   against at migration time. Treat "point this at the real
   `data/madrasa.db` and confirm — without creating anything new" as a
   go/no-go gate before ever running Studio, migrate, or the app itself
   against the real database in the new setup.

5. **ESM/CJS boundary.** Not yet empirically resolved by this analysis (see
   §4.6) — it's the item most likely to blow the effort estimate, precisely
   because it's the one item here that wasn't already hit and directly
   observed during the 2026-07-28 incident (the incident never got that
   far — it failed at the driver-adapter step first). Spike it in isolation
   before estimating a delivery date to anyone.

---

## 6. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Native `better-sqlite3` build blocked by environment policy | **High** (already observed on a simpler package) | High — blocks the whole migration | Verify first, in isolation, before any other migration work; have a fallback adapter (`@prisma/adapter-libsql` against a local libSQL file is a documented alternative for local SQLite too) researched in advance |
| Broken app masked by silent test skips | Medium (exact mechanism already found) | Critical — could ship a broken deploy that "passed CI" | Patch `helpers.ts`'s try/catch to fail loudly for the migration branch's duration; add an explicit smoke test that asserts `loadApp()` is non-null, not just that describe blocks ran |
| Real production data touched by a path-resolution mistake | Medium (already happened once, caught before real damage) | Critical if it recurs against the real DB instead of Studio's default-DB-name fallback | Never point any new-config experiment at the real `DATABASE_URL` first — always a scratch/test DB path, with a backup taken regardless (same discipline already used in this session's earlier migration-script work) |
| ESM conversion cascades into `packages/shared` and the Vite alias trick | Medium | Medium — could ripple into the client build, which currently depends on `packages/shared` staying resolvable as CJS-aliased TS source | Spike the ESM question against `server/` in isolation first; don't touch `packages/shared`'s module type unless the spike proves it's actually required |
| `db:reset` silently leaves an unseeded DB after the change | Medium if the script/docs update is forgotten | Medium (confusing, but discoverable — login fails, not data corruption) | Update script + `CLAUDE.md` in the same commit as the schema/config change, add it to the PR's own checklist |
| Effort underestimated because the 5→6 leg is genuinely free | Medium | Low-medium (schedule slip, not correctness) | Budget explicitly against the 6→7 leg's items (§3.2), not the whole 5→7 range as if it were uniform |

---

## 7. Recommended approach (if/when this is pursued)

Not urgent — Prisma 5 works correctly today and isn't end-of-life. If/when
prioritized:

**Phase 0 — Spike (isolated branch or throwaway worktree, 1-2 days):**
Answer the two open questions this analysis couldn't resolve without
attempting them: (a) does `better-sqlite3` install cleanly in this
environment, and (b) does the ESM/CJS boundary work via interop or does it
force a full server-wide ESM conversion. Both are go/no-go gates — don't
proceed to Phase 1 until both have real answers.

**Phase 1 — Config & schema (small, mechanical):** `prisma.config.ts`,
schema's generator/datasource blocks, `.gitignore` already has the right
entries. Validate with `prisma validate` only — no client code changes yet.

**Phase 2 — Client construction (the real work):** driver adapter wiring in
the 3 instantiation sites, import-path updates in the 5 type-importing
files, patch `helpers.ts`'s silent-skip pattern for the duration.

**Phase 3 — Workflow & docs:** fix `db:reset`, fix the Jest setup docs in
`CLAUDE.md`, delete the dead `migrate:sheets` script.

**Phase 4 — Validation (the actual gate, not a formality):** full Jest suite
must genuinely *pass* (not skip), `npm run typecheck` clean across all three
workspaces, a real `prisma studio` session against a **copy** of the real DB
confirming correct path resolution, then — only after all of that — a
single supervised run against the real `data/madrasa.db` with a fresh backup
taken immediately beforehand (same discipline as this session's earlier
migration-script fix).

**Natural trigger to actually do this:** the
[multi-database support phase](./redesign/01-multi-database-support.md) of
the broader redesign work, since that phase already touches the data-access
layer and would adopt `@prisma/adapter-pg` for Postgres — a more
production-proven adapter than the SQLite one — making it more efficient to
take both changes together than to do the SQLite-adapter version now and the
Postgres-adapter version again later.

---

## 8. Rollback plan

Demonstrated and proven working during this incident, not theoretical:

1. Revert `server/package.json`'s `prisma`/`@prisma/client` version fields
   to the last known-good range.
2. Revert `schema.prisma`'s datasource block (restore `url = env("DATABASE_URL")`).
3. Delete `prisma.config.ts` (unused, harmless, but remove to avoid confusion).
4. `npm install` from the repo root to reconcile `node_modules` and
   `package-lock.json` back to the reverted versions.
5. `npx prisma generate` to produce a consistent client for the reverted version.
6. Verify: `npm run typecheck`, full Jest suite, a runtime smoke script
   confirming the real database's row counts are unchanged, `npx prisma
   studio` starting cleanly.

This exact sequence is what restored the app in this incident (commit
`247c225`) in under 30 minutes once the decision to revert was made.

---

## 9. Testing & validation plan

- **Unit/integration:** the existing Jest suite (`server/tests/*.test.ts`,
  157 tests today) is the primary gate — but only after patching the
  silent-skip pattern in `helpers.ts` for the duration of the migration, per
  §5 item 1. A green run against a skip-masked suite proves nothing.
- **Schema/config sanity:** `npx prisma validate` after every config change,
  not just once at the end.
- **Path-resolution sanity:** a dedicated, throwaway check (a one-off script
  like the ones used during this incident's investigation) that constructs
  a client against the real `DATABASE_URL` string and confirms row counts
  match a known baseline — *before* trusting any CLI tool (Studio, Migrate)
  against the real file.
- **Manual smoke:** the existing Definition-of-Done flow from
  `docs/architecture/BUILD_CONTRACT.md` §7 (login → admit student → collect
  fee with receipt PDF → mark attendance → add expense → run a report) run
  against the dev server with the new client wired in.
- **Backup discipline:** a timestamped backup of `data/madrasa.db` before
  the first — and every subsequent — attempt to point any new tooling at
  the real database, matching the pattern already established in
  `data/backups/` this session.

---

## 10. Open questions (not resolved by this analysis)

1. Does `better-sqlite3` actually install cleanly in this environment given
   the observed allow-scripts restriction? **Unknown — must be spiked.**
2. Does the ESM/CJS boundary need a full server conversion, or does
   CJS-consuming-ESM interop suffice? **Unknown — must be spiked.**
3. If a full ESM conversion is required, does it force `packages/shared` to
   also change module format, and does that break the `vite.config.ts` alias
   that lets the client resolve `@makthab/shared` to TS source directly?
   **Unknown — depends on the answer to #2.**
4. Is there a business reason to prioritize this over the
   [redesign roadmap](./redesign/00-overview-and-prioritization.md)'s
   existing phases? At the time of writing, no — nothing in that roadmap
   requires Prisma 7 specifically, and Phase 1 (multi-database support)
   would naturally absorb this work later with a more mature adapter anyway.
