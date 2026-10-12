-- Business creation: required LEGAL NAME on the organization, and the PRIMARY BRANCH owns the physical location.
--
-- PRODUCT DECISIONS (2026-10-11)
--   * Every business created through Aladdin (Showroom, Supplier, Manufacturer, Importer) must have a LEGAL /
--     REGISTERED name in addition to its business (trading / display) name. Both are required to COMPLETE creation,
--     for the mandatory first business and for later businesses alike. Description stays optional.
--       organizations.name        = display / trading / public-facing name        (unchanged)
--       organizations.legal_name  = official registered legal name                (NEW, PRIVATE)
--   * Location belongs to the BRANCH, not the organization: one organization may have branches in several
--     governorates and cities. The organization owns legal identity; the branch owns the physical place.
--       branches.governorate_key  = canonical governorate key  (app.place_governorates)
--       branches.city_key         = canonical city key INSIDE that governorate (app.place_cities), or NULL
--       branches.city_custom_name = the city the user typed through "Other", or NULL
--     "Other" is a UI state only: neither 'other' nor a literal "Other"/"أخرى" is ever stored.
--
-- HISTORICAL DATA. organizations.legal_name and the branch location columns are NULLABLE. Existing organizations and
-- branches are not backfilled (legal_name is NOT copied from name: there is no verified legal data). Only the
-- canonical creation path requires them.
--
-- ONE CREATION PATH. business_draft_submit stays the only production caller of app.organization_create_owned; the
-- authority is extended rather than duplicated. Required legal name and the location rules are enforced at the
-- database boundary (UI and server action check them earlier for UX, this is the final authority):
--   LEGAL NAME  : non-blank, trimmed, 2..120 characters.
--   LOCATION    : optional as a whole; once a governorate is chosen it must exist in app.place_governorates and a
--                 city is required: either a catalogue city that belongs to THAT governorate, or a custom name
--                 (2..80 characters, never the literal "other"). A custom name that is a catalogue city of the same
--                 governorate is stored as that city. Historical underscore keys (nasr_city, new_cairo, sheikh_zayed,
--                 october_6, ...) resolve to the catalogue keys.
--
-- SIGNATURES. Two internal/public signatures gain trailing parameters and the old ones are dropped (an overload would
-- make every named-argument call ambiguous):
--   public.business_draft_save(...)      + p_city_custom_name text default null          (existing callers unchanged)
--   app.organization_create_owned(...)   + p_legal_name (required), p_governorate_key, p_city_key, p_city_custom_name
-- Grants are re-stated exactly as before. The PR #76 first-business registered-type lock is carried over unchanged.
--
-- PRIVACY. legal_name and the branch location are readable only through the existing member / platform-admin RLS.
-- No public view or function selects them (organization_public_directory lists its columns explicitly).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.organizations add column legal_name text;

alter table public.organizations
  add constraint ck_organizations_legal_name
  check (legal_name is null or (legal_name = btrim(legal_name) and char_length(legal_name) between 2 and 120));

comment on column public.organizations.legal_name is
  'Official registered legal business name. PRIVATE: never exposed through the public directory or any anonymous projection. NULL for historical organizations; required for every organization created through the canonical business flow.';

alter table public.branches
  add column governorate_key  text,
  add column city_key         text,
  add column city_custom_name text;

alter table public.branches
  add constraint ck_branches_city_exclusive
    check (city_key is null or city_custom_name is null),
  add constraint ck_branches_city_needs_governorate
    check ((city_key is null and city_custom_name is null) or governorate_key is not null),
  add constraint ck_branches_city_key_not_other
    check (city_key is distinct from 'other'),
  add constraint ck_branches_city_custom_shape
    check (city_custom_name is null
           or (city_custom_name = btrim(city_custom_name) and char_length(city_custom_name) between 2 and 80));

comment on column public.branches.governorate_key is
  'Canonical governorate key (app.place_governorates). The branch, not the organization, owns the physical location.';
comment on column public.branches.city_key is
  'Canonical city key inside governorate_key (app.place_cities), or NULL. Never the literal "other".';
comment on column public.branches.city_custom_name is
  'City typed by the user through "Other" when it is not in the catalogue; mutually exclusive with city_key.';

alter table public.business_creation_drafts
  add column city_custom_name text,
  add constraint ck_bcd_city_custom_len check (city_custom_name is null or char_length(city_custom_name) <= 80);

comment on column public.business_creation_drafts.city_custom_name is
  'Custom city typed through "Other" (new drafts). governorate/city hold the canonical keys; historical drafts may still carry the legacy underscore keys, which are normalised when the draft is saved or submitted.';

