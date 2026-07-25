import { z } from "zod";

// CategoryCreateDto — POST /categories. Categories are a global master list
// (e.g. Noorani Qaida, Naazira Quran, Hifz Quran); a Class picks the subset it
// offers (see classCreateSchema's categoryIds).
export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1),
});
export type CategoryCreateDto = z.infer<typeof categoryCreateSchema>;

// CategoryUpdateDto — PATCH /categories/:id
export const categoryUpdateSchema = categoryCreateSchema.partial();
export type CategoryUpdateDto = z.infer<typeof categoryUpdateSchema>;

// Shape returned by the API (DTO).
export type CategoryDto = {
  id: number;
  name: string;
  createdAt: string;
};
