-- pgTAP: shared Purchase Requests (20261015090020).
--
-- Claims under test:
--   * OWNERSHIP: an individual (no organization) or an organization through an active
--     workspace; no fake organization; the requester always manages their own request; the
--     "requester organization is live" rule applies only to organization requests.
--   * ITEMS: required name / canonical category / quantity / unit, optional code / colours /
--     specs (<= 250 characters), up to 2 images, no catalog product required or created.
--   * VISIBILITY MATRIX, workspace-based and exact-only (Sales Team inherits its workspace):
--       craftsman / contractor / engineer / personal -> showrooms
--       showroom -> suppliers, manufacturers, importers (+ showrooms with the share option)
--       supplier -> suppliers; manufacturer -> manufacturers; importer -> importers
--     a requester never discovers or answers their own request; direct table reads fail.
--   * RESPONSES (Option A): independent, non-binding, FULL or PARTIAL, server-validated
--     quantity / unit / money; the responder sees only its own, the requester sees all;
--     shortlisting creates no order and does not close the request.
--   * ATTACHMENTS: reference images are signed only through a per-workspace grant that is
--     re-validated on every use.

create extension if not exists pgtap;

begin;
-- The seed keeps Egypt Marble and Nile Import PENDING on purpose (the Admin review queue). A
-- pending organization is non-operational (20261015090028), so a suite that needs them to act
-- as established businesses approves them here, inside its own transaction.
update public.organizations set status = 'active', is_verified = true
 where id in ('9d000000-dddd-4ddd-8ddd-000000000002', '9e000000-eeee-4eee-8eee-000000000003');
select plan(188);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC  '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgC2 '91000005-1111-4111-8111-000000000005'
\set orgM  '9d000000-dddd-4ddd-8ddd-000000000002'
\set orgM2 '91000001-1111-4111-8111-000000000001'
\set orgS  '9f000000-ffff-4fff-8fff-000000000004'
\set orgS2 '91000002-1111-4111-8111-000000000002'
\set orgI  '9e000000-eeee-4eee-8eee-000000000003'
\set orgI2 '91000003-1111-4111-8111-000000000003'
\set orgD  '91000004-1111-4111-8111-000000000004'
\set orgK  '9a000000-aaaa-4aaa-8aaa-000000000005'
\set hana    '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set youssef '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set tarek   '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set sara    '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}'
\set khaled  '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set mostafa '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}'
\set engineer '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}'
\set mfr2    '{"sub":"71000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sup2    '{"sub":"71000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set imp2    '{"sub":"71000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set design  '{"sub":"71000004-0000-4000-8000-000000000004","role":"authenticated"}'
\set show2   '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set craft   '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}'
\set consumer '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}'
\set legacy  '{"sub":"71000010-0000-4000-8000-000000000010","role":"authenticated"}'

\set items2 '[{"name":"Wallpaper roll","code":"WP-1","category_code":"wallpaper","quantity":10,"unit":"roll","specs":"Matt finish","color_items":[{"name":"Sand","hex":"#D8C7A6"}]},{"name":"Paint pail","category_code":"paints","quantity":4,"unit":"pail"}]'
\set item1 '[{"name":"Cornice","category_code":"cornices","quantity":20,"unit":"meter"}]'

-- the personas under test must hold the account type the test claims
update public.users set primary_account_type = 'end_consumer' where id = '71000007-0000-4000-8000-000000000007';
-- a Sales Team member can act for the showroom only with the rfq capabilities
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, c from public.memberships m, unnest(array['rfq.create', 'rfq.respond']) c
 where m.user_id = '70000002-0000-4000-8000-000000000002' and m.organization_id = :'orgC'
on conflict do nothing;

create temp table _r (name text primary key, id uuid);
create temp table _it (req text, pos int, id uuid);
create temp table _k (name text primary key, key text);
create temp table _cnt (name text primary key, n bigint);
grant all on _r, _it, _k, _cnt to authenticated, anon;

-- A. Structure ---------------------------------------------------------------------------
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
    'public.purchase_requests'::regclass, 'public.purchase_request_items'::regclass, 'public.purchase_request_images'::regclass,
    'public.purchase_request_responses'::regclass, 'public.purchase_request_response_items'::regclass, 'public.request_image_grants'::regclass)),
  'RLS is enabled on every new table');
select ok(not has_table_privilege('authenticated', 'public.purchase_requests', 'insert')
      and not has_table_privilege('authenticated', 'public.purchase_request_responses', 'update')
      and not has_table_privilege('authenticated', 'public.purchase_request_items', 'delete')
      and not has_table_privilege('authenticated', 'public.request_image_grants', 'select'),
  'no client DML grant: every write is an RPC');
