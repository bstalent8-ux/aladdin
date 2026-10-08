import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { batches, listOwnProducts } from "@/server/queries/commerce";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { effectiveColors, type ProductColor } from "@/features/showroom-shell/products/color-items";
import { DEFAULT_OFFER_TIMEZONE } from "@/features/offers/offer-datetime";
import { DEFAULT_OFFERS_PARAMS, OFFER_FEED_PAGE_SIZE, OFFER_PHASES, parseOffersPage, parsePublicOffer, type OfferPhase, type OffersPage, type OffersPageParams, type OfferStatus, type PublicOffer } from "@/features/offers/offer-model";

type DB = SupabaseClient<Database>;

/**
 * Read queries for Product Offers. Audience reads go ONLY through the two projection RPCs
 * (`offers_feed` / `offer_detail`), which apply the single eligibility rule in the database
 * and return a price-safe shape; owner reads go through owner-scoped RLS. Nothing here
 * touches `product_prices`.
 */

/** The organization's business time zone (owner-readable); Cairo when none is set. */
export async function getOrgTimezone(supabase: DB, orgId: string): Promise<string> {
  const { data } = await supabase.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  return (data as { timezone?: string | null } | null)?.timezone || DEFAULT_OFFER_TIMEZONE;
}

// ---------------------------------------------------------------------------
// Audience side
// ---------------------------------------------------------------------------
/** `orgId` is the ACTIVE business workspace, or null for a personal account (matched on its persona). */
export async function listOffersPage(
  supabase: DB,
  orgId: string | null,
  params: OffersPageParams = DEFAULT_OFFERS_PARAMS,
  offset = 0,
  limit = OFFER_FEED_PAGE_SIZE,
): Promise<OffersPage> {
  const { data, error } = await supabase.rpc("offers_feed_page", {
    p_org_id: orgId ?? undefined,
    p_limit: limit,
    p_offset: offset,
    p_search: params.search || undefined,
    p_category: params.category || undefined,
    p_seller_type: params.sellerType || undefined,
    p_period: params.period,
    p_sort: params.sort,
    p_saved_only: params.savedOnly,
  });
  if (error) throw error;
  return parseOffersPage(data);
}

/** A few other offers for the detail page's "more offers" strip. */
export async function listRelatedOffers(supabase: DB, orgId: string | null, exceptId: string): Promise<PublicOffer[]> {
  const page = await listOffersPage(supabase, orgId, DEFAULT_OFFERS_PARAMS, 0, 4);
  return page.items.filter((o) => o.id !== exceptId).slice(0, 3);
}

export async function getOfferDetail(supabase: DB, orgId: string | null, offerId: string): Promise<PublicOffer | null> {
  const { data, error } = await supabase.rpc("offer_detail", { p_offer_id: offerId, p_org_id: orgId ?? undefined });
  if (error) throw error;
  return data ? parsePublicOffer(data) : null;
}

/** Signed image URLs (the caller's own access) for every product photo an offer list shows. */
export async function signOfferImages(supabase: DB, offers: readonly PublicOffer[]): Promise<Record<string, string>> {
  const signed = await signProductImageUrls(supabase, offers.flatMap((o) => o.items.map((i) => i.imageKey)));
  return Object.fromEntries(signed);
}

// ---------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------
export type OwnOfferItem = { productId: string; name: string; code: string | null; quantity: number; imageUrl: string | null };
export type OwnOffer = {
  id: string;
  title: string;
  description: string | null;
  status: OfferStatus;
  phase: OfferPhase;
  version: number;
  totalPrice: number;
  referencePrice: number | null;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  itemCount: number;
  totalQuantity: number;
  invalidItemCount: number;
  audiences: string[];
  items: OwnOfferItem[];
};

type OfferRow = Database["public"]["Views"]["own_product_offers"]["Row"];

function toOwnOffer(row: OfferRow, audiences: string[], items: OwnOfferItem[]): OwnOffer | null {
  if (!row.id || !row.title || !row.status || !row.phase || row.version == null || row.total_price == null || !row.starts_at || !row.ends_at) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    phase: row.phase as OfferPhase,
    version: row.version,
    totalPrice: Number(row.total_price),
    referencePrice: row.reference_price == null ? null : Number(row.reference_price),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    updatedAt: row.updated_at ?? row.created_at ?? row.starts_at,
    itemCount: row.item_count ?? items.length,
    totalQuantity: row.total_quantity ?? items.reduce((n, i) => n + i.quantity, 0),
    invalidItemCount: row.invalid_item_count ?? 0,
    audiences,
    items,
  };
}

