import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listCatalogPage, savedAmong, type CatalogRow } from "@/server/queries/commerce";
import { resolveProductImage, signProductImageUrls } from "@/server/queries/product-images";
import type { ShowroomCatalogParams } from "./catalog-params";

export type CatalogBatch = {
  products: CatalogRow[];
  total: number;
  /** Product id -> resolved image URL for THIS batch. */
  imageUrls: Record<string, string>;
  /** The products of THIS batch the organization has saved. */
  savedIds: string[];
};

/**
 * One bounded batch of "Browse Products" with everything a card needs. The first batch (server render)
 * and every "Show more" (server action) go through here, so they apply the same rules: published
 * products only, the caller's OWN organization excluded in the query itself, no price column at all.
 */
export async function loadCatalogBatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  params: ShowroomCatalogParams,
  offset: number,
  limit: number,
): Promise<CatalogBatch> {
  const { rows, total } = await listCatalogPage(
    supabase,
    { search: params.q, categoryCode: params.category, supplierOrgId: params.supplier, excludeOrgId: orgId },
    offset,
    limit,
  );
  const ids = rows.flatMap((p) => (p.id ? [p.id] : []));
  const [signed, saved] = await Promise.all([
    signProductImageUrls(supabase, rows.map((p) => p.primary_image_key)),
    savedAmong(supabase, orgId, ids),
  ]);
  const imageUrls: Record<string, string> = {};
  for (const p of rows) {
    const url = p.id ? resolveProductImage(p, signed) : null;
    if (p.id && url) imageUrls[p.id] = url;
  }
  return { products: rows, total, imageUrls, savedIds: [...saved] };
}
