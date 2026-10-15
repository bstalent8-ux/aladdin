-- Showroom suite KPI layouts (additive; production /b2b Home is unchanged).
--
-- The Showroom Owner Home (20260915090001) persists ONE layout per organization
-- (team default) and per membership (personal), over eight cards. The showroom
-- suite Home is directional (purchasing vs sales) and needs five more cards. It
-- must not share rows with production Home: a shared row written with the new
-- keys would be filtered down by production Home and could even leave it with
-- no cards. So layouts gain a `surface` discriminator:
--
--   'home'            production /b2b Home — the original eight cards, max 8.
--   'showroom_suite'  the showroom suite Home — its own ten cards, max 10.
--
-- Backwards compatible: every existing row becomes surface 'home' (column
-- default), and the four layout RPCs keep their old call shape because the new
-- `p_surface` parameter defaults to 'home'.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it,
-- so nothing below compares against the new labels as enum literals — the new
-- guard compares text, evaluated only when the RPCs run (a later transaction).

alter type public.dashboard_kpi_card_key add value if not exists 'rfqs_sent';
alter type public.dashboard_kpi_card_key add value if not exists 'quotes_received';
alter type public.dashboard_kpi_card_key add value if not exists 'customer_rfqs_received';
alter type public.dashboard_kpi_card_key add value if not exists 'customer_quotes_sent';
alter type public.dashboard_kpi_card_key add value if not exists 'total_sales';

alter table public.dashboard_kpi_layouts
  add column surface text not null default 'home',
  add constraint ck_dashboard_kpi_layouts_surface check (surface in ('home', 'showroom_suite'));

comment on column public.dashboard_kpi_layouts.surface is
  'Which dashboard this layout belongs to: ''home'' (production /b2b Home, original eight cards) or ''showroom_suite'' (the showroom suite Home, its own ten cards). Layouts of different surfaces never mix.';

alter table public.dashboard_kpi_layouts drop constraint ck_dashboard_kpi_layouts_card_order_len;
alter table public.dashboard_kpi_layouts add constraint ck_dashboard_kpi_layouts_card_order_len check (
  cardinality(card_order) between 1 and 10
  and (surface = 'showroom_suite' or cardinality(card_order) <= 8)
);

drop index public.uq_dashboard_kpi_layouts_team_default;
drop index public.uq_dashboard_kpi_layouts_personal;
create unique index uq_dashboard_kpi_layouts_team_default
  on public.dashboard_kpi_layouts (organization_id, surface)
  where membership_id is null;
create unique index uq_dashboard_kpi_layouts_personal
  on public.dashboard_kpi_layouts (organization_id, membership_id, surface)
  where membership_id is not null;

-- ---------------------------------------------------------------------------
-- Guard: length, duplicates, and the per-surface card allowlist.
-- ---------------------------------------------------------------------------
drop function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[]);
drop function public.dashboard_kpi_layout_reset_personal(uuid);
drop function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[]);
drop function public.dashboard_kpi_layout_reset_team_default(uuid);
drop function app.validate_dashboard_kpi_card_order(public.dashboard_kpi_card_key[]);

create function app.validate_dashboard_kpi_card_order(
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
                       'projects', 'saved_products'];
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

comment on function app.validate_dashboard_kpi_card_order(public.dashboard_kpi_card_key[], text) is
  'Shared guard for every dashboard_kpi_layout_* write RPC: bounded length, no repeats, and only the cards of the given surface (''home'' = original eight, ''showroom_suite'' = the suite''s ten). The enum forecloses free text; this forecloses a card from the wrong dashboard.';

-- ---------------------------------------------------------------------------
-- RPCs — identical authorization to 20260915090001; only surface-scoped.
-- ---------------------------------------------------------------------------
create function public.dashboard_kpi_layout_set_personal(
  p_org_id     uuid,
  p_card_order public.dashboard_kpi_card_key[],
  p_surface    text default 'home'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  perform app.validate_dashboard_kpi_card_order(p_card_order, p_surface);

  select m.id into v_membership_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.organization_id = p_org_id
     and m.status = 'active';

  insert into public.dashboard_kpi_layouts (organization_id, membership_id, card_order, updated_by, surface)
  values (p_org_id, v_membership_id, p_card_order, v_membership_id, p_surface)
  on conflict (organization_id, membership_id, surface) where membership_id is not null
  do update set card_order = excluded.card_order,
                updated_by = excluded.updated_by,
                updated_at = now();
end;
$$;

comment on function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[], text) is
  'Upserts the CALLER''S OWN personal KPI layout for p_org_id on one dashboard surface — the target membership is always resolved server-side from auth.uid(), never a parameter. Any active member may call it.';

revoke execute on function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[], text) from public;
grant execute on function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[], text) to authenticated;

create function public.dashboard_kpi_layout_reset_personal(p_org_id uuid, p_surface text default 'home')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if p_surface not in ('home', 'showroom_suite') then
    raise exception 'unknown dashboard surface' using errcode = '22023';
  end if;

  delete from public.dashboard_kpi_layouts
   where organization_id = p_org_id
     and surface = p_surface
     and membership_id in (
       select m.id from public.memberships m where m.user_id = (select auth.uid())
     );
end;
$$;

comment on function public.dashboard_kpi_layout_reset_personal(uuid, text) is
  'Deletes the caller''s own personal KPI layout row for one surface, if any. A no-op, not an error, when none exists.';

revoke execute on function public.dashboard_kpi_layout_reset_personal(uuid, text) from public;
grant execute on function public.dashboard_kpi_layout_reset_personal(uuid, text) to authenticated;

create function public.dashboard_kpi_layout_set_team_default(
  p_org_id     uuid,
  p_card_order public.dashboard_kpi_card_key[],
  p_surface    text default 'home'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  perform app.validate_dashboard_kpi_card_order(p_card_order, p_surface);

  select m.id into v_membership_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.organization_id = p_org_id
     and m.status = 'active';

  insert into public.dashboard_kpi_layouts (organization_id, membership_id, card_order, updated_by, surface)
  values (p_org_id, null, p_card_order, v_membership_id, p_surface)
  on conflict (organization_id, surface) where membership_id is null
  do update set card_order = excluded.card_order,
                updated_by = excluded.updated_by,
                updated_at = now();
end;
$$;

comment on function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[], text) is
  'Sets the organization-wide default KPI layout for one dashboard surface. Requires org.manage.';

revoke execute on function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[], text) from public;
grant execute on function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[], text) to authenticated;

create function public.dashboard_kpi_layout_reset_team_default(p_org_id uuid, p_surface text default 'home')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  if p_surface not in ('home', 'showroom_suite') then
    raise exception 'unknown dashboard surface' using errcode = '22023';
  end if;

  delete from public.dashboard_kpi_layouts
   where organization_id = p_org_id
     and surface = p_surface
     and membership_id is null;
end;
$$;

comment on function public.dashboard_kpi_layout_reset_team_default(uuid, text) is
  'Deletes the organization''s team-default KPI layout for one surface, if any. Requires org.manage.';

revoke execute on function public.dashboard_kpi_layout_reset_team_default(uuid, text) from public;
grant execute on function public.dashboard_kpi_layout_reset_team_default(uuid, text) to authenticated;
