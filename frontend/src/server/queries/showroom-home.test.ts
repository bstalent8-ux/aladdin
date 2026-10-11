import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  RECOMMENDED_PRODUCT_LIMIT,
  loadRecommendedProducts,
  loadShowroomHomeMetrics,
  loadShowroomKpiLayout,
} from "./showroom-home";
import { SHOWROOM_METRIC_KEYS } from "@/features/showroom-shell/home/metrics";

type Call = [string, ...unknown[]];

/** A recording PostgREST/RPC stub: every chained call is captured, the awaited end resolves `result`. */
function stub(results: { rpc?: unknown; tables?: Record<string, unknown[]> }) {
  const calls: Call[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const tableQueue = { ...(results.tables ?? {}) };
  const makeBuilder = (result: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "order", "limit"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(result);
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  };
  const supabase = {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const queued = tableQueue[`rpc:${name}`];
      if (!queued) return Promise.resolve(results.rpc);
      calls.push(["rpc", name, args]);
      return makeBuilder(queued.shift() ?? { data: null, error: null });
    },
    from: (table: string) => {
      calls.push(["from", table]);
      return makeBuilder((tableQueue[table] ?? []).shift() ?? { data: null, error: null });
    },
  };
  return { supabase: supabase as never, calls, rpcCalls };
}

const metricsPayload = Object.fromEntries(SHOWROOM_METRIC_KEYS.map((k, i) => [k, i]));

describe("loadShowroomHomeMetrics", () => {
  it("asks the RPC for exactly the active organization, period and timezone", async () => {
    const { supabase, rpcCalls } = stub({ rpc: { data: metricsPayload, error: null } });
    const out = await loadShowroomHomeMetrics(supabase, "org-1", { from: "2026-01-01", to: "2026-01-31" }, "Africa/Cairo");
    expect(rpcCalls).toEqual([
      {
        name: "showroom_home_metrics",
        args: { p_org_id: "org-1", p_from: "2026-01-01", p_to: "2026-01-31", p_timezone: "Africa/Cairo" },
      },
    ]);
    expect(out.rfqs_sent).toBe(metricsPayload.rfqs_sent);
  });

  it("surfaces a database error so the Home shows its error state", async () => {
    const { supabase } = stub({ rpc: { data: null, error: new Error("not a member of this organization") } });
    await expect(loadShowroomHomeMetrics(supabase, "org-x", { from: "2026-01-01", to: "2026-01-02" }, "Africa/Cairo")).rejects.toThrow(
      /not a member/,
    );
  });

  it("rejects a malformed payload rather than inventing zeros", async () => {
    const { supabase } = stub({ rpc: { data: { rfqs_sent: 1 }, error: null } });
    await expect(loadShowroomHomeMetrics(supabase, "org-1", { from: "2026-01-01", to: "2026-01-02" }, "Africa/Cairo")).rejects.toThrow();
  });
});

describe("loadShowroomKpiLayout", () => {
  const layoutTables = (personal: unknown, team: unknown) => ({
    dashboard_kpi_layouts: [
      { data: personal, error: null },
      { data: team, error: null },
    ],
  });

  it("reads only the showroom_suite surface for this member and the team default", async () => {
    const { supabase, calls } = stub({ tables: layoutTables(null, null) });
    await loadShowroomKpiLayout(supabase, "org-1", "m-1");
    const surfaceFilters = calls.filter((c) => c[0] === "eq" && c[1] === "surface");
    expect(surfaceFilters).toEqual([
      ["eq", "surface", "showroom_suite"],
      ["eq", "surface", "showroom_suite"],
    ]);
    expect(calls).toContainEqual(["eq", "membership_id", "m-1"]);
    expect(calls).toContainEqual(["is", "membership_id", null]);
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
  });

  it("prefers the personal layout over the team default", async () => {
    const { supabase } = stub({ tables: layoutTables({ card_order: ["total_sales"] }, { card_order: ["rfqs_sent"] }) });
    expect(await loadShowroomKpiLayout(supabase, "o", "m")).toEqual({ saved: ["total_sales"], hasPersonal: true, hasTeamDefault: true });
  });

  it("falls back to the team default, then to null (system default)", async () => {
    expect(await loadShowroomKpiLayout(stub({ tables: layoutTables(null, { card_order: ["rfqs_sent"] }) }).supabase, "o", "m")).toEqual({
      saved: ["rfqs_sent"],
      hasPersonal: false,
      hasTeamDefault: true,
    });
    expect(await loadShowroomKpiLayout(stub({ tables: layoutTables(null, null) }).supabase, "o", "m")).toEqual({
      saved: null,
      hasPersonal: false,
      hasTeamDefault: false,
    });
  });
});

describe("loadRecommendedProducts", () => {
  it("excludes the active organization's own listings and orders deterministically", async () => {
    const rows = [{ id: "p1", name: "A", brand: null, supplier_name: "S", supplier_verified: true, unit: null, category: null }];
    const { supabase, calls } = stub({ tables: { "rpc:catalog_products": [{ data: rows, error: null }] } });
    const out = await loadRecommendedProducts(supabase, "org-1");
    expect(out).toEqual(rows);
    expect(calls).toContainEqual(["rpc", "catalog_products", { p_org_id: "org-1" }]);
    expect(calls).toContainEqual(["neq", "organization_id", "org-1"]);
    expect(calls).toContainEqual(["order", "published_at", { ascending: false }]);
    expect(calls).toContainEqual(["order", "id", { ascending: true }]);
    expect(calls).toContainEqual(["limit", RECOMMENDED_PRODUCT_LIMIT]);
  });

  it("drops rows without an id or name and returns an empty list for no data", async () => {
    const dirty = [{ id: null, name: "x" }, { id: "p2", name: null }, { id: "p3", name: "ok" }];
    const out = await loadRecommendedProducts(stub({ tables: { "rpc:catalog_products": [{ data: dirty, error: null }] } }).supabase, "o");
    expect(out.map((p) => p.id)).toEqual(["p3"]);
    expect(await loadRecommendedProducts(stub({ tables: { "rpc:catalog_products": [{ data: null, error: null }] } }).supabase, "o")).toEqual([]);
  });

  it("throws on a database error", async () => {
    const { supabase } = stub({ tables: { "rpc:catalog_products": [{ data: null, error: new Error("boom") }] } });
    await expect(loadRecommendedProducts(supabase, "o")).rejects.toThrow("boom");
  });
});
