-- pgTAP: required LEGAL NAME and the PRIMARY BRANCH location, enforced at the database boundary
-- (20261011090001_expand_egypt_place_catalogue.sql + 20261011090002_business_legal_name_primary_branch_location.sql).
--
-- Every creation assertion calls the public RPCs DIRECTLY as `authenticated` with the caller's own JWT claims, so the
-- Next.js page and server actions cannot be what is protecting the invariant.
--
-- LEGAL NAME  : required to COMPLETE creation (all four business types, a later business too), optional while the
--               draft is being edited; persisted on organizations.legal_name; organizations.name stays the display
--               name; private (never in the public directory); historical organizations keep NULL.
-- LOCATION    : belongs to the primary BRANCH (the organization has no location columns). Canonical city, or a custom
--               city through "Other"; the literal "other" is never stored; a city of another governorate is rejected;
--               a chosen governorate needs a city to complete; historical underscore keys resolve.
-- CATALOGUE   : 27 governorates, a materially complete city list inside each, historical keys preserved.
create extension if not exists pgtap;

begin;
select plan(71);

-- ---------------------------------------------------------------------------
-- Fixtures (all verified)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('87' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000087')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p87-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P87 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 12) n;

-- 1 showroom, 2 supplier, 3 manufacturer, 4 importer registrants (first business, no persona).
-- 5 engineer (later businesses), 6 supplier registrant for canonical-city tests, 7 importer registrant for the custom
-- city, 8 showroom registrant for rejected-input tests, 9 supplier registrant holding a LEGACY-key draft,
-- 10 owner of a HISTORICAL organization (NULL legal name), 11 manufacturer registrant for the service-role check.
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values
  ('87000001-0000-4000-8000-000000000087', 'business', 'showroom_dealer', now(), now()),
  ('87000002-0000-4000-8000-000000000087', 'business', 'supplier',        now(), now()),
  ('87000003-0000-4000-8000-000000000087', 'business', 'manufacturer',    now(), now()),
  ('87000004-0000-4000-8000-000000000087', 'business', 'importer',        now(), now()),
  ('87000006-0000-4000-8000-000000000087', 'business', 'supplier',        now(), now()),
  ('87000007-0000-4000-8000-000000000087', 'business', 'importer',        now(), now()),
  ('87000008-0000-4000-8000-000000000087', 'business', 'showroom_dealer', now(), now()),
  ('87000009-0000-4000-8000-000000000087', 'business', 'supplier',        now(), now()),
  ('87000011-0000-4000-8000-000000000087', 'business', 'manufacturer',    now(), now());
update public.users set primary_account_type = 'engineer' where id = '87000005-0000-4000-8000-000000000087';

-- A HISTORICAL organization: created before legal names existed, so legal_name stays NULL (and is valid).
insert into public.organizations (id, name, org_type, status, is_verified, created_by)
values ('87aaaaaa-0000-4000-8000-000000000087', 'P87 Historical Showroom', 'showroom_dealer', 'active', true,
        '87000010-0000-4000-8000-000000000087');
insert into public.branches (id, organization_id, name)
values ('87bbbbbb-0000-4000-8000-000000000087', '87aaaaaa-0000-4000-8000-000000000087', 'Old HQ');
insert into public.memberships (id, user_id, organization_id, status)
values ('87e00010-0000-4000-8000-000000000087', '87000010-0000-4000-8000-000000000087', '87aaaaaa-0000-4000-8000-000000000087', 'active');
insert into public.membership_capabilities (membership_id, capability_key)
values ('87e00010-0000-4000-8000-000000000087', 'org.manage');

-- A public (active + verified) organization that DOES have a legal name, for the privacy checks.
insert into public.organizations (id, name, legal_name, org_type, status, is_verified, created_by)
values ('87cccccc-0000-4000-8000-000000000087', 'P87 Public Brand', 'P87 Secret Legal Name LLC', 'supplier', 'active', true,
        '87000010-0000-4000-8000-000000000087');

-- A LEGACY draft: persona-vocabulary keys (underscore) saved before the catalogue was canonical.
insert into public.business_creation_drafts (id, user_id, legal_name, display_name, org_type, governorate, city)
values ('87d00009-0000-4000-8000-000000000087', '87000009-0000-4000-8000-000000000087',
        'P87 Legacy LLC', 'P87 Legacy', 'supplier', 'cairo', 'nasr_city');

-- ---------------------------------------------------------------------------
-- Schema shape + privacy
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'organizations' and column_name = 'legal_name'),
  'organizations.legal_name exists');
