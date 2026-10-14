-- pgTAP: the FIRST business of a business registration has the REGISTERED type,
-- enforced at the database boundary (20261010090001_business_registration_type_lock.sql).
--
-- Every assertion calls the public RPCs DIRECTLY, as `authenticated`, with the caller's
-- own JWT claims: exactly what a signed-in user can do with their access token while
-- bypassing the Next.js page and server actions.
--
-- LOCKED   : a registrant (business track + approved type, no persona, no organization,
--            no completed draft, not staff) can only save / submit THEIR registered type.
-- UNLOCKED : once the first organization exists (a second business is free again), and
--            never locked at all for an Engineer, an existing Owner, platform staff.
-- UNCHANGED: Installer, Sales and invited employees are denied exactly as before.
create extension if not exists pgtap;

begin;
select plan(51);

-- Complete ONLY test fixtures for the updated creation contract. This temporary
-- function rolls back with this test; no production row or authorization rule changes.
create function pg_temp.complete_business_fixture() returns void language plpgsql security definer set search_path='' as $fixture$
begin
 update public.business_creation_drafts set
 governorate=coalesce(governorate,'cairo'),
 city=case when governorate is null then 'maadi' else city end,
 detailed_address=coalesce(detailed_address,'10 Fixture Street'),
 contact_phone=case when org_type='showroom_dealer' then coalesce(contact_phone,'+201012345678') else contact_phone end,
 activity_type=case when org_type='showroom_dealer' then coalesce(activity_type,'decor_showroom') else activity_type end
 where user_id=(select auth.uid()) and completed_at is null;
end;
$fixture$;


-- ---------------------------------------------------------------------------
-- Fixtures (all verified). Persona is set directly as the postgres owner role.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('86' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000086')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p86-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P86 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 14) n;

-- 1 showroom, 2 supplier, 3 manufacturer, 4 importer, 5 manufacturer (NULL type save),
-- 10 supplier (adds a second business), 11 supplier registrant who is platform staff,
-- 12 importer registrant holding a STALE open draft of another type: registrants, no persona.
-- 6 engineer (also holds a business intent), 7 active owner, 8 installer, 9 sales,
-- 13 invited employee (membership only), 14 no intent at all.
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values
  ('86000001-0000-4000-8000-000000000086', 'business', 'showroom_dealer', now(), now()),
  ('86000002-0000-4000-8000-000000000086', 'business', 'supplier',        now(), now()),
  ('86000003-0000-4000-8000-000000000086', 'business', 'manufacturer',    now(), now()),
  ('86000004-0000-4000-8000-000000000086', 'business', 'importer',        now(), now()),
  ('86000005-0000-4000-8000-000000000086', 'business', 'manufacturer',    now(), now()),
  ('86000006-0000-4000-8000-000000000086', 'business', 'supplier',        now(), now()),
  ('86000007-0000-4000-8000-000000000086', 'business', 'supplier',        now(), now()),
  ('86000010-0000-4000-8000-000000000086', 'business', 'supplier',        now(), now()),
  ('86000011-0000-4000-8000-000000000086', 'business', 'supplier',        now(), now()),
  ('86000012-0000-4000-8000-000000000086', 'business', 'importer',        now(), now());

update public.users set primary_account_type = 'engineer'             where id = '86000006-0000-4000-8000-000000000086';
update public.users set primary_account_type = 'installer_technician' where id = '86000008-0000-4000-8000-000000000086';
update public.users set primary_account_type = 'sales'                where id = '86000009-0000-4000-8000-000000000086';

insert into public.platform_role_grants (user_id, role)
values ('86000011-0000-4000-8000-000000000086', 'support');

-- A stale OPEN draft (saved before the rule existed) of a type that is not the registered one.
insert into public.business_creation_drafts (id, user_id, legal_name, display_name, org_type)
values ('86d00012-0000-4000-8000-000000000086', '86000012-0000-4000-8000-000000000086', 'P86 Stale Draft LLC', 'P86 Stale Draft', 'supplier');

-- An organization with 7 = active OWNER and 13 = active plain MEMBER.
insert into public.organizations (id, name, org_type, status, created_by)
values ('86aaaaaa-0000-4000-8000-000000000086', 'P86 Showroom', 'showroom_dealer', 'active',
        '86000007-0000-4000-8000-000000000086');
insert into public.memberships (id, user_id, organization_id, status)
values
  ('86e00007-0000-4000-8000-000000000086', '86000007-0000-4000-8000-000000000086', '86aaaaaa-0000-4000-8000-000000000086', 'active'),
  ('86e00013-0000-4000-8000-000000000086', '86000013-0000-4000-8000-000000000086', '86aaaaaa-0000-4000-8000-000000000086', 'active');
insert into public.membership_capabilities (membership_id, capability_key)
values ('86e00007-0000-4000-8000-000000000086', 'org.manage');

-- ---------------------------------------------------------------------------
-- The helper: internal, and exact about WHO is locked (read as the owner role).
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'app.mandatory_registration_business_type(uuid)', 'execute'),
  'the lock helper is not callable by clients');
