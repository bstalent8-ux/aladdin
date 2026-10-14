# Showroom V2 - Admin integration contract (B1, Option A)

Status: handoff for the separate Admin workstream. Written 2026-10-14 from the live local database (`aladdin_sr2`, schema at `20261026090003`). Nothing here edits Admin pages or another worktree; the Admin UI is out of scope for this branch.

**Decision recorded:** Option A is approved. The release keeps the organization, identity-change, public-branch and co-owner request flows. They ship only if an Admin can review each of them. The backend is complete and tested; what is missing is the reviewer surface (section 8).

## 1. One review engine for every type

All five review kinds are rows of `public.verifications`, decided through the same four RPCs. There is no second queue and nothing for the frontend to authorize.

| RPC (all `security definer`, `authenticated`) | Effect |
|---|---|
| `review_context(p_verification_id) -> jsonb` | **The evidence payload.** Reviewer-only. Returns `id, type, status, reason, submitted_at, decided_at, reviewer_id, metadata`; `organization` (id, name, name_ar, name_en, slug, org_type, status, is_verified, created_by); `person` (id, email, display_name, persona, is_member) for the requester or candidate; for `branch_location` a `branch` block (`current`, `approved_public`, `is_active`); and `history` (earlier decisions of the same kind for the same subject) |
| `review_start(p_verification_id)` | `submitted -> under_review`; assigns the calling reviewer |
| `review_approve(p_verification_id, p_grant_public_listing)` | `under_review -> approved`; **only the assigned reviewer**; a reviewer may not approve their own verification or one of an organization they belong to (`42501`); an AFTER trigger applies the effect (section 3) |
| `review_reject(p_verification_id, p_reason)` | `under_review -> rejected`; reason required |
| `review_request_changes(p_verification_id, p_reason)` | `under_review -> needs_more_info`; applicant sees `reason` and may resubmit |

Status values: `draft, submitted, under_review, needs_more_info, approved, rejected, expired, cancelled`. Decided rows (`approved/rejected/expired`) and applied rows are immutable (guard trigger `guard_verification_update`).

Read access for the queue: platform reviewers can select all `verifications` rows (RLS `verifications_select_platform`); applicants see only their own subject rows.

## 2. Reviewer authorization (implemented, not frontend)

* Deciding (`review_*`, `review_context`): `app.is_platform('support')`, which is true for `support`, `moderator` and `administrator` (`platform_role_grants`).
* Revocation / recovery: `administrator` only (section 4).
* **Decision needed (D-A1):** should `support` be allowed to approve, or only `moderator` and above? Today a `support` grant can approve and reject. This is a policy change in `review_*`, not in the UI.

## 3. Review types

For each type: who files it, what the Admin must see, allowed decisions, the effect on approval, and where the result shows up for users.

### 3.1 Organization application (`verification_type = organization`)
* **Filed by:** the owner, through `/business/new` then `organization_application_submit(p_org_id)`; one open application at a time (first or additional slot).
* **Admin sees:** `organization` block (legal/display name, `org_type`, description <= 250 chars, status `pending_verification`), `person` (applicant), `history`. **Gap:** there is no document upload; the only evidence in the system is what the applicant typed (names, type, description, primary branch, location). See D-A2.
* **Decisions:** approve / reject (closed, applicant may abandon and start a new application) / request changes (applicant resubmits; fixed in migration `20261026090003`, before it every Resubmit failed).
* **On approve:** `_apply_org_approval` sets the organization `active` and verified, activates the owner membership; the Showroom workspace opens (`/preview/showroom-suite-v2/home`). `p_grant_public_listing` is the public-directory switch for the approved organization.
* **User-facing propagation:** `my_organization_applications()` (status, reviewer note, `can_submit`, `can_abandon`), `my_workspaces()` (`is_approved`), workspace switcher, `/business/applications`, notification `verification.approved|rejected|changes_requested` to holders of `org.manage`.
* **Tests:** pgTAP 77, 76, 80; browser `g-org-application-flow`, `n-first-registration` N3/N4 (request changes, resubmit, approve, workspace opens).

### 3.2 Approved organization identity amendment (`organization_identity`)
* **Filed by:** an active organization's `org.manage` holder, `organization_identity_change_request(p_org_id, p_name, p_name_ar, p_name_en, p_slug)`; withdrawable with `organization_identity_change_withdraw`.
* **Admin sees:** `metadata.previous` and `metadata.proposed` (name, Arabic name, English name, public address/slug), `metadata.requested_by`, the live `organization` block, `history`. Show current vs requested side by side.
* **Decisions:** approve / reject / request changes.
* **On approve:** `_apply_identity_change` writes the new names / slug on the organization (slug uniqueness is enforced at apply time). A pending request keeps the old names public.
* **Propagation:** `organization_identity_state(p_org_id)` drives Showroom Settings > Business (pending, approved, rejected, latest outcome), the organization name everywhere else follows the record.
* **Tests:** pgTAP 76, 78, 80; browser `h-governance`, audit `m3`.

### 3.3 Public branch verification and amendments (`branch_location`)
* **Filed by:** `branch.manage` / `org.manage` holder, `branch_verification_request(p_branch_id)`. Refused unless the organization is approved, the branch is active, an address exists and something differs from the approved public identity.
* **Admin sees:** `branch` block from `review_context`: `current` (what the owner submitted) against `approved_public` (what is public today), plus `metadata.previous/proposed`, `branch_id`, requester.
* **Decisions:** approve / reject / request changes.
* **On approve:** `_apply_branch_location` publishes the branch's public identity (`branches.public_identity`). Until then the branch stays private/unverified in every public view.
* **Revocation:** `branch_verification_revoke(p_branch_id, p_reason)` (administrator) removes public verification.
* **Propagation:** Showroom Settings > Branches (state per branch), public directory views.
* **Tests:** pgTAP 78 (+ concurrency script `governance_concurrency_test.sh`); browser `h-governance`.

