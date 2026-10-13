# Marketplace product database

**Status:** in progress — Migration 01 of 04 authored and validated on a scratch PostgreSQL; **not yet validated on the full local Supabase stack** (see "Validation record").
**Branch / worktree:** `feat/public-marketplace-20261011` · `D:\projects\aladdin-wt-public-marketplace-20261011` (from `origin/main` @ `6c088d9`). Nothing is merged, pushed or deployed.

## Purpose

The database foundation of the public, direct-price **B2C Marketplace** (ADR-0011). It is a separate E-Commerce domain: every object is named `marketplace_*`, references no B2B object, and does not touch `public.products`, RFQs, quotations, B2B orders, Showroom account schemas, memberships or the Kashier integration.

## Domains and migrations

| # | Migration | Domain | State |
|---|---|---|---|
| 01 | `20261012090001_marketplace_taxonomy_and_attributes.sql` | Taxonomy + dynamic attribute definitions | authored · scratch-validated |
| 02 | product core (products, variants, attribute values, images) | Products & sellers · Images | not started |
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

## Isolation

1. **Git:** dedicated worktree and branch; the `main` working tree and the landing-page worktree are untouched.
2. **Database:** Git worktrees do not isolate databases. Local Supabase uses fixed default ports (`54321`/`54322`) and `project_id = "aladdin"`, so a second worktree starting the stack would collide with another. Use a dedicated local project identity and ports for this worktree **without committing machine-specific values**, and never run `supabase db push` / remote resets.
3. **Schema:** `marketplace_*` namespace; no object of the B2B domain is altered.

## Validation record

| Check | Result |
|---|---|
| Migration applies in one transaction (PostgreSQL 17.5, scratch, UTF-8) | ✅ |
| `supabase/tests/90_marketplace_taxonomy_attributes_test.sql` (63 assertions, pgTAP shim) | ✅ 63/63 |
| Full local Supabase stack (`supabase start`, `db reset`, `test db`) incl. existing B2B regression suite | ⛔ **not run** — Docker Desktop's backend does not start on this machine (stale unix-socket reparse points in `%LOCALAPPDATA%\Docker\run`) |

The scratch run used a **stubbed baseline** (`auth.users`, `auth.uid()`, `app.set_updated_at`, `app.is_admin_staff`, `platform_role_grants`, roles) and a small pgTAP shim, so it proves the SQL and the invariants, not the interaction with the real 80+ migration baseline. It caught one real defect (a `CHECK` that a NULL `unit_kind` silently satisfied) that was fixed before this record.

Open before this migration can be called applied: run `supabase db reset` and `supabase test db` against an isolated local stack.
