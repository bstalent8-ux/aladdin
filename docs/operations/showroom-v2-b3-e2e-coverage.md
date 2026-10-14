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

## Final-run status
After `supabase db reset` the full pgTAP (85 files, 3,746 assertions) and all ten concurrency scripts pass. The post-reset full regression run was interrupted when the machine ran out of memory; it must be re-run (one batch per invocation).
