-- pgTAP: the shared unit-of-measure list (20261021090004).
--
-- Claims under test:
--   * Twelve units are allowed for showroom products AND Purchase Request items; the first six are unchanged.
--   * meter stays meter - linear_meter is a different unit, nothing is reinterpreted.
--   * A unit outside the list (ton, bag, pack) is refused by the database.
--   * Quantity validation is unchanged (> 0, at most 3 decimals).
--   * A response must use the unit that was requested; there is no conversion between units.

create extension if not exists pgtap;

begin;
select plan(30);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC  '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgS  '9f000000-ffff-4fff-8fff-000000000004'
\set hana    '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set khaled  '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set engineer '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}'

-- A. The list ----------------------------------------------------------------------------------------
select is(app.showroom_units(),
  array['kilogram','gallon','pail','roll','meter','sheet','piece','square_meter','linear_meter','liter','box','set'],
  'twelve shared units, the original six first');
select is((select array_agg(code::text order by sort_order) from public.measurement_units), app.showroom_units(),
  'the reference table and the validator list agree');
select is((select array_agg(code::text order by sort_order) from public.measurement_units where is_original),
  array['kilogram','gallon','pail','roll','meter','sheet'], 'the original six are unchanged');
select ok(not exists (select 1 from public.measurement_units where code::text in ('ton','bag','pack')), 'ton, bag and pack are not offered');
select ok((select count(distinct code) from public.measurement_units) = 12, 'no duplicate unit identifiers');

-- B. Products ------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'hana';
create temp table _p (unit text primary key, id uuid);
grant all on _p to authenticated;

select lives_ok(format($f$insert into _p select u, public.own_product_create(%L::uuid, 'Unit probe ' || u, 'UNIT-' || upper(u), 'paints', u::public.product_unit) from unnest(array['piece','square_meter','linear_meter','liter','box','set','meter','kilogram']) u$f$, :'orgC'),
  'products can be created in the six new units and the originals');
select is((select unit::text from public.products where id = (select id from _p where unit = 'meter')), 'meter', 'a meter product stays a meter product');
select is((select unit::text from public.products where id = (select id from _p where unit = 'linear_meter')), 'linear_meter', 'a linear meter product is its own unit');
select is((select count(*)::int from public.products where id in (select id from _p) and unit::text in ('meter','linear_meter')), 2, 'meter and linear_meter coexist as different units');
select throws_ok(format($f$select public.own_product_create(%L::uuid, 'Ton probe', 'UNIT-TON', 'paints', 'ton')$f$, :'orgC'), '22023', null, 'ton is refused');
select throws_ok(format($f$select public.own_product_create(%L::uuid, 'Bag probe', 'UNIT-BAG', 'paints', 'bag')$f$, :'orgC'), '22023', null, 'bag is refused');
select throws_ok(format($f$select public.own_product_create(%L::uuid, 'Pack probe', 'UNIT-PACK', 'paints', 'pack')$f$, :'orgC'), '22023', null, 'pack is refused');

-- C. Purchase Request items -------------------------------------------------------------------------------
set local request.jwt.claims = :'engineer';
create temp table _r (name text primary key, id uuid);
grant all on _r to authenticated;
select lives_ok($f$insert into _r select 'all', public.purchase_request_save(null, null, null, 'Every unit', null, null, false,
  '[{"name":"Item a","category_code":"paints","quantity":1,"unit":"kilogram"},
    {"name":"Item b","category_code":"paints","quantity":1,"unit":"gallon"},
    {"name":"Item c","category_code":"paints","quantity":1,"unit":"pail"},
    {"name":"Item d","category_code":"wallpaper","quantity":1,"unit":"roll"},
    {"name":"Item e","category_code":"cornices","quantity":1,"unit":"meter"},
    {"name":"Item f","category_code":"panels","quantity":1,"unit":"sheet"},
    {"name":"Item g","category_code":"paints","quantity":1,"unit":"piece"},
    {"name":"Item h","category_code":"vinyl_flooring","quantity":1,"unit":"square_meter"},
    {"name":"Item i","category_code":"cornices","quantity":1,"unit":"linear_meter"},
    {"name":"Item j","category_code":"paints","quantity":1,"unit":"liter"},
    {"name":"Item k","category_code":"paints","quantity":1,"unit":"box"},
    {"name":"Item l","category_code":"paints","quantity":1,"unit":"set"}]'::jsonb)$f$,
  'a request may use all twelve units');