async function loadOfferParts(supabase: DB, offerIds: string[]) {
  const itemsByOffer = new Map<string, Array<{ product_id: string; quantity: number; position: number }>>();
  const audiencesByOffer = new Map<string, string[]>();
  for (const batch of batches(offerIds)) {
    const [items, audiences] = await Promise.all([
      supabase.from("product_offer_items").select("offer_id, product_id, quantity, position").in("offer_id", batch).order("position", { ascending: true }),
      supabase.from("product_offer_audiences").select("offer_id, audience").in("offer_id", batch),
    ]);
    if (items.error) throw items.error;
    if (audiences.error) throw audiences.error;
    for (const r of items.data ?? []) itemsByOffer.set(r.offer_id, [...(itemsByOffer.get(r.offer_id) ?? []), r]);
    for (const r of audiences.data ?? []) audiencesByOffer.set(r.offer_id, [...(audiencesByOffer.get(r.offer_id) ?? []), r.audience]);
  }
  const productIds = [...new Set([...itemsByOffer.values()].flat().map((i) => i.product_id))];
  const products = new Map<string, { id: string; name: string; sku: string | null; image_ref: string | null }>();
  for (const batch of batches(productIds)) {
    const { data, error } = await supabase.from("products").select("id, name, sku, image_ref").in("id", batch);
    if (error) throw error;
    for (const p of data ?? []) products.set(p.id, p);
  }
  const images = await listProductImages(supabase, productIds);
  const signed = await signProductImageUrls(supabase, [...images.values()].map((list) => list[0]?.objectKey));
  const imageFor = (productId: string) => {
    const key = images.get(productId)?.[0]?.objectKey;
    return (key ? signed.get(key) : undefined) ?? products.get(productId)?.image_ref ?? null;
  };
  return { itemsByOffer, audiencesByOffer, products, imageFor };
}

export type OwnOfferFilters = {
  phase?: OfferPhase;
  /** Audience codes of one builder group: an offer matches when it targets ANY of them. */
  audienceCodes?: readonly string[];
  search?: string;
  period?: "current" | "upcoming" | "past";
  sort?: "updated" | "ending" | "starting";
};

