-- pgTAP: Product Offers (20261012090001).
--
-- Claims under test:
--   * OWNER   — a catalog.write member of the owning organization creates / edits /
--               publishes / pauses / resumes / archives; nobody else can.
--   * PACKAGE — one positive total price (numeric, 2 decimals), quantity per product
--               (integer >= 1), no duplicate product, owner's own non-archived products,
--               canonical audiences only, end after start.
--   * VISIBILITY — ONE rule: published, inside [starts_at, ends_at), audience match,
--               every product still published, not the viewer's own offer. Drafts,
--               paused, scheduled (future) and expired offers are hidden.
--   * PRIVACY — the owner's base price (product_prices) never appears in what an
--               audience reads, and stays unreadable cross-tenant.
--
-- Fixtures (seed-pilot):
--   Hana   (70000001…001) showroom_dealer  Cairo Ceramics (orgC), org.manage
--   Sara   (70000002…002) sales-only member of Cairo Ceramics (no catalog.write)
--   Tarek  (70000003…003) manufacturer     Egypt Marble Manufacturing (orgM)
--   Nile   (70000004…004) importer         Nile Import & Trade (orgI)
--   Delta  (70000005…005) supplier         Delta Wholesale Supply (orgS)
--   Horizon(70000006…006) contractor_company Horizon Contracting (orgH) — not feed-ready

create extension if not exists pgtap;

begin;
select plan(96);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'
\set orgI '9e000000-eeee-4eee-8eee-000000000003'
\set orgS '9f000000-ffff-4fff-8fff-000000000004'
\set orgH '9a000000-aaaa-4aaa-8aaa-000000000005'
\set hana  '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sara  '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set tarek '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set nile  '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}'
\set delta '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set horizon '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}'

-- A. Reference data and structure (superuser view).
select is((select array_agg(code order by sort_order) from public.offer_audience_types where feed_ready),
  array['showroom_dealer','supplier','manufacturer','importer','design_office'],
  'the feed-ready audiences are the five business types the showroom suite serves');
select ok((select bool_and(a.code in (select unnest(enum_range(null::public.organization_type)::text[]) union select unnest(enum_range(null::public.persona_type)::text[])))
             from public.offer_audience_types a),
  'every audience code is a canonical organization_type or persona_type value (no labels)');
select ok((select count(*) = 0 from information_schema.columns
            where table_name in ('product_offers', 'product_offer_items') and column_name in ('discount_percent', 'compare_at_price', 'original_price', 'base_price', 'offer_price')),
  'no per-product / discount / compare-at / original price columns exist');
select ok((select relrowsecurity from pg_class where oid = 'public.product_offers'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.product_offer_items'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.product_offer_audiences'::regclass),
  'RLS is enabled on all three offer tables');

set local role authenticated;
set local request.jwt.claims = :'hana';
create temp table _o (name text primary key, id uuid, version int);
grant all on _o to authenticated, anon;

-- Products: three published (with private prices), one draft, one to archive.
insert into _o (name, id) select 'p1', public.own_product_create(:'orgC'::uuid, 'Wallpaper roll', 'OFF-1', 'wallpaper', 'roll', '[{"name":"Sand","hex":"#D8C7A6"}]'::jsonb, 1.2, '10 m', 'Brand', 'd', 159.99);
insert into _o (name, id) select 'p2', public.own_product_create(:'orgC'::uuid, 'Wood alternative', 'OFF-2', 'wood_alternative', 'meter', '[]'::jsonb, null, null, null, null, 220.5);
insert into _o (name, id) select 'p3', public.own_product_create(:'orgC'::uuid, 'Cornice', 'OFF-3', 'cornices', 'meter', '[]'::jsonb, null, null, null, null, 75);
insert into _o (name, id) select 'pd', public.own_product_create(:'orgC'::uuid, 'Draft product', 'OFF-D', 'paints', 'pail');
insert into _o (name, id) select 'pa', public.own_product_create(:'orgC'::uuid, 'To archive', 'OFF-A', 'paints', 'pail');
select lives_ok(format('select public.set_product_published(%L, true, 1)', (select id from _o where name = 'p1')), 'p1 published');
select lives_ok(format('select public.set_product_published(%L, true, 1)', (select id from _o where name = 'p2')), 'p2 published');
select lives_ok(format('select public.set_product_published(%L, true, 1)', (select id from _o where name = 'p3')), 'p3 published');
select lives_ok(format('select public.set_product_published(%L, true, 1)', (select id from _o where name = 'pa')), 'pa published');

