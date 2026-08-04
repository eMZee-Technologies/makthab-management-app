import { randomUUID } from "node:crypto";
import { refreshSessionRepository } from "../../db";
import { signRefreshToken, verifyRefreshToken, type RefreshTokenPayload } from "../jwt";
import { env } from "../env";
import { AppError } from "../../middleware/errorHandler";

/** Parse JWT TTL strings like `15m`, `7d` into milliseconds. */
export function ttlToMs(ttl: string): number {
  const m = /^(\d+)([smhd])$/i.exec(ttl.trim());
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}

export type IssueRefreshOptions = {
  userId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Persist a RefreshSession row and return a signed refresh JWT with matching jti. */
export async function issueRefreshToken(opts: IssueRefreshOptions): Promise<string> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + ttlToMs(env.jwtRefreshTtl));
  await refreshSessionRepository.create({
    id,
    userId: opts.userId,
    expiresAt,
    ipAddress: opts.ipAddress ? opts.ipAddress.slice(0, 128) : null,
    userAgent: opts.userAgent ? opts.userAgent.slice(0, 512) : null,
  });
  return signRefreshToken(opts.userId, id);
}

/**
 * Verify signature + server-side session. Returns the payload when the
 * session is still active; throws AppError(401) otherwise.
 */
export async function assertActiveRefreshToken(token: string): Promise<RefreshTokenPayload> {
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new AppError(401, "invalid_token", "Invalid or expired refresh token");
  }
  if (!payload.jti || payload.tokenType !== "refresh") {
    throw new AppError(401, "invalid_token", "Invalid or expired refresh token");
  }
  const session = await refreshSessionRepository.findActiveById(payload.jti);
  if (!session || session.userId !== payload.sub) {
    throw new AppError(401, "invalid_token", "Invalid or expired refresh token");
  }
  return payload;
}

/** Rotate: revoke the presented session and issue a new refresh token. */
export async function rotateRefreshToken(
  oldToken: string,
  opts: Omit<IssueRefreshOptions, "userId"> & { userId?: number } = {}
): Promise<{ payload: RefreshTokenPayload; refreshToken: string }> {
  const payload = await assertActiveRefreshToken(oldToken);
  await refreshSessionRepository.revokeById(payload.jti);
  const refreshToken = await issueRefreshToken({
    userId: opts.userId ?? payload.sub,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });
  return { payload, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<{ userId: number; jti: string } | null> {
  let payload: RefreshTokenPayload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return null;
  }
  if (!payload.jti) return null;
  await refreshSessionRepository.revokeById(payload.jti);
  return { userId: payload.sub, jti: payload.jti };
}

export async function revokeAllSessionsForUser(userId: number): Promise<number> {
  const result = await refreshSessionRepository.revokeAllForUser(userId);
  return result.count;
}
