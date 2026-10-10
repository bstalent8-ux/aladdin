-- pgTAP: Contact visibility + network.refer candidates (20261018090001/2).
--
-- Claims under test:
--   * CONTACT  - phone / WhatsApp / e-mail are hidden by default; the owner controls each
--               field independently; a field cannot be exposed without a value; only an
--               org.manage member writes a business contact; only an authenticated member
--               of an ACTIVE workspace, naming that workspace, reads exposed fields of a
--               directory-eligible target; base tables stay unreadable cross-tenant.
--   * CRAFTSMAN - exposure uses the person's EXISTING profile phone / verified contacts;
--               nothing is copied; a hidden profile exposes nothing.
--   * REFER    - network.refer is assignable by an org.manage holder, org.manage implies it,
--               and without it (or outside the org) a candidate cannot be submitted.
--   * REVIEW   - approval is a status change ONLY: no Auth user, no organization, no profile,
--               no Points, no contact exposure; submitted content is immutable; the
--               craftsman-refers-showroom flow is untouched (covered by 51_*).
--
-- Fixtures (seed-pilot): Hana (owner, orgC showroom, verified) - Sara (sales member of orgC)
-- Delta (owner, orgS supplier, active+verified) - Tarek (orgM manufacturer, NOT verified)
-- Ahmed 7000...09 (listed installer) - platform user 1111...

create extension if not exists pgtap;

begin;
select plan(66);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'
\set orgS '9f000000-ffff-4fff-8fff-000000000004'
\set hana  '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sara  '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set tarek '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
\set delta '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}'
\set ahmed '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}'
\set admin '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}'

-- A. Structure ------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.organization_contacts'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.profile_contact_visibility'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.network_candidates'::regclass),
  'RLS is enabled on all three new tables');
select ok(not has_table_privilege('authenticated', 'public.organization_contacts', 'insert')
      and not has_table_privilege('authenticated', 'public.organization_contacts', 'update')
      and not has_table_privilege('authenticated', 'public.network_candidates', 'insert')
      and not has_table_privilege('authenticated', 'public.network_candidates', 'update')
      and not has_table_privilege('authenticated', 'public.profile_contact_visibility', 'insert'),
  'no client DML grant exists on any new table (RPC-only writes)');
select ok(not has_function_privilege('anon', 'public.business_contact(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.craftsman_contact(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.network_candidate_create(uuid,text,text,text,text,text,text,text,text,text,text)', 'execute')
      and has_function_privilege('authenticated', 'public.business_contact(uuid, uuid)', 'execute'),
  'readers / writers are not callable by anon');
select is((select column_default from information_schema.columns
            where table_name = 'organization_contacts' and column_name = 'show_phone'), 'false', 'show_phone defaults to false');
select is((select column_default from information_schema.columns
            where table_name = 'profile_contact_visibility' and column_name = 'show_email'), 'false', 'show_email defaults to false');
select ok(not exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name in ('organization_public_directory', 'profile_public_directory')
              and column_name ~ 'phone|whatsapp|email'),
  'the public directory views carry no contact column');

-- B. Business contact: write path --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.organization_contact_set(%L, '+201001112223', null, null, true, false, false)$f$, :'orgC'),
  '42501', null, 'a member WITHOUT org.manage cannot write the business contact');

set local request.jwt.claims = :'tarek';
select throws_ok(format($f$select public.organization_contact_set(%L, '+201001112223', null, null, true, false, false)$f$, :'orgC'),
  '42501', null, 'another tenant''s owner cannot write orgC''s contact');

set local request.jwt.claims = :'hana';
select throws_ok(format($f$select public.organization_contact_set(%L, null, null, null, true, false, false)$f$, :'orgC'),
  '22023', null, 'a field cannot be exposed without a value');
select throws_ok(format($f$select public.organization_contact_set(%L, '0100 111 2223', null, null, false, false, false)$f$, :'orgC'),
  '22023', null, 'a phone must be canonical E.164');
select throws_ok(format($f$select public.organization_contact_set(%L, null, null, 'not-an-email', false, false, false)$f$, :'orgC'),
  '22023', null, 'an invalid e-mail is rejected');
