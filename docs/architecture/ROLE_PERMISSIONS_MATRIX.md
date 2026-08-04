# Role Permissions Matrix — Migration Plan

Implementable plan to evolve Makthab’s Roles page from coarse permission keys
(`students.manage`, …) to a **per-resource CRUD matrix** (View / Create / Update /
Delete), with Admin full-access by default and explicit overrides for other roles.

**Status:** Phase 3 implemented (audit, reassignment, matrix JWT/guards, shrink invalidation)  
**Related:** `packages/shared/src/schemas/role.ts`, `client/src/features/roles/*`,
`server/src/routes/roles.ts`, `server/prisma/schema.prisma` (`Role`),
`docs/architecture/BUILD_CONTRACT.md` §6

---

## 0. Current state (baseline)

| Layer | Today |
| --- | --- |
| Storage | `Role.permissions` = JSON `string[]` of catalog keys |
| Catalog | 10 coarse keys in `PERMISSION_CATALOG` |
| System roles | `Admin`, `Accountant`, `Teacher` (`isSystem: true`) |
| Custom roles | Supported; name unique; permissions editable |
| Auth | Permissions resolved at login/refresh and **baked into JWT** |
| Guards | `requirePermission(key)` server-side; `RequirePermission` + nav client-side |
| Roles UI | Checkbox list of catalog keys in `RoleForm` dialog |

**Gap vs target:** no View/Create/Update/Delete granularity, no inheritance model,
no matrix UI, Admin permissions can still be stripped today (risky).

---

## 1. Data model

### 1.1 Resources (pages / entities)

Map **one resource row per product surface** that needs access control. Keys are
stable API identifiers; labels are UI-facing.

| Resource key | Page / area | Notes |
| --- | --- | --- |
| `dashboard` | `/` | View only (read aggregates) |
| `students` | `/students` | CRUD; photo upload = Update |
| `classes` | `/classes` (+ categories) | CRUD; categories share this resource |
| `fees` | `/fees` | CRUD (structures, payments, receipts) |
| `attendance` | `/attendance` | View + Create/Update (mark); Delete optional/rare |
| `finance` | `/finance` | Expenses, staff, salaries |
| `reports` | `/reports` | View (+ “export” treated as View for MVP). **Also authorizes GET reads on `/fees`, `/expenses`, and `/salaries`** used by the Reports page tables (`requireModuleAccessOrReportsView`). |
| `users` | `/users` | CRUD + approve/reject as Update |
| `roles` | `/roles` | CRUD on role definitions |
| `organisation` | `/organisation` | View + Update (profiles/letterhead) |
| `admin` | Backup / admin tools | View + Create (run backup) — no Delete |

> Do **not** invent product roles named Editor/Viewer unless product asks.
> Keep seeded roles **Admin / Accountant / Teacher** + **Custom** (user-defined).

### 1.2 Actions

```ts
type Action = "view" | "create" | "update" | "delete";
```

Semantics:

- **view** — list/detail/read endpoints and page route visibility  
- **create** — POST create  
- **update** — PATCH/PUT and “mark” / “approve” style mutations  
- **delete** — DELETE / soft-delete  

Implication rules (enforced in Zod + UI):

1. `create | update | delete` ⇒ `view` must be true (auto-enable view).  
2. Resources without a meaningful action stay `false` and UI shows disabled/N/A
   (e.g. `dashboard.delete`, `reports.create`).

### 1.3 Role record (target shape)

```ts
type ResourceActions = {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

type RolePermissions =
  | { mode: "all" } // Admin (and any locked full-access role)
  | {
      mode: "matrix";
      inheritsFromAdmin: boolean; // default true for new custom roles
      resources: Record<ResourceKey, ResourceActions>;
      // Optional sparse overrides when inheritsFromAdmin=true:
      // only keys present here differ from the Admin baseline snapshot
      // OR from live Admin matrix (see §3 inheritance).
      overrides?: Partial<Record<ResourceKey, Partial<ResourceActions>>>;
    };

type Role = {
  id: number;
  name: string;           // "Admin" | "Accountant" | "Teacher" | custom
  isSystem: boolean;
  isFullAccess: boolean;  // true for Admin; cannot be cleared
  permissions: RolePermissions;
  createdAt: string;
  updatedAt: string;
};
```

