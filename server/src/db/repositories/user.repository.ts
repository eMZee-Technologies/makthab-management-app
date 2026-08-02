import { prisma } from "../client";
import type { Prisma, Staff, User } from "../types";

export const userRepository = {
  findById(id: number) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByIdWithStaff(id: number) {
    return prisma.user.findUnique({ where: { id }, include: { staff: true } });
  },

  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username }, include: { staff: true } });
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, include: { staff: true } });
  },

  findByPhone(phone: string) {
    return prisma.user.findUnique({ where: { phone }, include: { staff: true } });
  },

  // Plain create with no staff-linking transaction — finance.ts's optional
  // login-provisioning path, where the Staff row already exists.
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  },

  async list(q: {
    role?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    page: number;
    limit: number;
  }) {
    const where: Prisma.UserWhereInput = {};
    if (q.role) where.role = q.role;
    if (q.status) where.status = q.status;
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
    return { items, total };
  },

  // Atomically creates the Staff + User pair (users.ts POST). The compound
  // operation lives here (not spread across two repositories) since it's one
  // business transaction; route code never sees $transaction directly.
  createWithStaff(dto: {
    fullName: string;
    contactNo: string;
    whatsappNo: string;
    address?: string | null;
    username: string;
    passwordHash: string;
    email?: string | null;
    phone?: string | null;
    role: string;
    status?: string;
    otpMethod?: string | null;
  }) {
    return prisma.$transaction(async (tx) => {
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
      return tx.user.create({
        data: {
          username: dto.username,
          passwordHash: dto.passwordHash,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          role: dto.role,
          staffId: staff.id,
          status: dto.status ?? "active",
          otpMethod: dto.otpMethod ?? null,
        },
        include: { staff: true },
      });
    });
  },

  // Atomically updates the linked Staff fields + User fields (users.ts PATCH).
  updateWithStaff(
    id: number,
    staffId: number,
    staffData: Prisma.StaffUpdateInput,
    userData: Prisma.UserUpdateInput
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.staff.update({ where: { id: staffId }, data: staffData });
      return tx.user.update({ where: { id }, data: userData, include: { staff: true } });
    });
  },

  async softDelete(id: number): Promise<void> {
    await prisma.user.update({ where: { id }, data: { status: "inactive" } });
  },

  async setPassword(id: number, passwordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
  },

  async recordLoginFailure(id: number, maxFailures: number, lockoutMinutes: number) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return;
    const attempts = user.failedLoginAttempts + 1;
    const data: Prisma.UserUpdateInput = { failedLoginAttempts: attempts };
    if (maxFailures > 0 && attempts >= maxFailures) {
      data.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
    }
    await prisma.user.update({ where: { id }, data });
  },

  async clearLoginFailures(id: number) {
    await prisma.user.update({
      where: { id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  },

  async markVerified(id: number, channel: "email" | "sms") {
    const data: Prisma.UserUpdateInput =
      channel === "email"
        ? { emailVerifiedAt: new Date(), status: "pending_approval" }
        : { phoneVerifiedAt: new Date(), status: "pending_approval" };
    return prisma.user.update({ where: { id }, data, include: { staff: true } });
  },

  async setStatus(
    id: number,
    status: string,
    extra?: { role?: string }
  ) {
    return prisma.user.update({
      where: { id },
      data: {
        status,
        ...(extra?.role !== undefined ? { role: extra.role } : {}),
      },
      include: { staff: true },
    });
  },

  findAdminsWithManagePermission() {
    // Admins who can approve: users with role name "Admin" (seeded system role
    // holds users.manage). Fine-grained permission lookup can replace this later.
    return prisma.user.findMany({
      where: { role: "Admin", status: "active" },
      include: { staff: true },
    });
  },
};

export type { Staff, User };
