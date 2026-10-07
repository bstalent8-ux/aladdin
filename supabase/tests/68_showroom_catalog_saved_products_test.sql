-- pgTAP: the showroom's "تصفح المنتجات" reuses the production catalog + saved-products
-- backend unchanged. This file pins the guarantees the suite depends on, against
-- the EXISTING view and RPCs (no schema change in Phase 3):
--
--   * VISIBILITY — a showroom sees published products of other tenants, never a draft.
--   * SAVE / UNSAVE — membership-scoped, duplicate-safe, idempotent on removal.
--   * TENANCY — one organization can neither write to, read, nor remove another's
--     shortlist, and a product that is not published cannot be saved.
--   * No direct table writes and no anonymous access.
--
-- Fixtures, from seed-pilot:
--   Hana  (70000001…001) org.manage on Cairo Ceramics Showroom (9c…001)
--   Tarek (70000003…003) org.manage on Egypt Marble Manufacturing (9d…002)

create extension if not exists pgtap;

begin;
select plan(15);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'

-- Fixtures (superuser, rolled back): one published product of Tarek's tenant, one draft of any tenant.
create temp table _p on commit drop as
  select
    (select id from public.products where organization_id = :'orgM'::uuid and status = 'published' and deleted_at is null order by id limit 1) as pub,
    (select id from public.products where status = 'draft' and deleted_at is null order by id limit 1) as draft;
grant select on _p to authenticated;
-- Start from a known shortlist for the two organizations under test.
delete from public.saved_products where organization_id in (:'orgC'::uuid, :'orgM'::uuid);

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';

-- A. Visibility: the showroom sees another tenant's published product, never a draft.
select is((select count(*)::int from public.catalog_published_products where id = (select pub from _p)), 1,
  'a showroom sees another tenant''s published product in the catalog');
select is((select count(*)::int from public.catalog_published_products where id = (select draft from _p)), 0,
  'a draft product never appears in the catalog');

-- B. Save: membership-scoped and duplicate-safe.
select lives_ok(format('select public.save_product(%L, %L)', :'orgC', (select pub from _p)),
  'a member saves a published product for their own organization');
select is((select count(*)::int from public.saved_products where organization_id = :'orgC'::uuid and product_id = (select pub from _p)), 1,
  'the shortlist holds the product');
select lives_ok(format('select public.save_product(%L, %L)', :'orgC', (select pub from _p)),
  'saving again is accepted');
select is((select count(*)::int from public.saved_products where organization_id = :'orgC'::uuid and product_id = (select pub from _p)), 1,
  'saving twice never creates a duplicate row');
select throws_ok(format('select public.save_product(%L, %L)', :'orgC', (select draft from _p)),
  'P0002', null, 'a product that is not published cannot be saved');
select throws_ok(format('select public.save_product(%L, %L)', :'orgM', (select pub from _p)),
  '42501', null, 'a member cannot save into another organization''s shortlist');

-- C. Tenancy: shortlists are private per organization.
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok(format('select public.save_product(%L, %L)', :'orgM', (select pub from _p)),
  'the other organization keeps its own shortlist entry for the same product');
select is((select count(*)::int from public.saved_products where organization_id = :'orgC'::uuid), 0,
  'the other organization cannot read Cairo Ceramics'' shortlist');

set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(format('select public.unsave_product(%L, %L)', :'orgM', (select pub from _p)),
  '42501', null, 'a member cannot remove another organization''s saved product');

-- D. Unsave: removes only the caller's own entry, and is idempotent.
select lives_ok(format('select public.unsave_product(%L, %L)', :'orgC', (select pub from _p)),
  'a member removes the product from their own shortlist');
select is((select count(*)::int from public.saved_products where organization_id = :'orgC'::uuid and product_id = (select pub from _p)), 0,
  'the entry is gone');
select lives_ok(format('select public.unsave_product(%L, %L)', :'orgC', (select pub from _p)),
  'removing an absent entry is a harmless no-op');

-- E. No direct writes (the RPCs are the only door).
select throws_ok(
  format('insert into public.saved_products (organization_id, product_id, saved_by) values (%L, %L, auth.uid())', :'orgC', (select pub from _p)),
  '42501', null, 'saved_products cannot be written directly');

select * from finish();
rollback;
