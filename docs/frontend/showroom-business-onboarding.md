# Showroom business onboarding — local review

## Purpose and current decision
Extend the existing business wizard and draft RPCs. The product owner approved these changes as part of Showroom authentication, with final PR preparation held until visual review.

Step 1 keeps trading name, legal name and optional description (maximum 250 characters). Showroom accounts additionally require a valid canonical E.164 business phone and one existing showroom activity; email is optional and normalized by trim/lowercase. The exact Arabic activities are معرض ديكور, معرض دهانات, معرض ديكور ودهانات and موان. The last option retains the existing building_and_finishing_supplies_retailer key.

Step 2 requires governorate and a catalogue city or valid custom city. The detailed address is optional at onboarding, limited to 250 whitespace-separated words, with a bounded 16,384-character payload. Missing showroom address remains an informational account-completion item linking to the existing branch editor in /b2b/settings. It does not block initial business creation or grant approval.

## Rationale and scope
Business contacts belong to organizations, not the personal profile or Supabase login alias. They are unverified contacts. Reuse public.activities / public.organization_activities; do not introduce an enum or parallel activity taxonomy. Store the address in the primary branch's existing address_ar field. Preserve incomplete drafts; new draft fields are nullable and no historical data is invented or backfilled. Omitted new fields preserve saved values; explicitly empty email/address clears them.

The shared wizard keeps its existing default heading style. BusinessFlow selects the existing Readex font and Arabic display typography, removing negative tracking / cramped line-height and the decorative Kufi treatment from these two headings. Existing branch editing and account-completion UI are reused.

## Database and authorization
Forward-only migrations: 20261014123000_showroom_business_onboarding_details.sql and 20261014133000_showroom_optional_address_completion.sql. They extend existing draft save/submit, add unverified organization phone/email, preserve verified-caller and first-business type locks, retain atomic organization/owner/branch creation and pending_verification / is_verified=false. Contact data is available in existing authorized business settings/admin details. Existing RLS and client write grants remain unchanged.

The local test stack is aladdin_showroom_auth, API http://127.0.0.1:63321, database port 63322. Worktree frontend .env.local contains local-only configuration. No production database or deployment was modified.

## Verification
- TypeScript noEmit: passed.
- Scoped ESLint: passed.
- Latest focused onboarding / profile / Showroom and Installer auth run: 149 tests passed in 8 files.
- Full local pgTAP suite: 89 files, 3761 assertions passed. Legacy regression fixtures now provide the newly required creation inputs; separate direct RPC tests still reject missing/invalid inputs.
- Chromium desktop 1440x1000 and mobile 390x844: Steps 1 and 2 rendered, no horizontal overflow; business phone and selected location survived Back/Forward; Continue accepts a blank optional address after governorate/city selection.
- Original checkout: all 14 baseline modified files unchanged; branch feature/auth-password-preview preserved.

## Preview and related files
- http://localhost:3341/showroom/sign-in
- http://localhost:3341/showroom/sign-up
- http://localhost:3341/onboarding/business (authenticated; steps share this canonical URL)
- Screenshots: [Step 1 desktop](screenshots/showroom-onboarding/step-1-desktop.png), [Step 1 mobile](screenshots/showroom-onboarding/step-1-mobile.png), [Step 2 desktop](screenshots/showroom-onboarding/step-2-desktop.png), [Step 2 mobile](screenshots/showroom-onboarding/step-2-mobile.png).
- New contact validator: frontend/src/lib/onboarding/business-details.ts.
- New direct database tests: supabase/tests/91_showroom_business_details_test.sql.

## Deferred work and consequences
UI review is approved. Final packaging proceeds as a draft PR with the blockers below. No merge or deployment is authorized. Business contact verification remains deferred; these fields must never be treated as verified. The persistent local preview stays on port 3341. Temporary local Supabase and generated build configuration are restored before committing. New branding assets are derived rasters, not original vector masters.

