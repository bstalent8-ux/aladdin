# Showroom rc1 - production release runbook (NOT EXECUTED)

Status: **prepared 2026-10-15; nothing here has been run against a hosted system.** Every step marked HOSTED needs the user's explicit final GO.

## 0. Facts (read-only, verified 2026-10-15)

- Live site `aladdindecore.com` = Vercel project `aladdin-staging` (team `aladdin8`), production deployment `dpl_6F4cLptBtEtR5LwF7mQAneigsc83` = commit `c7963c95` (`origin/main`). **That deployment id is the application rollback target.**
- One hosted Supabase project, `kkpkgjrweysgvhvkhzun`, serves the live site (production and staging are NOT separate). Applied migrations: exactly `main`'s 104, newest `20261011090003`.
- Hosted backups: **none** (`backups: []`, point-in-time recovery disabled). A logical dump we take ourselves is the only restore point.
- Real data exists (approved showrooms, products, orders). No migration may delete or rewrite it.

## 1. Release content

- Commit: `release/showroom-v1-rc1` (see `git rev-parse` at GO time).
- Pending migrations to apply, in order (52): `20261015090001` ... `20261015090052`. None of them was ever applied to a hosted database, so their versions are free to use; all 104 existing versions are untouched.
- Enabled: Showroom Home, My Products (+ images), Settings, business application + Administrator-only approval, at `/showroom/*` (`/preview/showroom-suite-v2/*` redirects there; `/b2b` unchanged).
- Disabled at the server: Offers (`/showroom/offers`, `/showroom/my-offers`, `/b2b/offers`, `/home/offers` answer 404; nav hidden). Not included: Employee Invitations, `feat/showroom-auth` (phone sign-in), R2, Email OTP additions. Authentication is `main`'s email + password; **no auth or CAPTCHA code or configuration changes**.

## 2. Backup and restore verification (before any hosted write)

1. HOSTED READ (needs the data-dump authorization): `supabase db dump --linked --data-only --use-copy --schema public,auth,storage -f <protected dir>/hosted-data.sql`, plus the schema dump already taken (`Backups/hosted-schema-2026-10-15/`). Files stay local, are never committed, never leave the machine.
2. LOCAL: restore into a throw-away local database at `main`'s baseline (`supabase db reset --local --version 20261011090003 --no-seed`), load the data dump, record per-table row counts and a checksum of the key tables.
3. LOCAL rehearsal on that restored copy: `supabase migration up --local` (the 52 pending), re-count and compare: every pre-existing row must still exist; then verify the live showrooms' published products are visible through `catalog_products` for their audiences.
4. Storage objects (product/portfolio images) are not in a database dump. rc1's migrations do not delete or move any object; they add the `product-images`, `request-images` and organization-image buckets/policies. Record the object counts per existing bucket before and after.

## 3. Deployment sequence (HOSTED - after final GO)

1. Freeze: announce a short maintenance window (writes briefly unavailable).
2. Re-take the data dump (step 2.1) so it matches the moment of change; keep its checksum.
3. Build the candidate WITHOUT promoting it: `vercel deploy` from the rc1 commit as a preview (same project, not an alias of the live domain).
4. Dry run: `supabase db push --linked --dry-run` must list exactly the 52 files above and nothing else; run `node scripts/migration-history-guard.mjs` and `node scripts/migration-policy.mjs` as the repo's CI does.
5. Apply: `supabase db push --linked`. Verify `supabase migration list --linked` shows 156 versions with no gaps.
6. Smoke-test the PREVIEW URL against the migrated database (sign in, `/showroom/home`, My Products create + image, Settings save, Admin approves an application, cross-tenant read denied).
7. Promote: `vercel promote <preview-url>` (aliases the live domain). Immediately smoke `aladdindecore.com`.
8. End the maintenance window; watch `/api/health`, Vercel runtime logs and Supabase logs for 30 minutes.

Window note: between steps 5 and 7 the OLD app (`c7963c95`) runs on the NEW schema. Registration creates an application (pending organization) instead of an immediate workspace, and published products are no longer readable directly from the table (the catalog RPCs are the read path). Keep this window to minutes.

## 4. Rollback

- Application only (schema compatible): `vercel rollback dpl_6F4cLptBtEtR5LwF7mQAneigsc83` (instant).
- Database: migrations are forward-only (no down scripts). If a migration fails mid-way, `db push` stops; the failed migration runs in its own transaction, so earlier ones stay applied. Preferred recovery is a forward-fix migration. Full restore (last resort): restore the dump taken in 3.2 into a new Supabase project or after wiping the affected schemas, accepting loss of writes made since the dump - which is why step 3.1 freezes writes.
- Irreversible parts: `20261015090018` (audience backfill adds rows only), `...090004` (new columns/tables), constraint rewrites on `audit_log` (re-widened by `...090050`). No migration drops a table or column that exists on production today (verify with the rehearsal in 2.3).

## 5. Migration statements that touch existing rows (static review; counts to be measured in the 2.3 rehearsal)

| Migration | Statement | Effect on live data | Protection |
|---|---|---|---|
| `20261015090006_product_prices_private` | `drop column products.base_price` | prices move to the private `product_prices` table | copy first, then a guard raises (and aborts) if any price did not copy |
| `20261015090022_account_taxonomy_canonical` | `update ... 'wholesaler' -> 'supplier'`; `delete from activities` for retired subtypes; enum rebuild | wholesalers become suppliers (activity re-linked); activity subtypes of the retired Interior Designer / Trainer / Trainee / Wholesaler are deleted | **measure** in the rehearsal: number of `organization_activities` / persona rows referencing the deleted activities |
| `20261015090023_offer_audience_canonical` | deletes `wholesaler` / `interior_designer` offer audiences | offers are not live on production today (no rows expected) | confirm row count = 0 in the rehearsal |
| `20261015090027_registerable_org_type_everywhere` | nulls `contractor_company` intents; deletes pending/submitted `contractor_company` referrals | affects only that internal type | confirm counts in the rehearsal |
| `20261015090018_product_audiences_exact_only` | adds an audience row (all 8) for every published product | existing published products stay visible to every audience | additive |

GO condition: the rehearsal shows no unexpected row loss in any table outside the retired-taxonomy rows above, and those losses are accepted by the owner.
