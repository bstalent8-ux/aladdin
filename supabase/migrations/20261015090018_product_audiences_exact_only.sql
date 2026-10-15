-- Phase 6+7 Milestone B — product target audiences, EXACT-ONLY access.
--
-- DECISIONS (approved):
--   * Eight product target audiences, using the repo's canonical identifiers:
--       showroom_dealer, supplier, manufacturer, importer      (organization_type)
--       contractor, engineer, installer_technician, end_consumer (persona_type)
--     `engineer` also covers the design_office organization type (the repo's own canonical
--     Engineer business). Sales Team is NOT an audience: a Sales person acts through the
--     workspace (organization) they are authorised for and inherits THAT workspace's audience.
--     Legacy values (interior_designer, wholesaler, contractor_company, trainer, trainee) map
--     to no audience.
--   * Exact-only: audience is derived from the ONE workspace the caller names (and is a
--     member of) - never a union of the caller's workspaces. Switching workspace changes access.
--   * Every cross-organization product read goes through a workspace-aware security-definer
--     reader. The "any authenticated user may read any published product" policy is DROPPED.
--   * Existing published products are backfilled with ALL EIGHT audiences. A product needs at
--     least one audience to be published. Drafts stay private.
--   * product_prices remains owner-only and is never returned by any reader.

-- ===========================================================================
-- 1. Audience catalogue + product_audiences
-- ===========================================================================
create table public.product_audience_types (
  code       text primary key,
  kind       text not null check (kind in ('organization', 'persona')),
  sort_order smallint not null
);
comment on table public.product_audience_types is
  'The eight canonical product target audiences. Sales Team is deliberately absent: it inherits the audience of the workspace it represents.';
insert into public.product_audience_types (code, kind, sort_order) values
  ('showroom_dealer',      'organization', 10),
  ('supplier',             'organization', 20),
  ('manufacturer',         'organization', 30),
  ('importer',             'organization', 40),
  ('contractor',           'persona',      50),
  ('engineer',             'persona',      60),
  ('installer_technician', 'persona',      70),
  ('end_consumer',         'persona',      80);
alter table public.product_audience_types enable row level security;
create policy product_audience_types_read on public.product_audience_types for select to authenticated using (true);
revoke all on public.product_audience_types from public, anon, authenticated, service_role;
grant select on public.product_audience_types to authenticated;

create table public.product_audiences (
  product_id uuid not null references public.products (id) on delete cascade,
  audience   text not null references public.product_audience_types (code),
  created_at timestamptz not null default now(),
  primary key (product_id, audience)
);
create index ix_product_audiences_audience on public.product_audiences (audience, product_id);
comment on table public.product_audiences is
  'Which audiences a product is targeted at. Owner-readable; written only by product_audiences_set. Cross-organization visibility is decided by the workspace-aware readers, never by reading this table.';
alter table public.product_audiences enable row level security;
create policy product_audiences_select_own on public.product_audiences
  for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_id and app.is_org_member(p.organization_id)));
revoke all on public.product_audiences from public, anon, authenticated, service_role;
grant select on public.product_audiences to authenticated;

-- Backfill: every existing published product is targeted at all eight audiences.
insert into public.product_audiences (product_id, audience)
select p.id, t.code
  from public.products p cross join public.product_audience_types t
 where p.status = 'published'
on conflict do nothing;

