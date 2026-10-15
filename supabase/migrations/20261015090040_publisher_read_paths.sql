-- ===========================================================================
-- M4a stage 4 - read paths. Organization-owned content behaves EXACTLY as before; an independent
-- publisher's content is visible to other people only when the platform flag 'independent_commerce'
-- is on AND the publisher is active (app.publisher_gate_open). The owner always sees their own
-- active content. Every public / buyer path funnels through product_is_public, product_visible_to,
-- offer_is_live, catalog_products and the offers feeds below, so the gate cannot be bypassed by a
-- direct URL, an image grant, a saved product or a feed.
-- ===========================================================================

create or replace function app.product_is_public(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
     where p.id = p_product_id and p.status = 'published' and p.deleted_at is null and p.archived_at is null
       and app.publisher_gate_open(p.publisher_id));
$$;

create or replace function app.product_visible_to(p_product_id uuid, p_viewer_org_id uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.products p
      join public.publishers pb on pb.id = p.publisher_id
      left join public.organizations o on o.id = p.organization_id and o.deleted_at is null
     where p.id = p_product_id
       and p.status = 'published' and p.deleted_at is null and p.archived_at is null
       and (pb.kind <> 'organization' or o.id is not null)
       and (p.organization_id = p_viewer_org_id
            or (pb.kind <> 'organization' and pb.user_id = (select auth.uid()) and app.independent_publisher_active(pb.id))
            or (p_audience is not null
                and ((pb.kind <> 'organization' and app.publisher_gate_open(pb.id))
                     or (pb.kind = 'organization' and o.status = 'active'::public.org_status))
                and exists (select 1 from public.product_audiences a
                             where a.product_id = p.id and a.audience = p_audience))));
$$;

