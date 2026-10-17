"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";
import { mapOfferError, parseOfferForm } from "@/features/offers/offer-input";
import { getOrgTimezone } from "@/server/queries/offers";

/**
 * Server Actions for Product Offers. Every one forwards the CALLER's JWT to a security-definer
 * RPC that re-derives the actor, checks membership and catalog.write / catalog.publish,
 * validates the whole package again and audits the change. Nothing here decides authorization.
 */

export type OfferFormState = { ok: boolean; code?: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MY_OFFERS = `${SHOWROOM_ROOT}/my-offers`;
const OFFERS_FEED = `${SHOWROOM_ROOT}/offers`;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const int = (fd: FormData, key: string) => {
  const v = str(fd, key);
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) ? n : undefined;
};

function revalidateOffers() {
  revalidatePath(MY_OFFERS);
  revalidatePath(OFFERS_FEED);
  revalidatePath(`${SHOWROOM_ROOT}/my-products`);
  revalidatePath(`${SHOWROOM_ROOT}/home`);
}

/** Only a known translation key may travel in a redirect, never arbitrary text. */
const SAFE_ERROR_KEY = /^showroomOffers\.errors\.[A-Za-z]+$/;

/**
 * Create or update an offer; with `intent=publish` also publish it. The save and the publish are
 * two database steps: when the publish is refused the offer stays a saved draft and the owner
 * lands on its edit page with the reason, so nothing typed is lost.
 */
export async function saveOfferAction(_prev: OfferFormState, fd: FormData): Promise<OfferFormState> {
  const orgId = str(fd, "orgId");
  const offerId = str(fd, "offerId");
  const version = int(fd, "expectedVersion");
  const intent = str(fd, "intent") === "publish" ? "publish" : "draft";
  if (!orgId || !UUID.test(orgId) || (offerId !== undefined && (!UUID.test(offerId) || version === undefined))) {
    return { ok: false, code: "showroomOffers.errors.generic" };
  }

  const supabase = await getServerSupabase();
  const zone = await getOrgTimezone(supabase, orgId);
  const parsed = parseOfferForm(fd, zone);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.fieldErrors };
  const v = parsed.value;

  // The SQL parameters without a DEFAULT accept NULL (an optional description/price/date); the generated types cannot say so.
  const { data, error } = await supabase.rpc("own_offer_save", {
    p_org_id: orgId,
    p_offer_id: (offerId ?? null) as string,
    p_expected_version: (version ?? null) as number,
    p_title: v.title,
    p_description: v.description as string,
    p_total_price: v.totalPrice as number,
    p_reference_price: v.referencePrice as number,
    p_starts_at: v.startsAt as string,
    p_ends_at: v.endsAt as string,
    p_items: v.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
    p_audiences: v.audiences,
  });
  const saved = data as { id?: unknown; version?: unknown } | null;
  if (error || !saved || typeof saved.id !== "string" || typeof saved.version !== "number") {
    const mapped = mapOfferError(error ?? new Error("invalid save result"));
    return mapped.field ? { ok: false, code: mapped.code, fieldErrors: { [mapped.field]: mapped.code } } : { ok: false, code: mapped.code };
  }

  revalidateOffers();
  if (intent === "publish") {
    const { error: publishError } = await supabase.rpc("own_offer_set_status", {
      p_offer_id: saved.id,
      p_action: "publish",
      p_expected_version: saved.version,
    });
    if (publishError) {
      const key = mapOfferError(publishError).code;
      redirect(`${MY_OFFERS}/${saved.id}/edit?saved=1${SAFE_ERROR_KEY.test(key) ? `&err=${encodeURIComponent(key)}` : ""}`);
    }
    redirect(`${MY_OFFERS}?published=1`);
  }
  redirect(`${MY_OFFERS}?saved=1`);
}

const OFFER_STATUS_ACTIONS = ["publish", "pause", "resume", "archive", "restore"] as const;
type OfferStatusAction = (typeof OFFER_STATUS_ACTIONS)[number];

/** Publish / pause / resume / archive / restore — one action, the database picks the rule. */
export async function offerStatusAction(_prev: OfferFormState, fd: FormData): Promise<OfferFormState> {
  const offerId = str(fd, "offerId");
  const version = int(fd, "expectedVersion");
  const action = str(fd, "action");
  if (!offerId || !UUID.test(offerId) || version === undefined || !(OFFER_STATUS_ACTIONS as readonly string[]).includes(action ?? "")) {
    return { ok: false, code: "showroomOffers.errors.generic" };
  }
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("own_offer_set_status", { p_offer_id: offerId, p_action: action as OfferStatusAction, p_expected_version: version });
  if (error) return { ok: false, code: mapOfferError(error).code };
  revalidateOffers();
  return { ok: true };
}
