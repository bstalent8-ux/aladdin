import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeSearchTerm } from "@/server/queries/sales";

/**
 * Read queries for the B2B commerce workspace (Catalog / RFQ / Quotation).
 * Every query runs through the caller-scoped client, so RLS enforces tenant and
 * requester/supplier visibility in the database (ADR-0008). The UI never filters
 * for security — only for UX. A filter can narrow results but never widen them
 * past what RLS already allows.
 */

type DB = SupabaseClient<Database>;

/** Table-function results are typed non-null by the generator although optional columns do come back null. */
type Nullable<T> = { [K in keyof T]: T[K] | null };
export type CatalogRow = Nullable<Database["public"]["Functions"]["catalog_products"]["Returns"][number]>;
export type ProductRow = Database["public"]["Tables"]["products"]["Row"];
export type RfqRow = Database["public"]["Tables"]["rfqs"]["Row"];
export type RfqListRow = Database["public"]["Views"]["rfq_list"]["Row"];
export type RfqItemRow = Database["public"]["Tables"]["rfq_items"]["Row"];
export type QuotationRow = Database["public"]["Tables"]["quotations"]["Row"];
export type QuotationListRow = Database["public"]["Views"]["quotation_list"]["Row"];
export type QuotationItemRow = Database["public"]["Tables"]["quotation_items"]["Row"];
export type ProductCategory = Database["public"]["Enums"]["product_category"];
/** The status values these views actually carry — a filter cannot invent one. */
export type RfqStatus = NonNullable<RfqListRow["status"]>;
export type QuotationStatus = NonNullable<QuotationListRow["status"]>;

const LIST_LIMIT = 100;

// ---- Catalog (cross-tenant, published only) --------------------------------
export type CatalogFilters = {
  search?: string;
  /** Legacy broad category (production /b2b catalog). */
  category?: ProductCategory;
  /** Canonical taxonomy code (showroom catalog); products without one are simply not matched. */
  categoryCode?: string;
  supplierOrgId?: string;
  /**
   * Exclude this organization's own products. Browse is for discovering OTHER
   * organizations' products; an organization's own live in My Products. Applied in the
   * query itself (never by hiding cards in the client).
   */
  excludeOrgId?: string;
  limit?: number;
};

/**
 * Every cross-organization product read goes through the workspace-aware reader: the audience
 * is derived in the database from `viewerOrgId` (the ACTIVE workspace, whose membership the
 * database verifies) or, with `null`, from the caller's personal persona. Never a union.
 */