select ok(not has_function_privilege('anon', 'public.purchase_requests_discover(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.purchase_request_save(uuid,uuid,integer,text,text,date,boolean,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.purchase_request_response_save(uuid,uuid,text,date,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.purchase_requests_discover(uuid)', 'execute'),
  'readers and writers are not callable by anon');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name in ('purchase_requests', 'purchase_request_items') and column_name = 'product_id'), 0,
  'a request item needs no catalog product (none is referenced)');

-- B. Individual requester (engineer persona) ---------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'engineer';
select lives_ok(format($f$insert into _r select 'eng', public.purchase_request_save(null, null, null, 'Villa finishing package', 'Need all by month end', current_date + 30, false, %L::jsonb)$f$, :'items2'),
  'an engineer persona creates an individual request (no organization)');
select is((select requester_org_id from public.purchase_requests where id = (select id from _r where name = 'eng')), null, 'no organization is created or referenced');
select is((select requester_audience from public.purchase_requests where id = (select id from _r where name = 'eng')), 'engineer', 'the requester audience comes from the persona, never from the client');
select is((select count(*)::int from public.purchase_request_items where request_id = (select id from _r where name = 'eng')), 2, 'both items are saved');
select is((select count(*)::int from public.products where name in ('Wallpaper roll', 'Paint pail')), 0, 'no catalog product was created');

set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'eng')), 0, 'a DRAFT is not discoverable');

set local request.jwt.claims = :'engineer';
select throws_ok(format($f$select public.purchase_request_publish(%L, 99)$f$, (select id from _r where name = 'eng')), 'VC001', null, 'a stale version cannot publish');
select throws_ok(format($f$select public.purchase_request_save(null, %L, 99, 'Stale edit', null, null, false, %L::jsonb)$f$, (select id from _r where name = 'eng'), :'item1'),
  'VC001', null, 'a stale purchase_request_save is a version conflict (not the retryable 40001)');
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'x', null, null, false, %L::jsonb)$f$, :'item1'), '22023', null, 'a one-character title is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, '[{"name":"a","category_code":"paints","quantity":1,"unit":"pail"}]'::jsonb)$f$, '22023', null, 'a one-character item name is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, '[{"name":"Item","category_code":"nope","quantity":1,"unit":"pail"}]'::jsonb)$f$, '22023', null, 'an unknown category is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, '[{"name":"Item","quantity":1,"unit":"pail"}]'::jsonb)$f$, '22023', null, 'the category is required');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, '[{"name":"Item","category_code":"paints","quantity":1,"unit":"ton"}]'::jsonb)$f$, '22023', null, 'an unsupported unit is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, '[{"name":"Item","category_code":"paints","quantity":0,"unit":"pail"}]'::jsonb)$f$, '22023', null, 'a zero quantity is refused');
select throws_ok($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, '[{"name":"Item","category_code":"paints","quantity":1.2345,"unit":"pail"}]'::jsonb)$f$, '22023', null, 'more than three decimals is refused');
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'Valid title', null, null, false, %L::jsonb)$f$,
    jsonb_build_array(jsonb_build_object('name', 'Item', 'category_code', 'paints', 'quantity', 1, 'unit', 'pail', 'specs', repeat('x', 251)))::text),
  '22023', null, 'specs of 251 characters are refused');
select lives_ok(format($f$select public.purchase_request_save(null, null, null, 'Arabic specs', null, null, false, %L::jsonb)$f$,
    jsonb_build_array(jsonb_build_object('name', 'Item', 'category_code', 'paints', 'quantity', 1, 'unit', 'pail', 'specs', repeat('ك', 250)))::text),
  '250 Arabic characters of specs are accepted (characters, not bytes)');
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'Too many', null, null, false, %L::jsonb)$f$,
    (select jsonb_agg(jsonb_build_object('name', 'Item ' || g, 'category_code', 'paints', 'quantity', 1, 'unit', 'pail'))::text from generate_series(1, 31) g)),
  '22023', null, 'more than 30 items are refused');
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'Past date', null, current_date - 1, false, %L::jsonb)$f$, :'item1'), '22023', null, 'a past needed-by date is refused');
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'Shared', null, null, true, %L::jsonb)$f$, :'item1'), '22023', null, 'only a showroom can use the share-with-showrooms option');
select lives_ok($f$insert into _r select 'empty', public.purchase_request_save(null, null, null, 'Nothing yet', null, null, false, '[]'::jsonb)$f$, 'an empty draft can be saved');
select throws_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'empty')), '22023', null, 'an empty request cannot be published');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'eng')), 'the owner publishes the request');
select throws_ok(format($f$select public.purchase_request_save(null, %L, 2, 'Edited', null, null, false, %L::jsonb)$f$, (select id from _r where name = 'eng'), :'item1'),
  '22023', null, 'a published request is no longer editable');