select ok(
  has_function_privilege('authenticated', 'public.business_draft_save(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.business_draft_submit(uuid)', 'execute'),
  'the RPC signatures are unchanged and stay callable by authenticated');
select is(app.mandatory_registration_business_type('86000001-0000-4000-8000-000000000086')::text, 'showroom_dealer',
  'helper: a showroom registrant is locked to showroom_dealer');
select is(app.mandatory_registration_business_type('86000004-0000-4000-8000-000000000086')::text, 'importer',
  'helper: an importer registrant is locked to importer');
select is(app.mandatory_registration_business_type('86000006-0000-4000-8000-000000000086'), null,
  'helper: an Engineer (personal persona) is never locked, even with a business intent');
select is(app.mandatory_registration_business_type('86000007-0000-4000-8000-000000000086'), null,
  'helper: an existing active owner is never locked');
select is(app.mandatory_registration_business_type('86000011-0000-4000-8000-000000000086'), null,
  'helper: platform staff are never locked');
select is(app.mandatory_registration_business_type('86000013-0000-4000-8000-000000000086'), null,
  'helper: an invited employee (no business intent) is not locked');
select is(app.mandatory_registration_business_type('86000014-0000-4000-8000-000000000086'), null,
  'helper: no intent at all is not locked');
select is(app.mandatory_registration_business_type(null), null, 'helper: a NULL uid is not locked');

set local role authenticated;

-- ===========================================================================
-- 1/2. Showroom registrant: its own type is allowed; any other is rejected.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000001-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'P86 Bypass', p_org_type => 'supplier') $$,
  '22023', null, '2. showroom registrant + supplier draft: rejected');
reset role;
select is((select count(*)::int from public.business_creation_drafts where user_id = '86000001-0000-4000-8000-000000000086'),
  0, '2b. ...and nothing was written');
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000001-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 Showroom Co LLC', p_display_name => 'P86 Showroom Co', p_org_type => 'showroom_dealer') $$,
  '1. showroom registrant + showroom draft: allowed');
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit(null) $$,
  '1b. ...and the organization is created');
reset role;
select is((select org_type::text from public.organizations where created_by = '86000001-0000-4000-8000-000000000086'),
  'showroom_dealer', '1c. the first organization is a showroom_dealer');
select is(app.mandatory_registration_business_type('86000001-0000-4000-8000-000000000086'), null,
  '8. after the first organization the registration lock is gone (not a permanent global lock)');
set local role authenticated;

-- ===========================================================================
-- 3/4/7. Supplier registrant, including the wrapper and an update of an OPEN draft.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000002-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'P86 Bypass', p_org_type => 'importer') $$,
  '22023', null, '4. supplier registrant + importer draft: rejected');
select throws_ok($$ select public.business_save(p_display_name => 'P86 Bypass', p_org_type => 'importer') $$,
  '22023', null, '12. the business_save wrapper cannot bypass the lock');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 Supplier Co LLC', p_display_name => 'P86 Supplier Co', p_org_type => 'supplier') $$,
  '3. supplier registrant + supplier draft: allowed');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'P86 Supplier Co LLC', p_display_name => 'P86 Supplier Co', p_org_type => 'importer') $$,
  '22023', null, '7. updating the OPEN first-business draft with a different type: rejected');
select throws_ok($$ select public.business_save(p_legal_name => 'P86 Supplier Co LLC', p_display_name => 'P86 Supplier Co', p_org_type => 'manufacturer') $$,
  '22023', null, '7b. ...also through the wrapper');
reset role;
select is((select org_type::text from public.business_creation_drafts where user_id = '86000002-0000-4000-8000-000000000086'),
  'supplier', '7c. the open draft still holds the registered type');
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000002-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_submit() $$, '3b. the business_submit wrapper creates the first organization');
reset role;
select is((select org_type::text from public.organizations where created_by = '86000002-0000-4000-8000-000000000086'),
  'supplier', '3c. the first organization is a supplier');
set local role authenticated;

-- ===========================================================================
-- 5/6. Manufacturer and importer: exact type allowed.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000003-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 Maker LLC', p_display_name => 'P86 Maker', p_org_type => 'manufacturer') $$,
  '5. manufacturer registrant + manufacturer draft: allowed');
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit(null) $$, '5b. ...and created');
set local request.jwt.claims = '{"sub":"86000004-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 Importer LLC', p_display_name => 'P86 Importer', p_org_type => 'importer') $$,
  '6. importer registrant + importer draft: allowed');
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit(null) $$, '6b. ...and created');
reset role;
select is((select string_agg(org_type::text, ',' order by created_by) from public.organizations
            where created_by in ('86000003-0000-4000-8000-000000000086', '86000004-0000-4000-8000-000000000086')),
  'manufacturer,importer', '5c. the organizations carry exactly the registered types');