function catalogQuery(supabase: DB, viewerOrgId: string | null, f: CatalogFilters, countExact: boolean) {
  let q = supabase
    .rpc("catalog_products", { p_org_id: viewerOrgId ?? undefined }, countExact ? { count: "exact" } : undefined)
    // A TOTAL order (id breaks ties between products published in the same instant), so
    // offset batches neither repeat nor skip a row.
    .order("published_at", { ascending: false })
    .order("id", { ascending: false });
  if (f.category) q = q.eq("category", f.category);
  if (f.categoryCode) q = q.eq("category_code", f.categoryCode);
  if (f.supplierOrgId) q = q.eq("organization_id", f.supplierOrgId);
  if (f.excludeOrgId) q = q.neq("organization_id", f.excludeOrgId);
  if (f.search && f.search.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  return q;
}

export async function listCatalog(supabase: DB, viewerOrgId: string | null, f: CatalogFilters = {}): Promise<CatalogRow[]> {
  const { data, error } = await catalogQuery(supabase, viewerOrgId, f, false).limit(f.limit ?? LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/** One bounded batch of the catalog (`offset`/`limit`, a real range read) and the full matching total. */
export async function listCatalogPage(
  supabase: DB,
  viewerOrgId: string | null,
  f: Omit<CatalogFilters, "limit">,
  offset: number,
  limit: number,
): Promise<{ rows: CatalogRow[]; total: number }> {
  const { data, error, count } = await catalogQuery(supabase, viewerOrgId, f, true).range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Which of these products the organization has saved — only the visible batch is asked about. */
export async function savedAmong(supabase: DB, orgId: string, productIds: readonly string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const { data, error } = await supabase.from("saved_products").select("product_id").eq("organization_id", orgId).in("product_id", [...productIds]);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.product_id));
}

export async function getCatalogProduct(supabase: DB, viewerOrgId: string | null, id: string): Promise<CatalogRow | null> {
  const { data, error } = await supabase
    .rpc("catalog_products", { p_org_id: viewerOrgId ?? undefined })
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Own-organization products (management) --------------------------------
export type OwnProductFilters = {
    search?: string;
    status?: "draft" | "published";
    category?: ProductCategory;
    /** Canonical taxonomy code, or "unclassified" for historical products that have none. */
    categoryCode?: string;
    /**
     * Archived products are retired: production callers never see them (the default).
     * `include` / `only` serve the showroom's management page.
     */
    archived?: "exclude" | "include" | "only";
    /** Default: most recently updated first (what production lists have always done). */
    sort?: "updated" | "newest" | "name";
};

function ownProductsQuery(supabase: DB, orgId: string, f: OwnProductFilters, countExact: boolean) {
  const sort = f.sort ?? "updated";
  let q = supabase
    .from("products")
    .select("*", countExact ? { count: "exact" } : undefined)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order(sort === "name" ? "name" : sort === "newest" ? "created_at" : "updated_at", { ascending: sort === "name" })
    // id makes the order TOTAL, so offset batches neither repeat nor skip a row.
    .order("id", { ascending: true });
  const archived = f.archived ?? "exclude";
  if (archived === "exclude") q = q.is("archived_at", null);
  if (archived === "only") q = q.not("archived_at", "is", null);
  if (f.status) q = q.eq("status", f.status);
  if (f.category) q = q.eq("category", f.category);
  if (f.categoryCode === "unclassified") q = q.is("category_code", null);
  else if (f.categoryCode) q = q.eq("category_code", f.categoryCode);
  if (f.search && f.search.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  }
  return q;
}

export async function listOwnProducts(supabase: DB, orgId: string, f: OwnProductFilters = {}): Promise<ProductRow[]> {
  const { data, error } = await ownProductsQuery(supabase, orgId, f, false).limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/** One bounded batch of the management list and the full matching total (the summary counts stay separate). */
export async function listOwnProductsPage(
  supabase: DB,
  orgId: string,
  f: OwnProductFilters,
  offset: number,
  limit: number,
): Promise<{ rows: ProductRow[]; total: number }> {
  const { data, error, count } = await ownProductsQuery(supabase, orgId, f, true).range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/**
 * How this organization's shelf splits by publication state.
 *
 * Read UNFILTERED on purpose: these are the counts behind the status tabs, and a
 * tab that reported the size of the filtered view would make its own filter
 * invisible ("Draft (0)" while standing on a search that excludes every draft).
 * One read of one column, tallied here — `products.status` has exactly two
 * values, so there is nothing here worth a second round trip.
 *
 * Note there is no third "unpublished" state to report: `product_status` is
 * `draft | published`, and unpublishing returns a product to draft. The UI must
 * not invent a state the model does not have.
 */
export async function ownProductCounts(
  supabase: DB,
  orgId: string,
): Promise<{ total: number; published: number; draft: number; archived: number }> {
  const { data, error } = await supabase
    .from("products")
    .select("status, archived_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (error) throw error;
  const rows = data ?? [];
  // Archived products are retired: they count only as `archived`, never as a draft.
  const archived = rows.filter((r) => r.archived_at !== null).length;
  const live = rows.filter((r) => r.archived_at === null);
  const published = live.filter((r) => r.status === "published").length;
  return { total: live.length, published, draft: live.length - published, archived };
}

/**
 * One product OWNED by the organization (any lifecycle state). Filtering by the
 * organization as well as the id is what keeps another tenant's published product
 * — which RLS lets every authenticated user read — from ever opening in a
 * management screen.
 */
export async function getOwnProduct(supabase: DB, orgId: string, id: string): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The target audience codes the OWNER chose for a product (RLS: members of the owning organization only). */
export async function getProductAudiences(supabase: DB, productId: string): Promise<string[]> {
  const { data, error } = await supabase.from("product_audiences").select("audience").eq("product_id", productId);
  if (error) throw error;
  return (data ?? []).map((r) => r.audience);
}

/**
 * The owning organization's PRIVATE regular prices, keyed by product id. They live in
 * `product_prices` (RLS: members of the owning organization only), never on the
 * publicly readable `products` row; a product with no price has no entry.
 */
export async function listProductPrices(supabase: DB, productIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const batch of batches(productIds)) {
    const { data, error } = await supabase.from("product_prices").select("product_id, base_price").in("product_id", batch);
    if (error) throw error;
    for (const r of data ?? []) out.set(r.product_id, Number(r.base_price));
  }
  return out;
}

export type ProductDemand = { requests: number };

/**
 * PostgREST puts an `in` list in the QUERY STRING, so a filter built from every
 * id an organization owns stops being a slow request and becomes a FAILED one
 * once the URL outgrows the gateway's header limit — a few hundred UUIDs is all
 * it takes. Splitting the list into fixed batches keeps the result byte-for-byte
 * identical at any history size, which a `limit` would not.
 */
const IN_BATCH = 100;

export function batches<T>(items: readonly T[], size = IN_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Per-product demand: how many DISTINCT requests each of this organization's
 * products has been asked for in.
 *
 * This is the one piece of context that turns a product list into a product
 * MANAGEMENT surface — "this line gets requested and never converts" is a
 * decision a seller can act on, where a row of names is not.
 *
 * Two bounded reads rather than a nested join: the org's own RFQ ids, then their
 * line items. Requests come from `rfq_items.product_id`, which is a live
 * reference — an RFQ names a catalog product.
 *
 * Quantity is deliberately NOT reported here. `rfq_items.quantity` is what was
 * ASKED FOR, not what was sold, and ORDER lines cannot supply the real figure:
 * an order item is a frozen snapshot carrying no product id (see
 * `topOrderedProducts`), so matching one back by name would attribute a renamed
 * product's history to the wrong row. A number that looks like sales but counts
 * enquiries is worse than no number.
 */
export async function productDemand(
  supabase: DB,
  orgId: string,
): Promise<Map<string, ProductDemand>> {
  const { data: rfqs, error: rfqErr } = await supabase
    .from("rfq_list")
    .select("id")
    .eq("supplier_org_id", orgId);
  if (rfqErr) throw rfqErr;

  const ids = (rfqs ?? []).map((r) => r.id).filter((id): id is string => !!id);
  const out = new Map<string, ProductDemand>();
  if (ids.length === 0) return out;

  const results = await Promise.all(
    batches(ids).map((batch) =>
      supabase.from("rfq_items").select("rfq_id, product_id").in("rfq_id", batch),
    ),
  );

  // Counted per REQUEST, not per line: an RFQ that lists the same product twice
  // (two finishes, two delivery dates) is still one business asking once, and a
  // "requested 2 times" that means "one request, itemised twice" is a number a
  // seller would act on wrongly. Batching cannot disturb this — the dedup is by
  // rfq id, so it does not care which batch a line arrived in.
  const seen = new Map<string, Set<string>>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const item of data ?? []) {
      // A free-text line (no catalog product behind it) is real demand, but it is
      // not demand for a PRODUCT, so it belongs to no row here.
      if (!item.product_id || !item.rfq_id) continue;
      const rfqSet = seen.get(item.product_id) ?? new Set<string>();
      seen.set(item.product_id, rfqSet);
      if (rfqSet.has(item.rfq_id)) continue;
      rfqSet.add(item.rfq_id);
      out.set(item.product_id, { requests: (out.get(item.product_id)?.requests ?? 0) + 1 });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * DEMAND SIGNALS — the two supply-dashboard blocks that read INSIDE requests
 * ------------------------------------------------------------------------- */

export type ProductUnit = Database["public"]["Enums"]["product_unit"];

/** One product line inside a request that is still waiting to be priced. */
export type DemandLine = {
  rfqId: string;
  /** The request's own title — what the buyer called the job. */
  title: string;
  buyer: string;
  productName: string;
  quantity: number;
  unit: ProductUnit;
  requiredDate: string | null;
  createdAt: string | null;
  /** Other lines on the same request, so a card can say "+2 more items". */
  siblings: number;
  /**
   * The catalogue image for the requested product, when the line is linked to a
   * catalogue entry and the reader is allowed to see it.
   *
   * Null is an ordinary outcome, not a failure: `rfq_items.product_id` is
   * nullable (a buyer can ask for something nobody has listed), the product may
   * carry no `image_ref`, and RLS may withhold another organization's catalogue
   * row. Every caller therefore has to render without it.
   */
  imageRef: string | null;
};

/** How often one product is being asked for, this window against the last. */
export type DemandMovementRow = {
  name: string;
  /** DISTINCT requests naming this product inside the window. */
  requests: number;
  /** The same count for the equally-long window immediately before it. */
  previous: number;
};

export type DemandSignals = {
  /** Lines from unpriced requests, newest request first. */
  open: DemandLine[];
  /** How many unpriced requests those lines came from. */
  openRequests: number;
  /** Products ranked by requests inside the window, busiest first. */
  movement: DemandMovementRow[];
  /** Distinct requests inside the window — the movement rows' denominator. */
  windowRequests: number;
};

/**
 * Everything the dashboard needs from the INSIDE of this organization's demand,
 * in two reads.
 *
 * WHY ONE FUNCTION AND NOT TWO
 * "New opportunities suited to you" and "market movement" look like different
 * features and are the same two tables: the requests addressed to this
 * organization, and the product lines inside them. Read separately they would be
 * four round trips and — worse — two places that each decide what "a request for
 * this product" means, which is exactly how two panels on one screen end up
 * disagreeing about a number the reader can see twice.
 *
 * WHAT THESE ARE NOT
 * There is no opportunity store, no matching engine, no lead score and no market
 * feed behind any of this. The reference's opportunity cards are populated by a
 * service that finds buyers hunting for your products across a marketplace; this
 * repository has no such service, and inventing one that returned plausible rows
 * would be the single most dishonest thing on the page. What IS real is that
 * buyers address requests to this organization and those requests name products
 * and quantities — so the block shows exactly that, and its wording says so.
 *
 * The movement window counts DISTINCT REQUESTS per product, never lines: a
 * request that itemises the same product twice (two finishes, two delivery
 * dates) is one business asking once, and counting it as two would tell a seller
 * their demand doubled when it did not.
 */
export async function demandSignals(
  supabase: DB,
  orgId: string,
  /** Length of the movement window, in days. The prior window is the same length. */
  windowDays: number,
  /** How many open lines the opportunities block can show. */
  openLimit = 6,
): Promise<DemandSignals> {
  const { data: rfqs, error } = await supabase
    .from("rfq_list")
    .select("id, title, status, requester_name, required_date, created_at")
    .eq("supplier_org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = rfqs ?? [];
  const ids = rows.map((r) => r.id).filter((id): id is string => !!id);
  const empty: DemandSignals = { open: [], openRequests: 0, movement: [], windowRequests: 0 };
  if (ids.length === 0) return empty;

  // Same batching rule as `productDemand`, for the same reason: the id list
  // travels in the query string, so an organization with a long history would
  // otherwise build a URL the gateway rejects outright.
  const results = await Promise.all(
    batches(ids).map((batch) =>
      supabase
        .from("rfq_items")
        /* `products(image_ref)` is an embedded read across the existing
           `rfq_items.product_id` foreign key — no new column, no new table and
           no RPC. It resolves to null wherever the line is unlinked or the
           catalogue row is not readable by this caller, which the type and
           every caller already treat as normal. */
        .select("rfq_id, product_name, quantity, unit, products(image_ref)")
        .in("rfq_id", batch),
    ),
  );

  type Item = {
    rfq_id: string;
    product_name: string;
    quantity: number;
    unit: ProductUnit;
    /* PostgREST returns an embedded to-one as an object, but the generated types
       widen it to an array for some relationships — normalised at the one place
       it is read rather than at every call site. */
    products?: { image_ref: string | null } | Array<{ image_ref: string | null }> | null;
  };

  const imageOf = (it: Item): string | null => {
    const rel = it.products;
    if (!rel) return null;
    return (Array.isArray(rel) ? rel[0]?.image_ref : rel.image_ref) ?? null;
  };
  const byRfq = new Map<string, Item[]>();
  for (const { data, error: itemErr } of results) {
    if (itemErr) throw itemErr;
    for (const it of data ?? []) {
      if (!it.rfq_id) continue;
      const list = byRfq.get(it.rfq_id) ?? [];
      list.push(it as Item);
      byRfq.set(it.rfq_id, list);
    }
  }

  /* ---- The opportunities block: lines from requests nobody has priced ---- */
  const openRfqs = rows.filter((r) => r.status === "submitted");
  const open: DemandLine[] = [];
  for (const r of openRfqs) {
    const items = byRfq.get(r.id ?? "") ?? [];
    for (const it of items) {
      if (open.length >= openLimit) break;
      open.push({
        rfqId: r.id ?? "",
        title: r.title ?? "—",
        buyer: r.requester_name ?? "—",
        productName: it.product_name,
        quantity: Number(it.quantity ?? 0),
        unit: it.unit,
        requiredDate: r.required_date,
        createdAt: r.created_at,
        siblings: items.length - 1,
        imageRef: imageOf(it),
      });
    }
    if (open.length >= openLimit) break;
  }

  /* ---- The movement block: this window against the one before it ---- */
  const now = Date.now();
  const span = windowDays * 86_400_000;
  const currentFrom = now - span;
  const previousFrom = now - span * 2;

  // Distinct-request sets per product, per window. A Set rather than a counter
  // because a request itemising one product twice must land once.
  const current = new Map<string, Set<string>>();
  const previous = new Map<string, Set<string>>();
  const windowRfqs = new Set<string>();

  for (const r of rows) {
    if (!r.id) continue;
    const t = r.created_at ? Date.parse(r.created_at) : NaN;
    if (Number.isNaN(t)) continue;
    const bucket = t >= currentFrom ? current : t >= previousFrom ? previous : null;
    if (!bucket) continue;
    if (bucket === current) windowRfqs.add(r.id);
    for (const it of byRfq.get(r.id) ?? []) {
      const set = bucket.get(it.product_name) ?? new Set<string>();
      set.add(r.id);
      bucket.set(it.product_name, set);
    }
  }

  const movement: DemandMovementRow[] = [...current.entries()]
    .map(([name, set]) => ({
      name,
      requests: set.size,
      previous: previous.get(name)?.size ?? 0,
    }))
    .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name))
    .slice(0, 6);

  return { open, openRequests: openRfqs.length, movement, windowRequests: windowRfqs.size };
}

export async function getProduct(supabase: DB, id: string): Promise<ProductRow | null> {
  const { data, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// ---- RFQs ------------------------------------------------------------------
export type RfqSide = "requester" | "supplier";

export async function listRfqs(
  supabase: DB,
  orgId: string,
  side: RfqSide,
): Promise<RfqListRow[]> {
  const col = side === "requester" ? "requester_org_id" : "supplier_org_id";
  const { data, error } = await supabase
    .from("rfq_list")
    .select("*")
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/**
 * The most recent RFQs on one side, WITH how many match in total.
 *
 * A dashboard panel wants both: five rows to show and the real number for its tile.
 * PostgREST returns an exact count alongside a limited result set, so this is one
 * round trip that answers both questions — rather than a hundred rows fetched so the
 * page can slice five off the front and call `.length` on the rest. Same view, same
 * RLS, same ordering as `listRfqs`; only the row budget differs.
 */
export async function recentRfqs(
  supabase: DB,
  orgId: string,
  side: RfqSide,
  opts: { statuses?: readonly RfqStatus[]; limit?: number } = {},
): Promise<{ rows: RfqListRow[]; total: number }> {
  const col = side === "requester" ? "requester_org_id" : "supplier_org_id";
  let q = supabase
    .from("rfq_list")
    .select("*", { count: "exact" })
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 5);
  if (opts.statuses) q = q.in("status", opts.statuses);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getRfq(supabase: DB, id: string): Promise<RfqRow | null> {
  const { data, error } = await supabase.from("rfqs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getRfqDisplay(supabase: DB, id: string): Promise<RfqListRow | null> {
  const { data, error } = await supabase.from("rfq_list").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRfqItems(supabase: DB, rfqId: string): Promise<RfqItemRow[]> {
  const { data, error } = await supabase
    .from("rfq_items")
    .select("*")
    .eq("rfq_id", rfqId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The live (non-rejected) quotation for an RFQ, if any. */
export async function getLiveQuotationForRfq(
  supabase: DB,
  rfqId: string,
): Promise<QuotationRow | null> {
  const { data, error } = await supabase
    .from("quotations")
    .select("*")
    .eq("rfq_id", rfqId)
    .neq("status", "rejected")
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Quotations ------------------------------------------------------------
export async function listQuotations(
  supabase: DB,
  orgId: string,
  side: RfqSide,
): Promise<QuotationListRow[]> {
  const col = side === "supplier" ? "supplier_org_id" : "requester_org_id";
  const { data, error } = await supabase
    .from("quotation_list")
    .select("*")
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

/** The most recent quotations on one side, with the matching total (see `recentRfqs`). */
export async function recentQuotations(
  supabase: DB,
  orgId: string,
  side: RfqSide,
  opts: { statuses?: readonly QuotationStatus[]; limit?: number } = {},
): Promise<{ rows: QuotationListRow[]; total: number }> {
  const col = side === "supplier" ? "supplier_org_id" : "requester_org_id";
  let q = supabase
    .from("quotation_list")
    .select("*", { count: "exact" })
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 5);
  if (opts.statuses) q = q.in("status", opts.statuses);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/**
 * How many quotations match, WITHOUT transferring them. `head: true` sends no rows
 * at all — Postgres counts and returns the number in a header, which is what a KPI
 * tile with no list behind it actually needs.
 */
export async function countQuotations(
  supabase: DB,
  orgId: string,
  side: RfqSide,
  statuses?: readonly QuotationStatus[],
): Promise<number> {
  const col = side === "supplier" ? "supplier_org_id" : "requester_org_id";
  let q = supabase.from("quotation_list").select("*", { count: "exact", head: true }).eq(col, orgId);
  if (statuses) q = q.in("status", statuses);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function getQuotation(supabase: DB, id: string): Promise<QuotationRow | null> {
  const { data, error } = await supabase.from("quotations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getQuotationDisplay(
  supabase: DB,
  id: string,
): Promise<QuotationListRow | null> {
  const { data, error } = await supabase
    .from("quotation_list")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listQuotationItems(
  supabase: DB,
  quotationId: string,
): Promise<QuotationItemRow[]> {
  const { data, error } = await supabase
    .from("quotation_items")
    .select("*")
    .eq("quotation_id", quotationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ---- Saved products (organization shortlist) -------------------------------
export type SavedProductRow = Nullable<Database["public"]["Functions"]["saved_products_for"]["Returns"][number]>;

/**
 * The calling organization's shortlist. RLS scopes rows to the caller's org, and
 * the view's join to `catalog_published_products` means an item whose supplier
 * later unpublished or deleted it simply drops out — no stale or leaked row.
 */
export async function listSavedProducts(
  supabase: DB,
  orgId: string,
  f: { category?: ProductCategory } = {},
): Promise<SavedProductRow[]> {
  let q = supabase
    .rpc("saved_products_for", { p_org_id: orgId })
    .eq("organization_id", orgId)
    .order("saved_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (f.category) q = q.eq("category", f.category);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export type SavedFilters = { category?: ProductCategory; categoryCode?: string; search?: string };

/** One bounded batch of the shortlist and the full matching total. */
export async function listSavedProductsPage(
  supabase: DB,
  orgId: string,
  f: SavedFilters,
  offset: number,
  limit: number,
): Promise<{ rows: SavedProductRow[]; total: number }> {
  let q = supabase
    .rpc("saved_products_for", { p_org_id: orgId }, { count: "exact" })
    .eq("organization_id", orgId)
    .order("saved_at", { ascending: false })
    .order("product_id", { ascending: false });
  if (f.category) q = q.eq("category", f.category);
  if (f.categoryCode) q = q.eq("category_code", f.categoryCode);
  const term = f.search ? sanitizeSearchTerm(f.search) : "";
  if (term) q = q.or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`);
  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** Full catalog rows for a known set of ids (a batch the caller already bounded), in the order asked for. */
export async function listCatalogByIds(supabase: DB, viewerOrgId: string | null, ids: readonly string[]): Promise<CatalogRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc("catalog_products", { p_org_id: viewerOrgId ?? undefined }).in("id", [...ids]);
  if (error) throw error;
  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Category -> how many shortlisted products, for the tabs (one narrow column read, tallied here). */
export async function savedCategoryCounts(supabase: DB, orgId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("saved_products_for", { p_org_id: orgId }).select("category").eq("organization_id", orgId);
  if (error) throw error;
  const out = new Map<string, number>();
  for (const r of data ?? []) if (r.category) out.set(r.category, (out.get(r.category) ?? 0) + 1);
  return out;
}

/**
 * How many products are on the shortlist. The shortlist view joins through to the
 * published catalog, so counting it via the list query meant materializing every
 * joined row to read one number off `.length`.
 */
export async function countSavedProducts(supabase: DB, orgId: string): Promise<number> {
  const { count, error } = await supabase
    .rpc("saved_products_for", { p_org_id: orgId }, { count: "exact", head: true })
    .eq("organization_id", orgId);
  if (error) throw error;
  return count ?? 0;
}

/** The saved product ids for this org, so the catalog can show its save state. */
export async function savedProductIds(supabase: DB, orgId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("saved_products")
    .select("product_id")
    .eq("organization_id", orgId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.product_id));
}
