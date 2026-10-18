-- Migration: the Saved Products page filters by the CANONICAL category, like Browse.
--
-- public.saved_product_list gains one trailing column, category_code, copied from the
-- catalog projection it already joins. Nothing else changes: same body, same
-- security_invoker option, same grants. `create or replace` may only append columns,
-- which is exactly what this is, so no dependent object is dropped.
create or replace view public.saved_product_list with (security_invoker = true) as
  select
    s.organization_id,
    s.product_id,
    s.saved_by,
    s.note,
    s.created_at        as saved_at,
    c.name,
    c.sku,
    c.category,
    c.brand,
    c.short_description,
    c.unit,
    c.image_ref,
    c.organization_id   as supplier_org_id,
    c.supplier_name,
    c.supplier_verified,
    c.category_code
  from public.saved_products s
  join public.catalog_published_products c on c.id = s.product_id;