-- B. Create (validation).
\set items '[{"product_id":"%s","quantity":2},{"product_id":"%s","quantity":1},{"product_id":"%s","quantity":3}]'
select lives_ok(format($f$select public.own_offer_save(%L, null, null, 'Interior finishing package', 'Limited package', 4500, 5800, now() - interval '1 day', now() + interval '1 day', %L::jsonb, array['importer','supplier'])$f$,
  :'orgC', format(:'items', (select id from _o where name = 'p1'), (select id from _o where name = 'p2'), (select id from _o where name = 'p3'))),
  'the owner creates a 3-product package offer with ONE total price');
insert into _o (name, id, version) select 'o1', id, version from public.product_offers where organization_id = :'orgC'::uuid;
select is((select status::text from public.product_offers where id = (select id from _o where name = 'o1')), 'draft', 'a new offer is a draft');
select is((select total_price from public.product_offers where id = (select id from _o where name = 'o1')), 4500.00::numeric, 'the package price is stored exactly');
select is((select array_agg(quantity order by position) from public.product_offer_items where offer_id = (select id from _o where name = 'o1')), array[2,1,3], 'a quantity is stored per product, in order');
select is((select array_agg(audience order by audience) from public.product_offer_audiences where offer_id = (select id from _o where name = 'o1')), array['importer','supplier'], 'canonical audience codes are stored');
select is((select title || '|' || reference_price from public.product_offers where id = (select id from _o where name = 'o1')), 'Interior finishing package|5800.00', 'title and the optional offer-level price before the offer are stored');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Bad ref', null, 4500, 4500, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'the price before the offer must be greater than the offer price');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'X', null, 4500, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a one-character offer name is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Long text', %L, 4500, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', repeat('x', 501), '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a description over 500 characters is refused');

select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 0, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a zero price is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, -5, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a negative price is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10.123, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a price with 3 decimals is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 100000001, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'an absurd price is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now(), %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'end must be after start');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', '[]'::jsonb, array['importer'])$f$, :'orgC'), '22023', null, 'an offer needs at least one product');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":0}]'), '22023', null, 'quantity 0 is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1.5}]'), '22023', null, 'a fractional quantity is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":"2"}]'), '22023', null, 'a non-numeric quantity is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1},{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":2}]'), '22023', null, 'the same product twice is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer','importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a duplicate audience is refused');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['مورد'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a translated label is not an audience');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array[]::text[])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'an offer needs at least one audience');

-- Archived and foreign products are refused.
select lives_ok(format('select public.own_product_set_archived(%L, true, %L)', (select id from _o where name = 'pa'), (select version from public.products where id = (select id from _o where name = 'pa'))), 'archive pa');
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'pa') || '","quantity":1}]'), '22023', null, 'an archived product cannot be added to an offer');
set local request.jwt.claims = :'tarek';
insert into _o (name, id) select 'm1', public.own_product_create(:'orgM'::uuid, 'Marble tile', 'MRB-1', 'marble_alternative', 'meter');
set local request.jwt.claims = :'hana';
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'm1') || '","quantity":1}]'), '22023', null, 'another organization''s product cannot be added');

