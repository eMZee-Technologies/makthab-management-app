import jwt, { type SignOptions } from "jsonwebtoken";
import type { RolePermissions } from "@makthab/shared";
import { env } from "./env";

// Claims carried in the access token. staffId identifies the actor (Staff.id)
// stamped on write operations. permissionMatrix (resolved from the user's Role
// at login/refresh) drives access control via requireResourcePermission /
// requirePermission. permissionsVersion rejects stale tokens after shrinks.
// `role` is the role name (display + legacy requireRole).
export interface AccessTokenPayload {
  sub: number; // User.id
  staffId: number;
  username: string;
  role: string;
  permissionMatrix: RolePermissions;
  permissionsVersion: number;
  /** @deprecated dual-read for in-flight Phase 1/2 tokens during rollout */
  permissions?: string[];
}

export interface RefreshTokenPayload {
  sub: number; // User.id
  tokenType: "refresh";
  /** Matches RefreshSession.id — required for revocation checks. */
  jti: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtAccessTtl,
  } as SignOptions);
}

export function signRefreshToken(userId: number, jti: string): string {
  return jwt.sign(
    { sub: userId, tokenType: "refresh", jti } as RefreshTokenPayload,
    env.jwtRefreshSecret,
    {
      expiresIn: env.jwtRefreshTtl,
    } as SignOptions
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, env.jwtRefreshSecret) as unknown as RefreshTokenPayload;
  if (payload.tokenType !== "refresh" || typeof payload.sub !== "number") {
    throw new Error("invalid_refresh_payload");
  }
  // Pre-revocation-era tokens lack jti — treat as invalid so clients re-login.
  if (!payload.jti || typeof payload.jti !== "string") {
    throw new Error("missing_jti");
  }
  return payload;
}