### 1.4 Admin defaults

- Seed / migrate **Admin** as `{ mode: "all" }` **or** an explicit matrix with
  every resource/action `true`. Prefer `{ mode: "all" }` so new resources
  automatically grant Admin without a data migration.
- `isFullAccess: true` for Admin only (at least one required — see validation).
- Admin row: **not deletable**, **not renameable**, permissions **not reducible**.

### 1.5 Storage options (recommendation)

**Phase 1–2 (MVP):** keep `Role.permissions` as a JSON string column; change the
encoded shape from `string[]` → `RolePermissions` object. Add columns:

```prisma
model Role {
  id           Int      @id @default(autoincrement())
  name         String   @unique
  permissions  String   // JSON RolePermissions
  isSystem     Boolean  @default(false)
  isFullAccess Boolean  @default(false) // Admin lock
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

**Phase 3 (optional normalize):** split into `RolePermission` rows
`(roleId, resource, action, allowed)` if reporting/audit needs SQL queries.
Not required for MVP.

### 1.6 Example schema (pseudo-JSON)

```json
{
  "roles": [
    {
      "id": 1,
      "name": "Admin",
      "isSystem": true,
      "isFullAccess": true,
      "permissions": { "mode": "all" }
    },
    {
      "id": 2,
      "name": "Accountant",
      "isSystem": true,
      "isFullAccess": false,
      "permissions": {
        "mode": "matrix",
        "inheritsFromAdmin": false,
        "resources": {
          "dashboard":   { "view": true,  "create": false, "update": false, "delete": false },
          "students":    { "view": true,  "create": false, "update": false, "delete": false },
          "classes":     { "view": true,  "create": false, "update": false, "delete": false },
          "fees":        { "view": true,  "create": true,  "update": true,  "delete": false },
          "attendance":  { "view": false, "create": false, "update": false, "delete": false },
          "finance":     { "view": true,  "create": true,  "update": true,  "delete": false },
          "reports":     { "view": true,  "create": false, "update": false, "delete": false },
          "users":       { "view": false, "create": false, "update": false, "delete": false },
          "roles":       { "view": false, "create": false, "update": false, "delete": false },
          "organisation":{ "view": false, "create": false, "update": false, "delete": false },
          "admin":       { "view": false, "create": false, "update": false, "delete": false }
        }
      }
    },
    {
      "id": 3,
      "name": "Teacher",
      "isSystem": true,
      "isFullAccess": false,
      "permissions": {
        "mode": "matrix",
        "inheritsFromAdmin": false,
        "resources": {
          "dashboard":   { "view": true,  "create": false, "update": false, "delete": false },
          "students":    { "view": true,  "create": false, "update": false, "delete": false },
          "classes":     { "view": true,  "create": false, "update": false, "delete": false },
          "fees":        { "view": false, "create": false, "update": false, "delete": false },
          "attendance":  { "view": true,  "create": true,  "update": true,  "delete": false },
          "finance":     { "view": false, "create": false, "update": false, "delete": false },
          "reports":     { "view": false, "create": false, "update": false, "delete": false },
          "users":       { "view": false, "create": false, "update": false, "delete": false },
          "roles":       { "view": false, "create": false, "update": false, "delete": false },
          "organisation":{ "view": false, "create": false, "update": false, "delete": false },
          "admin":       { "view": false, "create": false, "update": false, "delete": false }
        }
      }
    },
    {
      "id": 4,
      "name": "Fee Clerk",
      "isSystem": false,
      "isFullAccess": false,
      "permissions": {
        "mode": "matrix",
        "inheritsFromAdmin": true,
        "resources": {
          /* effective matrix after applying overrides onto Admin baseline */
        },
        "overrides": {
          "fees":  { "view": true, "create": true, "update": true, "delete": false },
          "roles": { "view": false, "create": false, "update": false, "delete": false }
        }
      }
    }
  ]
}
```

---

## 2. UI/UX design

### 2.1 Roles page layout

Keep the existing roles **table** (name, permission summary, system badge, actions).
Replace the checkbox dialog with a **Permission Matrix** editor:

```
┌─────────────────────────────────────────────────────────────┐
│ Role: Accountant                    [Inherit from Admin ▢]  │
│ Bulk: [Select all] [Clear all] [Reset to Admin baseline]    │
├──────────────┬──────┬────────┬────────┬────────┤
│ Resource     │ View │ Create │ Update │ Delete │
├──────────────┼──────┼────────┼────────┼────────┤
│ Students     │  ☑   │   ☐    │   ☐    │   ☐    │  ← inherited chip if inherit
│ Fees         │  ☑   │   ☑    │   ☑    │   ☐    │  ← “Override” chip when differs
│ …            │      │        │        │        │
└──────────────┴──────┴────────┴────────┴────────┘
│ [Cancel]                                      [Save]        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Controls

