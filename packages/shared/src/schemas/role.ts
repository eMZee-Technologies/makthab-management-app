import { z } from "zod";

// Permission keys — legacy catalogue mapped 1:1 to route guards. Phase 2 UI
// edits the resource matrix; JWT + guards still consume these keys via
// matrixToLegacyKeys until Phase 3 migrates guards.
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

const resourcesRecordSchema = z.object({
  dashboard: resourceActionsSchema,
  students: resourceActionsSchema,
  classes: resourceActionsSchema,
  fees: resourceActionsSchema,
  attendance: resourceActionsSchema,
  finance: resourceActionsSchema,
  reports: resourceActionsSchema,
  users: resourceActionsSchema,
  roles: resourceActionsSchema,
  organisation: resourceActionsSchema,
  admin: resourceActionsSchema,
});

export const rolePermissionsMatrixSchema = z.object({
  mode: z.literal("matrix"),
  inheritsFromAdmin: z.boolean(),
  resources: resourcesRecordSchema,
  overrides: z.record(resourceKeySchema, resourceActionsSchema.partial()).optional(),
});

export const rolePermissionsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  rolePermissionsMatrixSchema,
]);
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;
export type RolePermissionsMatrix = z.infer<typeof rolePermissionsMatrixSchema>;

/** Legacy permission key → resource/action grants (dual-read adapter). */
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

/** Admin baseline / mode:"all" effective matrix — only supported actions are true. */
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

/** Snapshot inherit baseline (Admin always has every supported action). */
export function adminBaselineMatrix(): Record<ResourceKey, ResourceActions> {
  return fullResourceMatrix();
}

export function effectiveResourceMatrix(
  permissions: RolePermissions
): Record<ResourceKey, ResourceActions> {
  if (permissions.mode === "all") return fullResourceMatrix();
  const base = emptyResourceMatrix();
  for (const key of RESOURCE_KEYS) {
    const row = permissions.resources[key];
    if (row) base[key] = { ...row };
  }
  return base;
}

export function supportedActionsFor(resource: ResourceKey): readonly Action[] {
  const def = RESOURCE_CATALOG.find((r) => r.key === resource);
  return def?.actions ?? [];
}

/** Zero unsupported actions; create/update/delete imply view. */
export function normalizeResourceRow(
  resource: ResourceKey,
  row: Partial<ResourceActions> | undefined
): ResourceActions {
  const supported = new Set(supportedActionsFor(resource));
  const next = emptyResourceActions();
  for (const action of ACTIONS) {
    next[action] = supported.has(action) ? Boolean(row?.[action]) : false;
  }
  if (next.create || next.update || next.delete) next.view = true;
  return next;
}

export function normalizeResourceMatrix(
  resources: Partial<Record<ResourceKey, Partial<ResourceActions>>> | undefined
): Record<ResourceKey, ResourceActions> {
  const next = emptyResourceMatrix();
  for (const key of RESOURCE_KEYS) {
    next[key] = normalizeResourceRow(key, resources?.[key]);
  }
  return next;
}

export function computeOverrides(
  resources: Record<ResourceKey, ResourceActions>,
  baseline: Record<ResourceKey, ResourceActions> = adminBaselineMatrix()
): Partial<Record<ResourceKey, Partial<ResourceActions>>> {
  const overrides: Partial<Record<ResourceKey, Partial<ResourceActions>>> = {};
  for (const key of RESOURCE_KEYS) {
    const diff: Partial<ResourceActions> = {};
    let any = false;
    for (const action of ACTIONS) {
      if (resources[key][action] !== baseline[key][action]) {
        diff[action] = resources[key][action];
        any = true;
      }
    }
    if (any) overrides[key] = diff;
  }
  return overrides;
}

export function isCellOverride(
  resources: Record<ResourceKey, ResourceActions>,
  resource: ResourceKey,
  action: Action,
  inheritsFromAdmin: boolean,
  baseline: Record<ResourceKey, ResourceActions> = adminBaselineMatrix()
): boolean {
  if (!inheritsFromAdmin) return false;
  if (!supportedActionsFor(resource).includes(action)) return false;
  return resources[resource][action] !== baseline[resource][action];
}

export function normalizeRolePermissions(permissions: RolePermissions): RolePermissions {
  if (permissions.mode === "all") return { mode: "all" };
  const resources = normalizeResourceMatrix(permissions.resources);
  const inheritsFromAdmin = permissions.inheritsFromAdmin;
  const overrides = inheritsFromAdmin ? computeOverrides(resources) : undefined;
  const result: RolePermissionsMatrix = {
    mode: "matrix",
    inheritsFromAdmin,
    resources,
  };
  if (overrides && Object.keys(overrides).length > 0) result.overrides = overrides;
  return result;
}

