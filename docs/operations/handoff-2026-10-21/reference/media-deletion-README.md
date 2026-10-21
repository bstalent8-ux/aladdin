# Historical image deletion inventory (staging, read-only, 2026-10-19)

Source: read-only `select` queries on Supabase project `aladdin-staging` (kkpkgjrweysgvhvkhzun), 2026-10-19 ~14:00 UTC. Nothing was changed. The full per-file list is in [staging-historical-media-inventory-2026-10-19.csv](staging-historical-media-inventory-2026-10-19.csv): one row per database reference, with namespace, bucket, object key, owner user id, size, created date, state, visibility (or current/previous avatar) and whether the stored file exists.

## What would be deleted

| What | Database rows | Stored files | Size | People affected | Dates |
|---|---|---|---|---|---|
| Portfolio photos (`portfolio_items`, bucket `professional-portfolio`) | 167 (147 published, 16 private, 4 unfinished uploads) | 163 | 248 MB (259,612,508 bytes) | 57 owners | 2026-09-17 → 2026-10-18 |
| Avatars (`avatar_uploads`, bucket `avatars`) | 148 (144 current profile photos, 3 deleted, 1 unfinished) | 144 | 8.2 MB (8,428,762 bytes) | 144 owners | 2026-09-26 → 2026-10-18 |

- The 4 unfinished portfolio rows and the 4 non-current avatar rows have no stored file; only their rows are removed.
- No orphan files: every stored file in both buckets has a database row.
- After deletion, 144 profiles show the default initials avatar (`profiles.avatar_media_id` cleared) and 57 portfolios are empty until people upload again. No placeholder or replacement images are created.

## What is never touched (checked in the same queries)

- Certificates: 4 rows, 4 files in `professional-certificates`.
- Business-verification documents: 0 files today; the purge never selects that bucket.
- Product photos: 1 file in `product-images`.
- Accounts, profiles, organizations, products, routes, permissions and relationships.

## How it would run (after your Production approval only)

The resumable purge in PR #91 (`backend/app/workers/historical_media_purge.py`, migration `20261019120000_historical_media_purge.sql`) hides and unlinks rows in one transaction, removes each Storage file through the Storage API, confirms it is gone, then deletes the rows. It defaults to a dry run; `--execute` also requires `--confirm-project <ref>`. On the target project, its `media_historical_purge_inventory(cutoff)` function reproduces these counts right before running.

The staging counts above can change before the run if people keep uploading. The run uses a fixed cutoff, so anything uploaded to R2 after launch is never selected.
