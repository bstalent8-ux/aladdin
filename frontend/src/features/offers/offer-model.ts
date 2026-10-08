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
  "end_consumer",
] as const;
export type OfferAudienceCode = (typeof OFFER_AUDIENCE_CODES)[number];

/**
 * The eight audience groups the builder offers. A group is a UI grouping only: choosing one stores
 * its explicit canonical rows (organization_type / persona_type codes) — no group enum exists in
 * the database. Every code is feed-ready: /b2b serves every organization type and /home every persona.
 */
export const OFFER_AUDIENCE_GROUPS = [
  { id: "showroom", codes: ["showroom_dealer"] },
  { id: "supplier", codes: ["supplier"] },
  { id: "manufacturer", codes: ["manufacturer"] },
  { id: "importer", codes: ["importer"] },
  { id: "contractor", codes: ["contractor_company", "contractor"] },
  { id: "engineer", codes: ["design_office", "engineer", "interior_designer"] },
  { id: "craftsman", codes: ["installer_technician"] },
  { id: "customer", codes: ["end_consumer"] },
] as const satisfies ReadonlyArray<{ id: string; codes: readonly OfferAudienceCode[] }>;
export type OfferAudienceGroupId = (typeof OFFER_AUDIENCE_GROUPS)[number]["id"];

/** The canonical rows to store for the chosen groups (deduplicated, group order). */
export function audienceCodesForGroups(ids: readonly string[]): OfferAudienceCode[] {
  const codes = OFFER_AUDIENCE_GROUPS.filter((g) => ids.includes(g.id)).flatMap((g) => g.codes);
  return [...new Set<OfferAudienceCode>(codes)];
}

/** A stored offer's groups: a group is selected when any of its canonical rows is present. */
export function groupsForAudienceCodes(codes: readonly string[]): OfferAudienceGroupId[] {
  return OFFER_AUDIENCE_GROUPS.filter((g) => g.codes.some((c) => codes.includes(c))).map((g) => g.id);
}

/** Every canonical audience has a feed: /b2b serves each organization type, /home each persona. */
export const FEED_READY_AUDIENCES: readonly string[] = OFFER_AUDIENCE_CODES;

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
  /** The caller's own bookmark (a user preference; never access). */
  saved: boolean;
};

export type OffersPage = {
  items: PublicOffer[];
  total: number;
  hasMore: boolean;
  stats: { available: number; ending: number; fresh: number };
  sellerTypes: string[];
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
    saved: r.saved === true,
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

/** Defensive parse of the `offers_feed_page` envelope. */
export function parseOffersPage(raw: unknown): OffersPage {
  const r = obj(raw) ?? {};
  const stats = obj(r.stats) ?? {};
  return {
    items: parsePublicOffers(r.items),
    total: num(r.total) ?? 0,
    hasMore: r.has_more === true,
    stats: { available: num(stats.available) ?? 0, ending: num(stats.ending) ?? 0, fresh: num(stats.fresh) ?? 0 },
    sellerTypes: (Array.isArray(r.seller_types) ? r.seller_types : []).filter((v): v is string => typeof v === "string"),
  };
}

// ---------------------------------------------------------------------------
// The audience feed's request shape (filters + a bounded page)
// ---------------------------------------------------------------------------
export const OFFER_FEED_PAGE_SIZE = 10;
export const OFFER_SORTS = ["newest", "ending", "priceLow", "priceHigh"] as const;
export const OFFER_PERIODS = ["all", "ending", "week"] as const;
export type OfferSort = (typeof OFFER_SORTS)[number];
export type OfferPeriod = (typeof OFFER_PERIODS)[number];

export type OffersPageParams = {
  search: string;
  category: string;
  sellerType: string;
  period: OfferPeriod;
  sort: OfferSort;
  savedOnly: boolean;
};

export const DEFAULT_OFFERS_PARAMS: OffersPageParams = { search: "", category: "", sellerType: "", period: "all", sort: "newest", savedOnly: false };

/** Appends a batch to the visible list without ever repeating an offer already shown. */
export function appendUnique(current: readonly PublicOffer[], batch: readonly PublicOffer[]): PublicOffer[] {
  const seen = new Set(current.map((o) => o.id));
  return [...current, ...batch.filter((o) => !seen.has(o.id))];
}

// ---------------------------------------------------------------------------
// The owner list (My Offers): filters + a bounded page
// ---------------------------------------------------------------------------
export const MY_OFFER_PERIODS = ["all", "current", "upcoming", "past"] as const;
export const MY_OFFER_SORTS = ["updated", "ending", "starting"] as const;
export type MyOfferPeriod = (typeof MY_OFFER_PERIODS)[number];
export type MyOfferSort = (typeof MY_OFFER_SORTS)[number];

export type MyOffersParams = {
  q: string;
  /** "" = every lifecycle phase. */
  phase: OfferPhase | "";
  /** "" = every audience, otherwise one builder group id. */
  audience: OfferAudienceGroupId | "";
  period: MyOfferPeriod;
  sort: MyOfferSort;
};

export const DEFAULT_MY_OFFERS_PARAMS: MyOffersParams = { q: "", phase: "", audience: "", period: "all", sort: "updated" };

/** Only values this list defines survive; anything else falls back to the default (never forwarded to a query). */
export function sanitizeMyOffersParams(raw: Partial<Record<keyof MyOffersParams, unknown>>): MyOffersParams {
  const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list as readonly string[]).includes(v as string) ? (v as T) : fallback;
  return {
    q: typeof raw.q === "string" ? raw.q.slice(0, 100) : "",
    phase: pick(["", ...OFFER_PHASES] as const, raw.phase, ""),
    audience: pick(["", ...OFFER_AUDIENCE_GROUPS.map((g) => g.id)] as const, raw.audience, ""),
    period: pick(MY_OFFER_PERIODS, raw.period, "all"),
    sort: pick(MY_OFFER_SORTS, raw.sort, "updated"),
  };
}