-- ---------------------------------------------------------------------------
-- 2a. Historical drafts: EVERY city value the old Business wizard (4-governorate "persona" vocabulary) could store.
--     A saved answer is never discarded because the taxonomy was upgraded:
--       A. it maps cleanly to a catalogue city of the same governorate -> city_key;
--       B. it is a valid place the catalogue does not list there -> kept as the person's own typed city (English wording; the
--          application resumes it in the person's language).
--     Twin of LEGACY_BUSINESS_CITIES in frontend/src/lib/location/business-location.ts (a table-driven test pins both).
--     "shibin" is labelled "Shibin El Kom" in the old list, a city of Monufia, so it is preserved as typed text rather than
--     mapped onto a Qalyubia city.
-- ---------------------------------------------------------------------------
create or replace function app.legacy_business_city(p_governorate_key text, p_value text)
returns table (city_key text, custom_name text)
language sql
immutable
set search_path = ''
as $$
  select v.city_key, v.custom_name
  from (values
    ('cairo',      'nasr_city',    'nasr-city'::text,    null::text),
    ('cairo',      'new_cairo',    'new-cairo',          null),
    ('cairo',      'maadi',        'maadi',              null),
    ('cairo',      'heliopolis',   'heliopolis',         null),
    ('cairo',      'downtown',     'downtown',           null),
    ('giza',       'sheikh_zayed', 'sheikh-zayed',       null),
    ('giza',       'dokki',        'dokki',              null),
    ('giza',       'mohandessin',  'mohandessin',        null),
    ('giza',       'october_6',    'october-6',          null),
    ('alexandria', 'smouha',       null,                 'Smouha'),
    ('alexandria', 'miami',        null,                 'Miami'),
    ('alexandria', 'sidi_gaber',   'sidi-jabir',         null),
    ('qalyubia',   'shibin',       null,                 'Shibin El Kom'),
    ('qalyubia',   'banha',        'banha',              null),
    ('qalyubia',   'qalyub',       'qalyub',             null)
  ) as v(governorate_key, legacy_value, city_key, custom_name)
  where v.governorate_key = p_governorate_key and v.legacy_value = p_value;
$$;

comment on function app.legacy_business_city(text, text) is
  'Compatibility map for every city value the old Business wizard could store (see migration 20261011090002). Internal.';
