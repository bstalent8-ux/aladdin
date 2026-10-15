# M2 + M3 + M4a - Frontend Reality Audit

Status: audit only. No application behaviour, migration, RLS rule or Admin screen was changed to produce it.
Method: real Playwright (Chromium) against the real Next.js dev server on port 3026 and the isolated Supabase `aladdin_sr2`, with synthetic accounts only. One worker, no retries. Screenshots are real captures, never mock-ups.
Audit tooling (kept in the worktree): `frontend/playwright.audit.config.ts`, `frontend/e2e/audit/*.spec.ts`. Raw evidence: `docs/frontend/screenshots/m4-audit/` (`manifest.jsonl`, `routes.jsonl`, `navigation-links.json`, `INDEX.md`).

For every feature the six questions the checkpoint asked are answered separately: (1) database, (2) backend/API, (3) frontend exists, (4) frontend connected to the real backend, (5) full journey works in the browser, (6) ready for user visual approval. A passing pgTAP test is **not** evidence of a usable screen.

---

## 1. Executive summary

* **The user's impression is correct.** The backend for M2-M4a is far ahead of the interface. M2 and M3 each have a real, working owner-side interface. M4a has **one** page, and an independent professional cannot reach it through the app.
* **M2 (registration and applications): usable end to end.** Every state the checkpoint named was captured with real data: operating-model choice, first application, Pending Review, Needs Changes, Rejected, abandon and history, approved organizations, blocked additional application, workspace switcher, `/business/applications`. A pending organization never becomes a workspace (verified). Contractor, Engineer and Personal Account registration show "Coming soon" in the account-type list.
* **M3 (governance): owner side works, with one real bug and no Admin side.** Settings, identity change request, branch add/verify/amend, co-owner request and the public branch listing all work with real data. Unverified branches never appear in the public listing (verified in the UI). Bug **B-1**: after a corrected rename is approved, the identity panel still shows the old rejection. The Admin reviewer sees raw type strings and no evidence.
* **M4a (independent publishing): minimal, and unreachable.**
  * No link, menu item or switcher entry leads to `/home/independent-publishing` (verified by crawling the rendered shell; zero links).
  * Independent Product Offers management UI **does not exist** (confirmed: backend and pgTAP only).
  * Product management is create plus publish/unpublish only: no edit, no images, no audience or price change after creation.
  * Every existing organization management route (`/b2b/products`, `/b2b/offers`, the suite `my-products`/`my-offers`, RFQs, quotations, orders) bounces an independent professional to `/home`.
  * A buyer who can see an independent product (gate opened in an isolated test) sees "Requests to this seller are not available yet" - a dead end by design until M4b.
  * It is a basic management screen, **not** sufficient for a professional's daily workflow.
* **Existing Showroom commerce is real but split in two.** Two parallel shells serve the same functions (`/b2b/*` and `/preview/showroom-suite-v2/*`, the latter under a `/preview` path). In the suite sidebar, **6 of 21 items are real screens and 15 lead to a "This page is not available yet" placeholder.**
* **Shared Purchase Requests have no UI at all.** Server actions and queries exist (`server/actions/purchase-requests.ts`, `server/queries/purchase-requests.ts`) but no route or component uses them. The sidebar label "Purchase requests" in the `/b2b` shell actually points at the Direct RFQ list - a naming collision with the separate Shared Purchase Request feature.
* **Technical health of what exists is good.** 210 page visits over 104 distinct URLs: zero horizontal overflow, zero RTL/LTR mismatches, no unexpected server errors, and the only console errors were expected 404s for non-eligible users plus one transient dev-server connection reset that did not reproduce.

---

## 2. Screenshots index

122 screenshots, indexed with route, persona, locale, theme, viewport, state, whether real data was loaded and any limitation in:

**`docs/frontend/screenshots/m4-audit/INDEX.md`** (generated from `manifest.jsonl`)

