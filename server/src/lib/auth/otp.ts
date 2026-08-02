import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/client";
import { env, isProd } from "../env";
import { logger } from "../logger";
import { deliverOtp } from "./notifier";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between resends
const BCRYPT_ROUNDS = 10;

export type OtpPurpose = "signup" | "password_reset";
export type OtpChannel = "email" | "sms";

function generateCode(): string {
  // Cryptographically random 6-digit code (000000–999999).
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function newId(): string {
  return crypto.randomUUID();
}

export async function createOtpChallenge(input: {
  userId?: number | null;
  purpose: OtpPurpose;
  channel: OtpChannel;
  destination: string;
}): Promise<{ challengeId: string; code: string; expiresAt: Date }> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const id = newId();

  await prisma.otpChallenge.create({
    data: {
      id,
      userId: input.userId ?? null,
      purpose: input.purpose,
      channel: input.channel,
      destination: input.destination,
      codeHash,
      expiresAt,
    },
  });

  await deliverOtp({
    channel: input.channel,
    destination: input.destination,
    code,
    purpose: input.purpose,
  });

  if (!isProd) {
    logger.debug(`OTP [${input.purpose}] for ${input.destination}: ${code}`);
  }

  return { challengeId: id, code, expiresAt };
}

export async function resendOtpChallenge(challengeId: string): Promise<{
  challengeId: string;
  code: string;
  expiresAt: Date;
} | null> {
  const existing = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!existing || existing.consumedAt) return null;
  if (existing.createdAt.getTime() > Date.now() - RESEND_COOLDOWN_MS) {
    // Still within cooldown — return the same challenge without issuing a new code.
    // Caller maps this to 429.
    const err = new Error("otp_resend_cooldown");
    (err as Error & { code: string }).code = "otp_resend_cooldown";
    throw err;
  }

  // Invalidate old challenge and mint a fresh one (same purpose/destination).
  await prisma.otpChallenge.update({
    where: { id: challengeId },
    data: { consumedAt: new Date() },
  });

  return createOtpChallenge({
    userId: existing.userId,
    purpose: existing.purpose as OtpPurpose,
    channel: existing.channel as OtpChannel,
    destination: existing.destination,
  });
}

export async function verifyOtpChallenge(
  challengeId: string,
  code: string
): Promise<{
  ok: true;
  purpose: OtpPurpose;
  userId: number | null;
  destination: string;
  channel: OtpChannel;
} | { ok: false; reason: "not_found" | "expired" | "consumed" | "locked" | "invalid" }> {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) return { ok: false, reason: "not_found" };
  if (challenge.consumedAt) return { ok: false, reason: "consumed" };
  if (challenge.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: "locked" };

  const match = await bcrypt.compare(code, challenge.codeHash);
  if (!match) {
    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, reason: "invalid" };
  }

  await prisma.otpChallenge.update({
    where: { id: challengeId },
    data: { consumedAt: new Date() },
  });

  return {
    ok: true,
    purpose: challenge.purpose as OtpPurpose,
    userId: challenge.userId,
    destination: challenge.destination,
    channel: challenge.channel as OtpChannel,
  };
}

export function shouldExposeDevOtp(): boolean {
  return !isProd || env.nodeEnv === "test";
}
