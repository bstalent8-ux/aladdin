-- First-business registration: the registered organization type is the type created.
--
-- WHY THIS EXISTS
-- A business registration (showroom_dealer, supplier, manufacturer, importer) makes
-- creating the FIRST business mandatory, and the type chosen at sign-up must be the
-- type of that first organization. The application enforces it (the onboarding page
-- presets and locks the type, `saveBusiness` forces it), but
-- `public.business_draft_save` / `public.business_draft_submit` are SECURITY DEFINER
-- RPCs that `authenticated` may EXECUTE, so a signed-in caller can skip Next.js and
-- pass a different approved `org_type`. The boundary must hold the same invariant.
--
-- THE INVARIANT
--   While a caller is in the mandatory FIRST-business registration state, the draft
--   they save and the organization they submit MUST carry the type they registered.
--
-- THE STATE (one canonical helper: app.mandatory_registration_business_type)
--   The helper returns the registered organization_type only while ALL of these hold,
--   and NULL otherwise. It mirrors the application gate
--   (decideMandatoryBusinessSetup) and entitlement path B
--   (app.can_create_or_complete_business) so the two can never disagree:
--     * onboarding_progress.selected_track = 'business'
--     * onboarding_progress.selected_org_type is an approved type
--       (showroom_dealer, supplier, manufacturer, importer)
--     * no personal persona (app.has_personal_persona)
--     * no ACTIVE membership in a live organization (what my_workspaces reports)
--     * no COMPLETED business draft (the first organization was never created)
--     * not platform staff (platform_role_grants)
--
-- WHAT IS NOT LOCKED
--   The lock is NOT permanent and NOT global. Once the first organization exists the
--   registrant holds an active membership and a completed draft, the helper returns
--   NULL, and `/business/new` may add any approved type. An Engineer, an existing
--   Owner, an invited employee, an Installer and a Salesperson are never in this state,
--   so their behaviour (including who is DENIED) is exactly as before.
--
-- BEHAVIOUR CHANGE (the only one)
--   business_draft_save   locked state: p_org_type different from the registered type ->
--                         22023, nothing written. A NULL p_org_type is stored as NULL
--                         (unchanged: submit already refuses a typeless draft). This
--                         applies to a NEW draft and to an UPDATE of an OPEN draft, so
--                         a stale draft value can never override the registration.
--   business_draft_submit locked state: an open draft whose type differs is refused with
--                         22023 before anything is created.
--   The wrappers business_save / business_submit call these functions, so they are
--   covered without change. No function signature changes. organization_create_owned
--   is internal and is only reachable through business_draft_submit.
--
-- The application checks stay (UI preset + server action + this boundary).
-- RLS and grants are unchanged. `organization_setup_pending` is NOT revived.

create or replace function app.mandatory_registration_business_type(p_uid uuid)
returns public.organization_type
language sql
stable
security definer
set search_path = ''
as $$
  select op.selected_org_type
  from public.onboarding_progress op
  where p_uid is not null
    and op.user_id = p_uid
    and op.selected_track = 'business'
    and op.selected_org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer')
    and not app.has_personal_persona(p_uid)
    and not exists (
      select 1
      from public.memberships m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = p_uid and m.status = 'active'
    )
    and not exists (
      select 1 from public.business_creation_drafts d
      where d.user_id = p_uid and d.completed_at is not null
    )
    and not exists (
      select 1 from public.platform_role_grants g where g.user_id = p_uid
    );
$$;

comment on function app.mandatory_registration_business_type(uuid) is
  'The organization_type a caller registered with, returned ONLY while they are still in the mandatory first-business registration state (see migration 20261010090001); NULL otherwise. Callers pass auth.uid(); internal, not granted to clients.';

revoke execute on function app.mandatory_registration_business_type(uuid) from public, anon, authenticated;