-- ===========================================================================
-- 2. Audit vocabulary
-- ===========================================================================
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  'onboarding.organization_created',
  'product.created', 'product.updated', 'product.published', 'product.unpublished',
  'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected',
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed',
  'organization.verified',
  'affiliation.requested', 'affiliation.cancelled',
  'affiliation.approved', 'affiliation.rejected',
  'referral.submitted', 'referral.approved', 'referral.rejected',
  'conversation.opened',
  'points.adjusted', 'points.reversed',
  'job.created', 'job.updated', 'job.published', 'job.closed', 'job.cancelled',
  'job.application.submitted', 'job.application.withdrawn',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.started', 'job.assignment.progress_updated',
  'job.assignment.completed', 'job.assignment.cancelled',
  'job.review.submitted', 'job.review.suppressed', 'job.review.restored',
  'network_referral.submitted', 'network_referral.joined',
  'network_referral.approved', 'network_referral.rejected', 'network_referral.cancelled',
  'profile.username_set', 'profile.phone_set', 'profile.avatar_set',
  'organization.activities_set', 'user.activities_set',
  'product.archived', 'product.restored',
  'product.image_added', 'product.image_removed', 'product.image_reordered',
  'offer.created', 'offer.updated', 'offer.published', 'offer.paused', 'offer.resumed', 'offer.archived',
  'organization.contact_set',
  'profile.contact_visibility_set',
  'network_candidate.submitted',
  'network_candidate.approved',
  'network_candidate.rejected',
  'network_candidate.cancelled',
  -- Milestone B
  'product.audiences_set'
)) not valid;

