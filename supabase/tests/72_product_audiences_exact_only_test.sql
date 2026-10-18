-- pgTAP: product target audiences, EXACT-ONLY access (20261015090018).
--
-- Claims under test:
--   * Eight canonical audiences; Sales Team is NOT one (it inherits its workspace's audience).
--   * Direct cross-tenant reads of products / audiences / prices / images fail.
--   * A workspace reads a product only when it is targeted; switching workspace flips access
--     for the SAME person; no workspace + no personal audience = nothing.
--   * Sales Team users get exactly the audience of the workspace they represent.
--   * Personal personas (engineer, contractor, installer, end customer) read by persona;
--     legacy / untargetable values read nothing.
--   * Direct product references (save, RFQ item) and image signing cannot bypass the audience.
--   * Publishing needs >= 1 audience; owners edit audiences; drafts stay private.
--
-- Fixtures (seed-pilot): Hana (orgC showroom owner) - Sara (sales member of orgC) - Tarek (orgM
-- manufacturer owner) - Delta (orgS supplier owner, the product owner here) - 7000..06 contractor
-- persona - 7000..07 sales member of a contractor company - 7000..10 engineer persona, no org -
-- 7100..04 design office member - 7100..06 installer - 7100..07 / 7100..10 re-typed in-test.

create extension if not exists pgtap;

begin;
-- The seed keeps Egypt Marble and Nile Import PENDING on purpose (the Admin review queue). A
-- pending organization is non-operational (20261015090028), so a suite that needs them to act
-- as established businesses approves them here, inside its own transaction.
update public.organizations set status = 'active', is_verified = true
 where id in ('9d000000-dddd-4ddd-8ddd-000000000002', '9e000000-eeee-4eee-8eee-000000000003');
select plan(90);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'
\set orgS '9f000000-ffff-4fff-8fff-000000000004'
\set orgDesign '91000004-1111-4111-8111-000000000004'
\set orgContractor '9a000000-aaaa-4aaa-8aaa-000000000005'
\set hana   '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sara   '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set tarek  '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set delta  '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set contractor '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}'
\set salesx '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}'
\set engineer '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}'
\set designer '{"sub":"71000004-0000-4000-8000-000000000004","role":"authenticated"}'
\set installer '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}'
\set consumer '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}'
\set legacy '{"sub":"71000010-0000-4000-8000-000000000010","role":"authenticated"}'

-- A. Structure ------------------------------------------------------------------------
select set_eq($$ select code from public.product_audience_types $$,
  $$ values ('showroom_dealer'),('supplier'),('manufacturer'),('importer'),('contractor'),('engineer'),('installer_technician'),('end_consumer') $$,
  'exactly the eight canonical audiences exist (no Sales Team audience)');
select ok((select relrowsecurity from pg_class where oid = 'public.product_audiences'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.product_image_grants'::regclass),
  'RLS is enabled on product_audiences and product_image_grants');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_select_published'), 0,
  'the "any authenticated user reads any published product" policy is gone');
select ok(to_regclass('public.catalog_published_products') is null and to_regclass('public.saved_product_list') is null,
  'the cross-tenant catalog and saved views are gone (workspace-aware readers replace them)');
select is((select count(*)::int from public.products p
            where p.status = 'published'
              and (select count(*) from public.product_audiences a where a.product_id = p.id) <> 8), 0,
  'every pre-existing published product was backfilled with all eight audiences');
select ok(not has_function_privilege('anon', 'public.catalog_products(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.saved_products_for(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.catalog_product_images(uuid, uuid[])', 'execute')
      and not has_function_privilege('anon', 'public.product_image_access_grant(uuid, text[])', 'execute')
      and not has_function_privilege('anon', 'public.product_audiences_set(uuid, text[])', 'execute')
      and has_function_privilege('authenticated', 'public.catalog_products(uuid)', 'execute'),
  'readers and the audience writer are not callable by anon');

-- B. The mapping (pure) ---------------------------------------------------------------
select is(app.org_product_audience(:'orgC'), 'showroom_dealer', 'showroom workspace -> showroom_dealer');
select is(app.org_product_audience(:'orgM'), 'manufacturer', 'manufacturer workspace -> manufacturer');
select is(app.org_product_audience(:'orgDesign'), 'engineer', 'design office workspace -> engineer (the repo''s canonical Engineer business)');
select is(app.org_product_audience(:'orgContractor'), 'contractor', 'a contractor company workspace acts as the Contractor account (internal business behind it, not a tenth type)');
select is((select array_agg(app.persona_product_audience(x) order by x) from unnest(array['contractor','end_consumer','engineer','installer_technician']) x),
  array['contractor','end_consumer','engineer','installer_technician'], 'the four personal audiences map to themselves');
select is((select count(app.persona_product_audience(x))::int from unnest(array['sales','interior_designer','trainer','trainee','showroom_dealer','wholesaler','design_office','contractor_company']) x), 0,
  'sales and every legacy / business value is no personal audience');

-- C. Owner write path -----------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'delta';
create temp table _p (name text primary key, id uuid);
grant all on _p to authenticated, anon;
insert into _p select 'ps', public.own_product_create(:'orgS'::uuid, 'Audience tile', 'AUD-1', 'wallpaper', 'roll', '[]'::jsonb, null, null, null, null, 120.5);
insert into _p select 'pm', public.own_product_create(:'orgS'::uuid, 'Manufacturer only', 'AUD-2', 'paints', 'pail');
insert into _p select 'pd', public.own_product_create(:'orgS'::uuid, 'Draft target', 'AUD-3', 'paints', 'pail');
insert into _p select 'pu', public.own_product_create(:'orgS'::uuid, 'No audience yet', 'AUD-4', 'paints', 'pail');

select throws_ok(format('select public.set_product_published(%L, true, 1)', (select id from _p where name = 'pu')),
  '22023', null, 'a product with no audience cannot be published');
select throws_ok(format($q$select public.product_audiences_set(%L, array['sales'])$q$, (select id from _p where name = 'pu')),
  '22023', null, 'Sales Team is not a product audience');
select lives_ok(format($q$select public.product_audiences_set(%L, array['showroom_dealer','engineer'])$q$, (select id from _p where name = 'ps')), 'owner targets a product');
select lives_ok(format($q$select public.product_audiences_set(%L, array['manufacturer'])$q$, (select id from _p where name = 'pm')), 'owner targets another product');
select lives_ok(format($q$select public.product_audiences_set(%L, array['showroom_dealer'])$q$, (select id from _p where name = 'pd')), 'a draft can hold audiences');
select lives_ok(format('select public.set_product_published(%L, true, 1)', (select id from _p where name = 'ps')), 'ps published');
select lives_ok(format('select public.set_product_published(%L, true, 1)', (select id from _p where name = 'pm')), 'pm published');
select throws_ok(format($q$select public.product_audiences_set(%L, array[]::text[])$q$, (select id from _p where name = 'ps')),
  '22023', null, 'a published product cannot lose its last audience');
select is((select count(*)::int from public.product_audiences where product_id = (select id from _p where name = 'ps')), 2, 'the owner reads its own product audiences');
select is((select base_price from public.product_prices where product_id = (select id from _p where name = 'ps')), 120.5::numeric, 'the owner still reads its private price');

set local request.jwt.claims = :'hana';
select throws_ok(format($q$select public.product_audiences_set(%L, array['importer'])$q$, (select id from _p where name = 'ps')),
  '42501', null, 'another organization cannot change a product''s audiences');

-- D. Direct reads across tenants fail --------------------------------------------------
select is((select count(*)::int from public.products where id = (select id from _p where name = 'ps')), 0, 'direct table read of another tenant''s PUBLISHED product returns nothing');
select is((select count(*)::int from public.product_audiences where product_id = (select id from _p where name = 'ps')), 0, 'another tenant cannot read the audiences');
select is((select count(*)::int from public.product_prices where product_id = (select id from _p where name = 'ps')), 0, 'private prices stay inaccessible');
select is((select count(*)::int from public.products where organization_id = :'orgS'::uuid), 0, 'listing another tenant''s products by owner id returns nothing');

-- E. Targeted / non-targeted / switching ----------------------------------------------
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'ps')), 1, 'a TARGETED workspace reads the product');
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'pm')), 0, 'a NON-targeted audience does not');
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id in (select id from _p where name in ('pd', 'pu'))), 0, 'drafts stay private');
select is((select count(*)::int from (select unnest(p.proargnames) n, unnest(p.proargmodes) m from pg_proc p where p.oid = 'public.catalog_products(uuid)'::regprocedure) x
            where m = 't' and n ~ 'price'), 0, 'the reader has no price column');
