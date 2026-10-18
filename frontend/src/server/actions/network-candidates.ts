"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapCommerceError } from "@/server/actions/error-mapping";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";

/**
 * Submit / withdraw a supplier or craftsman who is NOT registered. Shape validation only: the
 * network.refer gate, the "at least one contact detail" rule and idempotency live in
 * `network_candidate_create`. A submission creates no account, organization or profile, exposes
 * no contact data and earns no Points - approval is a platform status change.
 */
export type CandidateState = { ok: boolean; code?: string; id?: string };

const schema = z.object({
  orgId: z.string().uuid(),
  kind: z.enum(["supplier", "craftsman"]),
  displayName: z.string().trim().min(2).max(120),
  businessType: z.enum(["supplier", "manufacturer", "importer"]).nullable(),
  tradeKey: z.string().trim().max(64).nullable(),
  governorate: z.string().trim().max(80).nullable(),
  city: z.string().trim().max(80).nullable(),
  phone: z.string().trim().max(32).nullable(),
  whatsapp: z.string().trim().max(32).nullable(),
  email: z.string().trim().max(254).nullable(),
  note: z.string().trim().max(500).nullable(),
});

const read = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

export async function createNetworkCandidateAction(_prev: CandidateState, fd: FormData): Promise<CandidateState> {
  const parsed = schema.safeParse({
    orgId: read(fd, "orgId"),
    kind: read(fd, "kind"),
    displayName: read(fd, "displayName") ?? "",
    businessType: read(fd, "businessType"),
    tradeKey: read(fd, "tradeKey"),
    governorate: read(fd, "governorate"),
    city: read(fd, "city"),
    phone: read(fd, "phone"),
    whatsapp: read(fd, "whatsapp"),
    email: read(fd, "email"),
    note: read(fd, "note"),
  });
  if (!parsed.success) return { ok: false, code: "states.genericRetry" };
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("network_candidate_create", {
    p_org_id: v.orgId,
    p_kind: v.kind,
    p_display_name: v.displayName,
    p_business_type: v.businessType ?? undefined,
    p_trade_key: v.tradeKey ?? undefined,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_phone: v.phone ?? undefined,
    p_whatsapp: v.whatsapp ?? undefined,
    p_email: v.email ?? undefined,
    p_note: v.note ?? undefined,
  });
  if (error) return { ok: false, code: mapCommerceError(error) };
  revalidatePath(`${SHOWROOM_ROOT}/suppliers`);
  revalidatePath(`${SHOWROOM_ROOT}/craftsmen`);
  return { ok: true, id: data ?? undefined };
}

export async function cancelNetworkCandidateAction(fd: FormData): Promise<CandidateState> {
  const id = z.string().uuid().safeParse(fd.get("candidateId"));
  if (!id.success) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("network_candidate_cancel", { p_candidate_id: id.data });
  if (error) return { ok: false, code: mapCommerceError(error) };
  revalidatePath(`${SHOWROOM_ROOT}/suppliers`);
  revalidatePath(`${SHOWROOM_ROOT}/craftsmen`);
  return { ok: true };
}