select is((select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'organizations' and column_name = 'legal_name'),
  'YES', 'organizations.legal_name stays NULLABLE (historical organizations remain valid)');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'organizations'
              and column_name in ('governorate', 'city', 'governorate_key', 'city_key', 'city_custom_name')),
  0, 'the ORGANIZATION carries no physical location: the branch owns it');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'branches'
              and column_name in ('governorate_key', 'city_key', 'city_custom_name')),
  3, 'branches carries governorate_key, city_key and city_custom_name');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'organization_public_directory' and column_name = 'legal_name'),
  0, 'the public directory view does not expose legal_name');
select ok(not exists (select 1 from public.organization_public_directory d
                       where to_jsonb(d)::text like '%Secret Legal%'),
  'no public directory row carries the legal name');
select is((select name from public.organization_public_directory where id = '87cccccc-0000-4000-8000-000000000087'),
  'P87 Public Brand', 'the public directory still shows the display name');

set local role anon;
select throws_ok($$ select legal_name from public.organizations $$, '42501', null,
  'anonymous callers cannot read organizations.legal_name');
select throws_ok($$ select governorate_key from public.branches $$, '42501', null,
  'anonymous callers cannot read branch locations');
reset role;

-- ---------------------------------------------------------------------------
-- Catalogue coverage
-- ---------------------------------------------------------------------------
select is((select count(distinct key)::int from app.place_governorates), 27, 'the catalogue has exactly 27 governorates');
select is((select count(*)::int from (select governorate_key from app.place_cities where key <> 'other'
            group by governorate_key having count(distinct key) >= 5) g), 27,
  'every governorate has at least 5 catalogue cities');
select cmp_ok((select count(distinct (governorate_key, key))::int from app.place_cities where key <> 'other'), '>=', 300,
  'the city catalogue is materially complete (>= 300 cities)');
select is((select count(distinct governorate_key)::int from app.place_cities where key = 'other'), 27,
  'the historical "other" rows are kept for the installer job forms');
select ok(exists (select 1 from app.place_cities where governorate_key = 'cairo' and key = 'new-cairo')
          and exists (select 1 from app.place_cities where governorate_key = 'dakahlia' and key = 'mansoura')
          and exists (select 1 from app.place_cities where governorate_key = 'giza' and key = 'sheikh-zayed'),
  'historical catalogue keys are preserved');
select is((select app.resolve_city('cairo', 'عين شمس')), 'ain-shams', 'a new Cairo city resolves by its Arabic name');
select is((select app.resolve_city('dakahlia', 'Mit Salsil')), 'mit-salsil', 'a new Dakahlia markaz resolves by its English name');
select is((select count(*)::int from (
             select governorate_key, name_norm from app.place_cities
              group by governorate_key, name_norm having count(distinct key) > 1) d), 0,
  'no two catalogue cities of one governorate share a normalised name (resolution stays unambiguous)');

-- ---------------------------------------------------------------------------
-- The internal creation authority itself requires a legal name
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"87000011-0000-4000-8000-000000000087","role":"authenticated"}';
select throws_ok($$ select app.organization_create_owned('Direct Org', 'manufacturer', 'en', null, '   ') $$,
  '22023', null, 'app.organization_create_owned refuses a blank legal name');
select throws_ok($$ select app.organization_create_owned('Direct Org', 'manufacturer', 'en', null, 'Direct Org LLC', 'narnia') $$,
  '22023', null, 'app.organization_create_owned refuses an unknown governorate');

insert into app.showroom_legacy_seller_exceptions(organization_id,reason) values('87aaaaaa-0000-4000-8000-000000000087','Synthetic historical approved business fixture');
set local role authenticated;

-- ===========================================================================
-- LEGAL NAME — the four registration types, direct RPC
-- ===========================================================================
set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'Nile Showroom', p_org_type => 'showroom_dealer') $$,
  '1. a draft may be saved without a legal name while the user is still editing');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'a legal business name is required',
  '1b. a Showroom cannot complete without a legal name');
select lives_ok($$ select public.business_draft_save(p_legal_name => '   ', p_display_name => 'Nile Showroom', p_org_type => 'showroom_dealer') $$,
  '1c. a whitespace-only legal name is saved as empty');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'a legal business name is required',
  '1d. ...and still cannot complete');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'A', p_display_name => 'Nile Showroom', p_org_type => 'showroom_dealer') $$,
  '1e. a one-character legal name can be saved as a draft');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'the legal business name must be 2..120 characters',
  '1f. ...but is too short to complete');
