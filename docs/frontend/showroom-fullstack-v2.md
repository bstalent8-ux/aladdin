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

## Consequences

Existing queries and RPCs provide substantial reuse, but their production redirects and business capability assumptions need per-feature review. The old static preview is design evidence only, not an authorization or persistence layer. Shared schema changes must remain additive so production remains compatible until promotion.

## Related files

- [UI contract](UI_CONTRACT.md)
- [Existing showroom completeness specification](sprint-14-showroom-mvp-completeness.md)
- [Runtime checkpoint](../operations/RUNTIME_STATE.md)
- [Work log](../operations/AGENT_WORK_LOG.md)
