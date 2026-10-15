/**
 * The purchase-request reference-image contract: a fast, honest answer for the browser before
 * anything uploads. It is NOT the authority - the private `purchase-request-images` bucket's own
 * `allowed_mime_types` / `file_size_limit`, the metadata-row ownership model and the two-image
 * limit in the database (20261015090020) decide. Pure on purpose: no Supabase client.
 */
export const REQUEST_IMAGE_BUCKET = "purchase-request-images";
export const REQUEST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REQUEST_IMAGE_MAX_PER_ITEM = 2;
export const REQUEST_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** `<owner>/<request>/<image>.<ext>` - the owner is the organization, or the person for an individual request. */
const KEY_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const isRequestImageKey = (v: unknown): v is string => typeof v === "string" && KEY_SHAPE.test(v);
export const isRequestImageContentType = (t: string): boolean => (REQUEST_IMAGE_ALLOWED_TYPES as readonly string[]).includes(t);

export type RequestImageValidation = { ok: true } | { ok: false; code: "purchaseRequests.errors.imageType" | "purchaseRequests.errors.imageSize" };

export function validateRequestImageFile(file: { type: string; size: number }): RequestImageValidation {
  if (!isRequestImageContentType(file.type)) return { ok: false, code: "purchaseRequests.errors.imageType" };
  if (file.size <= 0 || file.size > REQUEST_IMAGE_MAX_BYTES) return { ok: false, code: "purchaseRequests.errors.imageSize" };
  return { ok: true };
}
