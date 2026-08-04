import type { NextFunction, Request, Response } from "express";
import {
  allowsLegacyPermission,
  can,
  legacyKeysToMatrix,
  type Action,
  type ResourceKey,
  type RolePermissions,
} from "@makthab/shared";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt";
import { roleRepository } from "../db";
import { AppError } from "./errorHandler";

function normalizePayload(payload: AccessTokenPayload): AccessTokenPayload {
  if (payload.permissionMatrix) return payload;
  // Dual-read: Phase 1/2 tokens only had permissions: string[].
  if (Array.isArray(payload.permissions)) {
    return {
      ...payload,
      permissionMatrix: legacyKeysToMatrix(payload.permissions),
      permissionsVersion: payload.permissionsVersion ?? 0,
    };
  }
  return {
    ...payload,
    permissionMatrix: {
      mode: "matrix",
      inheritsFromAdmin: false,
      resources: legacyKeysToMatrix([]).resources,
    },
    permissionsVersion: payload.permissionsVersion ?? 0,
  };
}

function heldMatrix(req: Request): RolePermissions | undefined {
  return req.user?.permissionMatrix;
}

// Verify the Bearer access token, normalize dual-read payloads, reject stale
// permissionsVersion after a privilege shrink, and attach payload to req.user.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError(401, "unauthorized", "Missing or malformed Authorization header");
  }
  const token = header.slice("Bearer ".length).trim();
  let payload: AccessTokenPayload;
  try {
    payload = normalizePayload(verifyAccessToken(token));
  } catch {
    throw new AppError(401, "invalid_token", "Invalid or expired access token");
  }

  void (async () => {
    try {
      const role = await roleRepository.findByName(payload.role);
      if (role && role.permissionsVersion > (payload.permissionsVersion ?? 0)) {
        throw new AppError(
          401,
          "permissions_stale",
          "Permissions changed; refresh your session"
        );
      }
      req.user = payload;
      next();
    } catch (err) {
      next(err);
    }
  })();
}

// Restrict a route to one or more role NAMES. Prefer requireResourcePermission.
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

// Phase 3 primary guard — resource × action against the JWT matrix.
export function requireResourcePermission(resource: ResourceKey, action: Action) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    if (!can(heldMatrix(req), resource, action)) {
      throw new AppError(403, "forbidden", "Insufficient permissions for this action");
    }
    next();
  };
}

// OR across actions on one resource (e.g. module entry).
export function requireResourceAny(resource: ResourceKey, actions: Action[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    if (!actions.some((action) => can(heldMatrix(req), resource, action))) {
      throw new AppError(403, "forbidden", "Insufficient permissions for this action");
    }
    next();
  };
}

/**
 * Dual-read guard for legacy permission keys. Maps each key through
 * LEGACY_KEY_GRANTS onto the JWT matrix (OR across keys). Prefer
 * requireResourcePermission for new code.
 */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    const held = heldMatrix(req) ?? req.user.permissions;
    if (!keys.some((k) => allowsLegacyPermission(held, k))) {
      throw new AppError(403, "forbidden", "Insufficient permissions for this action");
    }
    next();
  };
}
