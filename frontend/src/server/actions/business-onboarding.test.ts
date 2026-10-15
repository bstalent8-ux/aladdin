import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  allowed: false,
  mandatory: { required: false, orgType: null } as { required: boolean; orgType: string | null },
  rpc: vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { code: string } | null }>>(
    async () => ({ data: "draft-1", error: null }),
  ),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));
vi.mock("@/server/queries/business-creation-access", () => ({
  loadBusinessCreationAccess: async () => ({ allowed: state.allowed, data: null }),
}));
vi.mock("@/server/queries/business-setup", () => ({ loadMandatoryBusinessSetup: async () => state.mandatory }));

import { saveBusiness, submitBusiness } from "./business-onboarding";

describe("business draft writers — the same entitlement as the page", () => {
  it.each(["showroom_dealer", "supplier", "manufacturer", "importer", "design_office"] as const)("saves canonical %s through the existing RPC", async (orgType) => {
    state.allowed = true;
    expect(await saveBusiness({ displayName: "Activity", orgType })).toEqual({ ok: true, draftId: "draft-1" });
    expect(state.rpc).toHaveBeenCalledWith("business_draft_save", expect.objectContaining({ p_org_type: orgType }));
  });

  it("submits design_office through the canonical draft and membership-creation RPC", async () => {
    state.allowed = true;
    state.rpc.mockResolvedValueOnce({ data: "draft-1", error: null }).mockResolvedValueOnce({ data: "org-1", error: null });
    await submitBusiness({ displayName: "Engineering", legalName: "Engineering Consultants LLC", orgType: "design_office" });
    expect(state.rpc).toHaveBeenNthCalledWith(1, "business_draft_save", expect.objectContaining({ p_org_type: "design_office" }));
    expect(state.rpc).toHaveBeenNthCalledWith(2, "business_draft_submit", { p_draft_id: "draft-1" });
  });

  it("still denies design_office for an ineligible caller", async () => {
    expect(await saveBusiness({ displayName: "Engineering", orgType: "design_office" })).toEqual({ ok: false, code: "onboarding.error.businessNotAllowed" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    state.rpc.mockClear();
    state.allowed = false;
    state.mandatory = { required: false, orgType: null };
  });

  it("refuses to save a draft for a caller who may not create a business, and never reaches the database", async () => {
    const res = await saveBusiness({ displayName: "X" });
    expect(res).toEqual({ ok: false, code: "onboarding.error.businessNotAllowed" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses to submit for a caller who may not create a business", async () => {
    const res = await submitBusiness({ displayName: "X" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("onboarding.error.businessNotAllowed");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("saves for an entitled / mid-registration caller", async () => {
    state.allowed = true;
    const res = await saveBusiness({ displayName: "X" });
    expect(res).toEqual({ ok: true, draftId: "draft-1" });
    expect(state.rpc).toHaveBeenCalledWith("business_draft_save", expect.any(Object));
  });

  it("surfaces a database refusal (42501) as the same not-allowed code, not a generic save failure", async () => {
    state.allowed = true; // the application gate passed; the database is the final authority
    state.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: "42501" } }));
    expect(await saveBusiness({ displayName: "X" })).toEqual({ ok: false, code: "onboarding.error.businessNotAllowed" });
  });

  it("keeps other database failures as a generic save failure", async () => {
    state.allowed = true;
    state.rpc.mockImplementationOnce(async () => ({ data: null, error: { code: "22023" } }));
    expect(await saveBusiness({ displayName: "X" })).toEqual({ ok: false, code: "onboarding.error.saveFailed" });
  });
});

describe("business draft writers - the registered type is locked while the first business is outstanding", () => {
  const savedType = () => (state.rpc.mock.calls[0]?.[1] as { p_org_type?: string }).p_org_type;

  beforeEach(() => {
    state.rpc.mockClear();
    state.allowed = true;
  });

  it("writes the type the person registered with, whatever the client posted", async () => {
    state.mandatory = { required: true, orgType: "showroom_dealer" };
    await saveBusiness({ displayName: "Nile Showroom", orgType: "supplier" });
    expect(state.rpc).toHaveBeenCalledWith("business_draft_save", expect.objectContaining({ p_org_type: "showroom_dealer" }));
  });

  it("supplies the registered type even when the client posted none (the wizard never asks twice)", async () => {
    state.mandatory = { required: true, orgType: "importer" };
    await saveBusiness({ displayName: "Delta Imports" });
    expect(savedType()).toBe("importer");
  });

  it("the submit path saves through the same lock before creating the organization", async () => {
    state.mandatory = { required: true, orgType: "manufacturer" };
    await submitBusiness({ displayName: "Giza Factory", legalName: "Giza Factory Industries SAE", orgType: "showroom_dealer" }).catch(() => undefined);
    expect(state.rpc.mock.calls[0]).toEqual(["business_draft_save", expect.objectContaining({ p_org_type: "manufacturer" })]);
  });

  it("an owner adding ANOTHER business (no outstanding first business) still chooses the type freely", async () => {
    state.mandatory = { required: false, orgType: null };
    await saveBusiness({ displayName: "Second Branch Co", orgType: "supplier" });
    expect(savedType()).toBe("supplier");
  });
});

describe("business draft writers - required legal name and canonical location", () => {
  const rpcArgs = (name: string) => state.rpc.mock.calls.find((c) => c[0] === name)?.[1] as Record<string, unknown> | undefined;
  const complete = { displayName: "Nile Supply", legalName: "Nile Supply Trading LLC", orgType: "supplier" as const };

  beforeEach(() => {
    state.rpc.mockClear();
    state.allowed = true;
    state.mandatory = { required: false, orgType: null };
  });

  it("a draft may be saved without a legal name (still editing)", async () => {
    expect(await saveBusiness({ displayName: "Nile Supply" })).toEqual({ ok: true, draftId: "draft-1" });
  });

  it("submit refuses a missing, blank or one-character legal name before reaching the database", async () => {
    for (const legalName of [undefined, null, "", "   ", "A"]) {
      state.rpc.mockClear();
      const res = await submitBusiness({ ...complete, legalName });
      expect(res).toEqual({ ok: false, code: "onboarding.error.legalNameRequired" });
      expect(state.rpc).not.toHaveBeenCalled();
    }
  });

  it("submit refuses a missing business name with its own message", async () => {
    expect(await submitBusiness({ ...complete, displayName: "  " })).toEqual({ ok: false, code: "onboarding.error.businessNameRequired" });
  });

  it("submit refuses a chosen governorate without a city, but accepts no location at all", async () => {
    expect(await submitBusiness({ ...complete, governorate: "cairo" })).toEqual({ ok: false, code: "onboarding.error.cityRequired" });
    expect(state.rpc).not.toHaveBeenCalled();
    await submitBusiness(complete).catch(() => undefined);
    expect(state.rpc).toHaveBeenCalledWith("business_draft_submit", expect.any(Object));
  });

  it("passes a canonical governorate and city to the database", async () => {
    await saveBusiness({ ...complete, governorate: "dakahlia", city: "mansoura" });
    expect(rpcArgs("business_draft_save")).toMatchObject({ p_governorate: "dakahlia", p_city: "mansoura", p_legal_name: "Nile Supply Trading LLC" });
    expect(rpcArgs("business_draft_save")!.p_city_custom_name).toBeUndefined();
  });

  it("passes the typed city (Other) as the custom name and never as a city key", async () => {
    await saveBusiness({ ...complete, governorate: "dakahlia", cityCustomName: "Kafr Test" });
    const args = rpcArgs("business_draft_save")!;
    expect(args).toMatchObject({ p_governorate: "dakahlia", p_city_custom_name: "Kafr Test" });
    expect(args.p_city).toBeUndefined();
  });

  it("resolves a historical underscore city before it reaches the database", async () => {
    await saveBusiness({ ...complete, governorate: "cairo", city: "nasr_city" });
    expect(rpcArgs("business_draft_save")).toMatchObject({ p_governorate: "cairo", p_city: "nasr-city" });
  });

  it("rejects, without a database call, a city of another governorate, an unknown governorate, and the literal Other", async () => {
    for (const bad of [
      { governorate: "cairo", city: "mansoura" },
      { governorate: "narnia" },
      { governorate: "cairo", city: "other" },
      { governorate: "cairo", cityCustomName: "Other" },
      { governorate: "cairo", cityCustomName: "أخرى" },
      { governorate: "cairo", city: "maadi", cityCustomName: "Somewhere" },
    ]) {
      state.rpc.mockClear();
      expect(await saveBusiness({ ...complete, ...bad })).toEqual({ ok: false, code: "onboarding.error.locationInvalid" });
      expect(state.rpc).not.toHaveBeenCalled();
    }
  });

  it("maps the database's own legal-name / city refusals to specific codes", async () => {
    state.rpc.mockImplementation(async (name: unknown) =>
      name === "business_draft_save"
        ? { data: "draft-1", error: null }
        : { data: null, error: { code: "22023", message: "a legal business name is required" } as never },
    );
    expect((await submitBusiness(complete)).code).toBe("onboarding.error.legalNameRequired");
    state.rpc.mockImplementation(async (name: unknown) =>
      name === "business_draft_save"
        ? { data: "draft-1", error: null }
        : { data: null, error: { code: "22023", message: "a city is required once a governorate is chosen" } as never },
    );
    expect((await submitBusiness(complete)).code).toBe("onboarding.error.cityRequired");
    state.rpc.mockImplementation(async () => ({ data: "draft-1", error: null }));
  });
});
