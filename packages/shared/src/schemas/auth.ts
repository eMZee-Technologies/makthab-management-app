import { z } from "zod";

// POST /auth/login
export const loginRequestSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

// role is a plain string now that roles are DB-backed and admin-definable (no
// longer the fixed 3-value enum). permissions is the resolved permission-key
// set for the logged-in user — the source of truth for client-side gating.
export const authUserSchema = z.object({
  id: z.number().int(),
  fullName: z.string(),
  username: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
});
export type AuthUser = z.infer<typeof authUserSchema>;

// Response body of POST /auth/login and /auth/refresh
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: authUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
