# M4b - independent seller transactions: implementation plan (NOT implemented)

Status: plan only. M4a (publisher identity, ownership, approval/revocation, rollout gate) is implemented and
committed locally; M4b needs explicit approval. Organization commerce must stay exactly as it is today.

> **ERRATUM (frontend reality audit checkpoint).** Section 4 says the buyer side "stays organization-or-personal as it is". That is wrong for Direct RFQs: `rfqs`, `quotations`, `orders`, `projects` and `conversations` all have `requester_org_id NOT NULL` (see the table in section 2), so the buyer side is organization-only today. The approved rule (eligible personal buyers may send Direct RFQs to independent sellers) requires a buyer party identity as well as the seller one. The corrected scope and the frontend plan are in `docs/frontend/m4-frontend-completion-roadmap.md`. Business decisions A-D recorded there are final; items under section 8 that they do not cover remain open.

## 1. Where M4a leaves independent sellers

An approved independent Contractor/Engineer can create, edit, publish products and offers, upload images and
see them privately. Other people see nothing while `platform_flags.independent_commerce` is off. When it is on
(isolated tests only) a buyer can discover an independent product/offer, but **cannot request anything**: the
detail screens show "Requests to this seller are not available yet", Direct RFQ refuses the product
(`add_rfq_item` requires `products.organization_id = rfqs.supplier_org_id`). That incompleteness is the reason
public launch is blocked.

## 2. Existing organization-only assumptions (verified in the schema)

| Table | Column(s) | Nullable | Meaning today |
|---|---|---|---|
| `rfqs` | `requester_org_id`, `supplier_org_id` | NO / NO | Direct RFQ to a supplier organization |
| `quotations` | `requester_org_id`, `supplier_org_id` | NO / NO | the supplier's quote |
| `orders` | `requester_org_id`, `supplier_org_id` | NO / NO | binding order created from a quotation |
| `projects` | `requester_org_id`, `executing_org_id` | NO / NO | created from an order |
| `conversations` | `requester_org_id`, `supplier_org_id` | NO / NO | buyer/seller chat |
| `notifications` | `organization_id` | org-addressed (`app.notify_org`) | |
| `points_ledger` | `organization_id` | | referral points |
| `purchase_requests` | `requester_org_id` | **YES** (`requester_user_id` NOT NULL) | individual requesters are ALREADY supported |
| `purchase_request_responses` | `responder_org_id` | **NO** | responders are organizations only |

Functions that read these (24): `create_rfq, add_rfq_item, submit_rfq, cancel_rfq, create_quotation, update_quotation,
submit_quotation, decide_quotation, create_order_from_quotation, start_order, cancel_order, create_project_from_order,
activate_project, complete_project, open_conversation, send_message, mark_conversation_read,
app.conversation_parties, app.assert_can_edit_quotation_draft, showroom_home_metrics,
purchase_request_response_save / _withdraw, purchase_requests_discover, purchase_request_detail,
app.response_json, app.request_readable_by_workspace`. RLS policies: `rfqs_select_supplier`,
`quotations_select_supplier`, `orders_select_supplier`, `projects_select_executing`, `conversations_select_party`,
`prr_select_responder`, `prri_select_responder`. Frontend: 19 files reference `supplier_org_id` /
`supplierOrgId` / `responder_org_id`.

## 3. Purchase Request ownership finding (required by the task)

* **Requester side is already individual-capable.** `purchase_request_save(p_org_id, ...)` accepts `p_org_id = null`
  (personal workspace, audience from the persona), `requester_org_id` is nullable and `requester_user_id` is the
  durable owner. No fake organization is used. This is not a new decision.
* **Responder side is organization-only.** `purchase_request_responses.responder_org_id NOT NULL`,
  `purchase_request_response_save(p_org_id, ...)` requires org membership and `can_respond_rfq(org)`, and
  `prr_select_responder` is org-based. Independent Contractors/Engineers (and Craftsmen) therefore cannot RESPOND
  to a Shared Purchase Request as individuals. This gap is **not touched by M4a**; the visibility matrix, the
  responder-audience matrix and the credit rules are unchanged.
