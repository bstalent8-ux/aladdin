-- Synthetic accounts only; every change rolls back. No hosted database.
create extension if not exists pgtap;
begin;
select no_plan();

select ok(not has_function_privilege('anon', 'public.account_entry_allowed(text)', 'execute'), 'anonymous account-entry check denied');
select ok(has_function_privilege('authenticated', 'public.account_entry_allowed(text)', 'execute'), 'signed-in callers may check their own account');

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
 ('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','showroom91@example.test','{"provider":"google","providers":["google"]}','{"full_name":"Showroom Ninety"}',now(),now(),now()),
 ('91000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','installer91@example.test','{"provider":"email","providers":["email"]}','{}',now(),now(),now()),
 ('91000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fresh91@example.test','{"provider":"facebook","providers":["facebook"]}','{}',now(),now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar');
select public.onboarding_select_account_type('business','showroom_dealer');
select public.profile_set_username('showroom.entry91');
select ok(public.account_entry_allowed('showroom'), 'showroom email/OAuth account may enter the showroom pages');
select ok(not public.account_entry_allowed('installer'), 'showroom account cannot enter the installer pages');
select ok(not public.account_entry_allowed('admin'), 'an unknown kind never grants entry');
select ok(not public.account_entry_allowed(null), 'a missing kind never grants entry');

set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar');
select public.onboarding_select_account_type('professional','installer_technician');
select public.profile_set_username('craftsman.entry91');
select ok(public.account_entry_allowed('installer'), 'installer email/OAuth account may enter the installer pages');
select ok(not public.account_entry_allowed('showroom'), 'installer account cannot enter the showroom pages');
select public.onboarding_select_account_type('business','showroom_dealer');
select ok(not public.account_entry_allowed('showroom'), 'forged business intent cannot bypass an established installer persona');

set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}';
select ok(not public.account_entry_allowed('showroom'), 'a brand-new account with no type is not a showroom account');
select ok(not public.account_entry_allowed('installer'), 'a brand-new account with no type is not an installer account');
select is(public.my_registration_state(), 'consent_pending', 'a new OAuth account starts at the consent step');
reset role;

select * from finish();
rollback;
