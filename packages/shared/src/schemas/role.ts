import { z } from "zod";

// Permission keys — the full catalogue of access grants a Role can hold. Each
// key maps 1:1 to a route guard on the server (see requirePermission usage).
// Frontend renders these as checkboxes on the Roles page; the server validates
// role writes against this exact list.
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

// RoleCreateDto — POST /roles.
export const roleCreateSchema = z.object({
  name: z.string().trim().min(1),
  permissions: z.array(permissionKeySchema),
});
export type RoleCreateDto = z.infer<typeof roleCreateSchema>;

// RoleUpdateDto — PATCH /roles/:id (partial). System roles reject edits to
// `name` server-side, but their permissions may be adjusted.
export const roleUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    permissions: z.array(permissionKeySchema),
  })
  .partial();
export type RoleUpdateDto = z.infer<typeof roleUpdateSchema>;

// Serialised Role row. `permissions` is stored JSON-encoded server-side but
// always surfaces here as a decoded array.
export type RoleDto = {
  id: number;
  name: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};
