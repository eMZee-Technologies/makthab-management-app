// The ONLY module route/service code should import from for data access.
// Re-exports one singleton repository per entity plus the shared Prisma
// types/error helpers — nothing outside server/src/db/* should import
// `@prisma/client` or a generated-client path directly.
export { studentRepository } from "./repositories/student.repository";
export type { Student } from "./repositories/student.repository";
export { feePaymentRepository } from "./repositories/fee-payment.repository";
export type { FeePayment } from "./repositories/fee-payment.repository";
export { feeStructureRepository } from "./repositories/fee-structure.repository";
export type { FeeStructure } from "./repositories/fee-structure.repository";
export { attendanceRepository } from "./repositories/attendance.repository";
export type { Attendance } from "./repositories/attendance.repository";
export { expenseRepository } from "./repositories/expense.repository";
export type { Expense } from "./repositories/expense.repository";
export { expenseCategoryRepository } from "./repositories/expense-category.repository";
export type { ExpenseCategory } from "./repositories/expense-category.repository";
export { staffRepository } from "./repositories/staff.repository";
export type { Staff } from "./repositories/staff.repository";
export { userRepository } from "./repositories/user.repository";
export type { User } from "./repositories/user.repository";
export {
  approvalAuditRepository,
  adminNotificationRepository,
} from "./repositories/auth-extras.repository";
export { salaryPaymentRepository } from "./repositories/salary-payment.repository";
export type { SalaryPayment } from "./repositories/salary-payment.repository";
export { classRepository } from "./repositories/class.repository";
export type { Class } from "./repositories/class.repository";
export { categoryRepository } from "./repositories/category.repository";
export type { Category } from "./repositories/category.repository";
export { academicYearRepository } from "./repositories/academic-year.repository";
export type { AcademicYear } from "./repositories/academic-year.repository";
export { orgProfileRepository } from "./repositories/org-profile.repository";
export type { OrgProfile } from "./repositories/org-profile.repository";
export { roleRepository } from "./repositories/role.repository";
export type { Role } from "./repositories/role.repository";
export { rolePermissionAuditRepository } from "./repositories/role-permission-audit.repository";
export type { RolePermissionAudit } from "./repositories/role-permission-audit.repository";
export { auditLogRepository } from "./repositories/audit-log.repository";
export type { AuditLog } from "./repositories/audit-log.repository";

export { isUniqueConstraintError } from "./client";
export type { Prisma } from "./types";
