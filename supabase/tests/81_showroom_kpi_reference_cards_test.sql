-- pgTAP: the two reference Home cards the customization layer must be able to store (20261015090042).
create extension if not exists pgtap;

begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('81000001-0000-4000-8000-000000000081', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p81-1@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"P81 1","locale":"en"}'::jsonb, now(), now(), now()),
       ('81000002-0000-4000-8000-000000000081', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p81-2@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"P81 2","locale":"en"}'::jsonb, now(), now(), now());

\set u1 '{"sub":"81000001-0000-4000-8000-000000000081","role":"authenticated"}'
\set u2 '{"sub":"81000002-0000-4000-8000-000000000081","role":"authenticated"}'

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated;

select set_config('request.jwt.claims', :'u1', true);
insert into _ids select 'org', app.organization_create_owned('KPI Org', 'showroom_dealer', 'en', 'Main')::text;

set local role authenticated;
set local request.jwt.claims = :'u1';

select lives_ok(format($q$select public.dashboard_kpi_layout_set_personal(%L, array['total_purchases','orders_awaiting_execution','completed_orders','quotes_received','rfqs_sent']::public.dashboard_kpi_card_key[], 'showroom_suite')$q$,
  (select v from _ids where k = 'org')), 'KPI-1: the five reference cards can be saved as a personal layout');
select is((select card_order::text[] from public.dashboard_kpi_layouts where organization_id = (select v::uuid from _ids where k = 'org') and surface = 'showroom_suite' and membership_id is not null),
  array['total_purchases','orders_awaiting_execution','completed_orders','quotes_received','rfqs_sent'], 'KPI-2: and the order is persisted as chosen');
select lives_ok(format($q$select public.dashboard_kpi_layout_set_personal(%L, array['total_purchases','orders_awaiting_execution','completed_orders','quotes_received','rfqs_sent','customer_rfqs_received','customer_quotes_sent','total_sales','projects','saved_products','orders_in_progress']::public.dashboard_kpi_card_key[], 'showroom_suite')$q$,
  (select v from _ids where k = 'org')), 'KPI-3: all eleven offered cards fit');
select throws_ok(format($q$select public.dashboard_kpi_layout_set_personal(%L, array['completed_orders']::public.dashboard_kpi_card_key[], 'home')$q$,
  (select v from _ids where k = 'org')), '22023', null, 'KPI-4: the production Home surface does not accept the new cards');
select throws_ok(format($q$select public.dashboard_kpi_layout_set_personal(%L, array['completed_orders','completed_orders']::public.dashboard_kpi_card_key[], 'showroom_suite')$q$,
  (select v from _ids where k = 'org')), '22023', null, 'KPI-5: a repeated card is still refused');

-- a non-member cannot write a layout for the organization
set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.dashboard_kpi_layout_set_personal(%L, array['completed_orders']::public.dashboard_kpi_card_key[], 'showroom_suite')$q$,
  (select v from _ids where k = 'org')), '42501', null, 'KPI-6: a non-member cannot store a layout');
select throws_ok(format($q$select public.dashboard_kpi_layout_set_team_default(%L, array['completed_orders']::public.dashboard_kpi_card_key[], 'showroom_suite')$q$,
  (select v from _ids where k = 'org')), '42501', null, 'KPI-7: a non-member cannot set the team default');
reset role;
select is((select count(*)::int from public.dashboard_kpi_layouts where organization_id = (select v::uuid from _ids where k = 'org')), 1, 'KPI-8: exactly one layout row exists');

select * from finish();
rollback;
