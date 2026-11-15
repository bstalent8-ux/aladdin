import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin-server", () => ({ countLandingPublicStats: () => count() }));

async function fresh() {
  vi.resetModules();
  return (await import("./landing-brand-stats.server")).readLandingStats;
}

describe("readLandingStats", () => {
  beforeEach(() => { count.mockReset(); vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production"); });

  it("shares one database read between concurrent requests and caches it", async () => {
    count.mockResolvedValue({ users: 10, organizations: 2, products: 5 });
    const read = await fresh();
    const [a, b] = await Promise.all([read(1_000), read(1_000)]);
    expect(a).toEqual(b);
    await read(2_000);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed read for a minute, then tries again", async () => {
    count.mockRejectedValue(new Error("down"));
    const read = await fresh();
    expect(await read(0)).toEqual({ users: null, organizations: null, products: null });
    await read(30_000);
    expect(count).toHaveBeenCalledTimes(1);
    await read(61_000);
    expect(count).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good value when a later read fails", async () => {
    count.mockResolvedValueOnce({ users: 10, organizations: 2, products: 5 });
    const read = await fresh();
    await read(0);
    count.mockRejectedValue(new Error("down"));
    expect(await read(11 * 60 * 1000)).toEqual({ users: 10, organizations: 2, products: 5 });
  });
});
