import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@redis/client";
import { readCacheEnv } from "@/lib/env/cache";

/**
 * The one Redis connection for this server instance, and the key scheme every
 * cache and limiter uses.
 *
 * WHAT REDIS IS HERE. An accelerator for data that is the same for every caller
 * who may read it (reference vocabularies), and a counter store for rate limits.
 * It is never an authorization input: no permission, membership, visibility or
 * session decision is read from it, and no image or video byte is written to it.
 * Access to media is decided by Postgres on every request (ADR-0018).
 *
 * FAILURE IS SILENT AND SAFE. Every call is bounded by a short command timeout;
 * an error opens a breaker for a few seconds so a dead Redis costs one timeout,
 * not one per request. Callers fall back to Postgres (caches) or skip the extra
 * limit (limiters, whose authoritative limits live in the database).
 *
 * POOLING. Serverless functions keep one multiplexed connection per warm
 * instance; node-redis pipelines concurrent commands over it, which is the
 * pooling a request/response workload needs (a client pool only helps blocking
 * commands, which nothing here uses).
 */

type Client = ReturnType<typeof createClient>;

const COMMAND_TIMEOUT_MS = 150;
const CONNECT_TIMEOUT_MS = 1_000;
const BREAKER_MS = 5_000;

type Counters = { hits: number; misses: number; sets: number; errors: number; invalidations: number; limited: number };
const counters = new Map<string, Counters>();
let latencyTotalMs = 0;
let latencyCount = 0;
let breakerUntil = 0;

const state = globalThis as typeof globalThis & { __aladdinRedis?: Promise<Client> | null };

/** Per-namespace counters for /api/health and logs. In-process: one warm instance's view. */
export function cacheMetrics() {
  return {
    namespaces: Object.fromEntries(counters),
    commandLatencyAvgMs: latencyCount ? Number((latencyTotalMs / latencyCount).toFixed(2)) : null,
    breakerOpen: Date.now() < breakerUntil,
  };
}

export function count(namespace: string, field: keyof Counters, by = 1) {
  const entry = counters.get(namespace) ?? { hits: 0, misses: 0, sets: 0, errors: 0, invalidations: 0, limited: 0 };
  entry[field] += by;
  counters.set(namespace, entry);
}

/** Test seam: forget the connection, counters and breaker. */
export async function resetRedisForTests() {
  const pending = state.__aladdinRedis;
  state.__aladdinRedis = null;
  counters.clear();
  latencyTotalMs = 0;
  latencyCount = 0;
  breakerUntil = 0;
  if (pending) await pending.then((client) => client.destroy()).catch(() => undefined);
}

function connect(url: string): Promise<Client> {
  const client = createClient({
    url,
    // Fail fast instead of queueing commands while disconnected: a cache miss
    // is cheaper than a request waiting on a reconnect.
    disableOfflineQueue: true,
    commandOptions: { timeout: COMMAND_TIMEOUT_MS },
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5_000),
    },
  });
  // Without a listener an 'error' event would crash the process.
  client.on("error", () => openBreaker("connection"));
  // node-redis keeps retrying a refused first connection and its promise never
  // settles, so the first connect is bounded here and the client discarded.
  return new Promise<Client>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("redis connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    client.connect().then(() => {
      clearTimeout(timer);
      resolve(client as Client);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function openBreaker(reason: string) {
  const wasClosed = Date.now() >= breakerUntil;
  breakerUntil = Date.now() + BREAKER_MS;
  if (wasClosed) console.warn(JSON.stringify({ event: "cache.redis_unavailable", reason }));
}

/** True when Redis is configured on. Says nothing about whether it is reachable. */
export function redisEnabled(): boolean {
  return readCacheEnv().REDIS_CACHE_ENABLED;
}

/**
 * Runs `command` against Redis, or returns `undefined` when Redis is off,
 * unreachable, slow or failing. Never throws.
 */
export async function withRedis<T>(namespace: string, command: (client: Client) => Promise<T>): Promise<T | undefined> {
  const env = readCacheEnv();
  if (!env.REDIS_CACHE_ENABLED || !env.REDIS_URL) return undefined;
  if (Date.now() < breakerUntil) return undefined;
  const started = performance.now();
  try {
    state.__aladdinRedis ??= connect(env.REDIS_URL).catch((error: unknown) => {
      state.__aladdinRedis = null;
      throw error;
    });
    const client = await state.__aladdinRedis;
    const result = await command(client);
    latencyTotalMs += performance.now() - started;
    latencyCount += 1;
    return result;
  } catch {
    count(namespace, "errors");
    openBreaker("command");
    return undefined;
  }
}

const SEGMENT = /^[a-z0-9_-]{1,40}$/;

/**
 * `aladdin:{env}:v1:{namespace}:{scope}:{digest}`.
 *
 * `scope` is `global` for data identical for every permitted caller, or
 * `t-<uuid>` / `u-<uuid>` for data that belongs to one tenant or one user, so a
 * tenant's entry can never be read under another tenant's key. The parameters
 * are hashed: no raw identifier, phone or email ever appears in a key.
 */
export function cacheKey(namespace: string, scope: "global" | { tenant: string } | { user: string }, ...params: string[]): string {
  if (!SEGMENT.test(namespace)) throw new Error("invalid cache namespace");
  const env = readCacheEnv();
  const environment = env.REDIS_KEY_ENV ?? env.APP_ENV;
  let scopeSegment = "global";
  if (scope !== "global") {
    const id = "tenant" in scope ? scope.tenant : scope.user;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error("invalid cache scope");
    scopeSegment = `${"tenant" in scope ? "t" : "u"}-${id}`;
  }
  const digest = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 32);
  return `aladdin:${environment}:v1:${namespace}:${scopeSegment}:${digest}`;
}
