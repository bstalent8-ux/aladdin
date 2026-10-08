# Showroom full-stack v2 — phased implementation

## Purpose

Continue the existing showroom design with real tenant-scoped behavior while keeping production routes and the installer implementation unchanged. This is the Phase 0 checkpoint, dated 2026-10-06, not a claim that the application is implemented.

## Current decision

- Work only in `D:/projects/aladdin-wt-showroom-fullstack-v2`, branch `feature/showroom-fullstack-v2`, based on fetched `origin/main` at `a33aa018f0d2d308f9b14d235c4e4ad97b5ef1de`.
- Local atomic commits only. No push, PR, merge, deployment, hosted migration, or modification of another worktree.
- Preserve the dirty preview source at `C:/Users/scorp/.codex/worktrees/showroom-commercial-suite-preview/aladdin` (`feat/showroom-commercial-suite-preview`, HEAD `5b3baac`). Its showroom-specific route/features may be ported selectively; no source files have been changed or ported yet.
- New screens must authenticate and use the canonical organization/capability/RLS boundaries. A preview URL is not an authorization bypass. Never substitute mock success for missing backend behavior.
- Use the approved installer-scoped four-color palette: `#D8C7A6`, `#B96F52`, `#F2E9D8`, `#071A2D`, through semantic tokens. No global theme redesign.

## Rationale and isolation audit

### Phase 1 approved business mapping (2026-10-07)

The user explicitly approved enabling business creation with canonical `design_office`, displayed as **المهندس / Engineer**. This is an additional business-creation option, not a new organization enum or a change to personal engineer registration. Preserve the four current organization types, existing entitlement, membership/capability, verification and account-status behavior. The existing SQL organization enum and onboarding RPCs already accept `design_office`; remove application-only restrictions without adding a migration or regenerating unchanged DB types. Registration choices remain separate from the add-business picker. Production installer source files and context-action redirects remain unchanged.

Phase 1 implements only the authenticated isolated shell, navigation and real workspace switching. All leaf content remains explicitly unavailable until its later phase; no mock business metrics or fake CRUD success.

`git status`, branch/worktree inventory and `git fetch origin --prune` were completed before creating this worktree. The main checkout contains unrelated dirty auth work. Other dirty worktrees include installer-jobs-work, showroom-commercial-suite-preview, showroom-approval-workflow-acd3de, installer-experience-promotion, and aladdin-dashboard-runtime. Scratchpad checkouts also contain deletions. None may be reset, cleaned, committed, or copied wholesale.

The clean installer-experience-pr-clean worktree is at `53fc5dc`; its workspace-switch correction is already merged into the selected main base through PR 72. Main also contains the installer production foundation (PR 71). Older runtime notes about PR 70 being unmerged are historical and must not override this inspected Git state. This audit does not establish what is deployed remotely.

Docker inspection found existing stacks `aladdin`, `aladdin_rbac`, `aladdin_1b`, `aladdin_1bb`, `aladdin_prep2`, and `aladdin_jw`. Do not reset or stop them. Before DB implementation, provision a distinct local project ID and unused ports in an isolated runtime configuration. No database was mutated during this audit.

The requested port 3023 was not listening during discovery; visual parity is therefore not verified. Source discovery is complete; browser validation remains required after an isolated runtime is available.

## Craftsman source of truth

All paths below are relative to `frontend/src/` on the selected base:

| Concern | Existing implementation |
|---|---|
| Production frame and gutter | `features/installer-dashboard-preview/installer-dashboard-shell.tsx`, `installer-layout.ts` |
| Sidebar modes, desktop rail, mobile drawer | `features/installer-dashboard-preview/installer-sidebar.tsx`, `lib/ui/sidebar-mode.ts` |
| Header, location divider and profile | `features/installer-dashboard-preview/installer-topbar-core.tsx` |
| Search and shortcut | `features/installer-dashboard-preview/installer-search.tsx` and its CSS module |
| Scoped palette | `styles/installer-theme.css` |
| Theme and locale controls | `components/layout/switchers.tsx` |
| Typography | `app/layout.tsx`: Readex Pro body, Archivo, Reem Kufi, JetBrains Mono variables |
| Spacing and breakpoints | `styles/tokens.css`, `../tailwind.config.ts`; consume existing tablet/desktop utilities |

The source directory name includes “preview”, but `InstallerDashboardShell` explicitly serves production `/home`. Do not treat it as disposable mock code. Mirror composition where showroom navigation differs; do not edit installer components to force showroom behavior.

## Backend reuse and implementation gaps

