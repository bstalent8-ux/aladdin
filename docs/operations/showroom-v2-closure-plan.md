# Showroom V2 - release closure plan and risk-based test policy

Status: planning. Nothing here has been executed against a shared environment. Builds on [showroom-v2-release-plan.md](showroom-v2-release-plan.md) and [showroom-v2-release-inventory.md](../frontend/showroom-v2-release-inventory.md); it does not re-audit them. Effort figures are working-day estimates for the agent plus the waiting time the user controls; they are estimates, not measurements.

## 1. Risk-based test policy (applies from now on)

| Tier | Triggers | Run | Do not run |
|---|---|---|---|
| **FAST** | CSS/classes, copy, spacing, icons, screenshots-only changes | `tsc` or targeted `eslint` on touched files; the one existing focused browser spec for that screen; only the relevant screenshots | pgTAP, full Vitest, full E2E, `db reset` |
| **STANDARD** | UI + server action/query, form behaviour, permissions in the UI, user journeys | tests for the affected feature (Vitest for the module, the matching pgTAP file if an RPC is touched, the matching browser spec); reuse fixtures in `e2e/regression/setup.ts` and `e2e/audit/audit-util.ts` | the full suite |
| **CRITICAL** | auth, RLS, storage policies, migrations/schema, commerce state machines, concurrency, anything touching `org.manage` | `db reset` once, then the full pgTAP suite, the relevant concurrency scripts, the full `e2e/regression/a..i`, and the affected `e2e/audit/v2-*` specs | skipping any of these to save time |

Rules that remove waste without weakening security:
1. **Clean DB for pgTAP, seeded DB for E2E.** pgTAP asserts absolute row counts, so it must run on a freshly reset database. The E2E harness seeds the same database, which then makes 8 pgTAP files fail on counts (observed 2026-10-14; test pollution, not a defect). Order of a CRITICAL run: `db reset` -> full pgTAP -> E2E (it seeds itself). Never run pgTAP after E2E without a reset. If both are needed repeatedly, point the E2E harness at a second local database with `E2E_DB_CONTAINER`.
2. **Reuse results** when the code under test is unchanged: record the commit hash next to each suite result in the work log; re-run only suites whose inputs changed.
3. **One heavy process at a time** (Playwright, Vitest and Supabase together exhausted memory once); no polling loops - use `run_in_background` with a completion notification.
4. **One `db reset` per CRITICAL change**, not per suite. Apply a single new migration with `supabase migration up --local` while iterating, and reset once at the end to prove the chain.
5. Keep small local commits per concern (database, frontend, docs).
6. Report time per phase (implementation, compilation, unit, database, browser, debugging/retries) in every checkpoint report.

## 2. Blockers vs deferred

**Release blockers (this plan):** B1 Admin review path - B2 stale-quotation conflict - B3 missing E2E coverage - B4 migration chain - B5 production read-only checks - B6 canonical route and compatibility - B7 hosted staging, backup/restore, rollback.

**Deferred, not blockers** (unchanged roadmap order: F2/M4a closeout -> M4b -> M5 -> M6 -> Milestone D -> Phase 9A -> Phase 8 -> Phase 9B): Shared Purchase Request pages (Milestone D; tables ship empty and hidden), independent professional hub (flag closed), showroom rating, membership card, Points page beyond `/b2b/points`, Dynamic Tags, matching, subscriptions, quotation credits, Admin Page Builder, jobs/projects/referral description limits (a product decision, not a defect).

## 3. Closure plan per blocker

### B1 - Essential Admin review integration (CRITICAL for the governance features)
- **State:** the backend is complete and tested (`review_start`, `review_approve`, `review_reject`, `review_request_changes` for organization applications, name changes, branch verification, co-owner verification; the regression suite drives them as the Admin identity). The current Admin queue shows raw type strings and has no evidence panel (audit screenshot 30). The separate Admin workstream must not be overwritten.
- **Shortest safe path:** pick one of two options (decision D2):
  - **Option P - pilot without Admin UI (about 0.5 day):** hide «Request a name change» and «Request verification» (and the co-owner request) behind a single config flag; organization applications keep working because that review type is already actionable. Reviews of the three hidden types never arise in production. Risk: owners cannot change a verified name until the Admin UI lands.
  - **Option A - minimal Admin screens (about 2-3 days):** in the existing Admin queue add one detail panel per review type (identity: current vs requested names; branch: submitted vs approved location; co-owner: claimant and evidence) wired to the existing RPCs; no new backend. Coordinate the file list with the Admin workstream before touching shared files. Tests: STANDARD per type (one browser journey each; the RPC tests already exist).
