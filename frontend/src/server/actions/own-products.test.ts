import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  list: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    rpc: state.rpc,
    storage: { from: () => ({ list: state.list, remove: state.remove }) },
  }),
}));

import {
  confirmProductImageUploadAction,
  createOwnProductAction,
  ownProductLifecycleAction,
  removeProductImageAction,
  reorderProductImagesAction,
  requestProductImageUploadAction,
  updateOwnProductAction,
} from "./own-products";

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const PRODUCT = "46d3bc5b-16a1-4aa0-966e-274673264654";
const IMAGE = "5bc41c1a-0000-4000-8000-000000000001";
const KEY = `${ORG}/${PRODUCT}/${IMAGE}.png`;

function fd(entries: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}
const good = { orgId: ORG, name: "Matt Emulsion 18L", code: "PNT-001", categoryCode: "paints", unit: "pail", color: ["Sand", "sand"], weightKg: "3.5" };

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ data: PRODUCT, error: null });
  state.list.mockResolvedValue({ data: [{ name: `${IMAGE}.png` }], error: null });
  state.remove.mockResolvedValue({ data: [], error: null });
});

describe("createOwnProductAction", () => {
  it("sends the validated, normalized product to the create RPC and lands on its edit page", async () => {
    await expect(createOwnProductAction({ ok: false }, fd(good))).rejects.toThrow(`NEXT_REDIRECT:/preview/showroom-suite-v2/my-products/${PRODUCT}/edit?created=1`);
    expect(state.rpc).toHaveBeenCalledWith("own_product_create", {
      p_org_id: ORG,
      p_name: "Matt Emulsion 18L",
      p_code: "PNT-001",
      p_category_code: "paints",
      p_unit: "pail",
      p_colors: ["Sand"],
      p_weight_kg: 3.5,
    });
    const paths = state.revalidate.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(["/preview/showroom-suite-v2/my-products", "/preview/showroom-suite-v2/catalog", "/b2b/products"]));
  });

  it("answers invalid input with field errors and never calls the database", async () => {
    const result = await createOwnProductAction({ ok: false }, fd({ orgId: ORG, name: "x", code: "", categoryCode: "finishing", unit: "box" }));
    expect(result.ok).toBe(false);
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["category", "code", "name", "unit"]);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed organization id", async () => {
    expect((await createOwnProductAction({ ok: false }, fd({ ...good, orgId: "not-a-uuid" }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("shows a duplicate code on the code field, in neutral words", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_products_org_code"' } });
    const result = await createOwnProductAction({ ok: false }, fd(good));
    expect(result).toEqual({ ok: false, fieldErrors: { code: "showroomProducts.errors.duplicateCode" } });
  });

  it("reports a permission refusal from the database instead of redirecting", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "catalog.write required" } });
    expect(await createOwnProductAction({ ok: false }, fd(good))).toEqual({ ok: false, code: "commerce.errors.denied" });
    expect(state.redirect).not.toHaveBeenCalled();
  });
});

