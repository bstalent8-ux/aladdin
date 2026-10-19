import { NextResponse } from "next/server";
import { redisEnabled, withRedis } from "@/server/cache/redis";

export const dynamic = "force-dynamic";

/** Liveness probe for the web app. See docs/operations/monitoring-and-observability.md. */
export async function GET() {
  // Redis is optional: "unavailable" means slower pages, never wrong access.
  const cache = !redisEnabled() ? "disabled"
    : (await withRedis("health", (redis) => redis.ping())) === "PONG" ? "ok" : "unavailable";
  return NextResponse.json({
    status: "ok",
    service: "frontend",
    cache,
    timestamp: new Date().toISOString(),
  });
}