| Area | Folder | Count |
|---|---|---|
| M2 Registration & Applications | `m2-registration-applications/` | 27 |
| M3 Organization & Branch Governance | `m3-organization-branch-governance/` | 30 |
| M4a Independent Publishing | `m4a-independent-publishing/` | 29 |
| Existing Showroom Commerce | `existing-showroom-commerce/` | 36 |

Coverage: desktop 1440x900 and mobile 390x844; English LTR light and Arabic RTL dark as the representative pair (plus Arabic desktop dark for several). The 430x932 viewport was not captured (not needed: no 390-specific failures appeared). Light-Arabic and dark-English were not separately captured - see section 12.

Screenshot files are on disk in the worktree; they are not committed (32 MB of PNG). Everything else (specs, manifests, index, these documents) is committed.

---

## 3. M2 UI inventory (registration, applications)

| Capability | Route | DB | API | UI | Connected | Browser journey | Visual approval |
|---|---|---|---|---|---|---|---|
| Account types, Coming Soon markers | `/auth/sign-up` | yes | yes | yes | yes | yes (list opened EN+AR) | ready |
| Operating-model choice (independent vs organization) | `/business/new` | yes | yes | yes | yes | yes | ready |
| Application form: name, type, location, branch, review | `/business/new?model=organization` | yes | yes | yes | yes | yes | ready |
| Pending Review + "not a workspace" note + blocked second application | `/business/applications` | yes | yes | yes | yes | yes | ready |
| Needs Changes (reviewer note, edit, resubmit, cancel) | `/business/applications` | yes | yes | yes | yes | shown; **resubmit not exercised** in this checkpoint | ready |
| Rejected + reviewer reason + abandon confirmation | `/business/applications` | yes | yes | yes | yes | yes | ready |
| Abandoned history + "Start a new application" | `/business/applications` | yes | yes | yes | yes | yes | ready |
| Approved organizations + "Open workspace" | `/business/applications` | yes | yes | yes | yes | yes | ready |
| Additional application (approved owner) | `/business/new` | yes | yes | yes | yes | blocked-state and "Add another organization" shown; **a second submission was not exercised** here | ready |
| Workspace switcher (Add business, Organization applications) | top bar | yes | yes | yes | yes | yes | ready |
| Pending org never usable as a workspace | cookie forced to a pending org | yes | yes | yes | yes | yes (stays personal) | n/a |

Findings:
* Reachability: `/business/applications` and "Add business" are reachable only from the workspace switcher or the "no workspace" state; a user with no organization sees a plain "Add business" link in the personal sidebar.
* A **consumer** who opens `/business/new` is sent to `/business/applications` (redirect, verified).
* Personal Account sign-up also shows "Coming soon" in the list. That was not part of the stated decisions; reported, not changed.
* The dev-only Next.js "N" badge overlaps some bottom-left controls in every screenshot. It does not exist in production builds.

---

## 4. M3 UI inventory (organization and branch governance)

| Capability | Route | DB | API | UI | Connected | Browser journey | Visual approval |
|---|---|---|---|---|---|---|---|
| Organization settings, verification status | `/b2b/settings` | yes | yes | yes | yes | yes | ready |
| Identity change: request / pending / rejected-with-reason | `/b2b/settings` | yes | yes | yes | yes | yes | ready |
| Identity change: **after approval** | `/b2b/settings` | yes | yes | **bug B-1** | yes | yes | **not ready** |
| Pending rename leaves the approved name current | `/b2b/settings` | yes | yes | yes | yes | yes | ready |
| Branch list, add internal branch | `/b2b/settings` | yes | yes | yes | yes | yes | ready |
| Branch verification: pending, verified, unreviewed edit, rejected amendment | `/b2b/settings` | yes | yes | yes | yes | yes | ready |
| Co-owner request, pending, verified | `/business/applications` | yes | yes | yes | yes | yes | ready (location is unusual, section 7) |
| Verified co-owner may apply (opens the application flow) | `/business/new` | yes | yes | yes | yes | yes | ready |
| Sales member sees no governance controls | `/b2b/settings` | yes | yes | yes | yes | yes | ready |
| Public branch listing: only verified branches | `/home/showroom` (select showroom) | yes | yes | yes | yes | yes (branch list showed the verified branch only; the internal "Private" branch was absent) | ready |
| Org people and join requests | `/b2b/organization` | yes | yes | yes | yes | loads (not re-tested here) | pre-M2 screen |

