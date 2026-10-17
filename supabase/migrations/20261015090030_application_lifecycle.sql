-- ===========================================================================
-- Organization application lifecycle (M1 hardening + decisions)
--
-- 1. SECURITY: an organization's type was UPDATE-able by its own owner (column grant), so an
--    approved Showroom could retype itself to Supplier - or an Engineering Office to Showroom -
--    and take that audience with no review. org_type is now immutable for every client role.
--    (Definer paths and Admin tooling are unaffected.)
-- 2. SECURITY: the contractor_company guard no longer trusts a settable session GUC; it keys on
--    the executing role (a client statement runs as authenticated/anon, a vetted definer path
--    runs as its owner).
-- 3. A REJECTED first application can be abandoned and replaced; the rejected record, reviewer,
--    reason and timestamps are preserved (a separate 'cancelled' row is added; the organization
--    is archived, never deleted).
-- 4. After the first organization is approved, at most ONE additional application may be open
--    (draft / pending review / needs changes) at a time. Enforced in the draft RPCs, the submit
--    RPC and the abandon RPC under the same per-user advisory lock.
-- 5. Contractor Organization / Engineering Office can be chosen at registration (still behind the
--    existing Coming Soon gate for Contractor and Engineer).
-- ===========================================================================

-- 1. org_type is not client-writable --------------------------------------------------------
revoke update (org_type) on public.organizations from authenticated, anon;

-- 2. role-based guard (SECURITY INVOKER so current_user is the executing role) ---------------
create or replace function app.guard_contractor_company_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_type = 'contractor_company'
     and (tg_op = 'INSERT' or old.org_type is distinct from new.org_type)
     and current_user in ('authenticated', 'anon') then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_contractor_company_assignment() from public, anon, authenticated, service_role;

-- audit allow-list
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted',
  'membership.activated',
  'membership.role_changed',
  'membership.suspended',
  'membership.revoked',
  'branch.created',
  'branch.assignment_changed',
  'platform_role.granted',
  'platform_role.revoked',
  'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started',
  'verification.changes_requested',
  'verification.approved',
  'verification.rejected',
  'account.type_changed',
  'profile.listed',
  'profile.hidden',
  'customer.created',
  'customer.updated',
  'lead.created',
  'lead.assigned',
  'lead.reassigned',
  'lead.stage_changed',
  'lead.won',
  'lead.lost',
  'lead.reopened',
  'lead.archived',
  'followup.created',
  'followup.reassigned',
  'followup.completed',
  'followup.reopened',
  'customer.reassigned',
  'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed',
  'onboarding.professional_submitted',
  'onboarding.organization_created',
  'product.created',
  'product.updated',
  'product.published',
  'product.unpublished',
  'rfq.created',
  'rfq.submitted',
  'rfq.updated',
  'rfq.cancelled',
  'rfq.closed',
  'quotation.created',
  'quotation.updated',
  'quotation.submitted',
  'quotation.accepted',
  'quotation.rejected',
  'order.created',
  'order.started',
  'order.completed',
  'order.cancelled',
  'project.created',
  'project.activated',
  'project.completed',
  'organization.verified',
  'affiliation.requested',
  'affiliation.cancelled',
  'affiliation.approved',
  'affiliation.rejected',
  'referral.submitted',
  'referral.approved',
  'referral.rejected',
  'conversation.opened',
  'points.adjusted',
  'points.reversed',
  'job.created',
  'job.updated',
  'job.published',
  'job.closed',
  'job.cancelled',
  'job.application.submitted',
  'job.application.withdrawn',
  'job.application.accepted',
  'job.application.rejected',
  'job.assignment.started',
  'job.assignment.progress_updated',
  'job.assignment.completed',
  'job.assignment.cancelled',
  'job.review.submitted',
  'job.review.suppressed',
  'job.review.restored',
  'network_referral.submitted',
  'network_referral.joined',
  'network_referral.approved',
  'network_referral.rejected',
  'network_referral.cancelled',
  'profile.username_set',
  'profile.phone_set',
  'profile.avatar_set',
  'organization.activities_set',
  'user.activities_set',
  'product.archived',
  'product.restored',
  'product.image_added',
  'product.image_removed',
  'product.image_reordered',
  'offer.created',
  'offer.updated',
  'offer.published',
  'offer.paused',
  'offer.resumed',
  'offer.archived',
  'organization.contact_set',
  'profile.contact_visibility_set',
  'network_candidate.submitted',
  'network_candidate.approved',
  'network_candidate.rejected',
  'network_candidate.cancelled',
  'product.audiences_set',
  'purchase_request.created',
  'purchase_request.updated',
  'purchase_request.published',
  'purchase_request.closed',
  'purchase_request.cancelled',
  'purchase_request.image_added',
  'purchase_request.image_removed',
  'purchase_request_response.submitted',
  'purchase_request_response.withdrawn',
  'purchase_request_response.shortlisted',
  'purchase_request_response.unshortlisted',
  'organization.application_submitted',
  'organization.application_abandoned'
)) not valid;

