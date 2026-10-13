# Marketplace product database

**Status:** in progress — Migration 01 of 04 authored, applied to the isolated local Supabase stack and validated by the full pgTAP suite (see "Validation record").
**Branch / worktree:** `feat/public-marketplace-20261011` · `D:\projects\aladdin-wt-public-marketplace-20261011` (from `origin/main` @ `6c088d9`). Nothing is merged, pushed or deployed.

## Purpose

The database foundation of the public, direct-price **B2C Marketplace** (ADR-0011). It is a separate E-Commerce domain: every object is named `marketplace_*`, references no B2B object, and does not touch `public.products`, RFQs, quotations, B2B orders, Showroom account schemas, memberships or the Kashier integration.

## Domains and migrations

| # | Migration | Domain | State |
|---|---|---|---|
| 01 | `20261012090001_marketplace_taxonomy_and_attributes.sql` | Taxonomy + dynamic attribute definitions | applied + tested locally (isolated Supabase) |
| 02 | `20261013090001_marketplace_product_core.sql` | Products & sellers · Attribute values · Images | applied + tested locally (isolated Supabase) |
| 03 | inventory | Inventory | not started |
| 04 | bulk import foundation (jobs, errors, optional staging) | Bulk import (15,000+ products) | not started |

Product types are **rows, not an enum**. Adding paints, doors, flooring, curtains or posters is an `INSERT` plus field mappings — no structural change.

## Migration 01 — tables

| Table | Role |
|---|---|
| `marketplace_categories` | navigation grouping (3 seeded) |
| `marketplace_product_types` | what a listing is (6 seeded: wallpaper, wood_alternative, marble_alternative, sheeboard, cornice, corner_trim) |
| `marketplace_attribute_definitions` | a field defined once: `data_type` text · number · boolean · option · multi_option · measurement; `unit_kind` length / weight / volume |
| `marketplace_product_type_attributes` | which fields a type has: `level` product / variant, `is_required`, `is_filterable`, `is_variant_axis`, per-type label override |
| `marketplace_attribute_options` | allowed values of an option field (materials, patterns, 19 colours with swatch) |

### Rules enforced in the database

- Keys: `lower_snake_case`, 2–64 chars; Arabic and English names required.
- `data_type`, `unit_kind` and `key` of a field are **immutable** (a trigger) — changing them would reinterpret stored values.
- Only `option` / `multi_option` fields own options; an option never changes field.
- A variant axis exists only at variant level and never on free text.
- A measurement names its unit kind; canonical units: **length = mm, weight = g, volume = ml**. A label such as "290 x 20 cm" is never stored.
- Disabling is `is_active = false`. Value tables (Migration 02) reference definitions and options `ON DELETE RESTRICT`, so a field holding data cannot be deleted, only switched off.
- "Up to three variant axes" is a V1 **seller-UI** limit, deliberately not a database constraint.

### Security

- RLS **enabled** on all five tables.
- `anon` and `authenticated` read **active** rows only; platform staff (`app.is_admin_staff()`) read retired rows too.
- **No** insert / update / delete grant or policy for `anon`, `authenticated` or `service_role`. Rows change by migration today; the future Schema Builder writes through audited, permission-checked RPCs.
- No `SECURITY DEFINER` function is introduced.

## Migration 02 — product core

| Table | Role |
|---|---|
| `marketplace_products` | a listing owned by a seller org (V1: showroom), slug, bilingual name/description, brand, status draft / published / unpublished / archived |
| `marketplace_product_variants` | sellable SKU: seller-scoped SKU, selling unit, `numeric(12,2)` price EXCL. VAT, active/inactive, trigger-owned `option_signature` |
| `marketplace_product_attribute_values` | typed relational product-level values (text / number / boolean / option / multi_option / measurement) |
| `marketplace_variant_attribute_values` | same, at variant level (colour, thickness, roll width, weight) |
| `marketplace_product_images` | image metadata: provider, bucket, stable object key, order, primary flag, alt text, status — no bytes, no URLs |

**Integrity (database-level):** seller + product type immutable; seller must be a live showroom; slug globally unique; SKU unique per seller; a variant cannot name a seller different from its product (composite FK); a field must be mapped to the product type at the right level and be active; an option must belong to its field (guard + composite FK); typed-shape CHECK; no duplicate single-valued value; a duplicate variant combination is rejected by a partial UNIQUE index on `(product_id, option_signature)` (verified with two real concurrent sessions); one active primary product image; an image's variant must belong to the same product; object keys reject URLs, query strings, traversal and absolute paths; a mapping in use cannot be deleted or re-levelled (disable it instead).

**Fail closed:** `status = published` is unreachable. `app.marketplace_publication_blockers()` always reports `seller_enablement_not_available` and `inventory_not_available`; a BEFORE trigger refuses the transition for every role. It also reports missing required fields (read from the live mapping), missing variants, ambiguous variant combinations and a missing verified primary image.

**Access:** RLS on all five tables; SELECT only, to `authenticated` (members of the seller organization, platform staff) and `service_role`; **no anon grant**, no write grant or policy for anyone.

**Deferred (documented in the migration header):** seller enablement table + audited RPC; inventory (Migration 03); media verification flow; public catalogue projection.

## Isolation

1. **Git:** dedicated worktree and branch; the `main` working tree and the landing-page worktree are untouched.
2. **Database:** Git worktrees do not isolate databases. Local Supabase uses fixed default ports (`54321`/`54322`) and `project_id = "aladdin"`, so a second worktree starting the stack would collide with another. Use a dedicated local project identity and ports for this worktree **without committing machine-specific values**, and never run `supabase db push` / remote resets.
3. **Schema:** `marketplace_*` namespace; no object of the B2B domain is altered.

## Validation record

| Check | Result |
|---|---|
| Isolated local stack (`project_id = aladdin-marketplace`, ports 544xx; machine-local, not committed) | ✅ |
| `supabase db reset` — all **106** migrations (incl. 01 and 02) + seeds | ✅ |
| `supabase test db` — whole suite, **89 files / 3840 tests** | ✅ **PASS** |
| `90_marketplace_taxonomy_attributes_test.sql` (63) | ✅ |
| `91_marketplace_product_core_test.sql` (99) | ✅ |
| Existing B2B / RLS suites (01–89) | ✅ no regression |
| Two real concurrent sessions racing the same option combination | ✅ one committed, the other failed with `23505` (`ux_marketplace_variants_product_signature`) |

An earlier scratch run (PostgreSQL 17.5, stubbed baseline) caught one real defect — a `CHECK` that a NULL `unit_kind` silently satisfied — which was fixed before the local-stack run.

Not covered here: hosted Staging/Production (never touched), Storage policies (no bucket in this migration), and a concurrency test (no write path exists yet).
