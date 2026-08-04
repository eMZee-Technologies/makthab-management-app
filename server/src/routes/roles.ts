import { Router } from "express";
import {
  roleCreateSchema,
  roleUpdateSchema,
  PERMISSION_CATALOG,
  RESOURCE_CATALOG,
  encodeRolePermissionsObject,
  parseRolePermissionsJson,
  resolveRolePermissionsWrite,
  toLegacyPermissionKeys,
  type RoleDto,
  type RoleCreateDto,
  type RoleUpdateDto,
} from "@makthab/shared";
import { roleRepository, isUniqueConstraintError, type Role as RoleRow } from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// Role + permission management (Admin / roles.manage). Roles are DB-backed; the
// three seeded roles (Admin/Accountant/Teacher) are isSystem and cannot be
// deleted or renamed. Admin is isFullAccess and cannot have permissions reduced.
// Phase 2 writes accept permissionMatrix (preferred) or legacy permissions[].
// JWT still carries legacy keys via matrixToLegacyKeys.
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

function hasPermissionWrite(dto: RoleCreateDto | RoleUpdateDto): boolean {
  return (
    dto.permissionMatrix !== undefined ||
    dto.permissions !== undefined ||
    dto.inheritsFromAdmin !== undefined
  );
}

// GET /roles/resources — resource × action catalogue for the permission matrix UI.
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

// GET /roles/permissions — legacy permission-key catalogue (compat).
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
    const dto = req.body as RoleCreateDto;
    const permissionMatrix = resolveRolePermissionsWrite({
      permissionMatrix: dto.permissionMatrix,
      permissions: dto.permissions,
      inheritsFromAdmin: dto.inheritsFromAdmin,
      isCreate: true,
    });
    try {
      const row = await roleRepository.create({
        name: dto.name,
        permissions: encodeRolePermissionsObject(permissionMatrix),
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

// PATCH /roles/:id — edit a role. System roles cannot be renamed. Full-access
// Admin cannot have permissions changed.
rolesRouter.patch(
  "/:id",
  validateBody(roleUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await roleRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Role not found");

    const dto = req.body as RoleUpdateDto;
    if (existing.isSystem && dto.name !== undefined && dto.name !== existing.name) {
      throw new AppError(400, "system_role", "System roles cannot be renamed");
    }
    if (existing.isFullAccess && hasPermissionWrite(dto)) {
      throw new AppError(400, "admin_lock", "Full-access role permissions cannot be changed");
    }

    let permissionsJson: string | undefined;
    if (hasPermissionWrite(dto)) {
      // Merge inheritsFromAdmin onto existing matrix when only the flag flips.
      const existingMatrix = parseRolePermissionsJson(existing.permissions);
      const permissionMatrix = resolveRolePermissionsWrite({
        permissionMatrix:
          dto.permissionMatrix ??
          (existingMatrix.mode === "matrix" ? existingMatrix : undefined),
        permissions: dto.permissions,
        inheritsFromAdmin:
          dto.inheritsFromAdmin ??
          (existingMatrix.mode === "matrix" ? existingMatrix.inheritsFromAdmin : false),
      });
      permissionsJson = encodeRolePermissionsObject(permissionMatrix);
    }

    try {
      const row = await roleRepository.update(id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(permissionsJson !== undefined ? { permissions: permissionsJson } : {}),
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
