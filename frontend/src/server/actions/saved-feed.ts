"use server";

import { getPageContext } from "@/server/queries/page-context";
import { listSavedProductsPage, type SavedProductRow } from "@/server/queries/commerce";
import { PRODUCT_CATEGORIES } from "@/features/commerce/constants";
import { PAGE_BATCH } from "@/lib/pagination/batches";
import type { ProductCategory } from "@/server/queries/commerce";

const MAX_OFFSET = 10_000;

export type SavedBatchResult = { ok: true; rows: SavedProductRow[]; total: number } | { ok: false };

/**
 * "Show more" for Saved Products: the next bounded batch of the ACTIVE organization's shortlist
 * for the chosen category tab. The organization comes from the session; RLS still scopes the read to it.
 */
export async function loadSavedBatchAction(category: string, offset: number): Promise<SavedBatchResult> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return { ok: false };
  try {
    const ctx = await getPageContext();
    if (!ctx) return { ok: false };
    const cat = PRODUCT_CATEGORIES.includes(category as ProductCategory) ? (category as ProductCategory) : undefined;
    const { rows, total } = await listSavedProductsPage(ctx.supabase, ctx.org.organizationId, { category: cat }, offset, PAGE_BATCH);
    return { ok: true, rows, total };
  } catch {
    return { ok: false };
  }
}
