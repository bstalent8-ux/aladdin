import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { listCatalogByIds, listSavedProductsPage, type CatalogRow } from "@/server/queries/commerce";
import { resolveProductImage, signProductImageUrls } from "@/server/queries/product-images";
import type { ShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";

export type SavedBatch = {
  products: CatalogRow[];
  total: number;
  imageUrls: Record<string, string>;
};

/**
 * One bounded batch of the active organization's shortlist, shown with the SAME rich rows Browse uses.
 * The shortlist view (RLS-scoped to the organization, published products only) decides WHICH products and
 * in which order; the catalog projection then supplies the card fields for just those ids. No price column
 * exists on either side.
 */
export async function loadSavedBatch(
  supabase: SupabaseClient<Database>,
  orgId: string,
  params: Pick<ShowroomCatalogParams, "q" | "category">,
  offset: number,
  limit: number,
): Promise<SavedBatch> {
  const { rows, total } = await listSavedProductsPage(supabase, orgId, { categoryCode: params.category, search: params.q }, offset, limit);
  const products = await listCatalogByIds(supabase, orgId, rows.flatMap((r) => (r.product_id ? [r.product_id] : [])));
  const signed = await signProductImageUrls(supabase, products.map((p) => p.primary_image_key), { orgId });
  const imageUrls: Record<string, string> = {};
  for (const p of products) {
    const url = p.id ? resolveProductImage(p, signed) : null;
    if (p.id && url) imageUrls[p.id] = url;
  }
  return { products, total, imageUrls };
}
