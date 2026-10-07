-- pgTAP: showroom suite Home metrics (20261007090002).
--
-- The claims under test:
--   * DIRECTION — purchasing cards count the organization as REQUESTER, sales
--     cards count it as SUPPLIER; the two never share a source.
--   * PERIOD — period cards honour the resolved window, "now" cards ignore it.
--   * TENANCY — a caller only ever gets their own organization's figures, a
--     non-member is refused, and the function is SECURITY INVOKER so it can
--     never see more than the caller's own RLS allows.
--   * DEFINITIONS — each figure equals an independent query over the same views.
--
-- Fixtures, from seed-pilot (Cairo Ceramics Showroom buys AND sells):
--   Hana  (70000001…001) org.manage on Cairo Ceramics (9c…001)
--   Tarek (70000003…003) org.manage on Egypt Marble Manufacturing (9d…002)

create extension if not exists pgtap;

begin;
select plan(23);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';

create temp table m on commit drop as
  select public.showroom_home_metrics(:'orgC'::uuid, '2000-01-01', '2100-01-01', 'Africa/Cairo') as j;
grant select on m to authenticated;

-- A. Shape + definitions, equal to independent queries (full-history window).
select is(
  (select count(*)::int from jsonb_object_keys((select j from m))), 10,
  'the RPC returns exactly the ten documented figures'
);
select is((select (j->>'open_purchase_requests')::int from m),
  (select count(*)::int from public.rfq_list where requester_org_id = :'orgC'::uuid and status in ('submitted','quoted')),
  'open_purchase_requests = RFQs the org raised that are submitted/quoted');
select is((select (j->>'rfqs_sent')::int from m),
  (select count(*)::int from public.rfq_list where requester_org_id = :'orgC'::uuid and status in ('submitted','quoted','closed')),
  'rfqs_sent = RFQs the org sent (requester side, not draft/cancelled)');
select is((select (j->>'quotes_received')::int from m),
  (select count(*)::int from public.quotation_list where requester_org_id = :'orgC'::uuid and status <> 'draft'),
  'quotes_received = quotations on the org''s own RFQs (requester side)');
select is((select (j->>'purchase_orders_active')::int from m),
  (select count(*)::int from public.order_list where requester_org_id = :'orgC'::uuid and status in ('confirmed','in_progress')),
  'purchase_orders_active = requester-side confirmed/in-progress orders');
select is((select (j->>'total_purchases')::numeric from m),
  (select coalesce(sum(total),0) from public.order_list where requester_org_id = :'orgC'::uuid and status <> 'cancelled'),
  'total_purchases = requester-side non-cancelled order value');
select is((select (j->>'customer_rfqs_received')::int from m),
  (select count(*)::int from public.rfq_list where supplier_org_id = :'orgC'::uuid and status <> 'draft'),
  'customer_rfqs_received = RFQs addressed TO the org (supplier side)');
select is((select (j->>'customer_quotes_sent')::int from m),
  (select count(*)::int from public.quotation_list where supplier_org_id = :'orgC'::uuid and status <> 'draft'),
  'customer_quotes_sent = quotations the org sent as supplier');
select is((select (j->>'total_sales')::numeric from m),
  (select coalesce(sum(total),0) from public.order_list where supplier_org_id = :'orgC'::uuid and status <> 'cancelled'),
  'total_sales = supplier-side non-cancelled order value');
select is((select (j->>'active_projects')::int from m),
  (select count(*)::int from public.project_list
    where (requester_org_id = :'orgC'::uuid or executing_org_id = :'orgC'::uuid) and status = 'active'),
  'active_projects = active projects the org requested or executes');
select is((select (j->>'saved_products')::int from m),
  (select count(*)::int from public.saved_product_list where organization_id = :'orgC'::uuid),
  'saved_products = the org''s own shortlist');

-- B. Direction really differs: the purchasing and sales sides are not the same data.
select isnt((select (j->>'total_purchases')::numeric from m), (select (j->>'total_sales')::numeric from m),
  'purchasing value and sales value are different figures for a two-sided showroom');
select isnt((select (j->>'rfqs_sent')::int from m), (select (j->>'customer_rfqs_received')::int from m),
  'RFQs sent and customer RFQs received are different figures');

-- C. Period: a window with no records zeroes the period cards, never the "now" cards.
select is(
  (select (public.showroom_home_metrics(:'orgC'::uuid, '2000-01-01', '2000-01-02')->>'rfqs_sent')::int), 0,
  'a window before any record has zero rfqs_sent');
select is(
  (select (public.showroom_home_metrics(:'orgC'::uuid, '2000-01-01', '2000-01-02')->>'total_sales')::numeric), 0::numeric,
  'a window before any record has zero total_sales');
select is(
  (select (public.showroom_home_metrics(:'orgC'::uuid, '2000-01-01', '2000-01-02')->>'open_purchase_requests')::int),
  (select (j->>'open_purchase_requests')::int from m),
  'a "now" card ignores the period');
select cmp_ok(
  (select (public.showroom_home_metrics(:'orgC'::uuid, current_date - 7, current_date)->>'rfqs_sent')::int),
  '<=', (select (j->>'rfqs_sent')::int from m),
  'a narrower window never counts more than the full history');

-- D. Tenancy: another organization's owner sees only their own figures ...
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select (public.showroom_home_metrics(:'orgM'::uuid, '2000-01-01', '2100-01-01')->>'customer_rfqs_received')::int),
  (select count(*)::int from public.rfq_list where supplier_org_id = :'orgM'::uuid and status <> 'draft'),
  'Tarek''s figures equal HIS organization''s own records');
select is(
  (select (public.showroom_home_metrics(:'orgM'::uuid, '2000-01-01', '2100-01-01')->>'total_sales')::numeric),
  (select coalesce(sum(total),0) from public.order_list where supplier_org_id = :'orgM'::uuid and status <> 'cancelled'),
  'Tarek''s sales value equals his own supplier-side orders only');
-- ... and is refused outright for a foreign organization.
select throws_ok(
  format('select public.showroom_home_metrics(%L, %L, %L)', :'orgC', '2000-01-01', '2100-01-01'),
  '42501', null,
  'a non-member cannot read another organization''s metrics');

-- E. Input validation.
select throws_ok(
  format('select public.showroom_home_metrics(%L, %L, %L)', :'orgM', '2026-02-01', '2026-01-01'),
  '22023', null,
  'an inverted period is refused');
select throws_ok(
  format('select public.showroom_home_metrics(%L, %L, %L, %L)', :'orgM', '2026-01-01', '2026-02-01', 'Mars/Olympus'),
  null, null,
  'an unknown timezone is refused rather than silently using UTC');

-- F. Anonymous callers have no access.
reset role;
set local role anon;
select throws_ok(
  format('select public.showroom_home_metrics(%L, %L, %L)', :'orgM', '2026-01-01', '2026-02-01'),
  '42501', null,
  'anon cannot call the metrics RPC');

select * from finish();
rollback;
