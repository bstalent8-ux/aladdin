-- Catalog read model: expose the structured product colors.
--
-- Product colors ([{name, hex}]) are approved PUBLIC product attributes, so buyers'
-- Browse cards can draw real swatches. The canonical way to read a published product
-- is this view, never the products table. ADDITIVE: one trailing column
-- (color_items); every existing column keeps its name, type and position, and the
-- grants/security_invoker option of the view are unchanged.
--
-- NOT exposed here, by decision: the private base price (public.product_prices, owner
-- organization only) and any management metadata (status history, created_by, ...).
create or replace view public.catalog_published_products with (security_invoker = true) as
  select
    p.id, p.organization_id, o.name as supplier_name, o.is_verified as supplier_verified,
    o.slug as supplier_slug, p.name, p.sku, p.category, p.brand, p.short_description,
    p.unit, p.image_ref, p.published_at,
    p.category_code, p.colors, p.weight_kg, p.size_label,
    (select i.object_key from public.product_images i
      where i.product_id = p.id and i.state = 'ready'
      order by i.slot limit 1) as primary_image_key,
    p.color_items
  from public.products p
  join app._catalog_supplier_identity() o on o.id = p.organization_id
  where p.status = 'published' and p.deleted_at is null;

comment on view public.catalog_published_products is
  'PUBLIC cross-tenant projection of published catalog products with the supplier org''s public identity. security_invoker=true (products read under the caller''s RLS; supplier identity via the constrained app._catalog_supplier_identity()). Public product attributes only: code, canonical category, colors (color_items), weight, size, unit, brand, description, image. Never the private base price (product_prices) or management data.';
