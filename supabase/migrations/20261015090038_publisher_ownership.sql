-- ===========================================================================
-- M4a stage 2 - ownership columns (expand). Every product / offer gets exactly ONE authoritative
-- publisher. Existing organization-owned rows are mapped 1:1 from their organization; nothing is
-- deleted, re-parented, duplicated or renumbered, and every id, image object key, price and
-- audience selection is preserved. Independent rows carry organization_id = NULL.
--
-- The backfill is VALIDATED before any constraint is enforced: an unmappable row aborts the
-- migration loudly instead of being given an invented owner.
-- ===========================================================================

-- 1. columns ------------------------------------------------------------------------------------
alter table public.products           add column publisher_id uuid;
alter table public.product_offers     add column publisher_id uuid;
alter table public.product_prices     add column publisher_id uuid;
alter table public.product_images     add column publisher_id uuid;
alter table public.product_offer_items add column publisher_id uuid;

-- 2. backfill (organization kind, 1:1) ---------------------------------------------------------
update public.products p           set publisher_id = pb.id from public.publishers pb where pb.organization_id = p.organization_id;
update public.product_offers o     set publisher_id = pb.id from public.publishers pb where pb.organization_id = o.organization_id;
update public.product_prices x     set publisher_id = pb.id from public.publishers pb where pb.organization_id = x.organization_id;
update public.product_images x     set publisher_id = pb.id from public.publishers pb where pb.organization_id = x.organization_id;
update public.product_offer_items x set publisher_id = pb.id from public.publishers pb where pb.organization_id = x.organization_id;

-- 3. validate completeness BEFORE enforcing anything ---------------------------------------------
do $$
declare
  v_missing integer;
  v_mismatch integer;
begin
  select (select count(*) from public.products where publisher_id is null)
       + (select count(*) from public.product_offers where publisher_id is null)
       + (select count(*) from public.product_prices where publisher_id is null)
       + (select count(*) from public.product_images where publisher_id is null)
       + (select count(*) from public.product_offer_items where publisher_id is null)
    into v_missing;
  if v_missing > 0 then
    raise exception 'publisher backfill incomplete: % rows have no mappable owner (nothing was changed or invented)', v_missing;
  end if;
  -- children must agree with their parent
  select (select count(*) from public.product_images i join public.products p on p.id = i.product_id where i.publisher_id <> p.publisher_id)
       + (select count(*) from public.product_prices i join public.products p on p.id = i.product_id where i.publisher_id <> p.publisher_id)
       + (select count(*) from public.product_offer_items i join public.product_offers o on o.id = i.offer_id where i.publisher_id <> o.publisher_id)
       + (select count(*) from public.product_offer_items i join public.products p on p.id = i.product_id where i.publisher_id <> p.publisher_id)
    into v_mismatch;
  if v_mismatch > 0 then
    raise exception 'publisher backfill inconsistent: % child rows disagree with their parent', v_mismatch;
  end if;
end $$;

-- 4. enforce -------------------------------------------------------------------------------------
alter table public.products            alter column publisher_id set not null;
alter table public.product_offers      alter column publisher_id set not null;
alter table public.product_prices      alter column publisher_id set not null;
alter table public.product_images      alter column publisher_id set not null;
alter table public.product_offer_items alter column publisher_id set not null;

alter table public.products            alter column organization_id drop not null;
alter table public.product_offers      alter column organization_id drop not null;
alter table public.product_prices      alter column organization_id drop not null;
alter table public.product_images      alter column organization_id drop not null;
alter table public.product_offer_items alter column organization_id drop not null;

alter table public.products        add constraint products_publisher_id_fkey
  foreign key (publisher_id) references public.publishers (id) on delete cascade;
alter table public.product_offers  add constraint product_offers_publisher_id_fkey
  foreign key (publisher_id) references public.publishers (id) on delete cascade;