-- Direct reads are owner-side only.
select is((select count(*)::int from public.purchase_requests where id = (select id from _r where name = 'eng')), 1, 'the individual requester reads their own request');
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests where id = (select id from _r where name = 'eng')), 0, 'another tenant cannot read the request table directly');
select is((select count(*)::int from public.purchase_request_items where request_id = (select id from _r where name = 'eng')), 0, 'nor its items');
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'eng')), 1, 'a showroom workspace discovers an engineer''s request');
select is((select requester_name from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'eng')), null, 'an individual requester''s identity is not exposed');

-- C. The matrix for personal requesters ---------------------------------------------------
set local request.jwt.claims = :'craft';
select lives_ok(format($f$insert into _r select 'craft', public.purchase_request_save(null, null, null, 'Craftsman needs', null, null, false, %L::jsonb)$f$, :'item1'), 'a craftsman creates an individual request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'craft')), 'and publishes it');
set local request.jwt.claims = :'consumer';
select lives_ok(format($f$insert into _r select 'consumer', public.purchase_request_save(null, null, null, 'Personal needs', null, null, false, %L::jsonb)$f$, :'item1'), 'a personal (end customer) account creates an individual request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'consumer')), 'and publishes it');
set local request.jwt.claims = :'mostafa';
select lives_ok(format($f$insert into _r select 'contractor', public.purchase_request_save(null, null, null, 'Contractor needs', null, null, false, %L::jsonb)$f$, :'item1'), 'a contractor persona creates an individual request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'contractor')), 'and publishes it');
select lives_ok(format($f$select public.purchase_request_save(%L, null, null, 'Company', null, null, false, %L::jsonb)$f$, :'orgK', :'item1'), 'a contractor company workspace acts as the Contractor account and can create a request');

set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id in (select id from _r where name in ('craft', 'consumer', 'contractor', 'eng'))), 4,
  'craftsman, personal, contractor and engineer requests are all visible to a showroom');
set local request.jwt.claims = :'khaled';
select is((select count(*)::int from public.purchase_requests_discover(:'orgS'::uuid) where id in (select id from _r where name in ('craft', 'consumer', 'contractor', 'eng'))), 0, 'but not to a supplier');
set local request.jwt.claims = :'tarek';
select is((select count(*)::int from public.purchase_requests_discover(:'orgM'::uuid) where id in (select id from _r where name in ('craft', 'consumer', 'contractor', 'eng'))), 0, 'nor to a manufacturer');
set local request.jwt.claims = :'sara';
select is((select count(*)::int from public.purchase_requests_discover(:'orgI'::uuid) where id in (select id from _r where name in ('craft', 'consumer', 'contractor', 'eng'))), 0, 'nor to an importer');
reset role;
update public.users set primary_account_type = null where id = '71000010-0000-4000-8000-000000000010';
set local role authenticated;
set local request.jwt.claims = :'legacy';
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'Legacy', null, null, false, %L::jsonb)$f$, :'item1'), '22023', null, 'a legacy persona with no supported account type cannot publish an individual request');
set local request.jwt.claims = :'youssef';
select throws_ok(format($f$select public.purchase_request_save(null, null, null, 'Sales', null, null, false, %L::jsonb)$f$, :'item1'), '22023', null, 'a Sales Team member must act through a workspace, never as an individual');

-- The author never discovers their own request, even through a showroom workspace.
reset role;
insert into public.memberships (user_id, organization_id, status, accepted_at) values ('70000010-0000-4000-8000-000000000010', :'orgC', 'active', now());
set local role authenticated;
set local request.jwt.claims = :'engineer';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'eng')), 0, 'the author is excluded from discovering their own request in any workspace');
select is((select count(*)::int from public.purchase_requests_discover(null)), 0, 'no workspace, no discovery');

-- D. Organization requesters ---------------------------------------------------------------
set local request.jwt.claims = :'hana';
select lives_ok(format($f$insert into _r select 'show', public.purchase_request_save(%L, null, null, 'Showroom stock request', null, null, false, %L::jsonb)$f$, :'orgC', :'items2'), 'a showroom creates a request through its workspace');
select is((select requester_audience from public.purchase_requests where id = (select id from _r where name = 'show')), 'showroom_dealer', 'the audience is the workspace''s');
select lives_ok(format($f$insert into _r select 'shows', public.purchase_request_save(%L, null, null, 'Showroom request shared', null, null, true, %L::jsonb)$f$, :'orgC', :'item1'), 'a showroom can opt to share with other showrooms');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'show')), 'publishes the first');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'shows')), 'publishes the shared one');
select throws_ok(format($f$select public.purchase_request_save(%L, null, null, 'Foreign org', null, null, false, %L::jsonb)$f$, :'orgS', :'item1'), '42501', null, 'a non-member cannot create a request for another organization');