- **Exit:** every request type a Showroom owner can create is either reviewable by an Admin or not offered.

### B2 - Stale quotation conflict (CRITICAL; concurrency)
- **State:** a stale-version submit returns SQLSTATE `40001` (the project-wide concurrency code, used by leads, customers, quotations, offers). Locally PostgREST answers "upstream timing out" after 60 s instead of a conflict. The action already maps `40001` to `commerce.errors.conflict`.
- **Hypothesis (not yet proven):** `40001` is `serialization_failure`; PostgREST and the API gateway treat it as retryable, so the call is retried until the gateway times out. If true, hosted Supabase behaves the same and the user would wait on every stale save.
- **Steps:** (1) 30-minute spike: direct HTTP call, read the PostgREST status and the gateway log, run the same call against the hosted staging project; (2) if confirmed, choose the smallest fix: keep the DB code for in-database callers but raise a dedicated application SQLSTATE (for example `55000`-class custom code) only at the public RPC boundary, update `mapCommerceError`/`isStaleVersion` for both codes during the transition, and re-run the existing concurrency scripts plus pgTAP for the touched RPCs; the alternative is a pre-check in the server action (read version, compare) with the RPC still the authority; (3) browser test: stale submit shows the conflict message in under 2 s.
- **Effort:** 0.5 day for the spike; 1-1.5 days if the fix touches the RPC boundary.

### B3 - Missing E2E coverage (STANDARD each; reuse `setup.ts` helpers)
1. **Order start/complete and project transitions** (about 1 day): accept a quotation -> order -> start -> complete, project activate -> complete; assert state, notifications and audit rows, and that a non-authorised member is refused.
2. **Team invitations and join-request approval** (about 1 day): invite by email, accept, capabilities applied, revoked member loses access, join request approve/reject.
3. **Personal profile saves** (about 0.5 day): name, phone, avatar, bio at 250/251 (the description rule is already unit and pgTAP tested).
4. **First-onboarding** (about 1 day): new sign-up -> OTP -> account type -> first business -> pending application (the application half is covered by regression `g`; the sign-up and OTP half is not). Needs the local mail inbox for the OTP.
- **Exit:** each journey passes once on a seeded database; add them to `e2e/regression` so they join the CRITICAL set.

### B4 - The 44 pending migrations (CRITICAL)
- **Order:** apply exactly in file order, `20261007090001` -> `20261025090001`; the groups and dependencies are in release plan section 3. Do not cherry-pick or split.
- **Dependencies that make partial application unsafe:** `catalog_products` is dropped and recreated; `my_workspaces()` is redefined three times; `products.base_price` is dropped after its data is copied; old functions and enum types are dropped; `organizations.logo_media_id` gets a foreign key and a revoked client UPDATE.
- **New checks to add** to the staging run (found while writing this plan): the `logo_media_id` foreign key will **fail** if production holds any non-null `organizations.logo_media_id` (the column existed unused); the `ck_organizations_description` and audit allow-list changes are additive.
- **Steps:** restore a production backup into a scratch project -> apply all 44 -> clean pgTAP -> concurrency scripts -> record timings and the result. Effort: 1 day after staging access exists.

### B5 - Read-only production checks (run before any step in B4; no writes)
```sql
-- descriptions over the new limit (nothing is rewritten either way)
select 'profiles.bio', count(*) filter (where char_length(bio) > 250), max(char_length(bio)) from public.profiles
union all select 'products.short_description', count(*) filter (where char_length(short_description) > 250), max(char_length(short_description)) from public.products
union all select 'product_offers.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.product_offers
union all select 'portfolio_items.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.portfolio_items
union all select 'business_creation_drafts.description', count(*) filter (where char_length(description) > 250), max(char_length(description)) from public.business_creation_drafts;
-- would break the new foreign key
select count(*) as organizations_with_logo_media_id from public.organizations where logo_media_id is not null;
-- data the destructive steps depend on
select count(*) as products_with_base_price from public.products where base_price is not null;      -- must all exist in product_prices after migration
select count(*) as orgs_without_type from public.organizations where org_type is null;
select count(*) as slugs_duplicated from (select slug from public.organizations where slug is not null group by slug having count(*) > 1) d;
select enabled from public.platform_flags where key = 'independent_commerce';                         -- expect false or absent
```
- Needs a read-only connection or the user running the queries (decision D4). Effort: 0.5 day including interpreting results.

