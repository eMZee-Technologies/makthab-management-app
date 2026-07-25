import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { Role as RoleRow } from "@prisma/client";
import {
  roleCreateSchema,
  roleUpdateSchema,
  PERMISSION_CATALOG,
  type RoleDto,
} from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// Role + permission management (Admin / roles.manage). Roles are DB-backed; the
// three seeded roles (Admin/Accountant/Teacher) are isSystem and cannot be
// deleted or renamed. Permission edits take effect on the affected user's next
// login or token refresh (permissions are baked into the access token).
export const rolesRouter = Router();
rolesRouter.use(requireAuth, requirePermission("roles.manage"));

function toDto(row: RoleRow): RoleDto {
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(row.permissions);
    if (Array.isArray(parsed)) permissions = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    permissions = [];
  }
  return {
    id: row.id,
    name: row.name,
    permissions,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /roles/permissions — the permission-key catalogue for the Roles UI
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
    const items = await prisma.role.findMany({ orderBy: { name: "asc" } });
    res.json({ data: items.map(toDto) });
  })
);

rolesRouter.post(
  "/",
  validateBody(roleCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof roleCreateSchema._output;
    try {
      const row = await prisma.role.create({
        data: { name: dto.name, permissions: JSON.stringify(dto.permissions), isSystem: false },
      });
      res.status(201).json({ data: toDto(row) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "conflict", "A role with that name already exists");
      }
      throw err;
    }
  })
);

// PATCH /roles/:id — edit a role. System roles may have their permission set
// adjusted but cannot be renamed (their name is the link to User.role).
rolesRouter.patch(
  "/:id",
  validateBody(roleUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Role not found");

    const dto = req.body as typeof roleUpdateSchema._output;
    if (existing.isSystem && dto.name !== undefined && dto.name !== existing.name) {
      throw new AppError(400, "system_role", "System roles cannot be renamed");
    }
    try {
      const row = await prisma.role.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.permissions !== undefined ? { permissions: JSON.stringify(dto.permissions) } : {}),
        },
      });
      res.json({ data: toDto(row) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "conflict", "A role with that name already exists");
      }
      throw err;
    }
  })
);

// DELETE /roles/:id — remove a custom role. System roles are protected.
rolesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.role.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "Role not found");
    if (existing.isSystem) {
      throw new AppError(400, "system_role", "System roles cannot be deleted");
    }
    await prisma.role.delete({ where: { id } });
    res.json({ data: { id } });
  })
);
