# M4 - Frontend Completion Roadmap

Status: **plan only. Nothing here is implemented, and no estimate below is a statement of completed work.**
Basis: `m4-frontend-reality-audit.md` (real screenshots and route evidence), `docs/product/m4b-implementation-plan.md`, `docs/product/m4-independent-publisher-impact-assessment.md`.
Rule for every step: **a milestone is done only when a real user journey works in a real browser against the real backend and the user has approved the visual design.** Backend tests alone never close a milestone.

Not authorized and not planned for activation here: Contractor/Engineer public registration (stays Coming Soon), the `independent_commerce` gate (stays closed), M5, M6, Milestone D, Tags, subscriptions, quotation credits, page builder, CMS.

---

## Correction to the previous M4b plan (important)

`m4b-implementation-plan.md` section 4 says "Buyer side stays organization-or-personal as it is". The schema audit contradicts that: `rfqs`, `quotations`, `orders`, `projects` and `conversations` all have `requester_org_id NOT NULL`. **Today the buyer side of a Direct RFQ is organization-only.** Only `purchase_requests` already accepts an individual requester. The approved rule (personal buyers may send Direct RFQs to independent sellers) therefore needs a **buyer party identity as well as the seller one**. An erratum has been added to the M4b plan pointing here.

## Approved rules this roadmap must honour (final, from the user)

A. Revoked independent publisher: no automatic cancellation of existing binding orders; new commercial transactions blocked; records preserved; open orders and projects handled through a **controlled administrative workflow** (its steps are not decided - see section 13). No automatic refunds or settlement.
B. Personal buyer Direct RFQ: allowed if the product is available to that buyer's audience; both parties authenticated and authorized; personal contact and privacy restrictions preserved; no fake organization.
C. Shared Purchase Requests: individuals may **create** them; that does not let them **respond** as individual sellers; responder eligibility unchanged; never confuse them with Direct Product RFQs.
D. Launch: Contractor/Engineer registration stays Coming Soon, `independent_commerce` stays off; M4b completion does not authorize launch; M5, M6, Admin readiness and explicit approval are all still required.

---

## 1. M4a remaining frontend work

| # | Work | Why (audit evidence) |
|---|---|---|
| 1.1 | Navigation entry and a professional hub | B-2: zero links lead to the page |
| 1.2 | Independent product editor: edit, price, audiences | audit section 5: create-only today |
| 1.3 | Image manager for independent products | RPC-tested only; no UI |
| 1.4 | Independent Product Offers: list, builder, detail, lifecycle | confirmed BACKEND ONLY |
| 1.5 | Owner preview of a product / offer as buyers will see it | missing |
| 1.6 | Clear acting-as cue ("Independent professional", not "Personal") | top bar says Personal only |
| 1.7 | Explain redirects: an independent opening an organization-only route should land on the hub with a message, not silently on `/home` | B-6 |
| 1.8 | Fix B-1 (identity panel after approval) | needs a small backend change - **needs approval** |

## 2. M4b full-stack UI work

M4b changes both parties of a Direct RFQ. Two trusted identities on each side:

* **Buyer** = approved organization **or** authorized personal user.
* **Seller** = approved organization publisher **or** approved independent publisher.

UI work, in dependency order:

1. **Request-quote entry** on catalog and offer detail for every eligible buyer (today organization-only; the independent seller currently shows "Requests to this seller are not available yet" - removed only when the gate is open).
2. **Buyer-side screens for a personal buyer** (new, because they have no `/b2b` workspace): my requests, request detail, quotations received, order detail, conversation.
3. **Seller-side screens for an independent**: RFQs received, RFQ detail, quotation editor, quotations sent, orders, projects, conversation.
4. **Organization journeys unchanged** (regression gate: existing batches A-I and pgTAP must still pass).
5. **Messages** and **Notifications** pages for parties that are not an organization.
6. Revoked / suspended publisher states inside every transaction screen: new actions refused with a plain explanation, existing records readable.

## 3. Required pages and routes (proposed; names need approval)

