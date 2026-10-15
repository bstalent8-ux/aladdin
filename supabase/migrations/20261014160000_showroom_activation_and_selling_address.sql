-- Address rollout: new showrooms require complete business data before approval,
-- activation or selling. Explicitly preserve ONLY pre-rollout products/orders
-- for already active, approved showrooms with missing addresses.
create table app.showroom_legacy_seller_exceptions (
 organization_id uuid primary key references public.organizations(id),
 recorded_at timestamptz not null default now(),
 policy_key text not null default '2026-10-existing-products-orders' check(policy_key='2026-10-existing-products-orders'),
 reason text not null default 'Approved active showroom missing detailed address at rollout',
 closed_at timestamptz, closed_by uuid references public.users(id) on delete set null
);
create table app.showroom_legacy_published_products (
 product_id uuid primary key, organization_id uuid not null references app.showroom_legacy_seller_exceptions(organization_id)
);
create table app.showroom_legacy_orders (
 order_id uuid primary key, organization_id uuid not null references app.showroom_legacy_seller_exceptions(organization_id)
);
alter table app.showroom_legacy_seller_exceptions enable row level security;
alter table app.showroom_legacy_published_products enable row level security;
alter table app.showroom_legacy_orders enable row level security;
revoke all on app.showroom_legacy_seller_exceptions,app.showroom_legacy_published_products,app.showroom_legacy_orders from public,anon,authenticated,service_role;
create index showroom_legacy_products_org on app.showroom_legacy_published_products(organization_id);
create index showroom_legacy_orders_org on app.showroom_legacy_orders(organization_id);

-- Select the existing primary branch; no guessed address/location is ever written.
create function app.showroom_primary_branch(p_org_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select coalesce((select m.primary_branch_id from public.memberships m join public.organizations o on o.id=m.organization_id where m.organization_id=p_org_id and m.user_id=o.created_by and m.primary_branch_id is not null order by m.created_at limit 1),
 (select b.id from public.branches b where b.organization_id=p_org_id and b.deleted_at is null and b.is_active order by b.created_at,b.id limit 1));
$$;
revoke all on function app.showroom_primary_branch(uuid) from public,anon,authenticated;

create function app.showroom_address_complete(p_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.branches b where b.id=app.showroom_primary_branch(p_org_id) and b.organization_id=p_org_id and b.deleted_at is null and b.is_active
 and ((nullif(btrim(b.address_ar),'') is not null and app.business_address_word_count(b.address_ar) between 1 and 250)
 or (nullif(btrim(b.address_en),'') is not null and app.business_address_word_count(b.address_en) between 1 and 250)));
$$;
revoke all on function app.showroom_address_complete(uuid) from public,anon,authenticated;

-- Snapshot the entire already-approved cohort to retain its historical data contract.
-- Only missing-address rows have an OPEN product/order continuation exception.
insert into app.showroom_legacy_seller_exceptions(organization_id,closed_at,reason)
select o.id,case when app.showroom_address_complete(o.id) then now() else null end,
case when app.showroom_address_complete(o.id) then 'Existing approved business; address complete at rollout; no open selling exception' else 'Existing approved business missing address; captured products/orders only' end
from public.organizations o where o.org_type='showroom_dealer' and o.status='active' and o.is_verified and o.deleted_at is null;
insert into app.showroom_legacy_published_products(product_id,organization_id)
select p.id,p.organization_id from public.products p join app.showroom_legacy_seller_exceptions e on e.organization_id=p.organization_id where p.status='published' and p.deleted_at is null and e.closed_at is null;
insert into app.showroom_legacy_orders(order_id,organization_id)
select o.id,o.supplier_org_id from public.orders o join app.showroom_legacy_seller_exceptions e on e.organization_id=o.supplier_org_id where e.closed_at is null;

create function app.showroom_profile_complete(p_org_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare o public.organizations; b public.branches;
begin
 select * into o from public.organizations where id=p_org_id and deleted_at is null;
 if not found then return false; end if;
 if o.org_type<>'showroom_dealer' then return true; end if;
 if not app.showroom_address_complete(o.id) then return false; end if;
 -- Existing approved businesses retain their historical information contract.
 -- This does NOT exempt them from a valid address on any new publication/sale.
 if exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=o.id) then return true; end if;
 if char_length(btrim(o.name))<2 or char_length(btrim(coalesce(o.legal_name,'')))<2 or o.contact_phone is null then return false; end if;
 if not exists(select 1 from public.organization_activities oa join public.activities a on a.id=oa.activity_id where oa.organization_id=o.id and a.organization_type='showroom_dealer' and a.is_active) then return false; end if;
 select * into b from public.branches where id=app.showroom_primary_branch(o.id) and organization_id=o.id and deleted_at is null and is_active;
 if b.governorate_key is null or (b.city_key is null and nullif(btrim(b.city_custom_name),'') is null) then return false; end if;
 perform * from app.normalize_business_location(b.governorate_key,b.city_key,b.city_custom_name,true);
 return true;
exception when sqlstate '22023' then return false;
end;
$$;
revoke all on function app.showroom_profile_complete(uuid) from public,anon,authenticated;

create function app.showroom_seller_ready(p_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations o where o.id=p_org_id and o.deleted_at is null
 and (o.org_type<>'showroom_dealer' or (o.status='active' and o.is_verified and app.showroom_profile_complete(o.id) and (exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=o.id) or exists(select 1 from public.verifications v where v.organization_id=o.id and v.subject_type='organization' and v.verification_type='organization' and v.status='approved' and v.applied_at is not null and (v.expires_at is null or v.expires_at>now()))))));
