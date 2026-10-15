-- Phase 6+7 Milestone C - the shared Purchase Request foundation.
--
-- A Purchase Request is PUBLISHED DEMAND: one shared system for every requester type, with
-- no duplicate per-account tables. It is NOT an RFQ (an RFQ is one buyer -> one supplier and
-- stays unchanged) and it creates NO order, allocation or payment.
--
-- DECISIONS (approved):
--   * OWNERSHIP, no fake organization:  (A) an INDIVIDUAL (requester_org_id null, owned by the
--     author) for the Craftsman / Contractor / Engineer / Personal personas, or (B) an
--     ORGANIZATION acting through an ACTIVE WORKSPACE (requester_org_id set, capability
--     rfq.create). "Requester organization is live" is enforced ONLY when an organization
--     owns the request. The requester can always manage their own request.
--   * ITEMS need not reference catalog products and never create any: required name, optional
--     code, required canonical category (the 15), optional colours, up to 2 reference images,
--     quantity + unit, optional specs (<= 250 characters).
--   * VISIBILITY MATRIX (workspace-based, exact-only, same principle as product audiences;
--     Sales Team inherits its workspace's audience):
--       Craftsman / Contractor / Engineer / Personal requester  -> Showrooms
--       Showroom requester  -> Suppliers, Manufacturers, Importers
--                              (+ other Showrooms when share_with_showrooms is on)
--       Supplier -> other Suppliers;  Manufacturer -> other Manufacturers;  Importer -> other Importers
--     A requester never sees (or answers) their own request in discovery.
--   * RESPONSES (Option A): purchase_request_responses - many independent, NON-BINDING
--     responses; each responder sees only its own, the requester sees all; FULL or PARTIAL
--     (0 < offered <= requested, same unit), unit price, stored line total, line notes.
--     The requester may shortlist several; shortlisting creates no order and closes nothing.
--     NOT built (unapproved): binding acceptance, allocation, order creation, payment.
--   * Direct record AND attachment access are enforced here: there is no cross-tenant table
--     read, only workspace-aware readers and per-workspace image signing grants that are
--     re-validated on every use.

-- ===========================================================================
-- 1. Audit vocabulary
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
  'product.audiences_set',
  -- Milestone C
  'purchase_request.created', 'purchase_request.updated', 'purchase_request.published',
  'purchase_request.closed', 'purchase_request.cancelled',
  'purchase_request.image_added', 'purchase_request.image_removed',
  'purchase_request_response.submitted', 'purchase_request_response.withdrawn',
  'purchase_request_response.shortlisted', 'purchase_request_response.unshortlisted'
));

-- ===========================================================================
-- 2. Tables
-- ===========================================================================
create type public.purchase_request_status as enum ('draft', 'published', 'closed', 'cancelled');
create type public.purchase_response_status as enum ('submitted', 'withdrawn');

create table public.purchase_requests (
  id                   uuid primary key default extensions.gen_random_uuid(),
  -- The person who owns / authored the request. For an organization request the ORGANIZATION
  -- (membership + rfq.create) manages it; the author is kept for accountability.
  requester_user_id    uuid not null references public.users (id) on delete restrict,
  requester_org_id     uuid references public.organizations (id) on delete restrict,
  -- Canonical audience code of the requester (same eight codes as product audiences).
  requester_audience   text not null references public.product_audience_types (code),
  title                text not null,
  notes                text,
  needed_by            date,
  share_with_showrooms boolean not null default false,
  status               public.purchase_request_status not null default 'draft',
  version              integer not null default 1,
  published_at         timestamptz,
  closed_at            timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ck_pr_title check (char_length(title) between 2 and 160),
  constraint ck_pr_notes check (notes is null or char_length(notes) <= 500),
  constraint ck_pr_published check (status not in ('published', 'closed') or published_at is not null),
  constraint ck_pr_share_showroom_only check (not share_with_showrooms or requester_audience = 'showroom_dealer'),
  constraint ck_pr_owner_shape check (
    (requester_org_id is null and requester_audience in ('contractor', 'engineer', 'installer_technician', 'end_consumer'))
    or
    (requester_org_id is not null and requester_audience in ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'engineer'))
  )
);
comment on table public.purchase_requests is
  'Published demand. requester_org_id is null for an INDIVIDUAL request (no fake organization). Cross-tenant reads only through purchase_requests_discover / purchase_request_detail; direct selects are owner-side only.';
create index ix_pr_org on public.purchase_requests (requester_org_id) where requester_org_id is not null;
create index ix_pr_user on public.purchase_requests (requester_user_id);
create index ix_pr_discover on public.purchase_requests (requester_audience, published_at desc) where status = 'published';
create trigger set_purchase_requests_updated_at before update on public.purchase_requests
  for each row execute function app.set_updated_at();

create table public.purchase_request_items (
  id            uuid primary key default extensions.gen_random_uuid(),
  request_id    uuid not null references public.purchase_requests (id) on delete cascade,
  position      smallint not null,
  name          text not null,
  code          text,
  category_code text not null references public.product_categories (code),
  color_items   jsonb not null default '[]'::jsonb,
  quantity      numeric(14, 3) not null,
  unit          public.product_unit not null,
  specs         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ck_pri_name check (char_length(name) between 2 and 160),
  constraint ck_pri_code check (code is null or char_length(code) <= 80),
  constraint ck_pri_specs check (specs is null or char_length(specs) <= 250),
  constraint ck_pri_qty check (quantity > 0 and quantity <= 1000000),
  constraint ck_pri_unit check (unit::text in ('kilogram', 'gallon', 'pail', 'roll', 'meter', 'sheet')),
  constraint uq_pri_position unique (request_id, position) deferrable initially deferred,
  constraint uq_pri_request_id unique (request_id, id)
);
create trigger set_purchase_request_items_updated_at before update on public.purchase_request_items
  for each row execute function app.set_updated_at();

