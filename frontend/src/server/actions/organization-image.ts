"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { ORGANIZATION_IMAGE_BUCKET } from "@/lib/storage/organization-image-assets";

/**
 * The Showroom's BUSINESS profile image (never the owner's personal avatar). Each step is one RPC that decides
 * authorization itself (org.manage on that organization, re-checked live); this file only translates the call
 * into a result the client component can render, as `profile-identity.ts` does for the personal avatar.
 */
export type OrganizationImageTicket = { ok: true; key: string } | { ok: false; code: string };
export type OrganizationImageResult = { ok: true } | { ok: false; code: string };

const SETTINGS_PATHS = ["/preview/showroom-suite-v2/settings", "/b2b/settings"] as const;
const refresh = () => SETTINGS_PATHS.forEach((path) => revalidatePath(path));

/** Step 1 - the pending metadata row and the server-generated key the browser must upload to. */
export async function requestOrganizationImageUploadAction(orgId: string, contentType: string): Promise<OrganizationImageTicket> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("organization_image_request_upload", { p_org_id: orgId, p_content_type: contentType });
  if (error || !data) return { ok: false, code: "showroomSettings.image.errorUpload" };
  return { ok: true, key: data };
}

/** Step 3 - makes the uploaded object current; the previous object is deleted best-effort with the caller's own client. */
export async function confirmOrganizationImageUploadAction(objectKey: string): Promise<OrganizationImageResult> {
  const supabase = await getServerSupabase();
  const { data: previousKey, error } = await supabase.rpc("organization_image_confirm_upload", { p_object_key: objectKey });
  if (error) return { ok: false, code: "showroomSettings.image.errorUpload" };
  if (previousKey) await supabase.storage.from(ORGANIZATION_IMAGE_BUCKET).remove([previousKey]);
  refresh();
  return { ok: true };
}

export async function removeOrganizationImageAction(orgId: string): Promise<OrganizationImageResult> {
  const supabase = await getServerSupabase();
  const { data: previousKey, error } = await supabase.rpc("organization_image_remove", { p_org_id: orgId });
  if (error) return { ok: false, code: "showroomSettings.image.errorRemove" };
  if (previousKey) await supabase.storage.from(ORGANIZATION_IMAGE_BUCKET).remove([previousKey]);
  refresh();
  return { ok: true };
}
