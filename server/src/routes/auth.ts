import { Router } from "express";
import bcrypt from "bcryptjs";
import { loginRequestSchema, refreshRequestSchema } from "@makthab/shared";
import { userRepository } from "../db";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";
import { resolvePermissions } from "../lib/permissions";
import { asyncHandler } from "../lib/asyncHandler";
import { validateBody } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const authRouter = Router();

// POST /auth/login — verify credentials, issue access + refresh tokens.
authRouter.post(
  "/login",
  validateBody(loginRequestSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = await userRepository.findByUsername(username);
    if (!user || user.status !== "active") {
      throw new AppError(401, "invalid_credentials", "Invalid username or password");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new AppError(401, "invalid_credentials", "Invalid username or password");
    }

    const role = user.role;
    const permissions = await resolvePermissions(role);
    const accessToken = signAccessToken({
      sub: user.id,
      staffId: user.staffId,
      username: user.username,
      role,
      permissions,
    });
    const refreshToken = signRefreshToken(user.id);

    res.json({
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, fullName: user.staff.fullName, username: user.username, role, permissions },
      },
    });
  })
);

// POST /auth/refresh — exchange a valid refresh token for a fresh access token.
authRouter.post(
  "/refresh",
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
    const permissions = await resolvePermissions(role);
    const accessToken = signAccessToken({
      sub: user.id,
      staffId: user.staffId,
      username: user.username,
      role,
      permissions,
    });
    res.json({
      data: {
        accessToken,
        refreshToken: signRefreshToken(user.id),
        user: { id: user.id, fullName: user.staff.fullName, username: user.username, role, permissions },
      },
    });
  })
);

// POST /auth/logout — stateless JWT: client discards tokens. Kept for symmetry.
authRouter.post("/logout", (_req, res) => {
  res.json({ data: { ok: true } });
});
