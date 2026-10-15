import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getCatalogProduct, listCatalog, savedProductIds } from "./commerce";

type Call = [string, ...unknown[]];

function stub(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const make = () => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq", "or", "in", "range"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(result);
    builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return builder;
  };
  const from = vi.fn((relation: string) => {
    calls.push(["from", relation]);
    return make();
  });
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.push(["rpc", fn, args]);
    return make();
  });
  return { supabase: { from, rpc } as never, calls };
}

describe("catalog queries the showroom reuses", () => {
  it("reads ONLY through the workspace-aware reader, newest first (never the products table)", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, "org-1", {});
    expect(calls[0]).toEqual(["rpc", "catalog_products", { p_org_id: "org-1" }]);
    expect(calls).toContainEqual(["order", "published_at", { ascending: false }]);
    expect(calls.some((c) => c[0] === "from" && c[1] === "products")).toBe(false);
  });

  it("applies the filters the production catalog supports", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, "org-1", { category: "finishing", supplierOrgId: "org-9", search: "marble" });
    expect(calls).toContainEqual(["eq", "category", "finishing"]);
    expect(calls).toContainEqual(["eq", "organization_id", "org-9"]);
    const or = calls.find((c) => c[0] === "or")![1] as string;
    expect(or).toContain("name.ilike.%marble%");
    expect(or).toContain("sku.ilike.%marble%");
    expect(or).toContain("brand.ilike.%marble%");
  });

  it("neutralizes filter-syntax characters in a search term", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, "org-1", { search: "a,b)or(c" });
    const or = calls.find((c) => c[0] === "or")![1] as string;
    expect(or.match(/ilike/g)).toHaveLength(3);
    expect(or).not.toContain("),");
  });

  it("keeps the production page size unless a larger page is asked for", async () => {
    const a = stub({ data: [], error: null });
    await listCatalog(a.supabase, "org-1", {});
    expect(a.calls).toContainEqual(["limit", 100]);
    const b = stub({ data: [], error: null });
    await listCatalog(b.supabase, "org-1", { limit: 300 });
    expect(b.calls).toContainEqual(["limit", 300]);
  });

  it("propagates a database error so the route's error state shows (never an empty catalog)", async () => {
    const { supabase } = stub({ data: null, error: new Error("boom") });
    await expect(listCatalog(supabase, "org-1", {})).rejects.toThrow("boom");
  });

  it("looks a single product up through the same reader, so an untargeted or unpublished one is simply absent", async () => {
    const { supabase, calls } = stub({ data: null, error: null });
    expect(await getCatalogProduct(supabase, "org-1", "p1")).toBeNull();
    expect(calls[0]).toEqual(["rpc", "catalog_products", { p_org_id: "org-1" }]);
    expect(calls).toContainEqual(["eq", "id", "p1"]);
  });

  it("names the ACTIVE workspace on every read: switching workspace changes the reader argument, never a union", async () => {
    const a = stub({ data: [], error: null });
    const b = stub({ data: [], error: null });
    await listCatalog(a.supabase, "org-a", {});
    await listCatalog(b.supabase, "org-b", {});
    expect(a.calls[0]).toEqual(["rpc", "catalog_products", { p_org_id: "org-a" }]);
    expect(b.calls[0]).toEqual(["rpc", "catalog_products", { p_org_id: "org-b" }]);
  });

  it("a personal viewer passes no workspace, so the database falls back to the personal persona", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, null, {});
    expect(calls[0]).toEqual(["rpc", "catalog_products", { p_org_id: undefined }]);
  });

  it("scopes saved ids to the active organization", async () => {
    const { supabase, calls } = stub({ data: [{ product_id: "p1" }, { product_id: "p2" }], error: null });
    expect([...(await savedProductIds(supabase, "org-1"))]).toEqual(["p1", "p2"]);
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
  });
});
