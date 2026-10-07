import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getOwnProduct, listCatalog, listOwnProducts, ownProductCounts } from "./commerce";
import { listProductImages, resolveProductImage, signProductImageUrls } from "./product-images";

type Call = [string, ...unknown[]];

function stub(result: { data: unknown; error: unknown }, storage?: { createSignedUrls: (keys: string[], s: number) => unknown }) {
  const calls: Call[] = [];
  const from = vi.fn((relation: string) => {
    calls.push(["from", relation]);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq", "or", "is", "not", "in"]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return b;
  });
  return { supabase: { from, storage: { from: () => storage } } as never, calls };
}

describe("own product queries", () => {
  it("hides archived products from production callers by default", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listOwnProducts(supabase, "org-1", {});
    expect(calls).toContainEqual(["is", "archived_at", null]);
  });

  it("shows archived products only when the management page asks", async () => {
    const only = stub({ data: [], error: null });
    await listOwnProducts(only.supabase, "org-1", { archived: "only" });
    expect(only.calls).toContainEqual(["not", "archived_at", "is", null]);
    const all = stub({ data: [], error: null });
    await listOwnProducts(all.supabase, "org-1", { archived: "include" });
    expect(all.calls.some((c) => c[1] === "archived_at")).toBe(false);
  });

  it("always scopes to the organization and never to deleted rows", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listOwnProducts(supabase, "org-1", { archived: "include" });
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
    expect(calls).toContainEqual(["is", "deleted_at", null]);
  });

  it("filters by canonical category, and 'unclassified' means no canonical category at all", async () => {
    const a = stub({ data: [], error: null });
    await listOwnProducts(a.supabase, "org-1", { categoryCode: "paints" });
    expect(a.calls).toContainEqual(["eq", "category_code", "paints"]);
    const b = stub({ data: [], error: null });
    await listOwnProducts(b.supabase, "org-1", { categoryCode: "unclassified" });
    expect(b.calls).toContainEqual(["is", "category_code", null]);
  });

  it("counts archived products apart and never as drafts", async () => {
    const rows = [
      { status: "published", archived_at: null },
      { status: "draft", archived_at: null },
      { status: "draft", archived_at: "2026-10-08T00:00:00Z" },
    ];
    const { supabase } = stub({ data: rows, error: null });
    expect(await ownProductCounts(supabase, "org-1")).toEqual({ total: 2, published: 1, draft: 1, archived: 1 });
  });

  it("opens a product only for its owning organization", async () => {
    const { supabase, calls } = stub({ data: null, error: null });
    expect(await getOwnProduct(supabase, "org-1", "p1")).toBeNull();
    expect(calls).toContainEqual(["eq", "id", "p1"]);
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
  });

  it("matches the public catalog by canonical code without disturbing the legacy filter", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, { categoryCode: "paints" });
    expect(calls).toContainEqual(["eq", "category_code", "paints"]);
    expect(calls.some((c) => c[0] === "eq" && c[1] === "category")).toBe(false);
  });
});

describe("product image queries", () => {
  it("groups ready images per product in display order", async () => {
    const { supabase, calls } = stub({
      data: [
        { id: "i1", product_id: "p1", object_key: "k1", slot: 1 },
        { id: "i2", product_id: "p1", object_key: "k2", slot: 2 },
        { id: "i3", product_id: "p2", object_key: "k3", slot: 1 },
      ],
      error: null,
    });
    const map = await listProductImages(supabase, ["p1", "p2"]);
    expect(map.get("p1")?.map((i) => i.objectKey)).toEqual(["k1", "k2"]);
    expect(map.get("p2")?.[0]).toEqual({ id: "i3", objectKey: "k3", slot: 1 });
    expect(calls).toContainEqual(["eq", "state", "ready"]);
    expect(calls).toContainEqual(["order", "slot", { ascending: true }]);
  });

  it("does not query for an empty list", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    expect((await listProductImages(supabase, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("signs each distinct key once, with the caller's own client", async () => {
    const createSignedUrls = vi.fn(async (keys: string[]) => ({
      data: keys.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
      error: null,
    }));
    const { supabase } = stub({ data: [], error: null }, { createSignedUrls });
    const urls = await signProductImageUrls(supabase, ["a", null, "a", "b", undefined]);
    expect(createSignedUrls).toHaveBeenCalledWith(["a", "b"], 3600);
    expect([...urls.entries()]).toEqual([["a", "https://signed/a"], ["b", "https://signed/b"]]);
  });

  it("leaves out a key that could not be signed instead of failing the page", async () => {
    const createSignedUrls = vi.fn(async () => ({
      data: [{ path: "a", signedUrl: null, error: "Object not found" }, { path: "b", signedUrl: "https://signed/b", error: null }],
      error: null,
    }));
    const { supabase } = stub({ data: [], error: null }, { createSignedUrls });
    expect([...(await signProductImageUrls(supabase, ["a", "b"])).keys()]).toEqual(["b"]);
    const failing = stub({ data: [], error: null }, { createSignedUrls: async () => ({ data: null, error: new Error("down") }) });
    expect((await signProductImageUrls(failing.supabase, ["a"])).size).toBe(0);
  });

  it("shows the uploaded primary photo, else the legacy reference, else nothing", () => {
    const signed = new Map([["k1", "https://signed/k1"]]);
    expect(resolveProductImage({ primary_image_key: "k1", image_ref: "https://legacy/x.png" }, signed)).toBe("https://signed/k1");
    expect(resolveProductImage({ primary_image_key: "k2", image_ref: "https://legacy/x.png" }, signed)).toBe("https://legacy/x.png");
    expect(resolveProductImage({ primary_image_key: null, image_ref: "https://legacy/x.png" }, signed)).toBe("https://legacy/x.png");
    expect(resolveProductImage({ primary_image_key: null, image_ref: null }, signed)).toBeNull();
  });
});
