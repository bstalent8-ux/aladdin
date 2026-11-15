-- Admin-initiated verification, no completion requirement on Admin approval, and a derived "Needs attention" view.
-- Forward-only and corrective: 20261115090001 is already applied to Acceptance and is not edited.
--
-- POLICY
--   * An authorized Admin may initiate, approve or reject a professional USER or an ORGANIZATION verification without a
--     user-submitted request, REGARDLESS of profile-completion percentage.
--   * 100% profile completion stays the requirement ONLY for the automatic, user-submitted Craftsman request
--     (public.craftsman_profile_verification_submit, unchanged). It is NOT a condition of Admin approval, including for
--     the 20 existing Production Craftsman requests.
--
-- 1. public.admin_initiate_verification(subject_type, subject_id, reason): files ONE ordinary 'submitted' row in the existing
--    verifications table (same state machine, Admin Verifications queue, review_start / review_approve / review_reject,
--    apply step), marked metadata {"initiated_by_admin": true}. Nothing is decided here.
--      * Authority is the existing RBAC: users.verify for a user; organizations.verify AND the Administrator tier for an
--        organization (exactly what review_start already demands for organizations).
--      * A reason of 5..500 characters is required. It is written ONLY to the audit log (action verification.admin_initiated,
--        with the actor), never to the verification row, so the applicant cannot read it.
--      * It does not touch identity, ownership, e-mail or phone verification: an approval still runs the unchanged apply
--        step, and the existing showroom "complete business information" check still applies to a showroom approval.
--      * Refused for the caller's own account or organization, an inactive or non-professional account, an account that already
--        holds an approved professional verification, and an organization that is not awaiting approval or has no active owner.
--        An open request is never duplicated: it is returned ('already_open').
--
-- 2. The Craftsman completion guard added by 20261115090001 (trigger craftsman_review_complete + app.craftsman_review_guard)
--    is REMOVED. Nothing else depended on it.
--
-- 3. public.admin_users_directory gains a DERIVED 'attention' status filter and count: a VERIFIED account whose authoritative
--    profile completion (app.profile_completion, the same function every page uses) is below 100. Nothing is stored: the
--    warning appears when completion is below 100 (including right after an Admin approves such a profile) and clears
--    on its own when completion returns to 100. Verification is NEVER revoked by this; the Verified state and the account
--    status are unchanged. The per-row 'completion' value it already returns is the percentage shown on the warning.

select app.audit_actions_add(array['verification.admin_initiated']);

drop trigger if exists craftsman_review_complete on public.verifications;
drop function if exists app.craftsman_review_guard();

create or replace function public.admin_initiate_verification(p_subject_type text, p_subject_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_persona public.persona_type;
  v_org     public.organizations;
  v_open    uuid;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_subject_type is null or p_subject_type not in ('user', 'organization') or p_subject_id is null then
    raise exception 'a user or organization subject is required' using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'a reason of 5 to 500 characters is required' using errcode = '22023';
  end if;

  if p_subject_type = 'user' then
    if not app.has_admin_permission('users.verify') then
      raise exception 'platform reviewer authority required' using errcode = '42501';
    end if;
    if p_subject_id = v_uid then
      raise exception 'a reviewer may not initiate verification for their own account' using errcode = '42501';
    end if;
    if not exists (select 1 from public.users u where u.id = p_subject_id) then
      raise exception 'verification subject not found' using errcode = '22023';
    end if;
    if not app.account_is_active(p_subject_id) then
      raise exception 'the account is not active' using errcode = '22023';
    end if;
    v_persona := app.effective_persona(p_subject_id);
    if v_persona is null or v_persona not in ('engineer', 'installer_technician', 'contractor', 'sales') then
      raise exception 'only a professional account can be verified' using errcode = '22023';
    end if;
    if exists (select 1 from public.verifications v
                where v.subject_type = 'user' and v.user_id = p_subject_id and v.verification_type = 'professional'
                  and v.requested_account_type = v_persona and v.status = 'approved') then
      raise exception 'this account already holds an approved professional verification' using errcode = '22023';
    end if;
    select v.id into v_open from public.verifications v
     where v.subject_type = 'user' and v.user_id = p_subject_id and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     limit 1;
    if v_open is not null then
      return jsonb_build_object('state', 'already_open', 'verification_id', v_open);
    end if;
    insert into public.verifications
      (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, metadata)
    values ('user', p_subject_id, 'professional', v_persona, 'submitted', now(), jsonb_build_object('initiated_by_admin', true))
    on conflict do nothing
    returning id into v_id;
  else
    if not app.has_admin_permission('organizations.verify') or not app.is_platform('administrator') then
      raise exception 'platform reviewer authority required' using errcode = '42501';
    end if;
    if app.is_org_member(p_subject_id) then
      raise exception 'a reviewer may not initiate verification for their own organization' using errcode = '42501';
    end if;
    select * into v_org from public.organizations o where o.id = p_subject_id and o.deleted_at is null;
    if not found then
      raise exception 'verification subject not found' using errcode = '22023';
    end if;
    if v_org.status not in ('draft', 'pending_verification') then
      raise exception 'the organization is not awaiting approval' using errcode = '22023';
    end if;
    if not exists (select 1 from public.memberships m
                     join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
                    where m.organization_id = p_subject_id and m.status = 'active') then
      raise exception 'the organization has no active owner' using errcode = '22023';
    end if;
    select v.id into v_open from public.verifications v
     where v.subject_type = 'organization' and v.organization_id = p_subject_id and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     limit 1;
    if v_open is not null then
      return jsonb_build_object('state', 'already_open', 'verification_id', v_open);
    end if;
    insert into public.verifications
      (subject_type, organization_id, verification_type, status, submitted_at, metadata)
    values ('organization', p_subject_id, 'organization', 'submitted', now(), jsonb_build_object('initiated_by_admin', true))
    on conflict do nothing
    returning id into v_id;
  end if;

  if v_id is null then
    -- Lost a race with another open request (the open-request unique index): report it, file nothing.
    select v.id into v_id from public.verifications v
     where ((p_subject_type = 'user' and v.subject_type = 'user' and v.user_id = p_subject_id)
         or (p_subject_type = 'organization' and v.subject_type = 'organization' and v.organization_id = p_subject_id))
       and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     order by v.submitted_at desc nulls last limit 1;
    return jsonb_build_object('state', 'already_open', 'verification_id', v_id);
  end if;

  perform app.record_audit_event('verification.admin_initiated', 'verification', v_id,
    case when p_subject_type = 'organization' then p_subject_id else null end,
    jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id, 'reason', v_reason));
  return jsonb_build_object('state', 'initiated', 'verification_id', v_id);