-- onboarding intent may name a contractor company
alter table public.onboarding_progress drop constraint ck_onboarding_progress_registerable_type;
alter table public.onboarding_progress
  add constraint ck_onboarding_progress_registerable_type check (
    selected_org_type is null or selected_org_type in
      ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office', 'contractor_company'));

-- Who may hold a contractor company: a Contractor persona, or a first-business registrant who
-- chose it (it still needs Admin approval before it carries any audience).
create or replace function app.may_hold_contractor_company(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.effective_persona(p_uid) = 'contractor'
    or exists (select 1 from public.onboarding_progress op
                where op.user_id = p_uid and op.selected_track = 'business'
                  and op.selected_org_type = 'contractor_company'),
    false);
$$;
revoke all on function app.may_hold_contractor_company(uuid) from public, anon, authenticated;

-- entitlement path B accepts the two business operating models of Contractor / Engineer
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
            from public.memberships m
            join public.organizations o on o.id = m.organization_id and o.deleted_at is null
            join public.membership_capabilities c
              on c.membership_id = m.id and c.capability_key = 'org.manage'
            where m.user_id = p_uid
              and m.status = 'active'
              and o.status = 'active'::public.org_status
              and o.org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer')
          )
        )
      )
    ),
    false
  );
$$;
revoke execute on function app.can_create_or_complete_business(uuid) from public, anon, authenticated;