| Control | Behavior |
| --- | --- |
| Checkbox / switch | Toggle one cell |
| Inherit from Admin | When on: cells mirror Admin; edits create **overrides** and mark cells |
| Override indicator | Subtle text/chip on cells that differ from Admin baseline (not a floating badge on hero — row-level muted label) |
| Select all / Clear all | Per current role matrix (respect N/A cells) |
| Reset to Admin baseline | Clears overrides; restores inherit snapshot |
| Admin row | Entire matrix read-only; all checked; Save disabled for permission edits |

### 2.3 Validation in UI (before submit)

- Block unchecking any Admin cell / block turning off `isFullAccess` on Admin.  
- Warn if saving would leave **zero** full-access roles (hard block on server).  
- Auto-check `view` when create/update/delete is checked.  
- Disable N/A actions per resource config.  
- Confirm dialog when reducing permissions that affect N users assigned to the role.

### 2.4 Accessibility / RTL

- Matrix must work under Arabic/RTL (logical `start`/`end` alignment).  
- Keyboard: Tab across cells; Space toggles.  
- Use existing shadcn `Checkbox` / `Switch` + table patterns from Roles page.

---

## 3. Behavior and rules

### 3.1 Inheritance

**Default for new custom roles:** `inheritsFromAdmin: true`.

Two supported modes:

1. **Snapshot inherit (recommended MVP):** on create (or when toggling inherit on),
   copy Admin’s effective matrix into `resources`. Overrides store deltas.
   Admin later changing does **not** cascade (predictable; no surprise lockouts).
2. **Live inherit (Phase 3 optional):** effective = merge(Admin.live, overrides).
   Requires careful cache invalidation on Admin changes.

Plan default: **snapshot inherit** + explicit “Reset to Admin baseline” action.

### 3.2 Propagation to users

Today permissions are **JWT-baked**. Rules:

1. Changing a role’s matrix does **not** mutate `User` rows (users store role **name**).  
2. Effective access updates on **next access-token refresh** (or login).  
3. To avoid stale grants after a privilege reduction:
   - Phase 2: document “up to access-token TTL”.  
   - Phase 3: bump a `Role.version` / `permissionsVersion`; refresh endpoint
     re-resolves permissions; optionally revoke refresh tokens for users of that
     role when privileges are **reduced**.

Do **not** break existing access for users whose role was unchanged. Only users
on the edited role see a new effective set after refresh.

### 3.3 Guard mapping (runtime)

Introduce a shared helper:

```ts
can(permissions: EffectiveMatrix | "all", resource: ResourceKey, action: Action): boolean
```

Replace route guards gradually:

| Old key | New checks |
| --- | --- |
| `students.manage` | `students.create` / `update` / `delete` (view via auth + view) |
| `classes.manage` | `classes.*` |
| `fees.manage` | `fees.*` |
| `attendance.mark` | `attendance.view` + `attendance.create`/`update` |
| `finance.manage` | `finance.*` |
| `reports.access` | `reports.view` |
| `users.manage` | `users.*` |
| `roles.manage` | `roles.*` |
| `org.manage` | `organisation.view` / `update` |
| `admin.access` | `admin.view` / `create` |

Client: `RequirePermission` accepts `{ resource, action }` (keep temporary
compat shim for old string keys during migration).

### 3.4 API contract

**Catalog**

```
GET /api/v1/roles/resources
→ { data: ResourceDefinition[] }
```

```ts
type ResourceDefinition = {
  key: ResourceKey;
  label: string;
  description?: string;
  actions: Action[]; // supported actions only
};
```

