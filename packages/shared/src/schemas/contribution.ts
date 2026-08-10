// Contribution (donation/income) schemas — POST/PATCH/GET /api/v1/contributions.
// Backend owns; Frontend consumes. Field shape notes for Frontend:
//   - contributorType: "individual" | "anonymous"
//   - when anonymous and contributorName is empty/omitted, server stores "Anonymous"
//   - receiptNo is server-generated (CON-<dd-mm-yyyy>-<seq>) and immutable on PATCH
//   - whatsappNo is optional on the contribution itself (not looked up from a person record)
//   - Permissions reuse the fees resource (fees.view/create/update/delete)

import { z } from "zod";
import { phoneSchema, sortOrderSchema } from "./common";

export const contributorTypeSchema = z.enum(["individual", "anonymous"]);
export type ContributorType = z.infer<typeof contributorTypeSchema>;

// ContributionCreateDto — POST /contributions
export const contributionCreateSchema = z
  .object({
    amount: z.number().positive(),
    contributorName: z.string().trim().optional().nullable(),
    contributorType: contributorTypeSchema,
    date: z.coerce.date(),
    notes: z.string().trim().optional().nullable(),
    whatsappNo: phoneSchema.optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.contributorType === "individual" && !(data.contributorName?.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "contributorName is required when contributorType is individual",
        path: ["contributorName"],
      });
    }
  });
export type ContributionCreateDto = z.infer<typeof contributionCreateSchema>;

// ContributionUpdateDto — PATCH /contributions/:id (all fields optional; receiptNo immutable).
// Name requirement for individual is enforced server-side after merge with the existing row.
export const contributionUpdateSchema = z.object({
  amount: z.number().positive().optional(),
  contributorName: z.string().trim().optional().nullable(),
  contributorType: contributorTypeSchema.optional(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().optional().nullable(),
  whatsappNo: phoneSchema.optional().nullable(),
});
export type ContributionUpdateDto = z.infer<typeof contributionUpdateSchema>;

export const contributionSortField = z.enum([
  "receiptNo",
  "contributorName",
  "contributorType",
  "amount",
  "date",
  "createdAt",
]);
export type ContributionSortField = z.infer<typeof contributionSortField>;

export const contributionListQuery = z.object({
  year: z.coerce.number().int().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: contributionSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
});
export type ContributionListQuery = z.infer<typeof contributionListQuery>;

export type ContributionDto = {
  id: number;
  amount: number;
  contributorName: string;
  contributorType: ContributorType;
  date: string;
  receiptNo: string;
  notes: string | null;
  whatsappNo: string | null;
  pdfPath: string | null;
  whatsappSent: boolean;
  recordedById: number;
  createdAt: string;
};
