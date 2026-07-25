import { z } from "zod";
import { feeTypeSchema, paymentMethodSchema, sortOrderSchema } from "./common";

// FeePaymentCreateDto — POST /fees
export const feePaymentCreateSchema = z.object({
  studentId: z.number().int().positive(),
  feeType: feeTypeSchema,
  feeMonth: z.number().int().min(1).max(12).nullable().optional(),
  feeYear: z.number().int().min(2000).max(2100),
  amountDue: z.number().nonnegative(),
  amountPaid: z.number().nonnegative(),
  paymentDate: z.coerce.date(),
  paymentMethod: paymentMethodSchema,
  waiverAmount: z.number().nonnegative().default(0),
});
export type FeePaymentCreateDto = z.infer<typeof feePaymentCreateSchema>;

// FeePaymentUpdateDto — PATCH /fees/:id (all fields optional; receiptNo stays immutable server-side).
export const feePaymentUpdateSchema = feePaymentCreateSchema.partial();
export type FeePaymentUpdateDto = z.infer<typeof feePaymentUpdateSchema>;

// GET /fees query params
export const feeSortField = z.enum([
  "receiptNo",
  "feeType",
  "amountPaid",
  "paymentDate",
  "student",
  "admissionNo",
]);
export type FeeSortField = z.infer<typeof feeSortField>;

export const feeListQuery = z.object({
  student_id: z.coerce.number().int().positive().optional(),
  feeType: feeTypeSchema.optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().optional(),
  status: z.enum(["paid", "unpaid"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: feeSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
});
export type FeeListQuery = z.infer<typeof feeListQuery>;

// GET /fees/defaulters query params
export const defaulterSortField = z.enum([
  "admissionNo",
  "fullName",
  "amountDue",
  "className",
]);
export type DefaulterSortField = z.infer<typeof defaulterSortField>;

export const defaultersQuery = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: defaulterSortField.default("admissionNo"),
  sortOrder: sortOrderSchema.default("asc"),
});
export type DefaultersQuery = z.infer<typeof defaultersQuery>;

// PATCH /fees/defaulters/:studentId — override the computed amount due (arrears).
export const defaulterUpdateSchema = z.object({
  amountDue: z.number().nonnegative(),
});
export type DefaulterUpdateDto = z.infer<typeof defaulterUpdateSchema>;

// Fee structure — POST /fees/structures. categoryId: omitted/null means the
// amount applies class-wide, regardless of category (see fees.ts structFor()).
export const feeStructureCreateSchema = z.object({
  classId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().optional(),
  academicYearId: z.number().int().positive(),
  feeType: feeTypeSchema,
  amount: z.number().nonnegative(),
});
export type FeeStructureCreateDto = z.infer<typeof feeStructureCreateSchema>;

export type FeePaymentDto = {
  id: number;
  receiptNo: string;
  studentId: number;
  feeType: string;
  feeMonth: number | null;
  feeYear: number;
  amountDue: number;
  amountPaid: number;
  paymentDate: string;
  paymentMethod: string;
  waiverAmount: number;
  pdfPath: string | null;
  whatsappSent: boolean;
  collectedById: number;
  createdAt: string;
};