$$;
revoke all on function app.showroom_seller_ready(uuid) from public,anon,authenticated;

create function app.showroom_listing_visible(p_org_id uuid,p_product_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select app.showroom_seller_ready(p_org_id) or exists(select 1 from app.showroom_legacy_published_products p join app.showroom_legacy_seller_exceptions e on e.organization_id=p.organization_id join public.organizations o on o.id=e.organization_id where p.product_id=p_product_id and p.organization_id=p_org_id and e.closed_at is null and o.status='active' and o.is_verified and o.deleted_at is null);
$$;
revoke all on function app.showroom_listing_visible(uuid,uuid) from public,anon;
grant execute on function app.showroom_listing_visible(uuid,uuid) to authenticated;

create function app.showroom_activation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  -- The database owner may bootstrap historical fixtures/migrations. Neither
  -- authenticated nor service-role Data API callers can insert an active or
  -- pre-approved showroom instead of using the existing review/apply process.
  if new.org_type='showroom_dealer' and (new.status='active' or new.is_verified) and coalesce(current_setting('role',true),'none') not in ('none','postgres') then
   raise exception 'create showroom pending approval; activation requires approved verification' using errcode='22023';
  end if;
  return new;
 end if;
 if new.org_type='showroom_dealer' and new.status='active' and new.status is distinct from old.status and not exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=new.id) and (not new.is_verified or not exists(select 1 from public.verifications v where v.organization_id=new.id and v.subject_type='organization' and v.verification_type='organization' and v.status='approved' and (v.expires_at is null or v.expires_at>now()))) then
 raise exception 'approved organization verification is required before showroom activation' using errcode='22023'; end if;
 if new.org_type='showroom_dealer' and ((new.status='active' and new.status is distinct from old.status) or (new.is_verified and new.is_verified is distinct from old.is_verified))
 and not (old.is_verified and new.is_verified and exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=new.id and e.closed_at is null)) and not app.showroom_profile_complete(new.id) then
 raise exception 'showroom business information and detailed address are required before activation' using errcode='22023'; end if;
 return new;
end;
$$;
revoke all on function app.showroom_activation_guard() from public,anon,authenticated;
create trigger showroom_activation_complete before insert or update of status,is_verified on public.organizations for each row execute function app.showroom_activation_guard();

create function app.showroom_review_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='approved' and new.status is distinct from old.status and new.subject_type='organization' and exists(select 1 from public.organizations o where o.id=new.organization_id and o.org_type='showroom_dealer') and not app.showroom_profile_complete(new.organization_id) then
 raise exception 'complete showroom business information before approval' using errcode='22023'; end if;
 return new;
end;
$$;
revoke all on function app.showroom_review_guard() from public,anon,authenticated;
create trigger showroom_review_complete before update of status on public.verifications for each row execute function app.showroom_review_guard();

create function app.showroom_publish_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='published' and (tg_op='INSERT' or old.status is distinct from new.status)
 and not app.showroom_seller_ready(new.organization_id) then
 raise exception 'showroom must be active, approved and complete before product publishing' using errcode='42501'; end if;
 return new;
end;
$$;
revoke all on function app.showroom_publish_guard() from public,anon,authenticated;
create trigger showroom_product_publish_complete before insert or update of status on public.products for each row execute function app.showroom_publish_guard();

drop policy products_select_published on public.products;
create policy products_select_published on public.products for select to authenticated using (status='published' and deleted_at is null and not app.org_is_suspended(organization_id) and app.showroom_listing_visible(organization_id,id));

create function app.showroom_quotation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('submitted','accepted') and (tg_op='INSERT' or old.status is distinct from new.status) and not app.showroom_seller_ready(new.supplier_org_id) then
 raise exception 'showroom selling is not authorized' using errcode='42501'; end if;
 return new;
end;
$$;
revoke all on function app.showroom_quotation_guard() from public,anon,authenticated;
create trigger showroom_quotation_sell_complete before insert or update of status on public.quotations for each row execute function app.showroom_quotation_guard();

