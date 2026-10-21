# Aladdin handoff (2026-10-21)

This file lets a new Claude (in a new project or account) continue the Aladdin work exactly where the previous project stopped. It contains no secrets, tokens or passwords. Read it fully before doing anything, then read the repo's own memory files listed in section 1.

- Repository: https://github.com/hmohamed080/aladdin (owner GitHub login `hmohamed080`)
- Snapshot time: 2026-10-21 ~13:45 UTC. Verify PR and branch state on GitHub before acting; it may have moved.

---

## 1. Read first (inside the repo)

1. `CLAUDE.md`, then root `AGENTS.md` and every scoped `AGENTS.md` (`frontend/`, `backend/`, `supabase/`, `docs/`, `data/`, `UI-UX/`).
2. The five project-memory files: `docs/product/PRODUCT_DIRECTION_GUIDE.md`, `docs/architecture/ARCHITECTURE_GUIDE.md`, `UI-UX/UI_UX_SYSTEM_GUIDE.md`, `docs/operations/AGENT_WORK_LOG.md`, `docs/operations/RUNTIME_STATE.md`.
3. ADRs in `docs/decisions/` (ADR-0019 Redis, ADR-0020 video, ADR-0021 Cloudflare Workers live on the stacked PR branches, not main yet).

Stack: Next.js App Router + TypeScript (pnpm) on Vercel, Supabase (Postgres/Auth/Storage/RLS), a small FastAPI service (uv) for AI/OCR/workers only, Cloudflare R2 for media. Never edit `.pen` design files.

---

## 2. Environments and accounts

| Thing | Value / note |
|---|---|
| Live site | `aladdindecore.com`, one Vercel project `aladdin-staging` (Hobby plan). DNS is on Vercel nameservers. |
| Live database | Supabase **aladdin-staging**, ref `kkpkgjrweysgvhvkhzun` (eu-west-3). Holds real sign-ups. **Read-only queries only** unless the owner approves a write. Always name the project ref when giving the owner SQL. |
| Test database | Supabase **aladdin-r2-acceptance**, ref `nxossqhdfltcqdwvbewi`. Separate copy, no live accounts. Used for the Cloudflare acceptance test. |
| Redis | Existing Upstash Redis `alert-bedbug-148148.upstash.io` (Free). PR #92 uses TCP `rediss://`; `REDIS_URL` not yet set on Vercel. |
| Cloudflare preview creds | GitHub environment `cloudflare-preview` in the repo holds secret `CLOUDFLARE_API_TOKEN` (custom token, Workers Scripts: Edit only), plus variables `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_PREVIEW_ENABLED=true`. Added by the owner on 2026-10-21. |
| Owner's machine | Windows machine "Scorpion", folder `D:\projects\`. Some work lives **only there, uncommitted** (see section 4.1). |
| Test showroom | "وليد للديكور" (org `dfab11cd-…`) on the live DB is the owner's test showroom, verified via a legacy-seller exception and a placeholder address. Revert both if the owner asks. |

Brand palette: `#D8C7A6` `#B96F52` `#F2E9D8` `#071A2D`.

---

## 3. Owner decisions and standing constraints

