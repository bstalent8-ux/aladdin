# Phase 6 + 7 — Commerce & Network: architecture audit (read-only)

Branch `feature/showroom-fullstack-v2`, runtime `aladdin_sr2`. Nothing in this document is implemented yet.
Status words: **implemented** (works, reusable as-is), **partial** (exists, needs an adapter or extension), **absent**.

## A. What exists

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Purchase Request (internal need) | **absent** | no table/RPC/view; `20261007090003` removed the `open_purchase_requests` figure because it had been computed from `rfq_list` | `rfqs` is NOT a purchase request: it is one requester -> exactly one supplier, created to be sent. |
| RFQ (outgoing / incoming) | **implemented** | `rfqs`, `rfq_items`, `create_rfq`, `add_rfq_item`, `submit_rfq`, `cancel_rfq`, `rfq_list` (`20260810090001`) | statuses `draft/submitted/quoted/closed/cancelled`; `ck_rfqs_distinct_orgs`; items snapshot name/unit and keep a soft `product_id`. |
| Quotation (received / sent) | **implemented** | `quotations`, `quotation_items`, `create_quotation`, `set_quotation_item_price`, `submit_quotation`, `decide_quotation`, `quotation_list` | one live quotation per RFQ (`uq_quotations_rfq_live`); draft private to supplier; requester sees it only once submitted. |
| Purchase order | **implemented** | `orders`, `order_items`, `create_order_from_quotation`, `start_order`, `cancel_order`, `order_list` (`20260811090001`) | one order per accepted quotation; only the buyer commits; lines frozen from the quotation. |
| Capabilities | **implemented** | `rfq.create`, `rfq.respond`, `quote.submit`, `quote.decide`, `order.create`, `order.manage`, `job.post`, `job.manage`; `org.manage` is a super-key | showroom nav already filters on them (`navigation.ts`). |
| Private product price | **implemented** | `product_prices` (own-org SELECT only, RPC-only writes, `20261010090001`) | quotation prices are a separate, per-RFQ number owned by the quotation; they never read `product_prices` of the other side. |
| Supplier discovery | **partial** | `organization_public_directory` (verified/active orgs, no contact columns), `listOrganizations` (hard `LIST_LIMIT`, no pagination), legacy `/b2b/suppliers` | supplier org types: `supplier`, `manufacturer`, `importer` (`wholesaler` remapped to `supplier`, `20260924090004`). No contact projection exists. |
| Craftsman discovery | **partial** | `profile_public_directory` (listed, active personal profiles; display name, headline, bio, locality, languages), trades taxonomy, availability, portfolio, reviews | no contact fields, no org context; no contact-visibility setting anywhere (`contacts` table is user-private WhatsApp/email). |
| Network referrals | **partial** | `network_referrals` (`known_organization` resolves instantly, `new_showroom` goes `pending` -> admin approve/reject, Points only on approved NEW org) | covers **showrooms only**, and requires a *personal professional* referrer. Not usable by a showroom, and has no supplier or craftsman candidate type. |
| Sales-affiliation referrals | n/a | `organization_referrals` / `organization_join_requests` | closed to non-sales personas by `20260831090001`; must not be reused. |
| Jobs / applications | **implemented** | `jobs`, `job_applications`, `job_assignments`, `job_create/publish/close/...`, `open_job_opportunities` (installer pool, verified posters only) | `can_post_job` = `job.post`; `can_manage_job` = `job.manage`. Discovery view is installer-oriented (has_applied, personal). |
| Showroom shell routes | **absent** | suppliers, craftsmen, jobs, purchase-requests, pricing-requests-sent, quotes-received, purchase-orders, customer-rfqs, customer-quotes all fall to the generic "not available yet" `[page]` route | navigation + capability gating already exist. |
| Legacy /b2b UI + actions | **implemented** | `app/b2b/{rfqs,quotations,orders,suppliers,jobs}`, `features/commerce/*`, `server/actions/commerce*.ts`, `server/queries/commerce.ts` | working reference for the data layer; presentation is the old shell, so showroom needs adapters, not copies. |