| Domain | Canonical source | Required next work |
|---|---|---|
| Workspace | `server/queries/workspace.ts`, `lib/workspace/model.ts`, `server/actions/context.ts`, `components/layout/workspace-switcher.tsx` | Reuse `my_workspaces()` membership resolution. Existing switch redirects to `/b2b` or `/home`; isolated adapter must preserve validation without changing production redirects. Clear branch selection on switch. |
| Business creation | `server/actions/business-onboarding.ts`; migrations `20260815090001_persona_organization_type_separation.sql` and `20260928090001_business_creation_entitlement.sql` | Reuse entitlement and onboarding. Engineer is a personal persona; organization uses `design_office`. Resolve display mapping explicitly before offering business creation; do not add an `engineer` organization enum. |
| Home | `features/home/showroom-dashboard.tsx`, `dashboard-period-select.tsx`, `kpi-customize-dialog.tsx`, `components/ui/stat-tiles.tsx`, `expand-collapse.tsx`; dashboard-kpi-layout actions/queries | Use persisted layout and period behavior. Add directional KPI destinations and missing aggregates without editing production home composition. Remove quick actions, attention section and benefits from isolated composition. |
| Catalog | `features/commerce/catalog-filters.tsx`, `catalog-grid.tsx`, `server/queries/commerce.ts`, saved-products actions | Reuse published catalog and save behavior; isolated grid/list presentation and four-column desktop layout. |
| Own products | `server/actions/commerce.ts`, `commerce-forms.ts`; `20260810090001_catalog_rfq_quotation.sql` | Current product has broad category enum and optional image reference; new taxonomy, fields, archive, org-scoped SKU uniqueness and three-image storage lifecycle require additive design/migrations and tests. |
| RFQ and quotation | Same commerce migration/actions; requester and supplier org IDs, statuses, version guards, RPC writes and audit | Preserve one canonical lifecycle. Distinguish purchasing RFQs/received quotes from sales RFQs/sent quotes. Existing forms redirect to production; use isolated adapters. |
| Orders/projects | `20260811090001_orders_projects.sql` | Reuse `create_order_from_quotation`, start/cancel and project lifecycle. Do not infer orders are absent from the older commerce migration comment. |
| Product promotions | No implementation identified in inspected catalog modules | Add tenant-owned promotions, products, audience, validity and pricing validation after detailed schema design. Not ordinary supplier quotations. |
| Referrals/moderation | `server/actions/network-referrals.ts`, `20260911090001_network_referrals.sql` | Extend existing pending-review model for supplier/craftsman submissions. Never create auth users. Concurrent admin-review work is not safe to copy from its dirty branch. |
| Customers/jobs/points | `server/queries/sales.ts`, `jobs.ts`, `points.ts`, corresponding existing domain actions | Reuse existing privacy and capability boundaries; no parallel CRM/jobs/points counters. |
| Settings/assets | Organization/profile actions; professional asset and avatar storage migrations | Keep personal avatar and organization logo distinct; inspect reuse before adding storage policies. |

Current catalog categories are broad codes (`finishing`, `construction`, `interior_design`, `furnishing`, `supply`, `tools`, `other`), not the 15 requested product categories. Existing unit codes include kilogram, roll and meter but not all six requested units. Preserve stable historical values; design additive canonical mappings rather than renaming stored enums. Trades must reuse the 14 active canonical entries introduced by trade-taxonomy migrations.

## Scope and phase acceptance

0. Audit and checkpoint (this document).
1. Authenticated isolated shell, non-clickable navigation groups, backend workspace selection; no chat and no institutions page.
2. Real home KPIs, production customization and filtered clickable navigation.
3. Existing catalog integration and grid/list.
4. Own-product CRUD, canonical categories/units, max-three private owned image management with server enforcement.
5. Promotions and canonical audience targeting; bounded selected-product scrolling.
6. Purchasing versus selling RFQ/quotation terminology and lifecycle adapters.
7. Allowed supplier/craftsman contacts and canonical pending-review submissions.
8. Customers, jobs and points integration.
9. Personal and business settings separately.
10. Full validation: lint/typecheck/Vitest/build; isolated clean DB reset and pgTAP including cross-tenant and permission failures; installer regression; AR/EN, both themes, 1543/768/430/390 widths.

Every phase must report changed files, migrations, backend behavior, routes, reused components, shell references, exact tests, pending work and its local commit. No phase may be called complete because its UI alone looks complete.

## What is deferred

Phases 1–10 remain unimplemented on this branch. No new routes, migrations, DB types, runtime configuration or application dependencies were added in Phase 0. Production promotion requires separate explicit approval. Browser parity, application tests and DB tests have not run for this branch yet.

## Phase 1 closeout — isolated runtime validation