* To complete (M4b/M5 dependency, needs approval): a responder identity of "organization XOR user" (or the
  publisher identity for independent professionals), with the same exclusive-or constraint and a user-scoped
  RLS branch. Quotation credits (documentation only) will need an individual entitlement owner for the same
  reason - do not build a ledger before that identity exists.

## 4. Proposed design

Generalize the **seller side** only, with the same XOR pattern M4a used for ownership:

* `rfqs, quotations, orders, conversations`: add `supplier_publisher_id uuid NOT NULL` (backfilled from the
  organization publisher; `supplier_org_id` becomes nullable and NULL for independents); composite FKs so an
  order's quotation, a quotation's RFQ and an RFQ's items all name the same publisher; immutable owner trigger
  (reuse `app.enforce_publisher_ownership`).
* `projects.executing_org_id` -> `executing_publisher_id` likewise (an independent professional executing work).
* Authority: replace `has_capability(supplier_org_id, ...)` with `app.can_act_as_publisher(...)` helpers
  (organization: unchanged capabilities; independent: owner + active publisher + persona).
* Buyer side stays organization-or-personal as it is; `add_rfq_item` compares `products.publisher_id`
  to `rfqs.supplier_publisher_id` instead of organizations.
* Notifications: `app.notify_publisher(publisher, ...)` (organization -> existing `notify_org`; independent ->
  the user). Points/referrals untouched.
* Chat: `conversation_parties` returns a party that is an organization or a publisher; message authorship stays a user.
* Revocation: new RFQs/quotes/orders against a non-active publisher are refused; existing records stay readable by
  both sides; no automatic cancellation of binding orders (a decision for the owner).
* Frontend: remove the "requests not available yet" note when the gate opens; request-quote CTA, supplier-side
  inboxes, order/project/chat screens resolve the acting publisher (explicit, per request, re-verified by the DB).

## 5. Migration strategy

Expand/contract as M4a: (1) additive columns + backfill + validation (abort on unmappable rows), (2) dual
authority helpers with organization behaviour identical (existing pgTAP 23, 26, 27, 32, 68-75 must pass
unchanged), (3) policies and views, (4) frontend behind the closed gate, (5) contract later. Rollback = redefine the
previous functions/policies; additive columns stay. Kill switch: `platform_flags.independent_commerce = false`.

## 6. Authorization and privacy concerns

Supplier identity on RFQs must not reveal a professional's contact data before the buyer's own rules allow it;
private prices stay out of every buyer read model (including quotation snapshots); an independent seller must not
see another publisher's RFQs through `supplier_publisher_id` guessing (RLS on the publisher, not the id); a person
who is both an organization member and an independent publisher must act as exactly one identity per request;
no audience union.

## 7. Test fixtures / matrix

Independent seller approved + buyer organization + personal buyer; full RFQ -> quote -> order -> project -> chat
journey as independent and as organization (organization results identical to today); suspended/revoked mid-flow;
cross-publisher denial; two-session races (revoke vs submit quotation); Light/Dark, 390px, Arabic RTL; Playwright
small batches reusing the regression harness.

## 8. Unresolved decisions (not invented here)

1. What happens to OPEN binding orders/projects when an independent publisher is revoked (keep, cancel, freeze).
2. Whether an independent seller may receive Direct RFQs from personal (non-organization) buyers, or only organizations.
3. Individual Shared Purchase Request responders: model (user vs publisher identity) and who may respond.
4. Payment, commission, settlement, contract and fulfilment policies for individuals - explicitly not designed.
5. Whether an independent professional's public display name may differ from their profile name.

## 9. Public-launch blockers (all must be cleared and explicitly approved)

* M4b implemented and its full journey (RFQ -> quotation -> order -> chat -> notifications) browser-tested.
* Individual Purchase Request responder support decided and delivered (if independents are to respond).
* Admin reviewers can inspect the evidence for `independent_publisher`, `co_owner`, identity and branch reviews in the
  Admin UI (today only the backend `review_context()` exists; the Admin queue shows the raw type string).
* Admin UI actions for suspend / reinstate / revoke (backend RPCs exist; no UI).
* Owner decision to flip `independent_commerce` and to open Contractor/Engineer registration (both still Coming Soon).
* M5 (eight-audience unification, Box/Carton) and M6 closeout; independent offers management UI (backend only today).
