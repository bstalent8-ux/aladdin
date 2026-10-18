import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { applicationMediaUrl } from "@/lib/storage/media-url";

/**
 * Current business image through an application route. The caller-scoped RPC
 * checks membership here and delivery rechecks it before returning private bytes.
 */
export async function loadOrganizationImageUrl(supabase: SupabaseClient<Database>, orgId: string): Promise<string | null> {
  const { data: key, error } = await supabase.rpc("organization_image_current", { p_org_id: orgId });
  if (error || !key) return null;
  return applicationMediaUrl("organization", key);
}