set local request.jwt.claims = :'khaled';
select is((select count(*)::int from public.purchase_requests_discover(:'orgS'::uuid) where id in (select id from _r where name in ('show', 'shows'))), 2, 'a supplier workspace discovers showroom requests');
set local request.jwt.claims = :'tarek';
select is((select count(*)::int from public.purchase_requests_discover(:'orgM'::uuid) where id in (select id from _r where name in ('show', 'shows'))), 2, 'a manufacturer workspace too');
set local request.jwt.claims = :'sara';
select is((select count(*)::int from public.purchase_requests_discover(:'orgI'::uuid) where id in (select id from _r where name in ('show', 'shows'))), 2, 'an importer workspace too');
set local request.jwt.claims = :'show2';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC2'::uuid) where id = (select id from _r where name = 'show')), 0, 'another showroom does NOT see an unshared showroom request');
select is((select count(*)::int from public.purchase_requests_discover(:'orgC2'::uuid) where id = (select id from _r where name = 'shows')), 1, 'but sees it when the requester opted to share');
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id in (select id from _r where name in ('show', 'shows'))), 0, 'the requesting organization never discovers its own requests');
select throws_ok(format($f$select * from public.purchase_requests_discover(%L)$f$, :'orgM'), '42501', null, 'a workspace the caller does not belong to is refused');

-- Supplier / manufacturer / importer requesters see only their own kind.
set local request.jwt.claims = :'khaled';
select lives_ok(format($f$insert into _r select 'sup', public.purchase_request_save(%L, null, null, 'Supplier sourcing', null, null, false, %L::jsonb)$f$, :'orgS', :'item1'), 'a supplier creates a request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'sup')), 'and publishes');
select throws_ok(format($f$select public.purchase_request_save(%L, null, null, 'Bad share', null, null, true, %L::jsonb)$f$, :'orgS', :'item1'), '22023', null, 'a supplier cannot share with showrooms');
set local request.jwt.claims = :'tarek';
select lives_ok(format($f$insert into _r select 'mfr', public.purchase_request_save(%L, null, null, 'Manufacturer sourcing', null, null, false, %L::jsonb)$f$, :'orgM', :'item1'), 'a manufacturer creates a request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'mfr')), 'and publishes');
set local request.jwt.claims = :'sara';
select lives_ok(format($f$insert into _r select 'imp', public.purchase_request_save(%L, null, null, 'Importer sourcing', null, null, false, %L::jsonb)$f$, :'orgI', :'item1'), 'an importer creates a request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'imp')), 'and publishes');

set local request.jwt.claims = :'sup2';
select is((select count(*)::int from public.purchase_requests_discover(:'orgS2'::uuid) where id = (select id from _r where name = 'sup')), 1, 'another supplier sees a supplier request');
select is((select count(*)::int from public.purchase_requests_discover(:'orgS2'::uuid) where id in (select id from _r where name in ('mfr', 'imp'))), 0, 'but not manufacturer / importer requests');
set local request.jwt.claims = :'mfr2';
select is((select count(*)::int from public.purchase_requests_discover(:'orgM2'::uuid) where id = (select id from _r where name = 'mfr')), 1, 'another manufacturer sees a manufacturer request');
select is((select count(*)::int from public.purchase_requests_discover(:'orgM2'::uuid) where id in (select id from _r where name in ('sup', 'imp'))), 0, 'but not supplier / importer requests');
set local request.jwt.claims = :'imp2';
select is((select count(*)::int from public.purchase_requests_discover(:'orgI2'::uuid) where id = (select id from _r where name = 'imp')), 1, 'another importer sees an importer request');
select is((select count(*)::int from public.purchase_requests_discover(:'orgI2'::uuid) where id in (select id from _r where name in ('sup', 'mfr'))), 0, 'but not supplier / manufacturer requests');
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id in (select id from _r where name in ('sup', 'mfr', 'imp'))), 0, 'a showroom sees none of the supplier / manufacturer / importer requests');
set local request.jwt.claims = :'khaled';
select is((select count(*)::int from public.purchase_requests_discover(:'orgS'::uuid) where id = (select id from _r where name = 'sup')), 0, 'a supplier does not discover its own request');

-- A design office is the Engineer business: its requests go to showrooms.
set local request.jwt.claims = :'design';
select lives_ok(format($f$insert into _r select 'design', public.purchase_request_save(%L, null, null, 'Design office needs', null, null, false, %L::jsonb)$f$, :'orgD', :'item1'), 'a design office creates a request');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'design')), 'and publishes');
select is((select requester_audience from public.purchase_requests where id = (select id from _r where name = 'design')), 'engineer', 'its audience is Engineer');
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'design')), 1, 'a showroom sees it');
select is((select requester_name from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'design')) is not null, true, 'an organization requester shows its public name');
set local request.jwt.claims = :'tarek';
select is((select count(*)::int from public.purchase_requests_discover(:'orgM'::uuid) where id = (select id from _r where name = 'design')), 0, 'a manufacturer does not');

