import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));

import { saveOrganizationContactAction, saveProfileContactVisibilityAction } from "./contacts";
import { createNetworkCandidateAction, cancelNetworkCandidateAction } from "./network-candidates";

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ data: "id-1", error: null });
});

describe("saveOrganizationContactAction", () => {
  it("normalises numbers to E.164 and sends every flag; unticked flags are false (hidden by default)", async () => {
    const res = await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, phone: "01001112223", email: "sales@x.example", showPhone: "on" }));
    expect(res).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("organization_contact_set", {
      p_org_id: ORG,
      p_phone_e164: "+201001112223",
      p_whatsapp_e164: "",
      p_contact_email: "sales@x.example",
      p_show_phone: true,
      p_show_whatsapp: false,
      p_show_email: false,
    });
  });

  it("rejects an unusable number or e-mail before any round trip", async () => {
    expect((await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, phone: "abc" }))).ok).toBe(false);
    expect((await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG, email: "nope" }))).ok).toBe(false);
    expect((await saveOrganizationContactAction({ ok: false }, form({ orgId: "not-a-uuid" }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports the database refusal (not org.manage) instead of success", async () => {
    state.rpc.mockResolvedValue({ error: { code: "42501", message: "org.manage required" } });
    const res = await saveOrganizationContactAction({ ok: false }, form({ orgId: ORG }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("commerce.errors.denied");
  });
});

describe("saveProfileContactVisibilityAction", () => {
  it("sends only flags - no value ever travels with a visibility change", async () => {
    await saveProfileContactVisibilityAction({ ok: false }, form({ showEmail: "1" }));
    expect(state.rpc).toHaveBeenCalledWith("profile_contact_visibility_set", { p_show_phone: false, p_show_whatsapp: false, p_show_email: true });
  });
});

describe("network candidates", () => {
  const base = { orgId: ORG, kind: "supplier", displayName: "Alpha Tiles", businessType: "importer", phone: "+201000000001" };

  it("submits through the RPC with the workspace, kind and typed details", async () => {
    const res = await createNetworkCandidateAction({ ok: false }, form(base));
    expect(res).toEqual({ ok: true, id: "id-1" });
    expect(state.rpc).toHaveBeenCalledWith("network_candidate_create", expect.objectContaining({
      p_org_id: ORG, p_kind: "supplier", p_display_name: "Alpha Tiles", p_business_type: "importer", p_phone: "+201000000001",
    }));
  });

  it("refuses an unknown kind or business type locally (retired labels cannot be submitted)", async () => {
    expect((await createNetworkCandidateAction({ ok: false }, form({ ...base, kind: "wholesaler" }))).ok).toBe(false);
    expect((await createNetworkCandidateAction({ ok: false }, form({ ...base, businessType: "showroom_dealer" }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("surfaces a missing network.refer capability as a denial", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "network.refer required" } });
    const res = await createNetworkCandidateAction({ ok: false }, form(base));
    expect(res).toEqual({ ok: false, code: "commerce.errors.denied" });
  });

  it("withdraws a pending submission by id only", async () => {
    expect((await cancelNetworkCandidateAction(form({ candidateId: "bad" }))).ok).toBe(false);
    expect((await cancelNetworkCandidateAction(form({ candidateId: "11111111-1111-4111-8111-111111111111" }))).ok).toBe(true);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
});
