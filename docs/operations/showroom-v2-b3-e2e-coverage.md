# B3 - Showroom V2 end-to-end coverage (local, 2026-10-14)

Specs live in `frontend/e2e/regression/` (shared fixtures: `commerce-fixtures.ts`, `setup.ts`). Run: `MAILPIT_URL=http://127.0.0.1:59324 E2E_PORT=3026 pnpm exec playwright test -c playwright.regression.config.ts <file>`. Registration needs `SUPABASE_SERVICE_ROLE_KEY` (local stack key) in the git-ignored `frontend/.env.local`.

| Batch | Journeys | Result when written |
|---|---|---|
| J (B2) | stale submit/accept in the browser, two simultaneous PostgREST calls, auth before version, no duplicates | 6/6 |
| K (B3-A) | buyer creates order, seller starts, creates/activates/completes project, cancel, invalid transitions, stale start, cross-tenant | 5/5 |
| L (B3-B) | email invitation, accept, role, escalation refused, suspend/reactivate/revoke, join request decline then approve, cross-org, wrong persona | 4/4 |
| M (B3-C) | display name, phone, photo, username rules, privacy, organization untouched | 4/4 |
| N (B3-D) | sign-up form and Coming Soon types, real OTP registration, first application with 250-character rule, needs-changes, resubmit, approval opens the workspace | 4/4 |

## Bugs found and fixed
1. 60 s hang on stale versions (B2, `20261026090001`).
2. Direct writes to `profiles.bio` failed with `permission denied for function description_norm` (`20261026090002`); pgTAP had masked it with a plan cached by a superuser statement.
3. A needs-changes organization application could not be resubmitted (`20261026090003`); the screen offered Resubmit and every click failed.
4. Test helper `selectAccountType` targeted a native select; the sign-up control is now a listbox (helper updated).

## Incomplete / not verifiable locally
* Invitation email is not sent by the app (the manager shares the link); the dead string "Invitation sent by email." is never shown. Needs a product decision before launch copy is final.
* No personal bio editor and no username editor exist in the Showroom shell (verified at the database only).
* OTP delivery by a real provider; Turnstile with a production key.
* Rejected Showroom application is covered by batch G (Engineering Office), not repeated.

## Final-run status (post-reset, one batch per invocation, one worker)
After `supabase db reset` (local only) the full pgTAP (85 files, 3,746 assertions) and all ten concurrency scripts passed. The browser regression was then re-run **one spec file at a time** against the local dev server (port 3026):

| Batch | Scope | Result | Time |
|---|---|---|---|
| A | Showroom pages, products, saved | 5/5 | 85 s |
| B | Product form, workspace switching | 7/7 | 89 s |
| C | Offers | 7/7 | 86 s |
| D | Direct RFQ, authorization, i18n | 7/7 | 104 s |
| E | Mobile 390/430, light/dark | 8/8 | 137 s |
| F | Signed URLs, revocation | 5/5 | 52 s |
| G | Organization application flow | 5/5 | 59 s |
| H | Governance (identity, branch, co-owner) | 8/8 | 101 s |
| I | Independent publishers (gated) | 7/7 | 88 s |
| J | Quotation conflict (B2) | 6/6 | 65 s |
| K | Orders and projects | 5/5 (K5 failed once, passed alone) | 192 s + 28 s |
| L | Team invitations and join requests | 4/4 | 230 s |
| M | Personal profile | 4/4 | 78 s |
| N | First registration, OTP, onboarding | 4/4 | 123 s |
| **Total** | | **82/82** | **about 25 min of test time** |

K5 failed on its first run with `page.waitForLoadState: Timeout 60000ms` on a not-found page, directly after a restart of the local dev server and with about 2.9 GB free RAM; the identical test passed on re-run in 21.7 s and the server log shows a 7.7 s first compile of that route. It is recorded as a cold-compile stall, not an application defect, and no assertion was changed.

Memory handling: free RAM fell from 4.3 GB to 1.7 GB across three batches because the local `next dev` process grew to 3.8 GB; only that server (port 3026) was restarted (RAM back to 4.3 GB), nothing else was touched. No browser process remained after the last batch.

## Gap classification (release blocker vs deferred)
| Item | Finding | Class |
|---|---|---|
| Bio / username in the Showroom shell | Not editable there. The 250-character bio rule is enforced by the database; the only bio editor is the professional profile (`/home/profile/edit`, Contractor / Engineer). Username is chosen at registration; its rules (format, reserved words, uniqueness) are enforced by `profile_set_username` and tested (M4). Display name, phone and photo save and persist (M1-M3). | Deferred. No Showroom requirement says staff edit a bio or a username; not a launch blocker. |
| Invitation sharing vs UI copy | Invitations are created and the link is shown to the manager to share; no email is sent. The unused string "Invitation sent by email." (`lib/i18n/messages/en.ts`) is never displayed. | Not a blocker, but needs a copy decision: remove the dead string, or build email delivery (new scope). |
| Needs Changes -> Resubmit | Was broken (every Resubmit failed); fixed by migration `20261026090003`, covered by pgTAP 77 and browser N4. | Closed locally; **hosted blocker until that migration is applied** (part of the 47 pending). |
| First-signup OTP | Covered end to end with the real Email OTP read from the local inbox (N2), duplicate email refused, no workspace before approval. | Closed locally. |
| Real mail delivery and production Turnstile | Not verifiable locally (local inbox and Turnstile test key stand in). | **Launch blocker until verified on hosted staging** (B7), with a real provider and a synthetic mailbox. |
| Description trigger permission | Direct writes to `profiles.bio` failed; fixed by `20261026090002`. | Closed locally, same hosted dependency. |
