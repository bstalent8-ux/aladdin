-- Showroom suite Home: stop reporting RFQs as "purchase requests".
--
-- 20261007090002 returned an `open_purchase_requests` figure computed from
-- rfq_list. That conflated two different procurement stages:
--
--   purchase request -> RFQ sent -> quotation received -> purchase order
--
-- A Purchase Request is a distinct procurement need and has no entity yet, so the
-- payload must not carry a count under that name. Same signature, grants and
-- security model (SECURITY INVOKER over security_invoker views); the only change is
-- that the key is gone, leaving the nine remaining documented figures.
--
-- Additive on purpose: no enum value, column or layout row is removed. The
-- historical `open_purchase_requests` card key stays valid in the enum and in the
-- allowlists, but the application never offers or renders it. It can come back
-- when a real purchase-request lifecycle exists.

create or replace function public.showroom_home_metrics(
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
  'Directional KPI aggregates for the showroom suite Home (purchasing = requester side, sales = supplier side). No purchase-request figure: that entity does not exist yet and RFQs are a different stage. SECURITY INVOKER over security_invoker views: RLS-scoped, org-guarded, exact (not API-row-capped). Period in the caller-supplied IANA timezone.';
