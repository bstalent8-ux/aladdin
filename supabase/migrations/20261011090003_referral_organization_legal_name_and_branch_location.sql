-- Referral approval materialises organizations too: they need a legal name and a canonical branch location.
--
-- WHY THIS EXISTS
-- Two admin-approved paths create a REAL organization (and its primary branch) without going through
-- app.organization_create_owned, because their semantics are intentionally different (no Owner membership; the referring
-- Salesperson becomes a Sales member, or the installer gets Points; referral provenance is write-once):
--   * public.showroom_referral_approve   (a Salesperson's referred showroom)
--   * public.network_referral_approve    (an Installer's referred showroom)
-- After migration 20261011090002 added organizations.legal_name, both could still create an organization with
-- legal_name = NULL, which breaks the product invariant: EVERY NEW business organization materialised in Aladdin carries a
-- legal / registered name. This migration closes that, keeps the referral architecture, and persists the referral's location on
-- the created PRIMARY BRANCH in the same canonical / custom representation as business creation.
--
-- BEHAVIOUR
--   * LINKING to an existing organization (explicit link, or the exact-name match): UNCHANGED. Nothing is required of the
--     Admin and nothing is written to the existing organization.
--   * CREATING a new organization: the Admin must EXPLICITLY CONFIRM the legal name. p_legal_name is REQUIRED (2..120 characters,
--     trimmed) and there is NO fallback: a legal name the referrer typed on the referral row is user-submitted information, so
--     the Admin form may PREFILL it, but only the Admin's explicit argument promotes it into organizations.legal_name. An
--     omitted / blank / invalid p_legal_name raises 22023 BEFORE anything is written, even when the referral row has a legal name.
--   * Branch location: the referral's governorate / city are normalised with the single business-location rule
--     (app.normalize_business_location) and stored as branches.governorate_key / city_key / city_custom_name. A referral city is
--     NEVER dropped: a canonical city of the governorate -> city_key; any other valid non-empty text -> city_custom_name; the
--     literal Other / أخرى is never stored (it names no city, so the governorate alone remains); a city that is a canonical city of a
--     DIFFERENT governorate, an unrecognised governorate, or a city with no governorate is refused (22023, "enter the branch
--     location") until the Admin corrects it. Governorate-only is kept only when the referral genuinely supplied no city. The
--     Admin may override with p_governorate / p_city / p_city_custom_name (strict: invalid values are refused).
--   * Everything else is carried over verbatim: provenance, Sales (never Owner) membership, join-request bookkeeping, Points
--     (100, only on creation), idempotency of a repeated approval.
--
-- SIGNATURES. Both functions gain trailing parameters, all defaulted, and the old signatures are dropped (an overload would make
-- named-argument calls ambiguous). Existing callers (named p_referral_id / p_link_organization_id) are unchanged. Grants are
-- re-stated exactly as before (authenticated only; the Admin permission check is inside).

-- ---------------------------------------------------------------------------
-- 1. The branch location of a referral: lossless, never silently reclassified
-- ---------------------------------------------------------------------------
create or replace function app.referral_branch_location(
  p_governorate text,
  p_city        text,
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
  v_gov   text := nullif(btrim(coalesce(p_governorate, '')), '');
  v_city  text := nullif(btrim(coalesce(p_city, '')), '');
  v_other text[] := array['other', 'other city', 'أخرى', 'اخرى', 'اخري', 'مدينة أخرى', 'مدينة اخرى'];
  v       record;
  v_g     record;
begin
  if v_gov is null then
    if v_city is not null then
      raise exception 'the referral names a city but no governorate: enter the branch location' using errcode = '22023';
    end if;
    return;   -- the referral supplied no location at all
  end if;

  o_governorate := app.resolve_governorate(replace(v_gov, '_', '-'));
  if o_governorate is null then
    raise exception 'the referral governorate is not recognised: enter the branch location' using errcode = '22023';
  end if;
  if v_city is null then
    return;   -- governorate-only, because NO city was supplied
  end if;
  if app.normalize_place(v_city) = any (select app.normalize_place(x) from unnest(v_other) x) then
    return;   -- "Other" names no city; it is never stored
  end if;

  -- A canonical city of THIS governorate (including the values the old wizards stored).
  begin
    select * into v from app.normalize_business_location(o_governorate, v_city, null, true);
    o_city := v.o_city;
    o_custom := v.o_custom;
    return;
  exception when sqlstate '22023' then
    null;
  end;

  -- A canonical city of ANOTHER governorate is not a "custom" city: the referral is inconsistent; the Admin must correct it.
  for v_g in select g.key from app.place_governorates g where g.key <> o_governorate loop
    if coalesce(app.resolve_city(v_g.key, replace(v_city, '_', '-')), 'other') <> 'other' then
      raise exception 'the referral city belongs to another governorate: enter the branch location' using errcode = '22023';
    end if;
  end loop;

  -- Any other valid text is the person's own city, kept as typed.
  begin
    select * into v from app.normalize_business_location(o_governorate, null, v_city, true);
    o_city := v.o_city;
    o_custom := v.o_custom;
  exception when sqlstate '22023' then
    raise exception 'the referral city is not a valid city name: enter the branch location' using errcode = '22023';
  end;
end;
$$;
comment on function app.referral_branch_location(text, text) is
  'Branch location for a referral: canonical city, else the typed city, never dropped; Other is never stored; a city of another governorate, an unknown governorate or a city without governorate is refused (22023) until the Admin corrects it. Internal.';
revoke execute on function app.referral_branch_location(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. showroom_referral_approve
-- ---------------------------------------------------------------------------
drop function public.showroom_referral_approve(uuid, uuid);

create function public.showroom_referral_approve(
  p_referral_id          uuid,
  p_link_organization_id uuid default null,
  p_legal_name           text default null,
  p_governorate          text default null,
  p_city                 text default null,
  p_city_custom_name     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_f      public.organization_referrals;
  v_org_id uuid;
  v_bid    uuid;
  v_locale text;
  v_linked boolean := false;
  v_rid    uuid;
  v_mid    uuid;
  v_points_user uuid;
  v_legal  text;
  v_gov    text;
  v_city   text;
  v_custom text;
begin
  if not app.has_admin_permission('referrals.approve') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  select * into v_f from public.organization_referrals f
  where f.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;

  -- IDEMPOTENT, and the structural reason approval cannot duplicate a business:
  -- the referral already names its organization, so it is returned unchanged.
  if v_f.status = 'approved' then
    return v_f.organization_id;
  end if;
  if v_f.status <> 'submitted' then
    raise exception 'only a submitted referral can be approved (status=%)', v_f.status
      using errcode = '22023';
  end if;

  -- ---- Resolve the organization: prefer LINKING over creating. ----
  if p_link_organization_id is not null then
    -- The Admin decided this candidate IS an existing business.
    select o.id into v_org_id from public.organizations o
    where o.id = p_link_organization_id and o.deleted_at is null
      and o.org_type = v_f.org_type
    for update;
    if v_org_id is null then
      raise exception 'the organization to link is not an existing % ', v_f.org_type
        using errcode = '22023';
    end if;
    v_linked := true;
  else
    -- No explicit link: an EXACT (case/space-insensitive) name match of the same
    -- classification is treated as the same business rather than a second copy of
    -- it. Anything fuzzier is a judgement call and stays with the Admin, who is
    -- shown the shortlist by admin_showroom_referrals_list.
    select o.id into v_org_id from public.organizations o
    where o.deleted_at is null
      and o.org_type = v_f.org_type
      and lower(btrim(o.name)) = lower(btrim(v_f.display_name))
    order by o.created_at
    limit 1
    for update;
    v_linked := v_org_id is not null;
  end if;

  if v_org_id is null then
    -- ---- A NEW organization: the Admin-confirmed legal name is required BEFORE anything is written. ----
    -- The Admin must EXPLICITLY CONFIRM the legal name. v_f.legal_name (typed by the referrer) is only a prefill hint in the
    -- Admin form; it is never a fallback here.
    v_legal := nullif(btrim(coalesce(p_legal_name, '')), '');
    if v_legal is null then
      raise exception 'a legal business name is required to create the organization from a referral'
        using errcode = '22023';
    end if;
    if char_length(v_legal) < 2 or char_length(v_legal) > 120 then
      raise exception 'the legal business name must be 2..120 characters' using errcode = '22023';
    end if;

    -- The branch location: the Admin's explicit value (strict) or the referral's own (tolerant).
    if nullif(btrim(coalesce(p_governorate, '')), '') is not null then
      select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
      from app.normalize_business_location(p_governorate, p_city, p_city_custom_name, true);
    else
      select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
      from app.referral_branch_location(v_f.governorate, v_f.city);
    end if;

    -- ---- Materialise the business, WITHOUT an owner. ----
    select u.locale into v_locale from public.users u where u.id = v_f.referred_by;
    insert into public.organizations
      (name, legal_name, org_type, status, is_verified, primary_locale, created_by,
       source, referred_by_user_id)
    values (btrim(v_f.display_name), v_legal, v_f.org_type, 'pending_verification', false,
            case when v_locale in ('en', 'ar') then v_locale else 'en' end, v_actor,
            'salesperson_referral', v_f.referred_by)
    returning id into v_org_id;

    insert into public.branches (organization_id, name, governorate_key, city_key, city_custom_name)
    values (v_org_id, coalesce(nullif(btrim(coalesce(v_f.primary_branch_name, '')), ''),
                               btrim(v_f.display_name)),
            v_gov, v_city, v_custom)
    returning id into v_bid;

    perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
      jsonb_build_object('org_type', v_f.org_type, 'status', 'pending_verification',
                         'source', 'salesperson_referral',
                         'referred_by', v_f.referred_by, 'referral_id', v_f.id));
    perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
      jsonb_build_object('primary', true));
  else
    select b.id into v_bid from public.branches b
    where b.organization_id = v_org_id and b.is_active
    order by b.created_at
    limit 1;
  end if;

  -- ---- The salesperson's relationship: SALES MEMBER. Never Owner. ----
  -- Recorded as an approved join request too, so an affiliation looks the same
  -- whichever path produced it and the salesperson's home needs one read model.
  insert into public.organization_join_requests
    (user_id, organization_id, requested_branch_id, status, decided_by, decided_at, note)
  values (v_f.referred_by, v_org_id, v_bid, 'pending', null, null,
          'Referred this showroom to Aladdin')
  on conflict do nothing
  returning id into v_rid;

  if v_rid is null then
    select r.id into v_rid from public.organization_join_requests r
    where r.user_id = v_f.referred_by and r.organization_id = v_org_id
    order by r.created_at desc
    limit 1;
  end if;

  v_mid := app.membership_grant_sales(v_org_id, v_f.referred_by, v_bid);

  update public.organization_join_requests
     set status = 'approved', membership_id = v_mid,
         decided_by = v_actor, decided_at = now()
   where id = v_rid and status <> 'approved';

  update public.organization_referrals
     set status = 'approved', organization_id = v_org_id, join_request_id = v_rid,
         reviewed_by = v_actor, reviewed_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('referral.approved', 'organization_referral',
    p_referral_id, v_org_id,
    jsonb_build_object('organization_id', v_org_id,
                       'resolution', case when v_linked then 'linked_existing' else 'created' end,
                       'referred_by', v_f.referred_by,
                       'membership_id', v_mid,
                       'relationship', 'sales_member'));

  -- ---- Points: the one approved earning event (D1 = 100, 2026-08-30). ----
  -- The recipient is read back from the CANONICAL, WRITE-ONCE provenance on the
  -- organization itself, never from the referral request and never from a
  -- parameter. app.organizations_provenance_immutable() makes that column
  -- unreassignable, which is precisely why Sprint 13 created it: "a reward paid
  -- on a mutable field is a reward paid to whoever wrote last."
  --
  -- This deliberately awards NOTHING on the LINKING path. An organization that
  -- already existed was not brought to Aladdin by this referral, so it carries
  -- no salesperson_referral provenance and there is no attributed recipient to
  -- credit. Crediting the referral request instead would pay a salesperson for
  -- "referring" a business that was already here.
  select o.referred_by_user_id into v_points_user
  from public.organizations o
  where o.id = v_org_id
    and o.source = 'salesperson_referral'
    and o.referred_by_user_id is not null;

  if v_points_user is not null then
    -- Same transaction as the approval: both commit or neither does. A duplicate
    -- canonical identity (user, event, 'organization', org id) is collapsed to a
    -- no-op by ux_points_ledger_event_identity, so a retry cannot pay twice.
    -- The amount is a literal on purpose: D1 approved 100 Points for the Pilot,
    -- and a configurable reward is a reward whoever can write the config decides.
    perform app.award_points(
      p_user_id         => v_points_user,
      p_organization_id => v_org_id,
      p_event_type      => 'referral.organization_approved',
      p_source_type     => 'organization',
      p_source_id       => v_org_id,
      p_points_delta    => 100
    );
  end if;

  return v_org_id;
end;
$$;

revoke execute on function public.showroom_referral_approve(uuid, uuid, text, text, text, text) from public, anon;
grant  execute on function public.showroom_referral_approve(uuid, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. network_referral_approve (an Installer's referred showroom): the same invariant
-- ---------------------------------------------------------------------------
drop function public.network_referral_approve(uuid, uuid);

create function public.network_referral_approve(
  p_referral_id          uuid,
  p_link_organization_id uuid default null,
  p_legal_name           text default null,
  p_governorate          text default null,
  p_city                 text default null,
  p_city_custom_name     text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_r           public.network_referrals;
  v_org_id      uuid;
  v_bid         uuid;
  v_locale      text;
  v_points_user uuid;
  v_legal       text;
  v_gov         text;
  v_city        text;
  v_custom      text;
begin
  if not app.has_admin_permission('referrals.approve') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;

  select * into v_r from public.network_referrals r
  where r.id = p_referral_id
  for update;
  if not found then
    raise exception 'referral not found' using errcode = '22023';
  end if;

  -- IDEMPOTENT: an already-joined referral returns its organization,
  -- structurally unable to duplicate a business or double-award (the
  -- organization_id is already set and Points already resolved).
  if v_r.status = 'joined' then
    return v_r.organization_id;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'only a pending referral can be approved (status=%)', v_r.status
      using errcode = '22023';
  end if;

  if p_link_organization_id is not null then
    select o.id into v_org_id from public.organizations o
    where o.id = p_link_organization_id and o.deleted_at is null
    for update;
    if v_org_id is null then
      raise exception 'the organization to link does not exist' using errcode = '22023';
    end if;
  else
    -- A NEW organization: the legal name is required BEFORE anything is written (a network referral carries none).
    v_legal := nullif(btrim(coalesce(p_legal_name, '')), '');
    if v_legal is null then
      raise exception 'a legal business name is required to create the organization from a referral'
        using errcode = '22023';
    end if;
    if char_length(v_legal) < 2 or char_length(v_legal) > 120 then
      raise exception 'the legal business name must be 2..120 characters' using errcode = '22023';
    end if;

    if nullif(btrim(coalesce(p_governorate, '')), '') is not null then
      select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
      from app.normalize_business_location(p_governorate, p_city, p_city_custom_name, true);
    else
      select o_governorate, o_city, o_custom into v_gov, v_city, v_custom
      from app.referral_branch_location(v_r.governorate, v_r.city);
    end if;

    select u.locale into v_locale from public.users u where u.id = v_r.referred_by;
    insert into public.organizations
      (name, legal_name, org_type, status, is_verified, primary_locale, created_by,
       source, referred_by_user_id)
    values (btrim(v_r.display_name), v_legal, 'showroom_dealer', 'pending_verification', false,
            case when v_locale in ('en', 'ar') then v_locale else 'en' end, v_actor,
            'installer_referral', v_r.referred_by)
    returning id into v_org_id;

    insert into public.branches (organization_id, name, governorate_key, city_key, city_custom_name)
    values (v_org_id, btrim(v_r.display_name), v_gov, v_city, v_custom)
    returning id into v_bid;

    perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
      jsonb_build_object('org_type', 'showroom_dealer', 'status', 'pending_verification',
                         'source', 'installer_referral',
                         'referred_by', v_r.referred_by, 'referral_id', v_r.id));
    perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
      jsonb_build_object('primary', true));
  end if;

  update public.network_referrals
     set status = 'joined', organization_id = v_org_id,
         decided_by = v_actor, decided_at = now()
   where id = p_referral_id;

  perform app.record_audit_event('network_referral.approved', 'network_referral',
    p_referral_id, v_org_id,
    jsonb_build_object('organization_id', v_org_id,
                       'resolution', case when p_link_organization_id is not null
                                          then 'linked_existing' else 'created' end,
                       'referred_by', v_r.referred_by));

  -- ---- Points: the ONE approved earning event, exactly the Sales-referral
  -- precedent. Awarded ONLY when a genuinely new organization was created —
  -- never on the linking path — and read back from the organization's own
  -- write-once provenance, never from this request.
  select o.referred_by_user_id into v_points_user
  from public.organizations o
  where o.id = v_org_id
    and o.source = 'installer_referral'
    and o.referred_by_user_id is not null;

  if v_points_user is not null then
    perform app.award_points(
      p_user_id         => v_points_user,
      p_organization_id => v_org_id,
      p_event_type      => 'referral.organization_approved',
      p_source_type     => 'organization',
      p_source_id       => v_org_id,
      p_points_delta    => 100
    );
  end if;

  return v_org_id;
end;
$$;

revoke execute on function public.network_referral_approve(uuid, uuid, text, text, text, text) from public, anon;
grant  execute on function public.network_referral_approve(uuid, uuid, text, text, text, text) to authenticated;
