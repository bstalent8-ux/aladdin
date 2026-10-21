# Media, video, Redis and performance — release readiness (2026-10-19)

**Verdict: NO-GO for Production today.** The code is ready for review. Production needs four things first: a real Cloudflare test (your approval card is waiting), real Safari/H.264 playback, the migrations applied to the isolated Supabase project, and the paid choices below. Nothing was deployed, merged, deleted or billed.

## 1. Pull requests (merge order, nothing merged)

| Order | PR | Branch head | What it carries | CI |
|---|---|---|---|---|
| 1 | #88 | `14ceaec` | Showroom V2, admin verification, offers | Green (full CI) |
| 2 | #89 | `6880afa` | R2 media integration | Previews only (stacked) |
| 3 | #91 | `4a8c81b` | Historical image purge tool, session revocation (Storage, Realtime, leads), backend production config, Worker edge cache | Previews only (stacked) |
| 4 | #92 | `a9c3b43` | Redis/Upstash: fail-safe limits, monitoring, reference cache. #91 merged in | Previews only (stacked) |
| 5 | #94 | `6894245` | Video (R2 + HLS), no size/length caps, mixed photo/video galleries, hover player, Stream-ready seam, uncapped image uploads, Landing LCP fix, perf harness. #92 merged in | Previews only (stacked) |
| — | #93 | `c0ec245` | Palette contrast without exceptions (palette unchanged) | Green (full CI) |
| — | #95 (new, draft) | `3d8e0f4` | React #418 date/time-zone fix | Green (full CI) |

- Each PR in 2–5 contains the previous one, so merging in order keeps every diff reviewable. Full CI only runs on PRs into `main`, so #89–#94 get their full run as each one is retargeted to `main` after the one before merges.
- Migration order was fixed during the stack merge: the video migration is now `20261019170000`, after the revocation migration `20261019163000`. Its permission contract was regenerated on a replay of every migration (gate: PASS, 632 exact contracts).

## 2. What you asked for, and where it stands

| Ask | Status |
|---|---|
| No video caps (500 MB, 5 min removed) | Done. The only ceiling is R2's 5 TiB object limit. Part size grows with the file, so nothing exceeds 10,000 parts |
| No image size caps | Done. The browser always prepares a version that fits the server's existing caps, so large originals are never refused and never pass through Vercel |
| Existing count quotas only | Done. Product: 3 photos **and videos** together (your "shared limit"). Portfolio: no video count limit. 10 unfinished uploads at a time, as for images |
| Resumable multipart, retries, progress | Done. Resume after reload skips finished parts. The upload waits for the network instead of failing while offline. Completion re-checks every part's length on the server |
| Mixed and reorderable gallery, video first allowed | Done for portfolio and product galleries. The main photo on product cards stays the first photo |
| No autoplay; hover preview on desktop; tap on mobile | Done. Muted low-quality preview after 300 ms of hover that stops on leave. Click plays from the start with sound. Touch and reduced-motion users get no preview |
| Revocation and server-side authorization | Kept. Every segment is decided in Postgres. Stale play tickets are refreshed through a route that re-checks access |
| Stream later, not now | Provider seam in place (`provider` column plus one server module). Stream is not activated |
| Existing Upstash, free tier | Configuration and guide ready. `REDIS_URL` still has to be set by you |
| Session revocation and backend config blockers | Fixed in #91 |
| React #418 | Main cause fixed (#95): 34 → 0 text mismatches. A rare HTML-mismatch (≈0.5% of loads, mostly `/admin`) remains and is still being investigated |
| Palette contrast | Fixed in #93 with the four colours unchanged |
| Historical deletion inventory | Done, read-only: [media-deletion/README.md](media-deletion/README.md) and its CSV |
| FastAPI next phase | Prepared, not started, as you asked. The backend stays the AI/OCR/worker service. Its video worker and purge job reuse the same SQL functions, so no logic is duplicated |

## 3. Test evidence (local, isolated)

- **Frontend unit tests:** 4,023 passed, 38 skipped. Typecheck is clean and lint has 0 errors. A few timing tests fail only when the machine is loaded and pass alone.
- **Backend:** 92 pytest passed, 3 skipped. Ruff is clean.
- **Database (pgTAP)**, each file in its own session:
  - video 120/120;
  - revocation 23/23 and 13/13;
  - historical purge 51/51;
  - storage, verification and admin suites all pass;
  - media-edge 78/79. Its one failure is an extension left on the shared local database, not a code problem.