| Area | Proposed route | Reuse / new |
|---|---|---|
| Independent hub (overview) | `/home/pro` (or keep `/home/independent-publishing` as the hub) | new composition |
| My products | `/home/pro/products`, `/new`, `/[id]/edit` | adapt product form |
| My offers | `/home/pro/offers`, `/new`, `/[id]/edit` | adapt offer builder |
| Incoming RFQs | `/home/pro/rfqs`, `/[id]` | adapt RFQ detail |
| Quotations | `/home/pro/quotations`, `/[id]` | adapt quotation editor |
| Orders / projects | `/home/pro/orders`, `/[id]`; `/home/pro/projects`, `/[id]` | adapt order/project detail |
| Messages | `/home/messages` (both personal buyer and independent) | adapt chat |
| Personal buyer requests | `/home/requests`, `/[id]`; quotations and orders in the same area | new shell, reused detail components |
| Professional profile / commercial status | `/home/profile` (existing) + publishing status card | extend |

Decision needed before building: whether independent screens live in the personal `/home` shell (recommended - it is the shell that independents already have, and it avoids a third commerce shell) or in a new one.

## 4. User journeys (to be walked in a real browser at acceptance)

1. Independent: request approval -> Admin approves -> hub -> add product with photos -> publish -> create an offer -> (gate open, isolated) receive an RFQ -> quote -> order accepted -> order lifecycle -> chat.
2. Personal buyer: browse -> request quote on an independent product -> receive quotation -> decide -> order -> chat.
3. Organization buyer to independent seller; independent seller to organization buyer.
4. Suspension and revocation mid-journey (new actions blocked, records kept, Admin handling queue).
5. Organization journeys: unchanged results.
6. Arabic RTL dark 390px for each of the above.

## 5. Reusable components

| Component | Decision | Note |
|---|---|---|
| Product cards, catalog grid, filters | reuse as-is | already render independent sellers |
| Product table (`products-table`) | adapt safely | inject publisher-scoped actions |
| Product editor (`product-form`) | adapt safely | publisher id instead of organization id; same fields |
| Image manager (`product-media`) | adapt safely | publisher prefix, publisher RPC |
| Audience selector | reuse as-is | already used |
| Offer builder | adapt safely | `publisher_offer_save` |
| Status badges | reuse as-is | |
| RFQ table / detail | adapt safely | party model change |
| Quotation editor | adapt safely | party model change |
| Order / project detail | adapt safely | party model change |
| Chat panel / thread / list | adapt safely | party model change; add standalone page |
| Workspace switcher | **specialized wrapper** | new "Independent professional" identity beside Personal and organizations; explicit per-request identity |
| Sidebar / layout shell | reuse personal shell, add a `pro` module group in `lib/nav/personal-modules.ts` | no fourth shell |

Business permission stays in the database. A hidden button is never the control.

## 6. New components needed

* Professional hub (status, counts, shortcuts) - composition of existing cards, no new design system.
* Publisher status banner (pending, approved, suspended + reason, revoked + reason).
* Party chip: shows the buyer or seller as organization or independent professional consistently in lists and details.
* Admin handling queue for open orders of a revoked publisher (Admin workstream).

## 7. Backend API dependencies

| Need | Today | Status |
|---|---|---|
| Publisher-scoped product and offer writers | exist | ready |
| Publisher-scoped image grants | exist | ready |
| RFQ / quotation / order / project / conversation with buyer **and** seller party identity | org-only | M4b backend (plan in `m4b-implementation-plan.md`, corrected for the buyer side) |
| Notification addressing for a non-organization party | org-only | M4b |
| Standalone conversations list for personal parties | per-org | M4b |
| Admin evidence + governance RPCs | `review_context`, suspend/revoke exist | Admin UI missing |
| Identity-panel fix (B-1) | wrong query | small migration, needs approval |
| Shared Purchase Request responder identity | org-only | **decision pending**, separate |

## 8. Buyer and seller identity handling

* Identity is chosen explicitly **per request** by the server from a trusted source (session user plus an explicit selection), and re-verified by the database - never inferred from the page and never a union of everything the person owns.
* A person who is an organization member and an independent publisher acts as exactly one identity per action.
* No fake organization for a personal buyer or an independent seller.
* Seller display name: the independent professional's name as shown on their profile (an alternative display name is an **open decision**, section 13).
* Contact data of a personal party is not shown before the existing privacy rules allow it (exact rule to be confirmed, section 13).

