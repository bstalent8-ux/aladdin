-- Product Offers — details required by the approved references (additive on 20261012090001).
--
--   * title (name) and description of the offer — the references show both.
--   * reference_price ("price before the offer"): OPTIONAL, OFFER-LEVEL, in the offer's
--     currency, and strictly greater than the package price. It is typed in by the owner;
--     it is never read from or derived from product_prices, and no discount percentage is
--     stored or computed anywhere.
--   * a SCHEDULED offer (published, not started yet) may be edited — nobody can see it
--     yet — and an ARCHIVED offer may be restored to draft.
--   * the audience-facing projection now carries title / description / reference_price and
--     the seller's public business type (the same classification the public directory shows).

-- ===========================================================================
-- 1. Columns and constraints
-- ===========================================================================
alter table public.product_offers
  add column title           text,
  add column description     text,
  add column reference_price numeric(14, 2);

update public.product_offers set title = 'Offer' where title is null;
alter table public.product_offers alter column title set not null;

alter table public.product_offers
  add constraint ck_product_offers_title check (char_length(btrim(title)) between 2 and 100),
  add constraint ck_product_offers_description check (description is null or char_length(description) <= 500),
  add constraint ck_product_offers_reference_price
    check (reference_price is null or (reference_price > total_price and reference_price <= 100000000));

comment on column public.product_offers.reference_price is
  'OPTIONAL offer-level "price before the offer", entered by the owner. Greater than total_price. Never an individual product price, never sourced from product_prices, never turned into a discount percentage.';

-- ===========================================================================
-- 2. Owner view (recreated: new columns)
-- ===========================================================================
drop view public.own_product_offers;
create view public.own_product_offers with (security_invoker = true) as
  select o.id, o.organization_id, o.title, o.description, o.total_price, o.reference_price, o.currency,
         o.starts_at, o.ends_at, o.status, o.version, o.published_at, o.archived_at, o.created_by,
         o.created_at, o.updated_at,
         app.offer_phase(o.status, o.starts_at, o.ends_at) as phase,
         (select count(*)::int from public.product_offer_items i where i.offer_id = o.id) as item_count,
         (select coalesce(sum(i.quantity), 0)::int from public.product_offer_items i where i.offer_id = o.id) as total_quantity,
         (select count(*)::int
            from public.product_offer_items i
            left join public.products p on p.id = i.product_id
           where i.offer_id = o.id
             and (p.id is null or p.status <> 'published' or p.deleted_at is not null or p.archived_at is not null)) as invalid_item_count
    from public.product_offers o;
comment on view public.own_product_offers is
  'The owner''s offers with the derived lifecycle phase (draft/scheduled/active/paused/expired/archived), item/quantity counts and how many included products are no longer valid for a public offer.';
revoke all on public.own_product_offers from public, anon, authenticated, service_role;
grant select on public.own_product_offers to authenticated;

