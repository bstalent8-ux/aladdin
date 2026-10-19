# ADR-0020 — Video: R2 originals, HLS transcoding worker, per-request edge authorization

**Status:** Proposed · 2026-10-19 · **Needs owner approval** before any hosted step (migration, R2 CORS rule, Worker route, transcode host). The code ships switched off (`VIDEO_ENABLED=false`, Worker `VIDEO_ROUTES="off"`); with it off nothing changes.

**Builds on:** [ADR-0018](ADR-0018-r2-edge-media-delivery.md) (private R2 + ticketed edge Worker + per-request Postgres decision) and [ADR-0019](ADR-0019-redis-cache-and-rate-limits.md) (Redis as accelerator only).

## Decision

Portfolio and product videos are stored in the **private R2 bucket**, transcoded to **adaptive HLS** by a separate worker, and delivered **only** by the media Worker at `/v/<videoId>/<file>`, with a database decision on **every** playlist, segment and poster request.

```
browser ──multipart PUT (presigned, 8 MiB parts)──▶ R2  video/<id>/original
   ▲                                                   │
   │ app (Vercel): begin / sign parts / complete       │ transcode worker (ffmpeg)
   │ — decides in Postgres, never sees bytes           ▼
   └──────── HLS from the media Worker ◀── R2  video/<id>/<revision>/{master.m3u8, poster.jpg, 360p|720p|1080p/…}
                 (Postgres media_edge_video per request)
```

No video byte passes through Supabase or Vercel.

