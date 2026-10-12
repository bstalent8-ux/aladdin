-- pgTAP: referral approval that MATERIALISES an organization requires a legal name and persists a canonical branch location
-- (20261011090003_referral_organization_legal_name_and_branch_location.sql).
--
-- Two admin-approved paths create a real organization + primary branch without an Owner membership:
--   public.showroom_referral_approve (a Salesperson's referral) and public.network_referral_approve (an Installer's).
-- Both must now (a) refuse to CREATE an organization without a legal name, before writing anything, (b) store the legal name,
-- (c) store the referral's location on the PRIMARY BRANCH as canonical governorate / city / custom city, and (d) leave EVERYTHING
-- else exactly as it was: linking to an existing organization, provenance, Sales (never Owner) membership, Points, idempotency.
--
-- Fixtures (seed-pilot): 70000002 + 70000007 salespeople, 55555555 platform administrator, 71000006 installer,
-- 11111111 (given the platform moderator role INSIDE this transaction only), 9c000000-cccc-…-001 Cairo Ceramics Showroom,
-- an organization that already exists (the linking case) with NO legal name (a historical organization).
create extension if not exists pgtap;

begin;
select plan(83);

update auth.users set email_confirmed_at = now()
  where id in ('70000002-0000-4000-8000-000000000002', '70000007-0000-4000-8000-000000000007',
               '55555555-5555-4555-8555-555555555555', '71000006-0000-4000-8000-000000000006',
               '11111111-1111-4111-8111-111111111111');
insert into public.platform_role_grants (user_id, role, granted_by)
values ('11111111-1111-4111-8111-111111111111', 'moderator', '11111111-1111-4111-8111-111111111111');

select is((select count(*)::int from public.points_ledger), 0, 'the ledger starts empty');

-- ===========================================================================
-- Salesperson referral S1: NO legal name anywhere -> approval cannot create the organization
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, null, 'No Legal Showroom', null, 'cairo', 'nasr_city', 'Main Branch'), null,
  'S1: a referral without a legal name can be drafted (the referrer need not know it)');
select isnt(public.showroom_referral_submit(null), null, 'S1: ...and submitted');

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'No Legal Showroom')) $$,
  '22023', 'a legal business name is required to create the organization from a referral',
  '2. creating a NEW organization from a referral without a legal name is rejected');
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'No Legal Showroom'), null, '  ') $$,
  '22023', null, '2b. a blank legal name is rejected too');
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'No Legal Showroom'), null, 'A') $$,
  '22023', null, '2c. a one-character legal name is rejected');
reset role;
select is((select count(*)::int from public.organizations where name = 'No Legal Showroom'), 0,
  '2d. nothing was written: no organization exists');
select is((select status::text from public.organization_referrals where display_name = 'No Legal Showroom'), 'submitted',
  '2e. ...and the referral is still awaiting review');
select is((select count(*)::int from public.points_ledger), 0, '2f. no Points were awarded');

-- ===========================================================================
-- S1 continued: the Admin supplies the legal name -> approval succeeds
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select set_config('test.s1',
  public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'No Legal Showroom'),
                                   null, '  No Legal Showroom for Trading LLC  ')::text, true);
select isnt(current_setting('test.s1'), '', '3. with an Admin-verified legal name the referral creates the organization');
reset role;
select is((select legal_name || '|' || name from public.organizations where id = current_setting('test.s1')::uuid),
  'No Legal Showroom for Trading LLC|No Legal Showroom', '4. legal_name is persisted (trimmed); name stays the display name');
select is((select governorate_key || '|' || city_key || '|' || coalesce(city_custom_name, 'NULL') from public.branches
            where organization_id = current_setting('test.s1')::uuid),
  'cairo|nasr-city|NULL', '5. the PRIMARY BRANCH carries the referral location (legacy nasr_city -> canonical nasr-city)');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'organizations'
            and column_name in ('governorate_key', 'city_key', 'city_custom_name')), 0,
  '5b. the organization itself carries no location columns');
