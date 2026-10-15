-- Migration: Business Description (organization-owned) and a 250-character limit on every user-authored description.
--
-- Audit result that drives this file (local database, all values measured, not assumed):
--   * `organizations` had NO description column. The business description typed during registration was kept
--     only on the draft (`business_creation_drafts.description`) and was never copied to the organization, so it
--     was lost when the draft was submitted. The draft save also silently truncated to 1000 characters.
--   * profiles.bio, portfolio_items.description, business_* descriptions were bounded only by 600/1000-character
--     table CHECKs, and the bio/draft RPCs silently truncated with left(..., 1000).
--   * products.short_description and product_offers.description already enforce 250 in their validators.
--
-- Design:
--   * ONE canonical business description: organizations.description (text, <= 250, new column, no legacy rows).
--     It belongs to the organization, never to the creator's personal profile. Written only through
--     public.organization_description_set (live org.manage check, audited); the column has no client UPDATE grant.
--     It is NOT added to any public directory/catalog view, so nothing about public visibility changes.
--   * app.description_text(): one counting rule for every write path. Characters are Unicode code points
--     (PostgreSQL char_length: an Arabic letter or an emoji is one) and a CRLF/CR counts once, exactly like the
--     browser counter. It rejects over-limit input; it never truncates.
--   * Direct-write safeguard: a trigger rejects a NEW or CHANGED over-limit value on the description columns.
--     An UNCHANGED legacy value is left alone, so an unrelated edit of an old over-limit row keeps working and no
--     historical text is cut. The old generous table CHECKs stay (ceiling) for the same reason.
--   * Draft and onboarding rows: nothing is converted. The draft RPC now rejects >250 instead of truncating.

-- 1. one counting/normalising rule ---------------------------------------------------------------------------
create or replace function app.description_norm(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p_value, ''), E'\r\n?', E'\n', 'g'), '^\s+|\s+$', '', 'g'), '')
$$;

