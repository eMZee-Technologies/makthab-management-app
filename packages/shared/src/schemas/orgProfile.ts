import { z } from "zod";
import { sortOrderSchema } from "./common";

// OrgProfileCreateDto — POST /org-profile. A new institution profile (name +
// address). New rows are created inactive; activate via PATCH { isActive: true }.
export const orgProfileCreateSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
});
export type OrgProfileCreateDto = z.infer<typeof orgProfileCreateSchema>;

// OrgProfileUpdateDto — PATCH /org-profile/:id (partial). Setting isActive:true
// activates this row exclusively (any other active row is unset). headerImagePath
// is not edited here — it has its own upload endpoint.
export const orgProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1),
    address: z.string().trim().min(1),
    isActive: z.boolean(),
  })
  .partial();
export type OrgProfileUpdateDto = z.infer<typeof orgProfileUpdateSchema>;

// GET /org-profile query params (Admin list).
export const orgProfileSortField = z.enum(["name", "isActive", "updatedAt"]);
export type OrgProfileSortField = z.infer<typeof orgProfileSortField>;

export const orgProfileListQuery = z.object({
  sortBy: orgProfileSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
});
export type OrgProfileListQuery = z.infer<typeof orgProfileListQuery>;

// Serialised OrgProfile row.
export type OrgProfileDto = {
  id: number;
  name: string;
  address: string;
  isActive: boolean;
  headerImagePath: string | null;
  updatedAt: string;
};
