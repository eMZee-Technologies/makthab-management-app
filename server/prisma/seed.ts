import "dotenv/config";
import bcrypt from "bcryptjs";
import { encodeRolePermissionsForStorage } from "@makthab/shared";

// Standalone CLI script (run via `tsx prisma/seed.ts`), outside the Express
// app — resolves its own provider-appropriate client rather than going
// through server/src/db/client.ts (an app-layer module).
const provider = process.env.DATABASE_PROVIDER ?? "sqlite";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } =
  provider === "postgresql" ? require("./generated/postgres-client") : require("./generated/sqlite-client");
const prisma = new PrismaClient();

const isProd = (process.env.NODE_ENV ?? "development") === "production";

/**
 * Resolve a bootstrap login password.
 * - development: falls back to the documented default when env is unset
 * - production required=true: env must be set, ≥12 chars, not the dev default
 * - production required=false: returns null when unset (skip creating that user)
 */
function seedPassword(
  envName: string,
  devDefault: string,
  opts: { required: boolean } = { required: true }
): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv !== "") {
    if (isProd && fromEnv === devDefault) {
      throw new Error(
        `${envName} must not equal the development default ("${devDefault}") in production`
      );
    }
    if (isProd && fromEnv.length < 12) {
      throw new Error(`${envName} must be at least 12 characters in production`);
    }
    return fromEnv;
  }
  if (isProd) {
    if (opts.required) {
      throw new Error(
        `Missing ${envName}: required when seeding with NODE_ENV=production (do not use development defaults)`
      );
    }
    return null;
  }
  return devDefault;
}

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
  // reproduce the pre-permission-system route access exactly). Storage uses
  // RolePermissions JSON (`{ mode: "all" }` for Admin; matrix for others).
  // Legacy key sets below stay the source of truth for Accountant/Teacher and
  // are converted via @makthab/shared adapters so JWT guards stay unchanged.
  const systemRoles: { name: string; permissions: string[]; isFullAccess: boolean }[] = [
    {
      name: "Admin",
      isFullAccess: true,
      // Listed for auditability; storage uses { mode: "all" } when isFullAccess.
      permissions: [
        "students.manage",
        "classes.manage",
        "fees.manage",
        "attendance.mark",
        "progress.manage",
        "finance.manage",
        "reports.access",
        "users.manage",
        "roles.manage",
        "org.manage",
        "admin.access",
      ],
    },
    {
      name: "Accountant",
      isFullAccess: false,
      permissions: ["fees.manage", "finance.manage", "reports.access"],
    },
    {
      name: "Teacher",
      isFullAccess: false,
      permissions: ["attendance.mark", "progress.manage"],
    },
  ];
  for (const role of systemRoles) {
    const permissionsJson = encodeRolePermissionsForStorage(role.permissions, {
      isFullAccess: role.isFullAccess,
    });
    await prisma.role.upsert({
      where: { name: role.name },
      update: {
        permissions: permissionsJson,
        isSystem: true,
        isFullAccess: role.isFullAccess,
      },
      create: {
        name: role.name,
        permissions: permissionsJson,
        isSystem: true,
        isFullAccess: role.isFullAccess,
      },
    });
  }

  // --- Academic years + classes + expense categories (reference data) ---
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

  for (const name of ["Nazira", "Hifz", "Aalim"]) {
    await prisma.class.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const name of [
    "Utilities",
    "Maintenance",
    "Supplies",
    "Food",
    "Transport",
    "Miscellaneous",
  ]) {
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

  const adminPassword = seedPassword("SEED_ADMIN_PASSWORD", "admin123", { required: true })!;
  const adminHash = await bcrypt.hash(adminPassword, 12);
  // Never overwrite passwordHash on update — re-running seed (or a mistaken
  // FORCE_RESEED) must not reset a rotated production password back to a
  // known value.
  await prisma.user.upsert({
    where: { username: "admin" },
    update: { email: "admin@makthab.local", role: "Admin", staffId: adminStaff.id },
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
  // Accountant / Teacher logins are always created in development (fixed
  // passwords for the Jest role-guard suite). In production they are only
  // created when the matching SEED_*_PASSWORD is explicitly provided.
  const accountantPassword = seedPassword("SEED_ACCOUNTANT_PASSWORD", "accountant123", {
    required: false,
  });
  if (accountantPassword) {
    const accountantHash = await bcrypt.hash(accountantPassword, 12);
    await prisma.user.upsert({
      where: { username: "accountant" },
      update: { email: "accountant@makthab.local", role: "Accountant", staffId: accountantStaff.id },
      create: {
        username: "accountant",
        passwordHash: accountantHash,
        email: "accountant@makthab.local",
        role: "Accountant",
        staffId: accountantStaff.id,
      },
    });
  }

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
  const teacherPassword = seedPassword("SEED_TEACHER_PASSWORD", "teacher123", { required: false });
  if (teacherPassword) {
    const teacherHash = await bcrypt.hash(teacherPassword, 12);
    await prisma.user.upsert({
      where: { username: "teacher" },
      update: { email: "teacher@makthab.local", role: "Teacher", staffId: teacherStaff.id },
      create: {
        username: "teacher",
        passwordHash: teacherHash,
        email: "teacher@makthab.local",
        role: "Teacher",
        staffId: teacherStaff.id,
      },
    });
  }
  // Assign the teacher to Class "Nazira" so attendance access-control can be exercised.
  await prisma.class.update({
    where: { name: "Nazira" },
    data: { teacherId: teacherStaff.id },
  });

  // Postgres SERIAL sequences aren't advanced by explicit-id inserts (unlike
  // SQLite's rowid tracking), so later auto-generated inserts would collide
  // with the hardcoded ids above (e.g. Staff id 1/2/3) unless resynced here.
  // Table names are fixed literals (not user input) — use tagged $executeRaw.
  if (provider === "postgresql") {
    await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('"OrgProfile"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "OrgProfile"))`;
    await prisma.$executeRaw`SELECT setval(pg_get_serial_sequence('"Staff"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "Staff"))`;
  }

  if (isProd) {
    console.log("Seed complete. Bootstrap users created/ensured (passwords taken from SEED_*_PASSWORD env; existing hashes not overwritten).");
  } else {
    console.log("Seed complete. Logins: admin/admin123, accountant/accountant123, teacher/teacher123");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
