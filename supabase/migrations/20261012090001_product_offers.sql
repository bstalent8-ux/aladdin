-- Product Offers — ONE canonical, shared domain (not showroom-only).
--
-- A Product Offer is a PACKAGE: several of the owner's products, a quantity for each,
-- ONE total package price, a validity window and the audiences allowed to see it.
-- It is NOT an RFQ, a quotation, a purchase request or an order, and shares no table
-- with them.
--
-- PRICE RULES (final)
--   * total_price is the price of the WHOLE package (numeric(14,2), EGP, no floats).
--     There is no per-product offer price, no discount %, no compare-at / original
--     price. Nothing here reads or writes public.product_prices (owner-private base
--     prices): a product can sit in many offers, and offer pricing never touches it.
--   * The package price is visible only to viewers who are eligible for the offer.
--
-- LIFECYCLE
--   Stored status: draft | published | paused | archived. Scheduled / active / expired
--   are DERIVED from status + starts_at/ends_at (app.offer_phase) — expiry is never a
--   stored state, so nothing has to run at ends_at.
--     draft      owner-only, editable
--     published  + now < starts_at  -> scheduled   (hidden from audiences)
--     published  + inside window    -> active      (visible to the audiences)
--     published  + now >= ends_at   -> expired     (hidden)
--     paused     hidden, editable; resume -> published
--     archived   historical, owner-only, terminal
--   Offers are never hard-deleted (history).
--
-- VISIBILITY (ONE rule, app.offer_is_live + app.viewer_offer_audience)
--   published AND starts_at <= now() < ends_at AND the viewer's canonical audience is
--   one of the offer's audiences AND the owner organization is live AND every product
--   in the package is still published and not archived/deleted AND (when a workspace is
--   given) it is not the viewer's own offer. Viewers read offers ONLY through the two
--   security-definer RPCs below (offers_feed / offer_detail), which return a fixed,
--   price-safe projection; the tables themselves are owner-readable only.
--
-- AUDIENCES are canonical codes, never labels. A business viewer is matched on its
-- organization_type, a personal viewer on its persona_type (the two sets are disjoint
-- by design). `feed_ready` marks audiences whose shell has an Offers feed today;
-- publishing requires every chosen audience to be feed_ready.

-- ===========================================================================
-- 1. Types and the audience catalogue
-- ===========================================================================
create type public.offer_status as enum ('draft', 'published', 'paused', 'archived');

create table public.offer_audience_types (
  code       text primary key,
  kind       text not null check (kind in ('organization', 'persona')),
  feed_ready boolean not null default false,
  sort_order smallint not null default 0
);
comment on table public.offer_audience_types is
  'Canonical offer audiences: organization_type values (business viewers) and persona_type values (personal viewers). feed_ready = a shell with an Offers feed exists for it today.';

insert into public.offer_audience_types (code, kind, feed_ready, sort_order) values
  ('showroom_dealer',      'organization', true,  10),
  ('supplier',             'organization', true,  20),
  ('manufacturer',         'organization', true,  30),
  ('importer',             'organization', true,  40),
  ('design_office',        'organization', true,  50),
  ('wholesaler',           'organization', false, 60),
  ('contractor_company',   'organization', false, 70),
  ('engineer',             'persona',      false, 80),
  ('interior_designer',    'persona',      false, 90),
  ('installer_technician', 'persona',      false, 100),
  ('contractor',           'persona',      false, 110);

alter table public.offer_audience_types enable row level security;
create policy offer_audience_types_read on public.offer_audience_types for select to authenticated using (true);
revoke all on public.offer_audience_types from public, anon, authenticated, service_role;
grant select on public.offer_audience_types to authenticated;

