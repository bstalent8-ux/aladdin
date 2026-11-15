import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc }) }));

const { submitCraftsmanVerificationIfComplete } = await import("./craftsman-verification");

describe("submitCraftsmanVerificationIfComplete", () => {
  beforeEach(() => rpc.mockReset());

  it.each(["submitted", "resubmitted", "already_open", "approved", "rejected", "incomplete"])("returns the database's %s outcome", async (state) => {
    rpc.mockResolvedValueOnce({ data: { state, percent: 100, verification_id: null }, error: null });
    expect(await submitCraftsmanVerificationIfComplete()).toBe(state);
    expect(rpc).toHaveBeenCalledWith("craftsman_profile_verification_submit");
  });

  it("returns null for an unknown state, an error, a non-object or a thrown failure, never failing the save", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "whatever" }, error: null });
    expect(await submitCraftsmanVerificationIfComplete()).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "only a craftsman profile can request verification here" } });
    expect(await submitCraftsmanVerificationIfComplete()).toBeNull();
    rpc.mockResolvedValueOnce({ data: "x", error: null });
    expect(await submitCraftsmanVerificationIfComplete()).toBeNull();
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await submitCraftsmanVerificationIfComplete()).toBeNull();
  });
});