/** Toggle one cell with implication rules (mutate⇒view; clearing view clears row). */
export function setResourceAction(
  resources: Record<ResourceKey, ResourceActions>,
  resource: ResourceKey,
  action: Action,
  value: boolean
): Record<ResourceKey, ResourceActions> {
  if (!supportedActionsFor(resource).includes(action)) return resources;
  const row = { ...resources[resource] };
  if (!value && action === "view") {
    row.view = false;
    row.create = false;
    row.update = false;
    row.delete = false;
  } else {
    row[action] = value;
    if (value && action !== "view") row.view = true;
  }
  return normalizeResourceMatrix({ ...resources, [resource]: row });
}

export function selectAllResourceMatrix(): Record<ResourceKey, ResourceActions> {
  return fullResourceMatrix();
}

export function clearAllResourceMatrix(): Record<ResourceKey, ResourceActions> {
  return emptyResourceMatrix();
}

export function resetToAdminBaseline(): RolePermissionsMatrix {
  return {
    mode: "matrix",
    inheritsFromAdmin: true,
    resources: adminBaselineMatrix(),
  };
}

/**
 * Convert legacy permission-key arrays into a RolePermissions matrix.
 * Grants `dashboard.view` when any other resource has view.
 */
export function legacyKeysToMatrix(keys: readonly string[]): RolePermissionsMatrix {
  const resources = emptyResourceMatrix();
  for (const key of keys) {
    const grants = LEGACY_KEY_GRANTS[key as PermissionKey];
    if (!grants) continue;
    for (const [resource, actions] of Object.entries(grants) as [
      ResourceKey,
      readonly Action[],
    ][]) {
      for (const a of actions) {
        resources[resource][a] = true;
      }
    }
  }
  const anyOtherView = RESOURCE_KEYS.some((k) => k !== "dashboard" && resources[k].view);
  if (anyOtherView) resources.dashboard.view = true;
  return normalizeRolePermissions({
    mode: "matrix",
    inheritsFromAdmin: false,
    resources,
  }) as RolePermissionsMatrix;
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
    if (result.success) return normalizeRolePermissions(result.data);
  } catch {
    // fall through
  }
  return { mode: "matrix", inheritsFromAdmin: false, resources: emptyResourceMatrix() };
}

/** Resolve stored Role.permissions JSON to the legacy key array used by JWT guards. */
export function toLegacyPermissionKeys(raw: string): PermissionKey[] {
  return matrixToLegacyKeys(parseRolePermissionsJson(raw));
}

/** Encode a RolePermissions object for DB storage. */
export function encodeRolePermissionsObject(
  permissions: RolePermissions,
  opts?: { isFullAccess?: boolean }
): string {
  if (opts?.isFullAccess) return JSON.stringify({ mode: "all" } satisfies RolePermissions);
  if (permissions.mode === "all") {
    // Non–full-access roles must not store mode:"all".
    return JSON.stringify(
      normalizeRolePermissions({
        mode: "matrix",
        inheritsFromAdmin: false,
        resources: fullResourceMatrix(),
      })
    );
  }
  return JSON.stringify(normalizeRolePermissions(permissions));
}

/** Encode legacy keys for DB storage (Phase 1 compat). */
export function encodeRolePermissionsForStorage(
  keys: readonly string[],
  opts?: { isFullAccess?: boolean }
): string {
  if (opts?.isFullAccess) return JSON.stringify({ mode: "all" } satisfies RolePermissions);
  return JSON.stringify(legacyKeysToMatrix(keys));
}

/**
 * Resolve create/update body into a RolePermissions value to persist.
 * Prefers permissionMatrix; falls back to legacy permissions[]; else Admin
 * baseline when inheritsFromAdmin (default true on create).
 */
export function resolveRolePermissionsWrite(input: {
  permissionMatrix?: RolePermissionsMatrix;
  permissions?: readonly string[];
  inheritsFromAdmin?: boolean;
  isCreate?: boolean;
}): RolePermissionsMatrix {
  if (input.permissionMatrix) {
    const inherits =
      input.inheritsFromAdmin !== undefined
        ? input.inheritsFromAdmin
        : input.permissionMatrix.inheritsFromAdmin;
    return normalizeRolePermissions({
      ...input.permissionMatrix,
      inheritsFromAdmin: inherits,
    }) as RolePermissionsMatrix;
  }
  if (input.permissions) {
    const matrix = legacyKeysToMatrix(input.permissions);
    const inheritsFromAdmin = input.inheritsFromAdmin ?? false;
    return normalizeRolePermissions({
      ...matrix,
      inheritsFromAdmin,
    }) as RolePermissionsMatrix;
  }
  const inherits = input.inheritsFromAdmin ?? Boolean(input.isCreate);
  if (inherits) return resetToAdminBaseline();
  return {
    mode: "matrix",
    inheritsFromAdmin: false,
    resources: emptyResourceMatrix(),
  };
}

