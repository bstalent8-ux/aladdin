# Media, backend, security and performance: GO/NO-GO report (2026-10-19)

## Verdict

**GO for review. NO-GO for merge, deploy or any hosted step until you approve each one (listed under "Approvals needed").** Nothing hosted was changed. No migration was applied, nothing was deployed or merged, and no DNS, billing or R2 setting was touched. All feature flags stay off.

## Pull requests

| PR | State | What it carries |
|---|---|---|
| [#88](https://github.com/hmohamed080/aladdin/pull/88) | open, unchanged | Business verification, Offers, Admin, phone reservations (4 migrations, not applied anywhere) |
| [#89](https://github.com/hmohamed080/aladdin/pull/89) | draft, unchanged | R2 storage and the edge Worker (6 migrations) |
| [#91](https://github.com/hmohamed080/aladdin/pull/91) | **new draft**, base #89 | This work. Its first commit merges #88's three newest commits into #89's line, so the two no longer diverge. |
| #90 | merged | Its legal pages and localization are on `main` and untouched. |

I did not push the #88→#89 merge onto PR #89's own branch, because that branch isn't mine to push to. #91 carries the merge instead. If you'd rather #89 carry it, say so and I'll push it there.

Suggested merge order, after approval: #88 → #89 → #91.

## Architecture findings

- **The existing backend was a scaffold.**
  - FastAPI had one route (`/api/backend/health`) and no authentication, and nothing in the frontend called it.
  - It's live at `aladdindecore.com/api/backend/health` and reports `env: "local"`, because `APP_ENV` isn't set in Production. That means its startup secret check is skipped. **I left this alone:** setting it is a Production config change for you to approve.
- **What I added to the backend:**
  - Local token verification, which checks the Supabase JWT against the project's published keys with no Auth round trip.
  - A guard that refuses suspended accounts and ended sessions.
  - The backend is now where media jobs live.
- **Division of responsibilities:**

  | Component | Role |
  |---|---|
  | Supabase | Authority and auth |
  | Next.js | Pages, CRUD, upload authorization and media tickets |
  | FastAPI | Jobs and integrations |
  | Worker | Bytes, with a database check on every request |
  | R2 | Private bytes |

  Full table, costs, failure handling and rollback: ADR-0018 Revision 2 (`docs/decisions/ADR-0018-r2-edge-media-delivery.md`).
- **Products and logos stay private.** Marketplace rules have no guest catalog. Guests see only published portfolio items and listed professionals' avatars, as conditional-public media that is withdrawn on the next request.
- **`media.aladdindecore.com` is feasible for free.** Your DNS is on Vercel, and a plain Worker route needs a Cloudflare zone. The two free options:
  - **B (recommended):** a Cloudflare Pages project plus one `CNAME media → aladdin-media.pages.dev` record in Vercel DNS.
  - **A:** move the domain's nameservers to a Cloudflare Free zone.

  The template and steps are in `edge/media-worker/README.md`.

## What changed (PR #91)

1. **Historical photos and avatars are deleted, not migrated.**
   - A migration and a backend job do it in steps: hide and unlink, remove through the Storage API, have the database confirm each object is gone, then delete the rows.
   - It is resumable, dry-run by default, and must be told the project name before it will execute.
   - Certificates, verification documents, products, organization images, accounts and profiles are never selected.
   - Users see an empty portfolio or the initials avatar and upload again.
2. **Sessions.**
   - A signed-out, banned or deleted session is now refused on its **next** Data API request. Before, it kept working for up to an hour, until the token expired.
   - The app sends that browser to Sign In, and the backend applies the same rule.
   - Tested through the real local API: local sign-out, global sign-out, ban and delete each turned 200 into 403, while another live session kept working.
3. **Worker.**
   - It now keeps a content-addressed edge cache of bytes, consulted only after the per-request database check.
   - Revocation still applies on the next request. Tested in the real Workers runtime locally.
4. **Performance.**
   - **Region:** Vercel functions move to Paris (`cdg1`), next to the database. They ran in US East, so every server-side query crossed the Atlantic. The live effect shows only after a deploy.
   - **Staff-access rules:** twenty of these rules re-ran a role lookup on every row. The worst read measured **260 ms on staging**, and the same read went from **212 ms to 0.75 ms locally**.
   - **Landing page:** a 1.46 MB image was used for 92 px icons and is now a 40 kB WebP.

## Performance baseline and results (local production build)

| Page | Before | After |
|---|---|---|
| `/` mobile | Perf 68, LCP 12.5 s, 2.1 MB | Perf 75–85, LCP 4.1–5.3 s, 0.72 MB |
| `/` desktop | Perf 88, LCP 2.3 s | Perf 99, LCP 0.9 s |
| `/auth/sign-in` mobile / desktop | 89 / 99 | unchanged |
| `/auth/sign-up` mobile / desktop | 86 / 100 | unchanged |
| `/legal/terms` mobile / desktop | 86 / 100 | unchanged |

- CLS was 0.02 or below everywhere, and accessibility scored 96–100.
- Shared first-load JS is 103 kB; the median route ships 272 kB.

**Left as findings:**
- **Both language catalogs (~140 kB gzipped) ship on every page.** I tried loading only the active language. It cut the median first-load JS to 131 kB, but broke the admin users filter in browser tests, so I removed it. The safer fix is a per-language route segment, which needs its own PR.
- **Mobile LCP on `/` is still about 4–5 s.** Most of it is render delay on the hero under throttled CPU.
- **Authenticated pages were not run through Lighthouse.** Sign-in needs Turnstile, which this sandbox can't reach.
- **React #418** (intermittent, seen in earlier route sweeps) did not appear in 36 production loads here. It is still open.

## Brand palette audit (#071A2D, #D8C7A6, #F2E9D8, #B96F52)

- **Uses the palette fully:** the Showroom V2 shell and the installer surfaces (`src/styles/installer-theme.css`).
- **Does not use it:** the landing page, auth, `/b2b`, admin, home, settings, onboarding and legal pages. They use the older Aperture tokens in `src/styles/tokens.css`, which define 89 off-palette colors. The literal colors are centralized there, so a fix is a token remap rather than a hunt through components.
- **Kept separate as semantic colors:** success (verdigris), warning (ochre), danger (oxide) and info/accent (lapis, iris). Product finish swatches in `color-library.ts` are data, not brand.
- **Not changed.** The remap would visibly restyle every page, so it needs design sign-off and its own PR.

## Redis and video

- **Redis: not needed now.** Authorization must not be cached, and bytes are cached at the edge. If rate limiting is ever needed, use Upstash's free tier for counters only.
- **Video: not now.** When it is needed, use **Cloudflare Stream**. It is billable at about $5 per 1,000 minutes stored per month and $1 per 1,000 minutes delivered, with encoding included. Building HLS on R2 yourself only pays off at high volume.

## Costs

| Service | Plan | Change |
|---|---|---|
| Supabase | Free, kept | Image egress leaves Supabase. Purging frees about 268 MB of Storage. |
| Vercel | Hobby | Region change is allowed and free. |
| R2 | Free tier | 10 GB, 1M writes and 10M reads a month; egress is free. |
| Worker + Hyperdrive | Free | Fine for testing. **Workers Paid at $5/month is recommended for Production** (needs your approval). |
| Stream, Redis | none | none |

Measured on 2026-10-18: staging had used 4.71 of 5 GB of Supabase egress this cycle.

## Approvals needed, in this order

1. **Merge** #88, then #89, then #91.
2. **Hosted migrations on staging:** #88's 4, #89's 6, and #91's 3.
   - The session-revocation migration changes the pre-request hook. Rollback steps are in ADR-0018.
3. **Vercel deploy** with the `cdg1` region.
4. **R2 activation:**
   - private bucket and lifecycle rule;
   - `R2_*` variables;
   - `R2_STORAGE_ENABLED=true`, and in Production `R2_PRODUCTION_WRITES_APPROVED=true`.
5. **Worker:**
   - Pages project (Option B) and Hyperdrive with caching off;
   - the `media_edge_worker` database login;
   - the `TICKET_KEYS` secret;
   - `MEDIA_EDGE_*` variables, then `MEDIA_EDGE_DELIVERY_ENABLED=true`.
6. **DNS:** one CNAME record in Vercel DNS.
7. **Billing:** Workers Paid, $5/month.
8. **Production deletion.**
   - Do this only after step 4. The cutoff is the R2 activation time.
   - First a dry run: `uv run python -m app.workers.historical_media_purge --cutoff <time>`.
   - Then the real run: `--execute --confirm-project kkpkgjrweysgvhvkhzun --journal purge.jsonl`.
   - **This cannot be undone once Storage objects are removed.** Take a Storage backup first if in doubt.
9. **Optional:** set `APP_ENV` for the backend in Production.

## Blockers and limits of this run

- **Create Account and Forgot Password E2E can't run here.** Cloudflare Siteverify is unreachable from this sandbox. Sign-in tests ran with the documented Turnstile stub.
- **Not run:** mobile Playwright and the full 42-spec suite. Earlier runs had shared, already-known failures from stale selectors.
- **Staging is possibly the live site.** I only read from it: `pg_stat_statements`, advisors and the role config.
