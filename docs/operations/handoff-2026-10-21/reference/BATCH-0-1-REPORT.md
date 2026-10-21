# Approved-features integration: Batch 0 and Batch 1 (part 1)

Branch `integration/approved-features-20261019` in `D:\projects\aladdin-wt-approved-integration`.
Nothing has been committed, pushed, merged or deployed. No hosted Supabase, Auth, Staging or Production was touched.

## Base

| Item | Value |
|---|---|
| origin/main | `a9723a01` (PR #96 merged) |
| Branch tip | PR #97 `f15638e6`, which already contains #88, #89, #91, #92 and #94 |
| origin/main on top | merged into the working tree with `--no-commit` (merge staged, not committed) |
| Not included | #93 (brand palette) and #95 (hydration fix): neither is in #97 |
| Snapshots | `D:\projects\_claude-integration-snapshot-20261019` (untouched) |
| Original dirty worktrees | untouched |
| Isolated DB | local stack `aladdin_int_approved`, ports 655xx (no shared stack was reset) |

## Conflicts resolved

1. **PR #96 vs PR #88 (blocking).** Main's `20261020090001_registration_data_sync` patches Admin functions by text, and PR #88 had already rewritten them. A clean replay failed at that migration. Fix:
   - the three Admin patches in that file now apply only to the pre-#88 shape;
   - new `20261021090000_admin_registered_account_reconcile` adds `registered_account` to #88's functions, in either migration order.
   - This edits a migration that is already on main. It is not in the frozen RC2 baseline. **If #96 has already been applied to staging or production, tell me** and I will switch to a forward-only fix.
2. **Code conflicts.** Admin user page, Showroom settings (`business_verified_at` plus #96's legal name and contacts), the profile identity query (R2 media reads kept), and the work log.

## Rehearsal port (your rules 1-8)

| Rule | What was done |
|---|---|
| 1-2 Keep PR #88's secondary phone | No rehearsal phone tables, cooldown or RPCs imported. PR #88's tests still pass. |
| 3 Phone-change journal and recovery | `20261021090003`: journal, begin/settle/status/recoverable, alias guard on `profile_set_phone`, journal-aware identity guard, audit trigger. |
| 3 Auth alias / email protections | `20261021090004`: `auth.users` alias guard plus a single-use operator break-glass, authorized by the new Admin permission `phones.alias_exception`. |
| 3 Contact email backend | `20261021090005`: a private, email-only `app.contact_emails`. No second phone registry. Global uniqueness against every account's sign-in and verified contact email, under one per-address lock. |
| 3 Security actions / reviews paging | Phone change, password change, username editing, reviews cursor paging, and exact work counts on `/home` and `/home/profile`. |
| 4 #88's primary-phone guard coexists with phone changes | Journal begin takes `app.lock_phone`. A number another account has actively reserved can't become a new primary. A pending new or old number can't be reserved. Proven in pgTAP and in 10 concurrent races in each order. |
| 5 Email uniqueness on #88's schema | See row 3. Support release uses the new permission `contacts.support_release`. |
| 6 One password confirmation | `20261021090001` extends PR #88's `account_password_confirm` with `primary_phone.change`, `password.change`, `contact_email.set` and `contact_email.remove`. One 5-in-15-minutes budget per account. The rehearsal's per-action M2 gate is **not** imported. |
| 7 Keep #88, #89, #91 features | All 130 pre-existing pgTAP files still pass. |
| 8 Audit vocabulary | Actions are only ever added. A test asserts every main, #88, #91 and #96 action is still allowed. |

Main's old phone change (`rekeyLoginAlias`, an unjournaled Admin API call) is replaced by the journaled flow. The new database guard would refuse the old path anyway.

## Installer Settings (`/home/settings`)

- Installers now get the approved `/preview/installer-settings` design with real data.
- **Working:** display name; username; journaled sign-in phone change; password change; contact email via Resend (single-use link plus an explicit Confirm press); PR #88's secondary phone.
- **Shown as "Not available yet":** Google/Facebook linking, sessions, devices, recovery, MFA, notifications, suspend, delete.
- `/home/offers` loads (PR #88 removed the rc1 gate).

## Tests (all on the isolated stack)

| Suite | Result |
|---|---|
| pgTAP | 137 files, 6227 tests, PASS (436 new) |
| Phone-change concurrency | 28/28 PASS, including the new cross-mechanism race |
| Destructive-test target guard self-test | 87/0 |
| Typecheck | clean |
| ESLint (changed files) | 0 errors |
| Unit tests | full run green after fixes (the full re-run is part of the next step) |
| Live browser, real GoTrue | installer sign-up → phone change (alias re-keyed, journal `done/applied`, audited) → password change (other sessions ended, audited) → contact email (opening the link wrote nothing; Confirm verified it; audited) → `/home/offers` loads |

## Needs from you (when you get to it)

- **Resend for staging/prod:** `RESEND_API_KEY`, `EMAIL_FROM` (a verified sender) and `APP_PUBLIC_ORIGIN`. Until they're set, staging/prod fail closed; locally, mail is written to `frontend/.dev-mail/`.
- **Confirm #96's migration has NOT been applied to a hosted database** (see conflict 1).
