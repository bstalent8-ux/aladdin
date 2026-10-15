-- pgTAP: organization Business Description + 250-character rule (20261015090044).
-- Claims: 250 characters (Arabic, emoji, CRLF counted once) are accepted and 251 rejected; only a live org.manage
-- holder can write the organization description; no direct client UPDATE; registration carries the draft
-- description to the organization (not truncated, not lost); the bio/portfolio/draft write paths reject instead of
-- truncating; a legacy over-limit value is neither cut nor blocks an unrelated edit; nothing public carries it.
create extension if not exists pgtap;

begin;
select plan(37);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('84' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000084')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p84-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P84 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 5) n;

-- 1 manager of org A   2 plain member of A   3 manager of org B   4 outsider   5 first-business registrant
\set u1 '{"sub":"84000001-0000-4000-8000-000000000084","role":"authenticated"}'
\set u2 '{"sub":"84000002-0000-4000-8000-000000000084","role":"authenticated"}'
\set u3 '{"sub":"84000003-0000-4000-8000-000000000084","role":"authenticated"}'
\set u4 '{"sub":"84000004-0000-4000-8000-000000000084","role":"authenticated"}'
\set u5 '{"sub":"84000005-0000-4000-8000-000000000084","role":"authenticated"}'

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated, anon;

select set_config('request.jwt.claims', :'u1', true);
insert into _ids select 'orgA', app.organization_create_owned('Desc Org A', 'showroom_dealer', 'en', 'Main')::text;
select set_config('request.jwt.claims', :'u3', true);
insert into _ids select 'orgB', app.organization_create_owned('Desc Org B', 'showroom_dealer', 'en', 'Main')::text;
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('84000002-0000-4000-8000-000000000084', (select v::uuid from _ids where k = 'orgA'), 'active', now());
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values ('84000005-0000-4000-8000-000000000084', 'business', 'supplier', now(), now());

set local role authenticated;
set local request.jwt.claims = :'u1';

-- 1. the limit, in characters --------------------------------------------------------------------------------
select is(char_length(public.organization_description_set((select v::uuid from _ids where k = 'orgA'), repeat('a', 250))), 250,
  'D-1: 250 Latin characters are accepted');
select throws_ok(format($q$select public.organization_description_set(%L, %L)$q$, (select v from _ids where k = 'orgA'), repeat('a', 251)),
  '22023', null, 'D-2: 251 characters are rejected');
select is(char_length(public.organization_description_set((select v::uuid from _ids where k = 'orgA'), repeat('ع', 250))), 250,
  'D-3: 250 Arabic characters are accepted (one character each, not bytes)');
select throws_ok(format($q$select public.organization_description_set(%L, %L)$q$, (select v from _ids where k = 'orgA'), repeat('ع', 251)),
  '22023', null, 'D-4: 251 Arabic characters are rejected');
select is(char_length(public.organization_description_set((select v::uuid from _ids where k = 'orgA'), repeat('😀', 250))), 250,
  'D-5: 250 emoji are accepted (one code point each)');
select throws_ok(format($q$select public.organization_description_set(%L, %L)$q$, (select v from _ids where k = 'orgA'), repeat('😀', 251)),
  '22023', null, 'D-6: 251 emoji are rejected');
select is(char_length(public.organization_description_set((select v::uuid from _ids where k = 'orgA'),
    repeat('a', 125) || E'\r\n' || repeat('b', 124))), 250,
  'D-7: a CRLF line break counts once, exactly like the browser counter');

-- 2. what a failed save leaves behind ------------------------------------------------------------------------
select is((select description from public.organizations where id = (select v::uuid from _ids where k = 'orgA')),
  repeat('a', 125) || E'\n' || repeat('b', 124), 'D-8: a rejected save changed nothing; the stored line break is normalised to LF');
select is(public.organization_description_set((select v::uuid from _ids where k = 'orgA'), E'  \n '), null,
  'D-9: whitespace-only clears the description (stored as null, not an empty string)');

-- 3. who can write -------------------------------------------------------------------------------------------
set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.organization_description_set(%L, 'x')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'D-10: a plain member cannot write the description');
set local request.jwt.claims = :'u3';
select throws_ok(format($q$select public.organization_description_set(%L, 'x')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'D-11: another organization''s manager cannot write it');
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.organization_description_set(%L, 'x')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'D-12: an outsider cannot write it');
set local role anon;
select throws_ok(format($q$select public.organization_description_set(%L, 'x')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'D-13: anon cannot call the writer');
set local role authenticated;
set local request.jwt.claims = :'u1';
select throws_ok(format($q$update public.organizations set description = 'direct' where id = %L$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'D-14: the manager cannot UPDATE the column directly (the RPC is the only path)');

-- 4. who can read, and what is never public ------------------------------------------------------------------
select public.organization_description_set((select v::uuid from _ids where k = 'orgA'), 'سجاد وأرضيات');
set local request.jwt.claims = :'u2';
select is((select description from public.organizations where id = (select v::uuid from _ids where k = 'orgA')), 'سجاد وأرضيات',
  'D-15: a member reads it');
set local request.jwt.claims = :'u3';
select is((select count(*)::int from public.organizations where id = (select v::uuid from _ids where k = 'orgA')), 0,
  'D-16: another organization cannot read the row at all');
reset role;
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and column_name = 'description'
              and table_name in ('organization_public_directory', 'catalog_products', 'profile_public_directory')), 0,
  'D-17: no public directory/catalog view exposes the organization description');
