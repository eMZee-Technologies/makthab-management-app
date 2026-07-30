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
    email: string;
    role: string;
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
          email: dto.email,
          role: dto.role,
          staffId: staff.id,
          status: "active",
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
    await prisma.user.update({ where: { id }, data: { passwordHash } });
  },
};

export type { Staff, User };
