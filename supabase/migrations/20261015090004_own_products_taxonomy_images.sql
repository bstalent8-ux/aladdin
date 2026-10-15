-- Own Products (منتجاتي) — canonical taxonomy, required units, product data, images.
--
-- EXTENDS the existing catalog (public.products, catalog_published_products,
-- app.can_write_catalog / can_publish_catalog, the security-definer RPC + audit
-- model of 20260810090001). Nothing is renamed, retyped or dropped; every legacy
-- column, enum value, RPC and view column keeps working for /b2b.
--
--   1. TAXONOMY   public.product_categories (stable English code + AR/EN labels +
--                 active flag) and products.category_code (NULLABLE FK). The
--                 legacy broad enum column `category` stays the compatibility
--                 bucket; historical products keep category_code NULL
--                 ("unclassified") — nothing is guessed from the broad value.
--   2. UNITS      product_unit gains gallon / pail / sheet (kilogram, roll and
--                 meter already exist). The own-products RPCs accept exactly the
--                 six required units for new/changed units; a historical product
--                 may keep the unit it already has.
--   3. DATA       colors text[] (normalized, case-insensitively distinct, <=12),
--                 weight_kg (always kilograms, independent of the selling unit),
--                 size_label (free text — there is no structured dimensions
--                 model), code_normalized (organization-scoped unique product
--                 code, kept in step with the existing `sku` column).
--   4. LIFECYCLE  archived_at. Active = published; inactive = draft and not
--                 archived; archived = archived_at set (always unpublished).
--                 No hard delete: RFQ/saved/order references must survive.
--   5. IMAGES     public.product_images — at most 3 per product, ordered, the
--                 lowest slot is primary — in a private `product-images`
--                 bucket governed by the same metadata-row ownership model as
--                 avatars/portfolio (pending row -> constrained upload -> confirm).
--                 The catalog view additionally exposes the primary image KEY; the
--                 legacy image_ref column is untouched and remains the fallback.
--   6. RPCs       own_product_create / own_product_update / own_product_set_archived,
--                 product_image_request_upload / _confirm_upload / _remove / _reorder.
--                 set_product_published is re-created only to refuse archived rows.

-- ===========================================================================
-- 1. Units (additive enum values; used only as text below, never as literals)
-- ===========================================================================
alter type public.product_unit add value if not exists 'gallon';
alter type public.product_unit add value if not exists 'pail';
alter type public.product_unit add value if not exists 'sheet';

-- ===========================================================================
-- 2. Taxonomy
-- ===========================================================================
create table public.product_categories (
  code        text primary key,
  label_ar    text not null,
  label_en    text not null,
  sort_order  smallint not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint ck_product_categories_code check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint ck_product_categories_labels check (char_length(label_ar) between 1 and 80 and char_length(label_en) between 1 and 80),
  constraint uq_product_categories_sort unique (sort_order)
);
comment on table public.product_categories is
  'Canonical showroom product taxonomy. Stable English machine code (never an Arabic string), AR/EN labels, active flag. Reference data: readable by every authenticated user, written only by migrations. Historical broad categories (products.category enum) are NOT mapped onto these.';

alter table public.product_categories enable row level security;
create policy product_categories_select_all on public.product_categories
  for select to authenticated using (true);
revoke all on public.product_categories from anon, authenticated, service_role;
grant select on public.product_categories to authenticated, service_role;

insert into public.product_categories (code, label_ar, label_en, sort_order) values
  ('wallpaper',          'ورق حائط',     'Wallpaper',            1),
  ('wood_alternative',   'بديل خشب',     'Wood alternative',     2),
  ('marble_alternative', 'بديل رخام',    'Marble alternative',   3),
  ('chipboard',          'شيبورد',       'Chipboard',            4),
  ('cornices',           'كرانيش',       'Cornices',             5),
  ('corners',            'زوايا',        'Corners',              6),
  ('panels',             'بانوهات',      'Panels',               7),
  ('skirting',           'وزر',          'Skirting',             8),
  ('interior_doors',     'ابواب داخلية', 'Interior doors',       9),
  ('security_doors',     'ابواب مصفحة',  'Security doors',      10),
  ('vinyl_flooring',     'ارضيات فينيل', 'Vinyl flooring',      11),
  ('spc_flooring',       'ارضيات SPC',   'SPC flooring',        12),
  ('curtains',           'ستائر',        'Curtains',            13),
  ('posters',            'بوسترات',      'Posters',             14),
  ('paints',             'دهانات',       'Paints',              15);

