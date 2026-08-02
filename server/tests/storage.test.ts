import { getObjectStorage } from "../src/lib/storage";

describe("object storage (local)", () => {
  const key = `receipts/_test_${Date.now()}.pdf`;
  const body = Buffer.from("%PDF-1.4 test");

  afterAll(async () => {
    await getObjectStorage().delete(key).catch(() => undefined);
  });

  it("put/get/exists/delete round-trip", async () => {
    const storage = getObjectStorage();
    await storage.put(key, body, "application/pdf");
    expect(await storage.exists(key)).toBe(true);
    const got = await storage.get(key);
    expect(got.equals(body)).toBe(true);
    expect(await storage.getSignedUrl(key)).toBeNull();
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("rejects path traversal keys", async () => {
    const storage = getObjectStorage();
    await expect(storage.put("../escape.pdf", body)).rejects.toThrow(/invalid storage key/);
  });
});
