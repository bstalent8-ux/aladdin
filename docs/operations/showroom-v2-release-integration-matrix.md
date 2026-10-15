# Showroom V2 - release integration matrix (read-only checkpoint)

Status: **inspection only. No merge, rebase, reset, checkout, commit or edit was made in any other worktree.** Written 2026-10-14. Sources: `git worktree list`, `git status --porcelain` (read-only, no optional locks), `git merge-tree --write-tree` simulations (writes unreferenced objects only, never a working tree), `git ls-remote --heads origin` (no fetch). Production deployed commit was **not** inspected (no authorized production access in this session); treat `origin/main` `c7963c9` as the latest *merged* state, not as a proven production state.

## 1. Integration map

```
a33aa01 (merge base)
  |-- origin/main  c7963c9  (Oct 13)   +49 commits: registration (3), admin RBAC/users/operations migrations, installer jobs, staging CI
  |-- feature/showroom-fullstack-v2  61f527f  (Oct 14)   +101 commits, 48 migrations, 473 files
  |-- feature/cloudflare-r2-storage  43722a2  (Oct 13)   +31 / -28 vs main, 4 migrations
  |-- installer-production-finalization  (= main c7963c9, UNCOMMITTED work, 5 migrations)
  |-- feature/admin-core-*  (Oct 1, 9-44 commits, stale; its migrations are already in main)
  `-- registration: fix/business-registration-mandatory-onboarding ff62eb2, fix/business-review-legal-name 73bd355 -> both already contained in main