-- =====================================================================
-- business_draft_save — lock the type while the first business is outstanding.
-- =====================================================================
create or replace function public.business_draft_save(
  p_draft_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_org_type public.organization_type default null,
  p_description text default null,
  p_governorate text default null,
  p_city text default null,
  p_primary_branch_name text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
  v_completed timestamptz;
  v_lock public.organization_type;
begin
  if p_draft_id is null then
    select d.id into v_id
    from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
  else
    select d.id, d.completed_at into v_id, v_completed
    from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
    if v_id is null then
      raise exception 'business draft not found' using errcode = '42501';
    end if;
    if v_completed is not null then
      raise exception 'this business has already been created' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    -- Opening a NEW draft is the point at which an entitlement is required.
    if app.can_create_or_complete_business(v_uid) is not true then
      raise exception 'adding a business is not available for this account' using errcode = '42501';
    end if;
  end if;

  -- FIRST-BUSINESS REGISTRATION: the registered type is the only type this caller may
  -- save, for a new draft and for an update of an open one alike.
  v_lock := app.mandatory_registration_business_type(v_uid);
  if v_lock is not null then
    if p_org_type is not null and p_org_type <> v_lock then
      raise exception 'the business type must match the type chosen at registration' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
      nullif(left(btrim(coalesce(p_city, '')), 80), ''),
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

-- =====================================================================
-- business_draft_submit — refuse a draft whose type is not the registered one.
-- =====================================================================
create or replace function public.business_draft_submit(p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_d      public.business_creation_drafts;
  v_locale text;
  v_org_id uuid;
  v_lock   public.organization_type;
begin
  if p_draft_id is null then
    select * into v_d from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
    -- No OPEN draft: the caller has already completed this creation and is
    -- retrying without a handle (the no-arg registration wrapper). Return their
    -- most recent result rather than erroring — and, crucially, rather than
    -- treating "nothing open" as licence to create another business. A caller who
    -- genuinely wants a second business opens a new draft first.
    if v_d.id is null then
      select * into v_d from public.business_creation_drafts d
      where d.user_id = v_uid and d.organization_id is not null
      order by d.completed_at desc
      limit 1;
    end if;
  else
    select * into v_d from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
  end if;

  if v_d.id is null then
    raise exception 'business draft not found' using errcode = '42501';
  end if;

  -- IDEMPOTENT: this draft already produced its organization.
  if v_d.organization_id is not null then
    return v_d.organization_id;
  end if;

  -- The entitlement is checked before anything is created. An open draft passes
  -- (path A), so a legitimately started business can always be finished.
  if app.can_create_or_complete_business(v_uid) is not true then
    raise exception 'adding a business is not available for this account' using errcode = '42501';
  end if;

  -- FIRST-BUSINESS REGISTRATION: a draft of any other type (for example one saved
  -- before this rule existed) cannot become the first organization.
  v_lock := app.mandatory_registration_business_type(v_uid);
  if v_lock is not null and v_d.org_type is distinct from v_lock then
    raise exception 'the business type must match the type chosen at registration' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(v_d.display_name, '')), '') is null then
    raise exception 'a business name is required' using errcode = '22023';
  end if;
  if v_d.org_type is null then
    raise exception 'a business type is required' using errcode = '22023';
  end if;

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name);

  update public.business_creation_drafts
     set organization_id = v_org_id, completed_at = now()
   where id = v_d.id;

  -- Keep the superseded per-user row consistent for anything still reading it.
  update public.business_onboarding
     set organization_id = v_org_id, completed_at = now()
   where user_id = v_uid and organization_id is null;

  perform app.record_audit_event('onboarding.organization_created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', v_d.org_type, 'draft_id', v_d.id));
  return v_org_id;
end;
$$;

-- Grants are unchanged; re-stated so a replay cannot widen or narrow access.
revoke execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text) from public, anon;
grant  execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text) to authenticated;
revoke execute on function public.business_draft_submit(uuid) from public, anon;
grant  execute on function public.business_draft_submit(uuid) to authenticated;
