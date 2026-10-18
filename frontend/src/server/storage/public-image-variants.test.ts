import { expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { generatePublicImageVariants } from "./public-image-variants";
it("decodes and resizes real public images without upscaling or keeping metadata", async () => {
  const bytes = await sharp({ create: { width: 800, height: 400, channels: 3, background: "white" } }).png().toBuffer();
  const variants = await generatePublicImageVariants(bytes, "image/png", 5242880);
  expect(variants.map((v) => v.width)).toEqual([320, 768, 1280]);
  const metadata = await Promise.all(variants.map((v) => sharp(v.bytes).metadata()));
  expect(metadata.map((m) => m.width)).toEqual([320, 768, 800]);
  expect(metadata.every((m) => m.format === "webp" && !m.exif)).toBe(true);
});