select is((select count(*)::int from public.audit_log where action = 'organization.description_changed'
            and organization_id = (select v::uuid from _ids where k = 'orgA')), 6,
  'D-18: each effective change is audited once (the no-op and rejected saves are not)');

-- 5. registration: the draft description reaches the organization --------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'u5';
select throws_ok($q$select public.business_draft_save(p_display_name => 'Reg Co', p_org_type => 'supplier', p_description => repeat('x', 251))$q$,
  '22023', null, 'D-19: the registration draft rejects 251 characters instead of truncating');
select lives_ok($q$select public.business_draft_save(p_display_name => 'Reg Co', p_org_type => 'supplier', p_description => repeat('ي', 250))$q$,
  'D-20: the registration draft accepts 250 characters');
insert into _ids select 'regOrg', public.business_draft_submit(null)::text;
reset role;
select is((select description from public.organizations where id = (select v::uuid from _ids where k = 'regOrg')), repeat('ي', 250),
  'D-21: submitting the draft stores the description on the ORGANIZATION (Settings and registration share one field)');
select is((select count(*)::int from public.profiles where bio = repeat('ي', 250)), 0,
  'D-22: it is not copied onto the creator''s personal profile');

-- 6. personal bio and portfolio: reject, never truncate -------------------------------------------------------
update public.users set primary_account_type = 'installer_technician' where id = '84000001-0000-4000-8000-000000000084';
set local role authenticated;
set local request.jwt.claims = :'u1';
select throws_ok($q$update public.profiles set bio = repeat('b', 251) where user_id = '84000001-0000-4000-8000-000000000084'$q$,
  '22023', null, 'D-23: a direct 251-character bio write is rejected by the database');
select lives_ok($q$update public.profiles set bio = repeat('b', 250) where user_id = '84000001-0000-4000-8000-000000000084'$q$,
  'D-24: a direct 250-character bio write is accepted');
select throws_ok($q$select public.portfolio_item_create('t', repeat('p', 251), 'image/png')$q$,
  '22023', null, 'D-25: a 251-character portfolio description is rejected');

