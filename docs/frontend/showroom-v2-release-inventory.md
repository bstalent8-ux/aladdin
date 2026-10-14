# Showroom V2 - completed-feature inventory and convergence record

Branch `feature/showroom-fullstack-v2`, isolated Supabase `aladdin_sr2`, dev server 3026. Evidence: `docs/frontend/screenshots/v2-release/` and the specs `frontend/e2e/audit/v2-*.spec.ts` plus `frontend/e2e/regression/{a..i}-*.spec.ts`.

## 1. Design authority (confirmed from the code, not from memory)

`/preview/showroom-suite-v2` is the design source of truth. Its look is `.installer-surface` (`src/styles/installer-theme.css`):

| Token | Value | Use |
|---|---|---|
| Deep Navy | `#071A2D` | shell, ink, dark ground |
| Warm Sand | `#D8C7A6` | hairlines, secondary surfaces |
| Soft Cream | `#F2E9D8` | light ground, text on navy |
| Muted Terracotta | `#B96F52` | accent, selected, focus |

Fonts: Readex Pro (Arabic + Latin) through `next/font` (`src/app/layout.tsx`). All new V2 components consume the semantic utilities (`bg-surface`, `text-fg`, `text-accent`, `rounded-md`, `text-title`/`text-headline`) so Light/Dark and RTL/LTR come from the same tokens as the existing suite pages. Nothing from the Best Trade reference (colour, logo, type) is used; it only informed the Home content hierarchy. The reference image itself was not attached to the session, so Home follows the written section list (see section 4).

## 2. Convergence: one shell

| Before | After |
|---|---|
| Showroom user entered `/b2b` (legacy shell) and a hidden `/preview/showroom-suite-v2` existed beside it | A `showroom_dealer` workspace is always rendered in the V2 frame (`features/showroom-shell/frame.tsx`). `/b2b/layout.tsx` uses it, so every finished `/b2b/*` module keeps its route, data and permissions and appears inside the V2 shell |
| 15 sidebar entries led to "This page is not available yet" | Visible entries all lead to finished pages. Only Shared Purchase Requests (طلبات الشراء, Milestone D) is hidden; its route and the placeholder page remain |
| `/b2b` Home and `/b2b/settings` duplicated V2 pages | `/b2b` (Showroom) redirects to V2 Home with its period; `/b2b/settings` redirects to V2 Settings (section preserved) |
| Old preview deep links such as `/preview/showroom-suite-v2/purchase-orders` | Redirect to the finished route (`[page]/page.tsx`) |

Scope limit: only `showroom_dealer` is converged. Supplier, Manufacturer, Importer, Engineer office and the other account types keep their current workspace until their own V2 interfaces are approved (the V2 suite already serves those five types as a preview, unchanged).

Naming: Direct RFQs = **طلبات عروض الأسعار المباشرة** (sidebar, page titles, dashboard labels); Shared Purchase Requests = **طلبات الشراء** (hidden, no frontend). The legacy copy "Purchase requests" for RFQs was corrected in `en.ts`/`ar.ts` (nav, RFQ page title, dashboard stat labels).

## 3. Feature inventory

Status legend: READY, INTEGRATED (fixed in this task), INTEGRATION NEEDED, INCOMPLETE, DEFERRED, BLOCKED. "Evidence" names a real-browser spec unless it says otherwise.

