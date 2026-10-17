-- Own Products — base price, structured colors, 250-word description.
--
-- ADDITIVE on top of 20261008090001. Nothing legacy is dropped or retyped:
--
--   1. PRICE        products.base_price numeric(14,2), NULLABLE (historical products
--                   have none). Same money convention as the rest of the schema
--                   (numeric(14,2), EGP, no floats). Positive only. There is NO
--                   discounted / compare-at / percent column: promotional and package
--                   pricing belong to Product Offers.
--   2. COLORS       products.color_items jsonb — an ordered array of
--                   {"name": text, "hex": "#RRGGBB" | null}. The legacy `colors text[]`
--                   stays (names only) and is kept equal to the item names whenever
--                   color_items is non-empty, so every existing reader keeps working.
--                   A historical product has color_items = [] and its names in
--                   `colors`; its colors have hex = null until the user picks one —
--                   no value is ever guessed from a name.
--   3. DESCRIPTION  the limit is now 250 WORDS (was 600 characters). The old check is
--                   replaced by a word-count check plus a generous character ceiling.
--   4. RPCs         own_product_create / own_product_update take p_color_items and
--                   p_base_price. The old signatures are dropped (nothing but the app's
--                   own server actions calls them); grants are re-issued.

-- ===========================================================================
-- 1. Helpers
-- ===========================================================================
create or replace function app.word_count(p_text text)
returns integer language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p_text, '')) = '' then 0
              else cardinality(regexp_split_to_array(btrim(p_text), '[[:space:]]+')) end;
$$;

-- Normalizes an incoming color list: trims/collapses names, canonicalizes hex to
-- upper-case #RRGGBB (or NULL), drops case-insensitive duplicates, keeps order.
create or replace function app.normalize_product_color_items(p_items jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out  jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  e      jsonb;
  v_name text;
  v_hex  text;
begin
  if p_items is null or p_items = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'colors must be a list' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'each color must be an object with a name and a value' using errcode = '22023';
    end if;
    v_name := btrim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g'));
    if v_name = '' then continue; end if;
    if char_length(v_name) > 40 then
      raise exception 'a color name is limited to 40 characters' using errcode = '22023';
    end if;
    v_hex := nullif(btrim(coalesce(e ->> 'hex', '')), '');
    if v_hex is not null then
      v_hex := upper(v_hex);
      if v_hex !~ '^#[0-9A-F]{6}$' then
        raise exception 'a color value must be a hex code like #B96F52' using errcode = '22023';
      end if;
    end if;
    if lower(v_name) = any (v_seen) then continue; end if;
    v_seen := v_seen || lower(v_name);
    v_out  := v_out || jsonb_build_array(jsonb_build_object('name', v_name, 'hex', v_hex));
  end loop;
  if jsonb_array_length(v_out) > 12 then
    raise exception 'a product can have at most 12 colors' using errcode = '22023';
  end if;
  return v_out;
end;
$$;

create or replace function app.product_color_names(p_items jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(e ->> 'name' order by ord), '{}')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);
$$;

create or replace function app.product_color_items_valid(p_items jsonb, p_names text[])
returns boolean language sql immutable set search_path = '' as $$
  select p_items is not null
     and jsonb_typeof(p_items) = 'array'
     and jsonb_array_length(p_items) <= 12
     and not exists (
           select 1 from jsonb_array_elements(p_items) e
            where jsonb_typeof(e) <> 'object'
               or jsonb_typeof(e -> 'name') <> 'string'
               or char_length(btrim(e ->> 'name')) not between 1 and 40
               or (e -> 'hex') is null
               or (jsonb_typeof(e -> 'hex') <> 'null'
                   and (jsonb_typeof(e -> 'hex') <> 'string' or (e ->> 'hex') !~ '^#[0-9A-F]{6}$')))
     and (select count(distinct lower(btrim(e ->> 'name'))) from jsonb_array_elements(p_items) e) = jsonb_array_length(p_items)
     -- the legacy names column mirrors the items whenever items exist
     and (jsonb_array_length(p_items) = 0 or p_names = app.product_color_names(p_items));
$$;

-- ===========================================================================
-- 2. products — additive columns and constraints
-- ===========================================================================
alter table public.products
  add column base_price   numeric(14, 2),
  add column color_items  jsonb not null default '[]'::jsonb;

