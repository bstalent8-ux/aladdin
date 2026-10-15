-- pgTAP: organization governance (20261015090028).
--
-- Every call is made as `authenticated` with the caller's own JWT claims - exactly what a signed-in
-- user can do against the RPCs and tables directly, bypassing the application.
--
--   A. first organization: apply -> pending, tracked, NON-OPERATIONAL (no audience, no authority)
--   B. the Organization Application (verifications): submit, idempotent, owner-only, one open per org
--   C. second organization is refused until the first is APPROVED (draft / pending / needs changes)
--   D. Admin review: changes requested -> resubmit -> approve is ATOMIC; reviewer identity kept
--   E. after approval: the first is operational; a second may be applied for and starts pending;
--      approval is never inherited; the approved one stays usable meanwhile
--   F. bypass attempts: self-assigned status / type, direct verification writes, non-admin approval,
--      a non-Contractor taking contractor_company
--   G. Contractor: individual persona applies for a contractor company; audience only once approved
create extension if not exists pgtap;

begin;
select plan(58);

-- ---------------------------------------------------------------------------
-- Fixtures: 1 engineer (applicant), 2 contractor (applicant), 3 outsider engineer.
-- The seeded platform admin (55555555...) is the reviewer.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('76' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000076')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p76-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P76 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 3) n;

update public.users set primary_account_type = 'engineer'   where id = '76000001-0000-4000-8000-000000000076';
update public.users set primary_account_type = 'contractor' where id = '76000002-0000-4000-8000-000000000076';
update public.users set primary_account_type = 'engineer'   where id = '76000003-0000-4000-8000-000000000076';

-- Internal resolvers are not client-callable; the test grants them for its own transaction only.
grant execute on function app.org_product_audience(uuid), app.viewer_offer_audience(uuid) to authenticated;

\set eng '{"sub":"76000001-0000-4000-8000-000000000076","role":"authenticated"}'
\set con '{"sub":"76000002-0000-4000-8000-000000000076","role":"authenticated"}'
\set out '{"sub":"76000003-0000-4000-8000-000000000076","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

-- ===========================================================================
-- A. First organization
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'eng';

select isnt(public.business_draft_save(
  p_legal_name => 'Nile Design Office LLC', p_display_name => 'Nile Design Office', p_org_type => 'design_office',
  p_primary_branch_name => 'Maadi'), null, 'A1: a signed-in engineer opens the first organization application');

create temp table _o1 as
select public.business_draft_submit(
  (select id from public.business_creation_drafts
    where user_id = '76000001-0000-4000-8000-000000000076' and completed_at is null)) as id;
grant all on _o1 to authenticated;

select is((select status::text from public.organizations where id = (select id from _o1)),
  'pending_verification', 'A2: the new organization starts pending_verification');
select is((select is_verified from public.organizations where id = (select id from _o1)),
  false, 'A3: and unverified - the creator cannot self-verify');
select is(app.org_is_approved((select id from _o1)), false, 'A4: a pending organization is not approved');
select is(app.org_product_audience((select id from _o1)), null,
  'A5: a pending organization resolves NO business audience');
select is(app.can_publish_catalog((select id from _o1)), false, 'A6: it cannot publish products or offers');
select is(app.can_respond_rfq((select id from _o1)), false, 'A7: it cannot respond to requests as that organization');
select is(app.can_create_rfq((select id from _o1)), false, 'A8: it cannot create business RFQs');
select is(app.can_decide_quote((select id from _o1)), false, 'A9: it cannot decide quotations');
select is(app.viewer_offer_audience((select id from _o1)), null, 'A10: it has no offer audience');
select is((select is_approved from public.my_workspaces() where organization_id = (select id from _o1)),
  false, 'A11: it is listed as a workspace but flagged NOT approved');
select is((select application_status from public.my_organization_applications()
            where organization_id = (select id from _o1)),
  'draft', 'A12: before submission its application status is draft');
select isnt(app.can_write_catalog((select id from _o1)), false,
  'A13: the owner can still prepare (draft) products while pending');

-- ===========================================================================
-- B. The Organization Application
-- ===========================================================================
create temp table _a1 as select public.organization_application_submit((select id from _o1)) as id;
grant all on _a1 to authenticated;

select is((select application_status from public.my_organization_applications()
            where organization_id = (select id from _o1)),
  'pending_review', 'B1: submitting moves the application to pending_review');
select is(public.organization_application_submit((select id from _o1)), (select id from _a1),
  'B2: submitting again is idempotent (same application, no duplicate)');

set local request.jwt.claims = :'out';
select throws_ok(format($q$select public.organization_application_submit(%L)$q$, (select id from _o1)),
  '42501', null, 'B3: someone who does not own the organization cannot submit it');

reset role;
select throws_ok(format($q$insert into public.verifications (subject_type, organization_id, verification_type, status)
  values ('organization', %L, 'organization', 'submitted')$q$, (select id from _o1)),
  '23505', null, 'B4: a second OPEN application for the same organization is structurally impossible');
select is((select count(*)::int from public.audit_log
            where action = 'organization.application_submitted' and organization_id = (select id from _o1)),
  1, 'B5: the submission is audited once');

-- ===========================================================================
-- C. Second organization blocked until the FIRST is approved
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'eng';
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Second LLC', p_display_name => 'Second', p_org_type => 'importer') $$,
  '42501', 'an organization application is not available right now',
  'C1: a second application is refused while the first is pending review');

