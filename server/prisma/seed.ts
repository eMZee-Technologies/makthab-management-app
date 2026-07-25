import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Org profile (letterhead printed on every PDF/XLSX report) ---
  await prisma.orgProfile.upsert({
    where: { id: 1 },
    update: { isActive: true },
    create: {
      id: 1,
      name: "Masjid-O-Madarasa Umar-E-Farooq",
      address: "20th Main, 8th Cross, BTM Layout, 1st Stage, Bangalore-560068",
      isActive: true,
    },
  });
  // Backfill: if some other row was marked active, keep the single-active invariant.
  await prisma.orgProfile.updateMany({ where: { id: { not: 1 } }, data: { isActive: false } });

  // --- System roles + permission sets (regression-critical: these MUST
  // reproduce the pre-permission-system route access exactly). Keys are defined
  // in @makthab/shared PERMISSION_CATALOG; the sets below are inlined so the
  // seed is self-contained and auditable. ---
  const systemRoles: { name: string; permissions: string[] }[] = [
    {
      name: "Admin",
      permissions: [
        "students.manage",
        "classes.manage",
        "fees.manage",
        "attendance.mark",
        "finance.manage",
        "reports.access",
        "users.manage",
        "roles.manage",
        "org.manage",
        "admin.access",
      ],
    },
    { name: "Accountant", permissions: ["fees.manage", "finance.manage", "reports.access"] },
    { name: "Teacher", permissions: ["attendance.mark"] },
  ];
  for (const r of systemRoles) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: { permissions: JSON.stringify(r.permissions), isSystem: true },
      create: { name: r.name, permissions: JSON.stringify(r.permissions), isSystem: true },
    });
  }

  // --- Academic years (BUILD_CONTRACT §5) ---
  const years = [
    { name: "2024-2025", startDate: new Date("2024-06-01"), endDate: new Date("2025-05-31"), isActive: false },
    { name: "2025-2026", startDate: new Date("2025-06-01"), endDate: new Date("2026-05-31"), isActive: true },
  ];
  for (const y of years) {
    await prisma.academicYear.upsert({
      where: { name: y.name },
      update: { startDate: y.startDate, endDate: y.endDate, isActive: y.isActive },
      create: y,
    });
  }

  // --- Classes: Madrasa curriculum stages ---
  const classNames = ["Qaida", "Nazira", "Hifz"];
  for (const name of classNames) {
    await prisma.class.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // --- Expense categories (from MAKTAB study: common operational buckets) ---
  const categories = [
    "Salary",
    "Rent",
    "Utilities",
    "Stationery",
    "Books",
    "Uniform",
    "Maintenance",
    "Food",
    "Transport",
    "Miscellaneous",
  ];
  for (const name of categories) {
    await prisma.expenseCategory.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // --- Admin Staff + User login ---
  const adminStaff = await prisma.staff.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      fullName: "Administrator",
      role: "Admin",
      baseSalary: 0,
      contactNo: "0000000000",
      whatsappNo: "0000000000",
      status: "active",
    },
  });

  const adminHash = await bcrypt.hash("admin123", 12);
  await prisma.user.upsert({
    where: { username: "admin" },
    update: { passwordHash: adminHash, email: "admin@makthab.local", role: "Admin", staffId: adminStaff.id },
    create: {
      username: "admin",
      passwordHash: adminHash,
      email: "admin@makthab.local",
      role: "Admin",
      staffId: adminStaff.id,
    },
  });

  // --- Accountant Staff + User (role-guard testing) ---
  const accountantStaff = await prisma.staff.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      fullName: "Accountant",
      role: "Accountant",
      baseSalary: 0,
      contactNo: "0000000001",
      whatsappNo: "0000000001",
      status: "active",
    },
  });
  const accountantHash = await bcrypt.hash("accountant123", 12);
  await prisma.user.upsert({
    where: { username: "accountant" },
    update: { passwordHash: accountantHash, email: "accountant@makthab.local", role: "Accountant", staffId: accountantStaff.id },
    create: {
      username: "accountant",
      passwordHash: accountantHash,
      email: "accountant@makthab.local",
      role: "Accountant",
      staffId: accountantStaff.id,
    },
  });

  // --- Teacher Staff + User, assigned to Class "Nazira" (for "own classes only" tests) ---
  const teacherStaff = await prisma.staff.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      fullName: "Teacher",
      role: "Teacher",
      baseSalary: 0,
      contactNo: "0000000002",
      whatsappNo: "0000000002",
      status: "active",
    },
  });
  const teacherHash = await bcrypt.hash("teacher123", 12);
  await prisma.user.upsert({
    where: { username: "teacher" },
    update: { passwordHash: teacherHash, email: "teacher@makthab.local", role: "Teacher", staffId: teacherStaff.id },
    create: {
      username: "teacher",
      passwordHash: teacherHash,
      email: "teacher@makthab.local",
      role: "Teacher",
      staffId: teacherStaff.id,
    },
  });
  // Assign the teacher to Class "Nazira" so attendance access-control can be exercised.
  await prisma.class.update({
    where: { name: "Nazira" },
    data: { teacherId: teacherStaff.id },
  });

  console.log("Seed complete. Logins: admin/admin123, accountant/accountant123, teacher/teacher123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
