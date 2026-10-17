-- Showroom suite Home: directional KPI aggregates in one read.
--
-- A showroom is BOTH buyer and seller of the same commerce chain. Every figure
-- below is an aggregate over the existing RLS-scoped list views, which already
-- carry both sides (requester_org_id = buying, supplier_org_id = selling):
--
--   PURCHASING  (the organization is the requester)
--     open_purchase_requests  RFQs it raised that are still open        (now)
--     rfqs_sent               RFQs it sent to suppliers in the period
--     quotes_received         supplier quotations it received in the period
--     purchase_orders_active  its orders not yet completed/cancelled    (now)
--     total_purchases         value of its non-cancelled orders confirmed in the period
--   SALES  (the organization is the supplier)
--     customer_rfqs_received  RFQs addressed to it in the period
--     customer_quotes_sent    quotations it sent in the period
--     total_sales             value of its non-cancelled orders confirmed in the period
--   OTHER
--     active_projects         active projects it executes or requested  (now)
--     saved_products          its saved-product shortlist               (now)
--
-- SECURITY INVOKER on purpose: the views are security_invoker, so this function
-- sees exactly what the caller's own RLS allows — it can never widen access.
-- The explicit org filter plus the membership guard additionally make a
-- cross-organization call fail loudly instead of returning an empty shape.
-- The period is resolved in the caller-supplied IANA timezone as the half-open
-- instant range [from 00:00, to+1 00:00), so a day is a day in the business's
-- own calendar. An aggregate here is exact — it is not subject to the API row cap.

create function public.showroom_home_metrics(
  p_org_id   uuid,
  p_from     date,
  p_to       date,
  p_timezone text default 'Africa/Cairo'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'a valid period is required' using errcode = '22023';
  end if;

  -- An unknown timezone raises here (22023) rather than silently using UTC.
  v_start := p_from::timestamp at time zone p_timezone;
  v_end   := (p_to + 1)::timestamp at time zone p_timezone;

  return jsonb_build_object(
    'open_purchase_requests', (
      select count(*) from public.rfq_list r
       where r.requester_org_id = p_org_id and r.status in ('submitted', 'quoted')),
    'rfqs_sent', (
      select count(*) from public.rfq_list r
       where r.requester_org_id = p_org_id and r.status in ('submitted', 'quoted', 'closed')
         and r.created_at >= v_start and r.created_at < v_end),
    'quotes_received', (
      select count(*) from public.quotation_list q
       where q.requester_org_id = p_org_id and q.status <> 'draft'
         and q.created_at >= v_start and q.created_at < v_end),
    'purchase_orders_active', (
      select count(*) from public.order_list o
       where o.requester_org_id = p_org_id and o.status in ('confirmed', 'in_progress')),
    'total_purchases', (
      select coalesce(sum(o.total), 0) from public.order_list o
       where o.requester_org_id = p_org_id and o.status <> 'cancelled'
         and o.confirmed_at >= v_start and o.confirmed_at < v_end),
    'customer_rfqs_received', (
      select count(*) from public.rfq_list r
       where r.supplier_org_id = p_org_id and r.status <> 'draft'
         and r.created_at >= v_start and r.created_at < v_end),
    'customer_quotes_sent', (
      select count(*) from public.quotation_list q
       where q.supplier_org_id = p_org_id and q.status <> 'draft'
         and q.created_at >= v_start and q.created_at < v_end),
    'total_sales', (
      select coalesce(sum(o.total), 0) from public.order_list o
       where o.supplier_org_id = p_org_id and o.status <> 'cancelled'
         and o.confirmed_at >= v_start and o.confirmed_at < v_end),
    'active_projects', (
      select count(*) from public.project_list p
       where (p.requester_org_id = p_org_id or p.executing_org_id = p_org_id) and p.status = 'active'),
    'saved_products', (
      select count(*) from public.saved_product_list s where s.organization_id = p_org_id)
  );
end;
$$;

comment on function public.showroom_home_metrics(uuid, date, date, text) is
  'Directional KPI aggregates for the showroom suite Home (purchasing = requester side, sales = supplier side). SECURITY INVOKER over security_invoker views: RLS-scoped, org-guarded, exact (not API-row-capped). Period in the caller-supplied IANA timezone.';

revoke execute on function public.showroom_home_metrics(uuid, date, date, text) from public;
grant execute on function public.showroom_home_metrics(uuid, date, date, text) to authenticated;