drop function public.catalog_products(uuid);
create function public.catalog_products(p_org_id uuid default null)
returns table (
  id uuid, organization_id uuid, supplier_name text, supplier_verified boolean, supplier_slug text,
  name text, sku text, category public.product_category, brand text, short_description text,
  unit public.product_unit, image_ref text, published_at timestamptz, category_code text, colors text[],
  weight_kg numeric, size_label text, primary_image_key text, color_items jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_aud text := app.viewer_product_audience(p_org_id);
begin
  if v_aud is null then return; end if;
  return query
  select p.id, p.organization_id, coalesce(o.name, pb.display_name), coalesce(o.is_verified, true), o.slug,
         p.name, p.sku, p.category, p.brand,
         p.short_description, p.unit, p.image_ref, p.published_at, p.category_code, p.colors,
         p.weight_kg, p.size_label,
         (select i.object_key from public.product_images i
           where i.product_id = p.id and i.state = 'ready' order by i.slot limit 1),
         p.color_items
    from public.products p
    join public.publishers pb on pb.id = p.publisher_id
    left join public.organizations o on o.id = p.organization_id and o.deleted_at is null
   where p.status = 'published' and p.deleted_at is null and p.archived_at is null
     and (pb.kind <> 'organization' or o.id is not null)
     and (p.organization_id = p_org_id
          or (pb.kind <> 'organization' and pb.user_id = (select auth.uid()) and app.independent_publisher_active(pb.id))
          or ((pb.kind = 'organization' or app.publisher_gate_open(pb.id))
              and exists (select 1 from public.product_audiences a where a.product_id = p.id and a.audience = v_aud)));
end;
$$;
revoke all on function public.catalog_products(uuid) from public, anon;
grant execute on function public.catalog_products(uuid) to authenticated;

create or replace function app.offer_is_live(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.product_offers o
      join public.publishers pb on pb.id = o.publisher_id
      left join public.organizations org on org.id = o.organization_id and org.deleted_at is null
     where o.id = p_offer_id
       and ((pb.kind = 'organization' and org.status = 'active'::public.org_status)
            or (pb.kind <> 'organization' and app.publisher_gate_open(pb.id)))
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

create or replace function app.offer_visible_to(p_offer_id uuid, p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_aud text := app.viewer_offer_audience(p_org_id);
  v_org uuid;
  v_pub uuid;
begin
  if v_aud is null then return false; end if;
  select o.organization_id, o.publisher_id into v_org, v_pub from public.product_offers o where o.id = p_offer_id;
  if v_pub is null or (p_org_id is not null and v_org = p_org_id) then return false; end if;
  if exists (select 1 from public.publishers pb where pb.id = v_pub and pb.user_id = (select auth.uid())) then return false; end if;
  if not app.offer_is_live(p_offer_id) then return false; end if;
  return exists (select 1 from public.product_offer_audiences a where a.offer_id = p_offer_id and a.audience = v_aud);
end;
$$;

create or replace function app.offer_public_json(p_offer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'organization_id', o.organization_id,
    'publisher_id', o.publisher_id,
    'title', o.title,
    'description', o.description,
    'seller', case when org.id is not null
                   then jsonb_build_object('id', org.id, 'name', org.name, 'verified', org.is_verified, 'slug', org.slug,
                                           'org_type', org.org_type::text)
                   else jsonb_build_object('id', pb.id, 'name', pb.display_name, 'verified', true, 'slug', null,
                                           'org_type', pb.kind::text) end,
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
    join public.publishers pb on pb.id = o.publisher_id
    left join public.organizations org on org.id = o.organization_id
   where o.id = p_offer_id;
$$;

CREATE OR REPLACE FUNCTION public.offers_feed(p_org_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_aud text := app.viewer_offer_audience(p_org_id);
  v_out jsonb;
begin
  if v_aud is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(app.offer_viewer_json(x.id) order by x.published_at desc nulls last, x.id), '[]'::jsonb)
    into v_out
    from (
      select o.id, o.published_at
        from public.product_offers o
       where app.offer_is_live(o.id)
         and exists (select 1 from public.product_offer_audiences a where a.offer_id = o.id and a.audience = v_aud)
         and (p_org_id is null or o.organization_id is distinct from p_org_id)
         and not exists (select 1 from public.publishers own where own.id = o.publisher_id and own.user_id = (select auth.uid()))
       order by o.published_at desc nulls last, o.id
       limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) x;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.offers_feed_page(p_org_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_seller_type text DEFAULT NULL::text, p_period text DEFAULT 'all'::text, p_sort text DEFAULT 'newest'::text, p_saved_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_aud    text := app.viewer_offer_audience(p_org_id);
  v_limit  integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 10000));
  v_term   text := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
  v_now    timestamptz := now();
  v_out    jsonb;
begin
  if v_aud is null then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'has_more', false,
                              'stats', jsonb_build_object('available', 0, 'ending', 0, 'fresh', 0),
                              'seller_types', '[]'::jsonb);
  end if;
  if p_sort not in ('newest', 'ending', 'priceLow', 'priceHigh') then p_sort := 'newest'; end if;
  if p_period not in ('all', 'ending', 'week') then p_period := 'all'; end if;
  if v_term is not null then
    v_like := '%' || replace(replace(replace(lower(left(v_term, 100)), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with eligible as (
    select o.id, o.title, o.total_price, o.ends_at, o.published_at, coalesce(org.name, pb.display_name) as seller_name, coalesce(org.org_type::text, pb.kind::text) as seller_type
      from public.product_offers o
      join public.publishers pb on pb.id = o.publisher_id
      left join public.organizations org on org.id = o.organization_id
     where app.offer_is_live(o.id)
       and exists (select 1 from public.product_offer_audiences a where a.offer_id = o.id and a.audience = v_aud)
       and (p_org_id is null or o.organization_id is distinct from p_org_id)
         and not exists (select 1 from public.publishers own where own.id = o.publisher_id and own.user_id = (select auth.uid()))
  ), filtered as (
    select e.*
      from eligible e
     where (v_like is null
            or lower(e.title) like v_like escape '\'
            or lower(e.seller_name) like v_like escape '\'
            or exists (select 1 from public.product_offer_items i join public.products p on p.id = i.product_id
                        where i.offer_id = e.id
                          and (lower(p.name) like v_like escape '\' or lower(coalesce(p.sku, '')) like v_like escape '\')))
       and (nullif(p_category, '') is null
            or exists (select 1 from public.product_offer_items i join public.products p on p.id = i.product_id
                        where i.offer_id = e.id and p.category_code = p_category))
       and (nullif(p_seller_type, '') is null or e.seller_type = p_seller_type)
       and (p_period = 'all'
            or (p_period = 'ending' and e.ends_at <= v_now + interval '3 days')
            or (p_period = 'week'   and e.ends_at <= v_now + interval '7 days'))
       and (not coalesce(p_saved_only, false) or app.offer_is_saved(e.id))
  ), ordered as (
    select f.id,
           row_number() over (
             order by case when p_sort = 'ending'    then f.ends_at     end asc  nulls last,
                      case when p_sort = 'priceLow'  then f.total_price end asc  nulls last,
                      case when p_sort = 'priceHigh' then f.total_price end desc nulls last,
                      f.published_at desc nulls last, f.id) as n
      from filtered f
  )
  select jsonb_build_object(
           'items', coalesce((select jsonb_agg(app.offer_viewer_json(x.id) order by x.n)
                                from (select id, n from ordered where n > v_offset and n <= v_offset + v_limit) x),
                             '[]'::jsonb),
           'total', (select count(*) from ordered),
           'has_more', (select count(*) from ordered) > v_offset + v_limit,
           'stats', jsonb_build_object(
              'available', (select count(*) from eligible),
              'ending',    (select count(*) from eligible e where e.ends_at <= v_now + interval '3 days'),
              'fresh',     (select count(*) from eligible e where e.published_at >= v_now - interval '7 days')),
           'seller_types', coalesce((select jsonb_agg(distinct e.seller_type) from eligible e where e.seller_type is not null), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$function$;