select throws_ok($f$insert into public.organization_contacts (organization_id, phone_e164) values ('9c000000-cccc-4ccc-8ccc-000000000001', '+201001112223')$f$,
  '42501', null, 'a direct INSERT is denied even for the owner');

-- Hidden by default: nothing is exposed before the owner opts in.
set local request.jwt.claims = :'delta';
select is((select count(*) from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), 0::bigint, 'before any setting, a viewer reads nothing');

set local request.jwt.claims = :'hana';
select lives_ok(format($f$select public.organization_contact_set(%L, '+201001112223', '+201009998887', 'sales@cairo-ceramics.example', true, false, false)$f$, :'orgC'),
  'the owner stores three values and exposes ONLY the phone');
select is((select count(*) from public.organization_contacts), 1::bigint, 'the owner reads their own contact row');
select is((select show_whatsapp or show_email from public.organization_contacts), false, 'WhatsApp and e-mail stay hidden');

-- C. Business contact: read path --------------------------------------------------------
set local request.jwt.claims = :'delta';
select is((select phone from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), '+201001112223', 'a business viewer reads the exposed phone');
select is((select whatsapp from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), null, 'the hidden WhatsApp comes back NULL');
select is((select email from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), null, 'the hidden e-mail comes back NULL');
select is((select count(*) from public.organization_contacts), 0::bigint, 'a direct read of the base table is empty for another tenant');
select throws_ok(format($f$select * from public.business_contact(%L, %L)$f$, :'orgC', :'orgC'),
  '42501', null, 'a viewer cannot name a workspace they are not a member of');
select throws_ok(format($f$select * from public.business_contact(null, %L)$f$, :'orgC'),
  '42501', null, 'a viewer MUST name a workspace');

set local request.jwt.claims = :'ahmed';
select throws_ok(format($f$select * from public.business_contact(%L, %L)$f$, :'orgS', :'orgC'),
  '42501', null, 'a person with no business membership cannot read business contacts');

reset role;
set local role anon;
select throws_ok(format($f$select * from public.business_contact(%L, %L)$f$, :'orgS', :'orgC'),
  '42501', null, 'anon cannot read contacts');
reset role;

-- A target that is not directory-eligible (orgM is not verified) yields nothing, even if exposed.
set local role authenticated;
set local request.jwt.claims = :'tarek';
select lives_ok(format($f$select public.organization_contact_set(%L, '+201005550000', null, null, true, false, false)$f$, :'orgM'),
  'the unverified manufacturer stores + exposes a phone');
set local request.jwt.claims = :'delta';
select is((select count(*) from public.business_contact(:'orgS'::uuid, :'orgM'::uuid)), 0::bigint,
  'an unverified organization exposes nothing to others');

-- The owner changes their mind: the same field is hidden again immediately.
set local request.jwt.claims = :'hana';
select lives_ok(format($f$select public.organization_contact_set(%L, '+201001112223', '+201009998887', 'sales@cairo-ceramics.example', false, true, true)$f$, :'orgC'),
  'the owner switches to WhatsApp + e-mail only');
set local request.jwt.claims = :'delta';
select is((select phone from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), null, 'phone is hidden again');
select is((select whatsapp from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), '+201009998887', 'WhatsApp is now exposed');
select is((select email from public.business_contact(:'orgS'::uuid, :'orgC'::uuid)), 'sales@cairo-ceramics.example', 'e-mail is now exposed');

-- D. Craftsman contact -----------------------------------------------------------------------
reset role;
update public.profiles set phone_e164 = '+201112223334' where user_id = '70000009-0000-4000-8000-000000000009';
insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at)
  values ('70000009-0000-4000-8000-000000000009', 'whatsapp', '+201112223334', false, true, now());
create temp table _p as select id from public.profiles where user_id = '70000009-0000-4000-8000-000000000009';
grant all on _p to authenticated;

set local role authenticated;
set local request.jwt.claims = :'delta';
select is((select count(*) from public.craftsman_contact(:'orgS'::uuid, (select id from _p))), 0::bigint,
  'a craftsman exposes nothing until they opt in');

