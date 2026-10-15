import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listOwnOffersPage, ownOfferPhaseCounts, type OwnOffer } from "@/server/queries/offers";
import { OFFER_AUDIENCE_GROUPS, type MyOffersParams, type OfferPhase } from "./offer-model";

export type MyOffersBatch = { offers: OwnOffer[]; total: number; counts: Record<OfferPhase, number> };

/**
 * One bounded batch of the owner list plus the whole-history phase counts. The first batch (server render)
 * and every "Show more"/filter change (server action) go through here; the summary counts are never derived from the batch.
 */
export async function loadMyOffersBatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  params: MyOffersParams,
  offset: number,
  limit: number,
): Promise<MyOffersBatch> {
  const group = OFFER_AUDIENCE_GROUPS.find((g) => g.id === params.audience);
  const [page, counts] = await Promise.all([
    listOwnOffersPage(
      supabase,
      orgId,
      {
        phase: params.phase || undefined,
        audienceCodes: group?.codes,
        search: params.q,
        period: params.period === "all" ? undefined : params.period,
        sort: params.sort,
      },
      offset,
      limit,
    ),
    ownOfferPhaseCounts(supabase, orgId),
  ]);
  return { ...page, counts };
}
