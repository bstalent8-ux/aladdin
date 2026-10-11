import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeSearchTerm } from "@/server/queries/sales";
import { REQUEST_IMAGE_BUCKET } from "@/lib/storage/request-images";
import {
  parseRequestDetail,
  parseRequestItems,
  parseResponse,
  compareResponses,
  isUuid,
  type RequestDetailView,
  type ResponseView,
} from "@/features/purchase-requests/model";

type DB = SupabaseClient<Database>;

type DiscoverRaw = Database["public"]["Functions"]["purchase_requests_discover"]["Returns"][number];
/** One row of a workspace's discovery feed (optional columns are nullable although the generator types them non-null). */
export type DiscoveredRequest = { [K in keyof DiscoverRaw]: DiscoverRaw[K] | null } & { id: string; title: string };

export type DiscoverFilters = {
  /** Canonical category code: requests that contain at least one item of it. */
  categoryCode?: string;
  search?: string;
};

/**
 * One bounded batch of the requests the ACTIVE workspace may answer. The audience is derived in the
 * database from `viewerOrgId` (membership verified there); requests of the workspace itself and of the
 * caller as author are never returned. Newest first with the id as a tie-break, so batches neither
 * repeat nor skip a row.
 */
export async function discoverRequestsPage(
  supabase: DB,
  viewerOrgId: string,
  f: DiscoverFilters,
  offset: number,
  limit: number,
): Promise<{ rows: DiscoveredRequest[]; total: number }> {
  let q = supabase
    .rpc("purchase_requests_discover", { p_org_id: viewerOrgId }, { count: "exact" })
    .order("published_at", { ascending: false })
    .order("id", { ascending: false });
  if (f.categoryCode) q = q.contains("category_codes", [f.categoryCode]);
  const term = f.search ? sanitizeSearchTerm(f.search) : "";
  if (term) q = q.ilike("title", `%${term}%`);
  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: (data ?? []) as DiscoveredRequest[], total: count ?? 0 };
}

/** A request as the discovering / responding workspace sees it; null when it is not (or no longer) theirs to read. */
export async function getRequestForWorkspace(supabase: DB, viewerOrgId: string, requestId: string): Promise<RequestDetailView | null> {
  if (!isUuid(requestId)) return null;
  const { data, error } = await supabase.rpc("purchase_request_detail", { p_org_id: viewerOrgId, p_request_id: requestId });
  if (error) throw error;
  return parseRequestDetail(data);
}

// ---------------------------------------------------------------------------
// The requester's own side (RLS: the individual author, or members of the owning organization)
// ---------------------------------------------------------------------------
export type OwnRequestRow = Database["public"]["Tables"]["purchase_requests"]["Row"];

export async function listMyRequests(supabase: DB, ownerOrgId: string | null, limit = 50): Promise<OwnRequestRow[]> {
  let q = supabase.from("purchase_requests").select("*").order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  q = ownerOrgId ? q.eq("requester_org_id", ownerOrgId) : q.is("requester_org_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type OwnRequest = { request: OwnRequestRow; items: RequestDetailView["items"] };

/** One of the caller's own requests with its items and READY images; null when it is not theirs. */
export async function getMyRequest(supabase: DB, requestId: string): Promise<OwnRequest | null> {
  if (!isUuid(requestId)) return null;
  const { data: request, error } = await supabase.from("purchase_requests").select("*").eq("id", requestId).maybeSingle();
  if (error) throw error;
  if (!request) return null;
  const [items, images] = await Promise.all([
    supabase.from("purchase_request_items").select("*").eq("request_id", requestId).order("position", { ascending: true }),
    supabase.from("purchase_request_images").select("id, item_id, object_key, slot").eq("request_id", requestId).eq("state", "ready").order("slot", { ascending: true }),
  ]);
  if (items.error) throw items.error;
  if (images.error) throw images.error;
  const byItem = new Map<string, Array<{ id: string; key: string; slot: number }>>();
  for (const m of images.data ?? []) byItem.set(m.item_id, [...(byItem.get(m.item_id) ?? []), { id: m.id, key: m.object_key, slot: m.slot }]);
  return {
    request,
    items: parseRequestItems(
      (items.data ?? []).map((i) => ({
        id: i.id,
        position: i.position,
        name: i.name,
        code: i.code,
        category_code: i.category_code,
        color_items: i.color_items,
        quantity: i.quantity,
        unit: i.unit,
        specs: i.specs,
        images: (byItem.get(i.id) ?? []).map((m) => ({ id: m.id, key: m.key, slot: m.slot })),
      })),
    ),
  };
}

/** Every submitted response to the caller's own request, shortlist first then cheapest first. */
export async function listResponsesForRequester(supabase: DB, requestId: string): Promise<ResponseView[]> {
  if (!isUuid(requestId)) return [];
  const { data, error } = await supabase.rpc("purchase_request_responses_for_requester", { p_request_id: requestId });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => {
    const parsed = parseResponse(r);
    return parsed ? [parsed] : [];
  }).sort(compareResponses);
}

// ---------------------------------------------------------------------------
// Reference images
// ---------------------------------------------------------------------------
const SIGNED_URL_SECONDS = 3600;

/**
 * Key -> signed URL, signed with the CALLER's identity (no service role). The requester's own images sign
 * directly. Another workspace's images need a permission minted for the ACTIVE workspace first (pass
 * `viewer`); the database grants it only while the workspace can still read the request, and re-checks on
 * every use. A key that cannot be signed is simply absent.
 */
export async function signRequestImageUrls(
  supabase: DB,
  keys: readonly (string | null | undefined)[],
  viewer?: { orgId: string },
): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  if (viewer) {
    for (let i = 0; i < unique.length; i += 60) {
      const { error } = await supabase.rpc("request_image_access_grant", { p_org_id: viewer.orgId, p_keys: unique.slice(i, i + 60) });
      if (error) return out;
    }
  }
  const { data, error } = await supabase.storage.from(REQUEST_IMAGE_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error || !data) return out;
  for (const entry of data) if (entry.path && entry.signedUrl && !entry.error) out.set(entry.path, entry.signedUrl);
  return out;
}
