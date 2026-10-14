# Showroom V2 - SQLSTATE 40001 audit (remaining uses after the B2 fix)

Status: **classification for review. No database or code change is made by this document.** Written 2026-10-14 against the live local schema (`aladdin_sr2`, migrations through `20261026090003`). Builds on `showroom-v2-b2-stale-conflict.md`.

## 1. Method

* Enumerated every non-aggregate function in `public` and `app` whose definition contains `40001` (`pg_get_functiondef`), and every other schema (none).
* Read the condition around each raise; searched migrations for `SERIALIZABLE` / `REPEATABLE READ` / explicit isolation changes; mapped each function to its frontend caller, its tests and its Showroom V2 reachability (sidebar in `features/showroom-shell/navigation.ts`).
* **Measured** the user-visible effect for five representative stale calls through the real local PostgREST/Kong stack (one per domain family), 8 s client abort.

**Count correction:** the live schema has **24** definitions (23 in `public`, 1 in `app`), not 23. `app.purchase_request_transition` is the helper behind the public `purchase_request_publish`, `purchase_request_cancel` and `purchase_request_close`, so those three are affected through it.

## 2. Result in one paragraph

**All 24 are class A** (deterministic stale-version / optimistic-concurrency conflict). **None is class B**: no function sets SERIALIZABLE or REPEATABLE READ, PostgREST runs each call at the default READ COMMITTED level, so PostgreSQL itself can never raise a genuine serialization failure in this application; every `40001` is raised by our own `if version <> expected` guard, after the row lock. **None is class C** that needs investigation, with two notes (section 5). The defect is the one already fixed for the commerce chain: PostgREST treats `40001` as *retryable* and re-executes the RPC until the 60 s gateway timeout.

Measured now (local stack, one stale call each, aborted by the client at 8 s; the B2 measurement of the same mechanism was 13,143 re-executions in 3 minutes and a Kong 504 at 60 s):

| Stale call | Result |
|---|---|
| `own_product_update` (Showroom product edit) | no answer in 8 s (aborted) |
| `set_product_published` (publish / unpublish) | no answer in 8 s (aborted) |
| `own_offer_set_status` (offer pause / publish) | no answer in 8 s (aborted) |
| `transition_lead` (sales) | no answer in 8 s (aborted) |
| `update_customer` (stale `updated_at`) | no answer in 8 s (aborted) |

Integrity is **not** at risk: every stale write is still refused, no row changes, no duplicate record or notification is created (the guard runs before any write). The harm is (1) the user waits a minute and then sees a generic 504 instead of the localized "changed since you opened it" message, (2) each stale click makes the database re-run the function thousands of times, which is a load amplifier any authenticated user can trigger from a stale tab.

## 3. Classification of all 24

Class **A** everywhere. "SR2" = reachable in the Showroom V2 release (shell routes, or a legacy module linked from the Showroom sidebar for the capability). Tests column: "has" = an existing pgTAP/e2e assertion pins `40001` today (it will need the new code); "none" = no stale-version assertion exists, one must be added.

### 3.1 Showroom-owned catalog and offers (core Showroom V2 surfaces)

| Function | Migration | Operation | Trigger | SQLSTATE now | SR2 | User-visible impact | Tests |
|---|---|---|---|---|---|---|---|
| `own_product_update` | 20261010090001 | edit a product | `version <> p_expected_version` after lock | 40001 | **Yes** (My products, edit) | 60 s hang then 504; two staff editing the same product | has (pgTAP 69) |
| `own_product_set_archived` | 20261008090001 | archive / restore | same | 40001 | **Yes** | same | none |
| `set_product_published` | 20261019090001 | publish / unpublish | same | 40001 | **Yes** (My products lifecycle, also independent publisher) | same | none |
| `update_product` | 20260810090001 | legacy product edit | same | 40001 | Legacy path; no live importer of `server/actions/commerce.ts` found | same if reached | none |
| `own_offer_save` | 20261013090001 | create / edit an offer | same | 40001 | **Yes** (My offers builder) | same | none |
| `own_offer_set_status` | 20261013090001 | pause / publish / end an offer | same | 40001 | **Yes** (My offers) | same | has (pgTAP 70) |
| `publisher_offer_save` | 20261023090008 | independent publisher offer | same | 40001 | **No at launch** (independent commerce gated, flag false) | none for users | none |