select lives_ok($$ select public.business_draft_save(p_legal_name => '  Nile Showroom for Ceramics LLC  ', p_display_name => 'Nile Showroom', p_org_type => 'showroom_dealer') $$,
  '1g. the legal name is trimmed and saved');
reset role;
select is((select legal_name from public.business_creation_drafts where user_id = '87000001-0000-4000-8000-000000000087' and completed_at is null),
  'Nile Showroom for Ceramics LLC', '13. a draft resume preserves the legal name');
set local role authenticated;
set local request.jwt.claims = '{"sub":"87000001-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_submit(null) $$, '1h. with a legal name the Showroom completes (description stayed optional)');
reset role;
select is((select o.legal_name || '|' || o.name from public.organizations o where o.created_by = '87000001-0000-4000-8000-000000000087'),
  'Nile Showroom for Ceramics LLC|Nile Showroom', '9/10. organizations.legal_name = the legal name, organizations.name = the display name');
set local role authenticated;

set local request.jwt.claims = '{"sub":"87000002-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'Delta Supply', p_org_type => 'supplier') $$, '2a. Supplier draft saved without legal name');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'a legal business name is required', '2. a Supplier cannot complete without a legal name');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'Delta Supply Trading Co', p_display_name => 'Delta Supply', p_org_type => 'supplier') $$, '2b. legal name added');
select lives_ok($$ select public.business_draft_submit(null) $$, '2c. the Supplier completes');

set local request.jwt.claims = '{"sub":"87000003-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'Giza Works', p_org_type => 'manufacturer') $$, '3a. Manufacturer draft saved without legal name');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'a legal business name is required', '3. a Manufacturer cannot complete without a legal name');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'Giza Works Industries SAE', p_display_name => 'Giza Works', p_org_type => 'manufacturer') $$, '3b. legal name added');
select lives_ok($$ select public.business_draft_submit(null) $$, '3c. the Manufacturer completes');

set local request.jwt.claims = '{"sub":"87000004-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'Port Imports', p_org_type => 'importer') $$, '4a. Importer draft saved without legal name');
select throws_ok($$ select public.business_submit() $$, '22023', 'a legal business name is required', '4. an Importer cannot complete without a legal name (business_submit wrapper)');
select lives_ok($$ select public.business_save(p_legal_name => 'Port Imports and Trade LLC', p_display_name => 'Port Imports', p_org_type => 'importer') $$, '4b. legal name added (business_save wrapper)');
select lives_ok($$ select public.business_submit() $$, '4c. the Importer completes');

-- 5. A LATER business (the /business/new path: an Engineer) needs the legal name too.
set local request.jwt.claims = '{"sub":"87000005-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'Eng Studio', p_org_type => 'supplier') $$, '5a. an Engineer opens a later business');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'a legal business name is required', '5. a later business cannot complete without a legal name');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'Eng Studio Co', p_display_name => 'Eng Studio', p_org_type => 'supplier') $$, '5b. legal name added');
select lives_ok($$ select public.business_draft_submit(null) $$, '5c. the later business completes (any approved type, unchanged)');

-- 12. A historical organization with a NULL legal name stays valid and readable by its member.
set local request.jwt.claims = '{"sub":"87000010-0000-4000-8000-000000000087","role":"authenticated"}';
select is((select count(*)::int from public.organizations where id = '87aaaaaa-0000-4000-8000-000000000087' and legal_name is null),
  1, '12. a historical organization with NULL legal_name is still valid and readable');

-- ===========================================================================
-- LOCATION — the primary branch, canonical vs custom, direct RPC
-- ===========================================================================
-- Canonical city.
set local request.jwt.claims = '{"sub":"87000006-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'Mansoura Supply LLC', p_display_name => 'Mansoura Supply', p_org_type => 'supplier',
                      p_governorate => 'dakahlia', p_city => 'mansoura', p_primary_branch_name => 'Mansoura HQ') $$,
  'B1. a canonical governorate + city is accepted');
select lives_ok($$ select public.business_draft_submit(null) $$, 'B1b. ...and creates the business');
reset role;
select is((select b.governorate_key || '|' || b.city_key || '|' || coalesce(b.city_custom_name, 'NULL')
             from public.branches b join public.organizations o on o.id = b.organization_id
            where o.created_by = '87000006-0000-4000-8000-000000000087'),
  'dakahlia|mansoura|NULL', 'B1c. the PRIMARY BRANCH receives the canonical governorate and city');
set local role authenticated;

