import { z } from "zod";
import {
  genderSchema,
  phoneSchema,
  sortOrderSchema,
  studentStatusSchema,
} from "./common";

// StudentCreateDto — POST /students
export const studentCreateSchema = z.object({
  admissionNo: z.string().trim().min(1),
  fullName: z.string().trim().min(1),
  fatherName: z.string().trim().min(1),
  dateOfBirth: z.coerce.date().nullable().optional(),
  gender: genderSchema,
  contactNo: phoneSchema,
  whatsappNo: phoneSchema,
  address: z.string().trim().optional().nullable(),
  classId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullable().optional(),
  academicYearId: z.number().int().positive(),
  photoPath: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: studentStatusSchema.optional(),
});
export type StudentCreateDto = z.infer<typeof studentCreateSchema>;

// StudentUpdateDto — PATCH /students/:id (all fields optional)
export const studentUpdateSchema = studentCreateSchema.partial().extend({
  status: studentStatusSchema.optional(),
});
export type StudentUpdateDto = z.infer<typeof studentUpdateSchema>;

// GET /students query params
export const studentSortField = z.enum([
  "admissionNo",
  "fullName",
  "fatherName",
  "status",
  "class",
  "age",
]);
export type StudentSortField = z.infer<typeof studentSortField>;

export const studentListQuery = z.object({
  class_id: z.coerce.number().int().positive().optional(),
  status: studentStatusSchema.optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: studentSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
});
export type StudentListQuery = z.infer<typeof studentListQuery>;

// Shape returned by the API (DTO).
export type StudentDto = {
  id: number;
  admissionNo: string;
  fullName: string;
  fatherName: string;
  dateOfBirth: string | null;
  gender: string;
  contactNo: string;
  whatsappNo: string;
  address: string | null;
  classId: number;
  categoryId: number | null;
  academicYearId: number;
  photoPath: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  admissionDate: string | null;
};