- **Isolated local stack.** Never reuse a shared stack for this branch. Use a distinct `project_id` and unused ports in a local, *uncommitted* `supabase/config.toml` edit (validated with `project_id = "aladdin_sr2"`, API 59321, DB 59322, shadow 59320, Studio 59323, Mailpit 59324, analytics 59327, pooler 59329, edge inspector 59083) and a gitignored `frontend/.env.local` pointing at it. `pnpm supabase stop` reads that config, so keep the edit until the stack is stopped.
- **Fixtures.** `supabase/seed-showroom-workspaces.sql` is deliberately *not* in `[db.seed].sql_paths`; apply it by hand to an isolated stack only. It creates `switch@example.test` (owner of a `showroom_dealer`, a `supplier` and a `design_office` organization) and `ineligible@example.test` (a `contractor_company` member only). Password: the documented E2E password in `frontend/e2e/helpers/auth.ts`.
- **Validated in browser on that stack:** real three-membership switching (cookie `aladdin-org` changes, `aladdin-branch` cleared, header location/name follow the active org, no cross-tenant text), forged `aladdin-org` cookies for foreign/other-user orgs are ignored, a complete Add Business run with "المهندس" produced `organizations.org_type = 'design_office'` (status `pending_verification`) with an owner membership holding `org.manage`, one branch and a completed draft, and the new workspace appears in the switcher. An ineligible account is redirected from every `/preview/showroom-suite-v2/*` path (home, a section page, add-business) to `/b2b`.
- **No migration.** `organization_type` already contains `design_office`; there is no `engineer` enum value. The label "المهندس" is presentation only.
- **Sign-in `next`.** `/auth/sign-in?next=/preview/showroom-suite-v2/home` lands on `/b2b` by design: `sanitizeNext` (`server/auth/next.ts`) allowlists only `/admin`, `/b2b`, `/home`, `/onboarding` and `/auth/invite/`, and the post-auth action then pins the destination to the account's canonical landing. Preview paths are intentionally outside the allowlist, so production redirect behavior is unchanged; open the suite URL directly after signing in.
- **Add Business redirect.** Completing the shared flow redirects to `/b2b` (the shared action's destination), not back into the suite. Left unchanged.
- **Workspace trigger.** Truncation is now intentional: `dir="auto"` gives an end ellipsis for Latin names inside RTL, and the trigger width is capped by viewport (`max-w-[min(16rem,62vw)]` on phones, wider on desktop); the full name is in `title` and the menu.

## Phase 2 — showroom Home dashboard

`/preview/showroom-suite-v2/home` (composition in `features/showroom-shell/home/`). No shortcut cards, no "needs attention" block and no marketing strip: the page is the KPI grid plus "منتجات مقترحة لك".

**Reused, not rebuilt:** `StatTiles`, `ExpandCollapse`, `DashboardPeriodSelect` and its `lib/workspace/dashboard-period.ts` ranges (same keys, same custom-range rules), `KpiCustomizeDialog` (now takes an optional `surface`, default `home`), and the `dashboard_kpi_layout_*` RPCs/actions (optional `p_surface`, default `home`). Production `/b2b` Home behaves as before; its layout read is now pinned to `surface = 'home'`.

**Direction.** A showroom is buyer AND seller; each card carries its direction (`مشتريات` / `مبيعات` / `عمليات`) and its basis (`حاليًا` or the selected period) in its hint.

| Card | Direction | Basis | Source (`showroom_home_metrics`, RLS-scoped views) | Opens |
|---|---|---|---|---|
| طلبات عروض أسعار صادرة | purchasing | period | `rfq_list` requester = org, submitted/quoted/closed, `created_at` in period | `pricing-requests-sent?period=` |
| عروض أسعار واردة | purchasing | period | `quotation_list` requester = org, not draft, `created_at` in period | `quotes-received?period=` |
| أوامر شراء قيد التنفيذ | purchasing | now | `order_list` requester = org, confirmed/in_progress | `purchase-orders?status=active` |
| إجمالي المشتريات | purchasing | period | `sum(order_list.total)` requester = org, not cancelled, `confirmed_at` in period | `purchase-orders?period=` |
| طلبات عروض أسعار واردة | sales | period | `rfq_list` supplier = org, not draft, `created_at` in period | `customer-rfqs?period=` |
| عروض أسعار صادرة | sales | period | `quotation_list` supplier = org, not draft, `created_at` in period | `customer-quotes?period=` |
| إجمالي المبيعات | sales | period | `sum(order_list.total)` supplier = org, not cancelled, `confirmed_at` in period | `reports?view=sales&period=` |
| مشاريع جارية | operations | now | `project_list` active, org requester or executor | `projects?status=active` |
| منتجات محفوظة | operations | now | `saved_product_list` of the org | `saved` |

The period is resolved once (`dashboardPeriodRange`, org/branch timezone) and applied in the database as the half-open range `[from 00:00, to+1 00:00)` in that timezone. Totals are exact SQL sums (not capped by the API row limit).

**Layout persistence.** Per user (personal) and per organization (team default, `org.manage`) in `dashboard_kpi_layouts`, discriminated by the new `surface` column (`home` | `showroom_suite`) so suite layouts can never reach production Home. The first six cards are the first screen; the rest sit behind "show more". Defaults, in order: طلبات عروض أسعار صادرة, عروض أسعار واردة, أوامر شراء قيد التنفيذ, طلبات عروض أسعار واردة, إجمالي المشتريات, إجمالي المبيعات (first screen), then عروض أسعار صادرة, مشاريع جارية, منتجات محفوظة. A card is offered only if its destination page is reachable (same gate as the sidebar), `total_sales` additionally needs a seller capability, and stale saved layouts are filtered against that.

**Purchase Requests are not an RFQ (correction, 2026-10-07).** The canonical procurement flow is طلبات الشراء → طلبات عروض أسعار صادرة → عروض أسعار واردة → أوامر الشراء. A Purchase Request is a distinct procurement need that precedes an RFQ, and the data model has no such entity yet, so the first Phase 2 build's "طلبات شراء مفتوحة" card (which counted RFQs) was removed: it is not in the catalog, default layout, dialog, labels or RPC payload (`20261007090003` redefines `showroom_home_metrics` without the key). The `open_purchase_requests` enum value and its allowlist entry stay in the database (removal would be destructive) but are never offered; stale saved layouts that contain it are filtered out. **طلبات الشراء will become a real entity/domain, with its own lifecycle and KPI, when its procurement lifecycle is implemented later.**

**Products.** Deterministic, not a recommendation engine: the newest published products of OTHER organizations (`published_at desc, id asc`, limit 4) from the RLS-scoped `catalog_published_products` view. The full catalog is Phase 3.

**Migrations (additive).** `20261007090001_showroom_suite_kpi_layouts.sql` (5 enum values, `surface` column, surface-scoped unique indexes and RPCs with backwards-compatible defaults) `20261007090002_showroom_home_metrics.sql` (`SECURITY INVOKER` RPC) and `20261007090003_showroom_home_metrics_no_purchase_requests.sql` (drops the purchase-request figure from the payload). Production apps that call the old RPC shape keep working. No service-role use at runtime.

**Phase 1 shell fix found here.** At 390px RTL with a long business name the phone location row could not shrink and widened the page; the row is now `min-w-0` and the location truncates with a title.

## Consequences

## Phase 3 — تصفح المنتجات (`/preview/showroom-suite-v2/catalog`)

The showroom's product browser is the PRODUCTION catalog backend in the suite shell; it is not a second catalog.

**Reused unchanged:** `listCatalog` / `getCatalogProduct` / `savedProductIds` (`server/queries/commerce.ts`, reading only the RLS-scoped, `security_invoker` view `catalog_published_products`), `FilterBar`, `ProductMedia`, `SaveProductButton`, `toggleSavedProductAction` (→ `save_product` / `unsave_product` RPCs, membership-scoped, duplicate-safe), the `commerce.*` category/unit labels, and the production detail card (now `features/commerce/catalog-product-detail.tsx`, shared by `/b2b/catalog/[id]` and the suite).

**Added (thin):** `features/showroom-shell/catalog/` (server composition, URL parsing, grid/list results), the `catalog` route + `loading`/`error`, the `catalog/[productId]` adapter, `lib/ui/catalog-view.ts`, `showroomCatalog.*` messages. Small additive changes to shared code: `listCatalog` takes an optional `limit` (default unchanged, 100), `ProductMedia` takes an optional `aspect` (default unchanged, 4:3), and `toggleSavedProductAction` also revalidates the suite catalog, detail and Home paths. **No migration, no SQL, no service-role.**

**Visibility.** Only what the view exposes: published, non-deleted products of non-deleted organizations. Drafts, archived products and unpublished assets are absent at the database (pgTAP 23/29 and the new 68); a direct link to one is a 404 in the suite exactly as on `/b2b`.

**Grid / List.** Grid is the default: 2 columns on phones, 3 at ≥768, 4 at ≥1024 (4 at 1543 with the suite sidebar), with a 4:3 (16:10 from 768) image, name, brand, category chip, supplier (+ verified mark), unit and the save toggle overlaid on the image. List is a compact horizontal row: thumbnail, name/brand, category, supplier, unit, save, "View details"; on phones it stacks (title row, one meta line, full-width action). The choice lives in the `aladdin-catalog-view` cookie (per-browser, like theme/locale/sidebar mode — no DB row, no migration), is read by the server so there is no flash, and applies instantly client-side.

**Filters (what the production backend supports, nothing invented):** free-text search over name / SKU / brand, category, and supplier (`?supplier=<org id>`, the hand-off used by the Suppliers directory, shown as a "show all distributors" link). Sorting is fixed newest-published-first and there is no price, location or availability filter because the view carries no such columns. Paging is "load more" in steps of 100 up to 500 (`?limit=`), replacing the previous silent 100-row cut-off; bad `category` / `supplier` / `limit` values are dropped, not forwarded.

**Price.** The production catalog has no price column by design (consultation-first: a price comes from a quotation), so cards show none. This is deliberate and documented, not an omission.

**Category / taxonomy gap (Phase 0 finding, unchanged).** The database still has the broad `product_category` enum — finishing, construction, interior_design, furnishing, supply, tools, other. The requested 15 showroom categories (ورق حائط, بديل خشب, بديل رخام, شيبورد, كرانيش, زوايا, بانوهات, وزر, ابواب داخلية, ابواب مصفحة, ارضيات فينيل, ارضيات SPC, ستائر, بوسترات, دهانات) do NOT map one-to-one onto it, so no mapping was invented and the filter offers the real codes. The category control is driven by one list (`PRODUCT_CATEGORIES` + `commerce.categories.*`) and `parseShowroomCatalogParams` only accepts members of it, so adopting the canonical taxonomy in Phase 4 (additive migration with Own Products) is a swap of that list/labels, not a rewrite.

**Product details.** Cards link to `/preview/showroom-suite-v2/catalog/[id]` (suite shell, same detail card, back link, save toggle). "Request quote" still points at the production RFQ flow (`/b2b/rfqs/new?product=`) until the RFQ pages are built in a later phase. Home's "منتجات مقترحة لك" cards now link to the same suite detail route and its "view all" to the catalog.

**Tests.** Vitest: URL parsing and preference resolution, results component (grid default, list, toggle + cookie, saved state, links, save form), the query layer (published view only, filters, limit, errors), the save action (RPC choice, revalidation, DB refusal). pgTAP 68 (against the existing view/RPCs): published visible / draft hidden, save, duplicate save, unpublished refused, cross-organization save/read/unsave refused, idempotent unsave, no direct writes.

Existing queries and RPCs provide substantial reuse, but their production redirects and business capability assumptions need per-feature review. The old static preview is design evidence only, not an authorization or persistence layer. Shared schema changes must remain additive so production remains compatible until promotion.

## Related files

- [UI contract](UI_CONTRACT.md)
- [Existing showroom completeness specification](sprint-14-showroom-mvp-completeness.md)
- [Runtime checkpoint](../operations/RUNTIME_STATE.md)
- [Work log](../operations/AGENT_WORK_LOG.md)

## Phase 4 — منتجاتي (`/preview/showroom-suite-v2/my-products`)

Extends the existing catalog; no parallel product system. Migration `20261008090001_own_products_taxonomy_images.sql` (additive): `product_categories` (15 canonical codes, AR/EN labels) + nullable `products.category_code` (historical products stay unclassified; the legacy broad `category` enum is untouched and new products get the neutral `other`); units `gallon`/`pail`/`sheet` added to `product_unit` (new products accept exactly kilogram, gallon, pail, roll, meter, sheet; a historical product may keep its unit); `colors text[]`, `weight_kg` (always kg, independent of the selling unit), `size_label` (free text — no structured dimensions model exists), `code_normalized` (unique per organization, maintained from `sku`), `archived_at` (archived = unpublished draft, restorable; no hard delete). `product_images` (max 3 live rows per product enforced by RPC + trigger + unique slot; lowest slot = primary) in the private `product-images` bucket using the metadata-row ownership model (pending → upload → confirm); the catalog view gains `primary_image_key` and the legacy `image_ref` remains the fallback. RPCs: `own_product_create/update/set_archived`, `product_image_request_upload/confirm_upload/remove/reorder`; `set_product_published` refuses archived rows. Storage sign-only read for published products covers both `sign` and `sign_many`. No base price field exists; offers are Phase 5.

### Phase 4 closeout — create with photos, abandoned flows

**One create flow.** The create screen has the three photo slots itself. Chosen photos are staged in the browser only (object-URL previews; reorder / replace / remove before saving); nothing is uploaded and no storage object or `product_images` row exists yet. On "Create" the form (1) creates the product through `own_product_create` as an ordinary **inactive draft**, (2) uploads the staged photos in order through the normal ticket → private bucket → confirm path (so the first staged photo is the main photo), (3) opens the product's edit page. The ownership model, RLS and storage policies are unchanged; no migration.

**Abandoning.** Before "Create": nothing exists server-side, so there is nothing to clean up. After the draft is created (mid-upload, closed tab, failed upload): the draft stays owned by the organization, inactive and invisible in the public catalog, and is resumable from My products; an upload that never confirmed leaves only a `pending` row that frees its slot after an hour (`product_image_request_upload` purges stale pending rows) and is never publicly readable. If a photo upload fails the user still lands on the new draft with a notice ("some photos could not be uploaded") and can add the rest there. No background cleanup job is required.

**Accessibility notes.** A failed submit moves focus to the first invalid field (all errors are `role="alert"`); photo alt text is "<product> — Photo N" (staged: "Photo N"); every photo control has an accessible name inside a per-photo labelled group; tab order follows reading order with no positive tabindex; the archive dialog is modal and labelled, takes focus, traps Tab, closes on Escape / Cancel and returns focus to its trigger (the shared `ConfirmDialog` behaviour).


## Visual-reference rule for showroom pages (2026-10-07)

When reference images are provided for a page (`docs/references/showroom/<page>/`), do not freestyle its composition:

- **Reference image = page composition and UX source.**
- **Craftsman / Installer UI = the Aladdin shared visual-system source** (palette, type, sidebar, header, Light/Dark, responsive behavior). A reference's own legacy theme is never copied.
- **Existing backend / domain = functional source of truth.** Presentation is aligned; real CRUD, RLS, tenancy and rules are never weakened to match a mock.
- If these conflict (a reference shows data the domain does not have), report the conflict before choosing.
- **Assets:** never invent decorative images or use stock/external URLs. A missing asset is an ASSET REQUEST (name, where used, dimensions/ratio, background, description, format, dark-mode need, suggested prompt); the final generated file goes under `frontend/public/images/showroom/...`. Reference images stay under `docs/references` and are never shipped.
- **Points ("نقاطي ومكافآتي", Phase 8):** do not implement from interpretation. Inspect `docs/references/showroom/points/` first and request any missing icons, reward/level graphics, badges or illustrations before finalizing.

### My products — visual alignment to `my-products-ref-01/02`

Followed ref-01: page header (icon + title + subtitle), four summary cards that are also the status filters ("View all"), Add product + search row, category/sort row, scrolling category chips, count line with Grid/List toggle, product cards (status chip on the image, name, code, category pill, colors, unit • size • weight, on/off switch, Edit / Manage photos / Archive). Followed ref-02: header with back link, form card with icon header, name/code, category, colors beside the photo uploader (up to 3), unit/size/weight row, Save + Cancel, "tips" side card at the start side.

Intentionally different (domain conflicts): no price, discount or stock badge (the catalog has no price/stock; price is undefined until a pricing rule is approved and offers are Phase 5); the fourth summary card is Archived instead of "products in offers" (offers are Phase 5); no "Create offer" button; "Delete" is Archive (products referenced by RFQs/saved lists/orders are never hard-deleted); colors are named chips, not hex swatches (the model stores names); filter button omitted (search, category and sort are the supported filters); extra fields kept (brand, description). The status label for an inactive product reads "Draft / مسودة" as in the reference. Asset pending: the header banner artwork (see ASSET REQUEST in the Phase 4 report) — the hero accepts a light and a dark image and shows the title block alone until they exist.

## Product data + UI polish (price, colors, description, dropdowns)

- **Base price** — stored in the owner-only table `public.product_prices` (`product_id` PK → products, `organization_id`, `base_price numeric(14,2)`, EGP, `> 0`, ≤ 100,000,000, at most 2 decimals). A product with no row has no price (historical products). A price once set can be changed but not blanked. There is **no** discounted / compare-at / percent column: promotional and package pricing belong to Product Offers (Phase 5). Cards show the base price only; a single-product offer may later show `regular → offer`, a multi-product package shows "Included in offer" and never an invented per-product price.
- **Colors** — `products.color_items jsonb` = ordered `[{name, hex}]` (hex = canonical `#RRGGBB` or null). The legacy `colors text[]` is kept equal to the item names; a historical product has `color_items = []` and renders its names as *unset* swatches — a value is never guessed from a name. The Add color popover (palette + hex + native picker + name) edits/removes; swatches reveal the name on hover, focus and click.
- **Description** — 250 **words** (was 600 characters): check constraint `ck_products_desc_words` (+ 5000-char sanity ceiling), `app.word_count`, mirrored in `countWords`. Live `n/250` counter inside the textarea.
- **Dropdowns** — the native `<select>` popup is replaced in the product experience by `components/ui/select-menu.tsx` (button + portalled listbox, anchored to the trigger, max-height with internal scroll, flips upward when short of space, keyboard: Arrows/Home/End/type-ahead/Enter/Space/Escape/Tab, `aria-selected`). The shared native `Select` is untouched for the rest of the app.
- **Hex literals** — the foundation guard forbids raw hex in code. Product colour *values* are data, so the Add color palette lives in one allow-listed file (`products/color-palette.ts`); tests build hex with a `h()` helper.
- **Numerals** — product counts, price and the photo/word counters use Latin digits (the Arabic display face makes ٠ look like a dot). Local decision; the app-wide numeral rule is unchanged.
- **Price visibility (decided)** — the base price is PRIVATE to the owning organization. It originally lived on `products.base_price`, which the published-row RLS (`products_select_published`) exposed cross-tenant through the table API; migration `20261010090001` copied it into `product_prices` (RLS: `app.is_org_member(organization_id)` only; no write grants — `own_product_create/update` are the only writers) and dropped the column. The app reads it with `listProductPrices` (server query on `product_prices`). Phase 5 offers will expose the offer / package price to eligible audiences; the regular price stays private.
- **Color visibility (decided)** — `products.color_items` / `colors` are public product attributes: a published product's colors are readable by catalog viewers (via the table's published-row policy). The canonical `catalog_published_products` view does not list them today (its 18 columns are pinned); public product reads should keep going through that view, and adding colors to it is a deliberate, additive change for when Browse cards show swatches.
- **Grid density** — My Products and Browse use 2 / 3 / 4 / 5 columns at mobile / tablet (768) / desktop (1024) / wide (1440); card images are 4:3 on mobile and 16:9 from tablet up.