-- Normalises and validates a NEW description: over 250 characters is rejected, never cut.
create or replace function app.description_text(p_value text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := app.description_norm(p_value);
begin
  if v is not null and char_length(v) > 250 then
    raise exception 'the description is limited to 250 characters' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- Same, for an edit of an existing row: the value it ALREADY holds is accepted unchanged even if it is a
-- legacy over-limit text, so an unrelated edit never fails and the old text is never cut.
create or replace function app.description_text(p_value text, p_current text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := app.description_norm(p_value);
begin
  if v is not distinct from app.description_norm(p_current) then
    return v;
  end if;
  return app.description_text(p_value);
end;
$$;

create or replace function app.enforce_description_limit()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_col text := tg_argv[0];
  v_new text := app.description_norm(to_jsonb(new) ->> tg_argv[0]);
begin
  if tg_op = 'UPDATE' and v_new is not distinct from app.description_norm(to_jsonb(old) ->> v_col) then
    return new;                                   -- an untouched legacy value is never blocked
  end if;
  if v_new is not null and char_length(v_new) > 250 then
    raise exception 'the description is limited to 250 characters' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app.description_norm(text), app.description_text(text), app.description_text(text, text),
  app.enforce_description_limit() from public, anon;
grant execute on function app.description_text(text), app.description_text(text, text) to authenticated;

-- 2. the canonical organization description -------------------------------------------------------------------
alter table public.organizations add column description text;
alter table public.organizations
  add constraint ck_organizations_description check (description is null or char_length(description) <= 250);
comment on column public.organizations.description is
  'Business description (organization-owned, at most 250 characters). Written only by public.organization_description_set; not part of any public view.';
revoke update (description) on public.organizations from authenticated;
revoke insert (description) on public.organizations from authenticated;

do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'ck_audit_action_known';
  alter table public.audit_log drop constraint ck_audit_action_known;
  execute 'alter table public.audit_log add constraint ck_audit_action_known '
    || regexp_replace(v_def, '\]\)\)\)$', ', ''organization.description_changed''::text])))');
end $$;

create or replace function public.organization_description_set(p_org_id uuid, p_description text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_new text := app.description_text(p_description);
  v_old text;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  select description into v_old from public.organizations where id = p_org_id and deleted_at is null for update;
  if not found then raise exception 'organization not found' using errcode = '42501'; end if;
  if v_new is not distinct from v_old then return v_new; end if;
  update public.organizations set description = v_new where id = p_org_id;
  perform app.record_audit_event('organization.description_changed', 'organization', p_org_id, p_org_id,
    jsonb_build_object('length', coalesce(char_length(v_new), 0)));
  return v_new;
end;
$$;
revoke execute on function public.organization_description_set(uuid, text) from public, anon;
grant execute on function public.organization_description_set(uuid, text) to authenticated;

-- 3. direct-write safeguards (legacy values stay untouched) ---------------------------------------------------
create trigger profiles_description_limit before insert or update of bio on public.profiles
  for each row execute function app.enforce_description_limit('bio');
create trigger portfolio_items_description_limit before insert or update of description on public.portfolio_items
  for each row execute function app.enforce_description_limit('description');
create trigger business_creation_drafts_description_limit before insert or update of description on public.business_creation_drafts
  for each row execute function app.enforce_description_limit('description');
create trigger business_onboarding_description_limit before insert or update of description on public.business_onboarding
  for each row execute function app.enforce_description_limit('description');
create trigger products_description_limit before insert or update of short_description on public.products
  for each row execute function app.enforce_description_limit('short_description');
create trigger product_offers_description_limit before insert or update of description on public.product_offers
  for each row execute function app.enforce_description_limit('description');

-- 4. write paths: reject over-limit input instead of truncating it ------------------------------------------
CREATE OR REPLACE FUNCTION public.business_draft_save(p_draft_id uuid DEFAULT NULL::uuid, p_legal_name text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text, p_org_type organization_type DEFAULT NULL::organization_type, p_description text DEFAULT NULL::text, p_governorate text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_primary_branch_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
  v_completed timestamptz;
  v_slot text;
begin
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

    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      app.description_text(p_description),
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
    description         = app.description_text(p_description),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.business_draft_submit(p_draft_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := app.require_verified_caller();
  v_d      public.business_creation_drafts;
  v_locale text;
  v_org_id uuid;
  v_slot   text;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));

  if p_draft_id is null then
    select * into v_d from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
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

  if v_d.organization_id is not null then
    return v_d.organization_id;                 -- idempotent
  end if;

  if app.can_create_or_complete_business(v_uid) is not true then
    raise exception 'adding a business is not available for this account' using errcode = '42501';
  end if;
  v_slot := app.application_slot(v_uid);
  if v_slot not in ('first_available', 'additional_available') then
    raise exception 'an organization application is not available right now'
      using errcode = '42501', hint = v_slot;
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

  update public.organizations set description = app.description_text(v_d.description) where id = v_org_id;

  update public.business_creation_drafts
     set organization_id = v_org_id, completed_at = now()
   where id = v_d.id;

  update public.business_onboarding
     set organization_id = v_org_id, completed_at = now()
   where user_id = v_uid and organization_id is null;

  perform app.record_audit_event('onboarding.organization_created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', v_d.org_type, 'draft_id', v_d.id));
  return v_org_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.portfolio_item_create(p_title text, p_description text, p_content_type text)
 RETURNS TABLE(item_id uuid, object_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := (select auth.uid());
  v_ext  text;
  v_key  text;
  v_next integer;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- The ONLY persona gate in this domain, and it is on creation alone (§4).
  -- Publishing, editing, reordering and deleting never consult it, so a persona
  -- downgrade can never strand somebody's own data.
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add portfolio work'
      using errcode = '42501';
  end if;

  v_ext := case p_content_type
             when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'
             when 'image/webp' then 'webp'
           end;
  if v_ext is null then
    raise exception 'unsupported content type for portfolio work'
      using errcode = '22023';
  end if;

  -- Opaque and server-generated. The caller contributes nothing to it.
  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;

  select coalesce(max(i.sort_order), -1) + 1 into v_next
  from public.portfolio_items i
  where i.owner_user_id = v_uid and i.state <> 'deleted'::public.professional_asset_state;

  insert into public.portfolio_items
    (owner_user_id, object_key, content_type, title, description, sort_order)
  values
    (v_uid, v_key, p_content_type, btrim(p_title), app.description_text(p_description), v_next)
  returning id into v_id;

  return query select v_id, v_key;
end;
$function$;
CREATE OR REPLACE FUNCTION public.portfolio_item_update(p_item_id uuid, p_title text, p_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  update public.portfolio_items
     set title = btrim(p_title),
         description = app.description_text(p_description, (select pi.description from public.portfolio_items pi where pi.id = p_item_id))
   where id = p_item_id
     and owner_user_id = v_uid
     and state <> 'deleted'::public.professional_asset_state;

  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
end;
$function$;
CREATE OR REPLACE FUNCTION public.individual_save_professional(p_concrete_type persona_type, p_headline text DEFAULT NULL::text, p_years_experience smallint DEFAULT NULL::smallint, p_specialization text DEFAULT NULL::text, p_bio text DEFAULT NULL::text, p_services text[] DEFAULT NULL::text[], p_additional_services text[] DEFAULT NULL::text[], p_languages text[] DEFAULT NULL::text[], p_availability text DEFAULT NULL::text, p_service_areas text[] DEFAULT NULL::text[], p_offers_remote boolean DEFAULT false, p_governorate text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_max_travel_km smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid       uuid := app.require_verified_caller();
  v_track     public.onboarding_track := app.onboarding_selected_track(v_uid);
  v_headline  text := nullif(left(btrim(coalesce(p_headline, '')), 120), '');
  v_bio       text := app.description_text(p_bio, (select pr.bio from public.profiles pr where pr.user_id = (select auth.uid())));
  v_established public.persona_type;
begin
  -- THE GATE. Either the person is mid-professional-onboarding (the track, which
  -- is all a first-time caller has), or they already ARE a professional identity
  -- (canonical or declared). A consumer, a business-only identity and a
  -- trainer/trainee satisfy none of the three and are refused exactly as before.
  if v_track is distinct from 'professional'
     and not app.is_professional_persona(v_uid) then
    raise exception 'a professional account is required to edit a professional profile'
      using errcode = '42501';
  end if;

  if p_concrete_type is null or p_concrete_type not in
     ('engineer', 'installer_technician', 'contractor', 'sales') then
    raise exception 'a valid individual professional type is required' using errcode = '22023';
  end if;

  -- NEW (Increment 12): THE PERSONA IS LOCKED. This is a profile-data writer,
  -- not an account-type switch. The persona it may write is the one the caller
  -- ALREADY has — the declared prof_concrete_type, else a professional canonical
  -- users.primary_account_type (the app.effective_persona rule, narrowed to the
  -- five individual-professional values). Choosing or changing a persona is
  -- public.onboarding_select_account_type's job alone. Consequences:
  --   * a mismatching p_concrete_type is refused BEFORE any write (atomic);
  --   * a caller with no established persona is refused — there is nothing
  --     for the parameter to match, and this RPC must never bootstrap one;
  --   * a Coming Soon type (engineer, contractor, …) can therefore never be
  --     reached through this RPC by a caller who does not already hold it;
  --   * existing holders keep saving under their current persona unchanged.
  select case
           when io.prof_concrete_type in
                ('engineer', 'installer_technician', 'contractor', 'sales')
             then io.prof_concrete_type
         end
    into v_established
  from public.individual_onboarding io
  where io.user_id = v_uid;
  if v_established is null then
    select u.primary_account_type into v_established
    from public.users u
    where u.id = v_uid
      and u.primary_account_type in
          ('engineer', 'installer_technician', 'contractor', 'sales');
  end if;
  if v_established is null then
    raise exception 'select an account type first' using errcode = '42501';
  end if;
  if p_concrete_type <> v_established then
    raise exception 'the account type cannot be changed here' using errcode = '42501';
  end if;
  if p_availability is not null and p_availability not in
     ('within_week', 'within_month', 'flexible') then
    raise exception 'invalid availability' using errcode = '22023';
  end if;

  -- Reused profile columns (private until the upgrade is approved & listed).
  update public.profiles
    set headline  = v_headline,
        bio       = v_bio,
        languages = app.clean_text_array(p_languages, 40)
    where user_id = v_uid;

  insert into public.individual_onboarding as io (
    user_id, prof_concrete_type, prof_years_experience, prof_specialization,
    prof_services, prof_additional_services, prof_availability, prof_service_areas,
    prof_offers_remote, prof_governorate, prof_city, prof_max_travel_km
  ) values (
    v_uid,
    p_concrete_type,
    p_years_experience,
    nullif(left(btrim(coalesce(p_specialization, '')), 80), ''),
    app.clean_text_array(p_services, 60),
    app.clean_text_array(p_additional_services, 60),
    p_availability,
    app.clean_text_array(p_service_areas, 80),
    coalesce(p_offers_remote, false),
    nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    p_max_travel_km
  )
  on conflict (user_id) do update set
    prof_concrete_type       = excluded.prof_concrete_type,
    prof_years_experience    = excluded.prof_years_experience,
    prof_specialization      = excluded.prof_specialization,
    prof_services            = excluded.prof_services,
    prof_additional_services = excluded.prof_additional_services,
    prof_availability        = excluded.prof_availability,
    prof_service_areas       = excluded.prof_service_areas,
    prof_offers_remote       = excluded.prof_offers_remote,
    prof_governorate         = excluded.prof_governorate,
    prof_city                = excluded.prof_city,
    prof_max_travel_km       = excluded.prof_max_travel_km;
end;
$function$;