- **Browser E2E** (real Chromium, an S3 stand-in, the Worker's real handler, the real ffmpeg worker), desktop and mobile, 7/7 pass. Covered:
  - R2 photo upload, edge retrieval and deletion;
  - video upload in parts, transcode, play, seek, Range requests;
  - publish, then anonymous play;
  - unpublish, sign-out and delete each refuse the next segment;
  - purge removes every object;
  - no video byte passes through the app;
  - a 24 MP / >10 MB photo is accepted and resized;
  - a video can be moved before a photo, and the public page shows that order;
  - desktop hover previews muted and stops on leave; mobile never previews.
- **Performance (mobile, median of 5, before → after):** Landing LCP 3.38 s → **2.15 s** (en) and 2.18 s (ar). Every measured page now meets LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1; CLS was 0 everywhere. Signed-in pages respond 2–4× faster on the server (for example `/home` 376 → 83 ms). Full tables: `docs/operations/performance-2026-10-19.md` on #94.
- **Segment authorization load test:** about 1,050–1,250 checks/s for product videos locally, p95 10–50 ms at 5–20 connections, with no errors.
- **Not tested yet:**
  - real R2, Worker and Hyperdrive (waiting on your approval);
  - Safari/WebKit and H.264 (only Chromium is available here, and it lacks H.264);
  - a live Upstash connection;
  - migrations on a hosted Supabase project.

## 4. Free-tier limits and realistic monthly costs (estimates)

| Service | Free allowance | When it runs out | Cost after |
|---|---|---|---|
| Supabase | Free plan (stays on Free) | Database and egress limits; the segment checks are the main new load. Estimated ~550–1,250 concurrent video viewers (unmeasured on Free hardware) | No upgrade planned |
| R2 storage | 10 GB-month; operations 1 M writes / 10 M reads per month; egress free | Video originals plus renditions take ≈ 1.6 × the original size | ≈ $0.015/GB-month |
| Workers (media edge) | 100,000 requests/day | ≈ 1,250 five-minute video views a day (4 s segments) | Workers Paid $5/month includes 10 M requests |
| Hyperdrive | 100,000 queries/day on Free | Same point as Workers | Included with Workers Paid |
| Upstash Redis | 500,000 commands/month | ≈ 1,500 page views/day while images still go through the app; far later with edge delivery | Pay-as-you-go ≈ $0.20 per 100 K commands |
| Video processing | none | Needed before any video goes live | Small VM ≈ $5–10/month, or per-second machines ≈ $0.02–0.05 per hour of video |
| Cloudflare Stream (later) | none | — | ≈ $5 per 1,000 min stored + $1 per 1,000 min watched |

**Realistic month:** about $0 today. About $10–20 a month once video launches (Workers Paid plus a small transcode host), with R2 and Upstash staying near free at early traffic. Monitoring is built in: Redis command counters with 50%/80% budget warnings, media usage reports, and `/api/health` counters.

## 5. Infrastructure setup still needed (each needs your approval)

1. Apply migrations on the isolated `aladdin-r2-acceptance` project first, then on the live project.
2. R2: a CORS rule (PUT from the app origins) and a lifecycle rule that aborts unfinished multipart uploads after 7 days.
3. The media Worker on `workers.dev` for the test. `media.aladdindecore.com` later needs a DNS change, which needs your approval.
4. A Hyperdrive config for the Worker's database role.
5. Vercel environment variables:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (backend health returns 503 until these are set);
   - `REDIS_URL`;
   - the R2 and edge variables;
   - `VIDEO_ENABLED` last.
6. A transcode host (paid; not chosen).

## 6. Rollback

- **Feature flags off** (`VIDEO_ENABLED`, `MEDIA_EDGE_DELIVERY_ENABLED`, `R2_STORAGE_ENABLED`, `REDIS_URL` unset) brings back the current behaviour without a deploy. Redis being down never changes access: limits fall back to in-memory counters.
- **Migrations only add things**, and the video tables are unused while video is off. Reverting a PR before its migration runs needs nothing else.
- **The historical image deletion cannot be undone.** It runs only after you approve it in Production, from the dry-run inventory, and takes `--confirm-project`.

## 7. Decisions only you can make

1. The real Cloudflare test on the isolated acceptance setup (card in the thread).
2. When to apply migrations to the live project, and when to run the historical deletion (167 portfolio rows / 248 MB, 148 avatar rows / 8.2 MB).
3. A transcode host before video launch, and Workers Paid ($5/month) once video traffic passes the free daily cap.
4. Set `REDIS_URL` from your existing Upstash database.
5. The palette look: thin navy outlines on terracotta fills in light mode, and slightly darker terracotta text.
6. Whether photographed business-verification documents should also be resized automatically (they keep their 10 MiB limit today).
7. The follow-up due-date time-zone fix: it changes how those dates are stored.
