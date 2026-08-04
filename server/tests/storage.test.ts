import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  LocalStorageAdapter,
  assertSafeStorageKey,
  normalizeStoredKey,
  resolveStorageBackend,
  resetStorageAdapter,
} from "../src/lib/storage";

describe("storage keys", () => {
  it("accepts relative photo/receipt keys", () => {
    expect(assertSafeStorageKey("photos/abc.jpg")).toBe("photos/abc.jpg");
    expect(assertSafeStorageKey("receipts/R-1.pdf")).toBe("receipts/R-1.pdf");
  });

  it("rejects absolute paths and traversal", () => {
    expect(() => assertSafeStorageKey("/etc/passwd")).toThrow("invalid_file_path");
    expect(() => assertSafeStorageKey("../etc/passwd")).toThrow("invalid_file_path");
    expect(() => assertSafeStorageKey("photos/../../etc/passwd")).toThrow("invalid_file_path");
  });

  it("normalizes legacy absolute receipt paths to relative keys", () => {
    expect(normalizeStoredKey("/workspace/data/files/receipts/R-1.pdf")).toBe("receipts/R-1.pdf");
    expect(normalizeStoredKey("photos/staff-1.jpg")).toBe("photos/staff-1.jpg");
  });
});

describe("LocalStorageAdapter", () => {
  let root: string;
  let storage: LocalStorageAdapter;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "makthab-storage-"));
    storage = new LocalStorageAdapter(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("save / exists / get / delete round-trip", async () => {
    const key = "photos/test.jpg";
    const payload = Buffer.from("fake-image-bytes");
    await storage.save(key, payload, { contentType: "image/jpeg" });

    expect(await storage.exists(key)).toBe(true);
    expect(fs.existsSync(path.join(root, key))).toBe(true);

    const obj = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("save accepts a Readable stream", async () => {
    const key = "receipts/stream.pdf";
    await storage.save(key, Readable.from([Buffer.from("%PDF-1.4")]));
    expect(await storage.exists(key)).toBe(true);
  });

  it("getSignedUrl is null for local backend", async () => {
    expect(await storage.getSignedUrl("photos/x.jpg")).toBeNull();
  });
});

describe("resolveStorageBackend", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    resetStorageAdapter();
  });

  it("defaults to local outside production", () => {
    delete process.env.STORAGE_BACKEND;
    // Re-import is heavy; exercise the exported helper via env already loaded.
    // When STORAGE_BACKEND is unset, factory uses isProd — in test NODE_ENV is "test".
    expect(resolveStorageBackend()).toBe("local");
  });
});
