import "server-only";
import sharp from "sharp";
import { verifyMediaBytes, withMediaProcessingSlot } from "./validation";

/** Prepared for explicitly public product/gallery pipelines; never used by the revocable portfolio proxy. */
export async function generatePublicImageVariants(bytes: Uint8Array, contentType: string, maxBytes: number) {
  await verifyMediaBytes(bytes, contentType, maxBytes);
  if (!contentType.startsWith("image/")) throw new Error("image required");
  return withMediaProcessingSlot(() => Promise.all([320, 768, 1280].map(async (width) => ({
    width, contentType: "image/webp" as const,
    bytes: await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
  }))));
}