## B. Gaps that matter

1. **Purchase Request** has no entity. It must be new, and must stay distinct from RFQ.
2. **Contact visibility** has no model for organizations or craftsmen. Showing a phone number is a privacy decision, not a column.
3. **Referral/review** supports only "a professional refers a showroom". Needs a supplier/craftsman candidate path that a *showroom* organization can submit, with its org preserved.
4. **Directory pagination** is a hard limit, not bounded server-side paging.
5. **Job discovery** is built for installers; a showroom needs (a) its own posted jobs and (b) browse of open jobs with its poster/applicant roles.
6. **Cross-account fixtures** (a supplier org that can answer an RFQ from the showroom) must be created in `aladdin_sr2` only.

## C. Proposed design (for approval, nothing built)

### Purchase Request — SUPERSEDED
The internal-only model proposed in revision 1 is withdrawn. See **Revision 2** below.

### Contact visibility (new, additive)
- Organization: `organization_contact_settings` (`show_phone`, `show_whatsapp`, `show_email`, default **all false**) and a SECURITY DEFINER reader behind a security_invoker view that returns a contact only when the owner opted in AND the viewer is an authenticated member of a business org.
- Craftsman: same idea on the profile, default hidden; reuses verified `contacts` values, never raw user data.

### Referral/review for unregistered supplier or craftsman
- Extend `network_referrals` with a `candidate_kind` (`showroom | supplier | craftsman`) and a nullable `submitted_by_org_id`; relax the personal-professional-only guard for a showroom member holding a defined capability. No Auth user is created, status starts `pending`, **zero Points until admin approval** (reuse the existing `referral.organization_approved` event; craftsman approval event is a decision, below).

### Sales side
- No new RFQ backend. `customer-rfqs` = `rfq_list` where `supplier_org_id = org` and status `<> draft`; `customer-quotes` = `quotation_list` where `supplier_org_id = org`. Buying side is the mirror. Adapters only.

