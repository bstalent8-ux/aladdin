import { describe, expect, it } from "vitest";
import { CANONICAL_CATEGORY_CODES } from "@/features/commerce/constants";
import { parseMyProductsParams, statusFilterToQuery } from "./my-products-params";

describe("my products URL parsing", () => {
  it("defaults to no filters", () => {
    expect(parseMyProductsParams({})).toEqual({ q: undefined, category: undefined, status: undefined, sort: "updated" });
  });

  it("keeps a trimmed, bounded search", () => {
    expect(parseMyProductsParams({ q: "  paint " }).q).toBe("paint");
    expect(parseMyProductsParams({ q: "x".repeat(300) }).q).toHaveLength(100);
  });

  it.each([...CANONICAL_CATEGORY_CODES, "unclassified"])("accepts the category filter %s", (category) => {
    expect(parseMyProductsParams({ category }).category).toBe(category);
  });

  it("drops categories that are not canonical (no legacy codes, no labels, no injection)", () => {
    for (const category of ["finishing", "ورق حائط", "paints,other", "x' or '1'='1"]) {
      expect(parseMyProductsParams({ category }).category).toBeUndefined();
    }
  });

  it("accepts only the three status tabs", () => {
    expect(parseMyProductsParams({ status: "active" }).status).toBe("active");
    expect(parseMyProductsParams({ status: "inactive" }).status).toBe("inactive");
    expect(parseMyProductsParams({ status: "archived" }).status).toBe("archived");
    expect(parseMyProductsParams({ status: "published" }).status).toBeUndefined();
    expect(parseMyProductsParams({ status: "deleted" }).status).toBeUndefined();
  });

  it("takes the first of repeated values", () => {
    expect(parseMyProductsParams({ status: ["archived", "active"], category: ["paints", "curtains"] })).toMatchObject({ status: "archived", category: "paints" });
  });
});

describe("sort", () => {
  it.each(["updated", "newest", "name"])("accepts %s", (sort) => {
    expect(parseMyProductsParams({ sort }).sort).toBe(sort);
  });

  it("falls back to recently updated for anything else (no arbitrary column reaches the query)", () => {
    for (const sort of ["price", "created_at; drop table products", "", "NAME"]) expect(parseMyProductsParams({ sort }).sort).toBe("updated");
  });
});

describe("status tab -> query", () => {
  it("maps active to published-and-not-archived, inactive to draft-and-not-archived", () => {
    expect(statusFilterToQuery("active")).toEqual({ status: "published", archived: "exclude" });
    expect(statusFilterToQuery("inactive")).toEqual({ status: "draft", archived: "exclude" });
  });

  it("shows archived products only on their own tab, and everything under All", () => {
    expect(statusFilterToQuery("archived")).toEqual({ archived: "only" });
    expect(statusFilterToQuery(undefined)).toEqual({ archived: "include" });
  });
});