### 3.2 Sales (legacy modules linked from the Showroom sidebar: Customers, Leads, Follow-ups)

| Function | Migration | Operation | Trigger | SQLSTATE now | SR2 | User-visible impact | Tests |
|---|---|---|---|---|---|---|---|
| `transition_lead` | 20260805090003 | move a lead stage / status | `version <>` | 40001 | Yes (Leads) | 60 s hang then 504 | has (pgTAP 15, script) |
| `assign_lead` | 20260805090003 | assign a lead | `version <>` | 40001 | Yes | same | none |
| `update_lead_details` | 20260805090003 | edit lead details | `version <>` | 40001 | Yes | same | none |
| `set_lead_source_branch` | 20260806090001 | change source / branch | `version <>` | 40001 | Yes | same | has (pgTAP 19) |
| `update_customer` | 20260805110000 | edit / archive a customer | `updated_at <>` token | 40001 | Yes (Customers) | same | has (pgTAP 18, script) |
| `set_customer_ownership` | 20260806090001 | change customer owner | `updated_at <>` token | 40001 | Yes | same | has (pgTAP 19) |
| `update_follow_up` | 20260805110000 | edit a follow-up | `version <>` (only when a version is supplied) | 40001 | Yes (Follow-ups) | same | has (pgTAP 18, script) |
| `reassign_follow_up` | 20260805110000 | reassign a follow-up | same | 40001 | Yes | same | has (pgTAP 18) |

### 3.3 Purchase requests (Milestone D)

| Function | Migration | Operation | Trigger | SQLSTATE now | SR2 | User-visible impact | Tests |
|---|---|---|---|---|---|---|---|
| `purchase_request_save` | 20261020090001 | edit a draft request | `version <>` | 40001 | **No UI yet** (route hidden, `purchase-requests.ts` has no screen importer); reachable only by a direct API client | none for users today; becomes live with Milestone D | none |
| `app.purchase_request_transition` (behind `purchase_request_publish`, `_cancel`, `_close`) | 20261020090001 | publish / cancel / close | `version <>` | 40001 | No UI yet (same) | same | has (pgTAP 73, via publish) |

### 3.4 Jobs (Engineer / Contractor / Craftsman domain; the Showroom only sees the "Job opportunities" link)

| Function | Migration | Operation | Trigger | SQLSTATE now | SR2 | User-visible impact | Tests |
|---|---|---|---|---|---|---|---|
| `job_update`, `job_publish`, `job_close`, `job_cancel` | 20260902090001 / 20260903090003 | poster edits or changes a job | `version <>` after the status guard | 40001 | Partly (Showroom can open the module; posting is a professional flow) | 60 s hang then 504 | none |
| `job_assignment_start`, `job_assignment_complete`, `job_assignment_cancel` | 20260902090001 / 20260905090002 | assignment lifecycle | `version <>` after the status guard | 40001 | No (Engineer / Craftsman) | same | none |

Note on order of checks: the status guard runs first (`22023`), so a stale call on a job in the wrong state is already answered immediately; the hang appears only when the status is acceptable and the version is stale (verified: stale `job_publish` on a non-draft job returned `22023` in 200 ms).

## 4. Which are release blockers (recommendation, for approval)

