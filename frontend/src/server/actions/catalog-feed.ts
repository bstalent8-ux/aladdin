"use server";

import { requireShowroomContext } from "@/features/showroom-shell/context";
import { loadCatalogBatch, type CatalogBatch } from "@/features/showroom-shell/catalog/catalog-data";
import { parseShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";
import { PAGE_BATCH } from "@/lib/pagination/batches";

const MAX_OFFSET = 10_000;

export type CatalogBatchResult = ({ ok: true } & CatalogBatch) | { ok: false };

/**
 * "Show more" for Browse Products: the next bounded batch for the given filters. The viewer's
 * organization comes from the session (never from the client), so its own products stay excluded
 * and the filters are re-validated by the same parser the URL goes through.
 */
export async function loadCatalogBatchAction(
  raw: { q?: string; category?: string; supplier?: string },
  offset: number,
): Promise<CatalogBatchResult> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return { ok: false };
  try {
    const { supabase, org } = await requireShowroomContext();
    const params = parseShowroomCatalogParams(raw);
    return { ok: true, ...(await loadCatalogBatch(supabase, org.organizationId, params, offset, PAGE_BATCH)) };
  } catch {
    return { ok: false };
  }
}
