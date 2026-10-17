# B2 - stale quotation conflict (closed locally)

Status: fixed and verified on the isolated local stack (`aladdin_sr2`, PostgREST v14.15). Not yet confirmed on hosted Supabase (see section 6). Measured 2026-10-14.

## 1. Symptom

Submitting a stale `expected_version` to a quotation RPC left the browser on "Saving..." until the gateway answered `504 The upstream server is timing out` after ~60 s.

## 2. Confirmed root cause (was a hypothesis)

| Step | Evidence |
|---|---|
| Browser -> Next.js server action -> `supabase.rpc("update_quotation")` | the action catches the error and maps `40001`/"modified concurrently" to `commerce.errors.conflict` (already correct, never reached) |
| PostgREST | calling PostgREST **directly** (bypassing Kong) also hung (client timeout at 20 s) - the delay is inside PostgREST, not Kong or Next.js |
| Database | the same call in `psql` as the `authenticated` role returns `ERROR: quotation was modified concurrently` in **<1 ms** (SQLSTATE `40001`) |
| Retry loop | the Postgres log held **13,143** `quotation was modified concurrently` errors from one request in 3 minutes, ~3 ms apart, all from role `authenticator`. PostgREST v14 treats `40001` (`serialization_failure`) as retryable and re-runs the call until the request is abandoned |
| Locks | none: the RPC does `select ... for update` on one row and raises before changing anything; `pg_stat_activity` showed no waiting sessions |

So the DB, the Next.js action and the translation were all correct. The only defect: the business "stale version" guard used the **transient-failure** SQLSTATE. A retry can never succeed (the version only changes if someone else writes), so every stale save burned DB capacity for a minute and ended in a 504.

Intentional business conflict vs transient failure: an optimistic-lock mismatch is a business conflict (needs a reload, not a retry). A genuine serialization failure under `SERIALIZABLE`/`REPEATABLE READ` is transient. The commerce RPCs run at READ COMMITTED with explicit row locks, so no genuine `40001` is expected from them; nothing in this change retries anything.

## 3. Fix (smallest reliable)

`supabase/migrations/20261026090001_commerce_version_conflict_sqlstate.sql`: the same guards now raise the dedicated application SQLSTATE `VC001` ("version conflict"; class `VC` is unused by PostgreSQL). PostgREST answers it at once as HTTP 400 `{"code":"VC001","message":"quotation was modified concurrently"}`.

* Function bodies are rewritten from the live definitions (`pg_get_functiondef` + replace) and the migration aborts unless exactly the 8 expected functions were converted, so lifecycle, authorization, audit and every other statement are unchanged.
* Functions: `update_rfq`, `submit_rfq`, `update_quotation`, `submit_quotation`, `decide_quotation`, `start_order`, `activate_project`, `complete_project` (the Direct RFQ -> Quotation -> Order -> Project chain).
* Frontend: `isStaleVersion`, `mapCommerceError`, `mapExecutionError` also accept code `VC001` (the message match already worked; the code is now explicit). The localized messages `commerce.errors.conflict` / `execution.errors.conflict` exist in English and Arabic.
* No retry loop was added anywhere; nothing is resubmitted automatically; no data is overwritten.

## 4. Before / after (same quotation flow, same machine)

| Call | Before | After |
|---|---|---|
| `update_quotation` at the current version | 77 ms, 200 | 67 ms, 200 |
| `update_quotation` at a stale version, via PostgREST | **60,071 ms, 504** | **61 ms, 400 `VC001`** |
| Browser: stale Submit / stale Accept | spinner for ~60 s then error | conflict message within seconds, button enabled again (`j-quotation-conflict.spec.ts` J2/J3 assert < 10 s) |

## 5. Tests

* pgTAP `23_catalog_rfq_quotation_test.sql` (+6): stale `update_quotation`, `submit_quotation`, `decide_quotation` raise `VC001` and change nothing; a non-member holding a stale version gets `42501`, not a conflict. `24_orders_projects_test.sql` (+4): stale `start_order` / `activate_project`. `32_...` now expects `VC001` for `submit_rfq`. 132/132 assertions pass in the three files.
* `supabase/tests/quotation_concurrency_test.sh` (two real sessions, row lock held 3 s): concurrent updates at one version -> second waits, is refused with `VC001`, first writer's note survives, one version bump; concurrent submits -> second refused, exactly one `quotation.submitted` audit row and one version bump. PASS.
* Browser `e2e/regression/j-quotation-conflict.spec.ts` (6 tests, all pass): J1 save prices then submit on the same page (no false conflict); J2 stale submit shows the localized conflict, leaves the loading state, nothing overwritten, works after reload; J3 stale accept; J4 two simultaneous real PostgREST requests (one 200, one 400 `VC001`, both fast); J5 requester and an unrelated organization are denied before the version is considered and cannot read the draft; J6 no duplicate quotation or order.
* Vitest: `error-mapping`, commerce and execution suites (45 tests) including `VC001`.
* Finding while testing: the earlier note in `v2-journey.spec.ts` ("save prices then reload before submit") was not an application bug. It came from clicking Submit before the save action had returned, combined with the 60 s hang. J1 now waits for "Prices saved." and submits on the same page.

## 6. Not covered / needs confirmation

* **Hosted behavior:** hosted Supabase also runs PostgREST; the same retry is expected but the version and any gateway-level retry settings are unverified. The B7 staging run must repeat the stale call (J4 pattern) and confirm HTTP 400 `VC001` in well under a second.
* **Same-class exposure left unchanged (decision needed):** 23 other functions still raise `40001` for a stale version and will hang the same way: `assign_lead`, `transition_lead`, `update_lead_details`, `update_customer`, `update_follow_up`, `reassign_follow_up`, `set_customer_ownership`, `set_lead_source_branch`, `update_product`, `set_product_published`, `own_product_update`, `own_product_set_archived`, `own_offer_save`, `own_offer_set_status`, `publisher_offer_save`, `purchase_request_save`, `purchase_request_transition`, and the `job_*` family. The Showroom product and offer editors are in that list. Recommended: apply the identical migration pattern to them (about 0.5 day including the tests that currently expect `40001` in pgTAP 15, 18, 19, 69, 70, 73 and the four concurrency scripts). Not done here because the request was scoped to quotations.
* The migration adds one file to the pending chain (B4: 44 -> 45).