## Browse = discovery + RFQ; one dropdown system (pre-Phase-5 correction)

**Price rule (final).** Aladdin is not a public-price marketplace. The regular price lives only in `product_prices` (owner organization). Browse cards, the product detail, `catalog_published_products` and every buyer-facing API show **no price**; the only price another organization will ever see is a Product Offer's (Phase 5).

**Browse excludes the active organization's own products.** `listCatalog({ excludeOrgId })` adds `organization_id <> :active` to the query itself (the showroom passes `ctx.org.organizationId`; switching workspace changes the id, so the exclusion follows). The production `/b2b` catalog does not pass it and is unchanged. Own products live in My Products.

**Browse card fields:** image, category badge, name, code (SKU), real color swatches (`SwatchRow`, max 5 then `+N`, name on hover/focus/tap, accessible name), the compact `unit • size • weight` line (`productMetaLine`; only values that exist, no empty separators), supplier name (+ verified mark), save button. The detail page shows the same public attributes (swatches with names, size, weight, unit, brand, description, supplier) and no price.

**Public color read model.** Migration `20261011090001` appends `color_items` to `catalog_published_products` (now 19 columns, pinned by pgTAP 29). Legacy products fall back to their `colors` names as unset swatches; a value is never guessed.

**RFQ action.** Browse detail keeps "Request quotation" (`commerce.catalog.requestQuote`) → the existing production flow `/b2b/rfqs/new?product=<id>`; the showroom RFQ pages are a later phase, so this adapter link stays and no new RFQ system was built.

