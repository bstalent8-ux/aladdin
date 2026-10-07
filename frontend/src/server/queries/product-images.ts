import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/storage/product-images";

type DB = SupabaseClient<Database>;

export type OwnProductImage = { id: string; objectKey: string; slot: number };

/** Signed URLs are short-lived; pages are rendered per request, so an hour is ample. */
const SIGNED_URL_SECONDS = 3600;

/**
 * The READY images of the given products, in display order (lowest slot first),
 * through the caller's own RLS: an organization sees its own, anyone else only
 * those of published products. Pending uploads and removed images never appear.
 */
export async function listProductImages(supabase: DB, productIds: readonly string[]): Promise<Map<string, OwnProductImage[]>> {
  const out = new Map<string, OwnProductImage[]>();
  if (productIds.length === 0) return out;
  // PostgREST puts an `in` list in the query string; batch so a long list cannot outgrow the URL.
  for (let i = 0; i < productIds.length; i += 50) {
    const batch = productIds.slice(i, i + 50);
    const { data, error } = await supabase
      .from("product_images")
      .select("id, product_id, object_key, slot")
      .in("product_id", batch)
      .eq("state", "ready")
      .order("slot", { ascending: true });
    if (error) throw error;
    for (const row of data ?? []) {
      const list = out.get(row.product_id) ?? [];
      list.push({ id: row.id, objectKey: row.object_key, slot: row.slot });
      out.set(row.product_id, list);
    }
  }
  return out;
}

/**
 * Object key -> signed URL, signed with the CALLER's identity (no service role):
 * Storage only signs what the bucket policies already let that caller read — the
 * owning organization's images, or the ready images of a published product.
 * A key that cannot be signed is simply absent, so a card falls back to its
 * legacy `image_ref` or the placeholder instead of failing the page.
 */
export async function signProductImageUrls(supabase: DB, keys: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error || !data) return out;
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) out.set(entry.path, entry.signedUrl);
  }
  return out;
}

/** The image a card shows: the primary uploaded photo when it could be signed, else the legacy reference. */
export function resolveProductImage(
  row: { primary_image_key?: string | null; image_ref?: string | null },
  signed: ReadonlyMap<string, string>,
): string | null {
  if (row.primary_image_key) {
    const url = signed.get(row.primary_image_key);
    if (url) return url;
  }
  return row.image_ref ?? null;
}
