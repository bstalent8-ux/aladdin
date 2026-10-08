"use server";

import { requireShowroomContext } from "@/features/showroom-shell/context";
import { loadMyProductsBatch } from "@/features/showroom-shell/products/my-products-data";
import { parseMyProductsParams } from "@/features/showroom-shell/products/my-products-params";
import type { OwnProductCard } from "@/features/showroom-shell/products/own-products-results";
import { PAGE_BATCH } from "@/lib/pagination/batches";

const MAX_OFFSET = 10_000;

export type MyProductsBatchResult = { ok: true; cards: OwnProductCard[]; total: number } | { ok: false };

/**
 * "Show more" for My Products: the next bounded batch of the ACTIVE organization's own shelf for
 * the given filters. The organization comes from the session, never from the client, and RLS
 * still scopes every read to it.
 */
export async function loadMyProductsBatchAction(
  raw: { q?: string; category?: string; status?: string; sort?: string },
  offset: number,
): Promise<MyProductsBatchResult> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return { ok: false };
  try {
    const { supabase, org } = await requireShowroomContext();
    const { cards, total } = await loadMyProductsBatch(supabase, org.organizationId, parseMyProductsParams(raw), offset, PAGE_BATCH);
    return { ok: true, cards, total };
  } catch {
    return { ok: false };
  }
}