-- ===========================================================================
-- 2. product_offers / items / audiences
-- ===========================================================================
create table public.product_offers (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  total_price     numeric(14, 2) not null,
  currency        text not null default 'EGP',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          public.offer_status not null default 'draft',
  version         integer not null default 1,
  published_at    timestamptz,
  archived_at     timestamptz,
  created_by      uuid not null references public.users (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_product_offers_price check (total_price > 0 and total_price <= 100000000),
  constraint ck_product_offers_currency check (currency = 'EGP'),
  constraint ck_product_offers_window check (ends_at > starts_at),
  constraint ck_product_offers_version check (version >= 1),
  constraint uq_product_offers_org unique (id, organization_id)
);
create index product_offers_org_status_idx on public.product_offers (organization_id, status, ends_at desc);
create index product_offers_live_idx on public.product_offers (status, starts_at, ends_at) where status = 'published';
create trigger product_offers_set_updated_at before update on public.product_offers
  for each row execute function app.set_updated_at();
comment on table public.product_offers is
  'A package offer: ONE total price for several of the owner''s products (see product_offer_items). Owner-readable only; audiences read through offers_feed / offer_detail. Never mutates products or product_prices.';

create table public.product_offer_items (
  offer_id        uuid not null,
  product_id      uuid not null,
  organization_id uuid not null,
  quantity        integer not null default 1,
  position        smallint not null default 0,
  primary key (offer_id, product_id),
  constraint ck_offer_items_quantity check (quantity between 1 and 100000),
  -- The offer and the product belong to the SAME organization, by construction.
  constraint fk_offer_items_offer foreign key (offer_id, organization_id)
    references public.product_offers (id, organization_id) on delete cascade,
  constraint fk_offer_items_product foreign key (product_id, organization_id)
    references public.products (id, organization_id)
);
create index product_offer_items_product_idx on public.product_offer_items (product_id);

create table public.product_offer_audiences (
  offer_id uuid not null references public.product_offers (id) on delete cascade,
  audience text not null references public.offer_audience_types (code),
  primary key (offer_id, audience)
);

alter table public.product_offers          enable row level security;
alter table public.product_offer_items     enable row level security;
alter table public.product_offer_audiences enable row level security;

-- Owner organizations read their own offers (drafts included). There is NO audience
-- policy and NO write policy: viewers use the RPCs, writers use the RPCs.
create policy product_offers_select_own on public.product_offers
  for select to authenticated using (app.is_org_member(organization_id));
create policy product_offer_items_select_own on public.product_offer_items
  for select to authenticated using (app.is_org_member(organization_id));
create policy product_offer_audiences_select_own on public.product_offer_audiences
  for select to authenticated using (
    exists (select 1 from public.product_offers o where o.id = offer_id and app.is_org_member(o.organization_id)));

revoke all on public.product_offers, public.product_offer_items, public.product_offer_audiences
  from public, anon, authenticated, service_role;
grant select on public.product_offers, public.product_offer_items, public.product_offer_audiences to authenticated;

-- ===========================================================================
-- 3. Audit allow-list (append the offer lifecycle events)
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
  -- Product Offers
  'offer.created', 'offer.updated', 'offer.published', 'offer.paused', 'offer.resumed', 'offer.archived'
));

-- ===========================================================================
-- 4. The one eligibility rule
-- ===========================================================================
-- Derived phase. `p_now` defaults to now(); the public RPCs never take a caller clock.
create or replace function app.offer_phase(
  p_status public.offer_status, p_starts timestamptz, p_ends timestamptz, p_now timestamptz default now()
) returns text language sql stable set search_path = '' as $$
  select case p_status
    when 'draft'    then 'draft'
    when 'paused'   then 'paused'
    when 'archived' then 'archived'
    else case when p_now < p_starts then 'scheduled'
              when p_now >= p_ends  then 'expired'
              else 'active' end
  end;
$$;

-- A viewer's canonical audience: the ACTIVE business workspace's organization_type, or
-- (no workspace) the personal persona. NULL when the caller is not entitled to the
-- workspace or has no targetable persona.
create or replace function app.viewer_offer_audience(p_org_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if (select auth.uid()) is null then return null; end if;
  if p_org_id is not null then
    if not app.is_org_member(p_org_id) then
      raise exception 'not a member of this organization' using errcode = '42501';
    end if;
    select o.org_type::text into v from public.organizations o where o.id = p_org_id and o.deleted_at is null;
    return v;
  end if;
  select u.primary_account_type::text into v from public.users u where u.id = (select auth.uid());
  return v;
end;
$$;

-- Live = visible to its audiences right now. Internal: never granted to clients.
create or replace function app.offer_is_live(p_offer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.product_offers o
      join public.organizations org on org.id = o.organization_id and org.deleted_at is null
     where o.id = p_offer_id
       and o.status = 'published'
       and now() >= o.starts_at and now() < o.ends_at
       and exists (select 1 from public.product_offer_items i where i.offer_id = o.id)
       and not exists (
             select 1
               from public.product_offer_items i
               left join public.products p on p.id = i.product_id
              where i.offer_id = o.id
                and (p.id is null or p.status <> 'published' or p.deleted_at is not null or p.archived_at is not null))
  );
$$;

-- The audience-facing projection. FIXED, price-safe: the package price, the products
-- (public attributes only) and the seller's public identity. No product_prices.
create or replace function app.offer_public_json(p_offer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'organization_id', o.organization_id,
    'seller', jsonb_build_object('id', org.id, 'name', org.name, 'verified', org.is_verified, 'slug', org.slug),
    'total_price', o.total_price,
    'currency', o.currency,
    'starts_at', o.starts_at,
    'ends_at', o.ends_at,
    'published_at', o.published_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.id,
               'name', p.name,
               'code', p.sku,
               'quantity', i.quantity,
               'unit', p.unit::text,
               'brand', p.brand,
               'description', p.short_description,
               'size_label', p.size_label,
               'weight_kg', p.weight_kg,
               'category_code', p.category_code,
               'colors', to_jsonb(p.colors),
               'color_items', p.color_items,
               'image_ref', p.image_ref,
               'image_key', (select im.object_key from public.product_images im
                              where im.product_id = p.id and im.state = 'ready'
                              order by im.slot limit 1))
             order by i.position, p.name)
        from public.product_offer_items i
        join public.products p on p.id = i.product_id
       where i.offer_id = o.id), '[]'::jsonb))
    from public.product_offers o
    join public.organizations org on org.id = o.organization_id
   where o.id = p_offer_id;
