import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ORGANIZATION_IMAGE_BUCKET } from "@/lib/storage/organization-image-assets";

/** How long a signed read URL lives. Minted per render, never stored. */
const READ_URL_SECONDS = 300;

/**
 * The current business image as a short-lived signed URL, or null. Only MEMBERS of the organization get a key
 * (`organization_image_current` checks membership) and the storage policy re-checks it when signing; the caller's
 * own client is used throughout - no service role, no public URL.
 */
export async function loadOrganizationImageUrl(supabase: SupabaseClient<Database>, orgId: string): Promise<string | null> {
  const { data: key, error } = await supabase.rpc("organization_image_current", { p_org_id: orgId });
  if (error || !key) return null;
  const { data } = await supabase.storage.from(ORGANIZATION_IMAGE_BUCKET).createSignedUrl(key, READ_URL_SECONDS);
  return data?.signedUrl ?? null;
}