**B-1 (real bug, evidence `m3-.../06-rename-approved` and `11-branch-verified`).** `organization_identity_state` selects only the latest request whose status is submitted, under review, needs-more-info or rejected. Once a corrected request is **approved** it is excluded, so the panel falls back to the older **rejected** request and shows "Not approved", the old reviewer note and "Send a corrected request" - although the organization name has already changed. Not fixed here: the correction is in a database function (needs a migration, forbidden at this checkpoint). Proposed fix: include approved rows and show the latest decision, or hide the panel history once the newest request is approved.

Minor: the founding branch keeps its pre-rename name (`Aud Gov Showroom ...`) in the top-bar branch chip after an organization rename; branch and organization names are separate records. Reported as an observation.

### Admin-side gaps (not changed - Admin UI is a separate workstream)
Evidence `m3-.../30-admin-verification-queue` and `31-admin-organization-detail`:
* The queue prints the raw string `independent_publisher → Engineer · Individual`. Organization reviews show "Organization · Organization". There is no evidence, no requested-vs-current comparison, no co-owner, branch or rename details, no history.
* Backend `review_context(verification_id)` already returns reviewer evidence, but nothing renders it.
* No UI for branch-verification revoke, co-owner revoke, or publisher suspend / reinstate / revoke (RPCs exist).
* Result: an Admin can approve these requests only blind. This is a public-launch blocker and an Admin-workstream requirement (section 10).

---

## 5. M4a UI inventory (independent publishing)

| Capability | DB | API | UI | Connected | Browser | Status |
|---|---|---|---|---|---|---|
| Request publishing approval (+ note) | yes | yes | yes | yes | yes | PARTIAL (works; unreachable) |
| Pending / Approved / Suspended (+reason) / Revoked (+reason, request again) | yes | yes | yes | yes | yes | PARTIAL |
| Non-eligible persona gets 404 | yes | yes | n/a | yes | yes | works |
| **Create** product (name, code, category, unit, price, audiences) | yes | yes | yes | yes | yes | PARTIAL |
| Publish / unpublish with confirmation | yes | yes | yes | yes | yes | works |
| **Edit** product | yes | yes | **no** | - | - | MISSING |
| Product images (upload, order, remove) | yes (Storage + RPC, tested via RPC only) | yes | **no** | - | - | MISSING |
| Audiences after creation | yes | yes | **no** | - | - | MISSING |
| Price change | yes | yes | **no** | - | - | MISSING |
| Product detail / preview as buyers will see it | yes | yes | **no** | - | - | MISSING |
| **Independent Product Offers management** | yes | yes (`publisher_offer_save`) | **no** | - | - | **BACKEND ONLY** |
| Navigation entry to the area | - | - | **no** | - | - | MISSING |
| "Acting as" indicator (independent identity vs organization) | yes | yes | top bar shows the generic "Personal" workspace; the page title is the only cue | - | - | PARTIAL |
| Buyer sees independent product (gate opened in isolated test) | yes | yes | yes (note, no quote button) | yes | yes | PARTIAL (dead end until M4b) |
| RFQ / quotation / order / project / chat as or with an independent | **no (M4b)** | no | no | - | - | BLOCKED |

