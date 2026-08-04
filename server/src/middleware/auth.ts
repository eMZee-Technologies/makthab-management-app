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
 * Module access for write methods; for GET/HEAD also allow `reports.view`.
 * The Reports page reuses fees/finance list APIs for on-screen tables, so a
 * reports-only role must be able to read those endpoints without fees/finance
 * grants. Writes require create/update/delete — view alone is never enough.
 * Exact write action is still enforced per-route where configured.
 */
export function requireModuleAccessOrReportsView(resource: ResourceKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    const held = heldMatrix(req);
    const isRead = req.method === "GET" || req.method === "HEAD";
    const hasView =
      can(held, resource, "view") ||
      can(held, resource, "create") ||
      can(held, resource, "update") ||
      can(held, resource, "delete");
    const hasWrite =
      can(held, resource, "create") ||
      can(held, resource, "update") ||
      can(held, resource, "delete");

    if (isRead) {
      if (hasView || can(held, "reports", "view")) {
        next();
        return;
      }
    } else if (hasWrite) {
      next();
      return;
    }
    throw new AppError(403, "forbidden", "Insufficient permissions for this action");
  };
}

/**
 * Router-level gate: GET/HEAD needs view (or any write); mutating methods need
 * create/update/delete. Use with per-route requireResourcePermission for the
 * exact action when possible.
 */
export function requireResourceReadOrMutate(resource: ResourceKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    const held = heldMatrix(req);
    const isRead = req.method === "GET" || req.method === "HEAD";
    if (isRead) {
      if (
        can(held, resource, "view") ||
        can(held, resource, "create") ||
        can(held, resource, "update") ||
        can(held, resource, "delete")
      ) {
        next();
        return;
      }
    } else if (
      can(held, resource, "create") ||
      can(held, resource, "update") ||
      can(held, resource, "delete")
    ) {
      next();
      return;
    }
    throw new AppError(403, "forbidden", "Insufficient permissions for this action");
  };
}

/** Legacy string-key gate — prefers matrix via allowsLegacyPermission. */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, "unauthorized", "Authentication required");
    }
    const held = heldMatrix(req);
    if (keys.some((k) => allowsLegacyPermission(held, k))) {
      next();
      return;
    }
    // Dual-read: in-flight tokens may still carry permissions: string[].
    const legacy = new Set(req.user.permissions ?? []);
    if (keys.some((k) => legacy.has(k))) {
      next();
      return;
    }
    throw new AppError(403, "forbidden", "Insufficient permissions for this action");
  };
}
