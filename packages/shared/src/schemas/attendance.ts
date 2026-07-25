import { z } from "zod";
import { attendanceStatusSchema, sortOrderSchema } from "./common";

// AttendanceCreateDto — POST /attendance (single)
export const attendanceCreateSchema = z.object({
  studentId: z.number().int().positive(),
  date: z.coerce.date(),
  status: attendanceStatusSchema,
  notes: z.string().optional().nullable(),
});
export type AttendanceCreateDto = z.infer<typeof attendanceCreateSchema>;

// POST /attendance accepts a single record or a bulk array.
export const attendanceBulkSchema = z.union([
  attendanceCreateSchema,
  z.array(attendanceCreateSchema).min(1),
]);
export type AttendanceBulkDto = z.infer<typeof attendanceBulkSchema>;

// PATCH /attendance/:id
export const attendanceUpdateSchema = z.object({
  status: attendanceStatusSchema.optional(),
  notes: z.string().optional().nullable(),
});
export type AttendanceUpdateDto = z.infer<typeof attendanceUpdateSchema>;

// GET /attendance and /attendance/summary query params
export const attendanceSortField = z.enum([
  "fullName",
  "present",
  "absent",
  "totalDays",
  "percentage",
]);
export type AttendanceSortField = z.infer<typeof attendanceSortField>;

export const attendanceListQuery = z.object({
  student_id: z.coerce.number().int().positive().optional(),
  class_id: z.coerce.number().int().positive().optional(),
  category_id: z.coerce.number().int().positive().optional(),
  date: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: attendanceSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
});
export type AttendanceListQuery = z.infer<typeof attendanceListQuery>;

export type AttendanceDto = {
  id: number;
  studentId: number;
  date: string;
  status: string;
  notes: string | null;
  markedById: number;
  createdAt: string;
};
