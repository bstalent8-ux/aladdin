# Organization governance (Phase 6+7, M1)

Status: backend implemented in `20261022090001_organization_governance.sql`, verified by
`supabase/tests/76_organization_governance_test.sql`. UI (M2), branches (M3) and independent
publishers (M4) are NOT part of this document's implemented scope.

## Three separate concepts

| Concept | Record | Granted by |
|---|---|---|
| A. User identity verification | email-confirmed caller (`app.require_verified_caller`) | sign-up |
| B. Organization approval | `organizations.status = 'active'` via a `verifications` row (subject `organization`) | Admin review |
| C. Independent professional commercial publishing | **not built yet** (M4) | Admin review |

A verified user is never an approved organization, and approval of one organization never
carries to another. Authorization asks the question that matches the operation.

## Organization Application

The application IS the existing `verifications` row (`subject_type = 'organization'`) - one
review system, not two. The organization row created at submit time is a **provisional,
non-operational** record: `status = 'pending_verification'`, `is_verified = false`.

States shown to the owner (`my_organization_applications()`):
`draft` -> `pending_review` -> `approved` | `needs_changes` (-> resubmit) | `rejected`.

Operational predicate: `app.org_is_approved(org)` = `organizations.status = 'active'`. Clients
cannot write `status`/`is_verified` (column grants); only the approval path does.

### A pending organization can
sign in, complete its profile, upload application documents, submit and track the review, and
prepare (draft) catalog content.

### A pending organization cannot
resolve a business audience (`app.org_product_audience`, `app.viewer_offer_audience`), view
restricted products/offers/images as a business, publish products or offers
(`can_publish_catalog`), create RFQs (`can_create_rfq`), respond to requests
(`can_respond_rfq`), decide quotations (`can_decide_quote`), appear in the public directory,
or have its published products/offers seen by anyone else. `my_workspaces()` lists it with
`is_approved = false` so the owner can track it; it is not an operational workspace.

## Approval is atomic

`review_approve` (existing Admin RPC, unchanged) fires an AFTER UPDATE trigger that applies an
approved organization verification in the same transaction. `apply_organization_verification`
remains as an idempotent no-op for already-applied rows, so the existing Admin UI keeps working.
Reviewer identity (`verifications.reviewer_id`) and an `organization.verified` audit event are
recorded. The owner membership already exists from submit time, so approval creates no duplicate
rows.

## Second and later organizations

`business_draft_save` (new draft) and `business_draft_submit` refuse unless the caller owns no
organization yet or already owns an **approved** one (`app.may_apply_for_organization`), under a
per-user advisory lock. Draft, pending, needs-changes and rejected first organizations all block
a second. There is deliberately **no maximum count**. Each additional organization needs its own
approval, and approved organizations stay usable while another is pending.

## Contractor and Engineer operating models

Contractor and Engineer remain two of the nine public accounts. `contractor_company` and
`design_office` are internal organization types reached only through this application path:
`contractor_company` by a Contractor (a Contractor persona may only open a contractor
organization), enforced in the draft RPCs and in `organization_create_owned`; the organizations
guard trigger still refuses every direct insert/update by a signed-in user.

## Application lifecycle (20261022090002-90004)

- **Statuses shown to the owner:** `draft`, `pending_review`, `needs_changes`, `rejected`, `approved`,
  `abandoned` (and `closed` for an organization archived by someone other than its owner). `cancelled` is
  the one new `verification_status` value: an application the APPLICANT closed.
- **Rejected is final for that application.** It cannot be resubmitted. The owner may **abandon** it: the
  rejected record (reviewer, reason, timestamps) is untouched, a separate `cancelled` record is added, the
  organization is **archived, never deleted**, and it stops counting toward the slot. A replacement first
  application can then be opened and must receive full Admin approval; the abandoned organization can never
  become operational.
- **Abandon is allowed** for a draft, a needs-changes or a rejected application, and refused while a decision is
  pending. Abandoning twice is a no-op.
- **One open additional application.** `app.application_slot(uid)` returns `first_available`, `first_pending`,
  `first_rejected`, `additional_available` or `additional_pending`. A new application opens only from the two
  `*_available` states. An application is "open" while its organization is pending and its latest review record is
  not rejected or cancelled, so draft, pending review and needs-changes all occupy the slot while a rejected or
  abandoned one does not. There is no cap on approved organizations.
- **Enforcement** is in `business_draft_save`, `business_draft_submit`, `organization_application_submit` and
  `..._abandon`, all under one per-user advisory lock. `organization_application_slot` is exposed to the UI only to
  explain a refusal. Proven by pgTAP 77 and by `supabase/tests/organization_application_concurrency_test.sh`
  (two real sessions: exactly one wins, the other is refused, one pending organization results).