select throws_ok(format('select * from public.catalog_products(%L)', :'orgM'), '42501', null, 'naming a workspace the caller is not a member of is refused');
select is((select count(*)::int from public.catalog_products(null)), 0, 'no workspace and no personal audience: nothing is readable');

-- Manufacturer workspace (Tarek): sees the manufacturer-targeted product, not the showroom one.
set local request.jwt.claims = :'tarek';
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _p where name = 'pm')), 1, 'a manufacturer workspace reads a manufacturer-targeted product');
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _p where name = 'ps')), 0, 'and not a showroom/engineer-targeted one (direct detail by id returns nothing)');

-- Switching workspace changes access for the SAME person.
reset role;
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('70000001-0000-4000-8000-000000000001', :'orgM', 'active', now());
set local role authenticated;
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'ps')), 1, 'same person, showroom workspace: allowed');
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _p where name = 'ps')), 0, 'same person, manufacturer workspace: denied');
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _p where name = 'pm')), 1, 'same person, manufacturer workspace: the manufacturer product is allowed');
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'pm')), 0, 'same person, showroom workspace: it is denied');

-- Sales Team: inherits exactly the workspace's audience.
set local request.jwt.claims = :'sara';
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'ps')), 1, 'Sales Team of a showroom inherits the showroom audience');
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'pm')), 0, 'and nothing outside it');
select is((select count(*)::int from public.catalog_products(null)), 0, 'a Sales Team user with no workspace has no audience');
select throws_ok(format('select * from public.catalog_products(%L)', :'orgM'), '42501', null, 'a Sales Team user cannot borrow a workspace they do not belong to');
set local request.jwt.claims = :'salesx';
select cmp_ok((select count(*)::int from public.catalog_products(:'orgContractor'::uuid)), '>', 0, 'Sales Team of a contractor company reads exactly the Contractor audience of that workspace');

