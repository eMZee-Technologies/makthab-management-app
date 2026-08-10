// Monthly student progress (talimi report) schemas — /api/v1/progress.
// Backend owns; Frontend consumes. Permissions: progress resource CRUD.
// Teacher + Admin by seed; Accountant has no progress grants by default.

import { z } from "zod";
import { sortOrderSchema } from "./common";

export const moodEngagementSchema = z.enum([
  "excellent",
  "good",
  "average",
  "needs_attention",
]);
export type MoodEngagement = z.infer<typeof moodEngagementSchema>;

export const progressLinkSchema = z.object({
  url: z.string().trim().url(),
  label: z.string().trim().max(120).optional(),
});
export type ProgressLink = z.infer<typeof progressLinkSchema>;

export const progressAttachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  uploadedAt: z.string(),
});
export type ProgressAttachment = z.infer<typeof progressAttachmentSchema>;

const requiredText = z.string().trim().min(1);

export const monthlyProgressCreateSchema = z.object({
  studentId: z.number().int().positive(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  hoursStudied: z.number().min(0).max(744),
  topicsCovered: requiredText,
  assessments: requiredText,
  attendanceDays: z.number().int().min(0).max(31),
  moodEngagement: moodEngagementSchema,
  goals: requiredText,
  notes: requiredText,
  previousMonthComparison: z.string().trim().optional().nullable(),
  progressPercent: z.number().min(0).max(100).optional().nullable(),
  assignmentsCompleted: z.string().trim().optional().nullable(),
  softSkills: z.string().trim().optional().nullable(),
  reminders: z.string().trim().optional().nullable(),
  nextSteps: z.string().trim().optional().nullable(),
  links: z.array(progressLinkSchema).max(20).optional().nullable(),
});
export type MonthlyProgressCreateDto = z.infer<typeof monthlyProgressCreateSchema>;

export const monthlyProgressUpdateSchema = monthlyProgressCreateSchema
  .omit({ studentId: true, month: true, year: true })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });
export type MonthlyProgressUpdateDto = z.infer<typeof monthlyProgressUpdateSchema>;

export const progressSortField = z.enum([
  "fullName",
  "month",
  "year",
  "hoursStudied",
  "attendanceDays",
  "progressPercent",
  "updatedAt",
]);
export type ProgressSortField = z.infer<typeof progressSortField>;

export const monthlyProgressListQuery = z.object({
  student_id: z.coerce.number().int().positive().optional(),
  class_id: z.coerce.number().int().positive().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: progressSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
});
export type MonthlyProgressListQuery = z.infer<typeof monthlyProgressListQuery>;

export const progressBoardQuery = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  class_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortOrder: sortOrderSchema.default("asc"),
});
export type ProgressBoardQuery = z.infer<typeof progressBoardQuery>;

export const progressAttachmentDeleteSchema = z.object({
  key: z.string().trim().min(1),
});
export type ProgressAttachmentDeleteDto = z.infer<typeof progressAttachmentDeleteSchema>;

export type MonthlyProgressDto = {
  id: number;
  studentId: number;
  month: number;
  year: number;
  hoursStudied: number;
  topicsCovered: string;
  assessments: string;
  attendanceDays: number;
  moodEngagement: MoodEngagement;
  goals: string;
  notes: string;
  previousMonthComparison: string | null;
  progressPercent: number | null;
  assignmentsCompleted: string | null;
  softSkills: string | null;
  reminders: string | null;
  nextSteps: string | null;
  links: ProgressLink[];
  attachments: ProgressAttachment[];
  whatsappSent: boolean;
  editedById: number;
  createdAt: string;
  updatedAt: string;
};
