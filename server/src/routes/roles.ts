import { Router } from "express";
import {
  roleCreateSchema,
  roleUpdateSchema,
  PERMISSION_CATALOG,
  RESOURCE_CATALOG,
  encodeRolePermissionsForStorage,
  parseRolePermissionsJson,
  toLegacyPermissionKeys,
  type RoleDto,
} from "@makthab/shared";
import { roleRepository, isUniqueConstraintError, type Role as RoleRow } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// Role + permission management (Admin / roles.manage). Roles are DB-backed; the
// three seeded roles (Admin/Accountant/Teacher) are isSystem and cannot be
// deleted or renamed. Admin is isFullAccess and cannot have permissions reduced.
// Permission edits take effect on the affected user's next login or token
// refresh (permissions are baked into the access token as legacy keys).
export const rolesRouter = Router();
rolesRouter.use(requireAuth, requirePermission("roles.manage"));

function toDto(row: RoleRow): RoleDto {
  const permissionMatrix = parseRolePermissionsJson(row.permissions);
  return {
    id: row.id,
    name: row.name,
    permissions: toLegacyPermissionKeys(row.permissions),
    permissionMatrix,
    isSystem: row.isSystem,
    isFullAccess: row.isFullAccess,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /roles/resources — resource × action catalogue for the permission matrix UI.
// Declared before parameterised routes so "resources" isn't captured as an :id.
rolesRouter.get(
  "/resources",
  asyncHandler(async (_req, res) => {
    res.json({
      data: RESOURCE_CATALOG.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        actions: [...r.actions],
      })),
    });
  })
);

// GET /roles/permissions — the legacy permission-key catalogue for Roles UI
// checkboxes (key + label + description). Declared before any parameterised
// route so "permissions" isn't captured as an :id.
rolesRouter.get(
  "/permissions",
  asyncHandler(async (_req, res) => {
    res.json({ data: PERMISSION_CATALOG });
  })
);

rolesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await roleRepository.findAll();
    res.json({ data: items.map(toDto) });
  })
);

rolesRouter.post(
  "/",
  validateBody(roleCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof roleCreateSchema._output;
    try {
      const row = await roleRepository.create({
        name: dto.name,
        permissions: encodeRolePermissionsForStorage(dto.permissions),
        isSystem: false,
        isFullAccess: false,
      });
      res.status(201).json({ data: toDto(row) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(409, "conflict", "A role with that name already exists");
      }
      throw err;
    }
  })
);

// PATCH /roles/:id — edit a role. System roles may have their permission set
// adjusted (except full-access Admin) but cannot be renamed.
rolesRouter.patch(
  "/:id",
  validateBody(roleUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await roleRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Role not found");

    const dto = req.body as typeof roleUpdateSchema._output;
    if (existing.isSystem && dto.name !== undefined && dto.name !== existing.name) {
      throw new AppError(400, "system_role", "System roles cannot be renamed");
    }
    if (existing.isFullAccess && dto.permissions !== undefined) {
      throw new AppError(400, "admin_lock", "Full-access role permissions cannot be changed");
    }
    try {
      const row = await roleRepository.update(id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.permissions !== undefined
          ? {
              permissions: encodeRolePermissionsForStorage(dto.permissions, {
                isFullAccess: existing.isFullAccess,
              }),
            }
          : {}),
      });
      res.json({ data: toDto(row) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(409, "conflict", "A role with that name already exists");
      }
      throw err;
    }
  })
);

// DELETE /roles/:id — remove a custom role. System / full-access roles are protected.
rolesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await roleRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Role not found");
    if (existing.isSystem || existing.isFullAccess) {
      throw new AppError(400, "system_role", "System roles cannot be deleted");
    }
    await roleRepository.delete(id);
    res.json({ data: { id } });
  })
);
