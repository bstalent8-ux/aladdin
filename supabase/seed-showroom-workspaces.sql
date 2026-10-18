-- Showroom suite workspace-switch fixtures (LOCAL, SYNTHETIC, MANUAL).
--
-- NOT listed in config.toml [db.seed].sql_paths on purpose: apply by hand to an
-- ISOLATED local stack only (never a shared stack, never staging/production):
--   psql "$ISOLATED_DB_URL" -f supabase/seed-showroom-workspaces.sql
--
-- Creates two users (password = the documented E2E password, see
-- frontend/e2e/helpers/auth.ts):
--   switch@example.test     owner of a showroom_dealer, a supplier and a
--                           design_office organization (canonical value behind
--                           the "المهندس" label) -> real multi-workspace switching
--                           and business-creation entitlement (org.manage on a
--                           showroom_dealer/supplier org).
--   ineligible@example.test member of a contractor_company only -> its active
--                           workspace is not eligible for the showroom suite.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, reauthentication_token, phone_change, phone_change_token)
values
  ('7a000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'switch@example.test', extensions.crypt('Zq9$Kx4#WmT7!Pn2Rb', extensions.gen_salt('bf')),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Switch Tester","locale":"en"}'::jsonb, now(), now(), now(), '', '', '', '', '', '', '', ''),
  ('7a000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ineligible@example.test', extensions.crypt('Zq9$Kx4#WmT7!Pn2Rb', extensions.gen_salt('bf')),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Ineligible Tester","locale":"en"}'::jsonb, now(), now(), now(), '', '', '', '', '', '', '', '');

update public.users set primary_account_type = null, status = 'active'
  where id in ('7a000001-0000-4000-8000-000000000001', '7a000002-0000-4000-8000-000000000002');
update public.profiles set display_name_ar = 'مختبر التبديل', display_name_en = 'Switch Tester'
  where user_id = '7a000001-0000-4000-8000-000000000001';

insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at) values
  ('7a000001-0000-4000-8000-000000000001', 'email', 'switch@example.test', true, true, now()),
  ('7a000002-0000-4000-8000-000000000002', 'email', 'ineligible@example.test', true, true, now());

insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by, name_ar, name_en) values
  ('7b000001-0000-4000-8000-000000000001', 'Switch Showroom', 'switch-showroom', 'showroom_dealer', 'active', false, 'en',
   '7a000001-0000-4000-8000-000000000001', 'معرض التبديل', 'Switch Showroom'),
  ('7b000002-0000-4000-8000-000000000002', 'Switch Supplier', 'switch-supplier', 'supplier', 'active', false, 'en',
   '7a000001-0000-4000-8000-000000000001', 'مورد التبديل', 'Switch Supplier'),
  ('7b000003-0000-4000-8000-000000000003', 'Switch Engineer Office', 'switch-engineer', 'design_office', 'active', false, 'en',
   '7a000001-0000-4000-8000-000000000001', 'مكتب مهندس التبديل', 'Switch Engineer Office'),
  ('7b000004-0000-4000-8000-000000000004', 'Ineligible Contracting', 'ineligible-contracting', 'contractor_company', 'active', false, 'en',
   '7a000002-0000-4000-8000-000000000002', null, null);

insert into public.branches (id, organization_id, name, is_active, name_ar, name_en, address_ar, address_en) values
  ('7c000001-0000-4000-8000-000000000001', '7b000001-0000-4000-8000-000000000001', 'Switch Showroom Main', true,
   'الفرع الرئيسي للمعرض', 'Showroom Main', 'التجمع الخامس، القاهرة', 'Fifth Settlement, Cairo'),
  ('7c000002-0000-4000-8000-000000000002', '7b000002-0000-4000-8000-000000000002', 'Switch Supplier Depot', true,
   'مخزن المورد', 'Supplier Depot', 'العاشر من رمضان', '10th of Ramadan'),
  ('7c000003-0000-4000-8000-000000000003', '7b000003-0000-4000-8000-000000000003', 'Switch Engineer HQ', true,
   'مقر المهندس', 'Engineer HQ', 'الدقي، الجيزة', 'Dokki, Giza'),
  ('7c000004-0000-4000-8000-000000000004', '7b000004-0000-4000-8000-000000000004', 'Ineligible HQ', true, null, null, null, null);

insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at) values
  ('7d000001-0000-4000-8000-000000000001', '7a000001-0000-4000-8000-000000000001', '7b000001-0000-4000-8000-000000000001', null, 'active', now()),
  ('7d000002-0000-4000-8000-000000000002', '7a000001-0000-4000-8000-000000000001', '7b000002-0000-4000-8000-000000000002', null, 'active', now()),
  ('7d000003-0000-4000-8000-000000000003', '7a000001-0000-4000-8000-000000000001', '7b000003-0000-4000-8000-000000000003', null, 'active', now()),
  ('7d000004-0000-4000-8000-000000000004', '7a000002-0000-4000-8000-000000000002', '7b000004-0000-4000-8000-000000000004', null, 'active', now());

insert into public.membership_capabilities (membership_id, capability_key)
select m.id, cap
from (values
  ('7d000001-0000-4000-8000-000000000001'::uuid),
  ('7d000002-0000-4000-8000-000000000002'::uuid),
  ('7d000003-0000-4000-8000-000000000003'::uuid),
  ('7d000004-0000-4000-8000-000000000004'::uuid)
) as m(id)
cross join unnest(array[
  'org.manage','org.members.manage','branch.manage',
  'catalog.read','catalog.write','catalog.publish',
  'rfq.create','rfq.respond','quote.submit','quote.decide',
  'order.create','order.manage','project.read','project.write',
  'sales.read','sales.write','sales.assign','sales.manage',
  'verification.submit','verification.read','activity.read'
]) as cap;

-- Optional, ISOLATED stacks only: let the seeded Cairo Ceramics Showroom owner
-- (hana@example.test, who holds the richest two-sided commerce data in
-- seed-pilot.sql) sign in with the documented E2E password, so the showroom
-- suite Home can be checked against real purchasing AND sales records.
update auth.users
   set encrypted_password = extensions.crypt('Zq9$Kx4#WmT7!Pn2Rb', extensions.gen_salt('bf'))
 where email = 'hana@example.test';

-- Consent, exactly as the sign-up flow records it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"7a000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');
set local request.jwt.claims = '{"sub":"7a000002-0000-4000-8000-000000000002","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');

commit;
