# Showroom V2 - B2 Option C: all remaining stale-version guards use VC001

Status: **implemented and verified locally** (2026-10-14). Approved scope: the 24 audited uses in `showroom-v2-40001-audit.md`. Nothing hosted was touched; the migration is local-only and joins the pending list (48 now, was 47).

## Change
* Migration `20261026090004_version_conflict_sqlstate_remaining.sql`: rewrites the live definition of the 24 functions, replacing only `errcode = '40001'` with `errcode = 'VC001'`. The migration refuses to run unless each function contains exactly one such raise and exactly 24 were converted, and it fails if any function in `public`/`app` still raises 40001 afterwards. The guard condition, the row lock, authorization order, audit, the optional `p_expected_* is not null` behavior and every other statement are untouched; the message text ("... was modified concurrently") is unchanged.
* Genuine PostgreSQL serialization failures are not touched: the application never raises 40001 any more, and PostgreSQL's own 40001 (only possible under SERIALIZABLE / REPEATABLE READ, which nothing here sets) still reaches the client unchanged.
* Frontend: `VC001` is recognized (next to `40001` and the message match, so the mappers stay backward compatible) in `server/actions/error-mapping.ts` (sales, commerce, execution, jobs, stale-version helper), `independent-publisher.ts` (code-only check, would have regressed), `features/offers/offer-input.ts`, `features/purchase-requests/error-map.ts`, `features/showroom-shell/products/error-map.ts`. Vitest cases added for each; no new copy, the existing localized "This changed since you opened it. Refresh and try again." is used.

## The 24 functions
`app.purchase_request_transition` (behind `purchase_request_publish` / `_cancel` / `_close`), `assign_lead`, `transition_lead`, `update_lead_details`, `set_lead_source_branch`, `update_customer`, `set_customer_ownership`, `update_follow_up`, `reassign_follow_up`, `update_product`, `own_product_update`, `own_product_set_archived`, `set_product_published`, `own_offer_save`, `own_offer_set_status`, `publisher_offer_save`, `purchase_request_save`, `job_update`, `job_publish`, `job_close`, `job_cancel`, `job_assignment_start`, `job_assignment_complete`, `job_assignment_cancel`. Together with the 8 commerce functions of the first B2 migration, every stale-version guard in the application now answers with VC001.

## Before / after (local stack, real PostgREST + Kong)
Before (audit probe, client abort at 8 s; the same mechanism measured 60,071 ms / HTTP 504 and 13,143 re-executions in 3 minutes in B2):

| Call | Before | After (HTTP 400, VC001) |
|---|---|---|
| `own_product_update` | no answer in 8 s | 58 ms |
| `set_product_published` | no answer in 8 s | 35 ms |
| `own_product_set_archived` | (same mechanism) | 33 ms |
| `own_offer_set_status` | no answer in 8 s | 48-58 ms |
| `own_offer_save` | (same mechanism) | 43-44 ms |
| `transition_lead` | no answer in 8 s | 46-48 ms |
| `update_lead_details` | (same mechanism) | 44-51 ms |
| `update_customer` (stale timestamp) | no answer in 8 s | 46-49 ms |
| `update_follow_up` | (same mechanism) | 57 ms |
| `job_publish` / `job_update` / `job_close` / `job_cancel` | (same mechanism) | 41 / 13 / 16 / 21 ms |
| `purchase_request_save` / `_publish` (API only) | (same mechanism) | refused at once, request unchanged, one record |
| Browser: Showroom product edit in a stale tab | server action hung until the gateway timeout | localized conflict visible after 1.1 s, winner's data intact, Save enabled again |

## Verification
* Clean local database (`supabase db reset`, 84 s, all migrations to `20261026090004`), then **full pgTAP: 86 files, 3,763 assertions, all pass** (new file `86_version_conflict_sqlstate_test.sql`: regression guard + 32-function definition check + job behavior; nine existing expectations moved to VC001; representative stale assertions added to suites 15, 69, 70, 73). One new assertion initially failed because `own_offer_save` validates the item list before the version; the test was corrected, the function was not changed.
* Concurrency scripts (real parallel sessions): customer update, lead ownership, lead transition, follow-up update, quotation, publisher - all pass, second writer refused with VC001, no lost update, one audit row.
* Browser (one spec at a time): new batch `o-version-conflicts.spec.ts` 6/6 (products, offers, sales, jobs, purchase requests via API, stale product tab in the browser); focused regressions B 7/7, C 7/7, I 7/7, J 6/6. Vitest for the touched mappers and actions: 166 pass. `tsc --noEmit` clean; ESLint clean on touched files.
* The regression guard: pgTAP 86 fails if any function in `public`/`app` contains `40001`, so a deterministic check cannot silently go back to the retryable code.

## Not changed / not covered
* Optional expected-version behavior (`update_follow_up`, `reassign_follow_up` without a token) is last-write-wins by design and was left alone; customer tokens remain opaque timestamps.
* `job_assignment_*`, `update_product` (legacy) and `publisher_offer_save` (gated) are covered by the definition-level guard, not by a behavior test (no UI path in the Showroom V2 release).
* Hosted staging must still confirm the stale-call time after applying the migration (B7).

## Migration impact
One additive migration, no data change, no table change; re-runs `create or replace` on 24 functions (same signatures, same privileges and security settings, because the definition is replayed from `pg_get_functiondef`). Rollback is the reverse `replace` (not needed for correctness; clients tolerate both codes).
