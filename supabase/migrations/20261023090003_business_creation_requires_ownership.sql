-- ===========================================================================
-- Account eligibility to add a business: ownership, not just a capability.
--
-- app.can_create_or_complete_business let ANY active member holding org.manage on an approved
-- Showroom / Supplier / Manufacturer / Importer add a business of their own. org.manage is a
-- capability an owner can hand to a manager, so a manager could use someone else's approved
-- organization as the credential for opening their own. Eligibility through an approved
-- organization now requires OWNING it (app.owned_org_ids): the founder who still manages it, or a
-- co-owner an Admin has verified. Everything else in the function is unchanged.
-- ===========================================================================
create or replace function app.can_create_or_complete_business(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_uid is not null
    and (
      exists (
        select 1 from public.business_creation_drafts d
        where d.user_id = p_uid and d.completed_at is null
      )
      or (
        not exists (
          select 1 from public.users u
          where u.id = p_uid and u.primary_account_type in ('sales', 'installer_technician')
        )
        and not exists (
          select 1 from public.individual_onboarding io
          where io.user_id = p_uid and io.prof_concrete_type in ('sales', 'installer_technician')
        )
        and (
          (
            not app.has_personal_persona(p_uid)
            and exists (
              select 1 from public.onboarding_progress op
              where op.user_id = p_uid
                and op.selected_track = 'business'
                and op.selected_org_type in
                  ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office', 'contractor_company')
            )
          )
          or coalesce(app.effective_persona(p_uid) in ('engineer', 'contractor'), false)
          or exists (
            select 1
            from app.owned_org_ids(p_uid) owned (id)
            join public.organizations o on o.id = owned.id
            where o.status = 'active'::public.org_status
              and o.org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer')
          )
        )
      )
    ),
    false
  );
$$;
revoke all on function app.can_create_or_complete_business(uuid) from public, anon, authenticated, service_role;
