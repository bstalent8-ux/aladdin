-- rc1 (registration reconciliation): main's registration rules AND Showroom's application model in ONE definition.
--
-- Showroom's 20261015090028 / 090030 re-created business_draft_save with the OLD 8-argument signature (resurrecting an
-- overload main dropped in 20261011090002 -> "function is not unique" on every named call) and rewrote
-- business_draft_submit without main's legal name, Egypt location and registration type lock.
-- This migration: drops the stale 8-arg overload; defines the single 9-arg business_draft_save and business_draft_submit as
--   main's 20261011090002 behaviour (legal name required to submit, canonical Egypt location, first-business type lock)
--   PLUS Showroom's per-user advisory lock, contractor_company guard and one-open-application slot check.
-- Nothing is deleted from either side; the grants are unchanged.
drop function if exists public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text);
-- KNOWN, ACCEPTED: Showroom also re-created the pre-registration 4-argument app.organization_create_owned. It is executable by
-- service_role only (no client path) and Showroom's pgTAP fixtures call it, so it is kept; every client path goes through
-- business_draft_submit below, which uses main's 8-argument creator (legal name + location required).

create or replace function public.business_draft_save(
  p_draft_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_org_type public.organization_type default null,
  p_description text default null,
  p_governorate text default null,
  p_city text default null,
  p_primary_branch_name text default null,
  p_city_custom_name text default null
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
  v_gov text;
  v_city text;
  v_custom text;
  v_slot text;
begin
  -- Showroom application model: one open application per person at a time, decided under a per-user lock.
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));

  if p_org_type = 'contractor_company' and not app.may_hold_contractor_company(v_uid) then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;

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
    v_slot := app.application_slot(v_uid);
    if v_slot not in ('first_available', 'additional_available') then
      raise exception 'an organization application is not available right now'
        using errcode = '42501', hint = v_slot;
    end if;
    if p_org_type is not null and p_org_type <> 'contractor_company'
       and app.effective_persona(v_uid) = 'contractor'
       and not exists (select 1 from app.owned_org_ids(v_uid)) then
      raise exception 'a Contractor applies for a contractor organization' using errcode = '42501';
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

  -- Whatever location is supplied must be canonical; an unset location is fine while editing.
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(p_governorate, p_city, p_city_custom_name, false);

  if v_id is null then
    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, city_custom_name, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      app.description_text(p_description),
      v_gov, v_city, v_custom,
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = app.description_text(p_description),
    governorate         = v_gov,
    city                = v_city,
    city_custom_name    = v_custom,
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

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
  v_legal  text;
  v_gov    text;
  v_city   text;
  v_custom text;
  v_slot   text;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));

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
  v_slot := app.application_slot(v_uid);
  if v_slot not in ('first_available', 'additional_available') then
    raise exception 'an organization application is not available right now'
      using errcode = '42501', hint = v_slot;
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
  v_legal := nullif(btrim(coalesce(v_d.legal_name, '')), '');
  if v_legal is null then
    raise exception 'a legal business name is required' using errcode = '22023';
  end if;
  if char_length(v_legal) < 2 or char_length(v_legal) > 120 then
    raise exception 'the legal business name must be 2..120 characters' using errcode = '22023';
  end if;
  if v_d.org_type is null then
    raise exception 'a business type is required' using errcode = '22023';
  end if;

  -- A location is optional, but a chosen governorate needs a valid city (historical draft keys are normalised).
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(v_d.governorate, v_d.city, v_d.city_custom_name, true);

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name,
    v_legal, v_gov, v_city, v_custom);

  -- Showroom: the business description is validated (250 chars, rejected not truncated) and stored on the ORGANIZATION.
  update public.organizations set description = app.description_text(v_d.description) where id = v_org_id;

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

revoke execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text) from public, anon;
grant  execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text) to authenticated;
revoke execute on function public.business_draft_submit(uuid) from public, anon;
grant  execute on function public.business_draft_submit(uuid) to authenticated;
