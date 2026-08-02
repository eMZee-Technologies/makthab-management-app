import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";

// Structural check: the app resolves two zod copies (root + server-local), so a
// ZodError thrown by @makthab/shared's zod fails `instanceof` against ours.
// Detect by shape/name instead so validation always maps to a 400.
function isZodError(err: unknown): err is ZodError {
  return (
    err instanceof ZodError ||
    (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")
  );
}

// A typed application error carrying an HTTP status and a machine-readable code.
export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "not_found", message: "Resource not found" },
  });
};

// Central error handler — emits the BUILD_CONTRACT §2 error envelope.
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (isZodError(err)) {
    // 400 per the QA contract (BUILD_CONTRACT §7 test suite).
    // Prefer a concrete first field message in `message` so UIs that only
    // render error.message (and operators grepping logs) see what to fix;
    // full flatten stays in `details`.
    const flat = err.flatten();
    const fieldMsgs = Object.entries(flat.fieldErrors).flatMap(([field, msgs]) =>
      (msgs ?? []).map((m) => `${field}: ${m}`)
    );
    const summary =
      [...flat.formErrors, ...fieldMsgs].filter(Boolean).join(" · ") ||
      "Request validation failed";
    logger.debug(`validation_error: ${summary}`);
    return res.status(400).json({
      error: {
        code: "validation_error",
        message: summary,
        details: flat,
      },
    });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(err);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  logger.error(err instanceof Error ? err : new Error(String(err)));
  return res.status(500).json({
    error: { code: "internal_error", message: "Internal server error" },
  });
};
