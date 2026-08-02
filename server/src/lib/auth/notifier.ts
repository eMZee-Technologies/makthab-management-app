import { logger } from "../logger";
import { env } from "../env";

export type OtpDelivery = {
  channel: "email" | "sms";
  destination: string;
  code: string;
  purpose: string;
};

/**
 * Pluggable OTP / notification delivery.
 *
 * MVP: logs to Winston (and optionally SMTP/SMS when env is configured).
 * Swap the bodies of `sendEmail` / `sendSms` for real providers (SES, Twilio,
 * MSG91, etc.) without changing callers.
 */
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (env.smtpHost && env.smtpFrom) {
    // Scaffold: real nodemailer/SES wiring lands in Phase 2. For now we still
    // log so local/dev never silently drops messages when SMTP_* is half-set.
    logger.info(`[email:queued] to=${to} subject=${subject} via=${env.smtpHost}`);
  }
  logger.info(`[email] to=${to} subject=${subject} body=${body}`);
}

async function sendSms(to: string, body: string): Promise<void> {
  if (env.smsProvider && env.smsApiKey) {
    logger.info(`[sms:queued] to=${to} provider=${env.smsProvider}`);
  }
  logger.info(`[sms] to=${to} body=${body}`);
}

export async function deliverOtp(msg: OtpDelivery): Promise<void> {
  const text = `Your Makthab verification code is ${msg.code}. It expires in 10 minutes.`;
  if (msg.channel === "email") {
    await sendEmail(msg.destination, `Makthab ${msg.purpose} code`, text);
  } else {
    await sendSms(msg.destination, text);
  }
}

export async function notifyAdminsByEmail(
  recipients: string[],
  subject: string,
  body: string
): Promise<void> {
  for (const to of recipients) {
    if (!to) continue;
    await sendEmail(to, subject, body);
  }
}
