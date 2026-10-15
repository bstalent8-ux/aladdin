"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { isProductImageKey, PRODUCT_IMAGE_BUCKET } from "@/lib/storage/product-images";
import { loadWorkspaceContext } from "@/server/queries/context";
import { signProductImageUrls } from "@/server/queries/product-images";

const SIGNED_PATH = new RegExp(`/storage/v1/object/sign/${PRODUCT_IMAGE_BUCKET}/(.+)$`);

/**
 * A product photo's signed URL lives five minutes (a signed URL cannot be revoked, so the lifetime bounds
 * access that ends with a membership, an audience change or an unpublish). A page left open longer, or an
 * image that loads lazily after that, asks here for a fresh one. Authorization is unchanged: the URL is
 * minted with the CALLER's session after the database re-grants signing for the ACTIVE workspace (or the
 * personal audience on /home), so a photo the caller may no longer see simply comes back null.
 */
export async function refreshProductImageUrlAction(staleUrl: string, scope: "workspace" | "personal"): Promise<string | null> {
  if (typeof staleUrl !== "string" || staleUrl.length > 2048) return null;
  let key: string;
  try {
    const match = SIGNED_PATH.exec(new URL(staleUrl).pathname);
    if (!match?.[1]) return null;
    key = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!isProductImageKey(key)) return null;

  const supabase = await getServerSupabase();
  const orgId = scope === "personal" ? null : ((await loadWorkspaceContext(supabase)).active?.organizationId ?? null);
  const signed = await signProductImageUrls(supabase, [key], { orgId });
  return signed.get(key) ?? null;
}