-- ===========================================================================
-- D. Admin review: changes requested -> resubmit -> approve (atomic)
-- ===========================================================================
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _a1)), 'D1: the reviewer claims the application');
select lives_ok(format($q$select public.review_request_changes(%L, %L)$q$, (select id from _a1), 'Please add the licence number.'),
  'D2: the reviewer requests changes');

set local request.jwt.claims = :'eng';
select is((select application_status from public.my_organization_applications()
            where organization_id = (select id from _o1)),
  'needs_changes', 'D3: the owner sees needs_changes');
select is((select reason from public.my_organization_applications() where organization_id = (select id from _o1)),
  'Please add the licence number.', 'D4: with the reviewer''s reason');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Second LLC', p_display_name => 'Second', p_org_type => 'importer') $$,
  '42501', 'an organization application is not available right now',
  'D5: a second application is still refused while changes are requested');
select is(public.organization_application_submit((select id from _o1)), (select id from _a1),
  'D6: resubmitting after changes reuses the same application (no duplicate)');
select is(app.org_is_approved((select id from _o1)), false, 'D7: resubmitting does not approve anything');

set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _a1)), 'D8: the reviewer claims it again');
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _a1)), 'D9: the reviewer approves');
reset role;

select is((select status::text from public.organizations where id = (select id from _o1)), 'active',
  'D10: approval ALONE activates the organization (atomic, no separate apply step)');
select is((select is_verified from public.organizations where id = (select id from _o1)), true, 'D11: and verifies it');
select isnt((select applied_at from public.verifications where id = (select id from _a1)), null,
  'D12: the application is stamped applied');
select is((select reviewer_id from public.verifications where id = (select id from _a1)),
  '55555555-5555-4555-8555-555555555555'::uuid, 'D13: the reviewer identity is preserved');
select is((select count(*)::int from public.memberships
            where organization_id = (select id from _o1) and status = 'active'), 1,
  'D14: exactly one owner membership - no duplicate records from approval');

-- ===========================================================================
-- E. After approval
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'eng';
select is(app.org_product_audience((select id from _o1)), 'engineer',
  'E1: the approved engineering office now resolves the Engineer audience');
select is(app.can_publish_catalog((select id from _o1)), true, 'E2: and may publish');
select is((select application_status from public.my_organization_applications()
            where organization_id = (select id from _o1)), 'approved', 'E3: its application reads approved');

select isnt(public.business_draft_save(p_legal_name => 'Nile Import LLC', p_display_name => 'Nile Import', p_org_type => 'importer'), null,
  'E4: once the first is approved a second application may be opened');