## Final review — authentication architecture and security
Shared `frontend/src/server/auth/phone-password.ts` receives server-selected Installer/Showroom account types from thin actions. Existing internal identity mapping stays `p<e164digits>@craftsman-login.aladdin.invalid`, with global phone uniqueness. Reuse SSR sessions, consent recording, profile initialization and account-type route authorization. Registration creates only business/showroom intent; the existing transactional wizard creates pending-verification organizations and scoped ownership. Internal alias confirmation never marks a real phone/email verified. Business contacts never alter personal auth phone. Failed initialization signs out and deletes the new identity, with attempted ban if deletion fails; transport failure can still require operator cleanup.

Shared password policy: signup/change/reset minimum 10 Unicode code points, maximum 72 UTF-8 bytes; exact confirmation; no trimming, transformation or truncation. Sign-in accepts existing shorter passwords but enforces types/nonempty/maximum. Direct local GoTrue v2.193.0 tests verify minimum configuration 10, bcrypt storage and rejection of 73 ASCII bytes / 37 Arabic characters / 19 emoji. Hosted provider configuration is not independently verified. Existing libphonenumber-js/max validates all supported countries on client/server, normalizes E.164, handles Arabic digits/leading zeros and prevents duplicate country codes. Egypt is default; 245 local flags are licensed with provenance.

Auth FormData caps: 8,192 UTF-8 bytes, 16 fields, bounded keys; reject file and non-FormData input. Middleware rejects declared auth bodies above 65,536 bytes; existing Next limits bound other request bodies. Private HMAC-keyed atomic quotas cover app requests by IP/normalized phone, generic errors and safe throttling feedback. Turnstile protects applicable registration. Hosted cookies use Secure/SameSite Lax; existing browser SSR cookies remain client-readable. Next server-action origin checks preserve the existing CSRF boundary. No plaintext password/token logging or client service key is introduced. Direct tests cover private-table writes, unauthorized roles, cross-tenant updates and wrong-account-type login.

