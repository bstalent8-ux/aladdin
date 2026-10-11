-- ===========================================================================
-- contractor_company is never created or assigned through a user-facing path
--
-- It is the internal business behind the Contractor account and, since
-- 20261021090003, carries the Contractor audience. A user must therefore not be
-- able to pick it for themselves: business drafts accept only the registerable
-- business types, and a signed-in caller can neither create an organization of
-- that type nor change an organization into it. Seeds and Admin tooling (no
-- end-user JWT) are unaffected.
-- ===========================================================================
update public.business_creation_drafts set org_type = null where org_type = 'contractor_company';
alter table public.business_creation_drafts
  add constraint ck_business_draft_registerable_type check (
    org_type is null or org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office')
  );

create or replace function app.guard_contractor_company_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_type = 'contractor_company'
     and (tg_op = 'INSERT' or old.org_type is distinct from new.org_type)
     and (select auth.uid()) is not null then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_contractor_company_assignment() from public, anon, authenticated, service_role;

create trigger organizations_contractor_company_guard
  before insert or update of org_type on public.organizations
  for each row execute function app.guard_contractor_company_assignment();