select is((select source || '|' || referred_by_user_id::text from public.organizations where id = current_setting('test.s1')::uuid),
  'salesperson_referral|70000002-0000-4000-8000-000000000002', '6. referral provenance is unchanged');
select is((select count(*)::int from public.memberships m where m.organization_id = current_setting('test.s1')::uuid
            and m.user_id = '70000002-0000-4000-8000-000000000002' and m.status = 'active'), 1,
  '7. the salesperson holds exactly one active membership');
select is((select count(*)::int from public.membership_capabilities c join public.memberships m on m.id = c.membership_id
            where m.organization_id = current_setting('test.s1')::uuid and m.user_id = '70000002-0000-4000-8000-000000000002'
              and c.capability_key in ('org.manage', 'org.members.manage')), 0,
  '7b. ...and it is a Sales membership, never Owner (no org.manage)');
select is((select count(*)::int from public.memberships m where m.organization_id = current_setting('test.s1')::uuid
            and exists (select 1 from public.membership_capabilities c where c.membership_id = m.id and c.capability_key = 'org.manage')), 0,
  '7c. the organization has NO owner at all');
select is((select points_delta from public.points_ledger where user_id = '70000002-0000-4000-8000-000000000002'), 100,
  '8. Points are unchanged: exactly +100 to the referring salesperson');

-- 9. Retry / idempotency
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'No Legal Showroom'))::text,
  current_setting('test.s1'), '9. approving again (even without a legal name) returns the SAME organization');
reset role;
select is((select count(*)::int from public.organizations where name = 'No Legal Showroom'), 1, '9b. no second organization');
select is((select count(*)::int from public.points_ledger where user_id = '70000002-0000-4000-8000-000000000002'), 1, '9c. no second award');

-- ===========================================================================
-- S2: the referrer already supplied a legal name. It is only a PREFILL: the Admin must explicitly confirm it.
--     The location is a vocabulary the catalogue lacks -> kept as a typed city
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, 'Smouha Home LLC', 'Smouha Home', null, 'alexandria', 'smouha', 'Smouha Branch'), null,
  'S2: a referral that already carries a legal name');
select isnt(public.showroom_referral_submit(null), null, 'S2: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is((select legal_name from public.organization_referrals where display_name = 'Smouha Home'), 'Smouha Home LLC',
  'S2: the referral row itself carries a legal name (what the Admin form prefills)');
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Smouha Home')) $$,
  '22023', 'a legal business name is required to create the organization from a referral',
  'S2: NO FALLBACK: the referral has a legal name but the Admin did not confirm one -> NEW-org creation is rejected');
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Smouha Home'), null, '   ') $$,
  '22023', null, 'S2: a blank Admin value does not fall back to the referral legal name either');
reset role;
select is((select count(*)::int from public.organizations where name = 'Smouha Home'), 0, 'S2: nothing was written by the rejected approvals');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
-- the Admin edits the prefilled value before approving: the Admin-confirmed value is canonical
select set_config('test.s2', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Smouha Home'),
  null, 'Smouha Home Trading Company LLC')::text, true);
select isnt(current_setting('test.s2'), '', 'S2: with an explicit Admin confirmation the referral creates the organization');
reset role;
select is((select legal_name from public.organizations where id = current_setting('test.s2')::uuid), 'Smouha Home Trading Company LLC',
  'S2: the Admin-EDITED legal name (not the referrer value) is what organizations.legal_name stores');
select is((select governorate_key || '|' || coalesce(city_key, 'NULL') || '|' || city_custom_name from public.branches
            where organization_id = current_setting('test.s2')::uuid),
  'alexandria|NULL|Smouha', 'S2: a valid place the catalogue lacks is kept as the custom city, never as "other"');