revoke execute on function app.legacy_business_city(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. The ONE location rule (shared by draft save, submit, organization creation and the branch guard)
-- ---------------------------------------------------------------------------
create or replace function app.normalize_business_location(
  p_governorate text,
  p_city        text,
  p_city_custom text,
  p_complete    boolean,
  out o_governorate text,
  out o_city        text,
  out o_custom      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gov    text := nullif(btrim(coalesce(p_governorate, '')), '');
  v_city   text := nullif(btrim(coalesce(p_city, '')), '');
  v_custom text := nullif(btrim(regexp_replace(coalesce(p_city_custom, ''), '\s+', ' ', 'g')), '');
  -- "Other" is a UI control; none of its spellings may become a stored city.
  v_other  text[] := array['other', 'other city', 'أخرى', 'اخرى', 'اخري', 'مدينة أخرى', 'مدينة اخرى'];
  v_hit    text;
  v_legacy_key    text;
  v_legacy_custom text;
begin
  if v_gov is null then
    if v_city is not null or v_custom is not null then
      raise exception 'a city requires a governorate' using errcode = '22023';
    end if;
    return;   -- location left unset: allowed
  end if;

  -- Historical drafts hold underscore keys (nasr_city, october_6); the catalogue uses kebab-case.
  o_governorate := app.resolve_governorate(replace(v_gov, '_', '-'));
  if o_governorate is null then
    raise exception 'unknown governorate' using errcode = '22023';
  end if;

  if v_city is not null and v_custom is not null then
    raise exception 'choose a city from the list or enter one, not both' using errcode = '22023';
  end if;

  if v_city is not null then
    if app.normalize_place(v_city) = any (select app.normalize_place(x) from unnest(v_other) x) then
      raise exception 'other is not a city' using errcode = '22023';
    end if;
    -- A value the OLD wizard stored: mapped to a catalogue city, or kept as the typed city (never dropped).
    select l.city_key, l.custom_name into v_legacy_key, v_legacy_custom
    from app.legacy_business_city(o_governorate, v_city) l;
    if v_legacy_custom is not null then
      o_custom := v_legacy_custom;
    else
      o_city := coalesce(v_legacy_key, app.resolve_city(o_governorate, replace(v_city, '_', '-')));
      -- Not in THIS governorate's catalogue (including a city of another governorate) is rejected.
      if o_city is null or o_city = 'other' then
        raise exception 'unknown city for this governorate' using errcode = '22023';
      end if;
    end if;
  elsif v_custom is not null then
    if char_length(v_custom) < 2 or char_length(v_custom) > 80 then
      raise exception 'the city name must be 2..80 characters' using errcode = '22023';
    end if;
    if app.normalize_place(v_custom) = any (select app.normalize_place(x) from unnest(v_other) x) then
      raise exception 'other is not a city' using errcode = '22023';
    end if;
    -- A name that IS a catalogue city of this governorate is stored as that city.
    v_hit := app.resolve_city(o_governorate, v_custom);
    if v_hit is not null and v_hit <> 'other' then
      o_city := v_hit;
    else
      o_custom := v_custom;
    end if;
  end if;

  if p_complete and o_city is null and o_custom is null then
    raise exception 'a city is required once a governorate is chosen' using errcode = '22023';
  end if;
end;
$$;

comment on function app.normalize_business_location(text, text, text, boolean) is
  'The single business-location rule: validates governorate / city / custom city against the Egypt place catalogue and returns the canonical (governorate_key, city_key, city_custom_name). Internal; not granted to clients.';
revoke execute on function app.normalize_business_location(text, text, text, boolean) from public, anon, authenticated;

-- A branch location can only ever be canonical, whichever writer sets it.
create or replace function app.guard_branch_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if new.governorate_key is null and new.city_key is null and new.city_custom_name is null then
    return new;
  end if;
  select * into v from app.normalize_business_location(new.governorate_key, new.city_key, new.city_custom_name, false);
  if v.o_governorate is distinct from new.governorate_key
     or v.o_city is distinct from new.city_key
     or v.o_custom is distinct from new.city_custom_name then
    raise exception 'branch location must use canonical catalogue values' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_branch_location() from public, anon, authenticated;

create trigger guard_branch_location
  before insert or update of governorate_key, city_key, city_custom_name on public.branches
  for each row execute function app.guard_branch_location();

-- ---------------------------------------------------------------------------
-- 3. app.organization_create_owned — the ONE writer, extended
-- ---------------------------------------------------------------------------
drop function app.organization_create_owned(text, public.organization_type, text, text);

create function app.organization_create_owned(
  p_name             text,
  p_org_type         public.organization_type,
  p_locale           text,
  p_branch_name      text,
  p_legal_name       text,
  p_governorate_key  text default null,
  p_city_key         text default null,
  p_city_custom_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := btrim(coalesce(p_name, ''));
  v_legal  text := btrim(coalesce(p_legal_name, ''));
  v_locale text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  v_gov    text;
  v_city   text;
  v_custom text;
  v_org_id uuid;
  v_mid    uuid;
  v_bid    uuid;
  v_cap    text;
  v_caps   text[] := array[
    'org.manage', 'org.members.manage', 'branch.manage',
    'verification.submit', 'verification.read',
    'catalog.read', 'catalog.write', 'catalog.publish', 'inventory.write',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
    'project.read', 'project.write', 'conversation.participate', 'ad.manage',
    'subscription.read', 'subscription.manage', 'analytics.view', 'export.data',
    'activity.read'
  ];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'organization name must be 2..120 characters' using errcode = '22023';
  end if;
  if char_length(v_legal) < 2 or char_length(v_legal) > 120 then
    raise exception 'a legal business name of 2..120 characters is required' using errcode = '22023';
  end if;
  if p_org_type is null then
    raise exception 'a business organization type is required' using errcode = '22023';
  end if;

  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(p_governorate_key, p_city_key, p_city_custom_name, true);

  insert into public.organizations (name, legal_name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, v_legal, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  insert into public.branches (organization_id, name, governorate_key, city_key, city_custom_name)
  values (v_org_id, coalesce(v_branch, v_name), v_gov, v_city, v_custom)
  returning id into v_bid;

  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
  values (v_uid, v_org_id, v_bid, 'active', v_uid, now())
  returning id into v_mid;

  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', p_org_type, 'status', 'pending_verification'));
  perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
    jsonb_build_object('primary', true));
  perform app.record_audit_event('membership.granted', 'membership', v_mid, v_org_id,
    jsonb_build_object('user_id', v_uid, 'status', 'active', 'via', 'owner_setup'));
  perform app.record_audit_event('membership.activated', 'membership', v_mid, v_org_id,
    jsonb_build_object('via', 'owner_setup'));

  return v_org_id;
end;
$$;
revoke execute on function app.organization_create_owned(
  text, public.organization_type, text, text, text, text, text, text) from public;
grant execute on function app.organization_create_owned(
  text, public.organization_type, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. business_draft_save — validates whatever location is supplied; a draft may stay incomplete
-- ---------------------------------------------------------------------------
drop function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text);

create function public.business_draft_save(
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
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
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
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = v_gov,
    city                = v_city,
    city_custom_name    = v_custom,
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text) from public, anon;
grant  execute on function public.business_draft_save(uuid, text, text, public.organization_type, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. business_draft_submit — legal name and location are required HERE, then the one creation path runs
-- ---------------------------------------------------------------------------
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

  -- A location is optional, but a chosen governorate needs a valid city (historical draft keys are normalised).
  select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
  from app.normalize_business_location(v_d.governorate, v_d.city, v_d.city_custom_name, true);

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name,
    v_legal, v_gov, v_city, v_custom);

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