-- C. Authority.
set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '42501', null, 'a member without catalog.write cannot create an offer');
set local request.jwt.claims = :'tarek';
select throws_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '42501', null, 'a non-member cannot create an offer for another organization');
select throws_ok(format($f$select public.own_offer_save(%L, %L, 1, 'Offer', null, 10, null, now(), now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgM', (select id from _o where name = 'o1'), '[{"product_id":"' || (select id from _o where name = 'm1') || '","quantity":1}]'), 'P0002', null, 'another organization cannot edit the owner''s offer even by naming its own org');
select throws_ok(format('select public.own_offer_set_status(%L, %L, 1)', (select id from _o where name = 'o1'), 'publish'), '42501', null, 'another organization cannot publish the offer');
select is((select count(*)::int from public.product_offers), 0, 'another organization cannot read the owner''s draft offer');
select is((select count(*)::int from public.product_offer_items), 0, 'nor its items');
select throws_ok($$insert into public.product_offers (organization_id, total_price, starts_at, ends_at, created_by) values ('9d000000-dddd-4ddd-8ddd-000000000002', 5, now(), now() + interval '1 day', '70000003-0000-4000-8000-000000000003')$$, '42501', null, 'offers cannot be written directly (RPC-only)');
set local role anon;
select throws_ok(format('select public.own_offer_save(%L, null, null, ''Offer'', null, 10, null, now(), now() + interval %L, %L::jsonb, array[%L])', :'orgC', '1 day', '[]', 'importer'), '42501', null, 'anonymous callers cannot create offers');
select throws_ok('select public.offers_feed(null)', '42501', null, 'anonymous callers cannot read the feed');
set local role authenticated;

-- D. A draft is invisible to every audience.
set local request.jwt.claims = :'nile';
select is(public.offers_feed(:'orgI'::uuid), '[]'::jsonb, 'a draft offer is not in a targeted account''s feed');
select is(public.offer_detail((select id from _o where name = 'o1'), :'orgI'::uuid), null, 'a draft offer has no detail for an audience');

-- E. Publishing rules.
set local request.jwt.claims = :'sara';
select throws_ok(format('select public.own_offer_set_status(%L, %L, 1)', (select id from _o where name = 'o1'), 'publish'), '42501', null, 'publishing needs catalog.publish');
set local request.jwt.claims = :'hana';
select throws_ok(format('select public.own_offer_set_status(%L, %L, 99)', (select id from _o where name = 'o1'), 'publish'), '40001', null, 'a stale version is refused');
-- an audience with no feed yet
select lives_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 100, null, now() - interval '1 day', now() + interval '1 day', %L::jsonb, array['wholesaler'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), 'a draft may name an audience that has no feed yet');
insert into _o (name, id, version) select 'o2', id, version from public.product_offers where organization_id = :'orgC'::uuid and id <> (select id from _o where name = 'o1');
select throws_ok(format('select public.own_offer_set_status(%L, %L, %L)', (select id from _o where name = 'o2'), 'publish', (select version from _o where name = 'o2')), '22023', null, 'publishing to an audience that cannot receive offers yet is refused');
-- an unpublished product
select lives_ok(format($f$select public.own_offer_save(%L, null, null, 'Offer', null, 100, null, now() - interval '1 day', now() + interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', '[{"product_id":"' || (select id from _o where name = 'pd') || '","quantity":1}]'), 'a draft offer may hold a not-yet-published product');
insert into _o (name, id, version) select 'o3', id, version from public.product_offers where organization_id = :'orgC'::uuid and id not in (select id from _o where id is not null);
select throws_ok(format('select public.own_offer_set_status(%L, %L, %L)', (select id from _o where name = 'o3'), 'publish', (select version from _o where name = 'o3')), '22023', null, 'publishing a package with an unpublished product is refused');
-- an offer that already ended
select lives_ok(format($f$select public.own_offer_save(%L, %L, %L, 'Offer', null, 4500, null, now() - interval '2 day', now() - interval '1 day', %L::jsonb, array['importer'])$f$, :'orgC', (select id from _o where name = 'o3'), (select version from _o where name = 'o3'), '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), 'a draft can be edited (dates in the past)');
select throws_ok(format('select public.own_offer_set_status(%L, %L, 2)', (select id from _o where name = 'o3'), 'publish'), '22023', null, 'publishing an offer that has already ended is refused');
select throws_ok(format('select public.own_offer_set_status(%L, %L, 1)', (select id from _o where name = 'o1'), 'resume'), '22023', null, 'only a paused offer can be resumed');

-- F. Publish o1 and check who sees it.
select is(public.own_offer_set_status((select id from _o where name = 'o1'), 'publish', 1), 2, 'the owner publishes (version advances)');
select is((select phase from public.own_product_offers where id = (select id from _o where name = 'o1')), 'active', 'inside its window a published offer is active');
set local request.jwt.claims = :'nile';
select is(jsonb_array_length(public.offers_feed(:'orgI'::uuid)), 1, 'a targeted importer sees the active offer');
select is((public.offers_feed(:'orgI'::uuid) -> 0 ->> 'total_price')::numeric, 4500::numeric, 'the package price is visible to the audience');
select is((select array_agg((e ->> 'quantity')::int order by e ->> 'code') from jsonb_array_elements(public.offers_feed(:'orgI'::uuid) -> 0 -> 'items') e), array[2,1,3], 'products and quantities are exposed');
select is((public.offers_feed(:'orgI'::uuid) -> 0 -> 'items' -> 0 -> 'color_items' -> 0 ->> 'hex'), '#D8C7A6', 'public structured colors are included');
select ok(position('159.99' in public.offers_feed(:'orgI'::uuid)::text) = 0 and position('220.5' in public.offers_feed(:'orgI'::uuid)::text) = 0 and position('base_price' in public.offers_feed(:'orgI'::uuid)::text) = 0,
  'the owner''s private base prices never appear in what the audience reads');
select is((public.offers_feed(:'orgI'::uuid) -> 0 ->> 'title') || '|' || (public.offers_feed(:'orgI'::uuid) -> 0 ->> 'reference_price') || '|' || (public.offers_feed(:'orgI'::uuid) -> 0 -> 'seller' ->> 'org_type'), 'Interior finishing package|5800.00|showroom_dealer', 'the feed carries the offer name, the offer-level price before the offer and the seller type');
select ok(not (public.offers_feed(:'orgI'::uuid) -> 0 ? 'discount_percent'), 'no discount percentage is exposed or computed');
select is(public.offer_detail((select id from _o where name = 'o1'), :'orgI'::uuid) ->> 'id', (select id::text from _o where name = 'o1'), 'the detail is available to the audience');
select is((select count(*)::int from public.product_prices), 0, 'product_prices stays unreadable to the audience');
select throws_ok(format('select public.offers_feed(%L)', :'orgC'), '42501', null, 'a viewer cannot ask for a workspace it does not belong to');
set local request.jwt.claims = :'delta';
select is(jsonb_array_length(public.offers_feed(:'orgS'::uuid)), 1, 'a targeted supplier sees it too');
set local request.jwt.claims = :'tarek';
select is(public.offers_feed(:'orgM'::uuid), '[]'::jsonb, 'a non-targeted manufacturer does not see it');
select is(public.offer_detail((select id from _o where name = 'o1'), :'orgM'::uuid), null, 'nor its detail');
set local request.jwt.claims = :'horizon';
select is(public.offers_feed(:'orgH'::uuid), '[]'::jsonb, 'a contractor company is not targeted');
set local request.jwt.claims = :'hana';
select is(public.offers_feed(:'orgC'::uuid), '[]'::jsonb, 'the owner''s own offers are not in its own feed');
select is((select count(*)::int from public.own_product_offer_links where product_id = (select id from _o where name = 'p1') and phase = 'active'), 1, 'My Products can read the real offer state of a product');

-- G. Pause / resume.
select throws_ok(format('select public.own_offer_save(%L, %L, 2, ''Offer'', null, 4500, null, now() - interval ''1 day'', now() + interval ''1 day'', %L::jsonb, array[''importer''])', :'orgC', (select id from _o where name = 'o1'), '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'a published offer cannot be edited until it is paused');
select is(public.own_offer_set_status((select id from _o where name = 'o1'), 'pause', 2), 3, 'the owner pauses');
set local request.jwt.claims = :'nile';
select is(public.offers_feed(:'orgI'::uuid), '[]'::jsonb, 'a paused offer disappears from the feed');
set local request.jwt.claims = :'hana';
select is(public.own_offer_set_status((select id from _o where name = 'o1'), 'resume', 3), 4, 'the owner resumes');
set local request.jwt.claims = :'nile';
select is(jsonb_array_length(public.offers_feed(:'orgI'::uuid)), 1, 'a resumed offer returns while still inside its window');

-- H. Time windows (the clock is the database's; rows are moved relative to it).
reset role;
update public.product_offers set starts_at = now() + interval '1 day', ends_at = now() + interval '2 days' where id = (select id from _o where name = 'o1');
set local role authenticated;
set local request.jwt.claims = :'nile';
select is(public.offers_feed(:'orgI'::uuid), '[]'::jsonb, 'a scheduled (future) offer is hidden before starts_at');
set local request.jwt.claims = :'hana';
select is((select phase from public.own_product_offers where id = (select id from _o where name = 'o1')), 'scheduled', 'the owner sees it as scheduled');
reset role;
update public.product_offers set starts_at = now() - interval '2 days', ends_at = now() - interval '1 second' where id = (select id from _o where name = 'o1');
set local role authenticated;
set local request.jwt.claims = :'nile';
select is(public.offers_feed(:'orgI'::uuid), '[]'::jsonb, 'an expired offer is hidden at ends_at');
set local request.jwt.claims = :'hana';
select is((select phase from public.own_product_offers where id = (select id from _o where name = 'o1')), 'expired', 'the owner sees it as expired (derived, not stored)');
reset role;
update public.product_offers set starts_at = now() - interval '1 day', ends_at = now() + interval '1 day' where id = (select id from _o where name = 'o1');
set local role authenticated;

-- H2. A scheduled (published, not yet started) offer can be edited; an archived one restored.
reset role;
update public.product_offers set starts_at = now() + interval '1 day', ends_at = now() + interval '2 days' where id = (select id from _o where name = 'o1');
set local role authenticated;
set local request.jwt.claims = :'hana';
select lives_ok(format($f$select public.own_offer_save(%L, %L, %L, 'Renamed package', null, 4400, null, now() + interval '1 day', now() + interval '2 days', %L::jsonb, array['importer'])$f$, :'orgC', (select id from _o where name = 'o1'), (select version from public.product_offers where id = (select id from _o where name = 'o1')), format(:'items', (select id from _o where name = 'p1'), (select id from _o where name = 'p2'), (select id from _o where name = 'p3'))), 'a scheduled offer can be edited');
select is((select status::text from public.product_offers where id = (select id from _o where name = 'o1')), 'published', 'and stays published');
reset role;
insert into public.membership_capabilities (membership_id, capability_key) values ('50000002-0000-4000-8000-000000000002', 'catalog.write');
set local role authenticated;
set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.own_offer_save(%L, %L, %L, 'Sneaky', null, 1, null, now() + interval '1 day', now() + interval '2 days', %L::jsonb, array['importer'])$f$, :'orgC', (select id from _o where name = 'o1'), (select version from public.product_offers where id = (select id from _o where name = 'o1')), format(:'items', (select id from _o where name = 'p1'), (select id from _o where name = 'p2'), (select id from _o where name = 'p3'))),
  '42501', null, 'catalog.write alone cannot change an already-published (scheduled) offer');
reset role;
delete from public.membership_capabilities where membership_id = '50000002-0000-4000-8000-000000000002' and capability_key = 'catalog.write';
set local role authenticated;
reset role;
update public.product_offers set starts_at = now() - interval '1 day', ends_at = now() + interval '1 day' where id = (select id from _o where name = 'o1');
set local role authenticated;
set local request.jwt.claims = :'hana';

-- I. A product that stops being valid hides the offer.
set local request.jwt.claims = :'hana';
select lives_ok(format('select public.set_product_published(%L, false, %L)', (select id from _o where name = 'p2'), (select version from public.products where id = (select id from _o where name = 'p2'))), 'unpublish a product that is inside a live offer');
set local request.jwt.claims = :'nile';
select is(public.offers_feed(:'orgI'::uuid), '[]'::jsonb, 'an offer with an invalid product is not exposed');
set local request.jwt.claims = :'hana';
select is((select invalid_item_count from public.own_product_offers where id = (select id from _o where name = 'o1')), 1, 'the owner is told how many products need attention');
select lives_ok(format('select public.set_product_published(%L, true, %L)', (select id from _o where name = 'p2'), (select version from public.products where id = (select id from _o where name = 'p2'))), 'republish the product');
set local request.jwt.claims = :'nile';
select is(jsonb_array_length(public.offers_feed(:'orgI'::uuid)), 1, 'the offer is visible again once every product is valid');

-- J. Archive and the audit trail.
set local request.jwt.claims = :'hana';
select throws_ok(format('select public.own_offer_set_status(%L, %L, %L)', (select id from _o where name = 'o1'), 'archive', (select version from public.product_offers where id = (select id from _o where name = 'o1'))), '22023', null, 'an active offer must be paused before archiving');
select lives_ok(format('select public.own_offer_set_status(%L, %L, %L)', (select id from _o where name = 'o1'), 'pause', (select version from public.product_offers where id = (select id from _o where name = 'o1'))), 'pause');
select lives_ok(format('select public.own_offer_set_status(%L, %L, %L)', (select id from _o where name = 'o1'), 'archive', (select version from public.product_offers where id = (select id from _o where name = 'o1'))), 'a paused offer can be archived');
select is((select phase from public.own_product_offers where id = (select id from _o where name = 'o1')), 'archived', 'archived is a historical state, the row is kept');
select throws_ok(format('select public.own_offer_save(%L, %L, %L, ''Offer'', null, 4500, null, now(), now() + interval ''1 day'', %L::jsonb, array[''importer''])', :'orgC', (select id from _o where name = 'o1'), (select version from public.product_offers where id = (select id from _o where name = 'o1')), '[{"product_id":"' || (select id from _o where name = 'p1') || '","quantity":1}]'), '22023', null, 'an archived offer cannot be edited');
select lives_ok(format('select public.own_offer_set_status(%L, %L, %L)', (select id from _o where name = 'o1'), 'restore', (select version from public.product_offers where id = (select id from _o where name = 'o1'))), 'an archived offer can be restored to a draft');
select is((select phase from public.own_product_offers where id = (select id from _o where name = 'o1')), 'draft', 'a restored offer is a draft again and is hidden');
reset role;
select ok((select count(*) >= 5 from public.audit_log where subject_type = 'product_offer' and action in ('offer.created', 'offer.published', 'offer.paused', 'offer.resumed', 'offer.archived')), 'offer lifecycle events are audited');

select * from finish();
rollback;
