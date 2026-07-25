import { z } from "zod";

// ClassCreateDto — POST /classes. categoryIds is the subset of the global
// Category master list this class offers (e.g. Class 1 -> Noorani Qaida,
// Hifz Quran); omitted/empty means the class doesn't use categories at all.
export const classCreateSchema = z.object({
  name: z.string().trim().min(1),
  teacherId: z.number().int().positive().nullable().optional(),
  categoryIds: z.array(z.number().int().positive()).optional(),
});
export type ClassCreateDto = z.infer<typeof classCreateSchema>;

// ClassUpdateDto — PATCH /classes/:id (all fields optional)
export const classUpdateSchema = classCreateSchema.partial();
export type ClassUpdateDto = z.infer<typeof classUpdateSchema>;

// Shape returned by the API (DTO).
export type ClassDto = {
  id: number;
  name: string;
  teacherId: number | null;
  categories: { id: number; name: string }[];
};
