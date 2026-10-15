-- Showroom Home reference alignment: two more cards the approved Home shows and the customization layer
-- must be able to store (so "تخصيص بطاقات المؤشرات" keeps governing the cards on the page).
--   completed_orders            orders this organization PLACED that reached `completed` in the period
--   orders_awaiting_execution   orders this organization PLACED that are `confirmed` and not yet started (now)
-- Both figures are counted from the existing RLS-scoped `order_list` view by the application; nothing here
-- computes or stores a value. Only the allow-list changes: the enum gains two keys, the showroom_suite
-- surface may list them, and the per-layout length bound follows the (now larger) catalog.
alter type public.dashboard_kpi_card_key add value if not exists 'completed_orders';
alter type public.dashboard_kpi_card_key add value if not exists 'orders_awaiting_execution';

alter table public.dashboard_kpi_layouts drop constraint ck_dashboard_kpi_layouts_card_order_len;
alter table public.dashboard_kpi_layouts add constraint ck_dashboard_kpi_layouts_card_order_len check (
  cardinality(card_order) between 1 and 12
  and (surface = 'showroom_suite' or cardinality(card_order) <= 8)
);

create or replace function app.validate_dashboard_kpi_card_order(
  p_card_order public.dashboard_kpi_card_key[],
  p_surface    text default 'home'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[];
begin
  if p_surface = 'home' then
    v_allowed := array['overdue_followups', 'due_today', 'quotations_to_review', 'open_purchase_requests',
                       'orders_in_progress', 'total_purchases', 'projects', 'saved_products'];
  elsif p_surface = 'showroom_suite' then
    v_allowed := array['open_purchase_requests', 'rfqs_sent', 'quotes_received', 'orders_in_progress',
                       'total_purchases', 'customer_rfqs_received', 'customer_quotes_sent', 'total_sales',
                       'projects', 'saved_products', 'completed_orders', 'orders_awaiting_execution'];
  else
    raise exception 'unknown dashboard surface' using errcode = '22023';
  end if;

  if p_card_order is null or cardinality(p_card_order) < 1 or cardinality(p_card_order) > cardinality(v_allowed) then
    raise exception 'card_order must list between 1 and % cards', cardinality(v_allowed) using errcode = '22023';
  end if;
  if cardinality(p_card_order) <> (select count(distinct x) from unnest(p_card_order) x) then
    raise exception 'card_order must not repeat a card' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_card_order) x where x::text <> all (v_allowed)) then
    raise exception 'card_order contains a card that is not available on this dashboard' using errcode = '22023';
  end if;
end;
$$;