### 3.4 Verified co-owner / partner (`co_owner`)
* **Filed by:** the candidate (an active member), `org_co_owner_request(p_org_id, p_note)`; refused for the founder, for an existing verified co-owner and for a non-approved organization.
* **Admin sees:** `person` (candidate: name, email, persona, `is_member`), `metadata.note` (<= 500 chars), `metadata.candidate_user_id`, the `organization` block, `history` for the same candidate. **Gap:** a note is the only evidence; see D-A2.
* **Decisions:** approve / reject / request changes.
* **On approve:** `_apply_co_owner` inserts `org_co_owners (organization_id, user_id, verification_id, verified_by)` after re-checking that the organization is active and the candidate is still an active member. It does **not** grant `org.manage` or any capability: a verified co-owner is a public trust marker, capabilities stay with the Team page rules.
* **Revocation:** `org_co_owner_revoke(p_org_id, p_user_id, p_reason)` (administrator).
* **Propagation:** `my_co_owner_state()`, Showroom public identity, Settings.
* **Tests:** pgTAP 78; browser `h-governance`.

### 3.5 Independent publisher approval (`independent_publisher`) - roadmap, gated
* **Filed by:** a Contractor or Engineer, `independent_publisher_request(p_note)`; **independent commerce stays gated** (platform flag `independent_commerce`, currently `false`) and Contractor/Engineer public registration remains Coming Soon, so no real request can arise at launch.
* **Admin sees:** `person`, note, persona. **On approve:** trigger `verifications_apply_publisher_approval` runs `_apply_independent_publisher` and activates the publisher record.
* **Recovery:** `publisher_suspend`, `publisher_reinstate`, `publisher_revoke` (administrator).
* **Launch blocker:** none for the Showroom release; the Admin surface can follow with M4b.
* **Tests:** pgTAP 79, concurrency `publisher_concurrency_test.sh`; browser `i-independent-publishers`.

## 4. Audit history

Every transition writes `public.audit_log` (`action`, `subject_type`, `subject_id`, `organization_id`, `actor_user_id`, `actor_role`, `metadata`): `verification.review_started|approved|rejected|changes_requested`, `organization.application_submitted|abandoned`, `organization.identity_change_requested|withdrawn`, `organization.identity_changed`, `organization.co_owner_requested|verified|revoked`, `branch.verification_requested`, `branch.verified`, `branch.verification_revoked`, `publisher.requested|approved|suspended|revoked|reinstated`. `review_context.history` gives the per-subject decision trail; the global feed is `/admin/audit`. A resubmission keeps the original `submitted_at`; its time is the `organization.application_submitted` audit event.

## 5. Status propagation checklist (what the Admin decision must change, verified by the browser specs)

| Decision | Must become visible to the applicant |
|---|---|
| request changes | reason on `/business/applications`, Resubmit enabled, nothing granted |
| approve (organization) | workspace in the switcher, Showroom Home opens, notification |
| approve (identity) | new names in Settings > Business and across the workspace |
| approve (branch) | branch shown as verified/public in Settings > Branches |
| approve (co-owner) | verified co-owner marker on the Showroom identity |
| reject | reviewer reason shown, application closed / abandonable, no access |

## 6. Required reviewer evidence per type (minimum for the Admin screen)

1. Type name in plain language (never the raw `verification_type` string; the current queue shows raw strings).
2. Applicant: display name, email, persona, relationship to the organization (`person`).
3. Organization: names, type, status, creation date (`organization`).
4. The proposal: for amendments, **current vs requested** (`metadata.previous` / `proposed`, `branch.current` / `approved_public`).
5. Applicant note, previous decisions (`history`), who is assigned (`reviewer_id`).
6. Decision controls matching the state machine only (start -> approve / reject / request changes), reason mandatory for reject and request changes.

## 7. Integration tests (Admin workstream owns the UI half)

Backend, already green: pgTAP 76-80 and the concurrency scripts (`governance`, `organization_application`, `publisher`). Browser, to add with the Admin UI: one journey per type driven through the Admin screen instead of the RPC (the existing specs use the real Admin RPCs as the reviewer): approve, reject, request changes, reviewer cannot approve their own, `support` vs `administrator` rights, queue shows the evidence block, applicant-side propagation from section 5.

## 8. Launch blockers and dependencies on the Admin workstream

| # | Item | Blocks release? |
|---|---|---|
| 1 | Admin queue has no `review_context` evidence panel; types shown as raw strings | **Yes** (Option A) |
| 2 | No "request changes" action in the Admin UI (backend ready) | **Yes** - without it an applicant can only be rejected |
| 3 | Per-type detail: current vs requested for identity and branch | **Yes** |
| 4 | Co-owner and branch revoke controls (administrator) | No for first launch, needed for recovery |
| 5 | Independent publisher panel | No (feature gated) |
| 6 | Browser journey per type through the Admin UI | Yes (acceptance) |

## 9. Decisions requested from the owner

* **D-A1** Which platform roles may approve? (today `support`, `moderator`, `administrator`).
* **D-A2** Evidence policy: the application collects typed information only (no commercial register or ID upload exists). Is that acceptable for launch, or must document upload be added first? Adding it is new scope and a storage-policy change.
* **D-A3** Should the queue order reflect resubmission time? Today a resubmitted application keeps its original position because `submitted_at` is immutable.
* **D-A4** Should a rejected organization application ever be reopened by an Admin (today it is closed and the applicant starts a new one)?
