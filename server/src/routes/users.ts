import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  userCreateSchema,
  userUpdateSchema,
  userPasswordResetSchema,
  userListQuery,
  userApproveSchema,
  userRejectSchema,
  type UserDto,
  type UserListQuery,
  type UserApproveDto,
  type UserRejectDto,
} from "@makthab/shared";
import {
  userRepository,
  roleRepository,
  approvalAuditRepository,
  adminNotificationRepository,
  isUniqueConstraintError,
  type Staff,
  type User,
} from "../db";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody, validateQuery } from "../middleware/validate";
import { requireAuth, requireResourceAny, requireResourcePermission } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

// ---- Users (Admin only) ----------------------------------------------------
// Account/access management: stricter than /staff (no Accountant). A "user" is a
// User login joined 1:1 to a Staff record; contactNo/whatsappNo/address/photo
// live on Staff, username/email/role/status/password on User.
// Router entry allows view (and writes); mutating routes add exact action guards.
export const usersRouter = Router();
usersRouter.use(requireAuth, requireResourceAny("users", ["view", "create", "update", "delete"]));

// Flatten a User + its linked Staff into the shared UserDto shape.
function toUserDto(user: User & { staff: Staff }): UserDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
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
    const { items, total } = await userRepository.list(q);
    res.json({
      data: { items: items.map(toUserDto), total, page: q.page, limit: q.limit },
    });
  })
);

// GET /users/notifications — in-app admin alerts (signup pending, etc.).
usersRouter.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const unreadOnly = String(req.query.unreadOnly ?? "") === "true";
    const items = await adminNotificationRepository.listForUser(req.user!.sub, {
      unreadOnly,
    });
    res.json({
      data: {
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          meta: n.metaJson ? JSON.parse(n.metaJson) : null,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      },
    });
  })
);

usersRouter.post(
  "/notifications/:id/read",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await adminNotificationRepository.markRead(id, req.user!.sub);
    res.json({ data: { id, read: true } });
  })
);

usersRouter.post(
  "/",
  requireResourcePermission("users", "create"),
  validateBody(userCreateSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as typeof userCreateSchema._output;
    const roleExists = await roleRepository.findByName(dto.role);
    if (!roleExists) throw new AppError(400, "unknown_role", `Unknown role: ${dto.role}`);
    try {
      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = await userRepository.createWithStaff({
        fullName: dto.fullName,
        contactNo: dto.contactNo,
        whatsappNo: dto.whatsappNo,
        address: dto.address ?? null,
        username: dto.username,
        passwordHash,
        email: dto.email,
        phone: dto.phone ?? null,
        role: dto.role,
      });
      res.status(201).json({ data: toUserDto(user) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(409, "conflict", "Username or email already in use");
      }
      throw err;
    }
  })
);

usersRouter.patch(
  "/:id",
  requireResourcePermission("users", "update"),
  validateBody(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await userRepository.findByIdWithStaff(id);
    if (!existing) throw new AppError(404, "not_found", "User not found");

    const dto = req.body as typeof userUpdateSchema._output;
    if (dto.role !== undefined) {
      const roleExists = await roleRepository.findByName(dto.role);
      if (!roleExists) throw new AppError(400, "unknown_role", `Unknown role: ${dto.role}`);
    }
    try {
      const user = await userRepository.updateWithStaff(
        id,
        existing.staffId,
        {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
          ...(dto.contactNo !== undefined ? { contactNo: dto.contactNo } : {}),
          ...(dto.whatsappNo !== undefined ? { whatsappNo: dto.whatsappNo } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
        },
        {
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        }
      );
      res.json({ data: toUserDto(user) });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new AppError(409, "conflict", "Username or email already in use");
      }
      throw err;
    }
  })
);

// POST /users/:id/approve — activate a pending_approval signup; write audit row.
usersRouter.post(
  "/:id/approve",
  requireResourcePermission("users", "update"),
  validateBody(userApproveSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await userRepository.findByIdWithStaff(id);
    if (!existing) throw new AppError(404, "not_found", "User not found");
    if (existing.status !== "pending_approval") {
      throw new AppError(409, "invalid_status", "User is not awaiting approval");
    }
    const dto = req.body as UserApproveDto;
    const role = dto.role ?? existing.role;
    const roleExists = await roleRepository.findByName(role);
    if (!roleExists) throw new AppError(400, "unknown_role", `Unknown role: ${role}`);

    const previousStatus = existing.status;
    await userRepository.setStatus(id, "active", { role });
    if (role !== existing.staff.role) {
      await userRepository.updateWithStaff(id, existing.staffId, { role }, {});
    }
    await approvalAuditRepository.create({
      userId: id,
      actorId: req.user!.sub,
      action: "approved",
      reason: dto.note ?? null,
      previousStatus,
      newStatus: "active",
      roleAssigned: role,
    });
    const updated = await userRepository.findByIdWithStaff(id);
    res.json({ data: toUserDto(updated!) });
  })
);

// POST /users/:id/reject — reject a pending signup; write audit row.
usersRouter.post(
  "/:id/reject",
  requireResourcePermission("users", "update"),
  validateBody(userRejectSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await userRepository.findByIdWithStaff(id);
    if (!existing) throw new AppError(404, "not_found", "User not found");
    if (existing.status !== "pending_approval" && existing.status !== "pending_verification") {
      throw new AppError(409, "invalid_status", "User is not awaiting review");
    }
    const dto = req.body as UserRejectDto;
    const previousStatus = existing.status;
    const user = await userRepository.setStatus(id, "rejected");
    await approvalAuditRepository.create({
      userId: id,
      actorId: req.user!.sub,
      action: "rejected",
      reason: dto.reason,
      previousStatus,
      newStatus: "rejected",
    });
    res.json({ data: toUserDto(user) });
  })
);

// GET /users/:id/approval-audit
usersRouter.get(
  "/:id/approval-audit",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await userRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "User not found");
    const items = await approvalAuditRepository.listForUser(id);
    res.json({
      data: {
        items: items.map((a) => ({
          id: a.id,
          action: a.action,
          reason: a.reason,
          previousStatus: a.previousStatus,
          newStatus: a.newStatus,
          roleAssigned: a.roleAssigned,
          actorId: a.actorId,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    });
  })
);

// DELETE /users/:id — soft delete (User.status = inactive).
usersRouter.delete(
  "/:id",
  requireResourcePermission("users", "delete"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await userRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "User not found");
    if (req.user && req.user.sub === id) {
      throw new AppError(400, "self_action_forbidden", "You cannot deactivate your own account");
    }
    await userRepository.softDelete(id);
    res.json({ data: { id, status: "inactive" } });
  })
);

// POST /users/:id/reset-password — set a new password (Admin only).
usersRouter.post(
  "/:id/reset-password",
  requireResourcePermission("users", "update"),
  validateBody(userPasswordResetSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await userRepository.findById(id);
    if (!existing) throw new AppError(404, "not_found", "User not found");
    const dto = req.body as typeof userPasswordResetSchema._output;
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await userRepository.setPassword(id, passwordHash);
    res.json({ data: { id } });
  })
);
