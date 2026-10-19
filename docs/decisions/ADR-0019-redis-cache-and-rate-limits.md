# ADR-0019 — Redis as an optional accelerator: reference cache, rate limits, job locks

**Status:** Proposed · 2026-10-19 · **Needs owner approval** before any hosted Redis is created. The code ships switched off (`REDIS_CACHE_ENABLED=false`); with it off, behaviour is exactly as before.

**Refines:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md) Revision 2, section "Redis: not now". The owner's 2026-10-19 brief asked for Redis to be implemented now. This ADR records what Redis may and may not hold.

## Decision

Redis is an **accelerator and counter store**, never an authority.

| Use | Where | Key | TTL | When Redis is down |
|---|---|---|---|---|
| Reference vocabularies (trades, trade specialties, product categories) | `frontend/src/server/cache/reference.ts` | `aladdin:{env}:v1:ref:global:{hash}` | 600 s, plus `invalidateReference()` | Read Postgres |
| Per-user rate limits: signed upload URLs, private media proxy reads, video part URLs | `frontend/src/server/cache/rate-limit.ts` | `aladdin:{env}:v1:rl:u-{userId}:{hash}` | one window | Skipped; the database limits still apply |
| Background job locks (historical purge, video transcode) | `backend/app/coordination` | `aladdin:{env}:v1:lock:global:{name}` | 10 min, extended per batch | Job runs unlocked; every job is idempotent |

### What Redis must never hold

- **Authorization.** No permission, membership, capability, visibility, audience, suspension or session decision is read from Redis. Media access is decided by Postgres on every request (ADR-0018), so revocation stays immediate.
- **Bytes.** No image, video, segment or document content. Bytes live in R2 and the Worker's edge cache.
- **Per-tenant business data.** Nothing tenant-owned is cached today. If a future entry is, it must use the `t-{tenantId}` scope, and `cacheKey()` refuses a malformed scope.
- **Raw identifiers.** Key parameters are SHA-256 hashed; phone numbers and emails never appear in a key.

### Why only reference vocabularies are cached

The audit (2026-10-19) found no other cross-user hot reads. Every other page reads data that RLS filters per caller, and caching it would mean caching a permission decision. The measured staging bottleneck (a 260 ms per-row role check) was fixed in SQL instead (`20261019130000_rls_platform_check_initplan.sql`).

Each cached loader filters explicitly (`is_active = true`), so a support user, whose policy also returns retired rows, can never fill an entry other callers are served. A caller without a verified session never touches the cache. Empty results are not cached.

### Client and failure behaviour

- `@redis/client` (the official client's core, without the module packages) runs in Node server code only.
- Each serverless instance holds one multiplexed connection. A client pool helps only blocking commands, which nothing here uses.
- Commands time out after 150 ms, and the first connect after 1 s.
- An error opens a 5-second breaker, so a dead Redis costs one timeout, not one per request.
- The offline queue is disabled, so commands fail fast instead of waiting on a reconnect.
- Hosted Redis must use TLS (`rediss://`); the env schema refuses anything else outside local.
- Monitoring:
  - `/api/health` reports `cache: disabled | ok | unavailable`.
  - `cacheMetrics()` keeps per-namespace hits, misses, sets, errors, invalidations and limited counts, plus average command latency.
  - The first failure after a healthy period logs `cache.redis_unavailable`.

## Measurements (local, 2026-10-19)

300 iterations each. PostgREST and Redis both ran on loopback, so the hosted gap is mostly network.

| Read | PostgREST p50 / p95 | Redis p50 / p95 |
|---|---|---|
| Trades (14 rows, 1 kB) | 4.48 / 6.29 ms | 0.47 / 0.70 ms |
| Product categories (15 rows, 1 kB) | 3.53 / 4.46 ms | 0.39 / 0.54 ms |
| Rate-limit window script | — | 0.13 / 0.26 ms |

**Honest reading:**
- The page-latency gain is a few milliseconds on the pages that render these selectors.
- The real value is fewer Data API requests against Supabase Free, plus rate limits on expensive media paths.
- Redis is not a fix for Core Web Vitals.

## Managed options (researched 2026-10-19; no account created)

| Option | Free tier | First paid step | Fit |
|---|---|---|---|
| **Upstash Redis** (Vercel Marketplace) | 250 MB, 500K commands/month | Pay as you go, $0.20 per 100K commands; or $10/month fixed | **Recommended.** TLS, EU regions, billed per command, works from serverless. |
| Redis Cloud Essentials | 30 MB, 30 connections, 100 ops/s, 5 GB/month bandwidth | From about $5/month | Too few connections for serverless bursts. |
| Aiven for Valkey | 1 GB single node | Hobbyist, $19/month | Fine, but a fixed node and higher first paid step. |

**Command budget.** Each private image read through the application proxy costs one command for the limiter; each reference miss costs two.

- Example: 20 images per page × 1,000 page views a day ≈ 600K commands a month, above Upstash Free.
- Once edge delivery is on, images bypass the proxy and that cost disappears.
- Until then, either leave `REDIS_CACHE_ENABLED=false`, or accept pay-as-you-go (about $1–2/month at that volume). **That choice needs owner approval.**

## Activation (owner approval required)

1. Create an Upstash Redis database in an EU region, ideally Paris or Frankfurt, near `cdg1`.
2. Set `REDIS_URL` (`rediss://…`) as a secret and `REDIS_KEY_ENV` per environment. Set `REDIS_CACHE_ENABLED=true` in Vercel, and `REDIS_URL` for the backend.
3. Check `/api/health` reports `cache: "ok"`.
4. Rollback: set `REDIS_CACHE_ENABLED=false`. No data migration is involved, and nothing is lost.