**Critical merge/deployment blocker:** exhausting the app phone quota does not prevent a direct native GoTrue password request. Diagnostic result: `invalid_credentials`, HTTP 400, after application quota denial. No wrong-password login succeeded; this proves incomplete quota coverage. Native provider IP throttling is separate. The connected Supabase organization is on Free; password-verification hooks require Teams/Enterprise. No plan upgrade or hosted changes were performed. A reviewed provider-wide mitigation is required; the PR remains DRAFT. Sources: [native rate limits](https://supabase.com/docs/guides/auth/rate-limits), [hook availability](https://supabase.com/docs/guides/auth/auth-hooks).

## Approved address enforcement and legacy remediation
Registered account is identity plus intent. Onboarding completed is transactional business creation. Pending approval is pending_verification / is_verified=false. Approved business requires authorized review. Active showroom passes activation rules. Authorized seller additionally requires applicable unexpired applied approval and complete required business information. Completing an address alone does not grant approval.

The fourth migration, `20261014160000_showroom_activation_and_selling_address.sql`, enforces full new-business completion before approval/activation, publication, new submitted quotations and new orders/order progress. Draft products remain permitted under existing membership permissions. Published listing RLS integrates seller eligibility. Active complete showrooms cannot clear/remove/deactivate their primary address. Suspension and tenant checks remain in effect. Whitespace-only addresses do not count.

The approved backward-compatible rollout captures the historical active/approved cohort. Missing-address exceptions capture existing published product IDs and existing order IDs only. Existing products are not changed/unpublished, businesses are not deactivated, and captured order operations continue while the business remains active/approved. New publications and new selling require a valid address. Historical businesses retain their old information contract; all new businesses must meet the full new contract. Private records contain policy/reason/time and deny direct client/service-role table access. Owners see the existing business-profile completion item. Adding a valid primary address closes the exception with time/actor.

Read-only staging impact: **2 affected showrooms / 6 published products**:

| Organization ID | Published products |
| --- | ---: |
| `91000005-1111-4111-8111-000000000005` | 2 |
| `9c000000-cccc-4ccc-8ccc-000000000001` | 4 |

Production impact was not checked; staging is not evidence of production contents. Operations must review open exceptions through trusted DB access, request owner completion through separately authorized communication, then verify `/b2b/settings` saves and closed_at/eligibility. Track overdue records; review suspension separately. No automatic expiry is introduced, avoiding unattended order interruption. Do not reopen/extend snapshots through a client API. Existing products remain visible but creation of new orders is blocked until completion; existing orders continue. No outbound customer messages were sent. [ADR-0015](../decisions/ADR-0015-showroom-address-selling-rollout.md) records this trade-off.

## Final test evidence and limitations
Separate reruns overlap; do not sum their counts.

| Check | Result |
| --- | --- |
| Full frontend Vitest | 212 files passed / 2 skipped; 2,793 tests passed / 13 skipped |
| Final focused auth/input tests | 4 files / 232 tests passed |
| Focused onboarding/profile/auth | 8 files / 149 tests passed; later changed step/name checks 41 passed |
| Production build | Passed |
| Full DB run before browser business fixtures | 90 files / 3,794 assertions passed |
| Later full DB rerun with accumulated browser fixtures | Failed: 90 files / 3,615 executed assertions; 21 failed assertions, six affected files with early-aborted plans |
| Native endpoint per-account quota diagnostic | Failed coverage; merge/deployment blocker |

The later full DB rerun shared the preview database with browser-created fixtures. Historical suites assume exact seed-only org/membership/audit counts and no extra active Super Admin; retained synthetic business/reviewer fixtures violate those assumptions, with concurrent execution compounding the problem. New task suites 90/91/92 passed in that run. Do not present the previous full pass as a clean latest overall gate. No DB reset/audit deletion was used to manufacture a pass. Synthetic local identities with protected business history are quarantined/archived. A pristine disposable acceptance database is required for a repeatable full seed-only run.

An earlier browser run passed 22 and failed two journeys because the test reloaded before navigation after saving. Both desktop/mobile journeys passed after waiting for the next step. Final full browser rerun: **24 passed, 0 failed** (2.8 minutes). Final TypeScript check passed; ESLint had 0 errors / 1 pre-existing sidebar-shell hook warning. Sequential task database suites 90/91/92: **116 passed, 0 failed**. Scenarios use genuine local auth, caller/admin RPCs, local verification and synthetic users. No production accounts are exercised. No formal axe audit was run.

## Migrations, files, references and operational limits
Four forward migrations: phone quota/account-type/rollback security (`20261014085731`), draft/business contacts and activity (`20261014123000`), optional-address bounds/completion (`20261014133000`), activation/selling/legacy snapshots (`20261014160000`). Applied only locally. Before deployment: resolve native-auth quota coverage; verify hosted password/cookie/provider settings; assess production legacy impact; review locks/backups; migrate before a compatible app. Snapshot historical sellers once, never recreate exceptions per deployment. Rollback requires reviewed forward corrective migration and compatible app; do not reset DB, erase audits or blindly deploy an app incompatible with creation rules.

Changed areas: shared auth/password/phone validators and quotas; canonical Showroom UI; Installer wrappers; applicable password change/reset flows; business wizard/actions/queries; authorized settings/admin details; branch editor; profile-completion copy/types; middleware/env validation/database types; migrations; scoped regression fixtures and tests; licensed flags, branded assets, references/screenshots and project memory. Git's committed path list is the complete manifest. No new runtime package was needed.

All four original PNG references and supplied README are preserved verbatim under `docs/design/references/showroom-auth/`, along with two rebrand source images. Original-reference SHA-256 values were checked. Auth screenshots are in `screenshots/showroom-auth/`; onboarding screenshots linked above. Functional HTML forms implement the UI; entire screenshots are not used as interface. Derived 2026 assets are raster edits, not original vector masters. ADR-0014 remains preserved and non-conflicting with origin/main.

Routes: `/showroom/sign-in`, `/showroom/sign-up`, `/onboarding/business`; later editing uses existing `/b2b/settings`. Preview uses isolated API63321 / DB63322 with local keys only and remains on3341. OAuth, real phone/contact verification, secure phone recovery, hosted settings and original brand vector assets are deferred.

Keep this worktree through PR review. Cleanup requires explicit approval, confirmed GitHub merge, implementation/references verified in origin/main and no tracked/untracked/ignored work to lose. Stop only this preview, then use ordinary non-force git worktree removal for this exact checkout. Stop if dirty/Git refuses; preserve all other worktrees and the original 14 changes. Do not force-delete a squash-merged branch. No cleanup/merge/deployment is performed during PR creation.