### B6 - Canonical Showroom V2 route and backward compatibility
- **State:** V2 is served at `/preview/showroom-suite-v2/*` and `/b2b/*` modules render inside the same shell for `showroom_dealer`; `/b2b` and `/b2b/settings` redirect for Showroom workspaces; other organization types are untouched.
- **Recommendation:** do **not** block the release on renaming. Ship with the current URLs (nothing existing breaks: the old Showroom pages already redirect), and add `/showroom/*` aliases and 308 redirects in a later small release, following the 4-step plan in inventory section 7. If the user wants `/showroom/*` at launch: about 1 day (rewrites, sidebar hrefs, redirect tests, bookmarks check), tier STANDARD.
- **Exit:** a documented list of old URL -> new behaviour, verified by the existing navigation spec.

### B7 - Hosted staging, backup/restore, rollback (CRITICAL)
1. User names the staging project and confirms it is not production (D3).
2. Enable PITR / take a verified backup of the staging copy of production; **perform one restore drill** and record how long it took.
3. Apply the 44 migrations on that copy (B4), deploy the matching frontend preview, run the CRITICAL set against it, plus the 40001 check (B2) and storage checks (release plan section 6 step 5).
4. Rollback readiness: frontend-only rollback is safe only before migrations; after migrations the plan is restore-from-backup plus the previous deployment, or a forward-fix migration (release plan section 8). Write the exact backup timestamp and the restore command in the release record.
- Effort: 1-2 days, dominated by access and waiting.

## 4. Shortest safe critical path

```
D1-D4 decisions (user)  ->  [parallel, local]  B2 spike + fix | B3 E2E gaps | B1 option P or A
                        ->  B5 production read-only checks (needs access)
                        ->  B7 staging: backup + restore drill -> B4 apply 44 migrations -> CRITICAL set + B2 check
                        ->  go / no-go review with the user  ->  (explicit approval) deploy
```

| Path | Estimate (working days) |
|---|---|
| Fastest, Option P for Admin, current URLs | about 6-7 days: B2 0.5-1.5, B3 3.5, B1 0.5, B5 0.5, B4+B7 2-3 (B2/B3/B1 run in parallel with waiting on staging access) |
| With minimal Admin screens (Option A) | about 8-9 days |
| Add `/showroom/*` routes at launch | add about 1 day |

Everything above is gated by user decisions and staging access; the local work (B1-B3) can start immediately once D2 is answered.

## 5. Exact remaining user decisions

- **D1** Visual approval of Home, Settings, converged pages and the product cards (screenshots in `docs/frontend/screenshots/`).
- **D2** Admin path: Option P (hide the request buttons for the pilot) or Option A (minimal Admin review screens), and who owns the Admin workstream files.
- **D3** Which hosted staging project to use, confirmation that it may receive a production-copy restore and the 44 migrations, and permission to run the restore drill.
- **D4** How production is read: a read-only connection for the agent, or the user runs the section B5 queries and shares the output.
- **D5** Canonical route: keep current URLs for launch (recommended) or `/showroom/*` at launch.
- **D6** Whether a runtime kill switch for the converged shell is required before launch (not built; about 0.5 day if wanted).
- **D7** Showroom rating and membership card stay out of the release (confirm).
- **D8** Open product decisions that do not block release: jobs/projects/referral description limits; privacy decisions 1-4 in the reference-alignment document.
- **D9** Explicit go for deployment after the staging results.

## 6. Time reporting format for every checkpoint
Implementation / compilation / unit tests / database tests / browser tests / debugging and retries, in approximate minutes, with a one-line reason for any step over 5 minutes.
