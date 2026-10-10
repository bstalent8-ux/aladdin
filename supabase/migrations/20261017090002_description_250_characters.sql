-- Migration: description / details limit is 250 CHARACTERS (not words).
--
-- Business rule change: every showroom free-text description is at most 250 Unicode characters
-- (char_length counts characters, not bytes, so Arabic and mixed text count the same as English).
-- Applies to Product Description (products.short_description) and Offer Description
-- (product_offers.description); there is no separate offer conditions/notes column in this scope.
--
-- The two canonical validators are re-created with the SAME signatures (so every create/update path
-- gets the new rule). The table CHECKs stay as a generous sanity ceiling (5000 characters) on purpose:
-- a historical row written under the old 250-WORD rule may exceed 250 characters, and a stricter table
-- CHECK would make such a row impossible to archive/pause/restore. Such a row is simply asked to be
-- shortened the next time its details are edited.
alter table public.products drop constraint ck_products_desc_words;
alter table public.products
  add constraint ck_products_desc_len check (short_description is null or char_length(short_description) <= 5000);
alter table public.product_offers drop constraint ck_product_offers_description_words;
alter table public.product_offers
  add constraint ck_product_offers_description check (description is null or char_length(description) <= 5000);

comment on column public.products.short_description is
  'Product description, at most 250 characters (enforced by app.own_product_validate; the table keeps a 5000-character ceiling so historical longer rows stay lifecycle-safe).';
comment on column public.product_offers.description is
  'Offer description, at most 250 characters (enforced by app.offer_validate_text; 5000-character table ceiling for historical rows).';

CREATE OR REPLACE FUNCTION app.offer_validate_text(p_title text, p_description text, p_total_price numeric, p_reference_price numeric)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if p_title is null or char_length(btrim(p_title)) not between 2 and 100 then
    raise exception 'the offer name must be 2 to 100 characters' using errcode = '22023';
  end if;
  if p_description is not null and char_length(p_description) > 250 then
    raise exception 'the offer description is limited to 250 characters' using errcode = '22023';
  end if;
  if p_reference_price is not null and (
       p_reference_price <= 0 or p_reference_price > 100000000 or scale(p_reference_price) > 2
       or p_reference_price <= p_total_price) then
    raise exception 'the price before the offer must be greater than the offer price' using errcode = '22023';
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION app.own_product_validate(p_org_id uuid, p_exclude_id uuid, p_name text, p_code text, p_category_code text, p_unit product_unit, p_prev_unit product_unit, p_weight_kg numeric, p_size_label text, p_brand text, p_description text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_description is not null and char_length(p_description) > 250 then
    raise exception 'description is limited to 250 characters' using errcode = '22023';
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
$function$;