"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { checkDescription } from "@/lib/text/description-limit";

/**
 * The organization's Business Description. The text belongs to the ORGANIZATION (never the creator's personal
 * profile); the RPC decides authorization itself (org.manage on that organization, checked live) and re-checks the
 * 250-character limit, so this file only validates early, for a fast translated answer, and maps the outcome.
 */
export type OrganizationDescriptionResult =
  | { ok: true; value: string | null }
  | { ok: false; code: "tooLong" | "forbidden" | "failed" };

const SETTINGS_PATHS = ["/showroom/settings", "/b2b/settings"] as const;

export async function saveOrganizationDescriptionAction(orgId: string, raw: string): Promise<OrganizationDescriptionResult> {
  const checked = checkDescription(raw);
  if (!checked.ok) return { ok: false, code: "tooLong" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("organization_description_set", {
    p_org_id: orgId,
    p_description: checked.value ?? "",
  });
  if (error) {
    if (error.code === "22023") return { ok: false, code: "tooLong" };
    if (error.code === "42501") return { ok: false, code: "forbidden" };
    return { ok: false, code: "failed" };
  }
  SETTINGS_PATHS.forEach((path) => revalidatePath(path));
  return { ok: true, value: data ?? null };
}