-- ===========================================================================
-- S3: the Admin overrides the location (strict) when creating
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, null, 'Override Co', null, 'giza', 'dokki', 'Main'), null, 'S3: a referral to override');
select isnt(public.showroom_referral_submit(null), null, 'S3: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Override Co'),
       null, 'Override Co LLC', 'cairo', 'mansoura') $$,
  '22023', null, 'S3: an Admin-supplied city of another governorate is refused');
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Override Co'),
       null, 'Override Co LLC', 'dakahlia', 'other') $$,
  '22023', null, 'S3: the literal "other" is refused as an Admin-supplied city');
select set_config('test.s3', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Override Co'),
  null, 'Override Co LLC', 'dakahlia', null, 'Kafr Test Village')::text, true);
reset role;
select is((select governorate_key || '|' || coalesce(city_key, 'NULL') || '|' || city_custom_name from public.branches
            where organization_id = current_setting('test.s3')::uuid),
  'dakahlia|NULL|Kafr Test Village', 'S3: the Admin''s verified location (custom city) is what the branch stores');

-- ===========================================================================
-- S4: a referral whose city is the literal "other" never stores it
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, 'Odd Place LLC', 'Odd Place', null, 'cairo', 'other', 'Main'), null, 'S4: a referral with city "other"');
select isnt(public.showroom_referral_submit(null), null, 'S4: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select set_config('test.s4', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Odd Place'), null, 'Odd Place LLC')::text, true);
reset role;
select is((select governorate_key || '|' || coalesce(city_key, 'NULL') || '|' || coalesce(city_custom_name, 'NULL') from public.branches
            where organization_id = current_setting('test.s4')::uuid),
  'cairo|NULL|NULL', 'S4: the literal "other" names no city: the governorate alone remains and "other" is never stored');

-- ===========================================================================
-- S2b: the Admin submits the referrer's value UNCHANGED, explicitly -> creation succeeds with it
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, 'Explicit Confirm LLC', 'Explicit Confirm', null, 'cairo', 'maadi', 'Main'), null, 'S2b: referral with a legal name');
select isnt(public.showroom_referral_submit(null), null, 'S2b: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select set_config('test.s2b', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Explicit Confirm'),
  null, 'Explicit Confirm LLC')::text, true);
reset role;
select is((select legal_name from public.organizations where id = current_setting('test.s2b')::uuid), 'Explicit Confirm LLC',
  'S2b: the Admin explicitly submitting the prefilled value creates the organization with it');

-- ===========================================================================
-- Referral CITY is never dropped (a referrer has ONE open referral at a time, so each scenario is approved before the next)
-- ===========================================================================
-- S5: a valid city the catalogue does not list
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, null, 'Hamlet Showroom', null, 'alexandria', 'Borg Test Hamlet', 'Main'), null, 'S5: referral with an unlisted city');
select isnt(public.showroom_referral_submit(null), null, 'S5: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select set_config('test.s5', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Hamlet Showroom'),
  null, 'Hamlet Showroom LLC')::text, true);

-- S6: a canonical city of ANOTHER governorate is refused until corrected
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, null, 'Wrong Gov Showroom', null, 'cairo', 'mansoura', 'Main'), null, 'S6: referral with a city of another governorate');
select isnt(public.showroom_referral_submit(null), null, 'S6: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_ok(
  $$ select public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Wrong Gov Showroom'),
       null, 'Wrong Gov LLC') $$,
  '22023', 'the referral city belongs to another governorate: enter the branch location',
  'S6: a canonical city of a different governorate is refused until the Admin corrects it');
reset role;
select is((select count(*)::int from public.organizations where name = 'Wrong Gov Showroom'), 0, 'S6: nothing was written by the refusal');
select is((select status::text from public.organization_referrals where display_name = 'Wrong Gov Showroom'), 'submitted', 'S6: the referral is still awaiting review');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select set_config('test.s6', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Wrong Gov Showroom'),
  null, 'Wrong Gov LLC', 'dakahlia', null, 'mansoura')::text, true);

