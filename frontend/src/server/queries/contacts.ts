import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type DB = SupabaseClient<Database>;

/** Only the fields the OWNER chose to expose; every other field is null. */
export type ExposedContact = { phone: string | null; whatsapp: string | null; email: string | null };

const none = (c: ExposedContact | null) => (c && (c.phone || c.whatsapp || c.email) ? c : null);

/**
 * Contact of a directory-eligible business, read through the active workspace of the viewer. The
 * database rejects a workspace the caller is not a member of, and an ineligible or fully-hidden
 * target yields null - callers cannot tell "hidden" from "absent", on purpose.
 */
export async function getBusinessContact(supabase: DB, viewerOrgId: string, organizationId: string): Promise<ExposedContact | null> {
  const { data, error } = await supabase.rpc("business_contact", { p_viewer_org_id: viewerOrgId, p_organization_id: organizationId });
  if (error) throw error;
  return none(data?.[0] ?? null);
}

export async function getCraftsmanContact(supabase: DB, viewerOrgId: string, profileId: string): Promise<ExposedContact | null> {
  const { data, error } = await supabase.rpc("craftsman_contact", { p_viewer_org_id: viewerOrgId, p_profile_id: profileId });
  if (error) throw error;
  return none(data?.[0] ?? null);
}

export type OwnOrganizationContact = {
  phone_e164: string | null;
  whatsapp_e164: string | null;
  contact_email: string | null;
  show_phone: boolean;
  show_whatsapp: boolean;
  show_email: boolean;
};

/** The owner's own settings (RLS: org.manage members only). All flags are false until saved. */
export async function getOwnOrganizationContact(supabase: DB, organizationId: string): Promise<OwnOrganizationContact> {
  const { data, error } = await supabase
    .from("organization_contacts")
    .select("phone_e164, whatsapp_e164, contact_email, show_phone, show_whatsapp, show_email")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { phone_e164: null, whatsapp_e164: null, contact_email: null, show_phone: false, show_whatsapp: false, show_email: false };
}
