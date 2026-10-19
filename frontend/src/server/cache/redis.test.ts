import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const identity = vi.hoisted(() => ({ current: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({}) }));
vi.mock("@/server/auth/session", () => ({ readSessionIdentity: async () => identity.current }));

import { cacheEnvSchema } from "@/lib/env/cache";
import { cacheKey, cacheMetrics, resetRedisForTests, withRedis } from "./redis";
import { cachedReference, invalidateReference } from "./reference";
import { consumeRateLimit, RATE_LIMITS } from "./rate-limit";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";

function setEnv(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

describe("cache settings", () => {
  it("is off by default and needs a URL when on", () => {
    expect(cacheEnvSchema.parse({}).REDIS_CACHE_ENABLED).toBe(false);
    expect(() => cacheEnvSchema.parse({ REDIS_CACHE_ENABLED: "true" })).toThrow();
  });
  it("requires TLS for hosted Redis but allows loopback", () => {
    expect(() => cacheEnvSchema.parse({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "redis://cache.example.com:6379", APP_ENV: "production" })).toThrow();
    expect(cacheEnvSchema.parse({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "rediss://default:x@cache.example.com:6379", APP_ENV: "production" }).REDIS_URL).toContain("rediss://");
    expect(cacheEnvSchema.parse({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:6379", APP_ENV: "staging" }).REDIS_CACHE_ENABLED).toBe(true);
    expect(() => cacheEnvSchema.parse({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "http://127.0.0.1:6379" })).toThrow();
  });
});

describe("cache keys", () => {
  beforeEach(() => setEnv({ NEXT_PUBLIC_APP_ENV: "local", REDIS_KEY_ENV: undefined }));
  it("are namespaced by environment, version, namespace and scope, and hash their parameters", () => {
    const key = cacheKey("ref", "global", "trades");
    expect(key).toMatch(/^aladdin:local:v1:ref:global:[0-9a-f]{32}$/);
    expect(cacheKey("rl", { user: USER_A }, "x")).toContain(`:u-${USER_A}:`);
    expect(cacheKey("rl", { tenant: TENANT }, "x")).toContain(`:t-${TENANT}:`);
    expect(cacheKey("rl", { user: USER_A }, "+201000000000")).not.toContain("201000000000");
  });
  it("keep two tenants or users apart for the same parameters", () => {
    expect(cacheKey("rl", { user: USER_A }, "p")).not.toBe(cacheKey("rl", { user: USER_B }, "p"));
    expect(cacheKey("rl", { tenant: USER_A }, "p")).not.toBe(cacheKey("rl", { user: USER_A }, "p"));
  });
  it("refuse malformed namespaces and scopes", () => {
    expect(() => cacheKey("ref:x", "global")).toThrow();
    expect(() => cacheKey("rl", { user: "*" })).toThrow();
  });
  it("use REDIS_KEY_ENV to separate environments sharing a database", () => {
    setEnv({ REDIS_KEY_ENV: "preview" });
    expect(cacheKey("ref", "global", "trades")).toMatch(/^aladdin:preview:v1:/);
  });
});

describe("with Redis off or unreachable", () => {
  afterEach(async () => { await resetRedisForTests(); });
  it("loads from the database and skips limits when disabled", async () => {
    setEnv({ REDIS_CACHE_ENABLED: "false", REDIS_URL: undefined });
    const load = vi.fn(async () => [{ id: "t1" }]);
    expect(await cachedReference("trades", load)).toEqual([{ id: "t1" }]);
    expect(await cachedReference("trades", load)).toEqual([{ id: "t1" }]);
    expect(load).toHaveBeenCalledTimes(2);
    expect((await consumeRateLimit("media-upload", USER_A)).outcome).toBe("skipped");
  });
  it("fails open within the connect timeout and then opens the breaker", async () => {
    setEnv({ REDIS_CACHE_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:1", NEXT_PUBLIC_APP_ENV: "local" });
    const load = vi.fn(async () => [{ id: "t1" }]);
    const started = Date.now();
    expect(await cachedReference("trades", load)).toEqual([{ id: "t1" }]);
    expect((await consumeRateLimit("media-upload", USER_A)).outcome).toBe("skipped");
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(cacheMetrics().breakerOpen).toBe(true);
    // While the breaker is open, Redis is not attempted at all.
    const fast = Date.now();
    expect(await withRedis("t", async () => "never")).toBeUndefined();
    expect(Date.now() - fast).toBeLessThan(20);
  });
});

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

describe.skipIf(!REDIS_TEST_URL)("against a real Redis (REDIS_TEST_URL)", () => {
  beforeEach(async () => {
    await resetRedisForTests();
    setEnv({ REDIS_CACHE_ENABLED: "true", REDIS_URL: REDIS_TEST_URL, REDIS_KEY_ENV: `test-${process.pid}`, NEXT_PUBLIC_APP_ENV: "local" });
    identity.current = { id: USER_A };
    await withRedis("t", async (redis) => {
      for await (const keys of redis.scanIterator({ MATCH: `aladdin:test-${process.pid}:*` })) if (keys.length) await redis.del(keys);
    });
  });
  afterEach(async () => { await resetRedisForTests(); });

  it("serves a reference vocabulary from Redis after the first load, with a TTL", async () => {
    const load = vi.fn(async () => [{ id: "t1", key: "trade.tiling" }]);
    expect(await cachedReference("trades", load)).toEqual([{ id: "t1", key: "trade.tiling" }]);
    expect(await cachedReference("trades", load)).toEqual([{ id: "t1", key: "trade.tiling" }]);
    expect(load).toHaveBeenCalledTimes(1);
    const ttl = await withRedis("t", (redis) => redis.ttl(cacheKey("ref", "global", "trades")));
    expect(ttl).toBeGreaterThan(500);
    expect(ttl).toBeLessThanOrEqual(600);
    expect(cacheMetrics().namespaces.ref).toMatchObject({ hits: 1, misses: 1, sets: 1 });
  });

  it("invalidates at once", async () => {
    const load = vi.fn(async () => [{ id: "t1" }]);
    await cachedReference("trades", load);
    await invalidateReference("trades");
    await cachedReference("trades", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never reads or fills the cache for a caller without a session", async () => {
    const load = vi.fn(async () => [{ id: "t1" }]);
    await cachedReference("trades", load);
    identity.current = null;
    const anonymous = vi.fn(async () => [] as { id: string }[]);
    expect(await cachedReference("trades", anonymous)).toEqual([]);
    expect(anonymous).toHaveBeenCalledTimes(1);
  });

  it("does not pin an empty result", async () => {
    const empty = vi.fn(async () => [] as { id: string }[]);
    await cachedReference("trade-specialties", empty);
    await cachedReference("trade-specialties", empty);
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent misses into one database read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const load = vi.fn(async () => { await gate; return [{ id: "t1" }]; });
    const all = Promise.all([cachedReference("product-categories", load), cachedReference("product-categories", load), cachedReference("product-categories", load)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    expect((await all).every((rows) => rows.length === 1)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("limits each user independently within the window", async () => {
    const { limit } = RATE_LIMITS["media-upload"];
    for (let i = 0; i < limit; i += 1) expect((await consumeRateLimit("media-upload", USER_A)).outcome).toBe("allowed");
    const limited = await consumeRateLimit("media-upload", USER_A);
    expect(limited.outcome).toBe("limited");
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(RATE_LIMITS["media-upload"].windowSeconds);
    expect((await consumeRateLimit("media-upload", USER_B)).outcome).toBe("allowed");
    expect((await consumeRateLimit("media-read", USER_A)).outcome).toBe("allowed");
  });

  it("sets a TTL on every limiter key", async () => {
    await consumeRateLimit("media-read", USER_A);
    const ttls = await withRedis("t", async (redis) => {
      const out: number[] = [];
      for await (const keys of redis.scanIterator({ MATCH: `aladdin:test-${process.pid}:v1:rl:*` })) for (const key of keys) out.push(await redis.ttl(key));
      return out;
    });
    expect(ttls?.length).toBe(1);
    expect(ttls?.every((ttl) => ttl > 0 && ttl <= 60)).toBe(true);
  });
});
