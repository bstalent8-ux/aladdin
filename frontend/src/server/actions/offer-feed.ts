"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import {
  OFFER_FEED_PAGE_SIZE,
  OFFER_PERIODS,
  OFFER_SORTS,
  type OffersPage,
  type OffersPageParams,
} from "@/features/offers/offer-model";
import { listOffersPage, signOfferImages } from "@/server/queries/offers";

/**
 * Server Actions for the audience Offers feed (every shell uses these). Each forwards the CALLER's
 * JWT: the RPCs re-derive the viewer, reject a workspace they do not belong to and apply the one
 * eligibility rule, so a forged argument can never widen what is returned.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OFFSET = 10_000;

export type OffersPageResult = { ok: true; page: OffersPage; imageUrls: Record<string, string> } | { ok: false };

/** One bounded batch of the feed for the given filters. */
export async function loadOffersPageAction(
  orgId: string | null,
  params: OffersPageParams,
  offset: number,
  limit: number = OFFER_FEED_PAGE_SIZE,
): Promise<OffersPageResult> {
  if (orgId !== null && !UUID.test(orgId)) return { ok: false };
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET || !Number.isInteger(limit) || limit < 1 || limit > 50) return { ok: false };
  const safe: OffersPageParams = {
    search: typeof params.search === "string" ? params.search.slice(0, 100) : "",
    category: typeof params.category === "string" ? params.category.slice(0, 60) : "",
    sellerType: typeof params.sellerType === "string" ? params.sellerType.slice(0, 60) : "",
    period: (OFFER_PERIODS as readonly string[]).includes(params.period) ? params.period : "all",
    sort: (OFFER_SORTS as readonly string[]).includes(params.sort) ? params.sort : "newest",
    savedOnly: params.savedOnly === true,
  };
  try {
    const supabase = await getServerSupabase();
    const page = await listOffersPage(supabase, orgId, safe, offset, limit);
    const imageUrls = await signOfferImages(supabase, page.items);
    return { ok: true, page, imageUrls };
  } catch {
    return { ok: false };
  }
}

/** Bookmark / un-bookmark an offer. Saving is accepted only for an offer this viewer can see right now. */
export async function setOfferSavedAction(offerId: string, saved: boolean, orgId: string | null): Promise<{ ok: boolean; saved: boolean }> {
  if (!UUID.test(offerId) || (orgId !== null && !UUID.test(orgId))) return { ok: false, saved: !saved };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("offer_set_saved", { p_offer_id: offerId, p_saved: saved, p_org_id: orgId ?? undefined });
  if (error) return { ok: false, saved: !saved };
  return { ok: true, saved: data === true };
}
