-- pgTAP: release rc1 - the FINAL approval of an organization application is Administrator-only (20261015090049).
--   A. a Support reviewer can start a review but cannot approve an organization
--   B. a Moderator likewise
--   C. an Administrator approves; the organization becomes active + verified (commercial authority starts here)
--   D. before approval the organization is a pending application with no catalog presence
create extension if not exists pgtap;

begin;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('90' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000090')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p90-' || n || '@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P90 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 4) n;

-- 1,2 applicants (engineer persona); 3 support; 4 moderator
update public.users set primary_account_type = 'engineer' where id in ('90000001-0000-4000-8000-000000000090','90000002-0000-4000-8000-000000000090');
insert into public.platform_role_grants (user_id, role) values
  ('90000003-0000-4000-8000-000000000090', 'support'),
  ('90000004-0000-4000-8000-000000000090', 'moderator');

\set a1 '{"sub":"90000001-0000-4000-8000-000000000090","role":"authenticated"}'
\set a2 '{"sub":"90000002-0000-4000-8000-000000000090","role":"authenticated"}'
\set sup '{"sub":"90000003-0000-4000-8000-000000000090","role":"authenticated"}'
\set mod '{"sub":"90000004-0000-4000-8000-000000000090","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

set local role authenticated;
set local request.jwt.claims = :'a1';
select isnt(public.business_draft_save(p_display_name => 'Nile Showroom', p_legal_name => 'Nile Showroom LLC', p_org_type => 'design_office'), null, 'applicant 1 opens a draft');
insert into _ids select 'o1', public.business_draft_submit((select id from public.business_creation_drafts where user_id = '90000001-0000-4000-8000-000000000090' and completed_at is null));
insert into _ids select 'v1', public.organization_application_submit((select id from _ids where k = 'o1'));

set local request.jwt.claims = :'a2';
select isnt(public.business_draft_save(p_display_name => 'Delta Showroom', p_legal_name => 'Delta Showroom LLC', p_org_type => 'design_office'), null, 'applicant 2 opens a draft');
insert into _ids select 'o2', public.business_draft_submit((select id from public.business_creation_drafts where user_id = '90000002-0000-4000-8000-000000000090' and completed_at is null));
insert into _ids select 'v2', public.organization_application_submit((select id from _ids where k = 'o2'));

-- D. pending: not active, not verified
reset role;
select is((select status::text || '/' || is_verified::text from public.organizations where id = (select id from _ids where k = 'o1')),
  'pending_verification/false', 'D1: a submitted application is pending and unverified');

-- A. Support (main's Admin RBAC: organization decisions need organizations.verify, which Support/Moderator do not hold)
set local role authenticated;
set local request.jwt.claims = :'sup';
select throws_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'v1')), '42501', null, 'A1: support CANNOT even start an organization review');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'v1')), '42501', null, 'A2: support CANNOT approve an organization');

-- B. Moderator
set local request.jwt.claims = :'mod';
select throws_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'v2')), '42501', null, 'B1: moderator CANNOT start an organization review');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'v2')), '42501', null, 'B2: moderator CANNOT approve an organization');

-- C. Administrator (starts its own review: only the assigned reviewer may decide)
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'v2')), 'C1: administrator starts the review');
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'v2')), 'C2: administrator approves');
select lives_ok(format($q$select public.apply_organization_verification(%L)$q$, (select id from _ids where k = 'v2')), 'C3: the approval is applied');
reset role;
select is((select status::text || '/' || is_verified::text from public.organizations where id = (select id from _ids where k = 'o2')),
  'active/true', 'C4: the approved organization is active and verified');

select * from finish();
rollback;