$$;

revoke execute on function app.offer_phase(public.offer_status, timestamptz, timestamptz, timestamptz),
  app.viewer_offer_audience(uuid), app.offer_is_live(uuid), app.offer_public_json(uuid) from public;
grant execute on function app.offer_phase(public.offer_status, timestamptz, timestamptz, timestamptz),
  app.viewer_offer_audience(uuid), app.offer_is_live(uuid), app.offer_public_json(uuid) to authenticated;

-- ===========================================================================
-- 5. Viewer RPCs
-- ===========================================================================
create or replace function public.offers_feed(p_org_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_aud text := app.viewer_offer_audience(p_org_id);
  v_out jsonb;
begin
  if v_aud is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(app.offer_public_json(x.id) order by x.published_at desc nulls last, x.id), '[]'::jsonb)
    into v_out
    from (
      select o.id, o.published_at
        from public.product_offers o
       where app.offer_is_live(o.id)
         and exists (select 1 from public.product_offer_audiences a where a.offer_id = o.id and a.audience = v_aud)
         and (p_org_id is null or o.organization_id <> p_org_id)
       order by o.published_at desc nulls last, o.id
       limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) x;
  return v_out;
end;
$$;

create or replace function public.offer_detail(p_offer_id uuid, p_org_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_aud text := app.viewer_offer_audience(p_org_id);
  v_org uuid;
begin
  if v_aud is null then return null; end if;
  select o.organization_id into v_org from public.product_offers o where o.id = p_offer_id;
  if v_org is null or (p_org_id is not null and v_org = p_org_id) then return null; end if;
  if not app.offer_is_live(p_offer_id) then return null; end if;
  if not exists (select 1 from public.product_offer_audiences a where a.offer_id = p_offer_id and a.audience = v_aud) then
    return null;
  end if;
  return app.offer_public_json(p_offer_id);
end;
$$;

-- ===========================================================================
-- 6. Owner views (security_invoker: the owner-only RLS above scopes them)
-- ===========================================================================
create view public.own_product_offers with (security_invoker = true) as
  select o.id, o.organization_id, o.total_price, o.currency, o.starts_at, o.ends_at, o.status,
         o.version, o.published_at, o.archived_at, o.created_by, o.created_at, o.updated_at,
         app.offer_phase(o.status, o.starts_at, o.ends_at) as phase,
         (select count(*)::int from public.product_offer_items i where i.offer_id = o.id) as item_count,
         (select count(*)::int
            from public.product_offer_items i
            left join public.products p on p.id = i.product_id
           where i.offer_id = o.id
             and (p.id is null or p.status <> 'published' or p.deleted_at is not null or p.archived_at is not null)) as invalid_item_count
    from public.product_offers o;
comment on view public.own_product_offers is
  'The owner''s offers with the derived lifecycle phase (draft/scheduled/active/paused/expired/archived) and how many included products are no longer valid for a public offer.';

create view public.own_product_offer_links with (security_invoker = true) as
  select i.product_id, i.offer_id, i.organization_id, i.quantity,
         app.offer_phase(o.status, o.starts_at, o.ends_at) as phase
    from public.product_offer_items i
    join public.product_offers o on o.id = i.offer_id;
comment on view public.own_product_offer_links is
  'Which of the owner''s offers include each product, with the derived phase — feeds the real offer state shown in My Products. No price.';

revoke all on public.own_product_offers, public.own_product_offer_links from public, anon, authenticated, service_role;
grant select on public.own_product_offers, public.own_product_offer_links to authenticated;

-- ===========================================================================
-- 7. Owner writes
-- ===========================================================================
create or replace function app.offer_validate_package(
  p_org_id uuid, p_total_price numeric, p_starts timestamptz, p_ends timestamptz,
  p_items jsonb, p_audiences text[]
) returns void language plpgsql stable security definer set search_path = '' as $$
declare
  e jsonb;
  v_pid uuid;
  v_qty numeric;
  v_seen uuid[] := '{}';
  v_n integer;
begin
  if p_total_price is null or p_total_price <= 0 or p_total_price > 100000000 or scale(p_total_price) > 2 then
    raise exception 'the package price must be a positive amount in EGP with at most 2 decimals' using errcode = '22023';
  end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then
    raise exception 'the offer must end after it starts' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'choose at least one product for the offer' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'an offer can include at most 50 products' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'product_id') <> 'string' then
      raise exception 'each offer item needs a product and a quantity' using errcode = '22023';
    end if;
    begin
      v_pid := (e ->> 'product_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'each offer item needs a product and a quantity' using errcode = '22023';
    end;
    if jsonb_typeof(e -> 'quantity') <> 'number' then
      raise exception 'quantity must be a whole number of at least 1' using errcode = '22023';
    end if;
    v_qty := (e ->> 'quantity')::numeric;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 100000 then
      raise exception 'quantity must be a whole number of at least 1' using errcode = '22023';
    end if;
    if v_pid = any (v_seen) then
      raise exception 'a product can appear only once in an offer' using errcode = '22023';
    end if;
    v_seen := v_seen || v_pid;
  end loop;
  -- Every product belongs to the owner and is neither deleted nor archived.
  select count(*) into v_n from public.products p
   where p.id = any (v_seen) and p.organization_id = p_org_id and p.deleted_at is null and p.archived_at is null;
  if v_n <> cardinality(v_seen) then
    raise exception 'every product in an offer must be an active product of your organization' using errcode = '22023';
  end if;
  if p_audiences is null or cardinality(p_audiences) = 0 then
    raise exception 'choose at least one audience' using errcode = '22023';
  end if;
  if (select count(distinct a) from unnest(p_audiences) a) <> cardinality(p_audiences) then
    raise exception 'an audience can be chosen only once' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_audiences) a where not exists (select 1 from public.offer_audience_types t where t.code = a)) then
    raise exception 'unknown offer audience' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.own_offer_save(
  p_org_id           uuid,
  p_offer_id         uuid,
  p_expected_version integer,
  p_total_price      numeric,
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_items            jsonb,
  p_audiences        text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_o  public.product_offers;
  v_id uuid;
  v_version integer;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_write_catalog(p_org_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  perform app.offer_validate_package(p_org_id, p_total_price, p_starts_at, p_ends_at, p_items, p_audiences);

  if p_offer_id is null then
    insert into public.product_offers (organization_id, total_price, starts_at, ends_at, created_by)
    values (p_org_id, p_total_price, p_starts_at, p_ends_at, (select auth.uid()))
    returning id, version into v_id, v_version;
    perform app.record_audit_event('offer.created', 'product_offer', v_id, p_org_id, '{}'::jsonb);
  else
    select * into v_o from public.product_offers where id = p_offer_id for update;
    if not found then raise exception 'offer not found' using errcode = 'P0002'; end if;
    if v_o.organization_id <> p_org_id then
      raise exception 'offer not found' using errcode = 'P0002';
    end if;
    if v_o.version <> p_expected_version then
      raise exception 'offer was modified concurrently (expected %, found %)', p_expected_version, v_o.version
        using errcode = '40001';
    end if;
    if v_o.status not in ('draft', 'paused') then
      raise exception 'only a draft or paused offer can be edited; pause a published offer first' using errcode = '22023';
    end if;
    update public.product_offers
       set total_price = p_total_price, starts_at = p_starts_at, ends_at = p_ends_at, version = version + 1
     where id = p_offer_id
     returning id, version into v_id, v_version;
    delete from public.product_offer_items where offer_id = v_id;
    delete from public.product_offer_audiences where offer_id = v_id;
    perform app.record_audit_event('offer.updated', 'product_offer', v_id, p_org_id, '{}'::jsonb);
  end if;

  insert into public.product_offer_items (offer_id, product_id, organization_id, quantity, position)
  select v_id, (e.value ->> 'product_id')::uuid, p_org_id, (e.value ->> 'quantity')::numeric::integer, (e.ord - 1)::smallint
    from jsonb_array_elements(p_items) with ordinality as e(value, ord);
  insert into public.product_offer_audiences (offer_id, audience)
  select v_id, a from unnest(p_audiences) a;

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

-- publish | pause | resume | archive
create or replace function public.own_offer_set_status(
  p_offer_id         uuid,
  p_action           text,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_o public.product_offers;
  v_to public.offer_status;
  v_event text;
  v_aud text[];
begin
  select * into v_o from public.product_offers where id = p_offer_id for update;
  if not found then raise exception 'offer not found' using errcode = 'P0002'; end if;
  if not app.can_publish_catalog(v_o.organization_id) then
    raise exception 'catalog.publish required' using errcode = '42501';
  end if;
  if v_o.version <> p_expected_version then
    raise exception 'offer was modified concurrently (expected %, found %)', p_expected_version, v_o.version
      using errcode = '40001';
  end if;

  if p_action in ('publish', 'resume') then
    if p_action = 'publish' and v_o.status <> 'draft' then
      raise exception 'only a draft offer can be published' using errcode = '22023';
    end if;
    if p_action = 'resume' and v_o.status <> 'paused' then
      raise exception 'only a paused offer can be resumed' using errcode = '22023';
    end if;
    if v_o.ends_at <= now() then
      raise exception 'this offer has already ended; change its dates first' using errcode = '22023';
    end if;
    select coalesce(array_agg(a.audience), '{}') into v_aud from public.product_offer_audiences a where a.offer_id = v_o.id;
    perform app.offer_validate_package(
      v_o.organization_id, v_o.total_price, v_o.starts_at, v_o.ends_at,
      (select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity)), '[]'::jsonb)
         from public.product_offer_items i where i.offer_id = v_o.id),
      v_aud);
    -- Publishing needs every audience to have an Offers feed today, and every product live.
    if exists (select 1 from unnest(v_aud) a join public.offer_audience_types t on t.code = a where not t.feed_ready) then
      raise exception 'an audience you chose cannot receive offers yet' using errcode = '22023';
    end if;
    if exists (select 1 from public.product_offer_items i join public.products p on p.id = i.product_id
                where i.offer_id = v_o.id and p.status <> 'published') then
      raise exception 'every product in a published offer must be published' using errcode = '22023';
    end if;
    v_to := 'published'; v_event := case p_action when 'publish' then 'offer.published' else 'offer.resumed' end;
  elsif p_action = 'pause' then
    if v_o.status <> 'published' then
      raise exception 'only a published offer can be paused' using errcode = '22023';
    end if;
    v_to := 'paused'; v_event := 'offer.paused';
  elsif p_action = 'archive' then
    if not (v_o.status in ('draft', 'paused') or (v_o.status = 'published' and v_o.ends_at <= now())) then
      raise exception 'pause an active or scheduled offer before archiving it' using errcode = '22023';
    end if;
    v_to := 'archived'; v_event := 'offer.archived';
  else
    raise exception 'unknown offer action' using errcode = '22023';
  end if;

  update public.product_offers
     set status = v_to, version = version + 1,
         published_at = case when p_action = 'publish' then now() else published_at end,
         archived_at = case when p_action = 'archive' then now() else archived_at end
   where id = v_o.id;
  perform app.record_audit_event(v_event, 'product_offer', v_o.id, v_o.organization_id, '{}'::jsonb);
  return v_o.version + 1;
end;
$$;

revoke execute on function
  public.offers_feed(uuid, integer), public.offer_detail(uuid, uuid),
  public.own_offer_save(uuid, uuid, integer, numeric, timestamptz, timestamptz, jsonb, text[]),
  public.own_offer_set_status(uuid, text, integer),
  app.offer_validate_package(uuid, numeric, timestamptz, timestamptz, jsonb, text[])
  from public, anon;
grant execute on function
  public.offers_feed(uuid, integer), public.offer_detail(uuid, uuid),
  public.own_offer_save(uuid, uuid, integer, numeric, timestamptz, timestamptz, jsonb, text[]),
  public.own_offer_set_status(uuid, text, integer)
  to authenticated;
grant execute on function app.offer_validate_package(uuid, numeric, timestamptz, timestamptz, jsonb, text[]) to authenticated;
