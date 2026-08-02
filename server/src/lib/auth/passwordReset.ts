import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/client";

const RESET_TTL_MS = 15 * 60 * 1000; // 15 minutes
const BCRYPT_ROUNDS = 10;

export async function issuePasswordResetToken(userId: number): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(raw, BCRYPT_ROUNDS);
  const id = crypto.randomUUID();
  await prisma.passwordResetToken.create({
    data: {
      id,
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });
  // Client presents `${id}.${raw}` so we can look up by id then verify hash.
  return `${id}.${raw}`;
}

export async function consumePasswordResetToken(
  resetToken: string
): Promise<{ ok: true; userId: number } | { ok: false }> {
  const [id, raw] = resetToken.split(".");
  if (!id || !raw) return { ok: false };

  const row = await prisma.passwordResetToken.findUnique({ where: { id } });
  if (!row || row.consumedAt) return { ok: false };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false };

  const match = await bcrypt.compare(raw, row.tokenHash);
  if (!match) return { ok: false };

  await prisma.passwordResetToken.update({
    where: { id },
    data: { consumedAt: new Date() },
  });
  return { ok: true, userId: row.userId };
}
