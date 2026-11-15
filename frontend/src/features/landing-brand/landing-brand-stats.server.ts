import "server-only";

import { countLandingPublicStats } from "@/lib/supabase/admin-server";
import type { LandingStats } from "./landing-brand-stats";

const TTL_MS = 10 * 60 * 1000;
/** After a failed read, wait this long before asking the database again, so an outage never adds a timeout to every page view. */
const RETRY_MS = 60 * 1000;
const EMPTY: LandingStats = { users: null, organizations: null, products: null };
let cache: { at: number; ttl: number; value: LandingStats } | null = null;
let lastGood: LandingStats | null = null;
let inFlight: Promise<LandingStats> | null = null;

/**
 * Real platform counts for the hero pills. Cached per isolate for 10 minutes; concurrent requests share ONE database
 * read; a failed read yields the last good value or `null`s (pill hidden) and is not retried for a minute. Never a
 * made-up number outside local development.
 */
export async function readLandingStats(now = Date.now()): Promise<LandingStats> {
  if (cache && now - cache.at < cache.ttl) return cache.value;
  inFlight ??= load(now).finally(() => { inFlight = null; });
  return inFlight;
}

async function load(now: number): Promise<LandingStats> {
  try {
    const value = await countLandingPublicStats();
    // Local development has no production database, so show the mockup's figures there to review the layout.
    // Staging and production never do: they show real counts or nothing.
    if (process.env.NEXT_PUBLIC_APP_ENV === "local" && !value.users && !value.organizations && !value.products) {
      return { users: 250_000, organizations: 4_800, products: 120_000 };
    }
    lastGood = value;
    cache = { at: now, ttl: TTL_MS, value };
    return value;
  } catch {
    if (process.env.NEXT_PUBLIC_APP_ENV === "local") return { users: 250_000, organizations: 4_800, products: 120_000 };
    const value = lastGood ?? EMPTY;
    cache = { at: now, ttl: RETRY_MS, value };
    return value;
  }
}