## 9. Approval and permission states (every screen must handle)

Not eligible (404) - can request - pending - approved - needs changes - rejected - suspended (reason, history readable, no writes) - revoked (reason, request again) - gate closed (own items visible to the owner only; "not shown to other people yet") - gate open (isolated tests only until launch is approved).

## 10. Required design references (user approval before building)

Pages needing a user-approved design before substantial implementation:

1. Independent professional hub / overview.
2. Independent My Products list and product editor with image manager.
3. Independent Product Offers list, builder and detail.
4. Independent RFQ inbox, RFQ detail and quotation editor.
5. Independent orders and projects.
6. Personal buyer: request-quote flow, my requests, quotations received, orders.
7. Standalone Messages page.
8. Professional public profile with commercial-publisher status.
9. Identity / acting-as switcher (Personal, independent professional, organizations).
10. Navigation entry and Coming Soon treatment for Contractor / Engineer.
11. Shared Purchase Request screens (create, discover, respond) after the label collision is resolved.
12. Admin review evidence, publisher governance and revoked-publisher order handling (Admin workstream; listed only for dependency).

Use the existing Aladdin visual language (palette #D8C7A6, #B96F52, #F2E9D8, #071A2D; Readex Pro; Arabic/English parity; light/dark). Proposals are structure and flow, not final visuals.

## 11. Implementation order (each step ends with a user approval checkpoint)

| Step | Content | Gate to proceed |
|---|---|---|
| F0 | Decisions: shell strategy (personal shell vs new), the suite placeholders (hide or build), the "Purchase requests" label, B-1 fix approval | user decisions |
| F1 | Designs for hub, product editor, offers, navigation, acting-as switcher | user approves references |
| F2 | M4a completion: hub, navigation entry, product editor, images, offers UI; B-1 fix | browser journey 1 up to publishing, plus design approval |
| F3 | M4b backend (party identities) with org regression gate | pgTAP + all existing batches pass unchanged |
| F4 | M4b UI: seller side for independents, buyer side for personal buyers, messages, notifications | browser journeys 2-5 |
| F5 | Admin workstream integration (separate owner) | Admin screens exist and are approved |
| F6 | Revoked-publisher handling workflow once its rules are decided | rules approved |
| F7 | Launch readiness review (M5, M6, Admin, explicit approval) | explicit user approval |

F2 can start as soon as F0 and F1 are approved; it does not depend on M4b.

## 12. Test and acceptance criteria

Every screen:
* loads with real data, no HTTP or console errors, correct authorized content;
* AR RTL and EN LTR, light and dark, 1440 and 390, no horizontal overflow;
* every state in section 9;
* the database refuses the same action when the button is bypassed (cross-publisher, suspended, revoked, wrong identity);
* organization journeys give exactly today's results (existing regression batches A-I + new batches).

Process: small sequential Playwright batches, one worker; screenshots of each approved state kept with the same manifest tooling used here (`frontend/e2e/audit`); no claim of completion on unit or pgTAP results alone.

## 13. Dependencies, risks and open decisions

Open decisions (not invented here):
1. Steps of the "controlled administrative handling" of open orders/projects after revocation.
2. Exact personal-contact and privacy rules for a personal buyer talking to an independent seller (and the reverse).
3. Which personal personas count as "eligible personal buyers" for a given product audience (use the existing audience matrix; confirm).
4. Payment, commission, settlement, contract, fulfilment for individuals.
5. Whether an independent professional may use a public display name different from their profile name.
6. Whether individual Craftsmen, Contractors and Engineers will ever respond to Shared Purchase Requests as individuals (currently unchanged: no).
7. What to do with the 15 placeholder suite items and the duplicated `/b2b` vs suite screens.
8. The Purchase request / RFQ naming.

Risks:
* Party-identity change touches 24 functions and 7 policies; the organization regression gate is the main safeguard.
* Three shells increase the cost of every screen; deciding the shell strategy first (F0) avoids rework.
* The Admin workstream is a hard dependency for launch; without evidence screens Admins approve blind.
* Dev-only conditions (cold compiles) slow browser batches; keep batches small.
* Estimated durations are deliberately not given: the previous milestones showed the backend is the cheap part and approved UI the expensive one.

## 14. User approval checkpoints

1. Approve this roadmap and the corrected party-identity scope (buyer **and** seller).
2. Decide F0 items.
3. Approve design references for each page group before it is built.
4. After each of F2, F4: review real screenshots and walk the journey.
5. Separate explicit approval before any launch action.

Nothing in this document starts automatically.

---

## Appendix - F0 decision checkpoint (2026-10-13)

Recorded after the user reviewed the audit and this roadmap. The audit remains the historical record of what was found; it is intentionally not edited (B-1 stays described as found).

### Approved decisions

1. **Shell strategy.** Independent Contractors and Engineers use the existing personal `/home` shell. No new standalone commerce shell. Existing Showroom components are reused and safely adapted. The UI must clearly distinguish **personal identity**, **independent professional publisher identity** and an **approved organization workspace**; the backend verifies the acting identity on every request. No union of permissions or audiences.
2. **Placeholder navigation.** The 15 non-functional Showroom-suite sidebar items are to be hidden from primary navigation until their real screens exist. Routes and code are kept; the 15 pages are not built automatically. **Not changed in this checkpoint** - the correction belongs to the F2 implementation plan.
3. **Terminology (separate features, separate data models and permissions).** Direct RFQs = «طلبات عروض الأسعار المباشرة». Shared Purchase Requests = «طلبات الشراء». Labels are corrected during the relevant frontend work (the `/b2b` label "Purchase requests" for the Direct RFQ list is part of that). No Shared Purchase Request UI is built at this stage.
4. **Personal-contact privacy (requirements for M4b personal-buyer to independent-seller Direct RFQs).** Personal phone, email and WhatsApp hidden by default; each channel needs its own authorization/consent; requesting a quotation does not grant disclosure; in-platform communication is the default; home address and sensitive personal information are not shared automatically; a delivery address requires explicit, transaction-specific collection and an authorized disclosure process; only authorized transaction participants access the relevant information. This closes open decision 2 in section 13 of this roadmap (the rules, not their implementation).
5. **Launch.** Contractor/Engineer registration stays Coming Soon; the `independent_commerce` gate stays disabled; no deployment or public activation.
6. **Personal Account "Coming soon".** Reported by the audit; **unresolved observation** that needs separate confirmation. Availability not changed.

### B-1 correction result

Fixed with migration `20261023090010_identity_state_latest_outcome.sql`: `organization_identity_state` now ranks the latest identity request across all outcomes. A newer **approved** request is the current outcome (no open or rejected request reported, no stale note); a newer rejection, needs-changes or pending request still wins over older ones; older rejections stay in `verifications` and the audit log. Only the lookup changed - no approval, permission or write rule. Evidence: pgTAP `80_identity_state_latest_outcome_test.sql` (24 assertions), full pgTAP suite 81 files / 3632 tests, and a real-browser run of the same scenario that showed the bug (screenshots `b1-01`/`b1-02` in the audit archive; "before" is audit capture `06-rename-approved`). Known behaviour kept: ordering relies on request submission time; a withdrawn request is not an outcome, so an older rejection can show again after a withdrawal (unchanged from before).

### Still pending

* **F1 design approvals** (nothing built before they are approved): independent hub; My Products list/editor/image manager; independent Offers list/builder/detail; RFQ inbox and quotation editor; independent orders and projects; personal-buyer request flow and my requests/quotations/orders; standalone Messages; professional profile with commercial status; acting-as switcher; navigation entry and Coming Soon treatment; Shared Purchase Request screens; Admin evidence/governance screens (Admin workstream).
* **M4a frontend implementation: pending** (F2).
* **M4b: not implemented.** The privacy requirements above are inputs to it.
* Remaining open decisions from section 13: 1 (revoked-publisher order handling steps), 3 (eligible personal buyers), 4 (payments and settlement), 5 (public display name), 6 (individual Purchase Request responders), 7 (duplicated screens).
* Review pack for the user's visual review: `docs/frontend/screenshots/m4-review-pack/` (+ `.zip`).