Confirmed explicitly:
* **Independent offers UI is not implemented.** The only independent screen has a Products card; there is no Offers card, route or component. The suite `my-offers` screens call organization-scoped actions and are unreachable for an independent (redirect to `/home`).
* Evidence of unreachability: `M4a-3` visited `/b2b/products`, `/b2b/offers`, suite `my-products`, `my-offers`, `my-offers/new`, `/b2b/rfqs`, `/b2b/orders`, `/b2b/quotations` as an approved independent: every one returned 200 and ended on `/home`.
* A draft row offers one action, "Publish"; a published row offers "Unpublish". No other control.

**Is it sufficient for a professional's daily workflow? No.** It is a thin approval-and-publish console. A professional cannot correct a typo, change a price, attach a photo, change who sees a product, group products into an offer, receive a request, send a quote or chat. It proves the ownership and approval model; it is not a product.

---

## 6. Existing Showroom reusable frontend

Real, tested screens that M4a/M4b should reuse rather than rebuild:

| Piece | Where | Notes for reuse |
|---|---|---|
| Product form (fields, validation, price, colors) | `features/commerce/product-form.tsx` | takes organization-scoped actions today |
| Image manager (3 photos, upload, signed URLs) | `features/commerce/product-media.tsx` + product form | key prefix and RPC are organization-scoped in the UI actions |
| Products table | `features/commerce/products-table.tsx` | |
| Product cards / catalog grid / filters | `features/commerce/catalog-grid.tsx`, `catalog-filters.tsx` | already renders independent sellers (organization id null) |
| Audience selector | `features/showroom-shell/products/product-audiences.ts` | already used by the independent screen |
| Offer builder, offers list, detail, feed | `features/offers/*` | organization-scoped save action |
| Status badges | `features/commerce/badges.tsx`, `execution/badges.tsx` | |
| RFQ list / detail / form | `features/commerce/commerce-lists.tsx`, `rfq-detail.tsx`, `rfq-form.tsx` | requester and supplier are organizations |
| Quotation editor / detail | `features/commerce/quotation-detail.tsx` | |
| Order and project detail | `features/execution/*` | |
| Chat panel, thread, conversation list | `features/chat/*` | opened from RFQ/order; no standalone page |
| Workspace switcher | `components/layout/workspace-switcher.tsx` (b2b) and `features/showroom-shell/workspace-menu.tsx` (suite) | two implementations |
| Shells | b2b sidebar shell; Showroom suite shell; personal `/home` shell | three shells |

---

## 7. Real navigation findings

Evidence: `navigation-links.json` (every rendered `<a href>` per persona, with collapsed sidebar groups expanded).

* **No path to `/home/independent-publishing`** for the independent Contractor (21 links, none to it), for organization owners, or for any other persona.
* The independent Contractor's whole shell is the personal one: Home, Offers, Profile, Points, Settings, Jobs, My work, Reviews, Network, Add business. Nothing for products, offers, requests or orders.
* `/business/applications` is not in any sidebar; it is in the workspace switcher menu only. The co-owner request lives on that page, which is not where an owner would look for ownership verification.
* **Three shells, two overlapping sets of screens.** Hana (Showroom owner) has both a `/b2b/*` sidebar and a `/preview/showroom-suite-v2/*` sidebar; the b2b "Offers", "Products" and "Saved" entries link to the b2b screens, while the suite links to its own.

Duplication to resolve (decision needed, not changed):

| Function | `/b2b` route | Suite route |
|---|---|---|
| Browse products | `/b2b/catalog` | `/preview/showroom-suite-v2/catalog` |
| My products | `/b2b/products` | `.../my-products` |
| Offers feed | `/b2b/offers` | `.../offers` |
| My offers | (inside `/b2b/offers`) | `.../my-offers` |
| Saved | `/b2b/saved` | `.../saved` |
| Workspace switch | b2b switcher | suite workspace menu |

* The suite is the newer, Craftsman-styled shell but lives under a `/preview` URL.
* **Naming collision:** in the `/b2b` navigation the label "Purchase requests" is the label of `/b2b/rfqs` (the **Direct RFQ** list). The separate **Shared Purchase Request** feature has no UI. Users would meet two different things under one name.

---

