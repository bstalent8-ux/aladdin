import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { count?: number | null; data?: Array<{ user_id: string }>; error?: unknown };
type Call = { table: string; filters: Array<[string, unknown[]]> };
const state = vi.hoisted(() => ({ results: {} as Record<string, Result[]>, calls: [] as unknown[] }));

/** A chainable stand-in for the PostgREST builder: records the filters, resolves to the next canned result for the table. */
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      state.calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const name of ["select", "in", "eq", "is"]) {
        builder[name] = (...args: unknown[]) => { call.filters.push([name, args]); return builder; };
      }
      builder.then = (resolve: (r: Result) => unknown) => resolve(state.results[table]?.shift() ?? { count: 0, data: [] });
      return builder;
    },
  }),
}));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://localhost:63321" }), parseServerEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "local-test-only" }) }));
import { countLandingPublicStats } from "./admin-server";

const calls = () => state.calls as Call[];

function seed(opts: { registered: number; grants?: string[]; assignments?: string[]; staffRegistered?: number; orgs?: number; products?: number }) {
  state.results = {
    users: [{ count: opts.registered }, ...(opts.staffRegistered === undefined ? [] : [{ count: opts.staffRegistered }])],
    platform_role_grants: [{ data: (opts.grants ?? []).map((user_id) => ({ user_id })) }],
    admin_role_assignments: [{ data: (opts.assignments ?? []).map((user_id) => ({ user_id })) }],
    organizations: [{ count: opts.orgs ?? 7 }],
    products: [{ count: opts.products ?? 9 }],
  };
}

describe("countLandingPublicStats", () => {
  beforeEach(() => { state.calls = []; state.results = {}; });

  it("counts every registered account (pending first sign-in or active) minus platform staff", async () => {
    seed({ registered: 1028, grants: ["a"], assignments: ["a", "b", "c"], staffRegistered: 3 });
    expect(await countLandingPublicStats()).toEqual({ users: 1025, organizations: 7, products: 9 });
    const first = calls().find((c) => c.table === "users")!;
    expect(first.filters).toContainEqual(["in", ["status", ["pending_verification", "active"]]]);
    // Staff appear once even when they hold a grant and an assignment, and only their registered accounts are subtracted.
    const second = calls().filter((c) => c.table === "users")[1]!;
    expect(second.filters).toContainEqual(["in", ["id", ["a", "b", "c"]]]);
  });

  it("asks only for active assignments and does not look up staff when there are none", async () => {
    seed({ registered: 54 });
    expect(await countLandingPublicStats()).toMatchObject({ users: 54 });
    expect(calls().find((c) => c.table === "admin_role_assignments")!.filters).toContainEqual(["eq", ["is_active", true]]);
    expect(calls().filter((c) => c.table === "users")).toHaveLength(1);
  });

  it("never goes below zero", async () => {
    seed({ registered: 1, grants: ["a", "b"], staffRegistered: 2 });
    expect((await countLandingPublicStats()).users).toBe(0);
  });

  it("fails (so the pills hide) on a database error, a missing count, or an unreasonably long staff list", async () => {
    seed({ registered: 5 });
    state.results.platform_role_grants = [{ error: { message: "boom" } }];
    await expect(countLandingPublicStats()).rejects.toThrow("landing stats unavailable");

    seed({ registered: 5 });
    state.results.users = [{ count: null }];
    await expect(countLandingPublicStats()).rejects.toThrow("landing stats unavailable");

    seed({ registered: 5, grants: Array.from({ length: 201 }, (_, i) => `u${i}`) });
    await expect(countLandingPublicStats()).rejects.toThrow("landing stats unavailable");
  });
});