```

## 2. Matrix

| Worktree and branch | Latest commit | Uncommitted changes (owner) | Conflicts | Missing / colliding migrations | Approved features at risk |
|---|---|---|---|---|---|
| `D:/projects/aladdin-wt-showroom-fullstack-v2` `feature/showroom-fullstack-v2` | `61f527f` (101 ahead, 49 behind main) | `supabase/config.toml` (local isolation, intentionally unstaged) + untracked screenshot folders (this session) | **15 files vs main** (section 3) | lacks 27 main migrations; **6 version collisions**; 10 own migrations older than the newest on main/installer (section 4) | the 250-character Business Description in the wizard, the organization application lifecycle (Needs Changes -> Resubmit), the whole Showroom shell |
| `origin/main` | `c7963c9` | n/a | n/a | latest migration `20261011090003` | none (base) |
| Registration: `fix/business-registration-mandatory-onboarding`, `fix/business-review-legal-name` (`.codex/worktrees/business-*`) | `ff62eb2`, `73bd355` | **none; both worktrees clean and already merged into main** (ahead 0) | n/a | main has `20261010090001_business_registration_type_lock`, `20261011090001..3` (legal name, Egypt locations) | **main's wizard (mandatory first business, legal name, Egypt location) is the latest; it must be the base, never replaced by the older Showroom wizard** |
| Admin: `.claude/worktrees/admin-core-*`, `admin-blueprint-recovery` | `aa448d8`, `2cdbacd`, `bc16841`, `af55b2f` (Oct 1 and earlier) | none (clean). `scratchpad/redact-wt` shows 1,388 modified files = a damaged/sparse scratch checkout, **do not touch or commit** | direct vs main: 9 files (stale branches) | none missing: all their migrations are already in main | no live Admin UI worktree was found; Admin UI for the five review types (contract `showroom-v2-admin-integration-contract.md`) still has no owner location |
| `.claude/worktrees/showroom-approval-workflow-acd3de` | `2393334` (Sep 19, 141 behind) | **14 modified + 7 untracked incl. `app/admin/verifications/page.tsx`: an old Admin approval UI draft, only copy** (unknown owner) | not simulated | none | an unmerged Admin approval draft could be lost by cleanup |
| R2: `.worktrees/cloudflare-r2-storage` `feature/cloudflare-r2-storage` | `43722a2` (31 ahead, 28 behind) | `post105.spec.mjs` modified, `private-media-post105-purge.mjs`, `...cleanup-evidence.mjs` untracked (R2 owner; **purge script: do not run**) | vs main: 1 (`AGENT_WORK_LOG.md`); vs Showroom: 14 (portfolio-manager, `server/actions/portfolio.ts`, pgTAP 47, database.types, wizard files) | 4 not in main: `20261011104740`, `20261012083738`, `20261012144320`, `20261013094153` (all newer than main's latest, no collision with Showroom) | private-media delivery changes touch portfolio images; Showroom product-image signed URLs (5-minute) must stay compatible |
| Installer: `.codex/worktrees/installer-production-finalization` `feature/installer-production-finalization` | `c7963c9` = main | **24 modified + 29 untracked (phone-auth security, sensitive-action gate, reviews paging, personal settings identity card) and 5 migrations `20261014090001..05` + pgTAP 90-94** (Installer owner) | overlaps Showroom files: `personal-settings.test.tsx`, `i18n/messages/en.ts`, `ar.ts`, `types/database.types.ts` | **`20261014090001` collides** with Showroom `20261014090001_offer_helpers_least_privilege` | username/personal-settings work is here, not in Showroom |
| `backup/installer-experience-promotion-2026-10-13` | `27b1ab2` (7 ahead, 74 behind) | none | not simulated | not compared | snapshot branch, keep |
| `.codex/worktrees/showroom-commercial-suite-preview` `feat/showroom-commercial-suite-preview` | `5b3baac` (Oct 5, 55 behind) | **untracked `app/preview/showroom-suite-v2/` and `features/showroom-suite-v2/` (11 files): the original approved-design preview source, uncommitted** + 2 doc edits (unknown owner) | not simulated | none | the approved design reference `/preview/showroom-suite-v2` exists as uncommitted files in this worktree; the committed Showroom V2 route is a re-implementation in `features/showroom-shell` |
| `D:/projects/aladdin/Projects/aladdin` `feature/auth-password-preview` and `aladdin-dashboard-runtime` | `30c616a` / `a181cc0` (Sep) | 14 and 10 modified + 7 untracked (older auth-preview and installer-dashboard work, unknown owner) | not simulated | none | old drafts; confirm abandoned before any cleanup |
| CI worktrees (`staging-*`, `db-history-reconciliation`, `installer-jobs-work`, `installer-experience-pr-clean`, `cleanup`) | all clean | none | n/a | n/a | none |

**Registration finding:** no in-progress (uncommitted or unpushed) registration change exists in any local worktree, and `git ls-remote` shows no registration branch newer than what main already contains. If a registration session is running, its worktree is **outside** this repository's worktree list; I need its path or branch name to inspect it (read-only).

## 3. The 15 Showroom-vs-main conflicts (not resolved)

| # | File | Hunks | Class | Base for resolution |
|---|---|---|---|---|
| 1 | `frontend/src/features/onboarding/business-flow.tsx` | 2 | **Semantic, registration** (main: `BUSINESS_ORG_TYPES`, mandatory legal name, Egypt location; Showroom: `APPLICATION_ORG_TYPES`, 250-character description) | main's file; re-apply the description counter and application model on top |
| 2 | `frontend/src/server/actions/business-onboarding.ts` | 2 | **Semantic, registration** (main maps legal-name/city errors; Showroom adds slot errors and the description limit) | main's file; merge both error maps |
| 3 | `frontend/src/app/business/new/page.tsx` | 1 | **Semantic, registration** (main: mandatory first business routed one layer up; Showroom: application center, additional-business slots) | main's routing; keep Showroom's slot logic only where it does not contradict mandatory onboarding. **Needs a product decision.** |
| 4 | `features/onboarding/business-flow.test.tsx` | 1 | test follows #1 | follow #1 |
| 5 | `frontend/src/lib/i18n/messages/en.ts` | 1 | additive on both sides (main +84, Showroom +939) | mechanical union, keep both keys |
| 6 | `frontend/src/lib/i18n/messages/ar.ts` | 1 | same as 5 | same |
| 7 | `frontend/src/types/database.types.ts` | 2 | **generated**; never hand-merge | regenerate after migrations are renumbered and applied |
| 8 | `frontend/src/components/ui/controls.tsx` | 5 | shared primitive edited on both sides (main +161, Showroom +102): design-system risk | review by the design-system owner; Showroom Suite V2 look must survive |
| 9 | `frontend/src/components/ui/select.test.tsx` | 1 | test follows #8 | follow #8 |
| 10 | `frontend/src/features/jobs/job-form.test.tsx` | 7 | test follows #8 (select/controls) | follow #8 |
| 11 | `features/organization/branch-identity-dialog.test.tsx` | 1 | test, 2-line each side | mechanical |
| 12 | `features/organization/organization-identity-dialog.test.tsx` | 1 | test | mechanical |
| 13 | `features/sales/customer-ownership-form.test.tsx` | 5 | test follows #8 | follow #8 |
| 14 | `features/settings/personal-settings.test.tsx` | 1 | test; also touched by the uncommitted Installer work | resolve after the Installer lands |
| 15 | `docs/operations/AGENT_WORK_LOG.md` | 1 | append-only doc | keep both entries |

Summary: 3 semantic (registration), 1 design-system, 1 generated, 2 mechanical i18n, 6 test files that follow their component, 1 append-only doc, plus the personal-settings test shared with the Installer. R2 -> main has 1 conflict (`AGENT_WORK_LOG.md`).

## 4. Migrations (the blocker that is not a text conflict)

* **Six version collisions** (same version, different file; Supabase versions must be unique): `20261007090001`, `20261007090002`, `20261007090003`, `20261010090001`, `20261011090001` (Showroom vs main) and `20261014090001` (Showroom vs the uncommitted Installer migration).
* `origin/main` CI policy (`scripts/migration-policy.mjs`) **fails any PR migration older than the newest on the base branch**. Showroom has 7 migrations older than main's latest (`20261011090003`), 9 older than R2's newest, 10 older than the Installer's newest (`20261014090005`).
* The 48 Showroom migrations are local-only (pending, not applied on any hosted database as far as this session knows), so renumbering them after the newest migration of everything merged first is allowed; applied migrations must never be renumbered. **Confirm that nothing from this list was applied to staging.**
* 27 main migrations are missing on the Showroom branch (admin RBAC / users-organizations / operations, jobs/saved searches/place catalogue, registration type lock, legal name and locations). pgTAP file numbers also overlap (66-84, 86) with different file names; harmless to execution but should be renumbered for sanity.
* Dependencies to preserve when renumbering: my 48 are internally ordered; they must keep their relative order and stay after main's `20261011090003`. Several (`organization_application_*`, `organization_description_250`) read objects that main's registration migrations also change, so a full `db reset` plus the whole pgTAP suite is required after the merge, before any browser spec.

## 5. Safe integration order (proposal, nothing executed)

0. **Protect first** (owners, not me): commit or bundle the uncommitted work in the Installer, R2, `showroom-commercial-suite-preview`, `showroom-approval-workflow` and `auth-password-preview` worktrees; do not run `git clean`, `reset`, `worktree remove` or the R2 purge script anywhere.
1. **Installer finalization** (closest to main, based on main) lands first: its 5 migrations become the newest on main.
2. **R2 storage** second (1 doc conflict with main); its 4 migrations are already newer than main's latest.
3. **Registration**: nothing to integrate (already in main). It is the **base** for step 4.
4. **Showroom V2 last**, on a fresh branch from the new main: renumber the 48 migrations after the newest migration of steps 1-2, re-apply the Showroom changes onto main's registration wizard (conflicts 1-4), regenerate `database.types.ts`, union the i18n files, review `controls.tsx` with the design-system owner, then `supabase db reset`, full pgTAP, the concurrency scripts, then the browser batches A-O one at a time.
5. **Admin UI** after (or in parallel in its own branch) against the contract; no Admin file is touched by Showroom.
6. Hosted staging (B7): backup and restore drill, apply the pending migrations, CRITICAL set, stale-call check, real mail and Turnstile verification. Only then a go/no-go.

## 6. Launch issues flagged for their owners (observed; not fixed here)

| Issue | Evidence | Owner / where |
|---|---|---|
| Admin approval delegation and backend authorization | `review_*` and `review_context` allow `app.is_platform('support')` (support, moderator, administrator); revocation is administrator-only; D-A1 still undecided | Admin / backend owner, decision D-A1 |
| Invitation revoke, audit, token security, sign-up continuation | There is **no `invitation_revoke` RPC** (only `invitation_create/_accept/_lookup`); the token is stored **in clear** (`organization_invitations.token`, 192-bit random, 14-day expiry) rather than hashed; `invitation_create` writes no audit row and no `audit_log` action mentions an invitation (accept audits the resulting membership only); an invited person without an account has no tested sign-up continuation (my batch L used existing users) | Team/Invitations owner |
| Misleading invitation email message | `"Invitation sent by email."` exists in `en.ts`, no email is ever sent (link is shown to the manager) | Copy decision (remove, or build delivery) |
| Turnstile hostname/action verification | `server/auth/turnstile.ts` posts only `secret` + `response` (+ IP) and accepts any `success: true`; the response `hostname` and `action` fields are never compared | Auth owner; identical on main |
| Potential legacy OTP entry-point bypass | `server/actions/auth.ts` is a `"use server"` file that still exports `requestSignUpOtp` (`signInWithOtp` with `shouldCreateUser: true`) and `requestEmailOtp`, **with no Turnstile check**; `/auth/recovery` still mounts the legacy recovery form (`requestEmailOtp`). An exported server action is callable without its page. Identical on main (pre-existing, likely in production) | Auth owner; high priority |
| Hosted SMTP and OTP verification | Only the local inbox was exercised (batch N); real provider delivery and production Turnstile keys are unverified | B7 staging |
| D-A3 queue order, D-A4 rejected-request behavior | decisions still open | Product owner |
| Username editing in Personal Settings | not in the Showroom shell (only registration sets it; RPC rules tested); the Installer worktree is editing the identity card | Installer owner / product decision |

## 7. Review of the SQLSTATE regression guard

Verdict: **correct in intent, too broad in mechanism; narrow it (needs approval, nothing changed).**

* Today `86_version_conflict_sqlstate_test.sql` (and the migration's closing check) fail if the text `40001` appears **anywhere** in a `public`/`app` function definition. That would also trip on a comment or message that merely mentions it, and it would forbid a future function that **deliberately** surfaces a retryable failure (for example, catching `lock_not_available` or `serialization_failure` and re-raising it so the client retries).
* It does **not** ban PostgreSQL's own serialization failures: the engine raises those itself, they never appear in a function body, and the clients still receive 40001 for them.
* Proposed narrowing: fail only when a function **raises** 40001 (`errcode = '40001'` or `sqlstate '40001'` inside a `raise`, comments stripped) **and** has an optimistic-concurrency signal (a `p_expected_version` / `p_expected_updated_at` parameter, or the text `modified concurrently`); allow an explicit reviewed marker `-- retryable-ok: <reason, 15+ characters>` for a genuine retry design; keep the positive check that the 32 audited functions raise VC001 exactly once. Same shape as the repo's existing `migration-policy` marker mechanism.

## 8. Decisions and access needed

1. Path or branch of the **in-progress Registration session** (not in the worktree list) for a read-only comparison; confirm main's wizard is the base.
2. Confirm **no Showroom migration was applied to staging** (allows renumbering) and who renumbers (recommended: this session, on a fresh branch from the post-Installer main).
3. Integration order (section 5), and who owns the Installer and R2 commits.
4. Product decision on `/business/new`: mandatory-first-business (main) versus the application/slot model (Showroom) where they overlap.
5. Approve narrowing the regression guard (section 7).
6. Owners and fate of the unmerged drafts: `showroom-approval-workflow` (Admin verifications page), `showroom-commercial-suite-preview` (original design source), `auth-password-preview`.
7. Read-only access to production (deployed commit, applied-migration list) to replace the assumption that production equals `c7963c9`.
8. Priority and owner for the Turnstile hostname/action check and the legacy OTP server actions (pre-existing on main).