create table public.purchase_request_images (
  id           uuid primary key default extensions.gen_random_uuid(),
  request_id   uuid not null,
  item_id      uuid not null,
  owner_scope  uuid not null,
  object_key   text not null unique,
  content_type text not null,
  slot         smallint not null,
  state        public.professional_asset_state not null default 'pending',
  created_by   uuid not null references public.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fk_pri_img_item foreign key (request_id, item_id)
    references public.purchase_request_items (request_id, id) on delete cascade,
  constraint ck_pri_img_key check (
    object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  constraint ck_pri_img_type check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint ck_pri_img_slot check (slot between 1 and 2)
);
create unique index uq_pri_img_slot on public.purchase_request_images (item_id, slot) where state <> 'deleted';
create index ix_pri_img_request on public.purchase_request_images (request_id) where state <> 'deleted';
create trigger set_purchase_request_images_updated_at before update on public.purchase_request_images
  for each row execute function app.set_updated_at();

create table public.purchase_request_responses (
  id               uuid primary key default extensions.gen_random_uuid(),
  request_id       uuid not null references public.purchase_requests (id) on delete cascade,
  responder_org_id uuid not null references public.organizations (id) on delete restrict,
  submitted_by     uuid not null references public.users (id) on delete restrict,
  status           public.purchase_response_status not null default 'submitted',
  coverage         text not null,
  currency         text not null default 'EGP',
  total            numeric(16, 2) not null,
  note             text,
  valid_until      date,
  shortlisted      boolean not null default false,
  shortlisted_by   uuid references public.users (id) on delete set null,
  shortlisted_at   timestamptz,
  version          integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_prr_one_per_responder unique (request_id, responder_org_id),
  constraint ck_prr_coverage check (coverage in ('full', 'partial')),
  constraint ck_prr_currency check (currency = 'EGP'),
  constraint ck_prr_total check (total >= 0),
  constraint ck_prr_note check (note is null or char_length(note) <= 500),
  constraint ck_prr_shortlist check (not shortlisted or status = 'submitted')
);
comment on table public.purchase_request_responses is
  'Independent, NON-BINDING responses to a published request (Option A). One live response per responder organization; the responder sees its own, the requester sees all submitted. Shortlisting never creates an order or closes the request.';
create index ix_prr_responder on public.purchase_request_responses (responder_org_id);
create trigger set_purchase_request_responses_updated_at before update on public.purchase_request_responses
  for each row execute function app.set_updated_at();

create table public.purchase_request_response_items (
  id                 uuid primary key default extensions.gen_random_uuid(),
  response_id        uuid not null references public.purchase_request_responses (id) on delete cascade,
  request_item_id    uuid not null references public.purchase_request_items (id) on delete cascade,
  -- Snapshots of what was asked, so a comparison stays truthful.
  requested_quantity numeric(14, 3) not null,
  unit               public.product_unit not null,
  offered_quantity   numeric(14, 3) not null,
  unit_price         numeric(14, 2) not null,
  line_total         numeric(16, 2) generated always as (round(offered_quantity * unit_price, 2)) stored,
  note               text,
  constraint uq_prri_item unique (response_id, request_item_id),
  constraint ck_prri_offered check (offered_quantity > 0 and offered_quantity <= requested_quantity),
  constraint ck_prri_price check (unit_price > 0 and unit_price <= 100000000),
  constraint ck_prri_note check (note is null or char_length(note) <= 250)
);

-- ===========================================================================
-- 3. Access helpers (definer so policies/RPCs avoid recursion)
-- ===========================================================================
-- The caller authored an individual request or belongs to the owning organization.
create or replace function app.is_request_owner_side(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_requests r
     where r.id = p_request_id
       and ((r.requester_org_id is null and r.requester_user_id = (select auth.uid()))
            or (r.requester_org_id is not null and app.is_org_member(r.requester_org_id))));
$$;

-- May manage (edit, publish, close, shortlist): the individual author, or an organization
-- member holding rfq.create / org.manage.
create or replace function app.can_manage_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.purchase_requests r
     where r.id = p_request_id
       and ((r.requester_org_id is null and r.requester_user_id = (select auth.uid()))
            or (r.requester_org_id is not null and app.can_create_rfq(r.requester_org_id))));
$$;

