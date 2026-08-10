/**
 * Client-side FORM schemas.
 *
 * The canonical API-contract schemas live in `@makthab/shared` and are what
 * Backend validates against. Those schemas expect already-typed JSON values
 * (numbers, Dates); HTML form controls emit strings. This module composes
 * form-friendly schemas that COERCE strings and REUSE the shared enum schemas,
 * so enum values (gender, feeType, paymentMethod, status…) can never drift
 * from the server contract. Payloads produced here conform to the matching
 * shared DTO at runtime (dates are ISO strings, which the server coerces).
 */
import { z } from 'zod';
import {
  genderSchema,
  feeTypeSchema,
  paymentMethodSchema,
  attendanceStatusSchema,
  studentStatusSchema,
  contributorTypeSchema,
  moodEngagementSchema,
} from '@makthab/shared';

const requiredDate = z.string().min(1, 'Required');

export const studentCreateSchema = z.object({
  admissionNo: z.string().trim().min(1, 'Required'),
  fullName: z.string().trim().min(1, 'Required'),
  fatherName: z.string().trim().min(1, 'Required'),
  dateOfBirth: requiredDate,
  gender: genderSchema,
  contactNo: z.string().trim().min(7, 'Enter a valid number'),
  whatsappNo: z.string().trim().min(7, 'Enter a valid number'),
  address: z.string().trim().optional(),
  classId: z.coerce.number().int().positive('Select a class'),
  // Always resolves to number|null (never undefined) so the PATCH body carries an
  // explicit categoryId — an omitted key makes the server keep the old category
  // and reject the move to a class that doesn't offer it.
  categoryId: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
  academicYearId: z.coerce.number().int().positive('Select a year'),
  status: studentStatusSchema.default('active'),
});
export type StudentCreateInput = z.infer<typeof studentCreateSchema>;

export const classCreateSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
  teacherId: z
    .preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive())
    .optional(),
  categoryIds: z.array(z.coerce.number()).default([]),
});
export type ClassCreateInput = z.infer<typeof classCreateSchema>;

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const feePaymentCreateSchema = z.object({
  studentId: z.coerce.number().int().positive('Select a student'),
  feeType: feeTypeSchema,
  feeMonth: z.coerce.number().int().min(1).max(12).optional(),
  feeYear: z.coerce.number().int().min(2000).max(2100),
  amountDue: z.coerce.number().nonnegative(),
  amountPaid: z.coerce.number().nonnegative(),
  waiverAmount: z.coerce.number().nonnegative().default(0),
  paymentDate: requiredDate,
  paymentMethod: paymentMethodSchema,
});
export type FeePaymentCreateInput = z.infer<typeof feePaymentCreateSchema>;

export const defaulterUpdateSchema = z.object({
  amountDue: z.coerce.number().nonnegative(),
});
export type DefaulterUpdateInput = z.infer<typeof defaulterUpdateSchema>;

export const feeStructureCreateSchema = z.object({
  classId: z.coerce.number().int().positive('Select a class'),
  categoryId: z
    .preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive())
    .optional(),
  academicYearId: z.coerce.number().int().positive('Select a year'),
  feeType: feeTypeSchema,
  amount: z.coerce.number().nonnegative(),
});
export type FeeStructureCreateInput = z.infer<typeof feeStructureCreateSchema>;

export const attendanceRecordSchema = z.object({
  studentId: z.number().int().positive(),
  status: attendanceStatusSchema,
  notes: z.string().optional(),
});
export type AttendanceRecordInput = z.infer<typeof attendanceRecordSchema>;

export const expenseCreateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Select a category'),
  cost: z.coerce.number().positive('Enter a valid cost'),
  quantity: z.coerce.number().positive('Enter a valid quantity'),
  expenseDate: requiredDate,
  payee: z.string().trim().min(1, 'Required'),
  description: z.string().optional(),
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

