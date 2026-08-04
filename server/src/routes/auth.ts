import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  loginRequestSchema,
  refreshRequestSchema,
  signupRequestSchema,
  verifyOtpRequestSchema,
  resendOtpRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  type SignupRequest,
  type ForgotPasswordRequest,
} from "@makthab/shared";
import {
  userRepository,
  roleRepository,
  approvalAuditRepository,
  adminNotificationRepository,
  isUniqueConstraintError,
} from "../db";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";
import { resolveRoleAccess } from "../lib/permissions";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";
import { env } from "../lib/env";
import {
  createOtpChallenge,
  resendOtpChallenge,
  verifyOtpChallenge,
  shouldExposeDevOtp,
} from "../lib/auth/otp";
import { issuePasswordResetToken, consumePasswordResetToken } from "../lib/auth/passwordReset";
import { notifyAdminsByEmail } from "../lib/auth/notifier";
import { authRateLimiter, otpRateLimiter } from "../lib/auth/rateLimit";

export const authRouter = Router();

const GENERIC_OTP_MESSAGE =
  "If the account is eligible, a verification code has been sent.";

async function notifyAdminsOfPendingSignup(user: {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  staff: { fullName: string };
}) {
  const admins = await userRepository.findAdminsWithManagePermission();
  if (admins.length === 0) return;

  const title = "New signup awaiting approval";
  const body = `${user.staff.fullName} (@${user.username}) verified their contact and is waiting for approval.`;
  const metaJson = JSON.stringify({ subjectUserId: user.id });

  await adminNotificationRepository.createMany(
    admins.map((a) => ({
      userId: a.id,
      type: "signup_pending",
      title,
      body,
      metaJson,
    }))
  );

  await notifyAdminsByEmail(
    admins.map((a) => a.email).filter((e): e is string => !!e),
    title,
    body
  );
}