-- ===========================================================================
-- 3. Audience-facing projection (price-safe, plus the new offer-level fields)
-- ===========================================================================
create or replace function app.offer_public_json(p_offer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'organization_id', o.organization_id,
    'title', o.title,
    'description', o.description,
    'seller', jsonb_build_object('id', org.id, 'name', org.name, 'verified', org.is_verified, 'slug', org.slug,
                                 'org_type', org.org_type::text),
    'total_price', o.total_price,
    'reference_price', o.reference_price,
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

-- ===========================================================================
-- 4. Owner writes (new signatures; the first-cut ones are dropped)
-- ===========================================================================
drop function public.own_offer_save(uuid, uuid, integer, numeric, timestamptz, timestamptz, jsonb, text[]);

create or replace function app.offer_validate_text(
  p_title text, p_description text, p_total_price numeric, p_reference_price numeric
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_title is null or char_length(btrim(p_title)) not between 2 and 100 then
    raise exception 'the offer name must be 2 to 100 characters' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'the offer description is limited to 500 characters' using errcode = '22023';
  end if;
  if p_reference_price is not null and (
       p_reference_price <= 0 or p_reference_price > 100000000 or scale(p_reference_price) > 2
       or p_reference_price <= p_total_price) then
    raise exception 'the price before the offer must be greater than the offer price' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.own_offer_save(
  p_org_id           uuid,
  p_offer_id         uuid,
  p_expected_version integer,
  p_title            text,
  p_description      text,
  p_total_price      numeric,
  p_reference_price  numeric,
  p_starts_at        timestamptz,
  p_ends_at          timestamptz,
  p_items            jsonb,
  p_audiences        text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_o  public.product_offers;
  v_id uuid;
  v_version integer;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc  text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_write_catalog(p_org_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  perform app.offer_validate_text(v_title, v_desc, p_total_price, p_reference_price);
  perform app.offer_validate_package(p_org_id, p_total_price, p_starts_at, p_ends_at, p_items, p_audiences);

  if p_offer_id is null then
    insert into public.product_offers (organization_id, title, description, total_price, reference_price, starts_at, ends_at, created_by)
    values (p_org_id, v_title, v_desc, p_total_price, p_reference_price, p_starts_at, p_ends_at, (select auth.uid()))
    returning id, version into v_id, v_version;
    perform app.record_audit_event('offer.created', 'product_offer', v_id, p_org_id, '{}'::jsonb);
  else
    select * into v_o from public.product_offers where id = p_offer_id for update;
    if not found or v_o.organization_id <> p_org_id then
      raise exception 'offer not found' using errcode = 'P0002';
    end if;
    if v_o.version <> p_expected_version then
      raise exception 'offer was modified concurrently (expected %, found %)', p_expected_version, v_o.version
        using errcode = '40001';
    end if;
    -- Editable while nobody can see it: a draft, a paused offer, or a published offer that has not started.
    if not (v_o.status in ('draft', 'paused') or (v_o.status = 'published' and now() < v_o.starts_at)) then
      raise exception 'only a draft, paused or scheduled offer can be edited; pause an active offer first' using errcode = '22023';
    end if;
    if v_o.status = 'published' then
      -- Still published afterwards, so it must keep satisfying the publishing rules.
      if p_ends_at <= now() then
        raise exception 'this offer has already ended; change its dates first' using errcode = '22023';
      end if;
      if exists (select 1 from unnest(p_audiences) a join public.offer_audience_types t on t.code = a where not t.feed_ready) then
        raise exception 'an audience you chose cannot receive offers yet' using errcode = '22023';
      end if;
      if exists (select 1 from public.products p
                  where p.id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(p_items) e)
                    and p.status <> 'published') then
        raise exception 'every product in a published offer must be published' using errcode = '22023';
      end if;
    end if;
    update public.product_offers
       set title = v_title, description = v_desc, total_price = p_total_price, reference_price = p_reference_price,
           starts_at = p_starts_at, ends_at = p_ends_at, version = version + 1
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

-- publish | pause | resume | archive | restore
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
  elsif p_action = 'restore' then
    if v_o.status <> 'archived' then
      raise exception 'only an archived offer can be restored' using errcode = '22023';
    end if;
    v_to := 'draft'; v_event := 'offer.updated';
  else
    raise exception 'unknown offer action' using errcode = '22023';
  end if;

  update public.product_offers
     set status = v_to, version = version + 1,
         published_at = case when p_action = 'publish' then now() else published_at end,
         archived_at = case when p_action = 'archive' then now() when p_action = 'restore' then null else archived_at end
   where id = v_o.id;
  perform app.record_audit_event(v_event, 'product_offer', v_o.id, v_o.organization_id,
                                 case when p_action = 'restore' then '{"restored":true}'::jsonb else '{}'::jsonb end);
  return v_o.version + 1;
end;
$$;

revoke execute on function
  public.own_offer_save(uuid, uuid, integer, text, text, numeric, numeric, timestamptz, timestamptz, jsonb, text[]),
  app.offer_validate_text(text, text, numeric, numeric)
  from public, anon;
grant execute on function
  public.own_offer_save(uuid, uuid, integer, text, text, numeric, numeric, timestamptz, timestamptz, jsonb, text[]),
  app.offer_validate_text(text, text, numeric, numeric)
  to authenticated;
