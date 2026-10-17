-- Email + password and Google/Facebook sign-in on the Showroom and Installer
-- entry pages. Same account-type rule as public.phone_password_account_allowed
-- (20261014085731), minus the phone binding: those credentials are not keyed by
-- a phone alias. Caller id comes only from auth.uid(); the route a person used
-- (p_kind) only selects which rule is checked and never grants anything.
create or replace function public.account_entry_allowed(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select auth.uid()) is not null
    and case p_kind
      when 'installer' then app.effective_persona((select auth.uid())) = 'installer_technician'::public.persona_type
      when 'showroom' then
        (app.mandatory_registration_business_type((select auth.uid())) = 'showroom_dealer'::public.organization_type
         and app.can_create_or_complete_business((select auth.uid())))
        or exists (select 1 from public.my_workspaces() w where w.kind = 'business' and w.org_type = 'showroom_dealer')
      else false end,
    false
  );
$$;
revoke all on function public.account_entry_allowed(text) from public, anon;
grant execute on function public.account_entry_allowed(text) to authenticated;

notify pgrst, 'reload schema';