-- registration: Contractor Organization / Engineering Office
CREATE OR REPLACE FUNCTION public.onboarding_select_account_type(p_track onboarding_track, p_account_type text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid       uuid := app.require_verified_caller();
  v_choice    text := nullif(btrim(coalesce(p_account_type, '')), '');
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
  v_key       text;
begin
  if p_track is null then
    raise exception 'an onboarding track is required' using errcode = '22023';
  end if;

  if p_track = 'consumer' then
    if v_choice is not null and v_choice <> 'end_consumer' then
      raise exception 'consumer track takes no professional/business type' using errcode = '22023';
    end if;
  elsif p_track = 'business' then
    if v_choice is not null then
      if not exists (
        select 1 from unnest(array['showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office', 'contractor_company']::public.organization_type[]) e
        where e::text = v_choice
      ) then
        raise exception 'business track requires a business organization type' using errcode = '22023';
      end if;
      v_org_type := v_choice::public.organization_type;
    end if;
  else
    if v_choice is null or v_choice = 'end_consumer' then
      raise exception 'this track requires a concrete account type' using errcode = '22023';
    end if;
    if not exists (
      select 1 from unnest(enum_range(null::public.persona_type)) e
      where e::text = v_choice
    ) then
      raise exception 'professional track requires a personal persona' using errcode = '22023';
    end if;
    v_persona := v_choice::public.persona_type;
  end if;

  -- NEW (Increment 13): COMING SOON IS ENFORCED HERE, not only in the server
  -- actions. A fresh selection of a Coming Soon type is refused; a caller who
  -- ALREADY holds that exact type (a legacy registrant resuming, or an
  -- Admin-applied / declared persona) may re-select it, so no existing account
  -- loses its persona or data. Business organization types are never Coming Soon.
  -- An organization operating model is still the Contractor / Engineer ACCOUNT: while that
  -- account is Coming Soon, so is registering its organization.
  v_key := case
             when p_track = 'consumer' then 'end_consumer'
             when p_track = 'professional' then v_choice
             when p_track = 'business' and v_choice = 'contractor_company' then 'contractor'
             when p_track = 'business' and v_choice = 'design_office' then 'engineer'
           end;
  if v_key = any (app.coming_soon_account_types())
     and not app.holds_account_type(
           v_uid,
           case when p_track = 'business' then 'professional'::public.onboarding_track else p_track end,
           v_key) then
    raise exception 'this account type is not available yet' using errcode = '22023';
  end if;

  insert into public.onboarding_progress (
    user_id, selected_track, selected_persona, selected_org_type,
    account_type_completed_at, completed_at
  ) values (
    v_uid, p_track, v_persona, v_org_type, now(), now()
  )
  on conflict (user_id) do update
    set selected_track            = excluded.selected_track,
        selected_persona          = excluded.selected_persona,
        selected_org_type         = excluded.selected_org_type,
        account_type_completed_at = excluded.account_type_completed_at,
        completed_at              = excluded.completed_at;

  -- NEW (Increment 11): the individual-professional persona becomes the
  -- DECLARED persona — the value every professional authority already reads.
  -- Same five-value allow-list as app.is_professional_persona and
  -- individual_save_professional (trainer/trainee are not individual
  -- professionals). Never touches users.primary_account_type.
  if v_persona in ('engineer', 'installer_technician', 'contractor', 'sales')
     and not exists (
       select 1 from public.users u
       where u.id = v_uid and u.primary_account_type is not null
         and u.primary_account_type <> v_persona) then
    insert into public.individual_onboarding as io (user_id, prof_concrete_type)
    values (v_uid, v_persona)
    on conflict (user_id) do update
      set prof_concrete_type = excluded.prof_concrete_type
      where io.prof_concrete_type is null
         or io.professional_completed_at is null;
  end if;

  perform app.record_audit_event('onboarding.completed', 'user', v_uid, null,
    jsonb_build_object('track', p_track, 'account_type', v_choice));
end;
$function$;

-- 4. The slot ---------------------------------------------------------------------------------
-- An application is OPEN while its organization is still pending and the latest review record is
-- not final-negative (rejected) or closed by the applicant (cancelled).
create or replace function app.org_application_is_open(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select o.status in ('draft', 'pending_verification')
       and coalesce((select v.status::text from public.verifications v
                      where v.subject_type = 'organization' and v.organization_id = o.id
                      order by v.submitted_at desc, v.created_at desc limit 1), 'none')
           not in ('rejected', 'cancelled')
      from public.organizations o
     where o.id = p_org_id and o.deleted_at is null
  ), false);
$$;
revoke all on function app.org_application_is_open(uuid) from public, anon, authenticated;