| # | Feature | Route (canonical today) | Backend | V2 frontend | Evidence | Status |
|---|---|---|---|---|---|---|
| A | Registration, sign-in | `/auth/*` | Supabase auth, OTP | unchanged (not part of the shell) | every spec signs in; `regression/g` | READY |
| B | Organization onboarding, Admin approval status | `/business/applications`, `/onboarding` | M2 application lifecycle | existing screens | `regression/g` G1-G5 | READY (Admin review UI is a separate workstream) |
| C | Workspace selection | V2 top bar menu | `loadWorkspaceContext`, `aladdin-org` cookie | V2 menu | `regression/b` B4-B7; V2-6 (pending org excluded) | READY |
| D | Home | `/preview/showroom-suite-v2/home` | `showroom_home_metrics`, `rfq_list`, `quotation_list`, `order_list`, `order_category_spend`, `catalog_products` | NEW (this task) | V2-1, V2-7 and journey J3 | READY with documented gaps (section 4) |
| E | Catalog, search, filters, details | `/preview/showroom-suite-v2/catalog[/id]` | `catalog_products` (exact audience) | existing V2 | `regression/a` A2, A3 | READY |
| F | My Products, create/edit, images, audiences, lifecycle | `.../my-products[/new|/id/edit]` | own-products RPCs, image grants | existing V2 | `regression/a` A4, `b` B1-B3, `f` F1-F5 | READY |
| G | Product Offers feed, details, My Offers, builder | `.../offers`, `.../my-offers` | product offers | existing V2 | `regression/c` C1-C7 | READY |
| H | Saved products | `.../saved` | `saved_products` | existing V2 | `regression/a` A5 | READY |
| I | Direct RFQs sent/received | `/b2b/rfqs[/new|/id]` (inside V2 shell) | `rfqs` RPCs | legacy page framed by V2; titles corrected | journey J1; `regression/d` D1-D3 | INTEGRATED |
| J | Quotations sent/received | `/b2b/quotations[/id]` | quotation RPCs | legacy page framed by V2 | journey J2, J3 | INTEGRATED |
| K | Orders | `/b2b/orders[/id]` | order RPCs | legacy page framed by V2 | journey J3 (order created from accepted quotation; list and detail render inside V2). Order start/complete transitions NOT browser-tested here | INTEGRATED (transitions: see gaps) |
| L | Projects / execution | `/b2b/projects[/id]` | project RPCs | legacy page framed by V2 | V2-2 renders and highlights; transitions not exercised | INTEGRATED (transitions untested) |
| M | Organization Settings | `.../settings?section=business` | governance RPCs (identity request/approve, verification state) | NEW sectioned page | `regression/h` H1, H2 (now run through V2 Settings) | READY |
| N | Branches and verification | `.../settings?section=branches` | branch governance RPCs | NEW (reuses `BranchGovernance`) | `regression/h` H3, H4, H8; V2-7 | READY |
| O | Members, roles, permissions | `/b2b/organization` (Team) via sidebar and Settings > Members & access | member/capability RPCs | legacy page framed by V2 | V2-2 renders; V2-5 denies a staff member. Invite and join-request flows NOT browser-tested here | INTEGRATED (flows: see gaps) |
| P | Personal account | `.../settings?section=account` | shared identity card and RPCs (name, photo, phone) | NEW section reuses `IdentityCard` | rendered in V2-4; saves not exercised in this session | INTEGRATED (saves unverified) |
| Q | Chat and notifications | header panels | conversations, notifications | **Fixed**: the V2 frame did not mount the Chat panel, so the "Open conversation" buttons on RFQ/quotation/order pages did nothing | V2-8 | INTEGRATED |
| R | Reports and operating data | `/b2b/reports` | report queries | legacy page framed by V2 | V2-2 renders | INTEGRATED |
| S | Network, referral, jobs, customers, leads | `/b2b/suppliers`, `technicians`, `jobs`, `customers`, `leads`, `follow-ups`, `points`, `activity` | existing | legacy pages framed by V2, sidebar entries gated by the legacy capability map | V2-3 opens every sidebar destination (status < 400, no placeholder text) | INTEGRATED |
| T | Support and help | `/auth/support` (Settings > Support) | existing | Settings section | V2-4 | READY |
| - | Branch scope switching (multi-branch) | V2 top bar | active-branch cookie | **Fixed**: the V2 frame had no branch switcher; it now shows one for organizations with more than one branch | V2-7 screenshot `e02` | INTEGRATED |

### Update 2026-10-13 (reference alignment)

| Feature | Backend | V2 frontend | Evidence | Status |
|---|---|---|---|---|
| Home aligned to the approved reference image | `showroom_home_metrics`, `order_list`, `quotation_list`, `order_category_spend`, `catalog_products` | five KPI cards + discover grid + quotations + category donut | R-1..R-4 (side-by-side image, overflow, customization, SQL parity) | READY (see `showroom-v2-reference-alignment.md` for the differences) |
| KPI customization | `dashboard_kpi_layouts` (+ `20261024090001`) | trigger beside the period selector | R-3, pgTAP 66/81 | READY (team-default scope not browser-tested) |
| Business Description (250 characters) and the description limit | `organizations.description`, `organization_description_set`, `app.description_text`, direct-write trigger (`20261025090001`) | Settings > Business profile; registration; bio; portfolio; legacy product form | DS-1..DS-3, pgTAP 84 | READY (members-only; legacy over-limit text preserved) |
| Showroom business profile image | `organization_images`, `organization_image_*` RPCs, private bucket (`20261024090002`) | Settings > Business profile | S-2..S-4, pgTAP 82 | READY (members-only; public exposure not enabled) |
| Business profile without language/timezone/handle | unchanged columns | Settings, names dialog | S-1, unit tests | READY |
| Personal data privacy | RLS + RPCs as audited | privacy notes in Settings | pgTAP 83 | READY, four product decisions open |
| Workspace switcher terminology | none | V2 menu + legacy switcher read the catalog | `workspace-menu.test.tsx`, regression B4/D7/G3, R-5 | READY |

