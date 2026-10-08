import { CANONICAL_CATEGORY_CODES, type CanonicalCategoryCode } from "@/features/commerce/constants";

export type ShowroomCatalogParams = {
  q?: string;
  /** Canonical taxonomy code. Historical, unclassified products are matched only by "all categories". */
  category?: CanonicalCategoryCode;
  supplier?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Turns the raw URL into the filters the production `listCatalog` understands —
 * and nothing else. Unknown categories and malformed supplier ids are dropped rather than forwarded: the URL can only narrow what RLS
 * already shows, never smuggle a value into the query.
 */
export function parseShowroomCatalogParams(raw: {
  q?: string | string[];
  category?: string | string[];
  supplier?: string | string[];
}): ShowroomCatalogParams {
  const q = first(raw.q)?.trim().slice(0, 100) || undefined;
  const category = CANONICAL_CATEGORY_CODES.find((c) => c === first(raw.category));
  const supplierRaw = first(raw.supplier);
  const supplier = supplierRaw && UUID.test(supplierRaw) ? supplierRaw : undefined;
  return { q, category, supplier };
}