-- ===========================================================================
-- 3. products — additive columns
-- ===========================================================================
create or replace function app.product_colors_valid(p_colors text[])
returns boolean language sql immutable set search_path = '' as $$
  select p_colors is not null
     and cardinality(p_colors) <= 12
     and not exists (select 1 from unnest(p_colors) c where char_length(btrim(c)) not between 1 and 40)
     and (select count(distinct lower(btrim(c))) from unnest(p_colors) c) = cardinality(p_colors);
$$;

alter table public.products
  add column category_code    text references public.product_categories (code),
  add column colors           text[] not null default '{}',
  add column weight_kg        numeric(12, 3),
  add column size_label       text,
  add column code_normalized  text,
  add column archived_at      timestamptz;

alter table public.products
  add constraint ck_products_colors check (app.product_colors_valid(colors)),
  add constraint ck_products_weight check (weight_kg is null or (weight_kg >= 0 and weight_kg <= 1000000)),
  add constraint ck_products_size_len check (size_label is null or char_length(size_label) <= 80),
  add constraint ck_products_archived_is_draft check (archived_at is null or status = 'draft');

comment on column public.products.category_code is 'Canonical taxonomy code (product_categories). NULL = unclassified historical product; never inferred from the legacy broad `category`.';
comment on column public.products.colors is 'Distinct (case-insensitive), trimmed color names as entered; at most 12 of at most 40 characters. Stored verbatim — display language does not alter them.';
comment on column public.products.weight_kg is 'Product weight in KILOGRAMS. Independent of the selling `unit` (a roll may weigh 3.2 kg).';
comment on column public.products.size_label is 'Free-text size/dimensions label (e.g. "60×60 cm"). There is no structured width/height/depth model.';
comment on column public.products.code_normalized is 'upper(btrim(collapse-whitespace(sku))) — the organization-scoped uniqueness key for the product code. Maintained by trigger; NULL when sku is empty.';
comment on column public.products.archived_at is 'Archived (retired) marker. Archived products are always unpublished drafts, hidden from the public catalog, kept for RFQ/saved/order history, and restorable.';

create index ix_products_category_code on public.products (category_code)
  where status = 'published' and deleted_at is null and category_code is not null;
create index ix_products_org_archived on public.products (organization_id) where archived_at is not null;
create unique index uq_products_org_code on public.products (organization_id, code_normalized)
  where code_normalized is not null and deleted_at is null;

create or replace function app.products_set_code_normalized()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.code_normalized := nullif(upper(btrim(regexp_replace(coalesce(new.sku, ''), '\s+', ' ', 'g'))), '');
  return new;
end;
$$;
create trigger set_products_code_normalized
  before insert or update of sku on public.products
  for each row execute function app.products_set_code_normalized();

-- ===========================================================================
-- 4. Audit allow-list (append the new lifecycle / image events)
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
  -- Own Products
  'product.archived', 'product.restored',
  'product.image_added', 'product.image_removed', 'product.image_reordered'
)) not valid;

