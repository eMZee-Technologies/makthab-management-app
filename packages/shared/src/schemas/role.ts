import { z } from "zod";

// Permission keys — the full catalogue of access grants a Role can hold. Each
// key maps 1:1 to a route guard on the server (see requirePermission usage).
// Frontend still edits these as checkboxes in Phase 1; Phase 2 switches writes
// to the resource matrix. JWT + route guards keep using these legacy keys via
// matrixToLegacyKeys / legacyKeysToMatrix adapters.
export const PERMISSION_CATALOG = [
  { key: "students.manage", label: "Manage students", description: "Create, edit, and delete students" },
  { key: "classes.manage", label: "Manage classes", description: "Create, edit, and delete classes" },
  { key: "fees.manage", label: "Manage fees", description: "Record payments, defaulters, fee structures, receipts" },
  { key: "attendance.mark", label: "Mark attendance", description: "View and record student attendance" },
  { key: "finance.manage", label: "Manage finance", description: "Expenses, staff, and salaries" },
  { key: "reports.access", label: "Access reports", description: "View and download all reports" },
  { key: "users.manage", label: "Manage users", description: "Create and manage login accounts" },
  { key: "roles.manage", label: "Manage roles", description: "Create and manage roles and permissions" },
  { key: "org.manage", label: "Manage organisation", description: "Edit institution profiles and letterhead" },
  { key: "admin.access", label: "Admin tools", description: "Backups, restore, and other admin utilities" },
] as const;

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key) as [string, ...string[]];

export const permissionKeySchema = z.enum(
  PERMISSION_CATALOG.map((p) => p.key) as [string, ...string[]]
);
export type PermissionKey = z.infer<typeof permissionKeySchema>;

// ── Resource CRUD matrix (Phase 1+) ─────────────────────────────────────────

export const ACTIONS = ["view", "create", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];
export const actionSchema = z.enum(ACTIONS);

export const RESOURCE_CATALOG = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "View dashboard aggregates",
    actions: ["view"] as const,
  },
  {
    key: "students",
    label: "Students",
    description: "Student profiles and photos",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "classes",
    label: "Classes",
    description: "Classes and categories",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "fees",
    label: "Fees",
    description: "Fee structures, payments, and receipts",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "View and mark student attendance",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "finance",
    label: "Finance",
    description: "Expenses, staff, and salaries",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "reports",
    label: "Reports",
    description: "View and export reports",
    actions: ["view"] as const,
  },
  {
    key: "users",
    label: "Users",
    description: "Login accounts and approvals",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "roles",
    label: "Roles",
    description: "Roles and permission sets",
    actions: ["view", "create", "update", "delete"] as const,
  },
  {
    key: "organisation",
    label: "Organisation",
    description: "Institution profiles and letterhead",
    actions: ["view", "update"] as const,
  },
  {
    key: "admin",
    label: "Admin tools",
    description: "Backups and admin utilities",
    actions: ["view", "create"] as const,
  },
] as const;

export type ResourceKey = (typeof RESOURCE_CATALOG)[number]["key"];
export const RESOURCE_KEYS = RESOURCE_CATALOG.map((r) => r.key) as [ResourceKey, ...ResourceKey[]];

export const resourceKeySchema = z.enum(RESOURCE_KEYS);

export type ResourceDefinition = {
  key: ResourceKey;
  label: string;
  description?: string;
  actions: readonly Action[];
};

export const resourceActionsSchema = z.object({
  view: z.boolean(),
  create: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
});
export type ResourceActions = z.infer<typeof resourceActionsSchema>;

const resourcesRecordSchema = z.record(resourceKeySchema, resourceActionsSchema);

export const rolePermissionsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("matrix"),
    inheritsFromAdmin: z.boolean(),
    resources: resourcesRecordSchema,
    overrides: z.record(resourceKeySchema, resourceActionsSchema.partial()).optional(),
  }),
]);
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;

/** Legacy permission key → resource/action grants (Phase 1 dual-read adapter). */
export const LEGACY_KEY_GRANTS: Record<
  PermissionKey,
  Partial<Record<ResourceKey, readonly Action[]>>
> = {
  "students.manage": { students: ["view", "create", "update", "delete"] },
  "classes.manage": { classes: ["view", "create", "update", "delete"] },
  "fees.manage": { fees: ["view", "create", "update", "delete"] },
  "attendance.mark": { attendance: ["view", "create", "update"] },
  "finance.manage": { finance: ["view", "create", "update", "delete"] },
  "reports.access": { reports: ["view"] },
  "users.manage": { users: ["view", "create", "update", "delete"] },
  "roles.manage": { roles: ["view", "create", "update", "delete"] },
  "org.manage": { organisation: ["view", "update"] },
  "admin.access": { admin: ["view", "create"] },
};

export function emptyResourceActions(): ResourceActions {
  return { view: false, create: false, update: false, delete: false };
}

