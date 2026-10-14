-- UI review: optional onboarding address, 250 words; description max 250 characters.
create or replace function app.business_address_word_count(value text) returns integer language sql immutable set search_path='' as $$ select case when nullif(btrim(normalized),'') is null then 0 else cardinality(regexp_split_to_array(btrim(normalized), ' +')) end from (select regexp_replace(value, U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g') normalized) words $$;
revoke all on function app.business_address_word_count(text) from public;
alter table public.business_creation_drafts drop constraint business_draft_contact_shape;
alter table public.business_creation_drafts add constraint business_draft_contact_shape check ((contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{6,14}$') and (contact_email is null or char_length(contact_email)<=254) and (detailed_address is null or (char_length(detailed_address)<=16384 and app.business_address_word_count(detailed_address)<=250)));
alter table public.branches drop constraint ck_branches_address_ar_len, drop constraint ck_branches_address_en_len;
alter table public.branches add constraint ck_branches_address_ar_len check(address_ar is null or (char_length(address_ar) between 1 and 16384 and app.business_address_word_count(address_ar)<=250)), add constraint ck_branches_address_en_len check(address_en is null or (char_length(address_en) between 1 and 16384 and app.business_address_word_count(address_en)<=250));
create or replace function public.business_draft_save(
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

  if char_length(btrim(p_description))>250 then raise exception 'description exceeds 250 characters' using errcode='22023'; end if;
  if p_contact_phone is not null and p_contact_phone !~ '^\+[1-9][0-9]{6,14}$' then raise exception 'invalid showroom phone' using errcode='22023'; end if;
  if v_email is not null and (char_length(v_email)>254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'invalid showroom email' using errcode='22023'; end if;
  if v_address is not null and (char_length(v_address)>16384 or app.business_address_word_count(v_address)>250) then raise exception 'address too long' using errcode='22023'; end if;
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
    detailed_address = case when p_detailed_address is null then detailed_address else v_address end,
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

  if v_d.governorate is null or (v_d.city is null and v_d.city_custom_name is null) then raise exception 'business location is required' using errcode='22023'; end if;
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
create or replace function app.profile_completion(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := p_user_id;
  v_profile   public.profiles;
  v_op        public.onboarding_progress;
  v_io        public.individual_onboarding;
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
  v_missing   text[] := '{}'::text[];
  v_total     int := 0;
  v_done      int := 0;
  v_has_org   boolean := false;
  v_can_manage boolean := false;
  v_needs_activities boolean := false;
begin
  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  select * into v_io from public.individual_onboarding where user_id = v_uid;
  v_persona := coalesce(app.effective_persona(v_uid), v_op.selected_persona);
  v_org_type := v_op.selected_org_type;

  -- ALL-AUDIENCES criteria. 'locality' is intentionally absent (product-owner
  -- decision 2026-09-24, see 20260924090011 header §7).
  v_total := v_total + 4;
  if v_profile.username is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'username'); end if;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

  if v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'interior_designer', 'contractor', 'sales') then
    v_total := v_total + 3;
    if v_profile.headline is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'headline'); end if;
    if v_io.prof_years_experience is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if v_profile.bio is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'bio'); end if;

    v_needs_activities := v_persona = 'installer_technician'
      or exists (select 1 from public.activities a where a.persona_type = v_persona and a.is_active);
    if v_needs_activities then
      v_total := v_total + 1;
      if exists (select 1 from public.user_activities ua where ua.user_id = v_uid)
         or (v_persona = 'installer_technician' and exists (
               select 1 from public.user_trades ut
               join public.trades t on t.id = ut.trade_id
               where ut.user_id = v_uid and t.is_active)) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'activities');
      end if;
    end if;
  end if;

  if v_org_type is not null then
    select exists (
      select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active'
    ) into v_has_org;
    select exists (
      select 1 from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id
      where m.user_id = v_uid and m.status = 'active' and c.capability_key = 'org.manage'
    ) into v_can_manage;

    v_total := v_total + 1;
    if v_has_org then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'organization_setup');
    end if;
    if v_can_manage then
      v_total := v_total + 1;
      if exists (
        select 1 from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        join public.organization_activities oa on oa.organization_id = m.organization_id
        where m.user_id = v_uid and m.status = 'active'
      ) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'organization_activities');
      end if;
    end if;
  end if;

  if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer') then
    v_total := v_total + 1;
    if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer' and not exists(select 1 from public.branches b where b.organization_id=o.id and b.deleted_at is null and b.is_active and (nullif(btrim(b.address_ar),'') is not null or nullif(btrim(b.address_en),'') is not null))) then
      v_missing := array_append(v_missing,'organization_address');
    else v_done := v_done + 1; end if;
  end if;
  return jsonb_build_object(
    'percent', case when v_total = 0 then 100 else round(100.0 * v_done / v_total) end,
    'missing', to_jsonb(v_missing),
    'audience', jsonb_build_object('persona', v_persona, 'organization_type', v_org_type),
    'has_org', v_has_org
  );
end;
$$;

revoke execute on function app.profile_completion(uuid) from public, anon, authenticated;
notify pgrst,'reload schema';