-- ===========================================================================
-- 5. product_images
-- ===========================================================================
create table public.product_images (
  id               uuid primary key default extensions.gen_random_uuid(),
  product_id       uuid not null,
  organization_id  uuid not null,
  object_key       text not null unique,
  content_type     text not null,
  slot         smallint not null,
  state            public.professional_asset_state not null default 'pending',
  created_by       uuid not null references public.users (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Composite FK: an image's organization is, by construction, its product's.
  constraint fk_product_images_product foreign key (organization_id, product_id)
    references public.products (organization_id, id) on delete cascade,
  constraint ck_product_images_key check (
    object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  constraint ck_product_images_type check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  -- 1..3 are the real slots; 4..6 exist only as scratch space while reordering.
  constraint ck_product_images_position check (slot between 1 and 6)
);
comment on table public.product_images is
  'Owned product photos: at most 3 live (pending/ready) rows per product, ordered by slot (lowest = primary). Owner-bound metadata row that the storage policies on the private product-images bucket consult; written only through the product_image_* RPCs.';

-- A slot holds one live image. Deleted rows free their slot.
create unique index uq_product_images_slot on public.product_images (product_id, slot) where state <> 'deleted';
create index ix_product_images_product on public.product_images (product_id) where state <> 'deleted';

create or replace function app.product_images_enforce_max()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.slot > 3 then
    raise exception 'image slot must be 1..3' using errcode = '23514';
  end if;
  if (select count(*) from public.product_images where product_id = new.product_id and state <> 'deleted') >= 3 then
    raise exception 'a product can have at most 3 images' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger product_images_max_three
  before insert on public.product_images
  for each row execute function app.product_images_enforce_max();
create trigger set_product_images_updated_at
  before update on public.product_images
  for each row execute function app.set_updated_at();

-- Is the product publicly visible right now? (definer: avoids RLS recursion in policies)
create or replace function app.product_is_public(p_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.products p
     where p.id = p_product_id and p.status = 'published' and p.deleted_at is null and p.archived_at is null);
$$;
revoke execute on function app.product_is_public(uuid) from public;
grant execute on function app.product_is_public(uuid) to authenticated;

alter table public.product_images enable row level security;
revoke all on public.product_images from anon, authenticated, service_role;
grant select on public.product_images to authenticated;
create policy product_images_select_org on public.product_images
  for select to authenticated using (state <> 'deleted' and app.is_org_member(organization_id));
create policy product_images_select_public on public.product_images
  for select to authenticated using (state = 'ready' and app.product_is_public(product_id));

-- ===========================================================================
-- 6. Storage: private bucket + ownership predicates + policies
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function app.can_upload_product_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.product_images i
     where i.object_key = p_key and i.state = 'pending'
       and i.created_by = (select auth.uid())
       and app.can_write_catalog(i.organization_id));
$$;
create or replace function app.can_read_product_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.product_images i
     where i.object_key = p_key and app.is_org_member(i.organization_id));
$$;
create or replace function app.can_delete_product_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.product_images i
     where i.object_key = p_key and app.can_write_catalog(i.organization_id));
$$;
create or replace function app.is_public_product_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.product_images i
     where i.object_key = p_key and i.state = 'ready' and app.product_is_public(i.product_id));
$$;
revoke execute on function app.can_upload_product_image_object(text), app.can_read_product_image_object(text),
  app.can_delete_product_image_object(text), app.is_public_product_image_object(text) from public;
grant execute on function app.can_upload_product_image_object(text), app.can_read_product_image_object(text),
  app.can_delete_product_image_object(text), app.is_public_product_image_object(text) to authenticated;

create policy product_images_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and app.can_upload_product_image_object(name));
create policy product_images_select_org on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and app.can_read_product_image_object(name));
create policy product_images_delete_writer on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and app.can_delete_product_image_object(name));
-- Sign-only read of a PUBLISHED product's ready images, for the authenticated catalog.
-- Both signing operations are named: a page signs a whole grid in one `sign_many` call.
-- Neither permits fetching bytes or listing — only minting a signed URL.
create policy product_images_select_public on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images'
         and (storage.allow_only_operation('storage.object.sign')
              or storage.allow_only_operation('storage.object.sign_many'))
         and app.is_public_product_image_object(name));
-- No UPDATE policy: an object key is immutable; replacement is a new object + a metadata switch.

-- ===========================================================================
-- 7. Catalog view: append canonical + descriptive columns and the primary image key
-- ===========================================================================
create or replace view public.catalog_published_products with (security_invoker = true) as
  select
    p.id, p.organization_id, o.name as supplier_name, o.is_verified as supplier_verified,
    o.slug as supplier_slug, p.name, p.sku, p.category, p.brand, p.short_description,
    p.unit, p.image_ref, p.published_at,
    p.category_code, p.colors, p.weight_kg, p.size_label,
    (select i.object_key from public.product_images i
      where i.product_id = p.id and i.state = 'ready'
      order by i.slot limit 1) as primary_image_key
  from public.products p
  join app._catalog_supplier_identity() o on o.id = p.organization_id
  where p.status = 'published' and p.deleted_at is null;