export const staffCreateSchema = z.object({
  fullName: z.string().trim().min(1, 'Required'),
  role: z.string().trim().min(1, 'Required'),
  baseSalary: z.coerce.number().nonnegative(),
  contactNo: z.string().trim().min(7, 'Enter a valid number'),
  whatsappNo: z.string().trim().min(7, 'Enter a valid number'),
  status: studentStatusSchema.default('active'),
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const userCreateSchema = z.object({
  fullName: z.string().trim().min(1, 'Required'),
  username: z.string().trim().min(3, 'At least 3 characters'),
  password: z.string().min(6, 'At least 6 characters'),
  email: z.string().trim().email('Enter a valid email'),
  role: z.string().trim().min(1, 'Required'),
  contactNo: z.string().trim().min(7, 'Enter a valid number'),
  whatsappNo: z.string().trim().min(7, 'Enter a valid number'),
  address: z.string().trim().optional(),
  status: studentStatusSchema.default('active'),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

// Edit mode: username is fixed, password is reset via a separate flow, so
// everything is optional. `status` still flows through PATCH for reactivation.
export const userUpdateSchema = userCreateSchema.partial();
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userPasswordResetSchema = z
  .object({
    password: z.string().min(6, 'At least 6 characters'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type UserPasswordResetInput = z.infer<typeof userPasswordResetSchema>;

export const orgProfileCreateSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
  address: z.string().trim().min(1, 'Required'),
});
export type OrgProfileCreateInput = z.infer<typeof orgProfileCreateSchema>;

export const roleCreateSchema = z.object({
  name: z.string().trim().min(1, 'Required'),
  inheritsFromAdmin: z.boolean().optional(),
  permissionMatrix: z
    .object({
      mode: z.literal('matrix'),
      inheritsFromAdmin: z.boolean(),
      resources: z.record(
        z.string(),
        z.object({
          view: z.boolean(),
          create: z.boolean(),
          update: z.boolean(),
          delete: z.boolean(),
        }),
      ),
      overrides: z.record(z.string(), z.record(z.string(), z.boolean()).optional()).optional(),
    })
    .optional(),
  permissions: z.array(z.string()).optional(),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const salaryPaymentCreateSchema = z.object({
  staffId: z.coerce.number().int().positive('Select a staff member'),
  salaryMonth: z.coerce.number().int().min(1).max(12),
  salaryYear: z.coerce.number().int().min(2000).max(2100),
  grossAmount: z.coerce.number().nonnegative(),
  deductions: z.coerce.number().nonnegative().default(0),
  paymentDate: requiredDate,
});
export type SalaryPaymentCreateInput = z.infer<typeof salaryPaymentCreateSchema>;

/** Form coercion for contributions — reuses shared contributorTypeSchema. */
export const contributionCreateSchema = z.object({
  amount: z.coerce.number().positive('Enter a valid amount'),
  contributorName: z.string().trim().min(1, 'Required'),
  contributorType: contributorTypeSchema,
  date: requiredDate,
  notes: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().optional()),
  whatsappNo: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.string().trim().min(7, 'Enter a valid number').optional(),
  ),
});
export type ContributionCreateInput = z.infer<typeof contributionCreateSchema>;

const optionalText = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z.string().trim().nullable().optional(),
);

/** Monthly student progress form — coerces HTML strings; enums from shared. */
export const monthlyProgressFormSchema = z.object({
  studentId: z.coerce.number().int().positive('Select a student'),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  hoursStudied: z.coerce.number().min(0, 'Must be ≥ 0').max(744),
  topicsCovered: z.string().trim().min(1, 'Required'),
  assessments: z.string().trim().min(1, 'Required'),
  attendanceDays: z.coerce.number().int().min(0).max(31),
  moodEngagement: moodEngagementSchema,
  goals: z.string().trim().min(1, 'Required'),
  notes: z.string().trim().min(1, 'Required'),
  previousMonthComparison: optionalText,
  progressPercent: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number().min(0).max(100).nullable().optional(),
  ),
  assignmentsCompleted: optionalText,
  softSkills: optionalText,
  reminders: optionalText,
  nextSteps: optionalText,
  linksText: z.preprocess(
    (v) => (v === '' || v == null ? '' : v),
    z.string().optional(),
  ),
});
export type MonthlyProgressFormInput = z.infer<typeof monthlyProgressFormSchema>;
