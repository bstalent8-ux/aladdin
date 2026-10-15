-- Synthetic accounts only; every change rolls back. No hosted database.
create extension if not exists pgtap;
begin;
select no_plan();

select ok(not has_function_privilege('anon', 'public.phone_auth_consume_limit(text,text,text)', 'execute'), 'anonymous callers cannot consume/reset throttles');
select ok(not has_function_privilege('authenticated', 'public.phone_auth_consume_limit(text,text,text)', 'execute'), 'authenticated callers cannot reset throttles');
select ok(has_function_privilege('service_role', 'public.phone_auth_consume_limit(text,text,text)', 'execute'), 'only trusted server may consume throttle');
select ok(not has_table_privilege('authenticated', 'app.phone_auth_attempts', 'select'), 'bucket hashes are private');
select ok(not has_table_privilege('anon', 'app.phone_auth_attempts', 'insert'), 'anonymous direct bucket writes denied');
select ok((select relrowsecurity from pg_class where oid = 'app.phone_auth_attempts'::regclass), 'private buckets also have RLS');
select ok(not has_function_privilege('anon', 'public.phone_password_account_allowed(text,text)', 'execute'), 'anonymous account authorization denied');

set local role service_role;
select ok(public.phone_auth_consume_limit('sign-in', repeat('a',64), repeat('b',64)), 'first login allowed');
select public.phone_auth_consume_limit('sign-in', repeat('a',64), repeat('b',64)) from generate_series(1,9);
select ok(not public.phone_auth_consume_limit('sign-in', repeat('c',64), repeat('b',64)), 'eleventh account attempt denied even from a different IP');
select public.phone_auth_consume_limit('sign-in', repeat('d',64), lpad(to_hex(i),64,'0')) from generate_series(1,30) i;
select ok(not public.phone_auth_consume_limit('sign-in', repeat('d',64), repeat('e',64)), 'IP limit bounds credential stuffing across numbers');
select public.phone_auth_consume_limit('sign-up', repeat('f',64), repeat('e',64)) from generate_series(1,5);
select ok(not public.phone_auth_consume_limit('sign-up', repeat('a',64), repeat('e',64)), 'registration has its own stricter phone limit');
select throws_ok($$select public.phone_auth_consume_limit('invalid','x','y')$$, '22023', null, 'rejects malformed throttle input');
reset role;
update app.phone_auth_attempts set window_start = now() - interval '16 minutes';
set local role service_role;
select ok(public.phone_auth_consume_limit('sign-in', repeat('a',64), repeat('b',64)), 'window expires and allows recovery');
reset role;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
 ('90000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p201093810001@craftsman-login.aladdin.invalid','{"provider":"email","providers":["email"]}','{"role":"admin","approved":true}',now(),now(),now()),
 ('90000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p201093810002@craftsman-login.aladdin.invalid','{"provider":"email","providers":["email"]}','{}',now(),now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar')$$, 'shared consents');
select lives_ok($$select public.onboarding_select_account_type('business','showroom_dealer')$$, 'showroom intent');
select lives_ok($$select public.profile_set_phone('EG','1093810001','+201093810001')$$, 'claims canonical phone through authenticated RPC');
select lives_ok($$select public.profile_set_username('showroom.security90')$$, 'normal username claim');
select is(public.my_registration_state(), 'access_ready', 'normal registration gate satisfied');
select ok(public.phone_password_account_allowed('showroom','+201093810001'), 'first-business showroom intent allowed');
select ok(not public.phone_password_account_allowed('installer','+201093810001'), 'showroom cannot enter installer flow');
select ok(not public.phone_password_account_allowed('showroom','+201093810002'), 'cannot assert another phone');
select ok(not public.phone_password_account_allowed('admin','+201093810001'), 'client account type cannot grant admin');
select throws_ok($$select public.profile_set_phone('EG','1093810003','+201093810003')$$,'42501',null,'cannot free the alias-owned number by editing profile');
select throws_ok($$select public.profile_set_phone(null,null,null)$$,'42501',null,'cannot clear the alias-owned number');
select throws_ok($$update public.users set primary_account_type = 'engineer' where id = '90000000-0000-4000-8000-000000000001'$$, '42501', null, 'direct persona update denied');
select throws_ok($$update public.users set status = 'active' where id = '90000000-0000-4000-8000-000000000001'$$, '42501', null, 'direct activation denied');
select throws_ok($$select public.onboarding_select_account_type('professional','admin')$$,'22023',null,'invalid privileged selection refused');
reset role;
select is((select phone_confirmed_at from auth.users where id='90000000-0000-4000-8000-000000000001'),null::timestamptz,'phone was NEVER marked verified');
select is((select status::text from public.users where id='90000000-0000-4000-8000-000000000001'),'pending_verification','no account activation');
select is((select primary_account_type::text from public.users where id='90000000-0000-4000-8000-000000000001'),null::text,'no trust-reviewed persona');
select is((select count(*)::int from public.memberships where user_id='90000000-0000-4000-8000-000000000001'),0,'no membership grant');
select is((select count(*)::int from public.platform_role_grants where user_id='90000000-0000-4000-8000-000000000001'),0,'no platform role grant from malicious user_metadata');
select is((select count(*)::int from public.organizations where created_by='90000000-0000-4000-8000-000000000001'),0,'no organization or approval created');

set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar');
select public.onboarding_select_account_type('professional','installer_technician');
select public.profile_set_phone('EG','1093810002','+201093810002');
select public.profile_set_username('installer.security90');
select ok(public.phone_password_account_allowed('installer','+201093810002'), 'existing installer identity remains permitted');
select ok(not public.phone_password_account_allowed('showroom','+201093810002'), 'installer cannot enter showroom flow');
select public.onboarding_select_account_type('business','showroom_dealer');
select ok(not public.phone_password_account_allowed('showroom','+201093810002'), 'forged business intent cannot bypass an established installer persona');
select is((select count(*)::int from public.profiles where user_id='90000000-0000-4000-8000-000000000001'),0,'RLS hides another caller profile');
reset role;
-- Compensation must work AFTER initialization wrote immutable audit events.
select set_config('test.audit_id', (select id::text from public.audit_log where actor_user_id='90000000-0000-4000-8000-000000000001' limit 1), true);
select throws_ok($$update public.audit_log set actor_user_id=null where actor_user_id='90000000-0000-4000-8000-000000000001'$$, 'P0001', null, 'even privileged direct actor rewriting remains denied');
select lives_ok($$delete from auth.users where id='90000000-0000-4000-8000-000000000001'$$,'registration compensation can delete an audited new user');
select is((select actor_user_id from public.audit_log where id=current_setting('test.audit_id')::uuid),null::uuid,'audit event is preserved, actor becomes null through FK only');
select * from finish();
rollback;
