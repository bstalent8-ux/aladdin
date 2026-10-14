-- Reuse existing business drafts, branches and activity catalogue. No identity/approval changes.
alter table public.business_creation_drafts add column contact_phone text, add column contact_email text, add column activity_type text, add column detailed_address text;
alter table public.organizations add column contact_phone text, add column contact_email text;
comment on column public.organizations.contact_phone is 'Unverified business contact; never an authentication identifier.';
comment on column public.organizations.contact_email is 'Unverified business contact; never the internal authentication alias.';
alter table public.business_creation_drafts add constraint business_draft_contact_shape check ((contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$') and (contact_email is null or char_length(contact_email)<=254) and (detailed_address is null or char_length(detailed_address)<=500));
alter table public.organizations add constraint organization_contact_shape check ((contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$') and (contact_email is null or char_length(contact_email)<=254));
drop function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text);
create function public.business_draft_save(
  p_draft_id uuid default null,
  p_legal_name text default null,
  p_display_name text default null,
  p_org_type public.organization_type default null,
  p_description text default null,
  p_governorate text default null,
  p_city text default null,
  p_primary_branch_name text default null,
  p_city_custom_name text default null,
  p_contact_phone text default null, p_contact_email text default null,
  p_activity_type text default null, p_detailed_address text default null
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
  v_email text := nullif(lower(btrim(p_contact_email)), '');
  v_address text := nullif(btrim(p_detailed_address), '');
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

  if p_contact_phone is not null and p_contact_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'invalid showroom phone' using errcode='22023'; end if;
  if v_email is not null and (char_length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'invalid showroom email' using errcode='22023'; end if;
  if v_address is not null and char_length(v_address)>500 then raise exception 'address too long' using errcode='22023'; end if;
  if p_activity_type is not null and not exists(select 1 from public.activities a where a.organization_type='showroom_dealer' and a.key=p_activity_type and a.is_active) then raise exception 'invalid showroom activity' using errcode='22023'; end if;
  -- Whatever location is supplied must be canonical; an unset location is fine while editing.
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(p_governorate, p_city, p_city_custom_name, false);

  if v_id is null then
    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, city_custom_name, primary_branch_name, contact_phone, contact_email, activity_type, detailed_address
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      v_gov, v_city, v_custom,
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), ''), p_contact_phone, v_email, p_activity_type, v_address
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    contact_phone = coalesce(p_contact_phone, contact_phone),
    contact_email = case when p_contact_email is null then contact_email else v_email end,
    activity_type = coalesce(p_activity_type, activity_type),
    detailed_address = coalesce(v_address, detailed_address),
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = v_gov,
    city                = v_city,
    city_custom_name    = v_custom,
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text, text, text, text, text) from public, anon;
grant  execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text, text, text, text, text) to authenticated;

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

  if v_d.governorate is null or (v_d.city is null and v_d.city_custom_name is null) or nullif(btrim(v_d.detailed_address),'') is null then raise exception 'business location is required' using errcode='22023'; end if;
  if v_d.org_type='showroom_dealer' and (v_d.contact_phone is null or v_d.activity_type is null) then raise exception 'showroom phone and activity are required' using errcode='22023'; end if;
  -- A location is optional, but a chosen governorate needs a valid city (historical draft keys are normalised).
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(v_d.governorate, v_d.city, v_d.city_custom_name, true);

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name,
    v_legal, v_gov, v_city, v_custom);

  update public.organizations set contact_phone=v_d.contact_phone, contact_email=v_d.contact_email where id=v_org_id;
  update public.branches set address_ar=v_d.detailed_address where organization_id=v_org_id;
  if v_d.org_type='showroom_dealer' then
    insert into public.organization_activities(organization_id, activity_id)
    select v_org_id,a.id from public.activities a where a.organization_type='showroom_dealer' and a.key=v_d.activity_type and a.is_active;
    if not found then raise exception 'invalid showroom activity' using errcode='22023'; end if;
  end if;
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

revoke execute on function public.business_draft_submit(uuid) from public, anon;
grant  execute on function public.business_draft_submit(uuid) to authenticated;

notify pgrst, 'reload schema';