-- ===========================================================================
-- 8. Publishing: an archived product cannot be (re)published
-- ===========================================================================
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
    return v_p.version;  -- already in the requested state; no-op
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
-- 9. Own-product RPCs
-- ===========================================================================
create or replace function app.normalize_product_colors(p_colors text[])
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  v_out  text[] := '{}';
  v_seen text[] := '{}';
  v      text;
  v_n    text;
begin
  if p_colors is null then return '{}'; end if;
  foreach v in array p_colors loop
    v_n := btrim(regexp_replace(coalesce(v, ''), '\s+', ' ', 'g'));
    if v_n = '' then continue; end if;
    if char_length(v_n) > 40 then
      raise exception 'a color name is limited to 40 characters' using errcode = '22023';
    end if;
    if lower(v_n) = any (v_seen) then continue; end if;
    v_seen := v_seen || lower(v_n);
    v_out  := v_out || v_n;
  end loop;
  if cardinality(v_out) > 12 then
    raise exception 'a product can have at most 12 colors' using errcode = '22023';
  end if;
  return v_out;
end;
$$;

-- One validation path for create and update. Returns the display code.
create or replace function app.own_product_validate(
  p_org_id        uuid,
  p_exclude_id    uuid,
  p_name          text,
  p_code          text,
  p_category_code text,
  p_unit          public.product_unit,
  p_prev_unit     public.product_unit,
  p_weight_kg     numeric,
  p_size_label    text,
  p_brand         text,
  p_description   text
) returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_code text := btrim(regexp_replace(coalesce(p_code, ''), '\s+', ' ', 'g'));
  v_norm text;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 160 then
    raise exception 'product name must be 2 to 160 characters' using errcode = '22023';
  end if;
  if char_length(v_code) not between 1 and 60 or v_code ~ '[[:cntrl:]]' then
    raise exception 'product code must be 1 to 60 characters' using errcode = '22023';
  end if;
  if p_category_code is null or not exists (
       select 1 from public.product_categories c where c.code = p_category_code and c.is_active) then
    raise exception 'unknown or inactive product category' using errcode = '22023';
  end if;
  if p_unit is null or not (
       p_unit::text = any (array['kilogram', 'gallon', 'pail', 'roll', 'meter', 'sheet'])
       or p_unit is not distinct from p_prev_unit) then
    raise exception 'unit is not one of the supported product units' using errcode = '22023';
  end if;
  if p_weight_kg is not null and (p_weight_kg < 0 or p_weight_kg > 1000000) then
    raise exception 'weight must be a non-negative number of kilograms' using errcode = '22023';
  end if;
  if p_size_label is not null and char_length(p_size_label) > 80 then
    raise exception 'size is limited to 80 characters' using errcode = '22023';
  end if;
  if p_brand is not null and char_length(p_brand) > 120 then
    raise exception 'brand is limited to 120 characters' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 600 then
    raise exception 'description is limited to 600 characters' using errcode = '22023';
  end if;

  v_norm := upper(v_code);
  if exists (
       select 1 from public.products x
        where x.organization_id = p_org_id and x.deleted_at is null
          and x.id is distinct from p_exclude_id
          and (x.code_normalized = v_norm
               or upper(btrim(regexp_replace(coalesce(x.sku, ''), '\s+', ' ', 'g'))) = v_norm)) then
    raise exception 'this product code is already used in your organization' using errcode = '23505';
  end if;
  return v_code;
end;
$$;
revoke execute on function app.own_product_validate(uuid, uuid, text, text, text, public.product_unit, public.product_unit, numeric, text, text, text) from public;