-- The "requester organization is live" rule belongs to organization requests only.
reset role;
update public.organizations set deleted_at = now() where id = :'orgS';
set local role authenticated;
set local request.jwt.claims = :'sup2';
select is((select count(*)::int from public.purchase_requests_discover(:'orgS2'::uuid) where id = (select id from _r where name = 'sup')), 0, 'a request of a deleted organization disappears from discovery');
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'eng')), 1, 'an individual request does not depend on any organization');
reset role;
update public.organizations set deleted_at = null where id = :'orgS';
set local role authenticated;

-- Sales Team: acts through the workspace, inherits its audience, never its own.
set local request.jwt.claims = :'youssef';
select lives_ok(format($f$insert into _r select 'sales', public.purchase_request_save(%L, null, null, 'Sales Team request', null, null, false, %L::jsonb)$f$, :'orgC', :'item1'), 'a Sales Team member creates a request through the showroom workspace');
select is((select requester_audience from public.purchase_requests where id = (select id from _r where name = 'sales')), 'showroom_dealer', 'it carries the workspace''s audience');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'sales')), 'and publishes');
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id in (select id from _r where name in ('sales', 'show', 'shows'))), 0, 'a Sales Team member never discovers their own organization''s requests');
select is((select count(*)::int from public.purchase_requests_discover(:'orgC'::uuid) where id = (select id from _r where name = 'eng')), 1, 'but discovers what the showroom audience discovers');
select is((select count(*)::int from public.purchase_requests where id = (select id from _r where name = 'show')), 1, 'and the organization''s colleagues can read the organization''s requests');
set local request.jwt.claims = :'khaled';
select is((select count(*)::int from public.purchase_requests_discover(:'orgS'::uuid) where id = (select id from _r where name = 'sales')), 1, 'a supplier discovers the Sales Team''s showroom request');

-- E. Responses (Option A) -------------------------------------------------------------------
reset role;
insert into _it select 'show', position, id from public.purchase_request_items where request_id = (select id from _r where name = 'show');
insert into _it select 'sup', position, id from public.purchase_request_items where request_id = (select id from _r where name = 'sup');
insert into _cnt values ('rfqs', (select count(*) from public.rfqs)), ('quotes', (select count(*) from public.quotations)), ('orders', (select count(*) from public.orders));
set local role authenticated;

set local request.jwt.claims = :'khaled';
select lives_ok(format($f$insert into _r select 'r_khaled', public.purchase_request_response_save(%L, %L, 'Best price in town', current_date + 14, %L::jsonb)$f$, :'orgS', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 10, 'unit_price', 12.5, 'unit', 'roll'),
                      jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 2), 'offered_quantity', 4, 'unit_price', 80))::text),
  'a supplier answers in FULL');
select is((select coverage from public.purchase_request_responses where id = (select id from _r where name = 'r_khaled')), 'full', 'full coverage is derived, not asserted by the client');
select is((select total from public.purchase_request_responses where id = (select id from _r where name = 'r_khaled')), 445.00::numeric, 'the response total is the sum of the stored line totals');
select is((select line_total from public.purchase_request_response_items where response_id = (select id from _r where name = 'r_khaled') and requested_quantity = 10), 125.00::numeric, 'a line total is stored: quantity x unit price');
select is((select my_response_status from public.purchase_requests_discover(:'orgS'::uuid) where id = (select id from _r where name = 'show')), 'submitted', 'discovery shows the workspace''s own response status');

set local request.jwt.claims = :'tarek';
select lives_ok(format($f$insert into _r select 'r_tarek', public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgM', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 5, 'unit_price', 13.25))::text),
  'a manufacturer answers PARTIALLY (half the quantity, one item)');
select is((select coverage from public.purchase_request_responses where id = (select id from _r where name = 'r_tarek')), 'partial', 'partial coverage is derived');
select is((select total from public.purchase_request_responses where id = (select id from _r where name = 'r_tarek')), 66.25::numeric, 'and totalled exactly');

set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 11, 'unit_price', 10))::text),
  '22023', null, 'offering MORE than requested is refused');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 0, 'unit_price', 10))::text),
  '22023', null, 'offering zero is refused');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 5, 'unit_price', 12.505))::text),
  '22023', null, 'a price with more than two decimals is refused');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 5, 'unit_price', 0))::text),
  '22023', null, 'a zero price is refused');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 5, 'unit_price', 10, 'unit', 'meter'))::text),
  '22023', null, 'a different unit is refused: no conversion');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'sup' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  '22023', null, 'an item of another request is refused');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10),
                      jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 2, 'unit_price', 10))::text),
  '22023', null, 'the same item twice is refused');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, '[]'::jsonb)$f$, :'orgI', (select id from _r where name = 'show')), '22023', null, 'an empty response is refused');
select is((select count(*)::int from public.purchase_request_responses where responder_org_id = :'orgI'::uuid), 0, 'a refused response leaves nothing behind');