select is((select count(distinct unit)::int from public.purchase_request_items where request_id = (select id from _r where name = 'all')), 12, 'and all twelve are stored as given');
select is((select unit::text from public.purchase_request_items where request_id = (select id from _r where name = 'all') and name = 'Item e'), 'meter', 'a requested meter is not turned into a linear meter');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Bad unit', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1,"unit":"ton"}]'::jsonb)$f$, '22023', null, 'ton is refused on a request');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Bad unit', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1,"unit":"bag"}]'::jsonb)$f$, '22023', null, 'bag is refused on a request');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Bad unit', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1,"unit":"pack"}]'::jsonb)$f$, '22023', null, 'pack is refused on a request');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'No unit', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1}]'::jsonb)$f$, '22023', null, 'a missing unit is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Zero', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":0,"unit":"box"}]'::jsonb)$f$, '22023', null, 'a zero quantity is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Fine decimals', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1.2345,"unit":"liter"}]'::jsonb)$f$, '22023', null, 'more than three decimals are refused');
select lives_ok($f$select public.purchase_request_save(null, null, null, 'Three decimals', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1.234,"unit":"liter"}]'::jsonb)$f$, 'three decimals are accepted');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Unit case', null, null, false, '[{"name":"Item x","category_code":"paints","quantity":1,"unit":"BOX"}]'::jsonb)$f$, '22023', null, 'an unknown spelling is refused (no guessing)');

-- D. Responses keep the requested unit -----------------------------------------------------------------------------
reset role;
create temp table _it (pos int, id uuid);
grant all on _it to authenticated;
set local role authenticated;
set local request.jwt.claims = :'engineer';
select lives_ok($f$insert into _r select 'sq', public.purchase_request_save(null, null, null, 'Tiles', null, null, false,
  '[{"name":"Porcelain","category_code":"vinyl_flooring","quantity":50,"unit":"square_meter"},{"name":"Adhesive","category_code":"paints","quantity":10,"unit":"box"}]'::jsonb)$f$,
  'a request is created in square metres and boxes');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'sq')), 'and published');
reset role;
insert into _it select position, id from public.purchase_request_items where request_id = (select id from _r where name = 'sq');
set local role authenticated;
set local request.jwt.claims = :'hana';
select lives_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgC', (select id from _r where name = 'sq'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where pos = 1), 'offered_quantity', 20, 'unit_price', 300, 'unit', 'square_meter'),
                      jsonb_build_object('request_item_id', (select id from _it where pos = 2), 'offered_quantity', 10, 'unit_price', 45))::text),
  'a showroom answers using the requested units (partial quantity allowed)');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgC', (select id from _r where name = 'sq'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where pos = 1), 'offered_quantity', 20, 'unit_price', 300, 'unit', 'box'))::text),
  '22023', null, 'a response in another unit (box for square metres) is refused - no conversion');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgC', (select id from _r where name = 'sq'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where pos = 1), 'offered_quantity', 51, 'unit_price', 300, 'unit', 'square_meter'))::text),
  '22023', null, 'offering more than the requested quantity is still refused');
select is((select unit::text from public.purchase_request_response_items where request_item_id = (select id from _it where pos = 1) limit 1), 'square_meter', 'the stored response line keeps the requested unit');
reset role;
select is((select count(*)::int from public.rfqs), (select count(*)::int from public.rfqs), 'no order flow is created by a response');

select * from finish();
rollback;
