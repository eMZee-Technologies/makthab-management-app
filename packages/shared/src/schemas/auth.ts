import { z } from "zod";
import { phoneSchema, mobile10Schema } from "./common";

// ---- Password policy (self-service flows) ---------------------------------
// Admin-provisioned passwords stay at min(6) in user.ts for backward compat;
// public signup / forgot-password enforce a stronger rule.
export const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a digit");

export const otpMethodSchema = z.enum(["email", "sms"]);
export type OtpMethod = z.infer<typeof otpMethodSchema>;

export const otpPurposeSchema = z.enum(["signup", "password_reset"]);
export type OtpPurpose = z.infer<typeof otpPurposeSchema>;

export const userAccountStatusSchema = z.enum([
  "active",
  "inactive",
  "pending_verification",
  "pending_approval",
  "rejected",
]);
export type UserAccountStatus = z.infer<typeof userAccountStatusSchema>;

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

// POST /auth/signup — register with email and/or phone; account stays inactive
// until OTP verify + admin approval.
export const signupRequestSchema = z
  .object({
    fullName: z.string().trim().min(1),
    username: z.string().trim().min(3).max(64),
    password: strongPasswordSchema,
    email: z.string().trim().email().optional(),
    phone: z.union([mobile10Schema, phoneSchema]).optional(),
    otpMethod: otpMethodSchema,
    // Optional requested role; admin may override on approval. Defaults to Teacher.
    requestedRole: z.string().trim().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.email && !val.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide an email or a phone number",
        path: ["email"],
      });
    }
    if (val.otpMethod === "email" && !val.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email is required when otpMethod is email",
        path: ["email"],
      });
    }
    if (val.otpMethod === "sms" && !val.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Phone is required when otpMethod is sms",
        path: ["phone"],
      });
    }
  });
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const signupResponseSchema = z.object({
  challengeId: z.string(),
  message: z.string(),
  // Only present in non-production to ease local/QA verification.
  devOtp: z.string().optional(),
});
export type SignupResponse = z.infer<typeof signupResponseSchema>;

// POST /auth/verify-otp
export const verifyOtpRequestSchema = z.object({
  challengeId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "OTP must be a 6-digit code"),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const verifyOtpResponseSchema = z.object({
  purpose: otpPurposeSchema,
  status: userAccountStatusSchema.optional(),
  // Present when purpose === password_reset — short-lived token for reset-password.
  resetToken: z.string().optional(),
  message: z.string(),
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

// POST /auth/resend-otp
export const resendOtpRequestSchema = z.object({
  challengeId: z.string().min(1),
});
export type ResendOtpRequest = z.infer<typeof resendOtpRequestSchema>;

// POST /auth/forgot-password — anti-enumeration: always returns the same shape.
export const forgotPasswordRequestSchema = z
  .object({
    email: z.string().trim().email().optional(),
    phone: phoneSchema.optional(),
    username: z.string().trim().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.email && !val.phone && !val.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide email, phone, or username",
        path: ["email"],
      });
    }
  });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const forgotPasswordResponseSchema = z.object({
  challengeId: z.string().nullable(),
  message: z.string(),
  devOtp: z.string().optional(),
});
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;

// POST /auth/reset-password
export const resetPasswordRequestSchema = z.object({
  resetToken: z.string().min(1),
  password: strongPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

// POST /users/:id/approve
export const userApproveSchema = z.object({
  role: z.string().trim().min(1).optional(),
  note: z.string().trim().max(500).optional(),
});
export type UserApproveDto = z.infer<typeof userApproveSchema>;

// POST /users/:id/reject
export const userRejectSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type UserRejectDto = z.infer<typeof userRejectSchema>;