-- Who may respond.
set local request.jwt.claims = :'show2';
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgC2', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  'P0002', null, 'a showroom outside the audience cannot respond (and learns nothing)');
set local request.jwt.claims = :'hana';
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgC', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  'P0002', null, 'a requester cannot respond to their own request');
set local request.jwt.claims = :'tarek';
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgC', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  '42501', null, 'responding as a workspace the caller is not in is refused');
reset role;
insert into public.memberships (user_id, organization_id, status, accepted_at) values ('70000010-0000-4000-8000-000000000010', :'orgS', 'active', now());
set local role authenticated;
set local request.jwt.claims = :'engineer';
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgS', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  '42501', null, 'a member without the respond capability cannot respond');
set local request.jwt.claims = :'mostafa';
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgK', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  'P0002', null, 'a workspace with no audience cannot respond');

-- Isolation: responder sees its own, requester sees all.
set local request.jwt.claims = :'khaled';
select is((select count(*)::int from public.purchase_request_responses where request_id = (select id from _r where name = 'show')), 1, 'a responder reads only its own response');
select is((select count(*)::int from public.purchase_request_response_items where response_id = (select id from _r where name = 'r_tarek')), 0, 'and not a competitor''s lines');
select is(public.purchase_request_responses_for_requester((select id from _r where name = 'show')), null, 'a responder cannot call the requester comparison reader');
set local request.jwt.claims = :'show2';
select is((select count(*)::int from public.purchase_request_responses), 0, 'an unrelated organization reads no responses');
set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_request_responses where request_id = (select id from _r where name = 'show')), 2, 'the requester reads every submitted response');
select is((select count(*)::int from public.purchase_request_response_items where response_id in (select id from _r where name in ('r_khaled', 'r_tarek'))), 3, 'and every line');
select is(jsonb_array_length(public.purchase_request_responses_for_requester((select id from _r where name = 'show'))), 2, 'the comparison reader returns both responses');
select is((public.purchase_request_responses_for_requester((select id from _r where name = 'show')) -> 0 -> 'responder' ->> 'name') is not null, true, 'with the responder''s public identity');
set local request.jwt.claims = :'youssef';
select is(jsonb_array_length(public.purchase_request_responses_for_requester((select id from _r where name = 'show'))), 2, 'a colleague of the requesting organization sees them too');

-- Shortlist: non-binding.
set local request.jwt.claims = :'hana';
select lives_ok(format($f$select public.purchase_request_response_shortlist(%L, true), public.purchase_request_response_shortlist(%L, true)$f$,
    (select id from _r where name = 'r_khaled'), (select id from _r where name = 'r_tarek')), 'the requester shortlists MORE THAN ONE response');
select is((select count(*)::int from public.purchase_request_responses where request_id = (select id from _r where name = 'show') and shortlisted), 2, 'both are shortlisted');
select is((select status::text from public.purchase_requests where id = (select id from _r where name = 'show')), 'published', 'shortlisting does not close the request');
reset role;
select is((select count(*) from public.rfqs), (select n from _cnt where name = 'rfqs'), 'shortlisting creates no RFQ');
select is((select count(*) from public.quotations), (select n from _cnt where name = 'quotes'), 'no quotation');
select is((select count(*) from public.orders), (select n from _cnt where name = 'orders'), 'and no purchase order');
set local role authenticated;
set local request.jwt.claims = :'khaled';
select throws_ok(format($f$select public.purchase_request_response_shortlist(%L, true)$f$, (select id from _r where name = 'r_khaled')), 'P0002', null, 'a responder cannot shortlist (not even its own)');
set local request.jwt.claims = :'hana';
select lives_ok(format($f$select public.purchase_request_response_shortlist(%L, false)$f$, (select id from _r where name = 'r_tarek')), 'the requester removes one from the shortlist');

-- Revising clears the mark; withdrawing removes the response from the comparison.
set local request.jwt.claims = :'khaled';
select lives_ok(format($f$select public.purchase_request_response_save(%L, %L, 'Revised', null, %L::jsonb)$f$, :'orgS', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 10, 'unit_price', 11.75))::text),
  'a responder revises its response');
select is((select shortlisted from public.purchase_request_responses where id = (select id from _r where name = 'r_khaled')), false, 'a revised response must be re-reviewed (the shortlist mark is cleared)');
select is((select coverage from public.purchase_request_responses where id = (select id from _r where name = 'r_khaled')), 'partial', 'and its coverage is recomputed');
select is((select count(*)::int from public.purchase_request_responses where request_id = (select id from _r where name = 'show') and responder_org_id = :'orgS'::uuid), 1, 'still one live response per responder');
set local request.jwt.claims = :'tarek';
select lives_ok(format($f$select public.purchase_request_response_withdraw(%L)$f$, (select id from _r where name = 'r_tarek')), 'a responder withdraws');
set local request.jwt.claims = :'hana';
select is(jsonb_array_length(public.purchase_request_responses_for_requester((select id from _r where name = 'show'))), 1, 'a withdrawn response leaves the comparison');
select throws_ok(format($f$select public.purchase_request_response_shortlist(%L, true)$f$, (select id from _r where name = 'r_tarek')), 'P0002', null, 'a withdrawn response cannot be shortlisted');

