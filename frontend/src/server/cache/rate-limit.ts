import "server-only";
import { cacheKey, count, withRedis } from "./redis";

/**
 * Per-user request ceilings kept in Redis (fixed window: INCR, and EXPIRE on
 * the first hit, atomically in one script so a crash can't leave a key without
 * a TTL; plain Redis 6+, Valkey and Upstash all run it).
 *
 * These are ADDITIONAL brakes on expensive paths. The authoritative limits stay
 * in Postgres (media reservation quotas, phone sign-in throttles), so when Redis
 * is off or unreachable the result is "skipped" and the request proceeds to the
 * database, which still refuses abuse. A limiter never grants anything.
 */
export const RATE_LIMITS = {
  // Signed upload URLs. Each one reserves a row and may sign an R2 PUT.
  "media-upload": { limit: 60, windowSeconds: 600 },
  // Private media reads through the application proxy (one per image shown).
  "media-read": { limit: 1_200, windowSeconds: 60 },
  // Video: signed multipart part URLs (a 2 GB upload at 16 MB parts is 128).
  "video-part": { limit: 600, windowSeconds: 600 },
} as const;

const WINDOW_SCRIPT = "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n";

export type RateLimitRule = keyof typeof RATE_LIMITS;
export type RateLimitResult = { outcome: "allowed" | "limited" | "skipped"; retryAfterSeconds?: number };

export async function consumeRateLimit(rule: RateLimitRule, userId: string): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[rule];
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = cacheKey("rl", { user: userId }, rule, String(window));
  const reply = await withRedis("rl", (redis) =>
    redis.eval(WINDOW_SCRIPT, { keys: [key], arguments: [String(windowSeconds)] }));
  const used = typeof reply === "number" ? reply : Number.NaN;
  if (!Number.isFinite(used)) return { outcome: "skipped" };
  if (used > limit) {
    count("rl", "limited");
    return { outcome: "limited", retryAfterSeconds: (window + 1) * windowSeconds - Math.floor(Date.now() / 1000) };
  }
  return { outcome: "allowed" };
}