-- S7: the referral flow itself never submits a referral without a city (showroom_referral_submit requires both), so the
-- governorate-only outcome is exercised on the helper below.

-- S8: the Arabic "Other"
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, null, 'Arabic Other Showroom', null, 'cairo', 'أخرى', 'Main'), null, 'S8: referral whose city is the Arabic Other');
select isnt(public.showroom_referral_submit(null), null, 'S8: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select set_config('test.s8', public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Arabic Other Showroom'),
  null, 'Arabic Other LLC')::text, true);
reset role;
select is((select governorate_key || '|' || coalesce(city_key, 'NULL') || '|' || city_custom_name from public.branches
            where organization_id = current_setting('test.s5')::uuid),
  'alexandria|NULL|Borg Test Hamlet', 'S5: an unknown but valid referral city is preserved as the custom city (never reduced to the governorate)');
select is((select governorate_key || '|' || city_key || '|' || coalesce(city_custom_name, 'NULL') from public.branches
            where organization_id = current_setting('test.s6')::uuid),
  'dakahlia|' || app.resolve_city('dakahlia', 'mansoura') || '|NULL', 'S6: after the Admin corrects the governorate the canonical city is stored');
select is((select governorate_key || '|' || coalesce(city_key, 'NULL') || '|' || coalesce(city_custom_name, 'NULL') from public.branches
            where organization_id = current_setting('test.s8')::uuid),
  'cairo|NULL|NULL', 'S8: the Arabic Other is never stored literally');
select is((select count(*)::int from public.branches where city_key = 'other' or lower(coalesce(city_custom_name, '')) in ('other', 'أخرى')), 0,
  'S8: no branch anywhere stores other');
select is((select row(o_governorate, o_city, o_custom)::text from app.referral_branch_location('giza', 'sheikh_zayed')),
  '(giza,sheikh-zayed,)', 'helper: a legacy canonical value -> city_key');
select is((select row(o_governorate, o_city, o_custom)::text from app.referral_branch_location('Giza', 'Some Unlisted Place')),
  '(giza,,"Some Unlisted Place")', 'helper: an unlisted valid city -> custom city');
select is((select row(o_governorate, o_city, o_custom)::text from app.referral_branch_location('giza', null)),
  '(giza,,)', 'S7: governorate-only is kept ONLY when the source genuinely supplied no city');
select is((select row(o_governorate, o_city, o_custom)::text from app.referral_branch_location('giza', 'Other')),
  '(giza,,)', 'helper: the literal Other names no city and is never stored');
select throws_ok($$ select * from app.referral_branch_location('cairo', 'mansoura') $$, '22023', null, 'helper: another governorate city is refused');
select throws_ok($$ select * from app.referral_branch_location(null, 'Maadi') $$, '22023', null, 'helper: a city with no governorate is refused (not dropped)');
select throws_ok($$ select * from app.referral_branch_location('narnia', 'Maadi') $$, '22023', null, 'helper: an unknown governorate is refused (not dropped)');
select throws_ok($$ select * from app.referral_branch_location('cairo', 'x') $$, '22023', null, 'helper: a 1-character city is refused (not dropped)');
select is((select row(o_governorate, o_city, o_custom)::text from app.referral_branch_location(null, null)), '(,,)', 'helper: no location at all stays empty');

-- ===========================================================================
-- 1. LINKING to an existing organization: unchanged (no legal name needed, existing org untouched)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select isnt(public.showroom_referral_save(null, null, 'Cairo Ceramics Showroom', null, 'cairo', 'maadi', 'Main'), null, 'L: a referral of a showroom that already exists');
select isnt(public.showroom_referral_submit(null), null, 'L: ...submitted');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(public.showroom_referral_approve((select id from public.organization_referrals where display_name = 'Cairo Ceramics Showroom'),
  '9c000000-cccc-4ccc-8ccc-000000000001')::text, '9c000000-cccc-4ccc-8ccc-000000000001',
  '1. linking to an existing organization needs NO legal name and returns that organization');
