import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { batches, listOwnProducts } from "@/server/queries/commerce";
import { listProductImages, signProductImageUrls } from "@/server/queries/product-images";
import { effectiveColors, type ProductColor } from "@/features/showroom-shell/products/color-items";
import { DEFAULT_OFFER_TIMEZONE } from "@/features/offers/offer-datetime";
import { parsePublicOffer, parsePublicOffers, type OfferPhase, type OfferStatus, type PublicOffer } from "@/features/offers/offer-model";

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
export async function listOffersFeed(supabase: DB, orgId: string): Promise<PublicOffer[]> {
  const { data, error } = await supabase.rpc("offers_feed", { p_org_id: orgId, p_limit: 100 });
  if (error) throw error;
  return parsePublicOffers(data);
}

export async function getOfferDetail(supabase: DB, orgId: string, offerId: string): Promise<PublicOffer | null> {
  const { data, error } = await supabase.rpc("offer_detail", { p_offer_id: offerId, p_org_id: orgId });
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

/** The active organization's offers, newest change first, with a small product/photo preview each. */
export async function listOwnOffers(supabase: DB, orgId: string): Promise<OwnOffer[]> {
  const { data, error } = await supabase
    .from("own_product_offers")
    .select("*")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((r) => r.id).filter((id): id is string => Boolean(id));
  const { itemsByOffer, audiencesByOffer, products, imageFor } = await loadOfferParts(supabase, ids);
  return rows
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
