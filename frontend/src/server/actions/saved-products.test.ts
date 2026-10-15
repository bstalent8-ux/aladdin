import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));

import { toggleSavedProductAction } from "./saved-products";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ error: null });
});

describe("toggleSavedProductAction", () => {
  it("saves through the membership-scoped RPC when the product is not saved yet", async () => {
    expect(await toggleSavedProductAction({ ok: false }, form({ orgId: "o1", productId: "p1", saved: "0" }))).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("save_product", { p_organization_id: "o1", p_product_id: "p1" });
  });

  it("unsaves through its own RPC when the product is already saved", async () => {
    await toggleSavedProductAction({ ok: false }, form({ orgId: "o1", productId: "p1", saved: "1" }));
    expect(state.rpc).toHaveBeenCalledWith("unsave_product", { p_organization_id: "o1", p_product_id: "p1" });
  });

  it("refreshes production AND showroom surfaces so the saved state is never stale", async () => {
    await toggleSavedProductAction({ ok: false }, form({ orgId: "o1", productId: "p1", saved: "0" }));
    const paths = state.revalidate.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/b2b/saved",
        "/b2b/catalog",
        "/b2b/catalog/p1",
        "/showroom/catalog",
        "/showroom/catalog/p1",
        "/showroom/home",
      ]),
    );
  });

  it("surfaces the database's refusal (e.g. a foreign organization) instead of reporting success", async () => {
    state.rpc.mockResolvedValue({ error: { code: "42501", message: "not a member of this organization" } });
    const result = await toggleSavedProductAction({ ok: false }, form({ orgId: "foreign", productId: "p1", saved: "0" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBeTruthy();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("rejects a malformed submission without calling the database", async () => {
    expect((await toggleSavedProductAction({ ok: false }, form({ productId: "p1" }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