### Jobs
- Reuse `jobs` tables. Add one read projection for a business viewer (open jobs from other verified posters, plus the showroom's own postings) with bounded pagination.

## D. Migrations proposed (none written)

1. (withdrawn - see Revision 2, section R7)
2. `contact_visibility` for organizations and craftsmen + `supplier_directory` / `craftsman_directory` projections (paged, filterable, case-insensitive search).
3. `network_referrals` candidate kinds + org attribution + approve/reject paths for supplier/craftsman (no Auth user).
4. `business_job_opportunities` read projection.
5. pgTAP: cross-tenant isolation, price visibility, capability denials, no-points-before-approval, no-self-RFQ.

## E. Routes (showroom suite, `/preview/showroom-suite-v2/...`)

`suppliers`, `suppliers/[orgId]`, `craftsmen`, `craftsmen/[profileId]`, `jobs`, `jobs/[jobId]`, `purchase-requests` (+ `new`, `[id]`), `pricing-requests-sent` (+ `[id]`), `quotes-received` (+ `[id]`), `purchase-orders` (+ `[id]`), `customer-rfqs` (+ `[id]`), `customer-quotes` (+ `[id]`), plus "suggest a supplier/craftsman" entry points.

## F. Order and dependencies

1. Contact-visibility + directory projections (unblocks Network).
2. Suppliers, Craftsmen pages (UI blocked on references, see below).
3. Referral/review extension.
4. Purchase Requests (new entity).
5. RFQ sent / quotes received / purchase orders adapters.
6. Customer RFQs / quotations sent adapters.
7. Jobs integration.
8. Cross-account pgTAP + browser E2E (showroom -> supplier -> quotation -> accepted -> order).

## G. UI references

Existing: showroom `my-products`, `offers`, `points`; Installer-Technician `02-job-opportunities`, `06-showroom-network`; legacy Distributor set (old theme, composition only). **Missing:** a dedicated Suppliers directory, Craftsmen directory, Purchase request / RFQ / quotation / order list+detail pages, Jobs (business view). A reference request accompanies the checkpoint.

---

# Revision 2 — shared demand publishing, product audiences, contacts, network.refer

Supersedes the Purchase Request parts of revision 1. Nothing here is implemented. Items marked **DECISION** need approval before any migration is written.

## R1. Revised Purchase Request domain

A Purchase Request is a **published buyer-defined demand**, visible to a defined set of business/persona audiences, answerable by several of them. It is not an RFQ (single requester -> single supplier), not a catalog product, not an Offer (supplier-published price package).

- `purchase_requests`: `id`, `requester_user_id` (always the actor), `requester_org_id` (nullable: personal requesters have no organization), `requester_kind` (canonical audience code, derived server-side from the active workspace, never client-supplied), `title`, `note` (250-char rule), `needed_by`, `share_with_showrooms boolean` (the "إظهار لمعارض أخرى" switch, showroom requesters only), `status` (`draft | published | closed | cancelled`), `version`, timestamps.
- `purchase_request_items`: `request_id`, `position`, `name` (required), `sku` (optional), `category_code` (FK `product_categories`, the 15 canonical codes, required), `color_items jsonb` (same `{name,hex,code}` shape and validators as products), `quantity numeric`, `unit` (existing `product_unit` enum), `spec` (250 chars via `DESCRIPTION_MAX_CHARS` / the characters validator). No `product_id`: items are free-form requirements and **never create catalog products**.
- `purchase_request_images`: at most **2 per item**, modelled on `product_images` (state machine, slot, owner-bound metadata) in a **new private bucket** `purchase-request-images`. Read = requester (own user/org) + currently-eligible viewers of a **published** request, sign-only (same `sign`/`sign_many` pattern as `product_images_select_public`).
- Writes: RPC only, security definer, actor from `auth.uid()`, optimistic `version`, audit events; no client DML.
- Requester capability: org requesters need `rfq.create` (reuse) on the active workspace; personal requesters need an active, supported persona. Unsupported personas (`sales`, `trainer`, `trainee`) cannot publish.
- Removed from revision 1: `rfqs.purchase_request_id` fan-out. Not needed until the acceptance model (R5) is approved.

## R2. Exact audience mapping

Canonical viewer/requester kind = `app.viewer_offer_audience(p_org_id)` semantics (active workspace `organization_type`, or the personal `persona_type`). No new enum. Only an **additive reference table** `purchase_request_audience_rules(requester_kind, viewer_kind)` (seeded, read-only, RLS select for authenticated), so the matrix is data, not scattered `case` logic.

| Requester kind (canonical) | UI label | Eligible viewer kinds |
|---|---|---|
| `installer_technician` | صنايعي | `showroom_dealer` |
| `contractor`, `contractor_company` | مقاول | `showroom_dealer` |
| `engineer`, `design_office` | مهندس / مكتب تصميم | `showroom_dealer` |
| `end_consumer` | عميل نهائي | `showroom_dealer` |
| `showroom_dealer` | معرض | `supplier`, `manufacturer`, `importer` |
| `showroom_dealer` + `share_with_showrooms` | معرض | `supplier`, `manufacturer`, `importer`, `showroom_dealer` (other showrooms) |
| `supplier` (and legacy `wholesaler`) | مورد | `supplier` |
| `manufacturer` | مصنع | `manufacturer` |
| `importer` | مستورد | `importer` |

Rules enforced in one function `app.request_visible_to(p_request_id, p_org_id)`:
1. viewer must be authenticated and (if `p_org_id` given) a member of it, with the audience taken from that organization;
2. viewer kind is in the matrix row for the request's `requester_kind` (plus showrooms only if `share_with_showrooms`);
3. **a request is never an opportunity to its own requester**: `p_org_id <> requester_org_id` and `auth.uid() <> requester_user_id`, so two workspaces of one person cannot answer each other's requests either;
4. request is `published`, requester org live (verified/active/non-deleted, same liveness rule as jobs/offers).

**DECISIONS:** (a) `interior_designer` persona is not named in the matrix: treat as Engineer (recommended) or unsupported? (b) `wholesaler` rows are remapped to `supplier` already; confirm no separate wholesaler audience.

## R3. Product audience-targeting architecture

- New `product_audiences (product_id, audience)` with `audience` FK to a **product** audience catalogue. Create Offer uses `offer_audience_types`, which lacks `end_consumer` and has `feed_ready` flags tied to Offers feeds, so Products get their own catalogue table (`product_audience_types`) that seeds the same canonical codes plus `end_consumer`; **no Offer audience rules are reused** for Requests or Products (both stay separate tables).
- Eight UI choices map to canonical codes: معرض `showroom_dealer`; مورد `supplier`; مصنع `manufacturer`; مستورد `importer`; مقاول `contractor`+`contractor_company`; مهندس `engineer`+`design_office`; صنايعي `installer_technician`; العميل النهائي `end_consumer`. The picker stores the UI choice; the catalogue expands it to canonical codes (so `design_office` orgs and `engineer` personas both see "مهندس" products).
- **Backward-compatible policy:** every product that is `published` at migration time receives **all eight** audiences (behaviour unchanged for existing data). Drafts get none. New products must choose at least one audience to publish (validated in `set_product_published` / `own_product_*`, plus a `ck`-style trigger so a published product with zero audiences cannot exist). Editing audiences on a published product takes effect immediately.
- Own-organization exclusion from Browse stays; an owner always reads their own products.
- Saved products: a saved row whose product stops being visible to the viewer's audience is hidden from the Saved list (same view-level filter) and cannot be re-saved; `save_product` re-checks audience.

## R4. Existing catalog RLS implications (the bypass)

Findings from the audit:

1. `products_select_published` (`20260810090001`): **any authenticated user may `select` any published row of `public.products`** straight through PostgREST. `catalog_published_products` became `security_invoker = true` (`20260817100000`), so it inherits that policy: the view and the table have **the same hole**. Audience filtering in the view alone would be bypassable by `from("products")`.
2. `product_images_select_public` (table) and the storage policy `product_images_select_public` both gate on `app.product_is_public(product_id)` = published only. Image keys are therefore signable by any authenticated user for any published product.
3. `add_rfq_item` accepts a published product of the supplier org with no viewer audience check, so a non-targeted viewer who guessed an id could build an RFQ line for it.
4. `saved_products`/`saved_product_list` and `search.ts` (which reads `catalog_published_products` and `products`) inherit the same exposure.
5. Frontend already does `from("products")` in `search.ts`, `commerce.ts`, `offers.ts`: those cross-tenant reads must be re-routed.

Proposed secure architecture (to be proven by pgTAP **before** the UI work):

- **Hard floor in RLS**: replace `products_select_published` with a policy `using (status='published' and deleted_at is null and app.product_audience_allows_caller(id))`, where the predicate is the **union** of all audiences the caller holds across their active memberships + personal persona (RLS cannot see the "active workspace"). A user holding several workspaces can therefore see any product that *one* of their own workspaces may see, never one that none may. Same predicate on `product_images_select_public`, storage policy and `app.product_is_public`.
- **Exact per-workspace read**: browse, detail, search, saved and direct links go through `security definer` readers taking `p_org_id` (the offers pattern: `catalog_feed(p_org_id, ...)`, `catalog_detail(p_org_id, id)`), which apply the *active workspace* audience and exclude own organization. `catalog_published_products` is reduced to the exact reader's projection or dropped; no frontend code reads `products` for other tenants.
- `product_prices` untouched (owner-select policy only); no price columns in any new reader (pgTAP asserts it).
- Pagination: readers take `(offset, limit<=10 batches)` with a total order, as today's 10/+10/-10 queries do.
- Risk: the union predicate is a deliberate, documented compromise. If you prefer **exact** isolation per workspace, the alternative is to deny direct table reads of other tenants' products altogether (revoke SELECT on the published path, readers only). That removes the union weakness but is a larger change to `search.ts`/RFQ/offers code. **DECISION.**

## R5. Multi-responder quotation approach

Audit result - the existing RFQ/quotation lifecycle cannot carry a broadcast request through a thin adapter:

1. `rfqs.requester_org_id` is `NOT NULL` and every RFQ RPC requires org membership + `rfq.create`: **personal requesters (customer, craftsman, engineer without an org) have no RFQ identity.**
2. An RFQ names exactly one `supplier_org_id`; `uq_quotations_rfq_live` allows one live quotation per RFQ.
3. `rfq_items` snapshot a product name and an enum unit; requests have free-form items with images/colours/category the RFQ tables cannot hold.
4. Creating one RFQ per responder automatically would have a responder (or the system) create an RFQ **as** the requester: impersonation, forbidden.

Options for approval (**DECISION**):

- **A (recommended).** Additive `purchase_request_responses` (+ `_items` priced against the request's items): one non-binding response per responding business per request (`draft | submitted | withdrawn | declined | selected`), unique per `(request_id, responder_org_id)`, same mechanics as quotations (RPC-only, version, capability `quote.submit`, price visible only to requester and that responder, never to other responders). Needed because of 1-3 above. Acceptance/selection and order creation are **not specified here**.
- **B.** Same as A, plus a requester-initiated bridge: "ask this responder for a formal quotation" creates a canonical direct RFQ *by the requester themself* (org requesters only), reusing the existing RFQ -> quotation -> order lifecycle for the binding part.
- **C (rejected).** Auto-create per-responder RFQs: impersonation and fails for personal requesters.

Open acceptance questions I will not assume: can a requester select several responses (partial fulfilment by item), does selection close the request, who creates the order for a personal requester (orders require `requester_org_id`)?

## R6. Direct RFQs stay unchanged

No change to `rfqs`, `quotations`, `orders`, their RPCs, views, or `Browse product -> Request quotation`. Distinct nav entries and metrics: Published Purchase Request (my / browse), Direct RFQ (sent / received), Supplier Quotation (received / sent), Purchase Order, Public Offer. `showroom_home_metrics` keeps no purchase-request figure until the request domain exists and then adds its own keys.

## R7. Contact visibility design

`organizations` has **no phone/email columns** and `contacts` is user-level. So:
- New `organization_contact_settings (organization_id, phone, whatsapp, email, show_phone, show_whatsapp, show_email)`: values owned by the org, three flags default **false**; write RPC requires `org.manage`.
- Craftsmen: reuse `contacts` (verified WhatsApp/email) and a profile-level `show_whatsapp/show_email` flags (default false); phone only if the profile already stores one (to check in the build step).
- A `security definer` reader returns a field only if its flag is on **and** the viewer is an authenticated member of a business organization (and, for craftsmen, an eligible viewer). Values never appear in `organization_public_directory` or `profile_public_directory`.
- Unregistered candidate contact stays in `network_referrals` columns, readable only by the submitter, their org's `network.refer`/`org.manage` members and platform reviewers, and never projected into any directory until approved and claimed.

## R8. network.refer integration

- `network.refer` is a new key in the fixed capability allow-list `ck_membership_capability_key` (recreated, as 6 prior migrations did), assignable by `org.members.manage`/owner like any capability; `org.manage` implies it.
- `network_referrals` gets `candidate_kind` (`showroom` default, `supplier`, `craftsman`), `submitted_by_org_id` (nullable), and contact columns; existing rows backfill as `showroom`.
- New RPC `network_candidate_create(kind, ...)`: caller needs `network.refer` on the active org; never creates an Auth user; `status='pending'`, stores submitter, org, kind, contact, timestamps, audit event. Existing `network_referral_create_*` (craftsman refers showroom) are untouched.
- Approve/reject for the new kinds ends in "reviewed" state only; it does **not** create accounts (claiming an organization/profile is a later, separate flow - **DECISION** whether approval should create an unowned supplier organization like showrooms do).

## R9. Points compatibility

`referral.organization_approved` is awarded only inside the `new_showroom` branch of `network_referral_approve`. The new approve path for `supplier`/`craftsman` candidates calls no `app.award_points`; a pgTAP test asserts zero `points_ledger` rows after approval. Craftsman-refers-showroom reward stays as is. Approval status and reward eligibility remain separate columns/events.

## R10. Proposed schema changes (none applied)

1. `product_audience_types`, `product_audiences`, backfill (all eight on published rows), publish guard, RLS/reader rework (R3/R4), storage policy update.
2. `organization_contact_settings` + profile contact flags + contact reader.
3. `network.refer` capability; `network_referrals` candidate columns; `network_candidate_create/approve/reject`.
4. `purchase_requests`, `_items`, `_images` (+ bucket), `purchase_request_audience_rules`, `app.request_visible_to`, create/publish/close/cancel RPCs, `purchase_request_feed` / `_detail` readers.
5. `purchase_request_responses` (+ items) once R5 is approved.
6. Business jobs read projection.

Order proposal: (2) and (3) are approved and independent of R4/R5, so they go first; (1) needs the RLS decision; (4) needs R2 decisions; (5) is blocked on R5.

## R11. Shared account routes

Shared feature module `features/purchase-requests/*` and `server/*/purchase-requests*` with one data layer, mounted by each shell as a thin adapter (no per-account tables):
- Showroom: `/preview/showroom-suite-v2/purchase-requests` (mine), `.../purchase-requests/new`, `.../purchase-requests/[id]`, `.../browse-requests` (+ `[id]`, `[id]/respond`).
- Other shells (craftsman, engineer/design office, customer, supplier/manufacturer/importer) mount the same components under their own roots when their reference exists. Navigation label split: **طلبات الشراء** (mine) vs **تصفح الطلبات** (browse); direct RFQ entries stay separate.

## R12. Suppliers page - UI composition brief (not a final layout)

Reuses shell, tokens, RTL/Light/Dark, `PageHero`, `FilterBar liveSearch`, `Select`/`SelectMenu`, `Pager`+`usePagedList` (10 / +10 / -10), `IconStat`. Proposed sections for your reference mock:
1. Page hero: icon + "الموردون" title, one-line description. No fake counters.
2. Filter bar: live search (name), organization type (مورد / مصنع / مستورد), product category, governorate/city, "verified only" toggle.
3. Optional summary tiles only from real data (count of eligible businesses, how many already worked with this showroom).
4. Results, Grid/List toggle: card = logo, name, type badge, verified mark, location, category chips (from real published products), product count, shared-work badge, actions: **View details**, **Request quotation** (existing direct RFQ), **Contact** (only fields the owner opted in).
5. Detail page: header, about, categories, published products (links into Browse filtered by supplier), contact block (opt-in only), "Request quotation" CTA.
6. Empty/no-result/error states; pagination footer.
7. "Suggest a supplier" secondary action for `network.refer` holders (pending-review form, no account created).
Need from you: reference image(s) for the grid/list card and the detail page, and any logo/placeholder asset (ASSET REQUEST will follow with exact sizes once the reference is in).

## R13. Decisions still needed

1. `interior_designer` audience mapping and confirm the eight-to-canonical expansion in R3.
2. Exact vs union product-audience enforcement (R4).
3. Response/acceptance model A or B, and the acceptance questions in R5.
4. Whether approving a supplier/craftsman candidate creates an unowned organization/profile.
5. Confirm backfill "all eight audiences" for existing published products.