-- Closing the request.
select lives_ok(format($f$select public.purchase_request_close(%L, %L)$f$, (select id from _r where name = 'show'), (select version from public.purchase_requests where id = (select id from _r where name = 'show'))), 'the requester closes the request');
set local request.jwt.claims = :'sara';
select is((select count(*)::int from public.purchase_requests_discover(:'orgI'::uuid) where id = (select id from _r where name = 'show')), 0, 'a closed request leaves discovery');
select throws_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgI', (select id from _r where name = 'show'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'show' and pos = 1), 'offered_quantity', 1, 'unit_price', 10))::text),
  'P0002', null, 'and takes no new responses');
set local request.jwt.claims = :'khaled';
select is((public.purchase_request_detail(:'orgS'::uuid, (select id from _r where name = 'show')) ->> 'status'), 'closed', 'a responder keeps access to the request it answered');
select is((public.purchase_request_detail(:'orgS'::uuid, (select id from _r where name = 'show')) ->> 'can_respond')::boolean, false, 'but cannot respond to it any more');
select is(public.purchase_request_detail(:'orgS'::uuid, (select id from _r where name = 'eng')), null, 'a request outside the audience has no detail');
set local request.jwt.claims = :'show2';
select is(public.purchase_request_detail(:'orgC2'::uuid, (select id from _r where name = 'show')), null, 'a non-responder cannot open a closed request');

-- A responder keeps a CLOSED request, but a CANCELLED one disappears for everyone but its owner side.
set local request.jwt.claims = :'sup2';
select lives_ok(format($f$select public.purchase_request_response_save(%L, %L, null, null, %L::jsonb)$f$, :'orgS2', (select id from _r where name = 'sup'),
    jsonb_build_array(jsonb_build_object('request_item_id', (select id from _it where req = 'sup' and pos = 1), 'offered_quantity', 20, 'unit_price', 9))::text),
  'another supplier answers a supplier request');
select is((public.purchase_request_detail(:'orgS2'::uuid, (select id from _r where name = 'sup')) ->> 'status'), 'published', 'the responder reads the live request');
set local request.jwt.claims = :'khaled';
select lives_ok(format($f$select public.purchase_request_cancel(%L, 2)$f$, (select id from _r where name = 'sup')), 'the requester cancels it');
set local request.jwt.claims = :'sup2';
select is(public.purchase_request_detail(:'orgS2'::uuid, (select id from _r where name = 'sup')), null, 'a cancelled request is gone for its responders too');
select is((select count(*)::int from public.purchase_requests_discover(:'orgS2'::uuid) where id = (select id from _r where name = 'sup')), 0, 'and from discovery');

-- Cancel.
set local request.jwt.claims = :'imp2';
select throws_ok(format($f$select public.purchase_request_cancel(%L, 2)$f$, (select id from _r where name = 'imp')), 'P0002', null, 'someone else cannot cancel a request');
set local request.jwt.claims = :'sara';
select lives_ok(format($f$select public.purchase_request_cancel(%L, 2)$f$, (select id from _r where name = 'imp')), 'the requester cancels their request');
select throws_ok(format($f$select public.purchase_request_publish(%L, 3)$f$, (select id from _r where name = 'imp')), '22023', null, 'a cancelled request cannot be published again');
set local request.jwt.claims = :'imp2';
select is((select count(*)::int from public.purchase_requests_discover(:'orgI2'::uuid) where id = (select id from _r where name = 'imp')), 0, 'a cancelled request leaves discovery');