set local request.jwt.claims = :'ahmed';
select lives_ok($f$select public.profile_contact_visibility_set(true, false, true)$f$, 'the craftsman exposes phone + e-mail');

set local request.jwt.claims = :'delta';
select is((select phone from public.craftsman_contact(:'orgS'::uuid, (select id from _p))), '+201112223334', 'the exposed phone is the profile''s own phone');
select is((select whatsapp from public.craftsman_contact(:'orgS'::uuid, (select id from _p))), null, 'WhatsApp stays hidden');
select is((select email from public.craftsman_contact(:'orgS'::uuid, (select id from _p))), 'ahmed@example.test', 'the exposed e-mail is the verified contact');
select is((select count(*) from public.profile_contact_visibility), 0::bigint, 'another tenant cannot read the flags table');

set local request.jwt.claims = :'ahmed';
reset role;
delete from public.contacts where user_id = '70000009-0000-4000-8000-000000000009' and channel = 'whatsapp';
set local role authenticated;
set local request.jwt.claims = :'ahmed';
select throws_ok($f$select public.profile_contact_visibility_set(false, true, false)$f$,
  '22023', null, 'a field cannot be exposed without an existing value');

reset role;
update public.profiles set public_profile_status = 'hidden' where user_id = '70000009-0000-4000-8000-000000000009';
set local role authenticated;
set local request.jwt.claims = :'delta';
select is((select count(*) from public.craftsman_contact(:'orgS'::uuid, (select id from _p))), 0::bigint,
  'a hidden (unlisted) profile exposes nothing, whatever its flags');
reset role;
update public.profiles set public_profile_status = 'listed' where user_id = '70000009-0000-4000-8000-000000000009';

-- E. network.refer ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.network_candidate_create(%L, 'supplier', 'Alpha Tiles', 'supplier', null, 'Cairo', 'Nasr City', '+201000000001', null, null, null)$f$, :'orgC'),
  '42501', null, 'a member without network.refer cannot submit a candidate');

set local request.jwt.claims = :'tarek';
select throws_ok(format($f$select public.network_candidate_create(%L, 'supplier', 'Alpha Tiles', 'supplier', null, null, null, '+201000000001', null, null, null)$f$, :'orgC'),
  '42501', null, 'an outsider cannot submit on behalf of orgC');

set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.membership_set_capabilities('50000002-0000-4000-8000-000000000002', array['network.refer'])$f$),
  '42501', null, 'a member cannot grant themselves network.refer');

set local request.jwt.claims = :'hana';
select lives_ok($f$select public.membership_set_capabilities('50000002-0000-4000-8000-000000000002',
    (select array_agg(capability_key) || array['network.refer'] from public.membership_capabilities where membership_id = '50000002-0000-4000-8000-000000000002'))$f$,
  'the owner (org.manage, no literal row) grants network.refer WITHOUT granting org.manage');
reset role;
select ok(exists (select 1 from public.membership_capabilities where membership_id = '50000002-0000-4000-8000-000000000002' and capability_key = 'network.refer')
      and not exists (select 1 from public.membership_capabilities where membership_id = '50000002-0000-4000-8000-000000000002' and capability_key = 'org.manage'),
  'Sara now holds network.refer and still lacks org.manage');

set local role authenticated;
set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.network_candidate_create(%L, 'supplier', 'Alpha Tiles', 'supplier', null, null, null, null, null, null, null)$f$, :'orgC'),
  '22023', null, 'a candidate needs at least one contact detail');
select throws_ok(format($f$select public.network_candidate_create(%L, 'supplier', 'Alpha Tiles', null, null, null, null, '+201000000001', null, null, null)$f$, :'orgC'),
  '22023', null, 'a supplier candidate needs a business type');
select throws_ok(format($f$select public.network_candidate_create(%L, 'wholesaler', 'Alpha Tiles', 'supplier', null, null, null, '+201000000001', null, null, null)$f$, :'orgC'),
  '22023', null, 'only supplier / craftsman kinds exist');
select throws_ok(format($f$select public.network_candidate_create(%L, 'supplier', 'Alpha Tiles', 'showroom_dealer', null, null, null, '+201000000001', null, null, null)$f$, :'orgC'),
  '22023', null, 'a supplier candidate cannot claim a non-supplier organization type');

