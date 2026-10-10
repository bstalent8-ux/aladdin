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

### Purchase Request (new, internal)
- `purchase_requests` (org-owned): `id, organization_id, title, note, needed_by, status (draft | open | fulfilled | cancelled), version, created_by, timestamps`.
- `purchase_request_items`: `product_id` (soft, real catalog product) + snapshot name/unit, `quantity`, optional preferred `supplier_org_id`.
- Link, not merge: `rfqs.purchase_request_id` (nullable FK, additive) so one need can fan out to several RFQs, one per supplier, because an RFQ is single-supplier by constraint. The request is `fulfilled` when an order exists for any linked RFQ (derived, not typed in).
- RPC-only writes, `rfq.create` capability, audit events, RLS = own organization only. Never visible to a supplier.

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

1. `purchase_requests` + items + `rfqs.purchase_request_id` + RPCs/views/RLS/audit actions.
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