alter table public.products        add constraint uq_products_publisher_id unique (publisher_id, id);
alter table public.products        add constraint uq_products_id_publisher unique (id, publisher_id);
alter table public.product_offers  add constraint uq_product_offers_publisher unique (id, publisher_id);

-- the single-publisher rules, enforced by the database itself
alter table public.product_images add constraint fk_product_images_publisher
  foreign key (publisher_id, product_id) references public.products (publisher_id, id) on delete cascade;
alter table public.product_prices add constraint fk_product_prices_publisher
  foreign key (publisher_id, product_id) references public.products (publisher_id, id) on delete cascade;
alter table public.product_offer_items add constraint fk_offer_items_offer_publisher
  foreign key (offer_id, publisher_id) references public.product_offers (id, publisher_id) on delete cascade;
alter table public.product_offer_items add constraint fk_offer_items_product_publisher
  foreign key (product_id, publisher_id) references public.products (id, publisher_id);

-- product code uniqueness is per PUBLISHER (identical to per organization for existing rows)
drop index public.uq_products_org_code;
create unique index uq_products_publisher_code on public.products (publisher_id, code_normalized)
  where code_normalized is not null and deleted_at is null;
create index ix_products_publisher_status on public.products (publisher_id, status) where deleted_at is null;
create index product_offers_publisher_status_idx on public.product_offers (publisher_id, status, ends_at desc);

-- 5. ownership integrity + immutability --------------------------------------------------------------
create or replace function app.enforce_publisher_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare pb public.publishers;
begin
  if tg_op = 'UPDATE' then
    if new.publisher_id is distinct from old.publisher_id or new.organization_id is distinct from old.organization_id then
      raise exception 'the owner of a % cannot be changed', tg_table_name using errcode = '42501';
    end if;
    return new;
  end if;
  -- INSERT: an organization-scoped writer supplies only organization_id; the publisher is derived
  if new.publisher_id is null then
    if new.organization_id is null then
      raise exception 'a % needs an owner', tg_table_name using errcode = '23502';
    end if;
    new.publisher_id := app.org_publisher_id(new.organization_id);
    if new.publisher_id is null then
      raise exception 'organization has no publisher identity' using errcode = '23503';
    end if;
  end if;
  select * into pb from public.publishers where id = new.publisher_id;
  if not found then
    raise exception 'unknown publisher' using errcode = '23503';
  end if;
  if pb.kind = 'organization' then
    if new.organization_id is null then
      new.organization_id := pb.organization_id;
    elsif new.organization_id <> pb.organization_id then
      raise exception 'organization and publisher disagree' using errcode = '23514';
    end if;
  elsif new.organization_id is not null then
    raise exception 'an independent publisher owns no organization' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_publisher_ownership() from public, anon, authenticated, service_role;
create trigger products_enforce_publisher before insert or update on public.products
  for each row execute function app.enforce_publisher_ownership();
create trigger product_offers_enforce_publisher before insert or update on public.product_offers
  for each row execute function app.enforce_publisher_ownership();

-- children never choose their owner: it is copied from the parent, and cannot change
create or replace function app.child_inherits_publisher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare par record;
begin
  if tg_op = 'UPDATE' then
    if new.publisher_id is distinct from old.publisher_id or new.organization_id is distinct from old.organization_id then
      raise exception 'the owner of a % cannot be changed', tg_table_name using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_table_name = 'product_offer_items' then
    select o.publisher_id, o.organization_id into par from public.product_offers o where o.id = new.offer_id;
  else
    select p.publisher_id, p.organization_id into par from public.products p where p.id = new.product_id;
  end if;
  if not found then
    raise exception 'parent not found' using errcode = '23503';
  end if;
  -- a child may omit its owner (it is copied from the parent) but can never name a different one
  if (new.publisher_id is not null and new.publisher_id <> par.publisher_id)
     or (new.organization_id is not null and new.organization_id is distinct from par.organization_id) then
    raise exception 'a % cannot name a different owner than its parent', tg_table_name using errcode = '23503';
  end if;
  new.publisher_id := par.publisher_id;
  new.organization_id := par.organization_id;
  return new;
