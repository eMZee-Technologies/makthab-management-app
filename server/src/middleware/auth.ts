import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { AppError } from "./errorHandler";

// Verify the Bearer access token and attach the payload to req.user.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError(401, "unauthorized", "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    throw new AppError(401, "invalid_token", "Invalid or expired access token");
  }
}

// Restrict a route to one or more role NAMES. Must run after requireAuth.
// Retained for the handful of fine-grained Admin-only sub-operations that are
// not exposed as toggleable permission keys; module-level access is guarded by
// requirePermission instead.
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, "forbidden", "Insufficient role for this action");
    }
    next();
  };
}

// Restrict a route to holders of at least one of the given permission keys
// (OR semantics, mirroring requireRole). Permissions are baked into the access
// token at login/refresh from the user's Role. Must run after requireAuth.
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    const held = req.user.permissions ?? [];
    if (!keys.some((k) => held.includes(k))) {
      throw new AppError(403, "forbidden", "Insufficient permissions for this action");
    }
    next();
  };
}
