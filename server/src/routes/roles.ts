import { Router } from "express";
import {
  roleCreateSchema,
  roleUpdateSchema,
  roleReassignSchema,
  RESOURCE_CATALOG,
  encodeRolePermissionsObject,
  parseRolePermissionsJson,
  resolveRolePermissionsWrite,
  permissionsShrunk,
  toLegacyPermissionKeys,
  type RoleDto,
  type RoleCreateDto,
  type RoleUpdateDto,
  type RoleReassignDto,
  type RolePermissions,
} from "@makthab/shared";
import {
  roleRepository,
  rolePermissionAuditRepository,
  userRepository,
  isUniqueConstraintError,
  type Role as RoleRow,
} from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requireResourcePermission, requireResourceAny } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// Role + permission management. Module access requires any roles.* action;
// writes use finer requireResourcePermission checks.
export const rolesRouter = Router();
rolesRouter.use(requireAuth, requireResourceAny("roles", ["view", "create", "update", "delete"]));

async function toDto(row: RoleRow, assignedUserCount?: number): Promise<RoleDto> {
  const permissionMatrix = parseRolePermissionsJson(row.permissions);
  const count =
    assignedUserCount ?? (await userRepository.countByRole(row.name));
  return {
    id: row.id,
    name: row.name,
    permissions: toLegacyPermissionKeys(row.permissions),
    permissionMatrix,
    isSystem: row.isSystem,
    isFullAccess: row.isFullAccess,
    permissionsVersion: row.permissionsVersion,
    assignedUserCount: count,
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

async function writeAudit(input: {
  roleId: number | null;
  actorUserId: number;
  action: "create" | "update" | "delete" | "reassign";
  before?: RolePermissions | null;
  after?: RolePermissions | null;
  meta?: Record<string, unknown>;
}) {
  await rolePermissionAuditRepository.create({
    roleId: input.roleId,
    actorUserId: input.actorUserId,
    action: input.action,
    beforeJson: input.before ? JSON.stringify(input.before) : null,
    afterJson: input.after ? JSON.stringify(input.after) : null,
    metaJson: input.meta ? JSON.stringify(input.meta) : null,
  });
}

// GET /roles/resources
rolesRouter.get(
  "/resources",
  requireResourcePermission("roles", "view"),
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

rolesRouter.get(
  "/",
  requireResourcePermission("roles", "view"),
  asyncHandler(async (_req, res) => {
    const items = await roleRepository.findAll();
    const counts = await userRepository.countByRoles(items.map((r) => r.name));
    res.json({
      data: await Promise.all(items.map((row) => toDto(row, counts[row.name] ?? 0))),
    });
  })
);

rolesRouter.get(
  "/:id/audit",
  requireResourcePermission("roles", "view"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await roleRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Role not found");
    const items = await rolePermissionAuditRepository.listForRole(id);
    res.json({
      data: items.map((a) => ({
        id: a.id,
        roleId: a.roleId,
        actorUserId: a.actorUserId,
        action: a.action,
        before: a.beforeJson ? JSON.parse(a.beforeJson) : null,
        after: a.afterJson ? JSON.parse(a.afterJson) : null,
        meta: a.metaJson ? JSON.parse(a.metaJson) : null,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  })
);

rolesRouter.post(
  "/",
  requireResourcePermission("roles", "create"),
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
        permissionsVersion: 0,
      });
      await writeAudit({
        roleId: row.id,
        actorUserId: req.user!.sub,
        action: "create",
        before: null,
        after: permissionMatrix,
      });
      res.status(201).json({ data: await toDto(row, 0) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(409, "conflict", "A role with that name already exists");
      }
      throw err;
    }
  })
);

rolesRouter.patch(
  "/:id",
  requireResourcePermission("roles", "update"),
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

    const beforeMatrix = parseRolePermissionsJson(existing.permissions);
    let permissionsJson: string | undefined;
    let afterMatrix: RolePermissions | undefined;
    let nextVersion = existing.permissionsVersion;

    if (hasPermissionWrite(dto)) {
      afterMatrix = resolveRolePermissionsWrite({
        permissionMatrix:
          dto.permissionMatrix ??
          (beforeMatrix.mode === "matrix" ? beforeMatrix : undefined),
        permissions: dto.permissions,
        inheritsFromAdmin:
          dto.inheritsFromAdmin ??
          (beforeMatrix.mode === "matrix" ? beforeMatrix.inheritsFromAdmin : false),
      });
      permissionsJson = encodeRolePermissionsObject(afterMatrix);
      if (permissionsShrunk(beforeMatrix, afterMatrix)) {
        nextVersion = existing.permissionsVersion + 1;
      }
    }

    try {
      const row = await roleRepository.update(id, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(permissionsJson !== undefined
          ? { permissions: permissionsJson, permissionsVersion: nextVersion }
          : {}),
      });
      if (afterMatrix) {
        await writeAudit({
          roleId: row.id,
          actorUserId: req.user!.sub,
          action: "update",
          before: beforeMatrix,
          after: afterMatrix,
          meta: permissionsShrunk(beforeMatrix, afterMatrix)
            ? { permissionsVersion: nextVersion, shrunk: true }
            : { permissionsVersion: nextVersion },
        });
      }
      res.json({ data: await toDto(row) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(409, "conflict", "A role with that name already exists");
      }
      throw err;
    }
  })
);

// POST /roles/:id/reassign — move all users from this role onto another role.
rolesRouter.post(
  "/:id/reassign",
  requireResourcePermission("roles", "update"),
  validateBody(roleReassignSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await roleRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Role not found");
    if (existing.isSystem || existing.isFullAccess) {
      throw new AppError(400, "system_role", "System roles cannot be reassigned away");
    }

    const dto = req.body as RoleReassignDto;
    if (dto.toRoleId === id) {
      throw new AppError(400, "validation_error", "Target role must be different");
    }
    const target = await roleRepository.findById(dto.toRoleId);
    if (!target) throw new AppError(404, "not_found", "Target role not found");

    const result = await userRepository.reassignRoleName(existing.name, target.name);
    await writeAudit({
      roleId: existing.id,
      actorUserId: req.user!.sub,
      action: "reassign",
      before: parseRolePermissionsJson(existing.permissions),
      after: parseRolePermissionsJson(target.permissions),
      meta: {
        toRoleId: target.id,
        toRoleName: target.name,
        usersMoved: result.users,
        staffMoved: result.staff,
      },
    });
    res.json({
      data: {
        fromRoleId: existing.id,
        toRoleId: target.id,
        usersMoved: result.users,
        staffMoved: result.staff,
      },
    });
  })
);

rolesRouter.delete(
  "/:id",
  requireResourcePermission("roles", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await roleRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "Role not found");
    if (existing.isSystem || existing.isFullAccess) {
      throw new AppError(400, "system_role", "System roles cannot be deleted");
    }
    const assigned = await userRepository.countByRole(existing.name);
    if (assigned > 0) {
      throw new AppError(
        400,
        "role_in_use",
        `Role has ${assigned} assigned user(s); reassign them before deleting`
      );
    }
    const before = parseRolePermissionsJson(existing.permissions);
    await writeAudit({
      roleId: existing.id,
      actorUserId: req.user!.sub,
      action: "delete",
      before,
      after: null,
      meta: { roleName: existing.name },
    });
    await roleRepository.delete(id);
    res.json({ data: { id } });
  })
);