create function app.showroom_order_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.status in ('in_progress','completed') then
  if not app.showroom_seller_ready(new.supplier_org_id) and not (tg_op='UPDATE' and exists(select 1 from app.showroom_legacy_orders o join app.showroom_legacy_seller_exceptions e on e.organization_id=o.organization_id join public.organizations org on org.id=e.organization_id where o.order_id=new.id and o.organization_id=new.supplier_org_id and e.closed_at is null and org.status='active' and org.is_verified)) then
   raise exception 'showroom selling is not authorized' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;
revoke all on function app.showroom_order_guard() from public,anon,authenticated;
create trigger trg_zz_showroom_order_sell_complete before insert or update of status on public.orders for each row execute function app.showroom_order_guard();

create function app.showroom_legacy_remediation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if app.showroom_address_complete(new.organization_id) then
  update app.showroom_legacy_seller_exceptions set closed_at=now(),closed_by=(select auth.uid()) where organization_id=new.organization_id and closed_at is null;
 end if;
 return new;
end;
$$;
revoke all on function app.showroom_legacy_remediation() from public,anon,authenticated;
create trigger showroom_legacy_address_completed after insert or update of address_ar,address_en on public.branches for each row execute function app.showroom_legacy_remediation();
notify pgrst,'reload schema';

create function app.showroom_live_address_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_org uuid := case when tg_op='DELETE' then old.organization_id else new.organization_id end;
begin
 if exists(select 1 from public.organizations o where o.id=v_org and o.org_type='showroom_dealer' and o.status='active' and o.is_verified)
 and not exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=v_org and e.closed_at is null)
 and not app.showroom_address_complete(v_org) then
 raise exception 'an active showroom must retain its detailed address' using errcode='22023'; end if;
 return null;
end;
$$;
revoke all on function app.showroom_live_address_guard() from public,anon,authenticated;
create trigger showroom_live_address_required after update of address_ar,address_en,governorate_key,city_key,city_custom_name,is_active,deleted_at or delete on public.branches for each row execute function app.showroom_live_address_guard();
create or replace function app.profile_completion(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := p_user_id;
  v_profile   public.profiles;
  v_op        public.onboarding_progress;
  v_io        public.individual_onboarding;
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
  v_missing   text[] := '{}'::text[];
  v_total     int := 0;
  v_done      int := 0;
  v_has_org   boolean := false;
  v_can_manage boolean := false;
  v_needs_activities boolean := false;
begin
  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  select * into v_io from public.individual_onboarding where user_id = v_uid;
  v_persona := coalesce(app.effective_persona(v_uid), v_op.selected_persona);
  v_org_type := v_op.selected_org_type;

  -- ALL-AUDIENCES criteria. 'locality' is intentionally absent (product-owner
  -- decision 2026-09-24, see 20260924090011 header §7).
  v_total := v_total + 4;
  if v_profile.username is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'username'); end if;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

  if v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'interior_designer', 'contractor', 'sales') then
    v_total := v_total + 3;
    if v_profile.headline is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'headline'); end if;
    if v_io.prof_years_experience is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if v_profile.bio is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'bio'); end if;

    v_needs_activities := v_persona = 'installer_technician'
      or exists (select 1 from public.activities a where a.persona_type = v_persona and a.is_active);
    if v_needs_activities then
      v_total := v_total + 1;
      if exists (select 1 from public.user_activities ua where ua.user_id = v_uid)
         or (v_persona = 'installer_technician' and exists (
               select 1 from public.user_trades ut
               join public.trades t on t.id = ut.trade_id
               where ut.user_id = v_uid and t.is_active)) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'activities');
      end if;
    end if;
  end if;

  if v_org_type is not null then
    select exists (
      select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active'
    ) into v_has_org;
    select exists (
      select 1 from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id
      where m.user_id = v_uid and m.status = 'active' and c.capability_key = 'org.manage'
    ) into v_can_manage;

    v_total := v_total + 1;
    if v_has_org then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'organization_setup');
    end if;
    if v_can_manage then
      v_total := v_total + 1;
      if exists (
        select 1 from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        join public.organization_activities oa on oa.organization_id = m.organization_id
        where m.user_id = v_uid and m.status = 'active'
      ) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'organization_activities');
      end if;
    end if;
  end if;

  if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer') then
    v_total := v_total + 1;
    if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer' and not app.showroom_address_complete(o.id)) then
      v_missing := array_append(v_missing,'organization_address');
    else v_done := v_done + 1; end if;
  end if;
  return jsonb_build_object(
    'percent', case when v_total = 0 then 100 else round(100.0 * v_done / v_total) end,
    'missing', to_jsonb(v_missing),
    'audience', jsonb_build_object('persona', v_persona, 'organization_type', v_org_type),
    'has_org', v_has_org
  );
end;
$$;


revoke execute on function app.profile_completion(uuid) from public,anon,authenticated;