-- The audience a workspace discovers requests as: showroom / supplier / manufacturer / importer
-- only. Engineers, contractors, craftsmen and personal accounts only POST requests.
create or replace function app.viewer_request_audience(p_org_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_org_id is null then return null; end if;
  v := app.viewer_product_audience(p_org_id);  -- verifies membership, raises otherwise
  return case when v in ('showroom_dealer', 'supplier', 'manufacturer', 'importer') then v else null end;
end;
$$;

-- THE visibility matrix. Pure of workspace membership (callers verify that); excludes the
-- caller's own requests (by organization AND by author).
create or replace function app.request_visible_to(p_request_id uuid, p_viewer_org_id uuid, p_viewer_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_viewer_audience is not null
     and exists (
       select 1
         from public.purchase_requests r
        where r.id = p_request_id
          and r.status = 'published'
          and r.requester_user_id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
          and r.requester_org_id is distinct from p_viewer_org_id
          -- The requester organization must be live ONLY when an organization owns the request.
          and (r.requester_org_id is null
               or exists (select 1 from public.organizations o where o.id = r.requester_org_id and o.deleted_at is null))
          and case r.requester_audience
                when 'installer_technician' then p_viewer_audience = 'showroom_dealer'
                when 'contractor'           then p_viewer_audience = 'showroom_dealer'
                when 'engineer'             then p_viewer_audience = 'showroom_dealer'
                when 'end_consumer'         then p_viewer_audience = 'showroom_dealer'
                when 'showroom_dealer'      then p_viewer_audience in ('supplier', 'manufacturer', 'importer')
                                                 or (r.share_with_showrooms and p_viewer_audience = 'showroom_dealer')
                when 'supplier'             then p_viewer_audience = 'supplier'
                when 'manufacturer'         then p_viewer_audience = 'manufacturer'
                when 'importer'             then p_viewer_audience = 'importer'
                else false end);
$$;

-- Readable by a workspace: it is in the audience, OR it already answered (a responder keeps
-- access after the request closes).
create or replace function app.request_readable_by_workspace(p_request_id uuid, p_viewer_org_id uuid, p_viewer_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.request_visible_to(p_request_id, p_viewer_org_id, p_viewer_audience)
      or exists (select 1 from public.purchase_request_responses x
                  where x.request_id = p_request_id and x.responder_org_id = p_viewer_org_id
                    and x.status = 'submitted');
$$;

revoke execute on function app.is_request_owner_side(uuid), app.can_manage_request(uuid),
  app.viewer_request_audience(uuid), app.request_visible_to(uuid, uuid, text),
  app.request_readable_by_workspace(uuid, uuid, text) from public;
grant execute on function app.is_request_owner_side(uuid), app.can_manage_request(uuid) to authenticated;

-- ===========================================================================
-- 4. RLS: owner-side reads only; every write is an RPC
-- ===========================================================================
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.purchase_request_images enable row level security;
alter table public.purchase_request_responses enable row level security;
alter table public.purchase_request_response_items enable row level security;

create policy pr_select_owner_side on public.purchase_requests
  for select to authenticated using (app.is_request_owner_side(id));
create policy pr_select_platform on public.purchase_requests
  for select to authenticated using (app.is_platform('support'));
create policy pri_select_owner_side on public.purchase_request_items
  for select to authenticated using (app.is_request_owner_side(request_id));
create policy pri_img_select_owner_side on public.purchase_request_images
  for select to authenticated using (state <> 'deleted' and app.is_request_owner_side(request_id));
-- A responder reads ITS OWN response (any status); the requester reads every SUBMITTED one.
create policy prr_select_responder on public.purchase_request_responses
  for select to authenticated using (app.is_org_member(responder_org_id));
create policy prr_select_requester on public.purchase_request_responses
  for select to authenticated using (status = 'submitted' and app.is_request_owner_side(request_id));
create policy prri_select_responder on public.purchase_request_response_items
  for select to authenticated
  using (exists (select 1 from public.purchase_request_responses x
                  where x.id = response_id and app.is_org_member(x.responder_org_id)));
create policy prri_select_requester on public.purchase_request_response_items
  for select to authenticated
  using (exists (select 1 from public.purchase_request_responses x
                  where x.id = response_id and x.status = 'submitted' and app.is_request_owner_side(x.request_id)));

revoke all on public.purchase_requests, public.purchase_request_items, public.purchase_request_images,
  public.purchase_request_responses, public.purchase_request_response_items
  from public, anon, authenticated, service_role;
grant select on public.purchase_requests, public.purchase_request_items, public.purchase_request_images,
  public.purchase_request_responses, public.purchase_request_response_items to authenticated;

-- ===========================================================================
-- 5. Validation helpers
-- ===========================================================================
create or replace function app.request_item_normalize(p_item jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_name  text := btrim(regexp_replace(coalesce(p_item ->> 'name', ''), '\s+', ' ', 'g'));
  v_code  text := nullif(btrim(regexp_replace(coalesce(p_item ->> 'code', ''), '\s+', ' ', 'g')), '');
  v_cat   text := nullif(btrim(coalesce(p_item ->> 'category_code', '')), '');
  v_specs text := nullif(btrim(coalesce(p_item ->> 'specs', '')), '');
  v_unit  text := nullif(btrim(coalesce(p_item ->> 'unit', '')), '');
  v_qty   numeric;
begin
  if char_length(v_name) not between 2 and 160 then
    raise exception 'an item name is required (2 to 160 characters)' using errcode = '22023';
  end if;
  if v_code is not null and char_length(v_code) > 80 then
    raise exception 'an item code is limited to 80 characters' using errcode = '22023';
  end if;
  if v_cat is null or not exists (select 1 from public.product_categories c where c.code = v_cat and c.is_active) then
    raise exception 'unknown or inactive product category' using errcode = '22023';
  end if;
  if v_specs is not null and char_length(v_specs) > 250 then
    raise exception 'specifications are limited to 250 characters' using errcode = '22023';
  end if;
  if v_unit is null or v_unit <> all (array['kilogram', 'gallon', 'pail', 'roll', 'meter', 'sheet']) then
    raise exception 'unit is not one of the supported product units' using errcode = '22023';
  end if;
  begin
    v_qty := (p_item ->> 'quantity')::numeric;
  exception when others then
    raise exception 'quantity must be a number' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 or v_qty > 1000000 or round(v_qty, 3) <> v_qty then
    raise exception 'quantity must be positive, at most 1,000,000, with at most 3 decimals' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'name', v_name, 'code', v_code, 'category_code', v_cat, 'specs', v_specs, 'unit', v_unit,
    'quantity', v_qty, 'color_items', app.normalize_product_color_items(coalesce(p_item -> 'color_items', '[]'::jsonb)));
end;
$$;
revoke execute on function app.request_item_normalize(jsonb) from public;

-- ===========================================================================
-- 6. Requester write RPCs
-- ===========================================================================
-- Create (p_request_id null) or update a DRAFT. Items are merged by id: listed ids update,
-- new entries insert, omitted items are removed (with their images).
create or replace function public.purchase_request_save(
  p_org_id               uuid,
  p_request_id           uuid,
  p_expected_version     integer,
  p_title                text,
  p_notes                text,
  p_needed_by            date,
  p_share_with_showrooms boolean,
  p_items                jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := app.require_verified_caller();
  v_r     public.purchase_requests;
  v_aud   text;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_share boolean := coalesce(p_share_with_showrooms, false);
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_item  jsonb;
  v_norm  jsonb;
  v_ids   uuid[] := '{}';
  v_id    uuid;
  v_pos   smallint := 0;
begin
  if char_length(v_title) not between 2 and 160 then
    raise exception 'a request title is required (2 to 160 characters)' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'notes are limited to 500 characters' using errcode = '22023';
  end if;
  if p_needed_by is not null and p_needed_by < current_date then
    raise exception 'the needed-by date cannot be in the past' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 30 then
    raise exception 'a request holds at most 30 items' using errcode = '22023';
  end if;

  if p_request_id is null then
    if p_org_id is not null then
      if not app.is_org_member(p_org_id) then
        raise exception 'not a member of this organization' using errcode = '42501';
      end if;
      if not app.can_create_rfq(p_org_id) then
        raise exception 'rfq.create required' using errcode = '42501';
      end if;
      if not exists (select 1 from public.organizations o where o.id = p_org_id and o.deleted_at is null) then
        raise exception 'organization is not active' using errcode = '22023';
      end if;
      v_aud := app.org_product_audience(p_org_id);
      if v_aud is null then
        raise exception 'this organization type cannot publish purchase requests' using errcode = '22023';
      end if;
    else
      -- Individual: the author's own personal persona; Sales Team and legacy personas must act
      -- through a workspace.
      select app.persona_product_audience(u.primary_account_type::text) into v_aud
        from public.users u where u.id = v_uid;
      if v_aud is null then
        raise exception 'your account type cannot publish an individual purchase request' using errcode = '22023';
      end if;
    end if;
    if v_share and v_aud <> 'showroom_dealer' then
      raise exception 'only a showroom can share a request with other showrooms' using errcode = '22023';
    end if;
    insert into public.purchase_requests (requester_user_id, requester_org_id, requester_audience, title, notes,
                                          needed_by, share_with_showrooms)
    values (v_uid, p_org_id, v_aud, v_title, v_notes, p_needed_by, v_share)
    returning * into v_r;
  else
    select * into v_r from public.purchase_requests where id = p_request_id for update;
    if not found or not app.is_request_owner_side(p_request_id) then
      raise exception 'purchase request not found' using errcode = 'P0002';
    end if;
    if not app.can_manage_request(p_request_id) then
      raise exception 'rfq.create required' using errcode = '42501';
    end if;
    if v_r.status <> 'draft' then
      raise exception 'only a draft request can be edited' using errcode = '22023';
    end if;
    if v_r.version <> p_expected_version then
      raise exception 'purchase request was modified concurrently' using errcode = '40001';
    end if;
    if v_share and v_r.requester_audience <> 'showroom_dealer' then
      raise exception 'only a showroom can share a request with other showrooms' using errcode = '22023';
    end if;
    update public.purchase_requests
       set title = v_title, notes = v_notes, needed_by = p_needed_by, share_with_showrooms = v_share,
           version = version + 1
     where id = p_request_id
    returning * into v_r;
  end if;

  -- Items: validate everything first, then merge.
  for v_item in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'each item must be an object' using errcode = '22023';
    end if;
    v_norm := app.request_item_normalize(v_item);
    v_pos := v_pos + 1;
    v_id := nullif(v_item ->> 'id', '')::uuid;
    if v_id is not null then
      if v_id = any (v_ids) then
        raise exception 'an item appears twice' using errcode = '22023';
      end if;
      update public.purchase_request_items
         set position = -v_pos,  -- park, then place (the unique position is deferred anyway)
             name = v_norm ->> 'name', code = v_norm ->> 'code', category_code = v_norm ->> 'category_code',
             color_items = v_norm -> 'color_items', quantity = (v_norm ->> 'quantity')::numeric,
             unit = (v_norm ->> 'unit')::public.product_unit, specs = v_norm ->> 'specs'
       where id = v_id and request_id = v_r.id;
      if not found then
        raise exception 'item does not belong to this request' using errcode = '22023';
      end if;
    else
      insert into public.purchase_request_items (request_id, position, name, code, category_code, color_items, quantity, unit, specs)
      values (v_r.id, -v_pos, v_norm ->> 'name', v_norm ->> 'code', v_norm ->> 'category_code', v_norm -> 'color_items',
              (v_norm ->> 'quantity')::numeric, (v_norm ->> 'unit')::public.product_unit, v_norm ->> 'specs')
      returning id into v_id;
    end if;
    v_ids := v_ids || v_id;
  end loop;
  delete from public.purchase_request_items where request_id = v_r.id and id <> all (v_ids);
  update public.purchase_request_items set position = -position where request_id = v_r.id and position < 0;

  perform app.record_audit_event(
    case when p_request_id is null then 'purchase_request.created' else 'purchase_request.updated' end,
    'purchase_request', v_r.id, v_r.requester_org_id,
    jsonb_build_object('audience', v_r.requester_audience, 'items', jsonb_array_length(v_items)));
  return v_r.id;
end;
$$;

create or replace function app.purchase_request_transition(p_request_id uuid, p_expected_version integer, p_to public.purchase_request_status)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_r public.purchase_requests;
begin
  perform app.require_verified_caller();
  select * into v_r from public.purchase_requests where id = p_request_id for update;
  if not found or not app.is_request_owner_side(p_request_id) then
    raise exception 'purchase request not found' using errcode = 'P0002';
  end if;
  if not app.can_manage_request(p_request_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if v_r.version <> p_expected_version then
    raise exception 'purchase request was modified concurrently' using errcode = '40001';
  end if;
  if p_to = 'published' then
    if v_r.status <> 'draft' then raise exception 'only a draft can be published' using errcode = '22023'; end if;
    if not exists (select 1 from public.purchase_request_items i where i.request_id = p_request_id) then
      raise exception 'add at least one item before publishing' using errcode = '22023';
    end if;
    if v_r.requester_org_id is not null
       and not exists (select 1 from public.organizations o where o.id = v_r.requester_org_id and o.deleted_at is null) then
      raise exception 'organization is not active' using errcode = '22023';
    end if;
  elsif p_to = 'closed' then
    if v_r.status <> 'published' then raise exception 'only a published request can be closed' using errcode = '22023'; end if;
  elsif p_to = 'cancelled' then
    if v_r.status not in ('draft', 'published') then raise exception 'this request can no longer be cancelled' using errcode = '22023'; end if;
  end if;
  update public.purchase_requests set
    status       = p_to,
    published_at = case when p_to = 'published' then now() else published_at end,
    closed_at    = case when p_to = 'closed' then now() else closed_at end,
    cancelled_at = case when p_to = 'cancelled' then now() else cancelled_at end,
    version      = version + 1
   where id = p_request_id;
  perform app.record_audit_event('purchase_request.' || case p_to when 'published' then 'published' when 'closed' then 'closed' else 'cancelled' end,
    'purchase_request', p_request_id, v_r.requester_org_id, '{}'::jsonb);
  return v_r.version + 1;
end;
$$;
revoke execute on function app.purchase_request_transition(uuid, integer, public.purchase_request_status) from public;

create or replace function public.purchase_request_publish(p_request_id uuid, p_expected_version integer)
returns integer language sql security definer set search_path = '' as $$
  select app.purchase_request_transition(p_request_id, p_expected_version, 'published');
$$;
create or replace function public.purchase_request_close(p_request_id uuid, p_expected_version integer)
returns integer language sql security definer set search_path = '' as $$
  select app.purchase_request_transition(p_request_id, p_expected_version, 'closed');
$$;
create or replace function public.purchase_request_cancel(p_request_id uuid, p_expected_version integer)
returns integer language sql security definer set search_path = '' as $$
  select app.purchase_request_transition(p_request_id, p_expected_version, 'cancelled');
$$;

-- ===========================================================================
-- 7. Reference images (draft only, up to 2 per item)
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-request-images', 'purchase-request-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.purchase_request_image_request_upload(p_item_id uuid, p_content_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_item public.purchase_request_items;
  v_r    public.purchase_requests;
  v_ext  text := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
  v_pos  smallint;
  v_key  text;
begin
  perform app.require_verified_caller();
  if v_ext is null then raise exception 'unsupported content type' using errcode = '22023'; end if;
  select * into v_item from public.purchase_request_items where id = p_item_id;
  if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
  select * into v_r from public.purchase_requests where id = v_item.request_id for update;
  if not app.is_request_owner_side(v_r.id) then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not app.can_manage_request(v_r.id) then raise exception 'rfq.create required' using errcode = '42501'; end if;
  if v_r.status <> 'draft' then raise exception 'only a draft request can be edited' using errcode = '22023'; end if;
  update public.purchase_request_images set state = 'deleted'
   where item_id = p_item_id and state = 'pending' and created_at < now() - interval '1 hour';
  select s into v_pos from generate_series(1, 2) s
   where not exists (select 1 from public.purchase_request_images i where i.item_id = p_item_id and i.state <> 'deleted' and i.slot = s)
   order by s limit 1;
  if v_pos is null then raise exception 'an item can have at most 2 images' using errcode = '23514'; end if;
  v_key := coalesce(v_r.requester_org_id, v_r.requester_user_id)::text || '/' || v_r.id::text || '/'
           || extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.purchase_request_images (request_id, item_id, owner_scope, object_key, content_type, slot, created_by)
  values (v_r.id, p_item_id, coalesce(v_r.requester_org_id, v_r.requester_user_id), v_key, p_content_type, v_pos, (select auth.uid()));
  return v_key;
end;
$$;

create or replace function public.purchase_request_image_confirm_upload(p_object_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_i public.purchase_request_images;
begin
  perform app.require_verified_caller();
  select * into v_i from public.purchase_request_images
   where object_key = p_object_key and state = 'pending' and created_by = (select auth.uid()) for update;
  if not found then raise exception 'no matching pending image upload for this caller' using errcode = 'P0002'; end if;
  if not app.can_manage_request(v_i.request_id) then raise exception 'rfq.create required' using errcode = '42501'; end if;
  update public.purchase_request_images set state = 'ready' where id = v_i.id;
  perform app.record_audit_event('purchase_request.image_added', 'purchase_request', v_i.request_id,
    (select requester_org_id from public.purchase_requests where id = v_i.request_id), jsonb_build_object('slot', v_i.slot));
  return v_i.id;
end;
$$;

create or replace function public.purchase_request_image_remove(p_image_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_i public.purchase_request_images; v_status public.purchase_request_status;
begin
  perform app.require_verified_caller();
  select * into v_i from public.purchase_request_images where id = p_image_id and state <> 'deleted' for update;
  if not found or not app.is_request_owner_side(v_i.request_id) then
    raise exception 'image not found' using errcode = 'P0002';
  end if;
  if not app.can_manage_request(v_i.request_id) then raise exception 'rfq.create required' using errcode = '42501'; end if;
  select status into v_status from public.purchase_requests where id = v_i.request_id;
  if v_status <> 'draft' then raise exception 'only a draft request can be edited' using errcode = '22023'; end if;
  update public.purchase_request_images set state = 'deleted' where id = v_i.id;
  perform app.record_audit_event('purchase_request.image_removed', 'purchase_request', v_i.request_id,
    (select requester_org_id from public.purchase_requests where id = v_i.request_id), jsonb_build_object('slot', v_i.slot));
  return v_i.object_key;
end;
$$;

-- Storage predicates (owner side).
create or replace function app.can_upload_request_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.purchase_request_images i
                  where i.object_key = p_key and i.state = 'pending'
                    and i.created_by = (select auth.uid()) and app.can_manage_request(i.request_id));
$$;
create or replace function app.can_read_request_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.purchase_request_images i
                  where i.object_key = p_key and i.state <> 'deleted' and app.is_request_owner_side(i.request_id));
$$;
create or replace function app.can_delete_request_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.purchase_request_images i
                  where i.object_key = p_key and app.can_manage_request(i.request_id));
$$;
revoke execute on function app.can_upload_request_image_object(text), app.can_read_request_image_object(text),
  app.can_delete_request_image_object(text) from public;
grant execute on function app.can_upload_request_image_object(text), app.can_read_request_image_object(text),
  app.can_delete_request_image_object(text) to authenticated;

-- Another workspace may sign an image only while it can read the request, re-checked on EVERY use.
create table public.request_image_grants (
  user_id          uuid not null references public.users (id) on delete cascade,
  object_key       text not null,
  workspace_org_id uuid not null,
  expires_at       timestamptz not null,
  primary key (user_id, object_key)
);
alter table public.request_image_grants enable row level security;
revoke all on public.request_image_grants from public, anon, authenticated, service_role;

create or replace function app.request_image_viewable(p_request_id uuid, p_org_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_aud text;
begin
  if (select auth.uid()) is null or p_org_id is null or not app.is_org_member(p_org_id) then return false; end if;
  v_aud := app.viewer_request_audience(p_org_id);
  return app.request_readable_by_workspace(p_request_id, p_org_id, v_aud);
end;
$$;
revoke execute on function app.request_image_viewable(uuid, uuid) from public;

create or replace function public.request_image_access_grant(p_org_id uuid, p_keys text[])
returns text[] language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_out text[];
begin
  if v_uid is null then return '{}'; end if;
  perform app.viewer_request_audience(p_org_id);  -- raises for a workspace the caller is not in
  delete from public.request_image_grants
   where user_id = v_uid and (expires_at <= now() or workspace_org_id is distinct from p_org_id);
  with ok as (
    select distinct i.object_key
      from public.purchase_request_images i
     where i.object_key = any (coalesce(p_keys[1:60], '{}'))
       and i.state = 'ready'
       and app.request_image_viewable(i.request_id, p_org_id)
  ), ins as (
    insert into public.request_image_grants (user_id, object_key, workspace_org_id, expires_at)
    select v_uid, ok.object_key, p_org_id, now() + interval '30 minutes' from ok
    on conflict (user_id, object_key) do update
      set workspace_org_id = excluded.workspace_org_id, expires_at = excluded.expires_at
    returning object_key
  )
  select coalesce(array_agg(object_key), '{}') into v_out from ins;
  return v_out;
end;
$$;

create or replace function app.has_request_image_grant(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.request_image_grants g
      join public.purchase_request_images i on i.object_key = g.object_key and i.state = 'ready'
     where g.user_id = (select auth.uid()) and g.object_key = p_key and g.expires_at > now()
       and app.request_image_viewable(i.request_id, g.workspace_org_id));
$$;
revoke execute on function app.has_request_image_grant(text) from public;
grant execute on function app.has_request_image_grant(text) to authenticated;

create policy request_images_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'purchase-request-images' and app.can_upload_request_image_object(name));
create policy request_images_select_owner on storage.objects
  for select to authenticated
  using (bucket_id = 'purchase-request-images' and app.can_read_request_image_object(name));
create policy request_images_delete_manager on storage.objects
  for delete to authenticated
  using (bucket_id = 'purchase-request-images' and app.can_delete_request_image_object(name));
create policy request_images_select_viewer on storage.objects
  for select to authenticated
  using (bucket_id = 'purchase-request-images'
         and (storage.allow_only_operation('storage.object.sign') or storage.allow_only_operation('storage.object.sign_many'))
         and app.has_request_image_grant(name));

-- ===========================================================================
-- 8. Workspace-aware discovery readers (the ONLY cross-tenant door)
-- ===========================================================================
create or replace function app.request_items_json(p_request_id uuid, p_with_images boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'position', i.position, 'name', i.name, 'code', i.code, 'category_code', i.category_code,
           'color_items', i.color_items, 'quantity', i.quantity, 'unit', i.unit::text, 'specs', i.specs,
           'images', case when p_with_images then coalesce((
                       select jsonb_agg(jsonb_build_object('id', m.id, 'key', m.object_key, 'slot', m.slot) order by m.slot)
                         from public.purchase_request_images m where m.item_id = i.id and m.state = 'ready'), '[]'::jsonb)
                     else '[]'::jsonb end)
         order by i.position), '[]'::jsonb)
    from public.purchase_request_items i where i.request_id = p_request_id;
$$;
revoke execute on function app.request_items_json(uuid, boolean) from public;

create or replace function app.response_json(p_response_id uuid, p_with_responder boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', x.id, 'request_id', x.request_id, 'status', x.status::text, 'coverage', x.coverage,
           'currency', x.currency, 'total', x.total, 'note', x.note, 'valid_until', x.valid_until,
           'shortlisted', x.shortlisted, 'submitted_at', x.updated_at, 'version', x.version,
           'responder', case when p_with_responder
                             then (select jsonb_build_object('id', o.id, 'name', o.name, 'verified', o.is_verified, 'slug', o.slug)
                                     from public.organizations o where o.id = x.responder_org_id)
                             else null end,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'request_item_id', y.request_item_id, 'requested_quantity', y.requested_quantity,
                      'unit', y.unit::text, 'offered_quantity', y.offered_quantity, 'unit_price', y.unit_price,
                      'line_total', y.line_total, 'note', y.note) order by it.position)
               from public.purchase_request_response_items y
               join public.purchase_request_items it on it.id = y.request_item_id
              where y.response_id = x.id), '[]'::jsonb))
    from public.purchase_request_responses x where x.id = p_response_id;