**Approval required (never do without the owner's explicit OK):**
- Any hosted Supabase write or migration (acceptance first, then live).
- Merging, deploying, or any production change. The owner's last instruction on the integration work: no hosted changes, destructive media purge, commit, push, PR, merge or deployment without approval.
- R2 activation, R2 CORS/lifecycle rules, DNS changes (`media.aladdindecore.com`, and later the frontend DNS move to Cloudflare).
- Anything paid: Workers Paid ($5/month), a transcode host for video, any plan upgrade.
- The historical media deletion in production (irreversible).

**Fixed decisions:**
- **Supabase stays on the Free plan.** No paid services without approval.
- Historical Supabase portfolio photos and avatars are **deleted, not migrated** (167 portfolio rows / 248 MB, 148 avatar rows / 8.2 MB; inventory in `showroom-admin/media-deletion/`). Products and logos stay private.
- **No video or image size caps.** Product videos share the existing 3-item gallery limit with photos. Portfolio has no video count limit.
- No autoplay; muted hover preview on desktop, tap on mobile.
- Cloudflare Stream later, behind `media_videos.provider`; not now.
- Upstash Free is the recommended managed Redis.
- Frontend may move to Cloudflare Workers (PR #97), **with Vercel kept live as the rollback**. Production is NO-GO until approved.
- Acceptance DB: owner chose **Rebuild** (2026-10-20), run by the owner on their machine.
- Integration work: **PR #88's secondary-phone implementation wins** over the rehearsal's competing one (full rules in section 4.1).

---

## 4. Current progress

### 4.1 Approved-features integration (most active, on the owner's machine)

- Branch `integration/approved-features-20261019` in `D:\projects\aladdin-wt-approved-integration` on the owner's Windows machine. **Nothing committed or pushed.** Original dirty worktrees and snapshots at `D:\projects\_claude-integration-snapshot-20261019` must be preserved.
- Base: PR #97 tip (which already contains #88, #89, #91, #92, #94), with `origin/main` (`a9723a01`, includes PR #96) merged into the working tree but not committed. #93 and #95 are **not** included.
- Owner's integration rules (2026-10-21): keep PR #88's `secondary_phone_reservations`, 7+7-day reservation, 30-day cooldown, password confirmation and Admin override; do not import the rehearsal's phone tables/cooldown/RPCs; selectively port the rehearsal-only features (Installer primary-phone change journal and recovery, journal-aware guards, auth alias/email protections, contact-email claims backend, Installer security actions, reviews paging); one password-confirmation budget; reconcile migrations with no duplicates or lost audit actions.
- Done (verified on an isolated local stack, ports 655xx):
  - Fixed PR #96 vs PR #88 migration clash (edited `20261020090001`, added `20261021090000`). **Open question to the owner:** has `20261020090001` already been applied to staging or production? If yes, switch to a forward-only fix.
  - New migrations `20261021090001`–`20261021090005` (password-confirm actions, phone journal, alias guard, contact emails).
  - Installer Settings `/home/settings` on the approved design: name, username, journaled phone change, password change, contact email via Resend link + Confirm, PR #88 second phone.
  - Reviews, Points, Points history, Network, Refer pages on approved designs with real data; Cover photo pipeline and profile pages.
  - Tests: pgTAP 137 files / 6227 pass (436 new), phone-change concurrency 28/28, typecheck clean, lint 0 errors.
- In progress at handoff: Portfolio projects database layer (15 projects × 6 media each), then the projects editor with drag-and-drop.
- Left out on purpose (not built in the platform; ask the owner if approved): other ways to earn points besides an approved referral (+100), a rewards catalog/redeeming, business ratings and phone numbers in the network list.
- Before contact email works on a hosted environment: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_PUBLIC_ORIGIN` must be set there.
- Report: `/mnt/project-files/BATCH-0-1-REPORT.md` in the old project (summary above). **The new account cannot see the old project's files or the owner's local worktree unless the owner shares them.** Ask the owner to commit/push this branch or copy the folder if the new Claude should continue it.

### 4.2 Cloudflare Workers frontend (PR #97)

- Next.js frontend builds and runs on Workers via OpenNext 1.20.12 (Next 15.5.28). ADR-0021, cutover and rollback plan written. Workers build fails no test that the Node build passes (the same 51 E2E failures happen on both: stale tests or Turnstile unreachable).
- Workers needs **Workers Paid** ($5/month): pages use 15–77 ms CPU, Free allows 10 ms.
- 2026-10-21: the first workers.dev preview deploy (GitHub workflow, `cloudflare-preview` environment) **failed at build** because Next.js 15 reached end of support on 2026-10-21 and the Cloudflare build tool now requires an explicit "unsupported version" flag. **Pending owner decision:** allow the flag for the preview only / upgrade to Next 16 first / both (recommended: both — preview on 15 now, Next 16 as a separate PR before any cutover).

### 4.3 Cloudflare acceptance test (real R2 + media Worker + Hyperdrive)

- Owner approved an isolated test on `aladdin-r2-acceptance` only, with backup first, least-privilege creds and GO/NO-GO per stage.
- Preflight was NO-GO: acceptance had pre-RC2 media migrations that the branch later rewrote. Fix chosen: **Rebuild**.
- **Waiting on the owner** to run `showroom-admin/acceptance-rebuild/rebuild-acceptance.sh` on their machine (Docker + `supabase login`; pg_dump backup to `~/aladdin-acceptance-backup-20261020`, then `db reset --linked --no-seed` at PR #94 head `6894245`, 179 migrations, no seed).
- After the rebuild: compare `schema-fingerprint.sql` with `local-noseed-fingerprint.txt`, run Supabase advisors, create the `media_edge_worker` role (scripts in `showroom-admin/media-edge-worker-role/`), delete 3 orphan test auth users (kept in backup), then the owner creates Hyperdrive (use the **Session pooler on 5432**, never 6543; the Free direct host is IPv6-only) and sends only the Hyperdrive config ID. Then deploy the test Worker and report GO/NO-GO.
- Never seed a hosted project: repo seeds contain demo admin accounts with repo passwords.

### 4.4 Release readiness (2026-10-19 report)

Verdict was NO-GO for production until: the real Cloudflare test, real Safari/H.264 playback, migrations on the isolated project, and the paid choices. Local evidence: frontend 4023 unit tests pass, backend 92 pytest pass, pgTAP suites pass, video/R2 E2E 7/7 desktop+mobile, mobile LCP on Landing 3.38 s → 2.15 s.

---

## 5. Open pull requests and merge order

All are open; none merged. Merge order for the stack (each contains the previous one; retarget the next to `main` after each merge so it gets full CI):

| Order | PR | Branch | Content | State |
|---|---|---|---|---|
| 1 | [#88](https://github.com/hmohamed080/aladdin/pull/88) | `claude/showroom-v2-admin-verification-vdrldz` | Business verification, Admin users/staff, Offers, secondary phone reservations | Ready for review, CI green |
| 2 | [#89](https://github.com/hmohamed080/aladdin/pull/89) | `claude/r2-rc2-integration-vdrldz` | Cloudflare R2 private media (RC2) | Draft |
| 3 | [#91](https://github.com/hmohamed080/aladdin/pull/91) | `claude/media-backend-continuation-2ibvgs` | Historical media purge tool, session revocation, backend JWT auth + prod config, Worker edge cache, perf, `regions: ["cdg1"]` | Draft |
| 4 | [#92](https://github.com/hmohamed080/aladdin/pull/92) | `claude/redis-cache-2ibvgs` | Optional Redis (ADR-0019): reference cache, rate limits, job locks | Draft |
| 5 | [#94](https://github.com/hmohamed080/aladdin/pull/94) | `claude/video-r2-2ibvgs` | Video on R2 + HLS with per-segment revocation (ADR-0020), Landing LCP fix | Draft, head `6894245` |
| 6 | [#97](https://github.com/hmohamed080/aladdin/pull/97) | `claude/cloudflare-workers-2ibvgs` | Frontend on Cloudflare Workers (ADR-0021), Vercel kept as rollback | Draft, NO-GO for production |

Independent PRs off `main` (merge any time, CI green):
- [#93](https://github.com/hmohamed080/aladdin/pull/93) `claude/brand-palette-2ibvgs`: enforce the four-colour palette (contrast fixes, colours unchanged).
- [#95](https://github.com/hmohamed080/aladdin/pull/95) `claude/hydration-418-2ibvgs`: pin display time zone, React #418 fix (a rare ~0.5% HTML mismatch, mostly `/admin`, still open).

Migration ordering note: the video migration is `20261019170000`, after the revocation migration `20261019163000`. Recently merged to main: #90 (email/password auth), #96 (registration data sync, migration `20261020090001`).

All flags stay off until approved: `VIDEO_ENABLED`, `MEDIA_EDGE_DELIVERY_ENABLED`, `R2_STORAGE_ENABLED`, `REDIS_URL` unset. Flags off = current behaviour, no deploy needed for rollback.

---

## 6. Unfinished tasks and what each waits on

| # | Task | Waiting on |
|---|---|---|
| 1 | Finish integration batch: Portfolio 15×6 database layer, projects editor with drag-and-drop, full pgTAP/vitest/browser regressions, then Showroom, Marketplace, Admin batches, final QA and decision matrix | Agent work on the owner's machine; owner must commit/push or share the worktree for a new account to continue |
| 2 | Answer: was migration `20261020090001` (PR #96) applied to staging/production? | Owner |
| 3 | Approve or decline points/rewards/network extras that the mockups show but the platform lacks | Owner |
| 4 | Workers preview deploy | Owner's decision on the Next.js 15 unsupported-version flag vs Next 16 upgrade |
| 5 | Next.js 16 upgrade PR (required before any production cutover to Workers) | Decision in #4 |
| 6 | Acceptance DB rebuild | Owner runs `rebuild-acceptance.sh` locally |
| 7 | Post-rebuild verification, `media_edge_worker` role, Hyperdrive, test Worker, real R2 GO/NO-GO | #6, then owner creates Hyperdrive + role password; R2 bucket-scoped keys and Supabase secret key as env vars |
| 8 | Full E2E on the workers.dev preview against the acceptance DB | #4 and #6 |
| 9 | Review and merge the PR stack in order (#88 → #89 → #91 → #92 → #94 → #97) plus #93, #95 | Owner review/approval |
| 10 | Apply migrations to acceptance, then to live `kkpkgjrweysgvhvkhzun` | Owner approval |
| 11 | R2 CORS rule (PUT from app origins) and lifecycle rule (abort multipart after 7 days) | Owner approval |
| 12 | Set Vercel env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (backend health 503 until set), `REDIS_URL`, R2/edge vars, `VIDEO_ENABLED` last; Resend vars for contact email | Owner |
| 13 | Choose a paid transcode host (≈ $5–10/month VM) before video launch | Owner |
| 14 | Workers Paid ($5/month) for frontend on Workers and for video traffic past the free cap | Owner |
| 15 | DNS: `media.aladdindecore.com`, later the frontend move to Cloudflare | Owner approval, after the tests |
| 16 | Run historical media deletion in production from the dry-run inventory (`--confirm-project`, irreversible) | Owner approval |
| 17 | Real Safari/WebKit + H.264 playback test | A machine with Safari/H.264 (not available in the cloud sandbox) |
| 18 | Remaining React #418 HTML mismatch (~0.5% of loads, mostly `/admin`) | Investigation |
| 19 | Owner choices from the readiness report: palette outline look, auto-resize of verification documents (10 MiB limit today), due-date time-zone fix (changes storage) | Owner |
| 20 | Known defect from earlier work: B2B dashboard render cost (seven queries, ~30 prefetched links) makes period/stage filters feel unresponsive | Its own performance pass |

---

## 7. Practical gotchas (save hours)

- Cloud sandbox: Turnstile is unreachable, so run Playwright with `E2E_STUB_TURNSTILE=1`; sign-up specs can't pass there. Chromium is at `/opt/pw-browsers/...`; it lacks H.264, so video E2E uses the worker's `--test-codec vp9` (local only). Isolated video E2E: `frontend/playwright.video.config.ts` + SeaweedFS (`docs/guides/video-local-e2e.md`).
- Supabase CLI in the sandbox needs `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` and `start -x edge-runtime,logflare,vector,studio,supavisor,imgproxy`. `dockerd` can be started with `nohup dockerd &`; Docker Hub may rate-limit.
- The sandbox cannot open raw Postgres TCP; `workers.dev` and `*.r2.cloudflarestorage.com` may be blocked by network policy. Upstash is reachable only over HTTPS REST.
- Workers gotchas: `fetch` with `redirect: "error"` throws (use `"manual"`); workerd ICU adds U+200F to Arabic compact currency; build through the Playwright Workers config (or export `NEXT_PUBLIC_*` first) or the bundle can't reach Supabase; kill stray wrangler/workerd/esbuild by PID (they leak and caused OOM).
- Never `pkill -f` a pattern that appears in your own shell command line.
- Lazy-loading i18n catalogs with Suspense broke the admin users filter E2E; don't retry it.
- Showroom approval flow on the DB: owner submits (`organization_application_submit`), then a platform admin runs `review_start` → `review_approve` → `apply_organization_verification`; showrooms need a complete profile (address, phone, activity).
- Writes to the live DB through a Supabase connector were blocked by safety checks before; the owner runs write SQL in the SQL editor.

## 8. Reference files

Copies of the key reports and scripts are committed next to this file in [`reference/`](reference/): the readiness and GO/NO-GO reports, the acceptance test plan, the batch 0-1 integration report, `acceptance-rebuild/` and `media-edge-worker-role/`. The deletion inventory CSV and screenshots stayed in the old project's shared folder. Original list:
`release-readiness-2026-10-19.md`, `media-backend-go-no-go-2026-10-19.md`, `r2-redis-video-report-2026-10-19.md`, `acceptance-cloudflare-test-2026-10-20.md`, `acceptance-rebuild/` (script + fingerprints), `media-edge-worker-role/` (role SQL + README), `media-deletion/` (inventory CSV), E2E and palette screenshots. `BATCH-0-1-REPORT.md` is at the folder root.
