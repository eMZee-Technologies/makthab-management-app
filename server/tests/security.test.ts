import { resolveJwtSecret, INSECURE_JWT_DEFAULTS } from "../src/lib/env";
import { resolveUnderFilesDir, FILES_DIR } from "../src/lib/paths";
import path from "node:path";

describe("resolveJwtSecret", () => {
  it("allows documented defaults in development", () => {
    expect(resolveJwtSecret("JWT_SECRET", undefined, "development", "dev-access-secret-change-me")).toBe(
      "dev-access-secret-change-me"
    );
  });

  it("rejects missing secrets in production", () => {
    expect(() => resolveJwtSecret("JWT_SECRET", undefined, "production", "dev-access-secret-change-me")).toThrow(
      /Missing required env var: JWT_SECRET/
    );
  });

  it("rejects documented development defaults in production", () => {
    for (const bad of INSECURE_JWT_DEFAULTS) {
      expect(() => resolveJwtSecret("JWT_SECRET", bad, "production", "dev-access-secret-change-me")).toThrow(
        /development default/
      );
    }
  });

  it("accepts a strong production secret", () => {
    expect(
      resolveJwtSecret("JWT_SECRET", "a-sufficiently-long-random-production-secret", "production", "dev-access-secret-change-me")
    ).toBe("a-sufficiently-long-random-production-secret");
  });
});

describe("resolveUnderFilesDir", () => {
  it("resolves a normal relative photo path under FILES_DIR", () => {
    const abs = resolveUnderFilesDir("photos/abc.jpg");
    expect(abs).toBe(path.resolve(FILES_DIR, "photos/abc.jpg"));
  });

  it("rejects absolute paths", () => {
    expect(() => resolveUnderFilesDir("/etc/passwd")).toThrow("invalid_file_path");
  });

  it("rejects path traversal", () => {
    expect(() => resolveUnderFilesDir("../../etc/passwd")).toThrow("invalid_file_path");
    expect(() => resolveUnderFilesDir("photos/../../etc/passwd")).toThrow("invalid_file_path");
  });
});
