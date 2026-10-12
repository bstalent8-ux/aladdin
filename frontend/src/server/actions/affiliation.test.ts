import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>>(async () => ({ data: "org-1", error: null })),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));

import { approveReferral } from "./affiliation";

const REFERRAL = "5b0e1d2c-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const run = (entries: Record<string, string>) => approveReferral(form(entries)).then(() => "no redirect", (e: Error) => e.message);

describe("approveReferral — the legal name of a NEW business", () => {
  beforeEach(() => state.rpc.mockClear());

  it("passes the Admin-verified legal name (trimmed) to the database", async () => {
    expect(await run({ referralId: REFERRAL, legalName: "  Zayed Tiles Trading LLC  " })).toBe("REDIRECT:/admin/verifications?referral=approved");
    expect(state.rpc).toHaveBeenCalledWith("showroom_referral_approve", {
      p_referral_id: REFERRAL,
      p_link_organization_id: undefined,
      p_legal_name: "Zayed Tiles Trading LLC",
    });
  });

  it("an Admin who edits the prefilled legal name sends the EDITED value, not the referral's", async () => {
    await run({ referralId: REFERRAL, legalName: "Zayed Tiles Trading Company LLC" });
    expect((state.rpc.mock.calls[0]![1] as { p_legal_name?: string }).p_legal_name).toBe("Zayed Tiles Trading Company LLC");
  });

  it("sends no location override unless the Admin chose a governorate (the database then uses the referral's own)", async () => {
    await run({ referralId: REFERRAL, legalName: "X Co LLC", governorate: "", city: "Mansoura" });
    const args = state.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("p_governorate");
    expect(args).not.toHaveProperty("p_city_custom_name");
  });

  it("an Admin-corrected location is sent as governorate + the typed city (the database canonicalizes or keeps it as typed)", async () => {
    await run({ referralId: REFERRAL, legalName: "X Co LLC", governorate: "dakahlia", city: "  Mansoura " });
    expect(state.rpc).toHaveBeenCalledWith("showroom_referral_approve", {
      p_referral_id: REFERRAL,
      p_link_organization_id: undefined,
      p_legal_name: "X Co LLC",
      p_governorate: "dakahlia",
      p_city_custom_name: "Mansoura",
    });
  });

  it("surfaces a refused referral location as its own message so the Admin can correct it", async () => {
    state.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { code: "22023", message: "the referral city belongs to another governorate: enter the branch location" },
    }));
    expect(await run({ referralId: REFERRAL, legalName: "X Co LLC" })).toBe("REDIRECT:/admin/verifications?error=location");
  });

  it("linking to an existing organization sends no legal name", async () => {
    await run({ referralId: REFERRAL, linkOrganizationId: ORG });
    expect(state.rpc).toHaveBeenCalledWith("showroom_referral_approve", {
      p_referral_id: REFERRAL,
      p_link_organization_id: ORG,
      p_legal_name: undefined,
    });
  });

  it("a blank legal name is not sent (the database then decides whether one is required)", async () => {
    await run({ referralId: REFERRAL, legalName: "   " });
    expect((state.rpc.mock.calls[0]![1] as { p_legal_name?: string }).p_legal_name).toBeUndefined();
  });

  it("surfaces the database's legal-name refusal as its own message, not a generic approve failure", async () => {
    state.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { code: "22023", message: "a legal business name is required to create the organization from a referral" },
    }));
    expect(await run({ referralId: REFERRAL })).toBe("REDIRECT:/admin/verifications?error=legalName");
  });

  it("any other database failure stays the generic approve error", async () => {
    state.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: "42501", message: "platform authority required" } }));
    expect(await run({ referralId: REFERRAL, legalName: "X Co LLC" })).toBe("REDIRECT:/admin/verifications?error=approve");
  });

  it("an invalid referral id never reaches the database", async () => {
    expect(await run({ referralId: "nope" })).toBe("REDIRECT:/admin/verifications?error=1");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