create temp table _c (name text primary key, id uuid);
grant all on _c to authenticated;
insert into _c select 'sup', public.network_candidate_create(:'orgC'::uuid, 'supplier', 'Alpha Tiles', 'importer', null, 'Cairo', 'Nasr City', '+201000000001', null, 'x@alpha.example', 'met at expo');
insert into _c select 'sup2', public.network_candidate_create(:'orgC'::uuid, 'supplier', ' alpha TILES ', 'importer', null, null, null, '+201000000001', null, null, null);
select is((select id from _c where name = 'sup2'), (select id from _c where name = 'sup'), 'the same open submission is idempotent');
insert into _c select 'crf', public.network_candidate_create(:'orgC'::uuid, 'craftsman', 'Mahmoud Fixer', null, 'wallpaper_installation', 'Giza', null, null, '+201000000002', null, null);
select is((select count(*) from public.my_network_candidates), 2::bigint, 'the submitter reads their two candidates');
select is((select status from public.my_network_candidates where id = (select id from _c where name = 'sup')), 'pending', 'candidates start pending');

set local request.jwt.claims = :'hana';
select is((select count(*) from public.my_network_candidates), 2::bigint, 'an org.manage member of the submitting org reads them too');
set local request.jwt.claims = :'tarek';
select is((select count(*) from public.my_network_candidates), 0::bigint, 'another tenant sees none');
set local request.jwt.claims = :'delta';
select is((select count(*) from public.network_candidates), 0::bigint, 'a direct read of the base table is empty for another tenant');

-- F. Review: status only ----------------------------------------------------------------------------
reset role;
create temp table _before as select
  (select count(*) from auth.users) u, (select count(*) from public.organizations) o,
  (select count(*) from public.profiles) p, (select count(*) from public.points_ledger) pl;
insert into public.platform_role_grants (user_id, role, granted_by)
  values ('11111111-1111-4111-8111-111111111111', 'moderator', '11111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = :'sara';
select throws_ok(format($f$select public.network_candidate_approve(%L)$f$, (select id from _c where name = 'sup')),
  '42501', null, 'the submitter cannot approve their own candidate');
set local request.jwt.claims = :'hana';
select throws_ok(format($f$select public.network_candidate_approve(%L)$f$, (select id from _c where name = 'sup')),
  '42501', null, 'not even the organization owner approves');

set local request.jwt.claims = :'admin';
select is((select count(*) from public.network_candidates), 2::bigint, 'platform review reads all candidates');
select lives_ok(format($f$select public.network_candidate_approve(%L, 'looks real')$f$, (select id from _c where name = 'sup')), 'platform approves the supplier candidate');
select lives_ok(format($f$select public.network_candidate_reject(%L, 'duplicate of existing member')$f$, (select id from _c where name = 'crf')), 'platform rejects the craftsman candidate');
select throws_ok(format($f$select public.network_candidate_reject(%L, '')$f$, (select id from _c where name = 'sup')),
  '22023', null, 'a rejection needs a reason');

reset role;
select is((select u from _before), (select count(*) from auth.users), 'approval created NO Auth user');
select is((select o from _before), (select count(*) from public.organizations), 'approval created NO organization');
select is((select p from _before), (select count(*) from public.profiles), 'approval created NO profile');
select is((select pl from _before), (select count(*) from public.points_ledger), 'approval awarded NO Points');
select throws_ok(format($f$update public.network_candidates set display_name = 'Hijacked' where id = %L$f$, (select id from _c where name = 'sup')),
  '23514', null, 'submitted content is immutable even for a privileged writer');
select ok((select count(*) = 4 from public.audit_log where action in ('network_candidate.submitted', 'network_candidate.approved', 'network_candidate.rejected')
            and subject_id in (select id from _c)), 'submission + review are audited (2 submitted, 1 approved, 1 rejected)');
select ok(not exists (select 1 from public.audit_log where action like 'network_candidate.%' and metadata::text ~ '\+2010000000|alpha\.example'),
  'audit metadata never carries contact values');

select * from finish();
rollback;
