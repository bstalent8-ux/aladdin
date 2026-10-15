import { isCanonicalCategoryCode } from "@/features/commerce/constants";

export type MyProductsStatusFilter = "active" | "inactive" | "archived";
export const MY_PRODUCTS_STATUSES: readonly MyProductsStatusFilter[] = ["active", "inactive", "archived"];

export type MyProductsSort = "updated" | "newest" | "name";
export const MY_PRODUCTS_SORTS: readonly MyProductsSort[] = ["updated", "newest", "name"];

export type MyProductsParams = {
  sort: MyProductsSort;
  q?: string;
  /** A canonical category code, or "unclassified" for historical products that have none. */
  category?: string;
  status?: MyProductsStatusFilter;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The URL can only select among what this page defines; anything else is dropped, not forwarded. */
export function parseMyProductsParams(raw: { q?: string | string[]; category?: string | string[]; status?: string | string[]; sort?: string | string[] }): MyProductsParams {
  const q = first(raw.q)?.trim().slice(0, 100) || undefined;
  const categoryRaw = first(raw.category);
  const category = categoryRaw === "unclassified" || isCanonicalCategoryCode(categoryRaw) ? categoryRaw : undefined;
  const statusRaw = first(raw.status);
  const status = MY_PRODUCTS_STATUSES.find((s) => s === statusRaw);
  const sort = MY_PRODUCTS_SORTS.find((x) => x === first(raw.sort)) ?? "updated";
  return { q, category, status, sort };
}

/** The `listOwnProducts` filters a status tab means. No tab = everything, archived included. */
export function statusFilterToQuery(status: MyProductsStatusFilter | undefined): {
  status?: "draft" | "published";
  archived: "exclude" | "include" | "only";
} {
  switch (status) {
    case "active":
      return { status: "published", archived: "exclude" };
    case "inactive":
      return { status: "draft", archived: "exclude" };
    case "archived":
      return { archived: "only" };
    default:
      return { archived: "include" };
  }
}
