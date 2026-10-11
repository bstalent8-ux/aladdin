-- Every table that records a business type chosen by a user accepts only the
-- registerable business types, so contractor_company (internal, carries the
-- Contractor audience) cannot enter through a referral, an onboarding row or a
-- registration intent either. Admin/seed tooling is unaffected: the
-- organizations trigger still lets a caller with no end-user JWT create it.
update public.business_onboarding set org_type = null where org_type = 'contractor_company';
update public.onboarding_progress set selected_org_type = null where selected_org_type = 'contractor_company';
delete from public.organization_referrals where org_type = 'contractor_company' and status::text in ('submitted', 'pending');

alter table public.business_onboarding
  add constraint ck_business_onboarding_registerable_type check (
    org_type is null or org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office'));
alter table public.onboarding_progress
  add constraint ck_onboarding_progress_registerable_type check (
    selected_org_type is null or selected_org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office'));
alter table public.organization_referrals
  add constraint ck_organization_referrals_registerable_type check (
    org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office'));