-- F. Reference images ------------------------------------------------------------------------
set local request.jwt.claims = :'engineer';
select lives_ok(format($f$insert into _r select 'img', public.purchase_request_save(null, null, null, 'With photos', null, null, false, %L::jsonb)$f$, :'item1'), 'a draft with one item');
reset role;
insert into _it select 'img', position, id from public.purchase_request_items where request_id = (select id from _r where name = 'img');
set local role authenticated;
set local request.jwt.claims = :'engineer';
select lives_ok($f$insert into _k select 'k1', public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/png')$f$, 'the first reference image ticket');
select lives_ok($f$insert into _k select 'k2', public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/jpeg')$f$, 'the second');
select throws_ok($f$select public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/png')$f$, '23514', null, 'a third image is refused: at most 2 per item');
select throws_ok($f$select public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/gif')$f$, '22023', null, 'only jpeg / png / webp');
select ok((select key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.png$' from _k where name = 'k1'), 'the key is owner/request/uuid.ext');
select is((select split_part(key, '/', 1) from _k where name = 'k1'), '70000010-0000-4000-8000-000000000010', 'an individual''s scope is the person, not a fake organization');
set local request.jwt.claims = :'hana';
select throws_ok($f$select public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/png')$f$, 'P0002', null, 'another tenant cannot attach an image to the item');
select throws_ok(format($f$select public.purchase_request_image_confirm_upload(%L)$f$, (select key from _k where name = 'k1')), 'P0002', null, 'only the uploader can confirm');
set local request.jwt.claims = :'engineer';
select lives_ok(format($f$select public.purchase_request_image_confirm_upload(%L), public.purchase_request_image_confirm_upload(%L)$f$, (select key from _k where name = 'k1'), (select key from _k where name = 'k2')), 'the uploader confirms both');
select is(public.purchase_request_image_remove((select id from public.purchase_request_images where object_key = (select key from _k where name = 'k1'))), (select key from _k where name = 'k1'), 'removing returns the key so the bytes can be cleaned up');
select lives_ok($f$insert into _k select 'k3', public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/webp')$f$, 'and the freed slot can be used again');
select lives_ok(format($f$select public.purchase_request_publish(%L, 1)$f$, (select id from _r where name = 'img')), 'publish the request');
select throws_ok($f$select public.purchase_request_image_request_upload((select id from _it where req = 'img' and pos = 1), 'image/png')$f$, '22023', null, 'a published request''s attachments are frozen');
select ok(not app.can_upload_request_image_object((select key from _k where name = 'k3')), 'an old ticket cannot upload bytes once the request is published');
select throws_ok(format($f$select public.purchase_request_image_confirm_upload(%L)$f$, (select key from _k where name = 'k3')), '22023', null, 'and cannot be confirmed after publishing: attachments are draft-only');
select is((select state::text from public.purchase_request_images where object_key = (select key from _k where name = 'k3')), 'pending', 'the late ticket never became a ready image');
select ok(app.can_read_request_image_object((select key from _k where name = 'k2')), 'the owner side reads its image object');

set local request.jwt.claims = :'hana';
select is((select count(*)::int from public.purchase_request_images), 0, 'the image table is not readable across tenants');
select ok(not app.can_read_request_image_object((select key from _k where name = 'k2')), 'nor the object through the owner-side policy');
select is(jsonb_array_length(public.purchase_request_detail(:'orgC'::uuid, (select id from _r where name = 'img')) -> 'items' -> 0 -> 'images'), 1, 'the audience''s detail lists only READY images');
select ok(not app.has_request_image_grant((select key from _k where name = 'k2')), 'without a grant the image cannot be signed');
select is(public.request_image_access_grant(:'orgC'::uuid, array[(select key from _k where name = 'k2')]), array[(select key from _k where name = 'k2')], 'a workspace in the audience is granted signing');
select ok(app.has_request_image_grant((select key from _k where name = 'k2')), 'and the storage predicate allows it');
select throws_ok(format($f$select public.request_image_access_grant(%L, array[%L])$f$, :'orgM', (select key from _k where name = 'k2')), '42501', null, 'a grant for a workspace the caller is not in is refused');
set local request.jwt.claims = :'tarek';
select is(public.request_image_access_grant(:'orgM'::uuid, array[(select key from _k where name = 'k2')]), '{}'::text[], 'a workspace outside the audience gets no grant');
select ok(not app.has_request_image_grant((select key from _k where name = 'k2')), 'and cannot sign');
set local request.jwt.claims = :'engineer';
select lives_ok(format($f$select public.purchase_request_cancel(%L, 2)$f$, (select id from _r where name = 'img')), 'the requester cancels');
set local request.jwt.claims = :'hana';
select ok(not app.has_request_image_grant((select key from _k where name = 'k2')), 'a cancelled request ends signing at once, before the grant expires');
select is(public.purchase_request_detail(:'orgC'::uuid, (select id from _r where name = 'img')), null, 'and the detail');

-- G. Audit and anonymous callers ------------------------------------------------------------------
reset role;
select cmp_ok((select count(*)::int from public.audit_log where action = 'purchase_request.published'), '>=', 8, 'publishing is audited');
select cmp_ok((select count(*)::int from public.audit_log where action = 'purchase_request_response.submitted'), '>=', 3, 'responses are audited');
select cmp_ok((select count(*)::int from public.audit_log where action = 'purchase_request_response.shortlisted'), '>=', 2, 'shortlisting is audited');
select is((select count(*)::int from public.audit_log where action like 'purchase_request%' and metadata::text ~* 'price|total'), 0, 'audit metadata carries no money');
set local role anon;
select throws_ok('select * from public.purchase_requests_discover(null)', '42501', null, 'anon cannot discover');
reset role;

select * from finish();
rollback;