**List / get** (permissions decoded as `RolePermissions`)

```
GET /api/v1/roles
GET /api/v1/roles/:id
→ { data: RoleDto | RoleDto[] }
```

**Create**

```
POST /api/v1/roles
Body: {
  name: string;
  inheritsFromAdmin?: boolean; // default true
  permissions?: {
    mode: "matrix";
    resources: Record<ResourceKey, ResourceActions>;
    overrides?: ...;
  }
}
→ 201 { data: RoleDto }
```

If `inheritsFromAdmin` and no `permissions`, server fills matrix from Admin baseline.

**Update permissions**

```
PATCH /api/v1/roles/:id
Body: {
  name?: string; // forbidden for system roles
  inheritsFromAdmin?: boolean;
  permissions?: RolePermissions; // Admin rejects mode!="all" / any false cell
}
→ { data: RoleDto }
```

**Delete** — unchanged; system + full-access roles forbidden.

**Effective permissions for current user** (optional helper)

```
GET /api/v1/auth/me/permissions
→ { data: { mode: "all" } | { resources: {...} } }
```

Errors use existing envelope `{ error: { code, message, details? } }` with **HTTP 400**
for validation (Makthab convention).

| code | When |
| --- | --- |
| `validation_error` | Zod failure / implication rules |
| `system_role` | Rename/delete Admin or other system constraints |
| `admin_lock` | Attempt to reduce Admin / last full-access role |
| `conflict` | Duplicate role name |
| `not_found` | Unknown role id |
| `forbidden` | Missing `roles` update permission |

---

## 4. Implementation plan (phased)

### Phase 1 — MVP (read-only matrix for review)

**Goal:** New model visible; no privilege regression; Admin locked full.

1. **Shared:** define `RESOURCE_CATALOG`, `Action`, `RolePermissions` Zod schemas;
   keep legacy `PERMISSION_CATALOG` + adapter `legacyKeysToMatrix` / `matrixToLegacyKeys`.
2. **DB:** migrate seed Admin → `{ mode: "all" }`, Accountant/Teacher → matrices
   matching today’s keys; set `isFullAccess` on Admin.
3. **API:** `GET /roles` returns new shape (or dual: `permissions` + `permissionMatrix`);
   `GET /roles/resources` catalog endpoint.
4. **UI:** Roles editor shows **read-only** matrix for all roles; Admin clearly locked;
   existing checkbox save path still works **or** save disabled with “coming in Phase 2”.
5. **Guards:** still enforce legacy keys via adapter so runtime behavior unchanged.
6. **Tests:** seed shape + adapter round-trips; Admin always `mode: "all"`.

**Exit criteria:** typecheck green; Roles page shows matrix; login/RBAC unchanged.

### Phase 2 — Interactive toggles + inheritance + bulk

1. Enable matrix editing for non–full-access roles.  
2. Inherit toggle, override chips, Select all / Clear all / Reset baseline.  
3. Client + server validation (view implication, Admin lock, ≥1 full-access).  
4. Persist via `PATCH /roles/:id` with new schema.  
5. Adapter still emits legacy keys into JWT **or** JWT starts carrying matrix
   (prefer matrix in token once guards updated).  
6. Update `RoleForm` UX; i18n keys for resources/actions.

**Exit criteria:** can create “Fee Clerk” with fees CRUD only; Teacher/Accountant editable;
Admin immutable.

### Phase 3 — Persist hardening, audit, reassignment

1. **Audit log:** `RolePermissionAudit { id, roleId, actorUserId, before, after, createdAt }`
   on every successful PATCH.  
2. **User impact:** on save, show assigned user count; optional force-refresh /
   revoke refresh tokens when permissions **shrink**.  
3. **Reassignment:** deleting a custom role blocked if users assigned (or require
   target role); add `POST /roles/:id/reassign { toRoleId }`.  
4. Replace remaining `requireRole("Admin")` hardcodes (e.g. finance) with matrix
   checks; fix client `StudentsPage` `role === 'Admin'` → `students.update`.  
5. Update `BUILD_CONTRACT.md` §6 + changelog; remove legacy key catalog once
   all guards migrated.  
6. Authorization Jest suite per resource/action.

**Exit criteria:** no legacy keys in JWT; audit trail; contract docs updated;
integration tests cover deny paths.

