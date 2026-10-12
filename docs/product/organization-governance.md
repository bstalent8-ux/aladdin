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

## Open decisions flagged for the owner

1. A **rejected** first organization still blocks a second. Is that intended, or should a
   rejected application be abandonable (closing it frees the slot)?
2. Several organizations may be pending at once once one is approved (no cap). Confirm, or
   limit to one pending application at a time.
3. Registration-time selection of Contractor/Engineer "organization" (M2) needs
   `onboarding_select_account_type` to accept `contractor_company`; not changed in M1.

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