set local role authenticated;

-- A typeless draft stays typeless and can never become an organization.
set local request.jwt.claims = '{"sub":"86000005-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 Null Type LLC', p_display_name => 'P86 Null Type') $$,
  '5d. a NULL p_org_type is stored as NULL while locked (unchanged behaviour)');
select throws_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit(null) $$,
  '22023', null, '5e. ...and submit refuses it: a business type is required');
reset role;
select is((select count(*)::int from public.organizations where created_by = '86000005-0000-4000-8000-000000000086'),
  0, '5f. no organization was created');
set local role authenticated;

-- ===========================================================================
-- A STALE open draft of another type can neither be submitted nor override the intent.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000012-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit('86d00012-0000-4000-8000-000000000086') $$,
  '22023', null, '12b. a stale draft of another type cannot be submitted as the first business');
select throws_ok($$ select pg_temp.complete_business_fixture(); select public.business_submit() $$,
  '22023', null, '12c. ...nor through the business_submit wrapper');
select throws_ok($$ select public.business_draft_save(p_draft_id => '86d00012-0000-4000-8000-000000000086', p_legal_name => 'P86 Stale LLC', p_display_name => 'P86 Stale', p_org_type => 'supplier') $$,
  '22023', null, '12d. re-saving the stale value is rejected: it cannot override the registration');
reset role;
select is((select count(*)::int from public.organizations where created_by = '86000012-0000-4000-8000-000000000086'),
  0, '12e. no organization was created');
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000012-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_draft_id => '86d00012-0000-4000-8000-000000000086', p_legal_name => 'P86 Stale LLC', p_display_name => 'P86 Stale', p_org_type => 'importer') $$,
  '12f. correcting the draft to the registered type works');
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit('86d00012-0000-4000-8000-000000000086') $$,
  '12g. ...and the same draft is then submitted');
reset role;
select is((select org_type::text from public.organizations where created_by = '86000012-0000-4000-8000-000000000086'),
  'importer', '12h. the organization is the registered importer');
set local role authenticated;

-- ===========================================================================
-- 8. After the first organization the lock is not global: a second business is free.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000010-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 First LLC', p_display_name => 'P86 First', p_org_type => 'supplier') $$, '8a. first business saved');
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit(null) $$, '8b. first business created');
select lives_ok($$ select public.business_draft_save(p_legal_name => 'P86 Second LLC', p_display_name => 'P86 Second', p_org_type => 'importer') $$,
  '8c. the same user may now save a DIFFERENT approved type (a second business)');
select lives_ok($$ select pg_temp.complete_business_fixture(); select public.business_draft_submit(null) $$, '8d. ...and create it');
reset role;
select is((select string_agg(org_type::text, ',' order by org_type::text) from public.organizations where created_by = '86000010-0000-4000-8000-000000000086'),
  'importer,supplier', '8e. both organizations exist with their own types');
set local role authenticated;

-- ===========================================================================
-- 9/10. Engineer and existing Owner: any approved type, unchanged.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000006-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'P86 Engineer Co', p_org_type => 'importer') $$,
  '9. an Engineer creating a business of another approved type: unchanged');
set local request.jwt.claims = '{"sub":"86000007-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'P86 Owner Co', p_org_type => 'manufacturer') $$,
  '10. an existing entitled Owner creating another approved type: unchanged');
set local request.jwt.claims = '{"sub":"86000011-0000-4000-8000-000000000086","role":"authenticated"}';
select lives_ok($$ select public.business_draft_save(p_display_name => 'P86 Staff Co', p_org_type => 'importer') $$,
  '10b. platform staff are not locked');

-- ===========================================================================
-- 11. Installer, Sales and invited employees: denied exactly as before (42501).
-- ===========================================================================
set local request.jwt.claims = '{"sub":"86000008-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '11. installer: still denied');
set local request.jwt.claims = '{"sub":"86000009-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '11b. sales: still denied');
set local request.jwt.claims = '{"sub":"86000013-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '11c. an invited employee: still denied');
set local request.jwt.claims = '{"sub":"86000014-0000-4000-8000-000000000086","role":"authenticated"}';
select throws_ok($$ select public.business_draft_save(p_display_name => 'Bypass', p_org_type => 'supplier') $$,
  '42501', null, '11d. no intent at all: still denied');

select * from finish();
rollback;