---

## 5. Validation & error handling

### 5.1 Server rules (authoritative)

1. At least one role with `isFullAccess` / `permissions.mode === "all"`.  
2. Admin (`name === "Admin"` or `isFullAccess`): cannot delete, rename, or store
   any `false` action.  
3. System roles: cannot delete; cannot rename.  
4. Unknown resource/action keys rejected.  
5. Implication: mutating actions require `view`.  
6. Cannot assign users a role that does not exist.  
7. Custom role delete: reject if any `User.role === name` (until reassign API exists).

### 5.2 Client rules

- Mirror server rules for instant feedback.  
- Toast on API errors via `extractApiError`.  
- Dirty-state guard when closing matrix editor.

### 5.3 Deployment notes

- **Backward compatible deploy:** ship adapter so old JWTs (legacy string[]) and
  new matrices both resolve during one release window.  
- Run `npm run build:shared` before server build (workspace gotcha).  
- Migration script idempotent: detect `Array.isArray(JSON.parse(permissions))`
  → convert; detect already-migrated object → skip.  
- Seed re-run: Admin always repaired to full access.  
- Access-token TTL: after privilege drop, expect old tokens until expiry unless
  Phase 3 revocation is enabled — call this out in release notes.  
- SQLite + Postgres dual schema: apply migration to both histories
  (`server/prisma/migrations` and `server/prisma/sqlite/migrations`) per
  multi-DB contract.  
- No downtime required for single-tenant SQLite deploy; take backup via existing
  admin backup before migrate.

---

## 6. Migration steps (replacing current permission system)

### 6.1 Key → matrix mapping

| Legacy key | Grants |
| --- | --- |
| `students.manage` | students: view, create, update, delete |
| `classes.manage` | classes: view, create, update, delete |
| `fees.manage` | fees: view, create, update, delete |
| `attendance.mark` | attendance: view, create, update |
| `finance.manage` | finance: view, create, update, delete |
| `reports.access` | reports: view |
| `users.manage` | users: view, create, update, delete |
| `roles.manage` | roles: view, create, update, delete |
| `org.manage` | organisation: view, update |
| `admin.access` | admin: view, create |

Also grant `dashboard.view` to every role that has any other view (or to all
authenticated users — match current nav: dashboard always visible when logged in).

### 6.2 Procedure

1. Backup `data/madrasa.db`.  
2. Deploy code with dual-read parser (`string[]` **or** matrix object).  
3. Run data migration: convert every `Role.permissions` row; set Admin
   `isFullAccess` + `{ mode: "all" }`.  
4. Deploy UI Phase 1 (read-only matrix).  
5. Verify Accountant/Teacher effective access unchanged (smoke: login each role).  
6. Enable Phase 2 writes behind same `/roles` permission.  
7. Migrate route guards resource-by-resource; keep adapter until coverage = 100%.  
8. Drop legacy catalog + dual-read; update BUILD_CONTRACT.  
9. Add audit + token invalidation (Phase 3).

### 6.3 Rollback

- Keep previous `permissions` JSON in audit or a `permissionsLegacy` backup column
  for one release.  
- Rollback app build + restore DB backup if matrix parse fails in production.

---

## 7. Testing checklist

- Unit: adapter legacy ↔ matrix; implication rules; Admin lock.  
- API: PATCH Admin → 400 `admin_lock`; clear last full-access → 400; custom CRUD.  
- Integration: Teacher can mark attendance, cannot POST fees; Accountant opposite.  
- Client: matrix keyboard + RTL; bulk select; inherit override chips.  
- Auth: refresh picks up new matrix after role edit.

---

## 8. Open decisions (defaults assumed above)

| Topic | Assumed default | Alternate |
| --- | --- | --- |
| Inherit semantics | Snapshot + Reset | Live merge from Admin |
| Token payload | Move to matrix in Phase 2 | Keep legacy keys via adapter longer |
| Reports export | Covered by `view` | Add `export` action |
| Finance sub-resources | Single `finance` row | Split expenses / staff / salaries |
| Editor/Viewer presets | Not seeded | Optional template roles |

No blockers — implementation can start Phase 1 with these defaults. Revisit
finance split and live inherit only if product requires finer control.
