import rateLimit from "express-rate-limit";
import type { Request } from "express";

// Auth endpoints are the brute-force surface. Thresholds are generous enough
// for a shared school-office NAT (see security redesign §3.2). Login is keyed
// on IP+username so one noisy account doesn't lock out the whole office NAT;
// other auth routes stay IP-keyed.

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Custom keyGenerators intentionally combine IP with other dimensions.
  validate: false,
  keyGenerator: (req) => clientIp(req),
  message: {
    error: {
      code: "rate_limited",
      message: "Too many attempts. Please try again later.",
    },
  },
});

/** Tighter limiter for login — compound key when username is present. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    return `${clientIp(req)}:${username || "_"}`;
  },
  message: {
    error: {
      code: "rate_limited",
      message: "Too many login attempts. Please try again later.",
    },
  },
});

export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => clientIp(req),
  message: {
    error: {
      code: "rate_limited",
      message: "Too many refresh attempts. Please try again later.",
    },
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => clientIp(req),
  message: {
    error: {
      code: "rate_limited",
      message: "Too many OTP attempts. Please try again later.",
    },
  },
});