create or replace function public.own_product_create(
  p_org_id        uuid,
  p_name          text,
  p_code          text,
  p_category_code text,
  p_unit          public.product_unit,
  p_colors        text[] default '{}',
  p_weight_kg     numeric default null,
  p_size_label    text default null,
  p_brand         text default null,
  p_description   text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_code text;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_write_catalog(p_org_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  v_code := app.own_product_validate(p_org_id, null, p_name, p_code, p_category_code, p_unit, null,
                                     p_weight_kg, nullif(btrim(p_size_label), ''), nullif(btrim(p_brand), ''),
                                     nullif(btrim(p_description), ''));
  -- `category` (legacy broad enum, NOT NULL) is the compatibility bucket: new products
  -- get the neutral 'other'; the canonical category_code is the authority.
  insert into public.products (organization_id, name, sku, category, category_code, brand, short_description,
                               unit, colors, weight_kg, size_label, created_by)
  values (p_org_id, btrim(p_name), v_code, 'other', p_category_code, nullif(btrim(p_brand), ''),
          nullif(btrim(p_description), ''), p_unit, app.normalize_product_colors(p_colors), p_weight_kg,
          nullif(btrim(p_size_label), ''), (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('product.created', 'product', v_id, p_org_id,
    jsonb_build_object('category_code', p_category_code, 'unit', p_unit));
  return v_id;
end;
$$;

create or replace function public.own_product_update(
  p_product_id       uuid,
  p_expected_version integer,
  p_name             text,
  p_code             text,
  p_category_code    text,
  p_unit             public.product_unit,
  p_colors           text[] default '{}',
  p_weight_kg        numeric default null,
  p_size_label       text default null,
  p_brand            text default null,
  p_description      text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_p    public.products;
  v_code text;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_catalog(v_p.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'product was modified concurrently (expected %, found %)', p_expected_version, v_p.version
      using errcode = '40001';
  end if;
  if v_p.archived_at is not null then
    raise exception 'an archived product must be restored before it can be edited' using errcode = '22023';
  end if;
  v_code := app.own_product_validate(v_p.organization_id, p_product_id, p_name, p_code, p_category_code, p_unit,
                                     v_p.unit, p_weight_kg, nullif(btrim(p_size_label), ''),
                                     nullif(btrim(p_brand), ''), nullif(btrim(p_description), ''));
  update public.products set
    name              = btrim(p_name),
    sku               = v_code,
    category_code     = p_category_code,
    unit              = p_unit,
    colors            = app.normalize_product_colors(p_colors),
    weight_kg         = p_weight_kg,
    size_label        = nullif(btrim(p_size_label), ''),
    brand             = nullif(btrim(p_brand), ''),
    short_description = nullif(btrim(p_description), ''),
    version           = version + 1
  where id = p_product_id;
  perform app.record_audit_event('product.updated', 'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

create or replace function public.own_product_set_archived(
  p_product_id       uuid,
  p_archived         boolean,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_p public.products;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_catalog(v_p.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'product was modified concurrently' using errcode = '40001';
  end if;
  if (v_p.archived_at is not null) = p_archived then
    return v_p.version;  -- already in the requested state; no-op
  end if;
  update public.products set
    archived_at  = case when p_archived then now() else null end,
    -- Archiving always withdraws the product from the public catalog.
    status       = case when p_archived then 'draft'::public.product_status else status end,
    published_at = case when p_archived then null else published_at end,
    version      = version + 1
  where id = p_product_id;
  perform app.record_audit_event(case when p_archived then 'product.archived' else 'product.restored' end,
    'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

-- ===========================================================================
-- 10. Image RPCs
-- ===========================================================================
create or replace function public.product_image_request_upload(p_product_id uuid, p_content_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_p    public.products;
  v_ext  text;
  v_pos  smallint;
  v_key  text;
begin
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
  if v_ext is null then
    raise exception 'unsupported content type' using errcode = '22023';
  end if;
  -- Locking the product row serializes slot allocation, so concurrent requests cannot overfill it.
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_catalog(v_p.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if v_p.archived_at is not null then
    raise exception 'an archived product must be restored before its images change' using errcode = '22023';
  end if;
  -- An abandoned pending slot does not block the product forever.
  update public.product_images set state = 'deleted'
   where product_id = p_product_id and state = 'pending' and created_at < now() - interval '1 hour';
  select s into v_pos from generate_series(1, 3) s
   where not exists (select 1 from public.product_images i
                      where i.product_id = p_product_id and i.state <> 'deleted' and i.slot = s)
   order by s limit 1;
  if v_pos is null then
    raise exception 'a product can have at most 3 images' using errcode = '23514';
  end if;
  v_key := v_p.organization_id::text || '/' || p_product_id::text || '/' || extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.product_images (product_id, organization_id, object_key, content_type, slot, created_by)
  values (p_product_id, v_p.organization_id, v_key, p_content_type, v_pos, (select auth.uid()));
  return v_key;
end;
$$;

create or replace function public.product_image_confirm_upload(p_object_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_i public.product_images;
begin
  select * into v_i from public.product_images
   where object_key = p_object_key and state = 'pending' and created_by = (select auth.uid()) for update;
  if not found then
    raise exception 'no matching pending image upload for this caller' using errcode = 'P0002';
  end if;
  if not app.can_write_catalog(v_i.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
-- (Metadata points AT stored files; no function reads the byte store. The server action confirms the bytes exist before calling this.)
  update public.product_images set state = 'ready' where id = v_i.id;
  perform app.record_audit_event('product.image_added', 'product', v_i.product_id, v_i.organization_id,
    jsonb_build_object('slot', v_i.slot));
  return v_i.id;
end;
$$;

-- Returns the storage key so the caller can delete the bytes after commit.
create or replace function public.product_image_remove(p_image_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_i public.product_images;
begin
  select * into v_i from public.product_images where id = p_image_id and state <> 'deleted' for update;
  if not found then raise exception 'image not found' using errcode = 'P0002'; end if;
  if not app.can_write_catalog(v_i.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  update public.product_images set state = 'deleted' where id = v_i.id;
  perform app.record_audit_event('product.image_removed', 'product', v_i.product_id, v_i.organization_id,
    jsonb_build_object('slot', v_i.slot));
  return v_i.object_key;
end;
$$;

-- New order = the given ready image ids, assigned over the slots those images already occupy.
create or replace function public.product_image_reorder(p_product_id uuid, p_image_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_p     public.products;
  v_slots smallint[];
  v_ids   uuid[];
  i       integer;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_catalog(v_p.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  select array_agg(slot order by slot), array_agg(id order by id)
    into v_slots, v_ids
    from public.product_images where product_id = p_product_id and state = 'ready';
  if p_image_ids is null
     or cardinality(p_image_ids) is distinct from coalesce(cardinality(v_ids), 0)
     or (select array_agg(x order by x) from unnest(p_image_ids) x) is distinct from v_ids then
    raise exception 'the order must list every ready image of the product exactly once' using errcode = '22023';
  end if;
  -- Park the images in the scratch slots 4..6, then place them.
  update public.product_images set slot = slot + 3 where product_id = p_product_id and state = 'ready';
  for i in 1 .. coalesce(cardinality(p_image_ids), 0) loop
    update public.product_images set slot = v_slots[i] where id = p_image_ids[i];
  end loop;
  perform app.record_audit_event('product.image_reordered', 'product', p_product_id, v_p.organization_id, '{}'::jsonb);
end;
$$;

-- ===========================================================================
-- 11. Grants
-- ===========================================================================
revoke execute on function
  public.own_product_create(uuid, text, text, text, public.product_unit, text[], numeric, text, text, text),
  public.own_product_update(uuid, integer, text, text, text, public.product_unit, text[], numeric, text, text, text),
  public.own_product_set_archived(uuid, boolean, integer),
  public.product_image_request_upload(uuid, text),
  public.product_image_confirm_upload(text),
  public.product_image_remove(uuid),
  public.product_image_reorder(uuid, uuid[])
  from public, anon;
grant execute on function
  public.own_product_create(uuid, text, text, text, public.product_unit, text[], numeric, text, text, text),
  public.own_product_update(uuid, integer, text, text, text, public.product_unit, text[], numeric, text, text, text),
  public.own_product_set_archived(uuid, boolean, integer),
  public.product_image_request_upload(uuid, text),
  public.product_image_confirm_upload(text),
  public.product_image_remove(uuid),
  public.product_image_reorder(uuid, uuid[])
  to authenticated;