end;
$$;
revoke all on function app.child_inherits_publisher() from public, anon, authenticated, service_role;
create trigger product_prices_inherit_publisher before insert or update on public.product_prices
  for each row execute function app.child_inherits_publisher();
create trigger product_images_inherit_publisher before insert or update on public.product_images
  for each row execute function app.child_inherits_publisher();
create trigger product_offer_items_inherit_publisher before insert or update on public.product_offer_items
  for each row execute function app.child_inherits_publisher();

-- 6. read policies: a publisher's own people see its data (organization members exactly as before) ---------
drop policy products_select_own on public.products;
create policy products_select_own on public.products for select to authenticated
  using (deleted_at is null and app.is_publisher_member(publisher_id));
drop policy product_offers_select_own on public.product_offers;
create policy product_offers_select_own on public.product_offers for select to authenticated
  using (app.is_publisher_member(publisher_id));
drop policy product_offer_items_select_own on public.product_offer_items;
create policy product_offer_items_select_own on public.product_offer_items for select to authenticated
  using (app.is_publisher_member(publisher_id));
drop policy product_prices_select_own on public.product_prices;
create policy product_prices_select_own on public.product_prices for select to authenticated
  using (app.is_publisher_member(publisher_id));
drop policy product_images_select_org on public.product_images;
create policy product_images_select_org on public.product_images for select to authenticated
  using (state <> 'deleted'::public.professional_asset_state and app.is_publisher_member(publisher_id));
drop policy product_audiences_select_own on public.product_audiences;
create policy product_audiences_select_own on public.product_audiences for select to authenticated
  using (exists (select 1 from public.products p where p.id = product_audiences.product_id and app.is_publisher_member(p.publisher_id)));
drop policy product_offer_audiences_select_own on public.product_offer_audiences;
create policy product_offer_audiences_select_own on public.product_offer_audiences for select to authenticated
  using (exists (select 1 from public.product_offers o where o.id = product_offer_audiences.offer_id and app.is_publisher_member(o.publisher_id)));

-- 7. the owner's offers view also exposes the publisher ------------------------------------------------
create or replace view public.own_product_offers with (security_invoker = true) as
SELECT id,
    organization_id,
    title,
    description,
    total_price,
    reference_price,
    currency,
    starts_at,
    ends_at,
    status,
    version,
    published_at,
    archived_at,
    created_by,
    created_at,
    updated_at,
    app.offer_phase(status, starts_at, ends_at) AS phase,
    ( SELECT (count(*))::integer AS count
           FROM product_offer_items i
          WHERE (i.offer_id = o.id)) AS item_count,
    ( SELECT (COALESCE(sum(i.quantity), (0)::bigint))::integer AS "coalesce"
           FROM product_offer_items i
          WHERE (i.offer_id = o.id)) AS total_quantity,
    ( SELECT (count(*))::integer AS count
           FROM (product_offer_items i
             LEFT JOIN products p ON ((p.id = i.product_id)))
          WHERE ((i.offer_id = o.id) AND ((p.id IS NULL) OR (p.status <> 'published'::product_status) OR (p.deleted_at IS NOT NULL) OR (p.archived_at IS NOT NULL)))) AS invalid_item_count,
    COALESCE(( SELECT array_agg(a.audience ORDER BY a.audience) AS array_agg
           FROM product_offer_audiences a
          WHERE (a.offer_id = o.id)), '{}'::text[]) AS audiences,
    lower(((title || ' '::text) || COALESCE(( SELECT string_agg(((p.name || ' '::text) || COALESCE(p.sku, ''::text)), ' '::text) AS string_agg
           FROM (product_offer_items i
             JOIN products p ON ((p.id = i.product_id)))
          WHERE (i.offer_id = o.id)), ''::text))) AS search_text,
    o.publisher_id
   FROM product_offers o;

