-- pgTAP: no historical Business draft loses its saved location (20261011090002, app.legacy_business_city).
--
-- The OLD Business wizard stored values from the 4-governorate persona vocabulary (underscore keys). The location rule now
-- validates against the Egypt catalogue, so EVERY value the old wizard could store needs an explicit compatibility outcome:
--   A. it maps cleanly to a catalogue city of the same governorate  -> that city key;
--   B. it is a valid place the catalogue does not list there         -> kept as the person's own typed city (never emptied).
-- This file pins all 15 values, then proves a legacy draft still completes and the branch receives the right location.
create extension if not exists pgtap;

begin;
select plan(23);

-- ---------------------------------------------------------------------------
-- The map covers exactly the 15 values, and each has an outcome (never both empty)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from app.legacy_business_city('cairo', 'nasr_city')), 1, 'the legacy map answers for a legacy value');
select is((select count(*)::int from (values
    ('cairo','nasr_city'),('cairo','new_cairo'),('cairo','maadi'),('cairo','heliopolis'),('cairo','downtown'),
    ('giza','sheikh_zayed'),('giza','dokki'),('giza','mohandessin'),('giza','october_6'),
    ('alexandria','smouha'),('alexandria','miami'),('alexandria','sidi_gaber'),
    ('qalyubia','shibin'),('qalyubia','banha'),('qalyubia','qalyub')) v(g, c)
   where exists (select 1 from app.legacy_business_city(v.g, v.c))), 15,
  'all 15 values the old wizard offered have an explicit outcome');
select is((select count(*)::int from (values
    ('cairo','nasr_city'),('cairo','new_cairo'),('cairo','maadi'),('cairo','heliopolis'),('cairo','downtown'),
    ('giza','sheikh_zayed'),('giza','dokki'),('giza','mohandessin'),('giza','october_6'),
    ('alexandria','smouha'),('alexandria','miami'),('alexandria','sidi_gaber'),
    ('qalyubia','shibin'),('qalyubia','banha'),('qalyubia','qalyub')) v(g, c)
   cross join lateral app.normalize_business_location(v.g, v.c, null, true) n
   where n.o_city is null and n.o_custom is null), 0,
  'NO historical value normalises to an empty location');

-- ---------------------------------------------------------------------------
-- Table-driven: the exact outcome of every value
-- ---------------------------------------------------------------------------
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('cairo','nasr_city',null,true)), 'cairo|nasr-city|NULL', 'cairo / nasr_city -> nasr-city');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('cairo','new_cairo',null,true)), 'cairo|new-cairo|NULL', 'cairo / new_cairo -> new-cairo');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('cairo','maadi',null,true)), 'cairo|maadi|NULL', 'cairo / maadi -> maadi');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('cairo','heliopolis',null,true)), 'cairo|heliopolis|NULL', 'cairo / heliopolis -> heliopolis');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('cairo','downtown',null,true)), 'cairo|downtown|NULL', 'cairo / downtown -> downtown');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('giza','sheikh_zayed',null,true)), 'giza|sheikh-zayed|NULL', 'giza / sheikh_zayed -> sheikh-zayed');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('giza','dokki',null,true)), 'giza|dokki|NULL', 'giza / dokki -> dokki');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('giza','mohandessin',null,true)), 'giza|mohandessin|NULL', 'giza / mohandessin -> mohandessin');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('giza','october_6',null,true)), 'giza|october-6|NULL', 'giza / october_6 -> october-6');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('alexandria','smouha',null,true)), 'alexandria|NULL|Smouha', 'alexandria / smouha -> kept as the typed city "Smouha"');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('alexandria','miami',null,true)), 'alexandria|NULL|Miami', 'alexandria / miami -> kept as the typed city "Miami"');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('alexandria','sidi_gaber',null,true)), 'alexandria|sidi-jabir|NULL', 'alexandria / sidi_gaber -> sidi-jabir (the same place)');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('qalyubia','shibin',null,true)), 'qalyubia|NULL|Shibin El Kom', 'qalyubia / shibin ("Shibin El Kom", a Monufia city) -> kept as typed text, NOT mapped onto a Qalyubia city');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('qalyubia','banha',null,true)), 'qalyubia|banha|NULL', 'qalyubia / banha -> banha');
select is((select o_governorate||'|'||coalesce(o_city,'NULL')||'|'||coalesce(o_custom,'NULL') from app.normalize_business_location('qalyubia','qalyub',null,true)), 'qalyubia|qalyub|NULL', 'qalyubia / qalyub -> qalyub');

-- An arbitrary unknown city is still refused (it can only come from a direct RPC, never from the old wizard).
select throws_ok($$ select * from app.normalize_business_location('cairo', 'not-a-city', null, true) $$, '22023', null,
  'an unknown city (not a historical value) is still rejected');

-- ---------------------------------------------------------------------------
-- End to end: a LEGACY draft completes, and the primary branch receives the right location
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('88' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000088')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p88-' || n || '@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P88 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 3) n;
insert into public.onboarding_progress (user_id, selected_track, selected_org_type, account_type_completed_at, completed_at)
values ('88000001-0000-4000-8000-000000000088', 'business', 'supplier', now(), now()),
       ('88000002-0000-4000-8000-000000000088', 'business', 'supplier', now(), now()),
       ('88000003-0000-4000-8000-000000000088', 'business', 'supplier', now(), now());
insert into public.business_creation_drafts (id, user_id, legal_name, display_name, org_type, governorate, city)
values ('88d00001-0000-4000-8000-000000000088', '88000001-0000-4000-8000-000000000088', 'Smouha Legacy LLC', 'Smouha Legacy', 'supplier', 'alexandria', 'smouha'),
       ('88d00002-0000-4000-8000-000000000088', '88000002-0000-4000-8000-000000000088', 'Gaber Legacy LLC', 'Gaber Legacy', 'supplier', 'alexandria', 'sidi_gaber'),
       ('88d00003-0000-4000-8000-000000000088', '88000003-0000-4000-8000-000000000088', 'Shibin Legacy LLC', 'Shibin Legacy', 'supplier', 'qalyubia', 'shibin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"88000001-0000-4000-8000-000000000088","role":"authenticated"}';
select lives_ok($$ select public.business_draft_submit('88d00001-0000-4000-8000-000000000088') $$, 'a legacy draft (alexandria / smouha) completes without re-entry');
set local request.jwt.claims = '{"sub":"88000002-0000-4000-8000-000000000088","role":"authenticated"}';
select lives_ok($$ select public.business_draft_submit('88d00002-0000-4000-8000-000000000088') $$, 'a legacy draft (alexandria / sidi_gaber) completes without re-entry');
set local request.jwt.claims = '{"sub":"88000003-0000-4000-8000-000000000088","role":"authenticated"}';
select lives_ok($$ select public.business_draft_submit('88d00003-0000-4000-8000-000000000088') $$, 'a legacy draft (qalyubia / shibin) completes without re-entry');

reset role;
select is((select string_agg(b.governorate_key || '|' || coalesce(b.city_key, 'NULL') || '|' || coalesce(b.city_custom_name, 'NULL'), ' ; ' order by o.created_by)
             from public.branches b join public.organizations o on o.id = b.organization_id
            where o.created_by in ('88000001-0000-4000-8000-000000000088', '88000002-0000-4000-8000-000000000088', '88000003-0000-4000-8000-000000000088')),
  'alexandria|NULL|Smouha ; alexandria|sidi-jabir|NULL ; qalyubia|NULL|Shibin El Kom',
  'the primary branches received the converted legacy locations (typed city / canonical city / typed city)');

select * from finish();
rollback;