### Dropdowns
`Select` (`@/components/ui/controls`) keeps the native API (`<option>` children, `value`/`defaultValue`, `onChange(e)`, `name`, `required`, `disabled`) but renders the shared `SelectMenu` (button + portalled listbox; anchored, flips upward, internal scroll, RTL/LTR, light/dark, keyboard, type-ahead, dirty-form events, `required` validation). Every one of the ~55 former native `<select>` call-sites (sales, organization, onboarding, auth, jobs, commerce, profile, settings, filters, header switchers) therefore uses it. ESLint now forbids a raw `<select>` JSX element. Native controls that stay native: file inputs, the `<input type="color">` inside the color popover (it is color DATA), date/time inputs.

**Follow-up checklist — custom (non-native) menus not yet on `SelectMenu`.** None is a browser-native popup and all use the shared `menuSurfaceClass` / token styling, but they are separate implementations:
| Route | Component | Control | Why not migrated |
|---|---|---|---|
| `/preview/installer-account` | `installer-account-preview/profile-completion-preview.tsx` | specialties multi-select listbox, governorate/city comboboxes | multi-select + searchable; needs a `SelectMenu` multi/search variant |
| `/preview/installer-my-work` | `installer-my-work-preview/installer-my-work-preview.tsx` | filter listbox | installer preview skin, own state machine |
| `/preview/installer-reviews` | `installer-reviews-preview/installer-reviews-preview.tsx` | filter listbox | same |
| `/preview/installer-network/refer` | `installer-network-preview/installer-showroom-referral-preview.tsx` | governorate/city listbox | same |
| installer job opportunities | `installer-job-opportunities-preview/opportunity-filters.tsx` | filter listbox | same |
| installer sign-up / dashboard | `installer-dashboard-preview/installer-phone-field.tsx` | country-code listbox | searchable list |
| `/b2b` dashboard | `home/period-select.tsx` | period menu (`menuitemradio`) | already custom + styled; different semantics |

