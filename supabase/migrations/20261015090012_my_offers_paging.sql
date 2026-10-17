-- ===========================================================================
-- My Offers: server-side filtering for a bounded, paged owner list
--
-- The owner list used to read up to 200 offers and filter them in the browser. It now reads ONE
-- bounded page, so the filters it offers (audience group, text search over the offer AND its
-- products) must be answerable by the query itself. Two derived, read-only columns are added to
-- the owner view; nothing else changes (same rows, same RLS via security_invoker, same grants,
-- no price beyond the offer's own, no write path).
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
             and (p.id is null or p.status <> 'published' or p.deleted_at is not null or p.archived_at is not null)) as invalid_item_count,
         coalesce((select array_agg(a.audience order by a.audience) from public.product_offer_audiences a where a.offer_id = o.id), '{}'::text[]) as audiences,
         lower(o.title || ' ' || coalesce((select string_agg(p.name || ' ' || coalesce(p.sku, ''), ' ')
                                            from public.product_offer_items i
                                            join public.products p on p.id = i.product_id
                                           where i.offer_id = o.id), '')) as search_text
    from public.product_offers o;
comment on view public.own_product_offers is
  'The owner''s offers with the derived lifecycle phase (draft/scheduled/active/paused/expired/archived), item/quantity counts, how many included products are no longer valid for a public offer, the audience codes, and a lower-cased search text (offer title + product names/codes) so the owner list can filter and page on the server.';
revoke all on public.own_product_offers from public, anon, authenticated, service_role;
grant select on public.own_product_offers to authenticated;