-- Personal personas.
set local request.jwt.claims = :'engineer';
select is((select count(*)::int from public.catalog_products(null) where id = (select id from _p where name = 'ps')), 1, 'engineer persona reads an engineer-targeted product');
select is((select count(*)::int from public.catalog_products(null) where id = (select id from _p where name = 'pm')), 0, 'and not a manufacturer-only one');
set local request.jwt.claims = :'designer';
select is((select count(*)::int from public.catalog_products(:'orgDesign'::uuid) where id = (select id from _p where name = 'ps')), 1, 'a design-office workspace carries the engineer audience');
set local request.jwt.claims = :'installer';
select is((select count(*)::int from public.catalog_products(null) where id in (select id from _p)), 0, 'craftsman persona reads none of the products that are not targeted at craftsmen');
reset role;
update public.users set primary_account_type = 'end_consumer' where id = '71000007-0000-4000-8000-000000000007';
set local role authenticated;
set local request.jwt.claims = :'consumer';
select is((select count(*)::int from public.catalog_products(null) where id in (select id from _p)), 0, 'end customer reads none of the products that are not targeted at them');
-- The retired interior_designer persona no longer exists: such a person was moved to Engineer by
-- migration, and a person holding NO supported account type has no audience at all.
reset role;
update public.users set primary_account_type = null where id = '71000010-0000-4000-8000-000000000010';
set local role authenticated;
set local request.jwt.claims = :'legacy';
select is((select count(*)::int from public.catalog_products(null)), 0, 'a person with no supported account type has no audience');
set local request.jwt.claims = :'contractor';
select is((select count(*)::int from public.catalog_products(:'orgContractor'::uuid)), (select count(*)::int from public.catalog_products(null)), 'the contractor persona and the contractor company workspace read the same single Contractor audience');