## Phase 5 — Product Offers

**One shared domain, not showroom-only.** `product_offers` / `product_offer_items` / `product_offer_audiences` (+ `offer_audience_types`), migrations `20261012090001`, `20261013090001`, `20261014090001`, `20261015090001` (closeout). Any product-owning business can own offers; each shell renders the same shared components (`frontend/src/features/offers/*`) through a thin route adapter. Offers are NOT RFQs, quotations, purchase requests or orders and share no table with them.

**Pricing.** One package price per offer (`total_price numeric(14,2)`, EGP, `> 0`). Optional offer-level `reference_price` ("price before the offer"): typed by the owner, strictly greater than the package price, never derived from `product_prices`, never turned into a percentage. No per-product offer price, no discount / savings figure, no stock. Offers never read or write `product_prices`; a product may sit in many offers.

**Quantity.** `product_offer_items.quantity` integer 1…100000, validated in the UI, the server action and the database; one row per product per offer.

**Lifecycle.** Stored status `draft | published | paused | archived`; `scheduled | active | expired` are DERIVED (`app.offer_phase`) from the status and `starts_at <= now() < ends_at`, so nothing has to run at expiry. Transitions (RPC `own_offer_set_status`, `catalog.publish`): publish (draft→published), pause (published→paused), resume (paused→published), archive (draft / paused / expired-published only), restore (archived→draft). Editing (`own_offer_save`, `catalog.write`) is allowed for draft, paused and scheduled offers; changing an already-published (scheduled) offer additionally needs `catalog.publish`. An active offer must be paused first. Rows are never hard-deleted.

