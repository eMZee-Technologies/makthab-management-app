import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { Staff, User } from "@prisma/client";
import {
  userCreateSchema,
  userUpdateSchema,
  userPasswordResetSchema,
  userListQuery,
  type UserDto,
  type UserListQuery,
} from "@makthab/shared";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requirePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// ---- Users (Admin only) ----------------------------------------------------
// Account/access management: stricter than /staff (no Accountant). A "user" is a
// User login joined 1:1 to a Staff record; contactNo/whatsappNo/address/photo
// live on Staff, username/email/role/status/password on User.
export const usersRouter = Router();
usersRouter.use(requireAuth, requirePermission("users.manage"));

// Flatten a User + its linked Staff into the shared UserDto shape.
function toUserDto(user: User & { staff: Staff }): UserDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    staffId: user.staffId,
    fullName: user.staff.fullName,
    contactNo: user.staff.contactNo,
    whatsappNo: user.staff.whatsappNo,
    address: user.staff.address,
    photoPath: user.staff.photoPath,
    signaturePath: user.staff.signaturePath,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

usersRouter.get(
  "/",
  validateQuery(userListQuery),
  asyncHandler(async (_req, res) => {
    const q = res.locals.query as UserListQuery;
    const where: Prisma.UserWhereInput = {};
    if (q.role) where.role = q.role;
    if (q.status) where.status = q.status;
    // fullName sorts on the joined Staff record; every other field is on User.
    const orderBy: Prisma.UserOrderByWithRelationInput = q.sortBy
      ? q.sortBy === "fullName"
        ? { staff: { fullName: q.sortOrder } }
        : { [q.sortBy]: q.sortOrder }
      : { username: "asc" };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { staff: true },
        orderBy,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.user.count({ where }),
    ]);
    res.json({
      data: { items: items.map(toUserDto), total, page: q.page, limit: q.limit },
    });
  })
);

usersRouter.post(
  "/",
  validateBody(userCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof userCreateSchema._output;
    const roleExists = await prisma.role.findUnique({ where: { name: dto.role } });
    if (!roleExists) throw new AppError(400, "unknown_role", `Unknown role: ${dto.role}`);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const staff = await tx.staff.create({
          data: {
            fullName: dto.fullName,
            role: dto.role,
            baseSalary: 0,
            contactNo: dto.contactNo,
            whatsappNo: dto.whatsappNo,
            address: dto.address ?? null,
            status: "active",
          },
        });
        const passwordHash = await bcrypt.hash(dto.password, 12);
        return tx.user.create({
          data: {
            username: dto.username,
            passwordHash,
            email: dto.email,
            role: dto.role,
            staffId: staff.id,
            status: "active",
          },
          include: { staff: true },
        });
      });
      res.status(201).json({ data: toUserDto(user) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "conflict", "Username or email already in use");
      }
      throw err;
    }
  })
);

usersRouter.patch(
  "/:id",
  validateBody(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id }, include: { staff: true } });
    if (!existing) throw new AppError(404, "not_found", "User not found");

    const dto = req.body as typeof userUpdateSchema._output;
    if (dto.role !== undefined) {
      const roleExists = await prisma.role.findUnique({ where: { name: dto.role } });
      if (!roleExists) throw new AppError(400, "unknown_role", `Unknown role: ${dto.role}`);
    }
    try {
      const user = await prisma.$transaction(async (tx) => {
        await tx.staff.update({
          where: { id: existing.staffId },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
            ...(dto.contactNo !== undefined ? { contactNo: dto.contactNo } : {}),
            ...(dto.whatsappNo !== undefined ? { whatsappNo: dto.whatsappNo } : {}),
            ...(dto.address !== undefined ? { address: dto.address } : {}),
          },
        });
        return tx.user.update({
          where: { id },
          data: {
            ...(dto.email !== undefined ? { email: dto.email } : {}),
            ...(dto.role !== undefined ? { role: dto.role } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
          },
          include: { staff: true },
        });
      });
      res.json({ data: toUserDto(user) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "conflict", "Username or email already in use");
      }
      throw err;
    }
  })
);

// DELETE /users/:id — soft delete (User.status = inactive). The linked Staff row
// is left untouched (it's still the actor referenced by past fee/attendance/
// expense records). Deactivating an already-inactive user is a deliberate
// idempotent no-op that still returns 200 with the same shape (not a 409): a
// repeat call (double-click, retry) should succeed quietly rather than error.
usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "User not found");
    if (req.user && req.user.sub === id) {
      throw new AppError(400, "self_action_forbidden", "You cannot deactivate your own account");
    }
    await prisma.user.update({ where: { id }, data: { status: "inactive" } });
    res.json({ data: { id, status: "inactive" } });
  })
);

// POST /users/:id/reset-password — set a new password (Admin only). The hash is
// never echoed back.
usersRouter.post(
  "/:id/reset-password",
  validateBody(userPasswordResetSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "not_found", "User not found");
    const dto = req.body as typeof userPasswordResetSchema._output;
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    res.json({ data: { id } });
  })
);