export function emptyResourceMatrix(): Record<ResourceKey, ResourceActions> {
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, emptyResourceActions()])) as Record<
    ResourceKey,
    ResourceActions
  >;
}

/** Full matrix for Admin / mode:"all" — only supported actions are true. */
export function fullResourceMatrix(): Record<ResourceKey, ResourceActions> {
  return Object.fromEntries(
    RESOURCE_CATALOG.map((r) => [
      r.key,
      {
        view: (r.actions as readonly Action[]).includes("view"),
        create: (r.actions as readonly Action[]).includes("create"),
        update: (r.actions as readonly Action[]).includes("update"),
        delete: (r.actions as readonly Action[]).includes("delete"),
      } satisfies ResourceActions,
    ])
  ) as Record<ResourceKey, ResourceActions>;
}

export function effectiveResourceMatrix(
  permissions: RolePermissions
): Record<ResourceKey, ResourceActions> {
  if (permissions.mode === "all") return fullResourceMatrix();
  // Ensure every catalog resource is present (sparse DB rows / partial edits).
  const base = emptyResourceMatrix();
  for (const key of RESOURCE_KEYS) {
    const row = permissions.resources[key];
    if (row) base[key] = { ...row };
  }
  return base;
}

/**
 * Convert legacy permission-key arrays into a RolePermissions matrix.
 * Grants `dashboard.view` when any other resource has view.
 */
export function legacyKeysToMatrix(keys: readonly string[]): RolePermissions {
  const resources = emptyResourceMatrix();
  for (const key of keys) {
    const grants = LEGACY_KEY_GRANTS[key as PermissionKey];
    if (!grants) continue;
    for (const [resource, actions] of Object.entries(grants) as [
      ResourceKey,
      readonly Action[],
    ][]) {
      for (const action of actions) {
        resources[resource][action] = true;
      }
    }
  }
  const anyOtherView = RESOURCE_KEYS.some((k) => k !== "dashboard" && resources[k].view);
  if (anyOtherView) resources.dashboard.view = true;
  return { mode: "matrix", inheritsFromAdmin: false, resources };
}

/** Convert a RolePermissions object back to legacy keys for JWT / route guards. */
export function matrixToLegacyKeys(permissions: RolePermissions): PermissionKey[] {
  if (permissions.mode === "all") return [...PERMISSION_KEYS] as PermissionKey[];
  const resources = effectiveResourceMatrix(permissions);
  const keys: PermissionKey[] = [];
  for (const legacyKey of PERMISSION_KEYS as PermissionKey[]) {
    const grants = LEGACY_KEY_GRANTS[legacyKey];
    const ok = (Object.entries(grants) as [ResourceKey, readonly Action[]][]).every(
      ([resource, actions]) => actions.every((action) => resources[resource][action])
    );
    if (ok) keys.push(legacyKey);
  }
  return keys;
}

/** Dual-read: accept legacy `string[]` or matrix object JSON from Role.permissions. */
export function parseRolePermissionsJson(raw: string): RolePermissions {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return legacyKeysToMatrix(parsed.filter((p): p is string => typeof p === "string"));
    }
    const result = rolePermissionsSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // fall through
  }
  return { mode: "matrix", inheritsFromAdmin: false, resources: emptyResourceMatrix() };
}

/** Resolve stored Role.permissions JSON to the legacy key array used by JWT guards. */
export function toLegacyPermissionKeys(raw: string): PermissionKey[] {
  return matrixToLegacyKeys(parseRolePermissionsJson(raw));
}

/** Encode for DB storage. Full-access roles always store `{ mode: "all" }`. */
export function encodeRolePermissionsForStorage(
  keys: readonly string[],
  opts?: { isFullAccess?: boolean }
): string {
  if (opts?.isFullAccess) return JSON.stringify({ mode: "all" } satisfies RolePermissions);
  return JSON.stringify(legacyKeysToMatrix(keys));
}

// RoleCreateDto — POST /roles (Phase 1 still accepts legacy key arrays).
export const roleCreateSchema = z.object({
  name: z.string().trim().min(1),
  permissions: z.array(permissionKeySchema),
});
export type RoleCreateDto = z.infer<typeof roleCreateSchema>;

// RoleUpdateDto — PATCH /roles/:id (partial). System roles reject edits to
// `name` server-side. Full-access (Admin) permission edits are rejected.
export const roleUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    permissions: z.array(permissionKeySchema),
  })
  .partial();
export type RoleUpdateDto = z.infer<typeof roleUpdateSchema>;

// Serialised Role row. `permissions` stays the legacy key array for JWT/forms;
// `permissionMatrix` is the Phase 1+ CRUD view of the same grants.
export type RoleDto = {
  id: number;
  name: string;
  permissions: string[];
  permissionMatrix: RolePermissions;
  isSystem: boolean;
  isFullAccess: boolean;
  createdAt: string;
  updatedAt: string;
};