## 8. Broken or inaccessible screens

| # | Item | Evidence | Severity |
|---|---|---|---|
| B-1 | Identity panel shows a stale rejection after the corrected request is approved | m3 `06`, `11` | medium (misleading) |
| B-2 | Independent publishing page has no navigation entry | `navigation-links.json`, m4a `01` | high for M4a usefulness |
| B-3 | 15 of 21 Showroom-suite sidebar items open a placeholder | existing `p01`, `p02`, source `[page]/page.tsx` | high (looks like a product, is not) |
| B-4 | "Purchase requests" label points to the Direct RFQ list | `lib/nav/modules.ts`; b2b `b05` | medium (terminology) |
| B-5 | Admin queue renders raw review-type strings, no evidence | m3 `30` | high (launch blocker) |
| B-6 | Org-management routes bounce independents to `/home` with no explanation | sweep + m4a `10-pro-route-*` | medium |
| B-7 | Mobile top bar truncates the workspace label ("الحساب الـ…") | m4a `09` (390 AR dark) | low |

Not defects: `/home/independent-publishing` returns 404 for non-eligible personas (intended); the suite `my-offers/<id>/edit` returned "not found" for Hana because the only seeded offer belongs to another organization; the seeded product used in `s08` has no category or price row (seed data, not a form defect). One `ERR_CONNECTION_RESET` during the sweep did not reproduce on re-check.

28 of the 136 page routes were **not** visited (all outside M2-M4a): inner onboarding-wizard steps (`/onboarding/business|complete|consumer|contact|professional|professional/review|username`), installer and auth design previews (`/preview/installer-*`, `/preview/auth-password/*` other than sign-in/up), `/home/offers/[offerId]`, `/home/work/[assignmentId]`, `/b2b/jobs/[jobId]/edit|applicants`, `/b2b/follow-ups/[id]/edit`, and `/`.

---

## 9. Backend-only functionality

| Capability | Where it exists | UI |
|---|---|---|
| Independent Product Offers (save, status, package validation) | `publisher_offer_save`, `own_offer_set_status` | none |
| Independent product edit, images, audiences, archive | `own_product_update`, image RPCs, `product_audiences_set` | none for independents |
| Publisher suspend / reinstate / revoke | `publisher_suspend|reinstate|revoke` | none |
| Branch verification revoke | `branch_verification_revoke` | none |
| `review_context` evidence for reviewers | RPC | none |
| Shared Purchase Requests (create, discover, respond, shortlist, images) | tables, RPCs, server actions and queries | **no page or component** |
| Quotation credits | documented only | none (deferred) |

---

## 10. Admin integration gaps (documented, Admin not modified)

1. Render `review_context` in the verification detail: requester, organization, old and new identity values, branch snapshot, co-owner claim and note, publisher request note, history.
2. Human-readable review types in the queue (organization, rename, branch location, co-owner, independent publisher).
3. Actions: suspend, reinstate, revoke publisher; revoke branch verification; revoke co-owner - each with a required reason and visible audit.
4. A handling queue for open orders and projects of a revoked publisher (the approved rule is "controlled administrative handling"; its steps are undecided).
5. Admin visibility of the `independent_commerce` gate state (read-only) so launch readiness is observable.
6. A note on reviewer self-approval: the database refuses it; the UI should say so instead of failing.

---

## 11. Desktop and mobile findings

* 390x844 renders every captured screen without horizontal scroll (210 route visits, 0 pages over 1 px overflow).
* Mobile `/b2b/settings` (very long, full-page capture) is a single column and usable; governance cards stack correctly.
* The personal shell on mobile gains a bottom bar (Home, Jobs, My work, Network, Profile); there is no slot for publishing.
* 1440x900: the b2b and suite shells are dense but consistent; the independent publishing page is a plain two-card layout that does not use the page hero or sidebar conventions of the suite.

---

## 12. Arabic/English and Light/Dark findings

