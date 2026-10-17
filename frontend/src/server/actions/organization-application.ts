"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { slotErrorCode } from "@/lib/workspace/applications";

/**
 * Owner-side writers for an organization application. Thin shape validators over the trusted
 * security-definer RPCs: ownership (`org.manage`), the one-open-application rule, the "a rejected
 * application is final" rule and the "an application awaiting a decision cannot be abandoned"
 * rule all live in the database (`organization_application_submit` / `_abandon`). The UI only
 * mirrors them; a direct post to these actions cannot go further than the RPCs allow.
 */
export type ApplicationActionState = { ok: boolean; code?: string };

const orgIdSchema = z.string().uuid();

function failure(error: { code?: string; hint?: string | null }): ApplicationActionState {
  if (error.code === "42501" || error.code === "22023") return { ok: false, code: slotErrorCode(error.hint) };
  return { ok: false, code: "orgApplications.error.generic" };
}

export async function submitOrganizationApplication(orgId: string): Promise<ApplicationActionState> {
  const id = orgIdSchema.safeParse(orgId);
  if (!id.success) return { ok: false, code: "orgApplications.error.generic" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_application_submit", { p_org_id: id.data });
  if (error) return failure(error);
  revalidatePath("/business/applications");
  return { ok: true };
}

export async function abandonOrganizationApplication(orgId: string): Promise<ApplicationActionState> {
  const id = orgIdSchema.safeParse(orgId);
  if (!id.success) return { ok: false, code: "orgApplications.error.generic" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_application_abandon", { p_org_id: id.data });
  if (error) return failure(error);
  revalidatePath("/business/applications");
  revalidatePath("/", "layout");
  return { ok: true };
}

const namesSchema = z.object({
  orgId: z.string().uuid(),
  nameAr: z.string().trim().max(120).nullish(),
  nameEn: z.string().trim().max(120).nullish(),
});

/**
 * Correct the organization's Arabic / English trading names while an application is open
 * (typically after the reviewer asked for changes). Only those two fields; the legal identity and
 * the organization TYPE are not editable here (the type is not client-writable at all).
 */
export async function updateApplicationNames(input: z.input<typeof namesSchema>): Promise<ApplicationActionState> {
  const parsed = namesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "orgApplications.error.generic" };
  const v = parsed.data;
  const supabase = await getServerSupabase();
  const { data: org } = await supabase.from("organizations").select("timezone").eq("id", v.orgId).maybeSingle();
  const { error } = await supabase.rpc("organization_update_i18n", {
    p_org_id: v.orgId,
    p_name_ar: v.nameAr ?? "",
    p_name_en: v.nameEn ?? "",
    p_timezone: org?.timezone ?? "",
  });
  if (error) return failure(error);
  revalidatePath("/business/applications");
  return { ok: true };
}