$$;
revoke execute on function app.response_json(uuid, boolean) from public;

-- Discovery list for the ACTIVE workspace. PostgREST can filter / order / page the result.
create or replace function public.purchase_requests_discover(p_org_id uuid)
returns table (
  id                 uuid,
  title              text,
  notes              text,
  requester_audience text,
  requester_org_id   uuid,
  requester_name     text,
  requester_verified boolean,
  needed_by          date,
  published_at       timestamptz,
  item_count         integer,
  category_codes     text[],
  my_response_id     uuid,
  my_response_status text
) language plpgsql stable security definer set search_path = '' as $$
declare v_aud text := app.viewer_request_audience(p_org_id);
begin
  if v_aud is null then return; end if;
  return query
  select r.id, r.title, r.notes, r.requester_audience, r.requester_org_id,
         o.name, o.is_verified, r.needed_by, r.published_at,
         (select count(*)::int from public.purchase_request_items i where i.request_id = r.id),
         (select coalesce(array_agg(distinct i.category_code), '{}') from public.purchase_request_items i where i.request_id = r.id),
         x.id, x.status::text
    from public.purchase_requests r
    left join public.organizations o on o.id = r.requester_org_id
    left join public.purchase_request_responses x on x.request_id = r.id and x.responder_org_id = p_org_id
   where app.request_visible_to(r.id, p_org_id, v_aud);