reset role;
select is((select legal_name from public.organizations where id = '9c000000-cccc-4ccc-8ccc-000000000001'), null,
  '1b. the existing (historical) organization is untouched: its legal_name stays NULL');
select is((select count(*)::int from public.organizations where name = 'Cairo Ceramics Showroom'), 1, '1c. no second organization');
select is((select count(*)::int from public.points_ledger where organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'), 0,
  '1d. linking awards nothing (unchanged)');

-- ===========================================================================
-- NETWORK referral (an Installer's referred showroom): the same invariant
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.n1', public.network_referral_create_new('Net Showroom', 'cairo', 'nasr-city')::text, true);
select isnt(current_setting('test.n1'), '', 'N: an installer refers a new showroom');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$ select public.network_referral_approve(current_setting('test.n1')::uuid) $$,
  '22023', 'a legal business name is required to create the organization from a referral',
  'N: creating a new organization from a network referral without a legal name is rejected');
select throws_ok($$ select public.network_referral_approve(current_setting('test.n1')::uuid, null, 'X') $$,
  '22023', null, 'N: a one-character legal name is rejected');
reset role;
select is((select count(*)::int from public.organizations where name = 'Net Showroom'), 0, 'N: nothing was written');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select set_config('test.n1org', public.network_referral_approve(current_setting('test.n1')::uuid, null, 'Net Showroom Trading LLC')::text, true);
reset role;
select is((select legal_name || '|' || name || '|' || source from public.organizations where id = current_setting('test.n1org')::uuid),
  'Net Showroom Trading LLC|Net Showroom|installer_referral', 'N: legal name persisted, display name kept, installer provenance intact');
select is((select governorate_key || '|' || city_key || '|' || coalesce(city_custom_name, 'NULL') from public.branches
            where organization_id = current_setting('test.n1org')::uuid),
  'cairo|nasr-city|NULL', 'N: the primary branch carries the referral location');
select is((select points_delta from public.points_ledger where user_id = '71000006-0000-4000-8000-000000000006'), 100,
  'N: Points unchanged (+100 to the installer)');
select is((select count(*)::int from public.memberships where organization_id = current_setting('test.n1org')::uuid), 0,
  'N: still no membership of any kind is created (a network referral is attribution only)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(public.network_referral_approve(current_setting('test.n1')::uuid)::text, current_setting('test.n1org'),
  'N: approving again is idempotent and returns the same organization');
reset role;
select is((select count(*)::int from public.organizations where name = 'Net Showroom'), 1, 'N: no duplicate organization');
select is((select count(*)::int from public.points_ledger where user_id = '71000006-0000-4000-8000-000000000006'), 1, 'N: no second award');

-- Linking a network referral is unchanged too.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.n2', public.network_referral_create_new('Linked Net Showroom', 'giza', 'dokki')::text, true);
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(public.network_referral_approve(current_setting('test.n2')::uuid, '9c000000-cccc-4ccc-8ccc-000000000001')::text,
  '9c000000-cccc-4ccc-8ccc-000000000001', 'N: linking an existing organization needs no legal name');
reset role;

-- ===========================================================================
-- Boundary: the internal helper is not client-callable, and the public signatures keep their grants
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'app.referral_branch_location(text,text)', 'execute'),
  'the tolerant location helper is not callable by clients');
select ok(has_function_privilege('authenticated', 'public.showroom_referral_approve(uuid,uuid,text,text,text,text)', 'execute')
          and not has_function_privilege('anon', 'public.showroom_referral_approve(uuid,uuid,text,text,text,text)', 'execute')
          and has_function_privilege('authenticated', 'public.network_referral_approve(uuid,uuid,text,text,text,text)', 'execute')
          and not has_function_privilege('anon', 'public.network_referral_approve(uuid,uuid,text,text,text,text)', 'execute'),
  'the approve RPCs keep their grants (authenticated only; the Admin permission is checked inside)');

select * from finish();
rollback;
