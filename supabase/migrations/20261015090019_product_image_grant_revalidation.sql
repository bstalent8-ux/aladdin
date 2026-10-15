-- Milestone B hardening: an image signing grant must be re-validated on EVERY use.
--
-- Review finding (authorization-stale-grant): has_product_image_grant (20261019090001) only
-- checked that the grant row was unexpired and the product still published. A grant issued
-- for workspace W therefore kept working for up to 30 minutes after (a) the owner retargeted
-- the product away from W's audience, (b) the caller's membership of W was suspended or
-- revoked, or (c) W changed type. The grant is now only a "which workspace is this caller
-- acting as" marker; ELIGIBILITY is re-derived from live data each time, with the same rule
-- the readers use.

-- The one image-visibility rule: can the CALLER, acting as workspace p_org_id (null = personal),
-- see this product's images right now? Never raises; false for a non-member workspace.
create or replace function app.product_image_viewable(p_product_id uuid, p_org_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_aud  text;
  v_oaud text;
begin
  if v_uid is null then return false; end if;
  if p_org_id is not null then
    if not app.is_org_member(p_org_id) then return false; end if;
    v_aud := app.org_product_audience(p_org_id);
    select o.org_type::text into v_oaud from public.organizations o where o.id = p_org_id and o.deleted_at is null;
  else
    select u.primary_account_type::text into v_oaud from public.users u where u.id = v_uid;
    v_aud := app.persona_product_audience(v_oaud);
  end if;
  return app.product_visible_to(p_product_id, p_org_id, v_aud)
      or (v_oaud is not null
          and exists (
                select 1
                  from public.product_offer_items oi
                  join public.product_offers o on o.id = oi.offer_id
                 where oi.product_id = p_product_id
                   and app.offer_is_live(o.id)
                   and exists (select 1 from public.product_offer_audiences a
                                where a.offer_id = o.id and a.audience = v_oaud)));
end;
$$;
revoke execute on function app.product_image_viewable(uuid, uuid) from public;

-- Issuance uses the same rule (single source of truth).
create or replace function public.product_image_access_grant(p_org_id uuid, p_keys text[])
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_out text[];
begin
  if v_uid is null then return '{}'; end if;
  -- Raises for a workspace the caller is not a member of (same contract as the readers).
  perform app.viewer_product_audience(p_org_id);
  delete from public.product_image_grants
   where user_id = v_uid and (expires_at <= now() or workspace_org_id is distinct from p_org_id);
  with ok as (
    select distinct i.object_key
      from public.product_images i
     where i.object_key = any (coalesce(p_keys[1:60], '{}'))
       and i.state = 'ready'
       and app.product_image_viewable(i.product_id, p_org_id)
  ), ins as (
    insert into public.product_image_grants (user_id, object_key, workspace_org_id, expires_at)
    select v_uid, ok.object_key, p_org_id, now() + interval '30 minutes' from ok
    on conflict (user_id, object_key) do update
      set workspace_org_id = excluded.workspace_org_id, expires_at = excluded.expires_at
    returning object_key
  )
  select coalesce(array_agg(object_key), '{}') into v_out from ins;
  return v_out;
end;
$$;

-- The storage predicate: unexpired grant AND the live eligibility rule for the grant's workspace.
create or replace function app.has_product_image_grant(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.product_image_grants g
      join public.product_images i on i.object_key = g.object_key and i.state = 'ready'
     where g.user_id = (select auth.uid())
       and g.object_key = p_key
       and g.expires_at > now()
       and app.product_is_public(i.product_id)
       and app.product_image_viewable(i.product_id, g.workspace_org_id));
$$;