* **Blockers for the Showroom V2 release (recommended):** the six Showroom-owned catalog/offer functions that are live in the shell - `own_product_update`, `own_product_set_archived`, `set_product_published`, `own_offer_save`, `own_offer_set_status` (and `update_product` if the legacy path is kept). Two staff editing one product or offer is a normal Showroom situation, the screens are the headline of the release, and a minute-long hang that ends in a generic error is exactly the defect B2 closed for quotations.
* **Strongly recommended, not a data-integrity blocker:** the eight Sales functions (Customers / Leads / Follow-ups are in the Showroom sidebar and sales teams edit concurrently by design).
* **Not blockers:** `purchase_request_*` (no UI until Milestone D - fix in the Milestone D branch, same migration pattern), `publisher_offer_save` (gated), `job_*` (outside the Showroom journey; fix with the Jobs work or in the same batch if cheap).

If the owner prefers one uniform rule, fixing all 24 in one migration is the same effort as fixing 15 (section 6).

## 5. Notes (class C items, no action needed beyond a test)

1. `update_customer` / `set_customer_ownership` compare a **timestamp token** (`updated_at`), not an integer. The browser forms pass the value as an opaque string (no `Date` round-trip, so no microsecond truncation); keep it that way. A guard test already exists (pgTAP 18/19).
2. `update_follow_up` / `reassign_follow_up` only check the version `when p_expected_version is not null`. A caller that omits it gets last-write-wins **by design**; this is documented behavior, not a bug, and must not be "tightened" in this fix.

## 6. Smallest safe remediation plan (NOT implemented; needs approval)

One migration, same technique and safety net as `20261026090001`:

1. For each of the functions in the approved set, rewrite its definition with `replace(pg_get_functiondef(...), $$errcode = '40001'$$, $$errcode = 'VC001'$$)` and `execute` it; **assert the number of replaced functions equals the approved set** so nothing is silently skipped or over-matched. The `if version <> expected` check, the `for update` row lock, authorization order, audit rows and every `22023`/`42501` guard stay byte-identical. Only the SQLSTATE changes.
2. Keep the `message` text (`... was modified concurrently ...`): the frontend mappers already match it, so the change is safe even for a mapper that does not know `VC001` yet.
3. Frontend (small): add `VC001` to the places that test the code alone - `server/actions/independent-publisher.ts:33` (code only, would regress), and for clarity `features/offers/offer-input.ts`, `features/purchase-requests/error-map.ts`, `features/showroom-shell/products/error-map.ts`, `server/actions/error-mapping.ts` (leads / jobs mappers). Add the unit cases next to the existing VC001 ones.
4. Tests: change the nine existing `40001` expectations to `VC001` (pgTAP 15, 18 x3, 19 x2, 69, 70, 73; the four sales concurrency scripts grep the message and expect no code change - verify) and **add** one stale-version assertion for each function that has none today (15 functions: `assign_lead`, `update_lead_details`, `update_product`, `own_product_set_archived`, `set_product_published`, `own_offer_save`, `publisher_offer_save`, `purchase_request_save`, the four `job_*` writers, the three `job_assignment_*`). Add one **guard test** that fails if any function in `public`/`app` still contains `40001` (so the retryable code can never come back unreviewed). Plan counts rise by those assertions only.
5. Browser: one spec modeled on `j-quotation-conflict` for the Showroom path (two sessions edit one product, then one offer; the second shows the localized conflict within seconds, the record keeps exactly the winner's data, no duplicate audit row). Sales gets one stale-tab case (lead stage).
6. Measure before/after exactly as in B2 (stale call time, status code), run pgTAP on a freshly reset database **before** any browser spec, then the focused browser spec. Estimated effort: 0.5 day for all 24 (one migration, mapper edits, ~20 assertions, two browser cases).

**Rejected alternatives:** (a) a PostgREST/Kong-level switch to stop retrying `40001` - not available per route and would also change genuine serialization behavior; (b) retry loops or client-side timeouts - mask the hang without removing the load; (c) blanket `replace 40001` over all functions without the set assertion - risks touching a legitimate future serialization error. (d) Dropping the version guard - removes the lost-update protection; not acceptable.

## 7. Decision requested

**D-V1.** Approve a scope: (A) Showroom products/offers only (5-6 functions), (B) products/offers + Sales (13-14), or (C) all 24 (recommended: same effort, closes the class, adds the guard test). Nothing is implemented until this is answered.
