# Isolated Cloudflare acceptance test, 2026-10-20

Target: Supabase `aladdin-r2-acceptance-20261011` (ref `nxossqhdfltcqdwvbewi`, eu-west-1, Free org), R2 buckets `aladdin-r2-acceptance-20261011-private` / `-public`.
Code: PR #94 head `claude/video-r2-2ibvgs` @ `6894245` (contains #88, #89, #91, #92).
Nothing has been written to any hosted system yet. Staging/Production were not touched (a read-only look at staging's migration list was refused by the session's safety gate, as intended).

## Stage status

| Stage | Result | Status |
|---|---|---|
| 0. Target identity | Ref `nxossqhdfltcqdwvbewi`, name `aladdin-r2-acceptance-20261011`, 3 auth users, 2 orgs, 0 Storage objects, 28 MB. Cloudflare: only the two acceptance buckets; 0 Workers; 0 Hyperdrive configs. | **GO** |
| 1a. Migration preflight on acceptance | History has drifted from the branch (below). Applying the pending set would fail at the first RC2 media migration. | **NO-GO (stopped, nothing applied)** |
| 1b. Branch migrations, local replay | All 179 migrations apply cleanly from scratch on local Supabase (Postgres 17.6); pgTAP `supabase test db`: **129 files, 5,746 tests, PASS** (incl. `99_media_edge_authorization_test.sql`). Local simulation, not the provider. | **GO** |
| 1c. Backup | Not taken yet; waits on the remediation choice. Free plan has no platform backups, so the backup will be a logical export (all rows of `public`, `app`, `auth`, `storage.buckets`, `supabase_migrations`) plus a restore script, kept outside the shared folder because it holds test-account password hashes. | Pending |
| 2. Credentials | Plan below. None provided yet. | Pending owner |
| 2b. Media Worker DB role | Scripts and setup in `media-edge-worker-role/`. Local: privilege audit ok (only `pg_net`, which is local-only and absent on acceptance), 15/15 data and DDL probes denied, live authority test (allow, then deny after sign-out/unpublish/delete) passes with the hardened role. Hosted creation waits on the migrations. | **GO locally**, hosted pending |
| 3. Worker + Hyperdrive | Blocked on stage 2 and the network allowlist. | Blocked |
| 4. Real-provider verification | Blocked on stage 3. | Blocked |
| 5. Frontend to Workers | Running in the thread "Continue media and backend PRs" (audit done, first workerd build in progress). | In progress there |

## Stage 1a finding: acceptance history drift

The "75 pending" count was wrong. Compared by version:

- Acceptance has 4 migrations the branch does not: `20261011104740_verified_media_storage_providers`, `20261012083738_reconcile_application_anon_function_grants`, `20261012144320_restrict_public_function_creator_defaults`, `20261013094153_private_media_application_delivery` (the pre-RC2 R2 acceptance work from 2026-10-11..13).
- The branch carries their RC2 rewrites under new versions `20261018100000..100003`, which are not idempotent: `20261018100000_rc2_verified_media_storage.sql:3` does `create table public.media_storage_locations` and `:184` `create trigger portfolio_verified_before_ready`; both already exist on acceptance (checked). `100003` creates policy `revocable_media_backend_reads`, which also exists.
- Acceptance lacks 3 older branch migrations that sort *before* its latest applied version: `20261011090001_expand_egypt_place_catalogue`, `20261011090002_business_legal_name_primary_branch_location`, `20261011090003_referral_organization_legal_name_and_branch_location` (`organizations.legal_name` and `app.normalize_business_location` are absent).
- True pending set: **78** branch migrations, 14 of them contain `ALTER TYPE ... ADD VALUE` (each must commit before use; the CLI handles this per file).

## Remediation options (owner decision)

1. **Rebuild (recommended).** Back up, wipe the acceptance app schemas and auth users, then replay all 179 branch migrations in order with their real versions recorded, exactly as validated locally, and re-run the security advisors and API-level tests. Loses the 3 test accounts (kept in the backup). Result matches what a fresh environment runs.
2. **Bridge.** Back up, then an acceptance-only SQL step that removes the pre-RC2 media objects before applying the 78. Keeps the 3 accounts, but tests SQL that no other environment will ever run.
3. **Stop.** Leave acceptance as it is.