-- 7. legacy rows: nothing is cut, unrelated edits keep working -----------------------------------------------
reset role;
alter table public.profiles disable trigger profiles_description_limit;
update public.profiles set bio = repeat('L', 400) where user_id = '84000001-0000-4000-8000-000000000084';
alter table public.profiles enable trigger profiles_description_limit;
set local role authenticated;
set local request.jwt.claims = :'u1';
select lives_ok($q$update public.profiles set headline = 'new headline' where user_id = '84000001-0000-4000-8000-000000000084'$q$,
  'D-26: an unrelated edit of a row holding a legacy over-limit bio still works');
select is((select char_length(bio) from public.profiles where user_id = '84000001-0000-4000-8000-000000000084'), 400,
  'D-27: the legacy text was not truncated');
select throws_ok($q$update public.profiles set bio = repeat('M', 400) where user_id = '84000001-0000-4000-8000-000000000084'$q$,
  '22023', null, 'D-28: but changing it to another over-limit text is rejected');
select lives_ok($q$update public.profiles set bio = repeat('M', 100) where user_id = '84000001-0000-4000-8000-000000000084'$q$,
  'D-29: shortening it is accepted');
-- the write RPCs follow the same rule: an UNCHANGED legacy text is accepted, a changed over-limit one is not
reset role;
alter table public.profiles disable trigger profiles_description_limit;
update public.profiles set bio = repeat('L', 400) where user_id = '84000001-0000-4000-8000-000000000084';
alter table public.profiles enable trigger profiles_description_limit;
set local role authenticated;
set local request.jwt.claims = :'u1';
select lives_ok($q$select public.individual_save_professional('installer_technician', p_headline => 'h', p_bio => repeat('L', 400))$q$,
  'D-31: saving the professional profile with an unchanged legacy over-limit bio works');
select is((select char_length(bio) from public.profiles where user_id = '84000001-0000-4000-8000-000000000084'), 400,
  'D-32: the legacy bio survived that save untouched');
select throws_ok($q$select public.individual_save_professional('installer_technician', p_headline => 'h', p_bio => repeat('N', 400))$q$,
  '22023', null, 'D-33: a different over-limit bio is rejected by the RPC (not truncated)');

insert into _ids select 'item', (select item_id::text from public.portfolio_item_create('legacy', 'short', 'image/png') limit 1);
reset role;
alter table public.portfolio_items disable trigger portfolio_items_description_limit;
update public.portfolio_items set description = repeat('P', 400) where id = (select v::uuid from _ids where k = 'item');
alter table public.portfolio_items enable trigger portfolio_items_description_limit;
set local role authenticated;
set local request.jwt.claims = :'u1';
select lives_ok(format($q$select public.portfolio_item_update(%L, 'renamed', %L)$q$, (select v from _ids where k = 'item'), repeat('P', 400)),
  'D-34: renaming a portfolio item that holds an unchanged legacy description works');
select throws_ok(format($q$select public.portfolio_item_update(%L, 'renamed', %L)$q$, (select v from _ids where k = 'item'), repeat('Q', 400)),
  '22023', null, 'D-35: changing it to another over-limit text is rejected');
select is((select char_length(description) from public.portfolio_items where id = (select v::uuid from _ids where k = 'item')), 400,
  'D-36: the legacy portfolio description was not truncated');
reset role;
select is((select count(*)::int from pg_trigger where tgname like '%\_description\_limit' and not tgisinternal), 6,
  'D-30: the direct-write safeguard exists on bio, portfolio, draft, onboarding, product and offer descriptions');

-- The caller-run trigger could not reach its own helper: with the plan warmed by an earlier superuser statement (as in
-- this file) the direct writes above pass, but a fresh PostgREST connection failed every direct bio write with
-- 42501 "permission denied for function description_norm". Pin the property that fixes it, independent of plan caching.
select is((select prosecdef from pg_proc where oid = 'app.enforce_description_limit()'::regprocedure), true,
  'D-37: the limit trigger runs as its owner, so a direct client write reaches the 250-character rule instead of a permission error');

select * from finish();
rollback;
