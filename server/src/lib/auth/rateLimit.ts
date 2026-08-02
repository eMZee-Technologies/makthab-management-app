import rateLimit from "express-rate-limit";

// Auth endpoints are the brute-force surface. Key on IP; login also tracks
// per-account lockout in the User row (see auth.ts). Thresholds are generous
// enough for a shared school-office NAT (see security redesign §3.2).
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "rate_limited",
      message: "Too many attempts. Please try again later.",
    },
  },
});

export const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "rate_limited",
      message: "Too many OTP attempts. Please try again later.",
    },
  },
});