## 4. Home V2 - data sources and honest gaps

Details: `showroom-v2-home-data-map.md`. Summary:

| Reference widget | Result |
|---|---|
| Active Purchase Requests | Shown as **Active Direct RFQs** (open RFQs this organization sent). Shared Purchase Requests have backend tables but no frontend until Milestone D, so they have no Home figure |
| Incoming Offers / Quotations | **Supplier quotations received** (period). Product Offers remain on the Offers pages |
| Orders in Progress | `showroom_home_metrics.purchase_orders_active` |
| Completed Orders | NEW count of `order_list` rows `completed` inside the period (no migration) |
| Total Purchases | `showroom_home_metrics.total_purchases` |
| Showroom Rating | **Not shown.** No showroom rating data exists (job reviews rate professionals). Proposal: a reviews table keyed to completed orders and an RPC aggregate, after a product decision on who may rate whom. The sixth card is Customer RFQs received (seller-capable) or Saved products |
| Discover new products | Real catalog rows, signed images, category badge, supplier, description |
| Latest incoming quotations | Real `quotation_list` rows, drafts excluded |
| Purchasing by category | `order_category_spend`, confirmed non-cancelled orders in the period. Categories are the **broad sector categories** (the view maps through `products.category`); canonical sub-categories need a view extension. Unattributable lines show as Other |
| Active requests | Open Direct RFQs with the real three-stage lifecycle (Sent / Quoted / Closed), no invented percentages. There is no human-readable RFQ reference number in the data model, so the title is the identifier |
| Benefits and quick actions | Only operational capabilities; every link is a finished page and is capability-gated |
| Membership / package | **Not shown.** No trustworthy subscription or entitlement state exists; deferred with subscriptions |

## 5. Findings during integration (all reported, none hidden)

1. Chat panel and branch switcher were missing from the V2 frame (fixed, above).
2. The seeded owner `hana@example.test` lacks `conversation.participate`; every NEW organization owner receives it through the owner preset. The chat test grants it explicitly in the isolated database. Not a product defect.
3. **Local PostgREST hangs 60 s on SQLSTATE 40001** (`quotation was modified concurrently`): submitting a quotation with a stale version returns "upstream timing out" instead of a conflict message. Reproduced with a direct HTTP call. The action maps the code correctly, so on a PostgREST that returns 40001 normally the user sees the conflict. Must be re-checked on the hosted staging stack before release.
4. `features/home/showroom-dashboard.tsx` (legacy Showroom Home) is no longer rendered; kept, not deleted.
5. The older default Playwright harness (`playwright.config.ts`, specs directly under `e2e/`) seeds the container `supabase_db_aladdin` and starts its own server; it was **not run** (it targets a different database). Several of those specs assert the legacy Showroom Home and are obsolete by design.

## 6. Remaining genuinely unimplemented

Shared Purchase Request pages (Milestone D), Points page content beyond the existing `/b2b/points`, showroom rating, membership card, independent-professional UI (F-series), M4b, Dynamic Tags, subscriptions, quotation credits, Admin evidence screens.

## 7. Canonical route proposal (not decided, needs approval)

Proposal: serve the Showroom workspace under `/showroom/*` (`/showroom/home`, `/showroom/settings`, `/showroom/catalog`, ...), with `/preview/showroom-suite-v2/*` and the `/b2b/*` module routes kept as permanent redirects or aliases for at least one release. Steps: (1) add `/showroom/*` as aliases through Next rewrites, (2) switch the sidebar hrefs, (3) enable 308 redirects from the old URLs, (4) remove aliases only after traffic confirms nothing uses them. Rollback is flipping the sidebar hrefs back; no data moves. Until approved, V2 stays at the current URLs and users reach it automatically from `/b2b`.
