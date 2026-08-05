import type { Request, Response } from "express";

/**
 * Unit-level coverage for backup second-factor (security redesign §3.2).
 * Full HTTP coverage of the unset-token path lives in admin.test.ts.
 *
 * Uses jest.resetModules so env.backupInternalToken is re-read from process.env.
 */
describe("requireBackupInternalAccess", () => {
  const res = {} as Response;
  const originalToken = process.env.BACKUP_INTERNAL_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.BACKUP_INTERNAL_TOKEN;
    else process.env.BACKUP_INTERNAL_TOKEN = originalToken;
    jest.resetModules();
  });

  function invoke(envToken: string | undefined, header: string | undefined): { status?: number; code?: string } | undefined {
    if (envToken === undefined) delete process.env.BACKUP_INTERNAL_TOKEN;
    else process.env.BACKUP_INTERNAL_TOKEN = envToken;
    jest.resetModules();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireBackupInternalAccess } = require("../src/routes/admin");

    const req = {
      headers: header !== undefined ? { "x-makthab-backup-token": header } : {},
    } as unknown as Request;

    let thrown: { status?: number; code?: string } | undefined;
    try {
      requireBackupInternalAccess(req, res, (e?: unknown) => {
        if (e && typeof e === "object") thrown = e as { status?: number; code?: string };
      });
    } catch (e) {
      thrown = e as { status?: number; code?: string };
    }
    return thrown;
  }

  it("allows when token unset (non-production)", () => {
    expect(invoke(undefined, undefined)).toBeUndefined();
  });

  it("rejects missing/wrong token when configured", () => {
    const missing = invoke("secret-token", undefined);
    expect(missing?.status).toBe(403);
    expect(missing?.code).toBe("forbidden");

    const wrong = invoke("secret-token", "nope");
    expect(wrong?.status).toBe(403);
  });

  it("allows matching X-Makthab-Backup-Token", () => {
    expect(invoke("secret-token", "secret-token")).toBeUndefined();
  });
});
