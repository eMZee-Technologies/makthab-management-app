// Re-exports the generated Prisma namespace + model types from the canonical
// (Postgres) client for callers that need them, so app code never imports
// `@prisma/client`/a generated-client path directly outside server/src/db/*.
export type {
  Prisma,
  Student,
  FeePayment,
  FeeStructure,
  Attendance,
  Expense,
  ExpenseCategory,
  Staff,
  User,
  SalaryPayment,
  Class,
  Category,
  AcademicYear,
  OrgProfile,
  Role,
  RolePermissionAudit,
  OtpChallenge,
  PasswordResetToken,
  UserApprovalAudit,
  AdminNotification,
  AuditLog,
  RefreshSession,
} from "../../prisma/generated/postgres-client";