### Upload
- Limits: 500 MB, 300 s, `video/mp4`, `video/quicktime`, `video/webm`. Quotas in SQL: 10 portfolio videos per person, 2 per product, 3 unfinished uploads per person.
- `video_upload_begin` (caller's JWT, RLS) decides; only then is an R2 multipart upload opened. Part URLs are signed per part number **and exact length** for 10 minutes, at most 8 per request, rate-limited per user (`video-part`, ADR-0019).
- The browser uploads 3 parts at a time with byte progress, retries each part 4 times with backoff on a freshly signed URL, and resumes after a reload: it remembers only the file fingerprint and upload id, and asks the server which parts R2 holds.
- Completion never trusts client ETags: the server lists the parts R2 stored, completes with exactly parts 1..N at their expected lengths, checks the stored size and the container signature, then moves the row to `processing` and pushes a Redis wake-up (optional).
- Unfinished uploads expire after 24 h; the purge aborts them.

### Transcoding (`backend/app/workers/video_transcode.py`)
- Leases a job in SQL (`video_job_claim`, `SKIP LOCKED`, 30 min lease, 3 attempts). Several workers need no coordination.
- ffprobe/ffmpeg run with the demuxer forced by the declared type and `-protocol_whitelist file`, so a crafted container cannot make ffmpeg open a URL or another file. No video stream, longer than 300 s, or unreadable media is rejected without retry.
- Output: HLS fMP4, 4 s segments, 360p/720p/1080p never above the source (rotation-aware), AAC stereo when the source has audio, metadata stripped, plus `poster.jpg`. Written under a fresh `revision`, playlists last, then `video_job_finish`.
- `--purge` is the only path that deletes video bytes: deleted or expired rows → abort multipart, delete `video/<id>/`, mark purged.

### Delivery (`edge/media-worker/src/video.ts`)
- The app mints a **page ticket** (≤ 120 s, viewer + Auth session + workspace). At the master playlist the Worker swaps it for a **play ticket** (4 h) and rewrites every playlist URI to carry it, so a long video keeps playing. A ticket carries no access of its own.
- Every request calls `public.media_edge_video`: owner, product audience (workspace), or a published portfolio video of a listed profile (anonymous, no ticket). Live session check: sign-out refuses the next segment. Delete, unpublish, delisting, suspension and audience changes do the same.
- HTTP Range (206/416), CORS for the app origins only (`VIDEO_ALLOWED_ORIGINS`), playlists ≤ 256 KB with only known relative URIs, `nosniff` + sandbox CSP.
- Edge byte cache keyed by object + immutable revision (segments, init, poster ≤ 20 MB). Authorization is never cached. Browsers get `no-store` for ticketed bytes and `no-cache` for public bytes.
- Player: poster only until the viewer presses play (`preload="none"`), native HLS on Safari/iOS, `hls.js/light` loaded on demand elsewhere, capped to the player size; aspect ratio from stored dimensions (no layout shift).

## R2 + HLS vs Cloudflare Stream

| | R2 + HLS (chosen) | Cloudflare Stream |
|---|---|---|
| Revocation | Every segment is decided in Postgres: immediate | Signed-URL JWT valid until it expires; no per-segment DB check |
| Tenant isolation | Same SQL rules as images (RLS + `media_edge_*`) | Separate access model to keep in sync |
| Storage | $0.015/GB-month (first 10 GB free) | $5 per 1,000 minutes stored / month |
| Delivery | R2 egress free; Worker requests | $1 per 1,000 minutes viewed |
| Encoding | Our worker (ffmpeg) — needs a host | Included |
| Example: 200 videos × 2 min, 2,000 views × 2 min / month | ≈ $0 storage (≈ 20 GB → $0.15); requests within Workers Paid's included 10 M | ≈ $2 stored + $4 delivered ≈ $6/month, plus the Stream subscription |
| Operational cost | Worker host + ffmpeg upkeep | None |

Stream is cheaper to operate but cannot meet "immediate revocation of files and segments" and "same tenant isolation" without a second permission system. R2 + HLS meets both with the authority we already have.

## Deployment dependencies (each needs owner approval)

1. Apply migration `20261019150000_media_videos.sql` to the target project (Supabase stays on Free).
2. R2 bucket **CORS**: allow `PUT` from the app origin(s), headers `content-type`, `content-length`. Lifecycle rule: abort incomplete multipart uploads after 1 day.
3. Media Worker: `VIDEO_ROUTES="on"`, `VIDEO_ALLOWED_ORIGINS="https://<app origin>"` on the `media.aladdindecore.com` route (DNS approval pending, ADR-0018).
4. **Transcode host** with ffmpeg, Python 3.12, `uv sync --group video-worker`, and env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (a token scoped to the private bucket), `R2_PRIVATE_BUCKET`, optional `REDIS_URL`. Run `--loop` (always on) or `--once` on a schedule plus `--purge` hourly. It cannot run on Vercel (no bytes through Vercel, long CPU jobs). Options: a small always-on VM (≈ $4–6/month), Fly.io Machines with scale-to-zero (pay per second of transcoding), or Google Cloud Run jobs. **Paid; not activated.**
5. App env: `VIDEO_ENABLED=true` (requires `R2_STORAGE_ENABLED` and `MEDIA_EDGE_DELIVERY_ENABLED`).

## Verification (2026-10-19, isolated local stack)

`frontend/playwright.video.config.ts` ([guide](../guides/video-local-e2e.md)), desktop and mobile Chromium, S3-compatible stand-in for R2, the Worker's real handler, the real worker: upload in parts, transcode, owner play + seek + Range 206, publish, anonymous play, unpublish refuses the next anonymous segment, delete refuses the owner's next segment, sign-out refuses the owner's play ticket, purge removes every object, no video byte through the app. Measured locally: first frame 0.6–0.8 s after pressing play, seek 50–110 ms, only posters requested before play, about a third of edge requests served from the byte cache, 12 s 720p clip transcoded in about 6 s. Real R2, a real Cloudflare edge and H.264 decoding in a branded browser were **not** exercised (no network path to R2 from the test sandbox; the test browser lacks H.264, so the test encodes VP9 with `--test-codec`, local only).

## Load note

One full view of a 5-minute video is about 80 Worker requests and 80 Postgres decisions (4 s segments). Workers Free allows 100,000 requests/day; Workers Paid ($5/month) includes 10 M/month. The per-request decision is a single indexed function call; it is the price of immediate revocation and is not cached.

## Rejected

- Progressive MP4 through the app proxy: puts bytes through Vercel.
- Short-lived signed R2 URLs per segment: revocation waits for expiry, and playlists would need re-signing per request anyway.
- Caching authorization in Redis or at the edge: stale permission decisions.