-- Custom city through "Other".
set local request.jwt.claims = '{"sub":"87000007-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'Delta Imports LLC', p_display_name => 'Delta Imports', p_org_type => 'importer',
                      p_governorate => 'dakahlia', p_city_custom_name => '  Kafr   Test Village ') $$,
  'B2. a custom city through Other is accepted');
reset role;
select is((select governorate || '|' || coalesce(city, 'NULL') || '|' || city_custom_name from public.business_creation_drafts
            where user_id = '87000007-0000-4000-8000-000000000087' and completed_at is null),
  'dakahlia|NULL|Kafr Test Village', 'B2b. the draft keeps the custom city (trimmed, collapsed), city key NULL');
set local role authenticated;
set local request.jwt.claims = '{"sub":"87000007-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_submit(null) $$, 'B2c. the custom-city business completes');
reset role;
select is((select b.governorate_key || '|' || coalesce(b.city_key, 'NULL') || '|' || b.city_custom_name
             from public.branches b join public.organizations o on o.id = b.organization_id
            where o.created_by = '87000007-0000-4000-8000-000000000087'),
  'dakahlia|NULL|Kafr Test Village', 'B2d. the branch stores the ACTUAL entered city, never the word "other"');
set local role authenticated;

-- Rejected input.
set local request.jwt.claims = '{"sub":"87000008-0000-4000-8000-000000000087","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city => 'mansoura') $$,
  '22023', null, 'B3. a city of another governorate is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'narnia') $$,
  '22023', null, 'B4. an unknown governorate is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city => 'other') $$,
  '22023', null, 'B5. the literal city key "other" is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city_custom_name => 'Other') $$,
  '22023', null, 'B6. a custom city named "Other" is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city_custom_name => 'أخرى') $$,
  '22023', null, 'B7. a custom city named "أخرى" is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city => 'maadi', p_city_custom_name => 'Somewhere') $$,
  '22023', null, 'B8. a city AND a custom city together are rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city_custom_name => 'A') $$,
  '22023', null, 'B9. a one-character custom city is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city_custom_name => repeat('x', 81)) $$,
  '22023', null, 'B10. an over-long custom city is rejected');
select throws_ok($$ select public.business_draft_save(p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_city => 'maadi') $$,
  '22023', null, 'B11. a city without a governorate is rejected');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'X Co LLC', p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo') $$,
  'B12. a governorate alone can be saved while editing');
select throws_ok($$ select public.business_draft_submit(null) $$, '22023', 'a city is required once a governorate is chosen',
  'B13. ...but a chosen governorate needs a city to complete');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'X Co LLC', p_display_name => 'X Co', p_org_type => 'showroom_dealer', p_governorate => 'cairo', p_city_custom_name => 'Maadi') $$,
  'B14. a custom name that IS a catalogue city of the governorate is accepted');
reset role;
select is((select city || '|' || coalesce(city_custom_name, 'NULL') from public.business_creation_drafts
            where user_id = '87000008-0000-4000-8000-000000000087' and completed_at is null),
  'maadi|NULL', 'B14b. ...and stored as the canonical city, not as free text');
set local role authenticated;

-- Historical underscore keys (the persona vocabulary) still resume and complete.
set local request.jwt.claims = '{"sub":"87000009-0000-4000-8000-000000000087","role":"authenticated"}';
select lives_ok($$ select public.business_draft_submit('87d00009-0000-4000-8000-000000000087') $$,
  'B15. a historical draft with legacy underscore keys still completes');
reset role;
select is((select b.governorate_key || '|' || b.city_key from public.branches b join public.organizations o on o.id = b.organization_id
            where o.created_by = '87000009-0000-4000-8000-000000000087'),
  'cairo|nasr-city', 'B15b. nasr_city resolved to the canonical nasr-city');

-- The branch table itself refuses non-canonical values, whichever writer sets them.
select throws_ok($$ update public.branches set governorate_key = 'cairo', city_key = 'other' where id = '87bbbbbb-0000-4000-8000-000000000087' $$,
  '22023', null, 'B16. branches cannot store city_key = other (guard trigger; the check constraint sits behind it)');
select throws_ok($$ update public.branches set governorate_key = 'cairo', city_key = 'mansoura' where id = '87bbbbbb-0000-4000-8000-000000000087' $$,
  '22023', null, 'B17. branches cannot store a city outside its governorate (guard trigger)');
select lives_ok($$ update public.branches set governorate_key = 'giza', city_key = 'sheikh-zayed' where id = '87bbbbbb-0000-4000-8000-000000000087' $$,
  'B18. a canonical location can be set on a historical branch');

select * from finish();
rollback;