* Direction: every Arabic visit reported `dir="rtl"`; every English visit `ltr` (0 mismatches in 210 visits).
* Arabic copy exists for every M2/M3/M4a state captured. Reviewer-entered notes stay in the language typed (expected).
* Theme sampling: captures are English-light and Arabic-dark pairs. **Not separately verified:** English-dark and Arabic-light on every screen. The earlier regression batch E covered themes for the Showroom screens.
* Mixed-direction strings (product code next to an Arabic unit) read acceptably; no fault found, but this is the place to look in a design review.

---

## 13. Actual browser results

All audit specs ran one at a time, one worker.

| Spec | Result |
|---|---|
| `m2.spec.ts` (7 tests) | pass |
| `m3.spec.ts` (6) + `m3b.spec.ts` (1) | pass |
| `m4a.spec.ts` (7) | pass |
| `showroom.spec.ts` (1, 33 captures) + `placeholder.spec.ts` (1) | pass |
| `admin.spec.ts` (1) | pass |
| `nav.spec.ts` (5) | pass |
| `sweep.spec.ts` (anonymous, showroom owner, consumer, admin) | pass - 210 visits, 104 distinct URLs |

Honest notes on the run: several first attempts failed because of **my own spec mistakes** (a locale left switched after a capture, a collapsed select I tried to read as text, a result row that is a single link). Each was fixed in the spec; none revealed an app regression. The Coming Soon text is only visible after the account-type list is opened; my first check read the closed control and wrongly reported zero.

Route coverage: 108 of 136 page routes were visited in a browser (all M2, M3, M4a, Showroom, `/b2b`, `/home`, `/admin`, `/auth`, `/legal`, `/business` routes); 36 route patterns were screenshotted.

Only expected console errors occurred (404 for non-eligible visits to a deliberately hidden page and an unknown profile id; one transient reset).

---

## 14. Prioritized missing UI

1. **Independent professional hub and navigation entry** (no one can find the feature).
2. **Independent product editor with images, price, audiences** (daily need).
3. **Independent Product Offers management** (backend ready).
4. **Seller inbox and buyer request path for independents** - M4b (RFQ, quotation, order, project, chat), including a personal buyer path.
5. **Admin review evidence and publisher governance screens** (separate Admin workstream; public-launch blocker).
6. **Decide and resolve the two-shell duplication and the 15 placeholder suite items** before more screens are added to either shell.
7. **Resolve the "Purchase requests" naming collision**, then design the Shared Purchase Request screens (create, discover, respond).
8. Fix B-1 (needs a backend migration, so it needs approval).
9. Standalone Messages page and Notifications page (today only a top-bar panel and an "Open conversation" button).

See `m4-frontend-completion-roadmap.md` for the plan.

---

## Appendix A - Frontend inventory (required format)

Statuses: COMPLETE (working UI + real-browser validation of the journey), PARTIAL, BACKEND ONLY, UI ONLY, MISSING, BLOCKED, DEFERRED. "Load only" means the page loaded with real data in the route sweep but its actions were not re-tested at this checkpoint, so it is **not** marked COMPLETE.
Area: **SS** = Showroom suite (`/preview/showroom-suite-v2`), **B2B** = shared `/b2b` area, **IND** = independent professional (`/home`), **AUTH** = auth, onboarding and personal `/home`, **FUT** = unimplemented or future.