**Product eligibility.** Draft offers may hold any of the owner's non-archived, non-deleted products. Publishing/resuming re-validates the whole package: every product published, owned, not archived; audiences feed-ready; window not already over. If a product later stops being valid (unpublished / archived / deleted) the offer is **hidden from audiences automatically** (`app.offer_is_live` checks every product on every read) and the owner sees "N products need review" on the card; republishing the product brings the offer back while still inside its window.

**Audiences.** Canonical codes only (`organization_type` for business viewers, `persona_type` for personal viewers; the sets are disjoint), stored one row per audience. The builder offers **eight audience groups**; a group is a UI grouping only — choosing one stores its explicit canonical rows (no group enum exists in the database):

| Group (AR / EN) | Stored canonical rows |
|---|---|
| معرض / Showroom | `showroom_dealer` |
| مورد / Supplier | `supplier` |
| مصنع / Manufacturer | `manufacturer` |
| مستورد / Importer | `importer` |
| مقاول / Contractor | `contractor_company` (business) + `contractor` (persona) |
| مهندس / Engineer | `design_office` (business) + `engineer` + `interior_designer` (personas) |
| صنايعي / Craftsman | `installer_technician` |
| العميل النهائي / End customer | `end_consumer` (added to the catalogue) |

`wholesaler` stays a valid stored audience and its workspaces see the feed, but it has no builder group (it was not among the approved eight). All catalogue rows are `feed_ready`: `/b2b` serves every organization type and `/home` every persona. Nothing is shown as "coming soon".

**One visibility rule** (`app.offer_is_live` + `app.viewer_offer_audience`), applied inside `offers_feed(p_org_id)` / `offer_detail(p_offer_id, p_org_id)`: published AND inside the window AND the viewer's workspace type is one of the offer's audiences AND the owner organization is live AND every product is still valid AND it is not the viewer's own offer. A business viewer is matched on the ACTIVE workspace's `organization_type`, so switching workspace changes the feed. The tables are owner-readable only (RLS); audiences read through the two RPCs, which return a fixed, price-safe projection (no `product_prices`). The internal helpers are not granted to clients (`20261014090001`).

**Pages.** Showroom suite: `/offers`, `/offers/[offerId]`, `/my-offers` (إدارة العروض — the only place an offer is created), `/my-offers/new`, `/my-offers/[offerId]/edit`. Other shells (thin adapters over the same `features/offers` feed/detail): `/b2b/offers` + detail (every business workspace; nav key `productOffers`, same browse capability as the catalog — distinct from the existing "offers" key that means incoming quotations) and `/home/offers` + detail (every personal persona; rows in the personal rail and the installer rail). My Products keeps only the real offer chips ("Active offer" / "In an offer"); it has no Create-offer entry.

**RFQ action on the offer detail.** "Request a quotation" → the existing production flow `/b2b/rfqs/new?product=<first product>`; a package-level RFQ belongs to the later RFQ phase (same adapter as Browse).

**Intentionally different from the references.**
- Header art strips (feed / management / builder) are not shown — no asset supplied (ASSET REQUEST in the phase report).
- Builder: no "offer type" selector (only one type exists); the Create-offer button on My Offers uses the offer/tag icon grouped with its label (the reference draws a plus at the far end).
- Feed: no featured wide card; detail: no business-profile link (no showroom profile page yet), the contact button is "Request a quotation" (offers are not chat subjects), related offers come from the same feed.
- Builder preview "total quantity" is the plain sum of per-product quantities (units differ per product).

## Phase 5 closeout (2026-10-08)

Migration `20261015090001_offers_closeout.sql`; no backend rebuilt, everything additive.

- **Feed density.** 1 / 2 / 3 / 4 / **5** columns at mobile / ≥560 / tablet / desktop / wide (1440). My Offers is untouched (management density).
- **Pagination (`offers_feed_page`).** One RPC applies search (title, seller, product name/code; `%`/`_` escaped), category, seller type, period (`ending` ≤ 3 days, `week` ≤ 7 days), sort (`newest`, `ending`, `priceLow`, `priceHigh`) and the saved-only filter, then returns ONE bounded page via `row_number()` over a TOTAL order (the sort key, then `published_at`, then `id`) with `LIMIT`/`OFFSET` (limit clamped 1..50, offset ≤ 10 000), plus `total`, `has_more`, whole-eligible-set `stats` and `seller_types`. The first batch (10 = 2 × 5) is rendered by the server; **Show more** is a server action that asks for the next 10 at `offset = items already shown`; **Show less** removes ONE batch per click (see the collection-loading rule below), without touching filters; any filter/sort/search change restarts at offset 0 (search debounced 300 ms); stale responses are dropped; the client also de-duplicates by id. Chosen over a cursor because the sort keys are not unique and offsets over a total order give the same no-overlap/no-gap guarantee for a stable eligible set; if offers appear or expire between two clicks a row can shift by one, never duplicate (client dedup) — acceptable for a browse feed.
- **Saved offers.** `saved_product_offers (user_id, offer_id)`: a USER bookmark (unlike the organization-owned `saved_products`), select-own RLS, no client writes; `offer_set_saved(offer, saved, org)` saves only an offer the caller can see **right now** (`app.offer_visible_to` — the same rule as the detail RPC), unsaving is always allowed, anonymous is denied. The feed and detail projections carry `saved`, so both share one state. A bookmark never grants access: once an offer is paused/expired/out of audience, `offer_detail` returns null and it drops out of the feed and the saved-only list.
- **Description.** 250 WORDS (`app.word_count`, whitespace runs — Arabic/English/mixed), a 5000-character sanity ceiling, the old 500-character check dropped; validated in the form (live counter inside the textarea), the server action and the RPC/CHECK.
- **Builder.** At desktop the workspace fills the viewport below the top bar (height measured from its own top, no page scroll); the live preview (with a completeness checklist) stays on one side, the editor — header included — scrolls inside its own column, the sticky action bar stays in it, and the selected-products list keeps its own nested scroll. Stacked and page-scrolled below 1024.
- **Price before the offer.** Struck through with `decoration-danger`. In this palette `--danger` resolves to the approved muted terracotta (the installer theme has no separate red), which is the sanctioned fallback; the package price stays dominant.
- **Icon + label rule.** Summary cards use one `IconStat` (icon, label and figure form one inline group that follows the reading direction); My Products and My Offers cards were moved onto it. Page titles and section headings already group icon and text; genuine independent actions (bookmark, row menus) were left alone.
- **Remaining shells.** Done: showroom suite, `/b2b`, `/home` (personal rail and installer rail). Not done: a package-level RFQ from an offer; personal accounts have no RFQ entry yet (the block is hidden for them); mobile bottom bars were not curated for the new Offers entry (final mobile polish is deferred).