end;
$$;

-- One request for a discovering / responding workspace, with items, images and its own response.
create or replace function public.purchase_request_detail(p_org_id uuid, p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_aud text := app.viewer_request_audience(p_org_id); v_r public.purchase_requests; v_resp uuid;
begin
  if v_aud is null or not app.request_readable_by_workspace(p_request_id, p_org_id, v_aud) then return null; end if;
  select * into v_r from public.purchase_requests where id = p_request_id;
  select x.id into v_resp from public.purchase_request_responses x
   where x.request_id = p_request_id and x.responder_org_id = p_org_id;
  return jsonb_build_object(
    'id', v_r.id, 'title', v_r.title, 'notes', v_r.notes, 'status', v_r.status::text, 'needed_by', v_r.needed_by,
    'published_at', v_r.published_at, 'requester_audience', v_r.requester_audience,
    'requester', case when v_r.requester_org_id is null then null
                      else (select jsonb_build_object('id', o.id, 'name', o.name, 'verified', o.is_verified, 'slug', o.slug)
                              from public.organizations o where o.id = v_r.requester_org_id) end,
    'can_respond', app.request_visible_to(p_request_id, p_org_id, v_aud),
    'items', app.request_items_json(p_request_id, true),
    'my_response', case when v_resp is null then null else app.response_json(v_resp, false) end);
end;
$$;

-- The requester's comparison view: every submitted response, with responder identity.
create or replace function public.purchase_request_responses_for_requester(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_request_owner_side(p_request_id) then return null; end if;
  return coalesce((select jsonb_agg(app.response_json(x.id, true) order by x.shortlisted desc, x.total, x.id)
                     from public.purchase_request_responses x
                    where x.request_id = p_request_id and x.status = 'submitted'), '[]'::jsonb);
end;
$$;

-- ===========================================================================
-- 9. Responses
-- ===========================================================================
create or replace function public.purchase_request_response_save(
  p_org_id      uuid,
  p_request_id  uuid,
  p_note        text,
  p_valid_until date,
  p_items       jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_aud    text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_items  jsonb := coalesce(p_items, '[]'::jsonb);
  v_resp   public.purchase_request_responses;
  v_e      jsonb;
  v_ri     public.purchase_request_items;
  v_off    numeric;
  v_price  numeric;
  v_seen   uuid[] := '{}';
  v_n_full integer := 0;
  v_total  numeric := 0;
  v_count  integer;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_respond_rfq(p_org_id) then
    raise exception 'rfq.respond required' using errcode = '42501';
  end if;
  v_aud := app.viewer_request_audience(p_org_id);
  -- No oracle: a request the workspace cannot see (or its own) is simply not found.
  if not app.request_visible_to(p_request_id, p_org_id, v_aud) then
    raise exception 'purchase request not found' using errcode = 'P0002';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note is limited to 500 characters' using errcode = '22023';
  end if;
  if p_valid_until is not null and p_valid_until < current_date then
    raise exception 'the validity date cannot be in the past' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'a response needs at least one item' using errcode = '22023';
  end if;
  select count(*) into v_count from public.purchase_request_items where request_id = p_request_id;

  select * into v_resp from public.purchase_request_responses
   where request_id = p_request_id and responder_org_id = p_org_id for update;
  if not found then
    insert into public.purchase_request_responses (request_id, responder_org_id, submitted_by, coverage, total, note, valid_until)
    values (p_request_id, p_org_id, v_uid, 'partial', 0, v_note, p_valid_until)
    returning * into v_resp;
  else
    delete from public.purchase_request_response_items where response_id = v_resp.id;
  end if;

  for v_e in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'each response item must be an object' using errcode = '22023';
    end if;
    select * into v_ri from public.purchase_request_items
     where id = nullif(v_e ->> 'request_item_id', '')::uuid and request_id = p_request_id;
    if not found then
      raise exception 'item does not belong to this request' using errcode = '22023';
    end if;
    if v_ri.id = any (v_seen) then
      raise exception 'an item appears twice' using errcode = '22023';
    end if;
    v_seen := v_seen || v_ri.id;
    begin
      v_off := (v_e ->> 'offered_quantity')::numeric;
      v_price := (v_e ->> 'unit_price')::numeric;
    exception when others then
      raise exception 'quantity and price must be numbers' using errcode = '22023';
    end;
    -- Unit compatibility: no conversion; a stated unit must equal the requested one.
    if nullif(v_e ->> 'unit', '') is not null and (v_e ->> 'unit') <> v_ri.unit::text then
      raise exception 'unit must match the requested unit' using errcode = '22023';
    end if;
    if v_off is null or v_off <= 0 or v_off > v_ri.quantity or round(v_off, 3) <> v_off then
      raise exception 'offered quantity must be greater than 0 and at most the requested quantity (3 decimals)' using errcode = '22023';
    end if;
    if v_price is null or v_price <= 0 or v_price > 100000000 or round(v_price, 2) <> v_price then
      raise exception 'price must be a positive amount in EGP with at most 2 decimals' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(v_e ->> 'note', '')), '') is not null and char_length(btrim(v_e ->> 'note')) > 250 then
      raise exception 'a line note is limited to 250 characters' using errcode = '22023';
    end if;
    insert into public.purchase_request_response_items (response_id, request_item_id, requested_quantity, unit, offered_quantity, unit_price, note)
    values (v_resp.id, v_ri.id, v_ri.quantity, v_ri.unit, v_off, v_price, nullif(btrim(coalesce(v_e ->> 'note', '')), ''));
    if v_off = v_ri.quantity then v_n_full := v_n_full + 1; end if;
  end loop;

  select coalesce(sum(line_total), 0) into v_total from public.purchase_request_response_items where response_id = v_resp.id;
  update public.purchase_request_responses set
    status = 'submitted', note = v_note, valid_until = p_valid_until, submitted_by = v_uid, total = v_total,
    coverage = case when v_n_full = v_count and cardinality(v_seen) = v_count then 'full' else 'partial' end,
    -- A revised response must be re-reviewed: any earlier shortlist mark is cleared.
    shortlisted = false, shortlisted_by = null, shortlisted_at = null,
    version = version + 1
   where id = v_resp.id;
  perform app.record_audit_event('purchase_request_response.submitted', 'purchase_request', p_request_id, p_org_id,
    jsonb_build_object('items', cardinality(v_seen), 'coverage', case when v_n_full = v_count and cardinality(v_seen) = v_count then 'full' else 'partial' end));
  return v_resp.id;
end;
$$;

create or replace function public.purchase_request_response_withdraw(p_response_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_x public.purchase_request_responses;
begin
  perform app.require_verified_caller();
  select * into v_x from public.purchase_request_responses where id = p_response_id for update;
  if not found or not app.is_org_member(v_x.responder_org_id) then
    raise exception 'response not found' using errcode = 'P0002';
  end if;
  if not app.can_respond_rfq(v_x.responder_org_id) then
    raise exception 'rfq.respond required' using errcode = '42501';
  end if;
  if v_x.status = 'withdrawn' then return; end if;
  update public.purchase_request_responses
     set status = 'withdrawn', shortlisted = false, shortlisted_by = null, shortlisted_at = null, version = version + 1
   where id = v_x.id;
  perform app.record_audit_event('purchase_request_response.withdrawn', 'purchase_request', v_x.request_id, v_x.responder_org_id, '{}'::jsonb);
end;
$$;

-- Shortlist is a non-binding mark. It creates no order, allocates nothing and does NOT close the request.
create or replace function public.purchase_request_response_shortlist(p_response_id uuid, p_shortlisted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_verified_caller(); v_x public.purchase_request_responses; v_org uuid;
begin
  select * into v_x from public.purchase_request_responses where id = p_response_id for update;
  if not found or not app.is_request_owner_side(v_x.request_id) or v_x.status <> 'submitted' then
    raise exception 'response not found' using errcode = 'P0002';
  end if;
  if not app.can_manage_request(v_x.request_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if (select status from public.purchase_requests where id = v_x.request_id) = 'cancelled' then
    raise exception 'this request was cancelled' using errcode = '22023';
  end if;
  select requester_org_id into v_org from public.purchase_requests where id = v_x.request_id;
  update public.purchase_request_responses set
    shortlisted = coalesce(p_shortlisted, false),
    shortlisted_by = case when coalesce(p_shortlisted, false) then v_uid else null end,
    shortlisted_at = case when coalesce(p_shortlisted, false) then now() else null end
   where id = v_x.id;
  perform app.record_audit_event(
    case when coalesce(p_shortlisted, false) then 'purchase_request_response.shortlisted' else 'purchase_request_response.unshortlisted' end,
    'purchase_request', v_x.request_id, v_org, '{}'::jsonb);
end;
$$;

-- ===========================================================================
-- 10. Grants
-- ===========================================================================
revoke execute on function
  public.purchase_request_save(uuid, uuid, integer, text, text, date, boolean, jsonb),
  public.purchase_request_publish(uuid, integer), public.purchase_request_close(uuid, integer),
  public.purchase_request_cancel(uuid, integer),
  public.purchase_request_image_request_upload(uuid, text), public.purchase_request_image_confirm_upload(text),
  public.purchase_request_image_remove(uuid), public.request_image_access_grant(uuid, text[]),
  public.purchase_requests_discover(uuid), public.purchase_request_detail(uuid, uuid),
  public.purchase_request_responses_for_requester(uuid),
  public.purchase_request_response_save(uuid, uuid, text, date, jsonb),
  public.purchase_request_response_withdraw(uuid), public.purchase_request_response_shortlist(uuid, boolean)
  from public, anon;
grant execute on function
  public.purchase_request_save(uuid, uuid, integer, text, text, date, boolean, jsonb),
  public.purchase_request_publish(uuid, integer), public.purchase_request_close(uuid, integer),
  public.purchase_request_cancel(uuid, integer),
  public.purchase_request_image_request_upload(uuid, text), public.purchase_request_image_confirm_upload(text),
  public.purchase_request_image_remove(uuid), public.request_image_access_grant(uuid, text[]),
  public.purchase_requests_discover(uuid), public.purchase_request_detail(uuid, uuid),
  public.purchase_request_responses_for_requester(uuid),
  public.purchase_request_response_save(uuid, uuid, text, date, jsonb),
  public.purchase_request_response_withdraw(uuid), public.purchase_request_response_shortlist(uuid, boolean)
  to authenticated;
