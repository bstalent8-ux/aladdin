# R2, Redis, video and palette: report (2026-10-19)

## What needs your approval

Nothing has been merged, deployed or activated, and no DNS, billing or media deletion was done. Supabase stays on Free.

| # | Approval | Cost | Needed for |
|---|---|---|---|
| 1 | Merge order: #88 → #89 → #91 → #92 (Redis) → #94 (video). #93 (palette) is independent | — | Everything |
| 2 | Apply the hosted migrations (the earlier ones, plus `20261019150000_media_videos`) | Free | R2, video |
| 3 | R2 activation; Worker/Pages + Hyperdrive; `media.aladdindecore.com` CNAME | R2 free under 10 GB; Workers Free 100k requests/day, Paid $5/month | R2 delivery, video |
| 4 | R2 bucket rules: CORS `PUT` from the app origin; abort incomplete multipart uploads after 1 day | Free | Video uploads |
| 5 | Managed Redis: **Upstash Free** recommended (250 MB, 500k commands/month). Paid tier is $0.20 per 100k commands, or $10/month fixed | Free to start | Cache, rate limits |
| 6 | Video transcode host with ffmpeg: a small VM (about $4–6/month), Fly.io Machines scaled to zero (per-second billing), or Cloud Run jobs | Paid | Video processing |
| 7 | Turn on `VIDEO_ENABLED`, Worker `VIDEO_ROUTES`, `REDIS_CACHE_ENABLED` | — | Go-live |

## Done

### R2 (#89/#91, verified further here)

The isolated end-to-end test passes. It uses an S3-compatible stand-in for R2, the media Worker's real handler, and the local database:

- **Upload:** a portfolio photo goes from the browser to storage with a presigned PUT. It is verified, recorded as R2 with a sha256 receipt, and gets three WebP variants.
- **Retrieval:** the image is served from the edge `/m/` route with a ticket. No image bytes come from the app.
- **Deletion:** deleting the work removes the row and the stored original.
- **Rollback:** with R2 switched off, existing R2 photos still render and new uploads go to Supabase Storage.

Historical Supabase portfolio photos and avatars remain scheduled for permanent purge, not migration. Nothing was deleted.

### Redis (#92, ADR-0019)

Redis is optional and fails open to Postgres. It holds:
- reference vocabularies, cached for 600 s;
- per-user rate limits for uploads, private reads and video parts;
- job locks.

It never holds authorization decisions or bytes. Keys are namespaced by environment and tenant, and parameters are hashed.

Local benchmark (p50): trades 4.48 → 0.47 ms; categories 3.53 → 0.39 ms; one rate-limit check 0.13 ms.

The main gain is fewer Supabase Data API calls on Free, plus the limits themselves.

| Managed Redis | Free tier | Paid |
|---|---|---|
| **Upstash** | 250 MB, 500k commands/month | $0.20 per 100k commands, or $10/month fixed |
| Redis Cloud | 30 MB, 30 connections | from about $5/month |
| Aiven Valkey | 1 GB | $19/month |

### Video (#94, ADR-0020)

- **Upload:** browser → R2 multipart, with progress, retry and resume after a reload. Limits are 500 MB and 5 minutes; MP4, MOV and WebM are accepted.
- **Processing:** an ffmpeg worker produces H.264/AAC HLS at 360p/720p/1080p (never upscaled) plus a poster.
- **Delivery:** the media Worker serves `/v/` and asks Postgres on every playlist and segment. It supports Range requests and caches bytes at the edge by revision.
- **Pages:** portfolio manager, public profile, product edit and showroom catalog.

**End to end, desktop and mobile:**
- upload, transcode, play, seek, publish, and anonymous play all pass;
- unpublish, delete and sign-out each refuse the next segment;
- the purge removes every object;
- no video byte went through the app.

**Measured locally:**
- first frame 0.6–0.8 s after pressing play;
- seeking 50–110 ms;
- only the poster loads before play;
- about a third of edge requests were served from the byte cache;
- a 12 s 720p clip transcoded in about 6 s.

**R2 + HLS vs Cloudflare Stream.** Stream costs $5 per 1,000 stored minutes and $1 per 1,000 delivered minutes, with encoding included. It is simpler to run, but its signed URLs stay valid until they expire, so a segment cannot be revoked immediately. R2 + HLS keeps revocation immediate and reuses the same tenant rules as images. For 200 two-minute videos it costs about $0.15/month in storage, versus about $6/month on Stream.

**Load:** one full view of a 5-minute video is about 80 Worker requests and 80 database checks.

### Bugs the end-to-end run caught, all fixed in #94

1. The same-origin check compared against the server's bind address.
2. A portfolio upload could not start: a database parameter had no default.
3. The public profile page crashed when it showed a video.

### Palette (#93)

- The whole website now uses #071A2D, #D8C7A6, #F2E9D8 and #B96F52, in Light and Dark, in English and Arabic.
- A contrast test checks 79 colour pairs per theme against AA.
- There are 32 screenshots in `palette-screens/`.
- One known gap: in Light mode the terracotta fill on the darker surface measures about 2.7:1. Fixing it would mean changing the brand colour itself.

### FastAPI

No broad migration was started. The next-phase plan is in `docs/architecture/fastapi-next-phase.md`:
- **Entry criteria:** R2 live and stable for a week.
- **Proposed work:** one worker image, a variant backfill job, a job-health endpoint, and OCR.
- **What it rules out:** no CRUD, signing or authorization moves into FastAPI, so nothing is implemented twice.

## Validation

| Check | Result |
|---|---|
| Vitest | 3,995 passed |
| Worker tests | 41 passed |
| Backend tests | 74 passed, including a real ffmpeg transcode |
| pgTAP | 5,693 checks passed |
| Permission gate | 626 contracts PASS |
| Isolated Playwright | 5/5 passed, plus the rollback run 1/1 |
| Typecheck / lint | clean; lint has 0 errors |

## Not verified, and why

- **Real R2 and the real Cloudflare edge.** The test sandbox has no network path to R2. After approval, run `frontend/src/server/storage/r2.live.test.ts` against the disposable acceptance buckets.
- **H.264 playback in Chrome or Safari.** The test browser cannot decode H.264, so in-browser playback was verified with VP9 through a local-only test flag. Production encodes H.264. Check one playback on a preview.
- **Lighthouse / Core Web Vitals on hosted pages.** These were not re-measured, because nothing is deployed. The video player loads only its poster until the viewer presses play, and it reserves its aspect ratio, so the page layout does not shift.
