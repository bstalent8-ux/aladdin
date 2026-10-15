-- pgTAP: showroom suite KPI layouts (20261007090001).
--
-- The claim under test: layouts are stored per SURFACE. The showroom suite's nine offered
-- cards live on surface 'showroom_suite', production Home's original eight on
-- 'home', and neither can ever hold the other's cards or overwrite the other's
-- row. Authorization is unchanged from 20260915090001 (ordinary member -> own
-- personal row only; team default needs org.manage; nothing crosses orgs).
--
-- Fixtures, from seed-pilot:
--   Hana    (70000001…001, membership 50000001…001) — org.manage on Cairo Ceramics (9c…001)
--   Youssef (70000002…002, membership 50000002…002) — ordinary member of Cairo Ceramics
--   Tarek   (70000003…003) — org.manage on a DIFFERENT org (9d…002)

create extension if not exists pgtap;

begin;
select plan(22);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';

-- A. The suite's own cards are accepted on its own surface.
select lives_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)',
    :'orgC', '{total_sales,customer_rfqs_received,rfqs_sent}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  'an ordinary member can save a showroom_suite layout with the suite-only cards'
);
select is(
  (select card_order from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid and surface = 'showroom_suite'
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  '{total_sales,customer_rfqs_received,rfqs_sent}'::public.dashboard_kpi_card_key[],
  'the suite order landed verbatim on the showroom_suite surface'
);

-- B. The same cards are refused on the production surface — in both directions.
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)',
    :'orgC', '{total_sales}'::public.dashboard_kpi_card_key[], 'home'),
  '22023', null,
  'a suite-only card is refused on the production home surface'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L)',
    :'orgC', '{rfqs_sent}'::public.dashboard_kpi_card_key[]),
  '22023', null,
  'the old two-argument call (default surface home) still refuses suite-only cards'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)',
    :'orgC', '{overdue_followups}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '22023', null,
  'a production-only card (overdue_followups) is refused on the suite surface'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)',
    :'orgC', '{total_sales}'::public.dashboard_kpi_card_key[], 'nonsense'),
  '22023', null,
  'an unknown surface is refused'
);

-- C. Bounds: the nine offered suite cards fit (the historical open_purchase_requests value stays valid in the enum, but the app never offers it); a repeat does not.
select lives_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)', :'orgC',
    '{rfqs_sent,quotes_received,orders_in_progress,total_purchases,customer_rfqs_received,customer_quotes_sent,total_sales,projects,saved_products}'::public.dashboard_kpi_card_key[],
    'showroom_suite'),
  'all nine suite cards can be saved'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)', :'orgC',
    '{total_sales,total_sales}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '22023', null,
  'a repeated card is refused on the suite surface'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)', :'orgC',
    '{}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '22023', null,
  'an empty layout is refused on the suite surface'
);

-- D. Surfaces never overwrite each other.
select lives_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L)',
    :'orgC', '{due_today,total_purchases}'::public.dashboard_kpi_card_key[]),
  'the same member can also save a production home layout'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  2, 'the member holds one personal row per surface'
);
select is(
  (select card_order from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid and surface = 'home'
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  '{due_today,total_purchases}'::public.dashboard_kpi_card_key[],
  'saving the suite layout did not touch the home layout'
);
select lives_ok(
  format('select public.dashboard_kpi_layout_reset_personal(%L, %L)', :'orgC', 'showroom_suite'),
  'resetting the suite layout works'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid and surface = 'home'),
  1, 'resetting the suite layout left the home layout in place'
);

-- E. Team default: needs org.manage, per surface.
select throws_ok(
  format('select public.dashboard_kpi_layout_set_team_default(%L, %L, %L)',
    :'orgC', '{total_sales}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '42501', null,
  'an ordinary member cannot set the suite team default'
);

set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  format('select public.dashboard_kpi_layout_set_team_default(%L, %L, %L)',
    :'orgC', '{total_sales,total_purchases}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  'an org.manage owner can set the suite team default'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid and membership_id is null),
  1, 'the team default is stored once, on its own surface (no home team row was created)'
);

-- F. Tenancy.
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)',
    :'orgC', '{total_sales}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '42501', null,
  'a member of ANOTHER organization cannot write a suite layout here'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_team_default(%L, %L, %L)',
    :'orgC', '{total_sales}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '42501', null,
  'an org.manage owner of ANOTHER organization cannot set this organization''s suite default'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts where organization_id = :'orgC'::uuid),
  0, 'another organization''s member cannot even read these layouts (RLS)'
);

-- G. RLS: a member reads the team default and their own row only.
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid and membership_id = '50000001-0000-4000-8000-000000000001'::uuid),
  0, 'Youssef cannot read Hana''s personal rows'
);

-- H. Anonymous callers have no access.
reset role;
set local role anon;
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L, %L)',
    :'orgC', '{total_sales}'::public.dashboard_kpi_card_key[], 'showroom_suite'),
  '42501', null,
  'anon cannot call the layout RPC'
);

select * from finish();
rollback;