create temp table _o2 as
select public.business_draft_submit(
  (select id from public.business_creation_drafts
    where user_id = '76000001-0000-4000-8000-000000000076' and completed_at is null)) as id;
grant all on _o2 to authenticated;

select is((select status::text from public.organizations where id = (select id from _o2)),
  'pending_verification', 'E5: the second organization starts pending - approval is NOT inherited');
select is(app.org_product_audience((select id from _o2)), null, 'E6: the pending importer grants no Importer audience');
select is(app.can_publish_catalog((select id from _o2)), false, 'E7: and no publishing authority');
select is(app.org_product_audience((select id from _o1)), 'engineer',
  'E8: the approved office stays fully usable while the other is pending');
select is((select count(*)::int from public.my_workspaces() where kind = 'business' and is_approved), 1,
  'E9: exactly one business is an approved workspace; audiences are never combined');
select is((select count(*)::int from public.my_workspaces() where kind = 'business'), 2,
  'E10: both are listed (the pending one so its owner can track it)');

-- ===========================================================================
-- F. Bypass attempts
-- ===========================================================================
select throws_ok(format($q$update public.organizations set status = 'active' where id = %L$q$, (select id from _o2)),
  '42501', null, 'F1: an owner cannot self-activate an organization');
select throws_ok(format($q$update public.organizations set is_verified = true where id = %L$q$, (select id from _o2)),
  '42501', null, 'F2: an owner cannot self-verify an organization');
select throws_ok(format($q$update public.organizations set org_type = 'contractor_company' where id = %L$q$, (select id from _o2)),
  '42501', null, 'F3: an owner cannot retype an organization to contractor_company');
select throws_ok($$ insert into public.organizations (name, org_type, status) values ('Mine', 'supplier', 'active') $$,
  '42501', null, 'F4: a client cannot insert an already-active organization');
select throws_ok(format($q$update public.verifications set status = 'approved' where id = %L$q$, (select id from _a1)),
  '42501', null, 'F5: a client cannot write verification decisions directly');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _a1)),
  '42501', null, 'F6: a non-admin cannot approve an application');
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Sneaky LLC', p_display_name => 'Sneaky', p_org_type => 'contractor_company') $$,
  '42501', 'this organization type cannot be self-assigned',
  'F7: a non-Contractor cannot apply for a contractor company');
select throws_ok(format($q$select public.organization_application_submit(%L)$q$, (select id from _o1)),
  '22023', null, 'F8: an already-approved organization cannot be resubmitted');

-- ===========================================================================
-- G. Contractor: individual persona -> contractor company, audience only once approved
-- ===========================================================================
set local request.jwt.claims = :'con';
select throws_ok($$ select public.business_draft_save(p_legal_name => 'Cheat LLC', p_display_name => 'Cheat', p_org_type => 'showroom_dealer') $$,
  '42501', 'a Contractor applies for a contractor organization',
  'G1: the Contractor persona cannot open any other kind of business');
select isnt(public.business_draft_save(p_legal_name => 'Horizon Contracting LLC', p_display_name => 'Horizon Contracting', p_org_type => 'contractor_company'), null,
  'G2: a Contractor can apply for a contractor company');
create temp table _o3 as
select public.business_draft_submit(
  (select id from public.business_creation_drafts
    where user_id = '76000002-0000-4000-8000-000000000076' and completed_at is null)) as id;
grant all on _o3 to authenticated;
select is((select org_type::text from public.organizations where id = (select id from _o3)), 'contractor_company',
  'G3: the application creates a contractor_company, pending');
select is(app.org_product_audience((select id from _o3)), null,
  'G4: a pending contractor company grants NO Contractor audience');
create temp table _a3 as select public.organization_application_submit((select id from _o3)) as id;
grant all on _a3 to authenticated;

set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _a3)), 'G5: reviewer claims it');
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _a3)), 'G6: reviewer approves it');
set local request.jwt.claims = :'con';
select is(app.org_product_audience((select id from _o3)), 'contractor',
  'G7: once approved, the contractor company carries the Contractor audience');

reset role;
select * from finish();
rollback;