| # | Area | Feature | Route | Component | Backend connected | Functional browser test | UI status | Missing work |
|---|---|---|---|---|---|---|---|---|
| 1 | AUTH | Sign-up with account types + Coming Soon | `/auth/sign-up` | `features/auth` | yes | yes | COMPLETE | - |
| 2 | AUTH | Operating-model choice | `/business/new` | `onboarding/operating-model-step` | yes | yes (batch G, audit) | COMPLETE | Contractor path stays Coming Soon |
| 3 | AUTH | Organization application form | `/business/new` | `features/onboarding` | yes | yes | COMPLETE | - |
| 4 | AUTH | Applications center: pending / rejected / abandoned / approved / blocked | `/business/applications` | `organization/application-center` | yes | yes | COMPLETE | - |
| 5 | AUTH | Needs Changes edit and resubmit | `/business/applications` | `application-center` | yes | shown, resubmit not exercised | PARTIAL | browser test of resubmit |
| 6 | AUTH | Additional application by an approved owner | `/business/new` | `application-center` | yes | blocked state + entry shown; second submission not exercised | PARTIAL | browser test |
| 7 | AUTH | Workspace switcher (b2b) | top bar | `components/layout/workspace-switcher` | yes | yes | COMPLETE | merge with suite switcher |
| 8 | B2B | Organization settings + verification status | `/b2b/settings` | `app/b2b/settings` | yes | yes | COMPLETE | - |
| 9 | B2B | Identity change panel | `/b2b/settings` | `organization/identity-change-panel` | yes | yes | PARTIAL | bug B-1 (needs migration) |
| 10 | B2B | Branch list, add, edit | `/b2b/settings` | `organization/branch-governance` | yes | yes | COMPLETE | - |
| 11 | B2B | Branch verification lifecycle | `/b2b/settings` | `branch-identity-dialog` | yes | yes | COMPLETE | - |
| 12 | AUTH | Co-owner request / verified | `/business/applications` | `organization/co-owner-section` | yes | yes | PARTIAL | better location and discoverability |
| 13 | AUTH | Public branch listing in Connect showroom | `/home/showroom` | `accounts/showroom-search` | yes | yes | COMPLETE | - |
| 14 | B2B | Organization people, join requests | `/b2b/organization` | `people-manager`, `join-requests` | yes | load only | PARTIAL | actions re-test |
| 15 | FUT | Admin review evidence for new review types | `/admin/verifications` | (none) | `review_context` RPC | n/a | BACKEND ONLY | Admin workstream |
| 16 | FUT | Admin suspend / reinstate / revoke publisher; revoke branch / co-owner | (none) | (none) | RPCs | n/a | BACKEND ONLY | Admin workstream |
| 17 | IND | Publishing approval request and states | `/home/independent-publishing` | `independent-publishing/independent-publishing` | yes | yes (batch I, audit) | PARTIAL | not reachable by navigation |
| 18 | IND | Independent product create | same | same | yes | yes | PARTIAL | - |
| 19 | IND | Independent product publish / unpublish | same | same | yes | yes | PARTIAL | - |
| 20 | IND | Independent product edit | (none) | (none) | `own_product_update` | - | MISSING | editor |
| 21 | IND | Independent product images | (none) | (none) | Storage + RPC | RPC only | MISSING | image manager UI |
| 22 | IND | Audience / price change after creation | (none) | (none) | RPC | - | MISSING | editor |
| 23 | IND | Independent Product Offers management | (none) | (none) | `publisher_offer_save` | - | BACKEND ONLY | list, builder, detail, lifecycle |
| 24 | IND | Navigation entry / hub / acting-as cue | (none) | (none) | - | - | MISSING | design + build |
| 25 | SS | Buyer view of an independent product | `.../catalog/[productId]` | `commerce/catalog-product-detail` | yes | yes | PARTIAL | dead end until M4b |
| 26 | IND | Independent RFQ inbox, quotation, orders, projects, chat | (none) | (none) | none (M4b) | - | BLOCKED | M4b |
| 27 | FUT | Personal buyer Direct RFQ, quotes, orders | (none) | (none) | none (M4b) | - | BLOCKED | M4b |
| 28 | SS | Suite home | `.../home` | `showroom-shell/home` | yes | yes (batch A) | COMPLETE | - |
| 29 | SS | Catalog list + detail | `.../catalog`, `.../catalog/[id]` | `commerce/catalog-*` | yes | yes (A, B, E) | COMPLETE | - |
| 30 | SS | Offers feed + detail | `.../offers`, `.../offers/[id]` | `offers/offers-feed-view`, `offer-detail-view` | yes | yes (C) | COMPLETE | - |
| 31 | SS | Saved products | `.../saved` | `commerce/saved-grid` | yes | yes | COMPLETE | - |
| 32 | SS | My products: list, new, edit (images, audiences, price) | `.../my-products*` | `commerce/product-form`, `product-media` | yes | yes (B, F) | COMPLETE | - |
| 33 | SS | My offers: list, new, edit | `.../my-offers*` | `offers/offer-builder`, `my-offers-view` | yes | yes (C) | COMPLETE | - |
| 34 | SS | 15 other sidebar items (purchase requests, RFQs sent, quotes received, purchase orders, customer RFQs, customer quotes, customers, suppliers, craftsmen, jobs, sales team, projects, reports, points, settings) | `.../[page]` | `[page]/page.tsx` | none | yes (placeholder) | MISSING | decide: hide or build (15 nav entries) |
| 35 | B2B | Dashboard | `/b2b` | `features/home` | yes | load + earlier batches | COMPLETE | - |
| 36 | B2B | Catalog list + detail | `/b2b/catalog*` | `commerce/*` | yes | yes | COMPLETE | duplicates SS |
| 37 | B2B | RFQ list, detail, new (Direct RFQ) | `/b2b/rfqs*` | `commerce/rfq-*` | yes | yes (D) | COMPLETE | org-only parties |
| 38 | B2B | Quotations list + editor | `/b2b/quotations*` | `commerce/quotation-detail` | yes | yes (D) | COMPLETE | org-only parties |
| 39 | B2B | Orders, projects | `/b2b/orders*`, `/b2b/projects*` | `execution/*` | yes | yes (earlier batches) | COMPLETE | org-only parties |
| 40 | B2B | Products table, new, edit | `/b2b/products*` | `commerce/products-table`, `product-form` | yes | yes | COMPLETE | duplicates SS |
| 41 | B2B | Offers feed + detail | `/b2b/offers*` | `offers/*` | yes | yes | COMPLETE | duplicates SS |
| 42 | B2B | Saved products | `/b2b/saved` | `commerce/saved-grid` | yes | yes | COMPLETE | duplicates SS |
| 43 | B2B | Chat | opened from RFQ / order | `chat/*` | yes | partial (earlier batches) | PARTIAL | no standalone Messages page |
| 44 | B2B | Notifications | top-bar panel | `notifications/*` | yes | unit tests | PARTIAL | no page |
| 45 | B2B | Shared Purchase Requests | (none) | (none; server actions + queries only) | yes | - | BACKEND ONLY | all screens + label decision |
| 46 | B2B | Sales CRM (leads, customers, follow-ups, activity) | `/b2b/leads*`, `/b2b/customers*`, ... | `features/sales` | yes | load only | PARTIAL | not in scope here |
| 47 | B2B | Jobs, technicians, institutions, suppliers, buyers, reports, points | `/b2b/*` | various | yes | load only | PARTIAL | not in scope here |
| 48 | AUTH | Personal `/home` pages (jobs, work, network, reviews, points, profile, settings) | `/home/*` | various | yes | load only | PARTIAL | not in scope here |
| 49 | FUT | Admin dashboards (users, organizations, verifications, audit) | `/admin/*` | `features/admin` | yes | load + screenshot | PARTIAL | new review types (rows 15-16) |
| 50 | FUT | Installer and auth design previews | `/preview/installer-*`, `/preview/auth-password/*` | `*-preview` | none | 5 of 20 loaded | UI ONLY | not in scope |
| 51 | FUT | Dynamic Tags, subscriptions, quotation credits, page builder, CMS | - | - | - | - | DEFERRED | not started by instruction |

Totals over the 51 feature rows (not page counts): COMPLETE 23, PARTIAL 15, MISSING 5, BACKEND ONLY 4, BLOCKED 2, UI ONLY 1, DEFERRED 1.