end;
$$;

revoke all on function public.admin_initiate_verification(text, uuid, text) from public, anon, service_role;
grant execute on function public.admin_initiate_verification(text, uuid, text) to authenticated;
comment on function public.admin_initiate_verification(text, uuid, text) is 'Admin only (users.verify; organizations.verify + Administrator tier for organizations). Files ONE ordinary submitted verification request, marked initiated_by_admin, for a user or organization whose owner has not submitted one. The required reason goes to the audit log only. Never decides, never touches identity / ownership / phone verification; the existing review and apply steps decide.';

CREATE OR REPLACE FUNCTION public.admin_users_directory(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_account_type text DEFAULT NULL::text, p_verification text DEFAULT NULL::text, p_governorate text DEFAULT NULL::text, p_sort text DEFAULT 'registered:desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
  v_digits text;
  v_phone  text;
  v_local  text;
  v_field  text := split_part(coalesce(p_sort, ''), ':', 1);
  v_dir    text := split_part(coalesce(p_sort, ''), ':', 2);
  v_result jsonb;
begin
  perform app.admin_require('users.read');
  perform app.admin_require_page_args(p_page, p_page_size);
  if p_sort not in ('registered:desc', 'registered:asc', 'completeness:desc', 'completeness:asc') then
    raise exception 'unsupported sort %', p_sort using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended', 'rejected', 'attention') then
    raise exception 'unsupported status filter' using errcode = '22023';
  end if;
  if p_account_type is not null and p_account_type not in (
       'showroom_dealer', 'supplier', 'manufacturer', 'importer', 'contractor', 'engineer',
       'installer_technician', 'sales', 'end_consumer', 'none') then
    raise exception 'unsupported account type filter' using errcode = '22023';
  end if;
  if p_verification is not null and p_verification not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'unsupported verification filter' using errcode = '22023';
  end if;
  if v_q is not null then
    if char_length(v_q) > 100 then
      raise exception 'search term too long' using errcode = '22023';
    end if;
    v_like := app.admin_search_pattern(v_q);
    -- Phone: fold Arabic-Indic / Persian digits to ASCII, then match the
    -- canonical E.164 column by digit substring or by the database's own
    -- normalization (app.normalize_phone) of the whole term.
    v_digits := regexp_replace(translate(v_q, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
    if char_length(v_digits) >= 3 then
      v_phone := app.normalize_phone(v_digits);
      -- A local number is typed with its trunk 0 (010...), which E.164 drops (+2010...): a partial local
      -- number must match on the digits after that 0.
      if v_digits like '0%' and char_length(v_digits) >= 4 then
        v_local := substr(v_digits, 2);
      end if;
    else
      v_digits := null;
    end if;
  end if;

  with base as materialized (
    select u.id, u.created_at,
           app.admin_user_verification_state(u.is_verified, lv.status) as vstate,
           app.admin_user_status_tab(u.status, lv.status) as tab,
           -- DERIVED, never stored: a verified account whose AUTHORITATIVE profile completion is below 100.
           -- Completion is only evaluated for verified accounts (CASE is lazy).
           case when app.admin_user_verification_state(u.is_verified, lv.status) = 'verified'
                then coalesce((app.profile_completion(u.id) ->> 'percent')::int, 100) < 100
                else false end as attention
    from public.users u
    left join public.profiles p on p.user_id = u.id
    left join public.individual_onboarding io on io.user_id = u.id
    left join lateral (
      select v.status from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'
      order by v.submitted_at desc, v.id desc
      limit 1
    ) lv on true
    where (p_account_type is null or coalesce(app.user_account_type(u.id), 'none') = p_account_type)
      and (p_governorate is null or coalesce(io.prof_governorate, io.consumer_governorate) = p_governorate)
      and (
        v_q is null
        or p.display_name ilike v_like escape '\'
        or p.display_name_ar ilike v_like escape '\'
        or p.display_name_en ilike v_like escape '\'
        or u.id in (
          select au.id from auth.users au
          where app.user_facing_email(au.email) ilike v_like escape '\')
        or (v_digits is not null and (p.phone_e164 like '%' || v_digits || '%' or p.phone_e164 = v_phone
                                    or (v_local is not null and p.phone_e164 like '%' || v_local || '%')))
      )
  ),
  scoped as materialized (
    select * from base where p_verification is null or vstate = p_verification
  ),
  filtered as materialized (
    select * from scoped
     where p_status is null
        or (p_status = 'attention' and attention)
        or (p_status <> 'attention' and tab = p_status)
  ),
  total as (
    select count(*)::int as n from filtered
  ),
  paging as (
    select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::int)) as page from total t
  ),
  -- Completion is computed only when it is the sort key (CASE is lazy), and
  -- users.id is the final key, so equal dates/percentages never reorder
  -- between pages.
  ranked as (
    select f.id, row_number() over (order by
        case when v_field = 'registered' and v_dir = 'desc' then f.created_at end desc nulls last,
        case when v_field = 'registered' and v_dir = 'asc'  then f.created_at end asc  nulls last,
        case when v_field = 'completeness' and v_dir = 'desc' then (app.profile_completion(f.id) ->> 'percent')::int end desc nulls last,
        case when v_field = 'completeness' and v_dir = 'asc'  then (app.profile_completion(f.id) ->> 'percent')::int end asc  nulls last,
        f.id) as ord
    from filtered f
  ),
  page_ids as (
    select r.id, r.ord from ranked r
    where r.ord > ((select page from paging) - 1) * p_page_size
      and r.ord <= (select page from paging) * p_page_size
  ),
  page_rows as (
    select pi.ord, jsonb_build_object(
      'id', u.id,
      'display_name', coalesce(p.display_name, ''),
      'display_name_ar', p.display_name_ar,
      'display_name_en', p.display_name_en,
      'email', app.user_facing_email(au.email),
      'phone', p.phone_e164,
      'account_type', app.user_account_type(u.id), 'registered_account', app.registered_account(u.id),
      'status', u.status,
      'is_verified', u.is_verified,
      'created_at', u.created_at,
      'verification_state', app.admin_user_verification_state(u.is_verified, lv.status),
      'latest_verification_status', lv.status,
      'governorate', coalesce(io.prof_governorate, io.consumer_governorate),
      'city', coalesce(io.prof_city, io.consumer_city),
      'completion', (app.profile_completion(u.id) ->> 'percent')::int,
      'organization', case when org.id is null then null
                           else jsonb_build_object('id', org.id, 'name', org.name, 'name_ar', org.name_ar, 'name_en', org.name_en) end,
      'organization_count', coalesce(org.cnt, 0),
      'profile_id', p.id,
      'public_profile_available', p.id is not null
        and exists (select 1 from public.profile_public_directory d where d.id = p.id),
      'flags', case when lv.status = 'rejected' then '["verification_issue"]'::jsonb else '[]'::jsonb end
    ) as row
    from page_ids pi
    join public.users u on u.id = pi.id
    left join public.profiles p on p.user_id = u.id
    left join auth.users au on au.id = u.id
    left join public.individual_onboarding io on io.user_id = u.id
    left join lateral (
      select v.status from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'
      order by v.submitted_at desc, v.id desc
      limit 1
    ) lv on true
    left join lateral (
      select o.id, o.name, o.name_ar, o.name_en, count(*) over () as cnt
      from public.memberships m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = u.id and m.status = 'active'
      order by m.created_at, m.id
      limit 1
    ) org on true
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(pr.row order by pr.ord) from page_rows pr), '[]'::jsonb),
    'total', (select n from total),
    'page', (select page from paging),
    'page_size', p_page_size,
    'sort', p_sort,
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'pending', count(*) filter (where tab = 'pending'),
        'verified', count(*) filter (where tab = 'verified'),
        'suspended', count(*) filter (where tab = 'suspended'),
        'rejected', count(*) filter (where tab = 'rejected'),
        'attention', count(*) filter (where attention))
      from scoped)
  ) into v_result;

  return v_result;
end;
$function$;