-- Retargeting changes access immediately, per audience.
set local request.jwt.claims = :'delta';
select lives_ok(format($q$select public.product_audiences_set(%L, array['showroom_dealer','engineer','end_consumer','contractor','installer_technician'])$q$, (select id from _p where name = 'ps')), 'owner widens the audience');
set local request.jwt.claims = :'consumer';
select is((select count(*)::int from public.catalog_products(null) where id = (select id from _p where name = 'ps')), 1, 'end customer now reads it');
set local request.jwt.claims = :'installer';
select is((select count(*)::int from public.catalog_products(null) where id = (select id from _p where name = 'ps')), 1, 'craftsman now reads it');
set local request.jwt.claims = :'contractor';
select is((select count(*)::int from public.catalog_products(null) where id = (select id from _p where name = 'ps')), 1, 'contractor persona (no workspace) now reads it');

-- F. Direct product references: saved products and RFQ items ---------------------------
set local request.jwt.claims = :'hana';
select lives_ok(format('select public.save_product(%L, %L)', :'orgC', (select id from _p where name = 'ps')), 'a targeted workspace can save the product');
select throws_ok(format('select public.save_product(%L, %L)', :'orgC', (select id from _p where name = 'pm')), 'P0002', null, 'a non-targeted product cannot be saved by direct id');
select throws_ok(format('select public.save_product(%L, %L)', :'orgC', (select id from _p where name = 'pd')), 'P0002', null, 'a draft cannot be saved by direct id');
select is((select count(*)::int from public.saved_products_for(:'orgC'::uuid) where product_id = (select id from _p where name = 'ps')), 1, 'the shortlist reader returns the saved, targeted product');
create temp table _r (name text primary key, id uuid);
grant all on _r to authenticated;
insert into _r select 'hana', public.create_rfq(:'orgC'::uuid, :'orgS'::uuid, 'Audience RFQ Hana');
select lives_ok(format('select public.add_rfq_item(%L, %L, 1)', (select id from _r where name = 'hana'), (select id from _p where name = 'ps')), 'a targeted requester can reference the product in an RFQ');
select throws_ok(format('select public.add_rfq_item(%L, %L, 1)', (select id from _r where name = 'hana'), (select id from _p where name = 'pm')), '22023', null, 'a non-targeted product cannot be referenced in an RFQ');
set local request.jwt.claims = :'tarek';
insert into _r select 'tarek', public.create_rfq(:'orgM'::uuid, :'orgS'::uuid, 'Audience RFQ Tarek');
select throws_ok(format('select public.add_rfq_item(%L, %L, 1)', (select id from _r where name = 'tarek'), (select id from _p where name = 'ps')), '22023', null, 'a non-targeted requester cannot reference the product by direct id');
select throws_ok(format('select public.save_product(%L, %L)', :'orgM', (select id from _p where name = 'ps')), 'P0002', null, 'a non-targeted workspace cannot save it either');
reset role;
select is(app.rfq_item_category((select id from public.rfq_items where rfq_id = (select id from _r where name = 'hana') limit 1))::text, 'other',
  'spend-by-category still resolves the category of a buyer''s own RFQ line');
set local role authenticated;

-- G. Images: signing needs a per-workspace grant ---------------------------------------
reset role;
create temp table _k as
  select format('%s/%s/%s.png', :'orgS', (select id from _p where name = 'ps'), extensions.gen_random_uuid()) as key;