/** `%`, `_` and the characters PostgREST reads as filter syntax cannot widen the match. */
const likeTerm = (raw: string) => raw.trim().toLowerCase().replace(/[\\%_,()*"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/**
 * One bounded page of the active organization's offers (a real range read) with the full matching
 * total. Filtering, ordering and paging all happen in the query: phase, audience group, text
 * (offer title + product names/codes), period and sort. The order is TOTAL (the sort key, then id), so
 * batches neither repeat nor skip a row.
 */
export async function listOwnOffersPage(
  supabase: DB,
  orgId: string,
  f: OwnOfferFilters,
  offset: number,
  limit: number,
): Promise<{ offers: OwnOffer[]; total: number }> {
  const nowIso = new Date().toISOString();
  let q = supabase.from("own_product_offers").select("*", { count: "exact" }).eq("organization_id", orgId);
  if (f.phase) q = q.eq("phase", f.phase);
  if (f.audienceCodes && f.audienceCodes.length > 0) q = q.overlaps("audiences", [...f.audienceCodes]);
  const term = f.search ? likeTerm(f.search) : "";
  if (term) q = q.ilike("search_text", `%${term}%`);
  if (f.period === "current") q = q.lte("starts_at", nowIso).gt("ends_at", nowIso);
  if (f.period === "upcoming") q = q.gt("starts_at", nowIso);
  if (f.period === "past") q = q.lte("ends_at", nowIso);
  const sort = f.sort ?? "updated";
  q = sort === "ending" ? q.order("ends_at", { ascending: true }) : sort === "starting" ? q.order("starts_at", { ascending: true }) : q.order("updated_at", { ascending: false });
  const { data, error, count } = await q.order("id", { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((r) => r.id).filter((id): id is string => Boolean(id));
  const { itemsByOffer, audiencesByOffer, products, imageFor } = await loadOfferParts(supabase, ids);
  const offers = rows
    .map((row) => {
      const items: OwnOfferItem[] = (itemsByOffer.get(row.id ?? "") ?? []).map((i) => ({
        productId: i.product_id,
        name: products.get(i.product_id)?.name ?? "",
        code: products.get(i.product_id)?.sku ?? null,
        quantity: i.quantity,
        imageUrl: imageFor(i.product_id),
      }));
      return toOwnOffer(row, audiencesByOffer.get(row.id ?? "") ?? [], items);
    })
    .filter((o): o is OwnOffer => o !== null);
  return { offers, total: count ?? 0 };
}

/** Offers per lifecycle phase over the WHOLE history (the summary cards and chips), independent of any filter or page. */
export async function ownOfferPhaseCounts(supabase: DB, orgId: string): Promise<Record<OfferPhase, number>> {
  const { data, error } = await supabase.from("own_product_offers").select("phase").eq("organization_id", orgId);
  if (error) throw error;
  const out = Object.fromEntries(OFFER_PHASES.map((p) => [p, 0])) as Record<OfferPhase, number>;
  for (const r of data ?? []) if (r.phase && r.phase in out) out[r.phase as OfferPhase] += 1;
  return out;
}

/** One of the organization's offers for editing, or null (another tenant's offer simply is not there). */
export async function getOwnOffer(supabase: DB, orgId: string, offerId: string): Promise<OwnOffer | null> {
  const { data, error } = await supabase.from("own_product_offers").select("*").eq("id", offerId).eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { itemsByOffer, audiencesByOffer, products, imageFor } = await loadOfferParts(supabase, [offerId]);
  const items = (itemsByOffer.get(offerId) ?? []).map((i) => ({
    productId: i.product_id,
    name: products.get(i.product_id)?.name ?? "",
    code: products.get(i.product_id)?.sku ?? null,
    quantity: i.quantity,
    imageUrl: imageFor(i.product_id),
  }));
  return toOwnOffer(data, audiencesByOffer.get(offerId) ?? [], items);
}

// ---------------------------------------------------------------------------
// The builder's product picker (own products only)
// ---------------------------------------------------------------------------
export type PickerProduct = {
  id: string;
  name: string;
  code: string | null;
  categoryCode: string | null;
  unit: string;
  /** `published` products can go into a published offer; a draft product can only be in a draft offer. */
  published: boolean;
  colors: ProductColor[];
  sizeLabel: string | null;
  weightKg: number | null;
  imageUrl: string | null;
};

/** The organization's own, non-archived products. Never any price. */
export async function listPickerProducts(supabase: DB, orgId: string): Promise<PickerProduct[]> {
  const rows = await listOwnProducts(supabase, orgId, { archived: "exclude", sort: "name" });
  const images = await listProductImages(supabase, rows.map((r) => r.id));
  const signed = await signProductImageUrls(supabase, [...images.values()].map((list) => list[0]?.objectKey));
  return rows.map((r) => {
    const key = images.get(r.id)?.[0]?.objectKey;
    return {
      id: r.id,
      name: r.name,
      code: r.sku,
      categoryCode: r.category_code,
      unit: r.unit,
      published: r.status === "published",
      colors: effectiveColors(r),
      sizeLabel: r.size_label,
      weightKg: r.weight_kg,
      imageUrl: (key ? signed.get(key) : undefined) ?? r.image_ref ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// My Products integration
// ---------------------------------------------------------------------------
export type ProductOfferState = "active" | "included";

/**
 * Real offer state per product: "active" when one of its offers is live now, "included" when it
 * sits in a draft / scheduled / paused offer. Expired and archived offers say nothing about a
 * product today. There is no discount and no price here.
 */
export async function listProductOfferStates(supabase: DB, productIds: readonly string[]): Promise<Map<string, ProductOfferState>> {
  const out = new Map<string, ProductOfferState>();
  for (const batch of batches(productIds)) {
    const { data, error } = await supabase.from("own_product_offer_links").select("product_id, phase").in("product_id", batch);
    if (error) throw error;
    for (const r of data ?? []) {
      if (!r.product_id || !r.phase) continue;
      if (r.phase === "active") out.set(r.product_id, "active");
      else if (["draft", "scheduled", "paused"].includes(r.phase) && out.get(r.product_id) !== "active") out.set(r.product_id, "included");
    }
  }
  return out;
}