/** True when `after` removes any grant that `before` had. */
export function permissionsShrunk(before: RolePermissions, after: RolePermissions): boolean {
  const b = effectiveResourceMatrix(before);
  const a = effectiveResourceMatrix(after);
  for (const key of RESOURCE_KEYS) {
    for (const action of ACTIONS) {
      if (b[key][action] && !a[key][action]) return true;
    }
  }
  return false;
}

/**
 * Phase 3 authorization helper. Accepts a RolePermissions matrix (JWT) or a
 * legacy permission-key string[] (in-flight old tokens during rollout).
 */
export function can(
  held: RolePermissions | readonly string[] | null | undefined,
  resource: ResourceKey,
  action: Action
): boolean {
  if (!held) return false;
  if (!supportedActionsFor(resource).includes(action)) return false;
  if (Array.isArray(held)) {
    return can(legacyKeysToMatrix(held), resource, action);
  }
  const matrix = held as RolePermissions;
  if (matrix.mode === "all") return true;
  return Boolean(matrix.resources?.[resource]?.[action]);
}

export function canAny(
  held: RolePermissions | readonly string[] | null | undefined,
  resource: ResourceKey,
  actions: readonly Action[]
): boolean {
  return actions.some((action) => can(held, resource, action));
}

/** Whether held grants satisfy a legacy catalog key (for dual-read guards). */
export function allowsLegacyPermission(
  held: RolePermissions | readonly string[] | null | undefined,
  key: string
): boolean {
  if (!held) return false;
  if (Array.isArray(held)) return held.includes(key);
  const grants = LEGACY_KEY_GRANTS[key as PermissionKey];
  if (!grants) return false;
  return (Object.entries(grants) as [ResourceKey, readonly Action[]][]).every(
    ([resource, actions]) => actions.every((action) => can(held, resource, action))
  );
}

/** Normalize JWT / AuthUser held permissions into a RolePermissions object. */
export function coerceHeldPermissions(
  held:
    | RolePermissions
    | readonly string[]
    | { permissionMatrix?: RolePermissions; permissions?: readonly string[] }
    | null
    | undefined
): RolePermissions | undefined {
  if (!held) return undefined;
  if (Array.isArray(held)) return legacyKeysToMatrix(held);
  if (typeof held === "object" && held !== null && "mode" in held) {
    return held as RolePermissions;
  }
  const bag = held as { permissionMatrix?: RolePermissions; permissions?: readonly string[] };
  if (bag.permissionMatrix) return bag.permissionMatrix;
  if (bag.permissions) return legacyKeysToMatrix(bag.permissions);
  return undefined;
}

// RoleCreateDto — POST /roles. Phase 2+ prefers permissionMatrix; legacy
// permissions[] still accepted for backward compatibility.
export const roleCreateSchema = z.object({
  name: z.string().trim().min(1),
  inheritsFromAdmin: z.boolean().optional(),
  permissionMatrix: rolePermissionsMatrixSchema.optional(),
  permissions: z.array(permissionKeySchema).optional(),
});
export type RoleCreateDto = z.infer<typeof roleCreateSchema>;

// RoleUpdateDto — PATCH /roles/:id (partial).
export const roleUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    inheritsFromAdmin: z.boolean().optional(),
    permissionMatrix: rolePermissionsMatrixSchema.optional(),
    permissions: z.array(permissionKeySchema).optional(),
  })
  .partial()
  .refine(
    (d) =>
      d.name !== undefined ||
      d.permissionMatrix !== undefined ||
      d.permissions !== undefined ||
      d.inheritsFromAdmin !== undefined,
    { message: "At least one field is required" }
  );
export type RoleUpdateDto = z.infer<typeof roleUpdateSchema>;

export const roleReassignSchema = z.object({
  toRoleId: z.coerce.number().int().positive(),
});
export type RoleReassignDto = z.infer<typeof roleReassignSchema>;

export type RoleDto = {
  id: number;
  name: string;
  /** @deprecated Phase 3 — derived legacy keys for display/compat only */
  permissions: string[];
  permissionMatrix: RolePermissions;
  isSystem: boolean;
  isFullAccess: boolean;
  permissionsVersion: number;
  assignedUserCount: number;
  createdAt: string;
  updatedAt: string;
};