grant select on _k to authenticated;
insert into public.product_images (product_id, organization_id, object_key, content_type, slot, state, created_by)
select (select id from _p where name = 'ps'), :'orgS'::uuid, key, 'image/png', 1, 'ready', '70000005-0000-4000-8000-000000000005' from _k;
set local role authenticated;
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.product_images where object_key = (select key from _k)), 0, 'the image row is not readable across tenants');
select is((select count(*)::int from public.catalog_product_images(:'orgC'::uuid, array[(select id from _p where name = 'ps')])), 1, 'a targeted workspace lists the ready image through the reader');
select is((select count(*)::int from public.catalog_product_images(:'orgC'::uuid, array[(select id from _p where name = 'pm')])), 0, 'but not the images of a non-targeted product');
select ok(not app.has_product_image_grant((select key from _k)), 'before a grant, the image cannot be signed');
select is(public.product_image_access_grant(:'orgC'::uuid, array[(select key from _k)]), array[(select key from _k)], 'a targeted workspace is granted signing');
select ok(app.has_product_image_grant((select key from _k)), 'and the storage predicate now allows it');
select is(public.product_image_access_grant(:'orgM'::uuid, array[(select key from _k)]), '{}'::text[], 'switching to a non-targeted workspace grants nothing');
select ok(not app.has_product_image_grant((select key from _k)), 'and drops the previous workspace''s signing permission');
select throws_ok('select count(*) from public.product_image_grants', '42501', null, 'the grant table is not readable by clients');
set local request.jwt.claims = :'tarek';
select is(public.product_image_access_grant(:'orgM'::uuid, array[(select key from _k)]), '{}'::text[], 'a non-targeted workspace cannot obtain a signing grant');
select ok(not app.has_product_image_grant((select key from _k)), 'and cannot sign');
set local request.jwt.claims = :'hana';
select is(public.product_image_access_grant(:'orgC'::uuid, array[(select key from _k)]), array[(select key from _k)], 'back to the targeted workspace: granted again');
-- A grant is only a marker: eligibility is re-derived on every use.
set local request.jwt.claims = :'delta';
select lives_ok(format($q$select public.product_audiences_set(%L, array['engineer'])$q$, (select id from _p where name = 'ps')), 'owner retargets the product away from showrooms');
set local request.jwt.claims = :'hana';
select ok(not app.has_product_image_grant((select key from _k)), 'an unexpired grant stops working the moment its workspace is no longer targeted');
set local request.jwt.claims = :'delta';
select lives_ok(format($q$select public.product_audiences_set(%L, array['showroom_dealer','engineer'])$q$, (select id from _p where name = 'ps')), 'owner targets showrooms again');
set local request.jwt.claims = :'hana';
select ok(app.has_product_image_grant((select key from _k)), 'and the same grant works again while the workspace is targeted');
set local request.jwt.claims = :'sara';
select is(public.product_image_access_grant(:'orgC'::uuid, array[(select key from _k)]), array[(select key from _k)], 'a Sales Team member is granted through the showroom workspace');
select ok(app.has_product_image_grant((select key from _k)), 'and can sign');
reset role;
update public.memberships set status = 'suspended' where user_id = '70000002-0000-4000-8000-000000000002' and organization_id = :'orgC';
set local role authenticated;
set local request.jwt.claims = :'sara';
select ok(not app.has_product_image_grant((select key from _k)), 'suspending the membership ends signing immediately, before the grant expires');
reset role;
update public.memberships set status = 'active' where user_id = '70000002-0000-4000-8000-000000000002' and organization_id = :'orgC';
set local role authenticated;

set local request.jwt.claims = :'delta';
select lives_ok(format('select public.set_product_published(%L, false, %L)', (select id from _p where name = 'ps'),
  (select version from public.products where id = (select id from _p where name = 'ps'))), 'owner unpublishes');
set local request.jwt.claims = :'hana';
select ok(not app.has_product_image_grant((select key from _k)), 'unpublishing revokes signing at once');
select is((select count(*)::int from public.catalog_products(:'orgC'::uuid) where id = (select id from _p where name = 'ps')), 0, 'and the product leaves every reader');
select is((select count(*)::int from public.saved_products_for(:'orgC'::uuid) where product_id = (select id from _p where name = 'ps')), 0, 'and the shortlist');

-- H. Anonymous callers and audit ---------------------------------------------------------
reset role;
set local role anon;
select throws_ok('select * from public.catalog_products(null)', '42501', null, 'anon cannot call the catalog reader');
reset role;
select cmp_ok((select count(*)::int from public.audit_log where action = 'product.audiences_set'), '>=', 4, 'every audience change is audited');
select is((select count(*)::int from public.audit_log where action = 'product.audiences_set' and metadata::text ~* 'price'), 0, 'audit metadata carries no price');

select * from finish();
rollback;