## Stage 2: least-privilege credential plan

Facts that shape it (checked from this environment): `api.cloudflare.com` is reachable; `*.workers.dev` and `*.r2.cloudflarestorage.com` are **denied by the network policy**; raw TCP to Postgres is not possible through the proxy, so a database URL here would be useless anyway.

| What | Who creates it | Exact scope | Where it lives | Agent sees the secret? |
|---|---|---|---|---|
| Cloudflare API token | Owner: My Profile → API Tokens → Create Custom Token | Account resources: *Include → only this account*. Permissions: **Account · Workers Scripts · Edit**, **Account · Hyperdrive · Read**, **Account · Workers Tail · Read**. No Zone, DNS, R2 Storage, Billing or Members permissions. TTL end 2026-10-23. | **Network secret** for host `api.cloudflare.com`, injected as `Authorization: Bearer <token>`. Plus env var `CLOUDFLARE_ACCOUNT_ID` (not secret). | **No** (proxy injects it) |
| Hyperdrive config | Owner: Dashboard → Storage & Databases → Hyperdrive → Create | Name `aladdin-media-edge-acceptance`; Supabase acceptance *Session pooler* host, port 5432, user `media_edge_worker.nxossqhdfltcqdwvbewi`; **caching disabled**. | Cloudflare only. Owner shares the config **ID** (not secret). | **No** |
| `media_edge_worker` DB password | Owner, after migrations; I create the role without a password | Login role that inherits only `media_edge` (EXECUTE on two functions, no table grants), 20 connections, 3 s statement timeout. Set with `psql` `\password media_edge_worker` from your machine (keeps it out of SQL-editor history). | Password manager + Hyperdrive. | **No** |
| R2 S3 key pair | Owner: R2 → Manage API tokens → Create Account API token | **Object Read & Write**, *Apply to specific buckets only* → the two acceptance buckets. TTL 3 days. | **Environment variables** `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. A network secret cannot work: S3 requests are SigV4-signed with the secret, so the app must hold it. | Yes, bucket-scoped and expiring; revoke after the test |
| Supabase server key | Owner: acceptance project → Settings → API Keys → new **secret key** `agent-acceptance-test` | Acceptance project only, individually revocable. | **Environment variable** `SUPABASE_SERVICE_ROLE_KEY`. A network secret would turn every request to the project host into a service-role request and defeat the authorization tests. | Yes, acceptance-only; delete the key after |
| Worker ticket secret | Me, random, test-only | Set as Worker secret `TICKET_KEYS` via the API; the app gets the same value locally. | Worker + local test env. | Yes, test-only, discarded |

Network access (Allowed domains): add `<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` and `aladdin-media-edge-acceptance.<your-subdomain>.workers.dev` (or `*.workers.dev`). Remove after the test.

R2 bucket settings the owner sets in the dashboard (avoids giving the token account-wide R2 Storage Edit): on the **private** bucket, CORS allow origin `http://localhost:3000`, methods `PUT, GET, HEAD`, headers `content-type`, expose `ETag`, max age 600; lifecycle: abort incomplete multipart uploads after 1 day, expire prefix `pending/` after 2 days.

Notes: Workers Scripts Edit is account-wide (Cloudflare cannot scope it to one Worker); the account has no Workers today, and I will only create `aladdin-media-edge-acceptance`. Environment secrets apply to every session in this cloud environment and a session picks them up only when it starts, so the run continues in a fresh session. If you prefer the two exposed values (R2 pair, server key) never reach the cloud, the alternative is running the app on your own machine through a Remote Control session; the Worker/Hyperdrive parts are unchanged.

## Stage 4 plan (unchanged, after stages 1–3)

Real provider: presigned photo upload to R2 → verify receipt → read via Worker mode P/C → delete; video multipart upload, HLS segments via Worker; edge cache headers/ETag revalidation; revocation (unpublish, sign-out, delete each refuse the next request/segment); Hyperdrive round-trip latency; rollback with every flag off (app falls back to Supabase Storage paths). Transcoding runs locally (ffmpeg in this sandbox) and is reported as local. Each result will be labelled *provider* or *local*.
