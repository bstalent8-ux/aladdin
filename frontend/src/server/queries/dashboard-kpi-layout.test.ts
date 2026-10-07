import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadEffectiveKpiLayout } from "./dashboard-kpi-layout";
import { SYSTEM_DEFAULT_KPI_ORDER } from "@/lib/workspace/dashboard-kpi-catalog";

function stub(personal: unknown, team: unknown) {
  const calls: unknown[][] = [];
  const queue = [{ data: personal, error: null }, { data: team, error: null }];
  const supabase = {
    from: () => {
      const result = queue.shift()!;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) {
        builder[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(result);
      return builder;
    },
  };
  return { supabase: supabase as never, calls };
}

describe("production Home KPI layout (regression for the surface split)", () => {
  it("reads only the home surface, so showroom-suite layouts can never leak into /b2b", async () => {
    const { supabase, calls } = stub(null, null);
    await loadEffectiveKpiLayout(supabase, "org-1", "m-1");
    expect(calls.filter((c) => c[0] === "eq" && c[1] === "surface")).toEqual([
      ["eq", "surface", "home"],
      ["eq", "surface", "home"],
    ]);
  });

  it("still resolves personal -> team default -> system default", async () => {
    expect((await loadEffectiveKpiLayout(stub({ card_order: ["due_today"] }, { card_order: ["projects"] }).supabase, "o", "m")).cardOrder).toEqual(["due_today"]);
    expect((await loadEffectiveKpiLayout(stub(null, { card_order: ["projects"] }).supabase, "o", "m")).cardOrder).toEqual(["projects"]);
    expect((await loadEffectiveKpiLayout(stub(null, null).supabase, "o", "m")).cardOrder).toEqual(SYSTEM_DEFAULT_KPI_ORDER);
  });
});
