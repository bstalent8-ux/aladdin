"use server";

import { requireShowroomContext } from "@/features/showroom-shell/context";
import { loadSavedBatch, type SavedBatch } from "@/features/showroom-shell/saved/saved-data";
import { parseShowroomCatalogParams } from "@/features/showroom-shell/catalog/catalog-params";
import { PAGE_BATCH } from "@/lib/pagination/batches";

const MAX_OFFSET = 10_000;

export type ShowroomSavedBatchResult = ({ ok: true } & SavedBatch) | { ok: false };

/**
 * "Show more" for the showroom Saved Products page: the next bounded batch of the ACTIVE organization's
 * shortlist. The organization comes from the session; the filters pass the same parser the URL does.
 */
export async function loadShowroomSavedBatchAction(raw: { q?: string; category?: string }, offset: number): Promise<ShowroomSavedBatchResult> {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) return { ok: false };
  try {
    const { supabase, org } = await requireShowroomContext();
    const params = parseShowroomCatalogParams(raw);
    return { ok: true, ...(await loadSavedBatch(supabase, org.organizationId, params, offset, PAGE_BATCH)) };
  } catch {
    return { ok: false };
  }
}
