-- ===========================================================================
-- The Contractor account's business workspace carries the Contractor audience
--
-- `contractor_company` is the internal organization type behind the single
-- public Contractor account (it is not a registration choice and not a tenth
-- account). Its workspace therefore acts with the Contractor audience, exactly
-- as `design_office` acts as Engineer - otherwise a contractor working through
-- its company would see no products and could publish no Purchase Request,
-- while the same person acting personally would. Sales Team members of that
-- workspace inherit it, and nothing is ever combined across workspaces.
-- ===========================================================================
create or replace function app.org_product_audience(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case o.org_type::text
           when 'showroom_dealer'    then 'showroom_dealer'
           when 'supplier'           then 'supplier'
           when 'manufacturer'       then 'manufacturer'
           when 'importer'           then 'importer'
           when 'design_office'      then 'engineer'
           when 'contractor_company' then 'contractor'
           else null end
    from public.organizations o
   where o.id = p_org_id and o.deleted_at is null;
$$;

-- A request owned by the contractor workspace carries the Contractor audience
-- (it is discovered by Showrooms, like every Contractor request).
alter table public.purchase_requests drop constraint ck_pr_owner_shape;
alter table public.purchase_requests
  add constraint ck_pr_owner_shape check (
    (requester_org_id is null and requester_audience in ('contractor', 'engineer', 'installer_technician', 'end_consumer'))
    or
    (requester_org_id is not null and requester_audience in ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'engineer', 'contractor'))
  );