## Security investigation (the authorization-bypass warnings)

Automated reviews flagged `20261022090001` and `20261022090003` without a scenario. Investigation, against the
isolated database and the real PostgREST interface as a signed-in user:

- **Confirmed and fixed: client-writable `organizations.org_type`.** The column was UPDATE-able by an organization's
  owner, so an approved Showroom could retype itself to Supplier (or an Engineering Office to Showroom) and take that
  audience with no review. Reproduced, then closed by revoking the column privilege; regression tests C1/C2 (pgTAP 77).
- **Hardened: `organizations.deleted_at`.** A client could not soft-delete only because the SELECT policy rejected the
  resulting row, an accident. Soft-deleting a pending application would have freed the one-open slot. The privilege
  is now revoked explicitly (C3b).
- **Removed a trust assumption: the `app.org_application` session setting.** It was only unreachable because
  PostgREST exposes no `set_config`. The contractor_company guard now keys on the executing role (`authenticated` /
  `anon` are refused; a vetted definer path is not); a client that sets any session setting gains nothing (C4/C5).
- **Verified, no change needed:** internal functions (`organization_create_owned`, `_apply_org_approval`, the audience
  resolvers) are not callable through the API (404); `review_approve` is refused to non-admins; direct writes to
  `verifications`, `onboarding_progress` and `business_creation_drafts` are SELECT-only for clients; every
  SECURITY DEFINER function pins `search_path`; a forged workspace cookie naming a pending organization resolves to an
  approved one.
- **Known limitations, stated rather than hidden:** (1) a co-owner (an invited member holding `org.manage`) of an
  approved organization counts as owning an approved organization, so they may start their own application, which
  still needs Admin approval; (2) an owner can rename an APPROVED organization (`name`, translations) without
  re-review, which is pre-existing profile editing; (3) a signed URL cannot be revoked, so its 5-minute lifetime
  bounds access after revocation, while a new grant or a re-signing after revocation is refused.

## Browser regression (small sequential batches)

`frontend/playwright.regression.config.ts` + `frontend/e2e/regression/*.spec.ts`: one worker, no retries, no
production build, reuses a running dev server (`E2E_PORT`, default 3026) and the isolated database
(`E2E_DB_CONTAINER`, default `supabase_db_aladdin_sr2`). Run one batch at a time, restarting the dev server between
batches on a low-memory machine:

    E2E_PORT=3026 pnpm exec playwright test -c playwright.regression.config.ts e2e/regression/a-showroom.spec.ts

Fixtures are built through real sign-ins, RPCs and Storage uploads (never service-role writes). Batches: A Showroom
Home / Browse / Details / My Products / Saved; B product form, audiences, image upload, workspace switching; C offers;
D direct RFQ, cross-organization access, English LTR / Arabic RTL; E 430px and 390px, Light and Dark; F signed URL
lifetime / expiry / refresh and denial after audience or membership revocation; G the organization application journey.

## Open decisions flagged for the owner

1. Registration-time Contractor / Engineer **organization** choice is implemented but stays behind the existing
   Coming Soon gate for those two accounts; enabling it is a product decision.
2. Whether an owner's edit of an approved organization's name should re-enter review.
3. Whether a co-owner of an approved organization should be able to open their own application (limitation 1).

## DEFERRED - approved contracts, intentionally not implemented

Nothing below has a schema, route, navigation entry or placeholder.

### Purchase Request matching (tags)
Access order: (1) account/audience eligibility, (2) specialties/categories/tags relevance,
(3) subscription entitlements. Tags and packages never bypass audience eligibility. Future tabs:
"مناسبة لك" (matching) and "كل الطلبات المسموحة" (all eligible). Matching considers request
ITEM categories/tags, not only the title. No fake badges or scores until requested.

### Quotation credits (shared Purchase Request responses only)
Not for direct RFQs, offers or product management. Browsing/opening/searching/revisiting and
drafting cost zero. One credit is consumed only by the first successfully submitted response to
a distinct request (full or partial). Revising a response, a validation failure, or a colleague
working on the same response costs nothing more. Credits are organization-level (an approved
individual Contractor/Engineer publisher may own an individual credit balance). Enforcement must
be atomic and idempotent. When credits run out, request details stay viewable. Refunds on
withdrawal, carryover, period length and Admin adjustments are undecided business questions.
The earlier "Request Unlock" concept is withdrawn.

### Admin-driven tags and subscriptions
Central Tags Library (add/rename/archive, propagate to linked accounts, compatible with the
fourteen Craftsman specialties) and configurable subscription/page management (packages, prices,
duration, entitlements, validated draft/preview/publish with audit history; a displayed feature
must match its enforced backend entitlement). A future standalone phase; not a general CMS.
