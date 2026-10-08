import { effectiveColors, type ProductColor } from "@/features/showroom-shell/products/color-items";

/**
 * Product Offers — the shared, account-agnostic model. One domain: the same types serve the
 * owner's management pages, the audience Offers feed and the offer detail, whatever shell
 * renders them. Eligibility is decided by the database (offers_feed / offer_detail); nothing
 * here decides who may see an offer.
 */

export const OFFER_PHASES = ["draft", "scheduled", "active", "paused", "expired", "archived"] as const;
export type OfferPhase = (typeof OFFER_PHASES)[number];
export type OfferStatus = "draft" | "published" | "paused" | "archived";

/** Mirrors `app.offer_phase`: expiry and scheduling are derived from the stored status and the window. */
export function offerPhase(status: OfferStatus, startsAt: string, endsAt: string, now: Date = new Date()): OfferPhase {
  if (status === "draft" || status === "paused" || status === "archived") return status;
  const t = now.getTime();
  if (t < new Date(startsAt).getTime()) return "scheduled";
  if (t >= new Date(endsAt).getTime()) return "expired";
  return "active";
}

/** Whole days left until `endsAt` (rounded up); 0 once it has ended. */
export function daysLeft(endsAt: string, now: Date = new Date()): number {
  const ms = new Date(endsAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

// ---------------------------------------------------------------------------
// Audiences — canonical codes (organization_type / persona_type), never labels.
// ---------------------------------------------------------------------------
export const OFFER_AUDIENCE_CODES = [
  "showroom_dealer",
  "supplier",
  "manufacturer",
  "importer",
  "design_office",
  "wholesaler",
  "contractor_company",
  "engineer",
  "interior_designer",
  "installer_technician",
  "contractor",
] as const;
export type OfferAudienceCode = (typeof OFFER_AUDIENCE_CODES)[number];

/**
 * What the builder offers. `enabled` mirrors `offer_audience_types.feed_ready`: the five business
 * types the showroom suite serves today. The rest are shown as "soon" and cannot be chosen — the
 * database refuses to publish to them either way.
 */
export const OFFER_AUDIENCE_OPTIONS: ReadonlyArray<{ code: OfferAudienceCode; enabled: boolean }> = [
  { code: "showroom_dealer", enabled: true },
  { code: "supplier", enabled: true },
  { code: "manufacturer", enabled: true },
  { code: "importer", enabled: true },
  { code: "design_office", enabled: true },
  { code: "installer_technician", enabled: false },
  { code: "contractor_company", enabled: false },
  { code: "contractor", enabled: false },
];
export const FEED_READY_AUDIENCES: readonly string[] = OFFER_AUDIENCE_OPTIONS.filter((o) => o.enabled).map((o) => o.code);

export function isAudienceCode(value: unknown): value is OfferAudienceCode {
  return typeof value === "string" && (OFFER_AUDIENCE_CODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The audience-facing projection (what offers_feed / offer_detail return)
// ---------------------------------------------------------------------------
export type PublicOfferItem = {
  productId: string;
  name: string;
  code: string | null;
  quantity: number;
  unit: string | null;
  brand: string | null;
  description: string | null;
  sizeLabel: string | null;
  weightKg: number | null;
  categoryCode: string | null;
  colors: ProductColor[];
  imageKey: string | null;
  imageRef: string | null;
};

export type PublicOffer = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  seller: { id: string; name: string; verified: boolean; slug: string | null; orgType: string | null };
  totalPrice: number;
  /** Optional offer-level "price before the offer" typed in by the owner; never derived from product prices. */
  referencePrice: number | null;
  currency: string;
  startsAt: string;
  endsAt: string;
  publishedAt: string | null;
  items: PublicOfferItem[];
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function parseItem(raw: unknown): PublicOfferItem | null {
  const r = obj(raw);
  if (!r) return null;
  const productId = str(r.product_id);
  const name = str(r.name);
  const quantity = num(r.quantity);
  if (!productId || !name || quantity === null || quantity < 1) return null;
  return {
    productId,
    name,
    code: str(r.code),
    quantity,
    unit: str(r.unit),
    brand: str(r.brand),
    description: str(r.description),
    sizeLabel: str(r.size_label),
    weightKg: num(r.weight_kg),
    categoryCode: str(r.category_code),
    colors: effectiveColors({
      color_items: (r.color_items ?? null) as never,
      colors: Array.isArray(r.colors) ? (r.colors as unknown[]).filter((c): c is string => typeof c === "string") : [],
    }),
    imageKey: str(r.image_key),
    imageRef: str(r.image_ref),
  };
}

/** Defensive parse of one projected offer; anything malformed is dropped rather than half-shown. */
export function parsePublicOffer(raw: unknown): PublicOffer | null {
  const r = obj(raw);
  const seller = obj(r?.seller);
  if (!r || !seller) return null;
  const id = str(r.id);
  const title = str(r.title);
  const startsAt = str(r.starts_at);
  const endsAt = str(r.ends_at);
  const totalPrice = num(r.total_price);
  const sellerId = str(seller.id);
  const sellerName = str(seller.name);
  if (!id || !title || !startsAt || !endsAt || totalPrice === null || !sellerId || !sellerName) return null;
  const items = (Array.isArray(r.items) ? r.items : []).map(parseItem).filter((i): i is PublicOfferItem => i !== null);
  if (items.length === 0) return null;
  return {
    id,
    organizationId: str(r.organization_id) ?? sellerId,
    title,
    description: str(r.description),
    seller: { id: sellerId, name: sellerName, verified: seller.verified === true, slug: str(seller.slug), orgType: str(seller.org_type) },
    totalPrice,
    referencePrice: num(r.reference_price),
    currency: str(r.currency) ?? "EGP",
    startsAt,
    endsAt,
    publishedAt: str(r.published_at),
    items,
  };
}

export function parsePublicOffers(raw: unknown): PublicOffer[] {
  return (Array.isArray(raw) ? raw : []).map(parsePublicOffer).filter((o): o is PublicOffer => o !== null);
}

/** Units differ per product, so the package's "total quantity" is the plain sum of the per-product quantities. */
export const totalQuantity = (items: ReadonlyArray<{ quantity: number }>) => items.reduce((n, i) => n + i.quantity, 0);

/** The seller's business type as a label, for the canonical codes only (anything else shows nothing). */
export function sellerTypeLabel(t: (k: string) => string, orgType: string | null): string | null {
  return orgType && isAudienceCode(orgType) ? t(`showroomOffers.audience.${orgType}`) : null;
}

/** "1 product" / "13 products" — counts as Latin digits, like every figure in the suite. */
export function productsLabel(t: (k: string, v?: Record<string, string | number>) => string, count: number): string {
  return count === 1 ? t("showroomOffers.productsOne") : t("showroomOffers.productsMany", { count: String(count) });
}