-- ===========================================================================
-- 3. Audience derivation (the ONE rule)
-- ===========================================================================
-- Pure mappings; no caller identity involved.
create or replace function app.org_product_audience(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case o.org_type::text
           when 'showroom_dealer' then 'showroom_dealer'
           when 'supplier'        then 'supplier'
           when 'manufacturer'    then 'manufacturer'
           when 'importer'        then 'importer'
           when 'design_office'   then 'engineer'
           else null end
    from public.organizations o
   where o.id = p_org_id and o.deleted_at is null;
$$;

create or replace function app.persona_product_audience(p_persona text)
returns text language sql immutable set search_path = '' as $$
  select case when p_persona in ('end_consumer', 'engineer', 'contractor', 'installer_technician')
              then p_persona else null end;
$$;

-- The caller's audience for the workspace they NAME. With a workspace: the caller must be
-- an active member and the audience is that organization's. Without one: their personal
-- persona. Sales Team therefore gets exactly the audience of the workspace it represents,
-- and a Sales user with no workspace gets none. Raises for a workspace the caller is not in.
create or replace function app.viewer_product_audience(p_org_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if (select auth.uid()) is null then return null; end if;
  if p_org_id is not null then
    if not app.is_org_member(p_org_id) then
      raise exception 'not a member of this organization' using errcode = '42501';
    end if;
    return app.org_product_audience(p_org_id);
  end if;
  select u.primary_account_type::text into v from public.users u where u.id = (select auth.uid());
  return app.persona_product_audience(v);
end;
$$;

-- Is this product readable by a viewer with this audience (from the workspace p_viewer_org_id)?
-- Own-organization products are always visible to their workspace. Internal helper: no caller
-- identity, so it is only ever called by readers that already derived the audience.
create or replace function app.product_visible_to(p_product_id uuid, p_viewer_org_id uuid, p_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.products p
      join public.organizations o on o.id = p.organization_id and o.deleted_at is null
     where p.id = p_product_id
       and p.status = 'published' and p.deleted_at is null and p.archived_at is null
       and (p.organization_id = p_viewer_org_id
            or (p_audience is not null
                and exists (select 1 from public.product_audiences a
                             where a.product_id = p.id and a.audience = p_audience))));
$$;

revoke execute on function app.org_product_audience(uuid), app.persona_product_audience(text),
  app.viewer_product_audience(uuid), app.product_visible_to(uuid, uuid, text) from public;
grant execute on function app.viewer_product_audience(uuid) to authenticated;

-- ===========================================================================
-- 4. Owner write path + publish guard
-- ===========================================================================
create or replace function public.product_audiences_set(p_product_id uuid, p_audiences text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p public.products;
  v_set text[];
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_catalog(v_p.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if v_p.archived_at is not null then
    raise exception 'an archived product must be restored before it can be edited' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct a order by a), '{}') into v_set from unnest(coalesce(p_audiences, '{}')) a;
  if exists (select 1 from unnest(v_set) a where a not in (select code from public.product_audience_types)) then
    raise exception 'unknown audience' using errcode = '22023';
  end if;
  if v_p.status = 'published' and cardinality(v_set) = 0 then
    raise exception 'a published product needs at least one audience' using errcode = '22023';
  end if;
  delete from public.product_audiences where product_id = p_product_id and audience <> all (v_set);
  insert into public.product_audiences (product_id, audience)
  select p_product_id, a from unnest(v_set) a on conflict do nothing;
  perform app.record_audit_event('product.audiences_set', 'product', p_product_id, v_p.organization_id,
    jsonb_build_object('audiences', to_jsonb(v_set)));
end;
$$;
revoke execute on function public.product_audiences_set(uuid, text[]) from public, anon;
grant execute on function public.product_audiences_set(uuid, text[]) to authenticated;

-- Publishing now also requires at least one audience (otherwise nobody could read it).
create or replace function public.set_product_published(
  p_product_id       uuid,
  p_published        boolean,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_p public.products;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found'; end if;
  if not app.can_publish_catalog(v_p.organization_id) then
    raise exception 'catalog.publish required' using errcode = '42501';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'product was modified concurrently' using errcode = '40001';
  end if;
  if p_published and v_p.archived_at is not null then
    raise exception 'an archived product must be restored before it can be published' using errcode = '22023';
  end if;
  if (v_p.status = 'published') = p_published then
    return v_p.version;
  end if;
  if p_published and not exists (select 1 from public.product_audiences a where a.product_id = p_product_id) then
    raise exception 'select at least one audience before publishing' using errcode = '22023';
  end if;
  update public.products set
    status       = case when p_published then 'published'::public.product_status else 'draft'::public.product_status end,
    published_at = case when p_published then now() else null end,
    version      = version + 1
  where id = p_product_id;
  perform app.record_audit_event(
    case when p_published then 'product.published' else 'product.unpublished' end,
    'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

-- ===========================================================================
-- 5. Workspace-aware readers
-- ===========================================================================
create or replace function public.catalog_products(p_org_id uuid default null)
returns table (
  id                uuid,
  organization_id   uuid,
  supplier_name     text,
  supplier_verified boolean,
  supplier_slug     text,
  name              text,
  sku               text,
  category          public.product_category,
  brand             text,
  short_description text,
  unit              public.product_unit,
  image_ref         text,
  published_at      timestamptz,
  category_code     text,
  colors            text[],
  weight_kg         numeric,
  size_label        text,
  primary_image_key text,
  color_items       jsonb
) language plpgsql stable security definer set search_path = '' as $$
declare v_aud text := app.viewer_product_audience(p_org_id);
begin
  if v_aud is null then return; end if;
  return query
  select p.id, p.organization_id, o.name, o.is_verified, o.slug, p.name, p.sku, p.category, p.brand,
         p.short_description, p.unit, p.image_ref, p.published_at, p.category_code, p.colors,
         p.weight_kg, p.size_label,
         (select i.object_key from public.product_images i
           where i.product_id = p.id and i.state = 'ready' order by i.slot limit 1),
         p.color_items
    from public.products p
    join public.organizations o on o.id = p.organization_id and o.deleted_at is null
   where p.status = 'published' and p.deleted_at is null and p.archived_at is null
     and (p.organization_id = p_org_id
          or exists (select 1 from public.product_audiences a where a.product_id = p.id and a.audience = v_aud));
end;
$$;
comment on function public.catalog_products(uuid) is
  'The ONLY cross-organization product reader. Exact-only: the audience comes from the single workspace named by p_org_id (membership verified), or the personal persona when null. Public attributes only; never product_prices.';

create or replace function public.saved_products_for(p_org_id uuid)
returns table (
  organization_id   uuid,
  product_id        uuid,
  saved_by          uuid,
  note              text,
  saved_at          timestamptz,
  name              text,
  sku               text,
  category          public.product_category,
  brand             text,
  short_description text,
  unit              public.product_unit,
  image_ref         text,
  supplier_org_id   uuid,
  supplier_name     text,
  supplier_verified boolean,
  category_code     text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org_id is null then raise exception 'organization id is required' using errcode = '22023'; end if;
  return query
  select s.organization_id, s.product_id, s.saved_by, s.note, s.created_at,
         c.name, c.sku, c.category, c.brand, c.short_description, c.unit, c.image_ref,
         c.organization_id, c.supplier_name, c.supplier_verified, c.category_code
    from public.saved_products s
    join public.catalog_products(p_org_id) c on c.id = s.product_id
   where s.organization_id = p_org_id;
end;
$$;

create or replace function public.catalog_product_images(p_org_id uuid, p_product_ids uuid[])
returns table (product_id uuid, id uuid, object_key text, slot smallint)
language plpgsql stable security definer set search_path = '' as $$
declare v_aud text := app.viewer_product_audience(p_org_id);
begin
  if v_aud is null then return; end if;
  return query
  select i.product_id, i.id, i.object_key, i.slot
    from public.product_images i
   where i.product_id = any (coalesce(p_product_ids, '{}'))
     and i.state = 'ready'
     and app.product_visible_to(i.product_id, p_org_id, v_aud)
   order by i.product_id, i.slot;
end;
$$;

revoke execute on function public.catalog_products(uuid), public.saved_products_for(uuid),
  public.catalog_product_images(uuid, uuid[]) from public, anon;
grant execute on function public.catalog_products(uuid), public.saved_products_for(uuid),
  public.catalog_product_images(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- 6. Image signing: a per-workspace, short-lived grant (storage policies cannot take a
--    workspace argument, so the workspace-aware reader mints the permission instead)
-- ===========================================================================
create table public.product_image_grants (
  user_id          uuid not null references public.users (id) on delete cascade,
  object_key       text not null,
  workspace_org_id uuid,
  expires_at       timestamptz not null,
  primary key (user_id, object_key)
);
comment on table public.product_image_grants is
  'Short-lived permission to SIGN a product image, issued by product_image_access_grant for ONE workspace. Switching workspace discards the previous workspace''s grants. No policies: definer-only.';
alter table public.product_image_grants enable row level security;
revoke all on public.product_image_grants from public, anon, authenticated, service_role;

create or replace function public.product_image_access_grant(p_org_id uuid, p_keys text[])
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_aud   text;
  v_oaud  text;
  v_out   text[];
begin
  if v_uid is null then return '{}'; end if;
  v_aud  := app.viewer_product_audience(p_org_id);
  v_oaud := app.viewer_offer_audience(p_org_id);
  delete from public.product_image_grants
   where user_id = v_uid and (expires_at <= now() or workspace_org_id is distinct from p_org_id);
  with ok as (
    select distinct i.object_key
      from public.product_images i
     where i.object_key = any (coalesce(p_keys[1:60], '{}'))
       and i.state = 'ready'
       and (app.product_visible_to(i.product_id, p_org_id, v_aud)
            or exists (
                 select 1
                   from public.product_offer_items oi
                   join public.product_offers o on o.id = oi.offer_id
                  where oi.product_id = i.product_id
                    and v_oaud is not null
                    and app.offer_is_live(o.id)
                    and exists (select 1 from public.product_offer_audiences a
                                 where a.offer_id = o.id and a.audience = v_oaud)))
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
revoke execute on function public.product_image_access_grant(uuid, text[]) from public, anon;
grant execute on function public.product_image_access_grant(uuid, text[]) to authenticated;

create or replace function app.has_product_image_grant(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.product_image_grants g
      join public.product_images i on i.object_key = g.object_key and i.state = 'ready'
     where g.user_id = (select auth.uid())
       and g.object_key = p_key
       and g.expires_at > now()
       and app.product_is_public(i.product_id));
$$;
revoke execute on function app.has_product_image_grant(text) from public;
grant execute on function app.has_product_image_grant(text) to authenticated;

drop policy product_images_select_public on storage.objects;
create policy product_images_select_public on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images'
         and (storage.allow_only_operation('storage.object.sign')
              or storage.allow_only_operation('storage.object.sign_many'))
         and app.has_product_image_grant(name));

-- Table-level image listing across tenants is closed too (the reader above replaces it).
drop policy product_images_select_public on public.product_images;

-- ===========================================================================
-- 7. Close the direct cross-tenant read; rebuild the dependents
-- ===========================================================================
drop view public.saved_product_list;
drop view public.catalog_published_products;
drop policy products_select_published on public.products;

-- Spend by category: the buyer's own order lines still resolve their product category, but
-- through a narrow definer lookup keyed by an RFQ item the caller can already read - not
-- through cross-tenant product visibility.
create or replace function app.rfq_item_category(p_rfq_item_id uuid)
returns public.product_category language sql stable security definer set search_path = '' as $$
  select p.category
    from public.rfq_items ri join public.products p on p.id = ri.product_id
   where ri.id = p_rfq_item_id;
$$;
revoke execute on function app.rfq_item_category(uuid) from public;
grant execute on function app.rfq_item_category(uuid) to authenticated;

create or replace view public.order_category_spend with (security_invoker = true) as
  select
    o.id                  as order_id,
    o.requester_org_id,
    o.supplier_org_id,
    o.requester_branch_id,
    o.status,
    o.confirmed_at,
    coalesce(app.rfq_item_category(ri.id), 'other'::public.product_category) as category,
    qi.line_total         as amount
  from public.orders o
  join public.quotation_items qi on qi.quotation_id = o.quotation_id
  left join public.rfq_items ri  on ri.id = qi.rfq_item_id;

-- Showroom home KPIs: the saved-products figure now counts through the workspace reader.
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
    'saved_products', (select count(*) from public.saved_products_for(p_org_id))
  );
end;
$$;

-- save_product / add_rfq_item: the product must be visible to the acting WORKSPACE.
create or replace function public.save_product(
  p_organization_id uuid,
  p_product_id      uuid,
  p_note            text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_aud text;
begin
  if not app.is_org_member(p_organization_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  v_aud := app.org_product_audience(p_organization_id);
  if not app.product_visible_to(p_product_id, p_organization_id, v_aud) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  insert into public.saved_products (organization_id, product_id, saved_by, note)
  values (p_organization_id, p_product_id, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (organization_id, product_id) do update
    set note     = excluded.note,
        saved_by = excluded.saved_by;
end;
$$;

create or replace function public.add_rfq_item(
  p_rfq_id     uuid,
  p_product_id uuid,
  p_quantity   numeric,
  p_note       text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs; v_prod public.products; v_id uuid;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  perform app.assert_can_edit_rfq_draft(v_r);
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = '22023';
  end if;
  -- A PUBLISHED product OF THE RFQ'S SUPPLIER ORG that the REQUESTING workspace may see.
  select * into v_prod from public.products
    where id = p_product_id and organization_id = v_r.supplier_org_id
      and status = 'published' and deleted_at is null;
  if not found
     or not app.product_visible_to(v_prod.id, v_r.requester_org_id, app.org_product_audience(v_r.requester_org_id)) then
    raise exception 'product is not a published product of the supplier organization' using errcode = '22023';
  end if;
  insert into public.rfq_items (rfq_id, product_id, product_name, unit, quantity, note)
  values (p_rfq_id, v_prod.id, v_prod.name, v_prod.unit, p_quantity, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.save_product(uuid, uuid, text), public.add_rfq_item(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.save_product(uuid, uuid, text), public.add_rfq_item(uuid, uuid, numeric, text) to authenticated;
