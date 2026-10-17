import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listOwnProductsPage, listProductPrices } from "@/server/queries/commerce";
import { listProductOfferStates } from "@/server/queries/offers";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { effectiveColors } from "./color-items";
import { statusFilterToQuery, type MyProductsParams } from "./my-products-params";
import type { OwnProductCard } from "./own-products-results";

/**
 * One bounded batch of "My Products" with everything a management card needs (photo, owner-private
 * price, real offer state). The first batch (server render) and every "Show more" (server action)
 * go through here. The status tabs' counts are NOT derived from this batch — they come from
 * `ownProductCounts` over the whole shelf.
 */
export async function loadMyProductsBatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  params: MyProductsParams,
  offset: number,
  limit: number,
): Promise<{ cards: OwnProductCard[]; total: number }> {
  const { rows, total } = await listOwnProductsPage(
    supabase,
    orgId,
    { search: params.q, categoryCode: params.category, sort: params.sort, ...statusFilterToQuery(params.status) },
    offset,
    limit,
  );
  const ids = rows.map((r) => r.id);
  const [prices, offerStates, images] = await Promise.all([
    listProductPrices(supabase, ids),
    listProductOfferStates(supabase, ids),
    listProductImages(supabase, ids),
  ]);
  const signed = await signProductImageUrls(supabase, rows.map((r) => images.get(r.id)?.[0]?.objectKey ?? null));
  const cards = rows.map((r): OwnProductCard => {
    const key = images.get(r.id)?.[0]?.objectKey;
    return {
      id: r.id,
      name: r.name,
      code: r.sku,
      categoryCode: r.category_code,
      unit: r.unit,
      status: r.status,
      archivedAt: r.archived_at,
      version: r.version,
      imageUrl: (key ? signed.get(key) : undefined) ?? r.image_ref ?? null,
      sizeLabel: r.size_label,
      weightKg: r.weight_kg,
      colors: effectiveColors(r),
      basePrice: prices.get(r.id) ?? null,
      offerState: offerStates.get(r.id),
    };
  });
  return { cards, total };
}
