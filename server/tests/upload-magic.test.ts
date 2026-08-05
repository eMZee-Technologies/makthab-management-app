import { detectImageMime, assertAllowedImageBuffer } from "../src/lib/upload";
import { AppError } from "../src/middleware/errorHandler";

describe("upload magic-byte validation", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP"),
  ]);
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // PE header

  it("detects JPEG / PNG / WebP signatures", () => {
    expect(detectImageMime(jpeg)).toBe("image/jpeg");
    expect(detectImageMime(png)).toBe("image/png");
    expect(detectImageMime(webp)).toBe("image/webp");
    expect(detectImageMime(exe)).toBeNull();
  });

  it("rejects non-image payloads even if labeled as images", () => {
    expect(() => assertAllowedImageBuffer(exe)).toThrow(AppError);
    try {
      assertAllowedImageBuffer(exe);
    } catch (e) {
      expect((e as AppError).code).toBe("invalid_file");
    }
  });

  it("accepts real image buffers", () => {
    expect(assertAllowedImageBuffer(jpeg)).toEqual({ mime: "image/jpeg", ext: ".jpg" });
    expect(assertAllowedImageBuffer(png)).toEqual({ mime: "image/png", ext: ".png" });
  });
});
