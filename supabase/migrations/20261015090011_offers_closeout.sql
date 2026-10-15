-- Product Offers — Phase 5 closeout (additive on 20261012..20261014).
--
--   1. AUDIENCES   every approved audience group is targetable. The eight UI groups expand to
--                  explicit canonical rows (organization_type / persona_type codes); a new
--                  canonical `end_consumer` persona row joins the catalogue and every row is
--                  feed_ready, because each account shell now renders the shared Offers feed.
--   2. DESCRIPTION the business limit is 250 WORDS (app.word_count, the rule products use), with
--                  a generous character ceiling as a sanity bound only. The 500-character check
--                  is gone.
--   3. SAVED       saved_product_offers: a USER's bookmark of an offer. Not ownership, not access:
--                  the row never makes an offer visible. Reads are own-row only; writes go through
--                  offer_set_saved, which only lets a viewer SAVE an offer they can currently see.
--                  Unsaving is always allowed. The feed/detail projections carry `saved`.
--   4. FEED PAGE   offers_feed_page: server-side search / category / seller type / period / sort
--                  with a bounded LIMIT/OFFSET page (stable total order, id as tiebreak) plus the
--                  eligible-set stats and seller-type facets. No unbounded read, no client filter.
--
-- Eligibility is still ONE rule (app.offer_is_live + audience + not-own); it now lives in
-- app.offer_visible_to, used by the detail RPC, the feed page and the save RPC alike.

-- ===========================================================================
-- 1. Audiences
-- ===========================================================================
insert into public.offer_audience_types (code, kind, feed_ready, sort_order)
values ('end_consumer', 'persona', true, 120)
on conflict (code) do nothing;

update public.offer_audience_types set feed_ready = true;

comment on column public.offer_audience_types.feed_ready is
  'A shell with an Offers feed exists for this audience. Every catalogue row is feed-ready since the closeout: /b2b serves all organization types and /home serves every persona.';

-- ===========================================================================
-- 2. Description: 250 words
-- ===========================================================================
alter table public.product_offers drop constraint ck_product_offers_description;
alter table public.product_offers
  add constraint ck_product_offers_description_words
  check (description is null or (char_length(description) <= 5000 and app.word_count(description) <= 250));

create or replace function app.offer_validate_text(
  p_title text, p_description text, p_total_price numeric, p_reference_price numeric
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_title is null or char_length(btrim(p_title)) not between 2 and 100 then
    raise exception 'the offer name must be 2 to 100 characters' using errcode = '22023';
  end if;
  if p_description is not null and (app.word_count(p_description) > 250 or char_length(p_description) > 5000) then
    raise exception 'the offer description is limited to 250 words' using errcode = '22023';
  end if;
  if p_reference_price is not null and (
       p_reference_price <= 0 or p_reference_price > 100000000 or scale(p_reference_price) > 2
       or p_reference_price <= p_total_price) then
    raise exception 'the price before the offer must be greater than the offer price' using errcode = '22023';
  end if;
end;
$$;

-- ===========================================================================
-- 3. The single viewer rule + saved offers
-- ===========================================================================
-- Can THIS caller, acting as p_org_id (or personally when null), see this offer right now?
create or replace function app.offer_visible_to(p_offer_id uuid, p_org_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_aud text := app.viewer_offer_audience(p_org_id);
  v_org uuid;
begin
  if v_aud is null then return false; end if;
  select o.organization_id into v_org from public.product_offers o where o.id = p_offer_id;
  if v_org is null or (p_org_id is not null and v_org = p_org_id) then return false; end if;
  if not app.offer_is_live(p_offer_id) then return false; end if;
  return exists (select 1 from public.product_offer_audiences a where a.offer_id = p_offer_id and a.audience = v_aud);
end;
$$;

create table public.saved_product_offers (
  user_id    uuid        not null references public.users (id)          on delete cascade,
  offer_id   uuid        not null references public.product_offers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, offer_id)
);
create index ix_saved_product_offers_offer on public.saved_product_offers (offer_id);
comment on table public.saved_product_offers is
  'A user''s bookmark of a product offer. A preference only: it never grants visibility — every read of an offer re-applies the audience/window/product rules. Written only through offer_set_saved.';

alter table public.saved_product_offers enable row level security;
create policy saved_product_offers_select_own on public.saved_product_offers
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.saved_product_offers from public, anon, authenticated, service_role;
grant select on public.saved_product_offers to authenticated;

create or replace function app.offer_is_saved(p_offer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.saved_product_offers s
                  where s.offer_id = p_offer_id and s.user_id = (select auth.uid()));
$$;

-- Audience projection + the caller's own saved flag.
create or replace function app.offer_viewer_json(p_offer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select app.offer_public_json(p_offer_id) || jsonb_build_object('saved', app.offer_is_saved(p_offer_id));
$$;

create or replace function public.offer_set_saved(p_offer_id uuid, p_saved boolean, p_org_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if coalesce(p_saved, false) then
    -- Saving never widens access: the offer must be visible to this viewer right now.
    if not app.offer_visible_to(p_offer_id, p_org_id) then
      raise exception 'offer not available' using errcode = '42501';
    end if;
    insert into public.saved_product_offers (user_id, offer_id) values (v_uid, p_offer_id)
    on conflict do nothing;
    return true;
  end if;
  delete from public.saved_product_offers where user_id = v_uid and offer_id = p_offer_id;
  return false;
end;
$$;

-- ===========================================================================
-- 4. Viewer RPCs
-- ===========================================================================
create or replace function public.offer_detail(p_offer_id uuid, p_org_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.offer_visible_to(p_offer_id, p_org_id) then return null; end if;
  return app.offer_viewer_json(p_offer_id);
end;
$$;

create or replace function public.offers_feed(p_org_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
         and (p_org_id is null or o.organization_id <> p_org_id)
       order by o.published_at desc nulls last, o.id
       limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) x;
  return v_out;
end;
$$;

-- One bounded page of the audience feed. Filters and sort run here; the page is
-- LIMIT/OFFSET over a total order (the sort key, then id), so batches never overlap and none is
-- skipped while the eligible set is unchanged. stats/seller_types describe the whole eligible
-- set (not the filtered one) so the summary cards do not move when a filter changes.
create or replace function public.offers_feed_page(
  p_org_id      uuid    default null,
  p_limit       integer default 10,
  p_offset      integer default 0,
  p_search      text    default null,
  p_category    text    default null,
  p_seller_type text    default null,
  p_period      text    default 'all',
  p_sort        text    default 'newest',
  p_saved_only  boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    select o.id, o.title, o.total_price, o.ends_at, o.published_at, org.name as seller_name, org.org_type::text as seller_type
      from public.product_offers o
      join public.organizations org on org.id = o.organization_id
     where app.offer_is_live(o.id)
       and exists (select 1 from public.product_offer_audiences a where a.offer_id = o.id and a.audience = v_aud)
       and (p_org_id is null or o.organization_id <> p_org_id)
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
$$;

-- ===========================================================================
-- 5. Grants — clients get the RPCs; every helper stays internal
-- ===========================================================================
revoke execute on function
  app.offer_visible_to(uuid, uuid), app.offer_is_saved(uuid), app.offer_viewer_json(uuid)
  from public, anon, authenticated;
revoke execute on function public.offer_set_saved(uuid, boolean, uuid) from public, anon;
grant execute on function public.offer_set_saved(uuid, boolean, uuid) to authenticated;
revoke execute on function public.offers_feed_page(uuid, integer, integer, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.offers_feed_page(uuid, integer, integer, text, text, text, text, text, boolean) to authenticated;
