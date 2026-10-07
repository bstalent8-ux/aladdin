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