alter table public.products
  add constraint ck_products_base_price check (base_price is null or (base_price > 0 and base_price <= 100000000)),
  add constraint ck_products_color_items check (app.product_color_items_valid(color_items, colors));

alter table public.products drop constraint ck_products_desc_len;
alter table public.products
  add constraint ck_products_desc_words check (
    short_description is null
    or (char_length(short_description) <= 5000 and app.word_count(short_description) <= 250));

comment on column public.products.base_price is
  'Regular selling price in EGP, numeric(14,2). NULL = historical product with no price recorded. The ONLY price on a product: offer / package / promotional prices belong to Product Offers, never here.';
comment on column public.products.color_items is
  'Ordered [{"name","hex"}] — hex is canonical upper-case #RRGGBB, or null for a legacy named color whose value was never chosen. Empty array = use the legacy `colors` names. When non-empty, `colors` equals the item names (enforced).';
comment on column public.products.short_description is
  'Product description, at most 250 words (and 5000 characters as a sanity ceiling).';

-- ===========================================================================
-- 3. Validation (re-created with the SAME signature: description is words now)
-- ===========================================================================
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
  if p_description is not null and (app.word_count(p_description) > 250 or char_length(p_description) > 5000) then
    raise exception 'description is limited to 250 words' using errcode = '22023';
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

create or replace function app.assert_product_base_price(p_price numeric)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_price is not null and (p_price <= 0 or p_price > 100000000 or scale(p_price) > 2) then
    raise exception 'price must be a positive amount in EGP with at most 2 decimals' using errcode = '22023';
  end if;
end;
$$;

-- ===========================================================================
-- 4. RPCs (new signatures; the previous ones are dropped)
-- ===========================================================================
drop function public.own_product_create(uuid, text, text, text, public.product_unit, text[], numeric, text, text, text);
drop function public.own_product_update(uuid, integer, text, text, text, public.product_unit, text[], numeric, text, text, text);

create or replace function public.own_product_create(
  p_org_id        uuid,
  p_name          text,
  p_code          text,
  p_category_code text,
  p_unit          public.product_unit,
  p_color_items   jsonb default '[]',
  p_weight_kg     numeric default null,
  p_size_label    text default null,
  p_brand         text default null,
  p_description   text default null,
  p_base_price    numeric default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_code  text;
  v_items jsonb;
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
  perform app.assert_product_base_price(p_base_price);
  v_items := app.normalize_product_color_items(p_color_items);
  insert into public.products (organization_id, name, sku, category, category_code, brand, short_description,
                               unit, colors, color_items, weight_kg, size_label, base_price, created_by)
  values (p_org_id, btrim(p_name), v_code, 'other', p_category_code, nullif(btrim(p_brand), ''),
          nullif(btrim(p_description), ''), p_unit, app.product_color_names(v_items), v_items, p_weight_kg,
          nullif(btrim(p_size_label), ''), p_base_price, (select auth.uid()))
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
  p_color_items      jsonb default '[]',
  p_weight_kg        numeric default null,
  p_size_label       text default null,
  p_brand            text default null,
  p_description      text default null,
  p_base_price       numeric default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_p     public.products;
  v_code  text;
  v_items jsonb;
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
  perform app.assert_product_base_price(p_base_price);
  -- A product that already has a price keeps one: it can be changed, not blanked.
  if v_p.base_price is not null and p_base_price is null then
    raise exception 'a product price cannot be removed once it is set' using errcode = '22023';
  end if;
  v_items := app.normalize_product_color_items(p_color_items);
  update public.products set
    name              = btrim(p_name),
    sku               = v_code,
    category_code     = p_category_code,
    unit              = p_unit,
    colors            = app.product_color_names(v_items),
    color_items       = v_items,
    weight_kg         = p_weight_kg,
    size_label        = nullif(btrim(p_size_label), ''),
    brand             = nullif(btrim(p_brand), ''),
    short_description = nullif(btrim(p_description), ''),
    base_price        = p_base_price,
    version           = version + 1
  where id = p_product_id;
  perform app.record_audit_event('product.updated', 'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

revoke execute on function
  public.own_product_create(uuid, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric),
  public.own_product_update(uuid, integer, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric)
  from public, anon;
grant execute on function
  public.own_product_create(uuid, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric),
  public.own_product_update(uuid, integer, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric)
  to authenticated;