// POST /auth/signup — create pending account + send OTP.
authRouter.post(
  "/signup",
  authRateLimiter,
  validateBody(signupRequestSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as SignupRequest;
    const roleName = dto.requestedRole ?? env.signupDefaultRole;
    const roleExists = await roleRepository.findByName(roleName);
    if (!roleExists) {
      throw new AppError(400, "unknown_role", `Unknown role: ${roleName}`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const contact = dto.phone ?? dto.email ?? "0000000";
    try {
      const user = await userRepository.createWithStaff({
        fullName: dto.fullName,
        contactNo: contact,
        whatsappNo: contact,
        username: dto.username,
        passwordHash,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        role: roleName,
        status: "pending_verification",
        otpMethod: dto.otpMethod,
      });

      const destination = dto.otpMethod === "email" ? dto.email! : dto.phone!;
      const { challengeId, code } = await createOtpChallenge({
        userId: user.id,
        purpose: "signup",
        channel: dto.otpMethod,
        destination,
      });

      res.status(201).json({
        data: {
          challengeId,
          message: "Verification code sent. Complete OTP verification to continue.",
          ...(shouldExposeDevOtp() ? { devOtp: code } : {}),
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // Generic message avoids revealing which field collided.
        throw new AppError(409, "conflict", "An account with these details already exists");
      }
      throw err;
    }
  })
);

// POST /auth/verify-otp
authRouter.post(
  "/verify-otp",
  otpRateLimiter,
  validateBody(verifyOtpRequestSchema),
  asyncHandler(async (req, res) => {
    const { challengeId, code } = req.body as { challengeId: string; code: string };
    const result = await verifyOtpChallenge(challengeId, code);
    if (!result.ok) {
      const map: Record<string, [number, string, string]> = {
        not_found: [400, "invalid_otp", "Invalid or expired verification code"],
        expired: [400, "otp_expired", "Verification code has expired"],
        consumed: [400, "otp_consumed", "Verification code already used"],
        locked: [429, "otp_locked", "Too many invalid attempts for this code"],
        invalid: [400, "invalid_otp", "Invalid or expired verification code"],
      };
      const [status, errCode, message] = map[result.reason] ?? map.invalid;
      throw new AppError(status, errCode, message);
    }

    if (result.purpose === "signup") {
      if (!result.userId) {
        throw new AppError(400, "invalid_otp", "Invalid or expired verification code");
      }
      const user = await userRepository.markVerified(result.userId, result.channel);
      await notifyAdminsOfPendingSignup(user);
      res.json({
        data: {
          purpose: "signup" as const,
          status: "pending_approval" as const,
          message: "Contact verified. An administrator will review your account.",
        },
      });
      return;
    }

    // password_reset
    if (!result.userId) {
      throw new AppError(400, "invalid_otp", "Invalid or expired verification code");
    }
    const resetToken = await issuePasswordResetToken(result.userId);
    res.json({
      data: {
        purpose: "password_reset" as const,
        resetToken,
        message: "OTP verified. You may now set a new password.",
      },
    });
  })
);

// POST /auth/resend-otp
authRouter.post(
  "/resend-otp",
  otpRateLimiter,
  validateBody(resendOtpRequestSchema),
  asyncHandler(async (req, res) => {
    const { challengeId } = req.body as { challengeId: string };
    try {
      const next = await resendOtpChallenge(challengeId);
      if (!next) {
        throw new AppError(400, "invalid_challenge", "Cannot resend for this challenge");
      }
      res.json({
        data: {
          challengeId: next.challengeId,
          message: "A new verification code has been sent.",
          ...(shouldExposeDevOtp() ? { devOtp: next.code } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Error && (err as Error & { code?: string }).code === "otp_resend_cooldown") {
        throw new AppError(429, "otp_resend_cooldown", "Please wait before requesting another code");
      }
      throw err;
    }
  })
);

// POST /auth/forgot-password — anti-enumeration: always 200 with same message.
authRouter.post(
  "/forgot-password",
  authRateLimiter,
  validateBody(forgotPasswordRequestSchema),
  asyncHandler(async (req, res) => {
    const dto = req.body as ForgotPasswordRequest;
    let user =
      (dto.username && (await userRepository.findByUsername(dto.username))) ||
      (dto.email && (await userRepository.findByEmail(dto.email))) ||
      (dto.phone && (await userRepository.findByPhone(dto.phone))) ||
      null;

    // Only active (or pending) accounts with a reachable channel get an OTP.
    // Rejected/inactive still get the generic response.
    let challengeId: string | null = null;
    let code: string | undefined;
    if (user && (user.status === "active" || user.status === "pending_approval")) {
      const channel = user.otpMethod === "sms" || (!user.email && user.phone) ? "sms" : "email";
      const destination = channel === "sms" ? user.phone : user.email;
      if (destination) {
        const challenge = await createOtpChallenge({
          userId: user.id,
          purpose: "password_reset",
          channel,
          destination,
        });
        challengeId = challenge.challengeId;
        code = challenge.code;
      }
    }

    res.json({
      data: {
        challengeId,
        message: GENERIC_OTP_MESSAGE,
        ...(shouldExposeDevOtp() && code ? { devOtp: code } : {}),
      },
    });
  })
);

// POST /auth/reset-password
authRouter.post(
  "/reset-password",
  authRateLimiter,
  validateBody(resetPasswordRequestSchema),
  asyncHandler(async (req, res) => {
    const { resetToken, password } = req.body as { resetToken: string; password: string };
    const consumed = await consumePasswordResetToken(resetToken);
    if (!consumed.ok) {
      throw new AppError(400, "invalid_reset_token", "Invalid or expired reset token");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await userRepository.setPassword(consumed.userId, passwordHash);
    res.json({ data: { ok: true, message: "Password updated. You can sign in now." } });
  })
);

// POST /auth/login — verify credentials, issue access + refresh tokens.
authRouter.post(
  "/login",
  authRateLimiter,
  validateBody(loginRequestSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = await userRepository.findByUsername(username);

    // Constant-ish failure path: always run a bcrypt compare against a dummy
    // hash when the user is missing, so timing doesn't reveal existence.
    const dummyHash = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oQ.YzqKxqKxq";
    const hash = user?.passwordHash ?? dummyHash;
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      if (user) {
        await userRepository.recordLoginFailure(
          user.id,
          env.loginMaxFailures,
          env.loginLockoutMinutes
        );
      }
      throw new AppError(401, "invalid_credentials", "Invalid username or password");
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError(423, "account_locked", "Account temporarily locked. Try again later.");
    }

    if (user.status !== "active") {
      // Same envelope as bad credentials to avoid status enumeration.
      throw new AppError(401, "invalid_credentials", "Invalid username or password");
    }

    await userRepository.clearLoginFailures(user.id);

    const role = user.role;
    const { permissionMatrix, permissionsVersion } = await resolveRoleAccess(role);
    const accessToken = signAccessToken({
      sub: user.id,
      staffId: user.staffId,
      username: user.username,
      role,
      permissionMatrix,
      permissionsVersion,
    });
    const refreshToken = signRefreshToken(user.id);

    res.json({
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          fullName: user.staff.fullName,
          username: user.username,
          role,
          permissionMatrix,
          permissionsVersion,
        },
      },
    });
  })
);

// POST /auth/refresh — exchange a valid refresh token for a fresh access token.
authRouter.post(
  "/refresh",
  authRateLimiter,
  validateBody(refreshRequestSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError(401, "invalid_token", "Invalid or expired refresh token");
    }
    const user = await userRepository.findByIdWithStaff(payload.sub);
    if (!user || user.status !== "active") {
      throw new AppError(401, "unauthorized", "User no longer active");
    }
    const role = user.role;
    const { permissionMatrix, permissionsVersion } = await resolveRoleAccess(role);
    const accessToken = signAccessToken({
      sub: user.id,
      staffId: user.staffId,
      username: user.username,
      role,
      permissionMatrix,
      permissionsVersion,
    });
    res.json({
      data: {
        accessToken,
        refreshToken: signRefreshToken(user.id),
        user: {
          id: user.id,
          fullName: user.staff.fullName,
          username: user.username,
          role,
          permissionMatrix,
          permissionsVersion,
        },
      },
    });
  })
);

// POST /auth/logout — stateless JWT: client discards tokens. Kept for symmetry.
authRouter.post("/logout", (_req, res) => {
  res.json({ data: { ok: true } });
});
