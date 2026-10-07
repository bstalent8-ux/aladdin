import { describe, expect, it } from "vitest";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { resolveCatalogView } from "@/lib/ui/catalog-view";
import { CATALOG_MAX_LIMIT, CATALOG_PAGE_SIZE, parseShowroomCatalogParams } from "./catalog-params";

const SUPPLIER = "9c000000-cccc-4ccc-8ccc-000000000001";

describe("showroom catalog URL parsing", () => {
  it("defaults to an unfiltered first page", () => {
    expect(parseShowroomCatalogParams({})).toEqual({ q: undefined, category: undefined, supplier: undefined, limit: CATALOG_PAGE_SIZE });
  });

  it("keeps a trimmed search term and a canonical category", () => {
    expect(parseShowroomCatalogParams({ q: "  marble ", category: "marble_alternative" })).toMatchObject({ q: "marble", category: "marble_alternative" });
  });

  it.each(CANONICAL_CATEGORY_CODES)("accepts the canonical category %s", (category) => {
    expect(parseShowroomCatalogParams({ category }).category).toBe(category);
  });

  it("drops anything that is not a canonical code — legacy broad codes and Arabic labels are not identifiers", () => {
    expect(parseShowroomCatalogParams({ category: "ورق حائط" }).category).toBeUndefined();
    expect(parseShowroomCatalogParams({ category: "finishing" }).category).toBeUndefined();
    expect(parseShowroomCatalogParams({ category: "WALLPAPER" }).category).toBeUndefined();
  });

  it("accepts only a well-formed supplier id", () => {
    expect(parseShowroomCatalogParams({ supplier: SUPPLIER }).supplier).toBe(SUPPLIER);
    expect(parseShowroomCatalogParams({ supplier: "x'--" }).supplier).toBeUndefined();
    expect(parseShowroomCatalogParams({ supplier: "not-a-uuid" }).supplier).toBeUndefined();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseShowroomCatalogParams({ q: ["a", "b"], category: ["paints", "curtains"] })).toMatchObject({ q: "a", category: "paints" });
  });

  it("bounds an over-long search term", () => {
    expect(parseShowroomCatalogParams({ q: "x".repeat(500) }).q).toHaveLength(100);
  });

  it("clamps the page size to whole pages between one and the maximum", () => {
    const limit = (v: string) => parseShowroomCatalogParams({ limit: v }).limit;
    expect(limit("-5")).toBe(CATALOG_PAGE_SIZE);
    expect(limit("abc")).toBe(CATALOG_PAGE_SIZE);
    expect(limit("0")).toBe(CATALOG_PAGE_SIZE);
    expect(limit("150")).toBe(200);
    expect(limit("200")).toBe(200);
    expect(limit("999999")).toBe(CATALOG_MAX_LIMIT);
  });
});

describe("catalog display preference", () => {
  it("defaults to grid and only honours the two known values", () => {
    expect(resolveCatalogView(undefined)).toBe("grid");
    expect(resolveCatalogView("grid")).toBe("grid");
    expect(resolveCatalogView("list")).toBe("list");
    expect(resolveCatalogView("table")).toBe("grid");
    expect(resolveCatalogView("")).toBe("grid");
  });
});