describe("updateOwnProductAction", () => {
  const edit = { productId: PRODUCT, expectedVersion: "3", currentUnit: "box", ...good };

  it("carries the optimistic version and replaces the editable fields", async () => {
    await expect(updateOwnProductAction({ ok: false }, fd(edit))).rejects.toThrow("?saved=1");
    expect(state.rpc).toHaveBeenCalledWith("own_product_update", expect.objectContaining({ p_product_id: PRODUCT, p_expected_version: 3, p_category_code: "paints" }));
  });

  it("lets a historical product keep its current unit and nothing else outside the six", async () => {
    await expect(updateOwnProductAction({ ok: false }, fd({ ...edit, unit: "box" }))).rejects.toThrow("?saved=1");
    const refused = await updateOwnProductAction({ ok: false }, fd({ ...edit, unit: "ton" }));
    expect(refused.fieldErrors?.unit).toBe("showroomProducts.errors.unitInvalid");
  });

  it("maps a stale version to the conflict message", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "product was modified concurrently" } });
    expect(await updateOwnProductAction({ ok: false }, fd(edit))).toEqual({ ok: false, code: "commerce.errors.conflict" });
  });

  it("rejects a missing version without touching the database", async () => {
    expect((await updateOwnProductAction({ ok: false }, fd({ ...good, productId: PRODUCT }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("ownProductLifecycleAction", () => {
  const act = (action: string) => ownProductLifecycleAction({ ok: false }, fd({ productId: PRODUCT, expectedVersion: "2", action }));

  it.each([
    ["activate", "set_product_published", { p_product_id: PRODUCT, p_published: true, p_expected_version: 2 }],
    ["deactivate", "set_product_published", { p_product_id: PRODUCT, p_published: false, p_expected_version: 2 }],
    ["archive", "own_product_set_archived", { p_product_id: PRODUCT, p_archived: true, p_expected_version: 2 }],
    ["restore", "own_product_set_archived", { p_product_id: PRODUCT, p_archived: false, p_expected_version: 2 }],
  ])("%s calls %s", async (action, rpc, args) => {
    state.rpc.mockResolvedValue({ data: 3, error: null });
    expect(await act(action)).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith(rpc, args);
  });

  it("refuses an unknown action — there is no delete", async () => {
    expect((await act("delete")).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal (e.g. publishing an archived product)", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "an archived product must be restored before it can be published" } });
    expect(await act("activate")).toEqual({ ok: false, code: "showroomProducts.errors.archived" });
  });
});

describe("product image actions", () => {
  it("requests an upload ticket only for an allowed image type", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await requestProductImageUploadAction(PRODUCT, "image/png")).toEqual({ ok: true, key: KEY });
    expect(state.rpc).toHaveBeenCalledWith("product_image_request_upload", { p_product_id: PRODUCT, p_content_type: "image/png" });
    state.rpc.mockClear();
    expect((await requestProductImageUploadAction(PRODUCT, "application/pdf")).ok).toBe(false);
    expect((await requestProductImageUploadAction("nope", "image/png")).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports the fourth photo as the three-photo limit", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "a product can have at most 3 images" } });
    expect(await requestProductImageUploadAction(PRODUCT, "image/png")).toEqual({ ok: false, code: "showroomProducts.errors.maxImages" });
  });

  it("refuses a ticket that is not a well-formed organization/product key", async () => {
    state.rpc.mockResolvedValue({ data: "../../etc/passwd", error: null });
    expect((await requestProductImageUploadAction(PRODUCT, "image/png")).ok).toBe(false);
  });

  it("confirms only after the bytes are really in Storage", async () => {
    state.rpc.mockResolvedValue({ data: IMAGE, error: null });
    expect(await confirmProductImageUploadAction(KEY)).toEqual({ ok: true, id: IMAGE });
    expect(state.list).toHaveBeenCalledWith(`${ORG}/${PRODUCT}`, expect.objectContaining({ search: `${IMAGE}.png` }));

    state.rpc.mockClear();
    state.list.mockResolvedValue({ data: [], error: null });
    expect((await confirmProductImageUploadAction(KEY)).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses to confirm a malformed key", async () => {
    expect((await confirmProductImageUploadAction("anything")).ok).toBe(false);
    expect(state.list).not.toHaveBeenCalled();
  });

  it("removes through the RPC and then cleans up the bytes", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await removeProductImageAction(IMAGE)).toEqual({ ok: true });
    expect(state.remove).toHaveBeenCalledWith([KEY]);
  });

  it("does not touch Storage when the database refuses the removal", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "catalog.write required" } });
    expect(await removeProductImageAction(IMAGE)).toEqual({ ok: false, code: "commerce.errors.denied" });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("validates the ids it reorders", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await reorderProductImagesAction(PRODUCT, [IMAGE])).toEqual({ ok: true });
    expect((await reorderProductImagesAction(PRODUCT, ["bad"])).ok).toBe(false);
    expect((await reorderProductImagesAction("bad", [IMAGE])).ok).toBe(false);
  });
});