## Collection loading rule + product colour UX (2026-10-08)

### One bounded loading rule for every growing collection

- **Rule.** First batch = **10** rows (two rows at the 5-column wide desktop). **Show more** appends ONE batch of 10 via a real range read at `offset = rows already shown`; **Show less** removes ONE batch (37 → 30 → 20 → 10, never straight to 10, hidden at 10); a compact "Showing N of M" line uses Latin digits; **Show more** is visible only while more rows match. Nothing fetches everything and hides the rest.
- **Shared code.** `lib/pagination/batches.ts` (pure: `PAGE_BATCH`, `lessCount`, `appendUniqueById`, `PagedLoad` — importable from server code), `lib/pagination/use-paged-list.ts` (the client hook; separate file so server actions never import React), `components/ui/pager.tsx` (the buttons + count; moves focus to the surviving button when the pressed one disappears).
- **Collections converted** (each: first batch server-rendered, "Show more" a server action that re-derives the organization from the session, exact total from the same query, a TOTAL order so offset batches neither repeat nor skip):
  - Browse Products — `listCatalogPage` (`published_at desc, id desc`), own organization excluded in the query, no price column; `catalog-feed.ts` action. The old `?limit=` URL knob (100 → 500) is gone.
  - My Products — `listOwnProductsPage`; the four summary cards still come from `ownProductCounts` over the whole shelf (never from the 10 on screen).
  - Saved Products (`/b2b/saved`) — `listSavedProductsPage` + `savedCategoryCounts` for the tabs; save state is asked only for the visible batch.
  - My Offers — filtering moved from the browser (200-row read) to the server: `listOwnOffersPage` over `own_product_offers` (phase, audience group, text over title + product names/codes, period, sort); `ownOfferPhaseCounts` feeds the stat cards/chips (whole history). Migration `20261016090001_my_offers_paging.sql` adds two derived read-only columns to the owner view (`audiences`, `search_text`).
  - Offers feed — unchanged architecture (`offers_feed_page`); only Show less changed from "collapse to 10" to "remove one batch".
- **Filters.** Any filter/search/sort change restarts at offset 0 (server-rendered pages remount their client list with `key=filters`; the client-filtered Offers feed / My Offers re-request offset 0). After a lifecycle action (publish/pause/archive, un-save) the page re-renders with fresh rows and the list restarts from the first batch.
- **Not changed (audited).** The production `/b2b/catalog` and `/b2b/products` pages (not showroom suite) keep their 100-row reads; small fixed lists (stat cards, category chips, the builder's own picker) are untouched.

### Product colour swatches — root cause and the shared fix

- **Bug.** `Swatch` revealed its name with Tailwind `group-hover:`/`group-focus-within:`. Those variants match ANY ancestor carrying the bare `group` class — and every product card/row is a `group` — so hovering anywhere on a card showed the names of all its swatches, overlapping neighbouring metadata.
- **Fix.** One shared `Swatch` (cards, rows, offer detail/builder, product detail, the editor) owns its tooltip with pointer-enter/leave **on the swatch button itself**, keyboard focus, and click-to-pin (cleared by click again, Escape, blur or an outside press). The tooltip is a portalled, fixed-position popup on the shared menu surface (`menuSurfaceClass`, `z-popover`), centred on the swatch, flipping below when there is no room and clamped to the viewport; `dir` follows the reader's language; the name is also the swatch's accessible name (`aria-describedby` while shown).

### Add colour = search the canonical library

- `features/showroom-shell/products/color-library.ts`: ~70 colours with a **stable `code`**, Arabic + English names, canonical hex (unique) and search aliases; pure local data (allow-listed for raw hex in the foundation guard), no network, no runtime generation. `searchColors` normalizes Arabic (hamza/alef, ya, ta marbuta, diacritics, tatweel, Arabic-Indic digits) and ranks exact → prefix → word-prefix → contains → alias; "أحمر" → أحمر, أحمر داكن, أحمر فاتح, قرمزي, خمري…; "blue" → Blue, Dark Blue, Sky Blue, Navy….
- The name field is an ARIA combobox (`color-combobox.tsx`): portalled list anchored to the input (flips above when needed, scrolls inside, viewport-clamped), arrows/Enter/Escape, active option highlighted with its swatch, polite announcement of the chosen colour.
- Behaviour: choosing a name fills the code and preview; editing the code or using the native picker re-resolves to a library name only on an EXACT hex match, otherwise the colour is **Custom colour #HEX** (an automatic label — the owner is never asked to invent a name). Exact duplicates (same library colour, or same value) are refused; up to 12 colours; a swatch re-opens the popover to change/remove it.
- **Storage.** `color_items` keeps its shape (`name`, `hex`) and gains an OPTIONAL stable `code` (`red`, `dark_blue`, or the reserved `custom`) — additive migration `20261016090002_product_color_codes.sql` (normalizer keeps a well-formed code, dedupes a library colour once, lets `custom` repeat). Readers resolve a coded colour to a name in THEIR language; historical colours (no code) show their stored name unchanged.
