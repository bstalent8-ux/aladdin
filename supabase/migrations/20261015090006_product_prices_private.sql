-- Own Products — move the base price into an owner-only table.
--
-- WHY. 20261009090001 added products.base_price. But `products_select_published`
-- lets ANY signed-in user SELECT every column of a published product, so another
-- organization could read the regular price straight from the table (the
-- catalog_published_products view hid it, the table did not). Decision: the base
-- price is PRIVATE to the owning organization. Phase 5 (Product Offers) will expose
-- the offer / package price to eligible audiences — never this one.
--
-- HOW (additive, no column-grant tricks). A separate tenant-scoped table
-- `product_prices`, one row per priced product, with its OWN RLS: only members of
-- the owning organization can read it, nobody can write it directly (the two
-- security-definer RPCs are the only writers). Prices already written into
-- products.base_price are copied first, then the now-redundant column is dropped.
-- A historical product with no price simply has no row.
--
-- COLORS stay on products (products.color_items / products.colors): they are public
-- product attributes. See docs/frontend/showroom-fullstack-v2.md.

-- ===========================================================================
-- 1. The private price table
-- ===========================================================================
create table public.product_prices (
  product_id      uuid primary key references public.products (id) on delete cascade,
  organization_id uuid not null references public.organizations (id),
  base_price      numeric(14, 2) not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_product_prices_amount check (base_price > 0 and base_price <= 100000000)
);
create index product_prices_org_idx on public.product_prices (organization_id);
create trigger product_prices_set_updated_at before update on public.product_prices
  for each row execute function app.set_updated_at();

comment on table public.product_prices is
  'PRIVATE regular selling price (EGP, numeric(14,2)) of a product, readable only by members of the owning organization. Written only by own_product_create / own_product_update. No discount / compare-at / percent column: offer and package pricing belong to Product Offers. A product with no row has no price recorded.';

alter table public.product_prices enable row level security;
create policy product_prices_select_own on public.product_prices
  for select to authenticated
  using (app.is_org_member(organization_id));

revoke all on public.product_prices from public, anon, authenticated, service_role;
grant select on public.product_prices to authenticated;

-- ===========================================================================
-- 2. Copy any existing price, then drop the exposed column
-- ===========================================================================
insert into public.product_prices (product_id, organization_id, base_price)
select id, organization_id, base_price from public.products where base_price is not null
on conflict (product_id) do nothing;

do $$
begin
  if exists (select 1 from public.products p
              where p.base_price is not null
                and not exists (select 1 from public.product_prices x
                                 where x.product_id = p.id and x.base_price = p.base_price)) then
    raise exception 'product price copy is incomplete; refusing to drop products.base_price';
  end if;
end $$;

alter table public.products drop constraint ck_products_base_price;
alter table public.products drop column base_price;

-- ===========================================================================
-- 3. RPCs write the price into the private table (same signatures as before)
-- ===========================================================================
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
                               unit, colors, color_items, weight_kg, size_label, created_by)
  values (p_org_id, btrim(p_name), v_code, 'other', p_category_code, nullif(btrim(p_brand), ''),
          nullif(btrim(p_description), ''), p_unit, app.product_color_names(v_items), v_items, p_weight_kg,
          nullif(btrim(p_size_label), ''), (select auth.uid()))
  returning id into v_id;
  if p_base_price is not null then
    insert into public.product_prices (product_id, organization_id, base_price) values (v_id, p_org_id, p_base_price);
  end if;
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
  v_has_price boolean;
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
  select exists (select 1 from public.product_prices where product_id = p_product_id) into v_has_price;
  -- A product that already has a price keeps one: it can be changed, not blanked.
  if v_has_price and p_base_price is null then
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
    version           = version + 1
  where id = p_product_id;
  if p_base_price is not null then
    insert into public.product_prices (product_id, organization_id, base_price)
    values (p_product_id, v_p.organization_id, p_base_price)
    on conflict (product_id) do update set base_price = excluded.base_price;
  end if;
  perform app.record_audit_event('product.updated', 'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

-- CREATE OR REPLACE keeps the existing ACL; restate it so the grants are explicit.
revoke execute on function
  public.own_product_create(uuid, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric),
  public.own_product_update(uuid, integer, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric)
  from public, anon;
grant execute on function
  public.own_product_create(uuid, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric),
  public.own_product_update(uuid, integer, text, text, text, public.product_unit, jsonb, numeric, text, text, text, numeric)
  to authenticated;

comment on column public.products.color_items is
  'Ordered [{"name","hex"}] — hex is canonical upper-case #RRGGBB, or null for a legacy named color whose value was never chosen. PUBLIC product attribute (a published product''s colors are readable by catalog viewers). Empty array = use the legacy `colors` names. When non-empty, `colors` equals the item names (enforced).';
