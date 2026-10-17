import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: state.rpc }) }));

import {
  resetPersonalKpiLayoutAction,
  resetTeamDefaultKpiLayoutAction,
  setPersonalKpiLayoutAction,
  setTeamDefaultKpiLayoutAction,
} from "./dashboard-kpi-layout";

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ error: null });
});

describe("dashboard KPI layout actions are surface-scoped", () => {
  it("writes a showroom_suite layout and refreshes the suite Home only", async () => {
    expect(await setPersonalKpiLayoutAction("org-1", ["total_sales"], "showroom_suite")).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith("dashboard_kpi_layout_set_personal", {
      p_org_id: "org-1",
      p_card_order: ["total_sales"],
      p_surface: "showroom_suite",
    });
    expect(state.revalidate).toHaveBeenCalledWith("/showroom/home");
    expect(state.revalidate).not.toHaveBeenCalledWith("/b2b");
  });

  it("keeps production Home behavior when no surface is given", async () => {
    await setPersonalKpiLayoutAction("org-1", ["due_today"]);
    expect(state.rpc).toHaveBeenCalledWith("dashboard_kpi_layout_set_personal", {
      p_org_id: "org-1",
      p_card_order: ["due_today"],
      p_surface: "home",
    });
    expect(state.revalidate).toHaveBeenCalledWith("/b2b");
  });

  it.each([
    ["set_team_default", () => setTeamDefaultKpiLayoutAction("org-1", ["rfqs_sent"], "showroom_suite"), { p_card_order: ["rfqs_sent"] }],
    ["reset_personal", () => resetPersonalKpiLayoutAction("org-1", "showroom_suite"), {}],
    ["reset_team_default", () => resetTeamDefaultKpiLayoutAction("org-1", "showroom_suite"), {}],
  ])("passes the surface to dashboard_kpi_layout_%s", async (name, run, extra) => {
    await run();
    expect(state.rpc).toHaveBeenCalledWith(`dashboard_kpi_layout_${name}`, {
      p_org_id: "org-1",
      ...extra,
      p_surface: "showroom_suite",
    });
  });

  it("returns the database's refusal instead of revalidating (the RPC is the authority)", async () => {
    state.rpc.mockResolvedValue({ error: { message: "org.manage required" } });
    expect(await setTeamDefaultKpiLayoutAction("org-1", ["total_sales"], "showroom_suite")).toEqual({
      ok: false,
      message: "org.manage required",
    });
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});
