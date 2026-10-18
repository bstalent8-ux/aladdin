-- ===========================================================================
-- Offer audiences follow the canonical taxonomy
--
-- `wholesaler` is a Supplier subtype and `interior_designer` was never an
-- approved account, so neither is an offer audience any more. Existing offer
-- targets are carried to the account they belong to (wholesaler -> supplier,
-- interior_designer -> engineer) without duplicating a target an offer already
-- names.
-- ===========================================================================
insert into public.product_offer_audiences (offer_id, audience)
select offer_id, 'supplier' from public.product_offer_audiences where audience = 'wholesaler'
on conflict do nothing;

insert into public.product_offer_audiences (offer_id, audience)
select offer_id, 'engineer' from public.product_offer_audiences where audience = 'interior_designer'
on conflict do nothing;

delete from public.product_offer_audiences where audience in ('wholesaler', 'interior_designer');
delete from public.offer_audience_types where code in ('wholesaler', 'interior_designer');

comment on table public.offer_audience_types is
  'Canonical offer audiences: organization_type values (business viewers) and persona_type values (personal viewers). contractor_company and design_office are the internal businesses behind the public Contractor and Engineer accounts. feed_ready = a shell with an Offers feed exists for it today.';
