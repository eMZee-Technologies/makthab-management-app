import { z } from "zod";
import { phoneSchema, sortOrderSchema, roleNameSchema } from "./common";
import { userAccountStatusSchema } from "./auth";

// UserCreateDto — POST /users. A "new user" provisions a Staff record and a
// linked User login together (contactNo/whatsappNo/address live on Staff;
// username/email/role/password on the User).
export const userCreateSchema = z.object({
  fullName: z.string().trim().min(1),
  username: z.string().trim().min(3),
  password: z.string().min(6),
  email: z.string().trim().email(),
  phone: phoneSchema.optional(),
  role: roleNameSchema,
  contactNo: phoneSchema,
  whatsappNo: phoneSchema,
  address: z.string().trim().optional(),
});
export type UserCreateDto = z.infer<typeof userCreateSchema>;

// UserUpdateDto — PATCH /users/:id (partial). Editable profile fields plus
// status, so the edit form can reactivate a deactivated user (mirrors
// staffUpdateSchema). username/password are not edited here (password has its
// own reset endpoint).
export const userUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1),
    email: z.string().trim().email(),
    phone: phoneSchema.nullable(),
    role: roleNameSchema,
    contactNo: phoneSchema,
    whatsappNo: phoneSchema,
    address: z.string().trim(),
  })
  .partial()
  .extend({ status: userAccountStatusSchema.optional() });
export type UserUpdateDto = z.infer<typeof userUpdateSchema>;

// UserPasswordResetDto — POST /users/:id/reset-password
export const userPasswordResetSchema = z.object({
  password: z.string().min(6),
});
export type UserPasswordResetDto = z.infer<typeof userPasswordResetSchema>;

// GET /users query params
export const userSortField = z.enum([
  "fullName",
  "username",
  "email",
  "role",
  "status",
  "createdAt",
]);
export type UserSortField = z.infer<typeof userSortField>;

export const userListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sortBy: userSortField.optional(),
  sortOrder: sortOrderSchema.default("asc"),
  role: roleNameSchema.optional(),
  status: userAccountStatusSchema.optional(),
});
export type UserListQuery = z.infer<typeof userListQuery>;

// Flattened view of a User joined with its linked Staff record.
export type UserDto = {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  staffId: number;
  fullName: string;
  contactNo: string;
  whatsappNo: string;
  address: string | null;
  photoPath: string | null;
  signaturePath: string | null;
  createdAt: string;
  updatedAt: string;
};
