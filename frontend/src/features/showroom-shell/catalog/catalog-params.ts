import { CANONICAL_CATEGORY_CODES, type CanonicalCategoryCode } from "@/features/commerce/constants";

/** Page size of the production catalog query (`LIST_LIMIT` in server/queries/commerce.ts). */
export const CATALOG_PAGE_SIZE = 100;
export const CATALOG_MAX_LIMIT = 500;

export type ShowroomCatalogParams = {
  q?: string;
  /** Canonical taxonomy code. Historical, unclassified products are matched only by "all categories". */
  category?: CanonicalCategoryCode;
  supplier?: string;
  limit: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Turns the raw URL into the filters the production `listCatalog` understands —
 * and nothing else. Unknown categories, malformed supplier ids and out-of-range
 * limits are dropped rather than forwarded: the URL can only narrow what RLS
 * already shows, never smuggle a value into the query.
 */
export function parseShowroomCatalogParams(raw: {
  q?: string | string[];
  category?: string | string[];
  supplier?: string | string[];
  limit?: string | string[];
}): ShowroomCatalogParams {
  const q = first(raw.q)?.trim().slice(0, 100) || undefined;
  const category = CANONICAL_CATEGORY_CODES.find((c) => c === first(raw.category));
  const supplierRaw = first(raw.supplier);
  const supplier = supplierRaw && UUID.test(supplierRaw) ? supplierRaw : undefined;
  const n = Number.parseInt(first(raw.limit) ?? "", 10);
  const limit = Number.isFinite(n)
    ? Math.min(CATALOG_MAX_LIMIT, Math.max(CATALOG_PAGE_SIZE, Math.ceil(n / CATALOG_PAGE_SIZE) * CATALOG_PAGE_SIZE))
    : CATALOG_PAGE_SIZE;
  return { q, category, supplier, limit };
}
