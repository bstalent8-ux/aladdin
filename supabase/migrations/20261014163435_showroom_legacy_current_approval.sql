-- Historical address exceptions must never grant current approval.
-- Staging's historical cohort has no verification rows: retain that recorded
-- pre-rollout trust only while active/verified and no terminal decision exists.
create function app.showroom_approval_current(p_org_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_org public.organizations; v_verification public.verifications; v_legacy boolean;
begin
 select * into v_org from public.organizations where id=p_org_id and deleted_at is null;
 if not found or v_org.status<>'active' or not v_org.is_verified then return false; end if;
 select exists(select 1 from app.showroom_legacy_seller_exceptions where organization_id=p_org_id) into v_legacy;
 -- A renewal still under review does not erase a valid prior approval. A newer
 -- terminal rejection/expiry does. Lifecycle revocation clears is_verified.
 select * into v_verification from public.verifications
 where organization_id=p_org_id and subject_type='organization' and verification_type='organization'
 and status in ('approved','expired','rejected')
 order by coalesce(decided_at,applied_at,created_at) desc,created_at desc,id desc limit 1;
 if found then
  return v_verification.status='approved'
   and (v_verification.expires_at is null or v_verification.expires_at>now())
   and (v_legacy or v_verification.applied_at is not null);
 end if;
 -- Only the migration's historical snapshot can use the no-record fallback;
 -- new organizations cannot manufacture this row through any public API.
 return v_legacy;
end;
$$;
revoke all on function app.showroom_approval_current(uuid) from public,anon,authenticated,service_role;

create or replace function app.showroom_profile_complete(p_org_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_org public.organizations; v_branch public.branches;
begin
 select * into v_org from public.organizations where id=p_org_id and deleted_at is null;
 if not found then return false; end if;
 if v_org.org_type<>'showroom_dealer' then return true; end if;
 if not app.showroom_address_complete(v_org.id) then return false; end if;
 if exists(select 1 from app.showroom_legacy_seller_exceptions where organization_id=v_org.id) then return true; end if;
 if char_length(btrim(v_org.name))<2 or char_length(btrim(coalesce(v_org.legal_name,'')))<2
 or not app.business_contact_phone_valid(v_org.contact_phone) then return false; end if;
 if not exists(select 1 from public.organization_activities oa join public.activities a on a.id=oa.activity_id
 where oa.organization_id=v_org.id and a.organization_type='showroom_dealer' and a.is_active) then return false; end if;
 select * into v_branch from public.branches where id=app.showroom_primary_branch(v_org.id)
 and organization_id=v_org.id and deleted_at is null and is_active;
 if v_branch.governorate_key is null or (v_branch.city_key is null and nullif(btrim(v_branch.city_custom_name),'') is null) then return false; end if;
 perform * from app.normalize_business_location(v_branch.governorate_key,v_branch.city_key,v_branch.city_custom_name,true);
 return true;
exception when sqlstate '22023' then return false;
end;
$$;

create or replace function app.showroom_seller_ready(p_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organizations o where o.id=p_org_id and o.deleted_at is null
 and (o.org_type<>'showroom_dealer' or (app.showroom_approval_current(o.id) and app.showroom_profile_complete(o.id))));
$$;

create or replace function app.showroom_listing_visible(p_org_id uuid,p_product_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select app.showroom_seller_ready(p_org_id) or
 (app.showroom_approval_current(p_org_id) and exists(select 1 from app.showroom_legacy_published_products p
 join app.showroom_legacy_seller_exceptions e on e.organization_id=p.organization_id
 where p.product_id=p_product_id and p.organization_id=p_org_id and e.closed_at is null));
$$;

create or replace function app.showroom_order_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.status in ('in_progress','completed') then
  if not app.showroom_seller_ready(new.supplier_org_id)
  and not (tg_op='UPDATE' and app.showroom_approval_current(new.supplier_org_id)
   and exists(select 1 from app.showroom_legacy_orders o join app.showroom_legacy_seller_exceptions e on e.organization_id=o.organization_id
    where o.order_id=new.id and o.organization_id=new.supplier_org_id and e.closed_at is null)) then
   raise exception 'showroom selling is not authorized' using errcode='42501';
  end if;
 end if;
 return new;
end;
$$;
-- CREATE OR REPLACE preserves the existing narrow grants on these helpers.
notify pgrst,'reload schema';