-- Organizations the caller OWNS that still count (an abandoned/archived one does not).
create or replace function app.owned_org_ids(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
    from public.memberships m
    join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
    join public.organizations o on o.id = m.organization_id and o.deleted_at is null
   where m.user_id = p_uid and m.status = 'active' and o.status <> 'archived'::public.org_status;
$$;
revoke all on function app.owned_org_ids(uuid) from public, anon, authenticated;

-- 'first_available' | 'first_pending' | 'first_rejected' | 'additional_available' | 'additional_pending'
create or replace function app.application_slot(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from app.owned_org_ids(p_uid)) then 'first_available'
    when not exists (select 1 from public.organizations o
                      where o.id in (select app.owned_org_ids(p_uid)) and o.status = 'active')
      then case when exists (select 1 from app.owned_org_ids(p_uid) i where app.org_application_is_open(i))
                then 'first_pending' else 'first_rejected' end
    when exists (select 1 from app.owned_org_ids(p_uid) i where app.org_application_is_open(i))
      then 'additional_pending'
    else 'additional_available'
  end;
$$;
revoke all on function app.application_slot(uuid) from public, anon, authenticated;

create or replace function app.may_apply_for_organization(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uid is not null
     and app.application_slot(p_uid) in ('first_available', 'additional_available');
$$;
revoke all on function app.may_apply_for_organization(uuid) from public, anon, authenticated;

-- create_owned: no GUC; contractor_company needs the Contractor intent
create or replace function app.organization_create_owned(
  p_name        text,
  p_org_type    public.organization_type,
  p_locale      text,
  p_branch_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := btrim(coalesce(p_name, ''));
  v_locale text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
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
  if p_org_type is null then
    raise exception 'a business organization type is required' using errcode = '22023';
  end if;
  if p_org_type = 'contractor_company' and not app.may_hold_contractor_company(v_uid) then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;

  -- ALWAYS pending_verification / unverified: provisional and non-operational
  -- (see app.org_is_approved) until an Admin approves the application.
  insert into public.organizations (name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  insert into public.branches (organization_id, name)
  values (v_org_id, coalesce(v_branch, v_name))
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
revoke execute on function app.organization_create_owned(text, public.organization_type, text, text) from public;
grant execute on function app.organization_create_owned(text, public.organization_type, text, text) to service_role;

-- draft save: contractor_company intent, slot (new draft only)
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
$$;

-- 3/4. Submit: a rejected application is final; serialised with the slot ----------------------
create or replace function public.organization_application_submit(p_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_org  public.organizations;
  v_open public.verifications;
  v_last text;
  v_id   uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));

  select * into v_org from public.organizations
   where id = p_org_id and deleted_at is null for update;
  if not found or not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  if v_org.status = 'active' then
    raise exception 'this organization is already approved' using errcode = '22023';
  end if;
  if v_org.status <> 'pending_verification' then
    raise exception 'this organization cannot be submitted for review' using errcode = '22023';
  end if;

  select v.status::text into v_last from public.verifications v
   where v.subject_type = 'organization' and v.organization_id = p_org_id
   order by v.submitted_at desc, v.created_at desc limit 1;
  if v_last in ('rejected', 'cancelled') then
    raise exception 'this application is closed; start a new application'
      using errcode = '22023', hint = 'application_closed';
  end if;

  -- never two open applications for one applicant
  if exists (select 1 from app.owned_org_ids(v_uid) i
              where i <> p_org_id and app.org_application_is_open(i)) then
    raise exception 'another organization application is already open'
      using errcode = '42501', hint = 'additional_pending';
  end if;

  select * into v_open from public.verifications v
   where v.subject_type = 'organization' and v.organization_id = p_org_id
     and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
   for update;

  if found then
    if v_open.status in ('submitted', 'under_review') then
      return v_open.id;
    end if;
    update public.verifications
       set status = 'submitted', submitted_at = now(), decided_at = null
     where id = v_open.id
    returning id into v_id;
  else
    insert into public.verifications
      (subject_type, organization_id, verification_type, status, submitted_at)
    values ('organization', p_org_id, 'organization', 'submitted', now())
    returning id into v_id;
  end if;

  perform app.record_audit_event('organization.application_submitted', 'verification', v_id, p_org_id,
    jsonb_build_object('submitted_by', v_uid, 'org_type', v_org.org_type));
  return v_id;
end;
$$;
revoke execute on function public.organization_application_submit(uuid) from public, anon;
grant execute on function public.organization_application_submit(uuid) to authenticated;

-- Abandon: close a draft / needs-changes / rejected application. History is preserved; the
-- organization is archived (never deleted) and stops counting toward the slot.
create or replace function public.organization_application_abandon(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_org  public.organizations;
  v_last public.verifications;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));

  select * into v_org from public.organizations
   where id = p_org_id and deleted_at is null for update;
  if not found or not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  if v_org.status = 'archived' then return; end if;              -- idempotent
  if v_org.status <> 'pending_verification' then
    raise exception 'only an application that is not approved can be abandoned' using errcode = '22023';
  end if;

  select * into v_last from public.verifications v
   where v.subject_type = 'organization' and v.organization_id = p_org_id
   order by v.submitted_at desc, v.created_at desc limit 1 for update;

  if found and v_last.status in ('submitted', 'under_review') then
    raise exception 'an application awaiting a decision cannot be abandoned'
      using errcode = '22023', hint = 'awaiting_decision';
  end if;

  if found and v_last.status in ('draft', 'needs_more_info') then
    update public.verifications set status = 'cancelled', decided_at = now() where id = v_last.id;
  else
    -- rejected (kept untouched) or never submitted: add a closing record beside it
    insert into public.verifications
      (subject_type, organization_id, verification_type, status, submitted_at, decided_at, metadata)
    values ('organization', p_org_id, 'organization', 'cancelled', clock_timestamp(), clock_timestamp(),
            jsonb_build_object('abandoned_by', v_uid));
  end if;

  update public.organizations set status = 'archived'::public.org_status where id = p_org_id;
  perform app.record_audit_event('organization.application_abandoned', 'organization', p_org_id, p_org_id,
    jsonb_build_object('abandoned_by', v_uid, 'org_type', v_org.org_type));
end;
$$;
revoke execute on function public.organization_application_abandon(uuid) from public, anon;
grant execute on function public.organization_application_abandon(uuid) to authenticated;

-- Owner-facing list
drop function public.my_organization_applications();
create function public.my_organization_applications()
returns table (
  organization_id    uuid,
  name               text,
  org_type           public.organization_type,
  application_status text,
  reason             text,
  submitted_at       timestamptz,
  decided_at         timestamptz,
  can_submit         boolean,
  can_abandon        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.org_type,
         case
           when o.status = 'active' then 'approved'
           when o.status = 'archived' then (case when v.status = 'cancelled' then 'abandoned' else 'closed' end)
           when v.id is null then 'draft'
           when v.status in ('submitted', 'under_review', 'approved') then 'pending_review'
           when v.status = 'needs_more_info' then 'needs_changes'
           when v.status = 'rejected' then 'rejected'
           else 'draft'
         end,
         case when o.status = 'active' then null else coalesce(rj.reason, v.reason) end,
         coalesce(rj.submitted_at, v.submitted_at), coalesce(rj.decided_at, v.decided_at),
         (o.status = 'pending_verification' and (v.id is null or v.status in ('draft', 'needs_more_info'))),
         (o.status = 'pending_verification' and (v.id is null or v.status in ('draft', 'needs_more_info', 'rejected')))
    from public.organizations o
    join public.memberships m on m.organization_id = o.id and m.user_id = (select auth.uid())
                             and m.status = 'active'
    join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
    left join lateral (
      select v2.* from public.verifications v2
       where v2.subject_type = 'organization' and v2.organization_id = o.id
       order by v2.submitted_at desc, v2.created_at desc limit 1
    ) v on true
    -- an abandoned application keeps showing the rejection it was closed after
    left join lateral (
      select v3.* from public.verifications v3
       where v3.subject_type = 'organization' and v3.organization_id = o.id and v3.status = 'rejected'
       order by v3.decided_at desc nulls last limit 1
    ) rj on (v.status = 'cancelled')
   where o.deleted_at is null
   order by o.created_at;
$$;
revoke execute on function public.my_organization_applications() from public, anon;
grant execute on function public.my_organization_applications() to authenticated;

-- Why (or whether) the caller can start another application
create or replace function public.my_organization_application_slot()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then 'not_entitled'
    when app.application_slot((select auth.uid())) in ('first_available', 'additional_available')
         and app.can_create_or_complete_business((select auth.uid())) is not true then 'not_entitled'
    else app.application_slot((select auth.uid()))
  end;
$$;
revoke execute on function public.my_organization_application_slot() from public, anon;
grant execute on function public.my_organization_application_slot() to authenticated;

-- An abandoned organization is not a workspace
drop function public.my_workspaces();
create function public.my_workspaces()
returns table (
  kind            text,
  organization_id uuid,
  name            text,
  persona         public.persona_type,
  org_type        public.organization_type,
  relationship    text,
  is_approved     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'personal'::text, null::uuid, coalesce(p.display_name, ''), u.primary_account_type,
         null::public.organization_type, null::text, true
  from public.users u
  left join public.profiles p on p.user_id = u.id and p.deleted_at is null
  where u.id = (select auth.uid())
    and app.has_personal_persona(u.id)
  union all
  select 'business'::text, o.id, o.name, null::public.persona_type, o.org_type,
         case
           when exists (select 1 from public.membership_capabilities c
                         where c.membership_id = m.id and c.capability_key = 'org.manage') then 'owner'
           when exists (select 1 from public.membership_capabilities c
                         where c.membership_id = m.id and c.capability_key = 'org.members.manage') then 'manager'
           else 'member'
         end,
         (o.status = 'active'::public.org_status)
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.deleted_at is null
    and o.status <> 'archived'::public.org_status
  order by 1 desc, 3;
$$;
comment on function public.my_workspaces() is 'The caller''s derived work contexts: Personal plus every non-abandoned organization with an ACTIVE membership. `is_approved` is false for an organization still under review: listed so its owner can track it, but not an operational workspace. Convenience projection only; selecting a workspace is NOT an authorization decision.';
revoke execute on function public.my_workspaces() from public, anon;
grant execute on function public.my_workspaces() to authenticated, service_role;
