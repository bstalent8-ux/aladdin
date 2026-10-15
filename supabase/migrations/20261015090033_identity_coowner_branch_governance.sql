-- ===========================================================================
-- M3: organization identity changes, verified co-owners and branch governance.
--
-- ONE review system. All three decisions are `verifications` rows (subject 'organization'), so
-- they appear in the existing Admin queue and are decided with the existing review_start /
-- review_request_changes / review_reject / review_approve RPCs. The effect of an approval is
-- applied in the same transaction by the existing AFTER UPDATE trigger (app._apply_org_approval),
-- which now dispatches on verification_type. No new Admin page is required.
--
--   A. organization_identity - a VERIFIED organization's name / Arabic name / English name / slug
--      can no longer be changed by its own members. They file a request; the approved values stay
--      public until an Admin approves. The proposal lives only in the immutable review record, so
--      identity is never duplicated into a second table. org_type is NOT part of this workflow.
--   B. co_owner - a member asks to be recognised as a verified co-owner/partner. Only an Admin
--      approval creates the trusted record (public.org_co_owners); a member can never mark
--      themselves. Eligibility to open an additional organization application comes only from
--      (1) having created and still managing an organization, or (2) an ACTIVE verified co-owner
--      record on an approved organization. A bare membership, an org.manage capability, a role
--      label or an invitation proves nothing.
--   C. branch_location - a branch is internal the moment it is created under an approved
--      organization; it is shown publicly as a VERIFIED location only from an approved snapshot.
--      Later edits to the public fields never reach the public view until a new review is approved.
-- ===========================================================================

-- 0. audit allow-list ---------------------------------------------------------------------------
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
  'organization.application_abandoned',
  'organization.identity_change_requested',
  'organization.identity_change_withdrawn',
  'organization.identity_changed',
  'organization.co_owner_requested',
  'organization.co_owner_verified',
  'organization.co_owner_revoked',
  'branch.verification_requested',
  'branch.verified',
  'branch.deactivated',
  'branch.reactivated'
));

-- 1. verification constraints -------------------------------------------------------------------
alter table public.verifications drop constraint ck_verifications_type_matches_subject;
alter table public.verifications add constraint ck_verifications_type_matches_subject check (
     ((verification_type = 'professional' and subject_type = 'user' and user_id is not null
        and requested_account_type is not null))
  or ((verification_type = 'identity' and subject_type = 'user' and user_id is not null
        and requested_account_type is null))
  or ((verification_type = 'organization' and subject_type = 'organization' and organization_id is not null
        and requested_account_type is null))
  or ((verification_type = 'professional' and subject_type = 'user' and user_id is not null
        and requested_account_type is null and metadata ? 'legacy_requested_business_type'))
  or ((verification_type in ('organization_identity', 'co_owner', 'branch_location')
        and subject_type = 'organization' and organization_id is not null
        and requested_account_type is null))
);

-- the "one open application per organization" rule belongs to the APPLICATION only
drop index public.uq_verifications_open_per_org;
create unique index uq_verifications_open_per_org on public.verifications (organization_id)
  where subject_type = 'organization' and verification_type = 'organization'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');

create unique index uq_verifications_open_identity_change on public.verifications (organization_id)
  where verification_type = 'organization_identity'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');
create unique index uq_verifications_open_co_owner on public.verifications (organization_id, ((metadata ->> 'candidate_user_id')))
  where verification_type = 'co_owner'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');
create unique index uq_verifications_open_branch on public.verifications (((metadata ->> 'branch_id')))
  where verification_type = 'branch_location'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');

-- 2. the application functions only ever look at the application record --------------------------
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
                      where v.subject_type = 'organization' and v.verification_type = 'organization'
                        and v.organization_id = o.id
                      order by v.submitted_at desc, v.created_at desc limit 1), 'none')
           not in ('rejected', 'cancelled')
      from public.organizations o
     where o.id = p_org_id and o.deleted_at is null
  ), false);
$$;
revoke all on function app.org_application_is_open(uuid) from public, anon, authenticated, service_role;

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
   where v.subject_type = 'organization' and v.verification_type = 'organization' and v.organization_id = p_org_id
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
   where v.subject_type = 'organization' and v.verification_type = 'organization' and v.organization_id = p_org_id
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
revoke all on function public.organization_application_submit(uuid) from public, anon;
grant execute on function public.organization_application_submit(uuid) to authenticated;

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
   where v.subject_type = 'organization' and v.verification_type = 'organization' and v.organization_id = p_org_id
   order by v.submitted_at desc, v.created_at desc limit 1 for update;

  if found and v_last.status in ('submitted', 'under_review') then
    raise exception 'an application awaiting a decision cannot be abandoned'
      using errcode = '22023', hint = 'awaiting_decision';
  end if;

  if found and v_last.status in ('draft', 'needs_more_info') then
    update public.verifications set status = 'cancelled', decided_at = now() where id = v_last.id;
  else
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
revoke all on function public.organization_application_abandon(uuid) from public, anon;
grant execute on function public.organization_application_abandon(uuid) to authenticated;

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
       where v2.subject_type = 'organization' and v2.verification_type = 'organization'
         and v2.organization_id = o.id
       order by v2.submitted_at desc, v2.created_at desc limit 1
    ) v on true
    -- an abandoned application keeps showing the rejection it was closed after
    left join lateral (
      select v3.* from public.verifications v3
       where v3.subject_type = 'organization' and v3.verification_type = 'organization'
         and v3.organization_id = o.id and v3.status = 'rejected'
       order by v3.decided_at desc nulls last limit 1
    ) rj on (v.status = 'cancelled')
   where o.deleted_at is null
   order by o.created_at;
$$;
revoke all on function public.my_organization_applications() from public, anon;
grant execute on function public.my_organization_applications() to authenticated;

-- Check-then-act safety: every governance writer takes a SHARE lock on the organization row and on
-- the caller's own active membership BEFORE it checks authority. A concurrent suspension of the
-- organization, or revocation of the caller's membership, must wait for the writer to finish (or
-- is seen by it), so a write can never be committed on authority that was withdrawn mid-flight.
create or replace function app._lock_org_actor(p_org_id uuid, p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.organizations o where o.id = p_org_id for share;
  perform 1 from public.memberships m
   where m.organization_id = p_org_id and m.user_id = p_uid and m.status = 'active' for share;
end;
$$;
revoke all on function app._lock_org_actor(uuid, uuid) from public, anon, authenticated, service_role;

-- 3. A. organization identity --------------------------------------------------------------------
create or replace function app.org_identity_locked(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select o.is_verified or o.status = 'active'::public.org_status
                     from public.organizations o where o.id = p_org_id and o.deleted_at is null), false);
$$;
revoke all on function app.org_identity_locked(uuid) from public, anon, authenticated, service_role;

-- A client statement runs as authenticated/anon and is refused; a vetted definer path (the approval
-- trigger, Admin tooling) runs as its owner. Keyed on the executing role, never on a setting.
create or replace function app.guard_organization_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.name_ar is distinct from old.name_ar
      or new.name_en is distinct from old.name_en)
     and (old.is_verified or old.status = 'active'::public.org_status)
     and current_user in ('authenticated', 'anon') then
    raise exception 'a verified organization identity changes only through Admin review'
      using errcode = '42501', hint = 'identity_change_requires_review';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_organization_identity() from public, anon, authenticated, service_role;

create trigger organizations_identity_guard
  before update of name, slug, name_ar, name_en on public.organizations
  for each row execute function app.guard_organization_identity();

-- The ordinary profile writer keeps working for everything that is NOT verified identity.
create or replace function public.organization_update_i18n(
  p_org_id uuid, p_name_ar text, p_name_en text, p_timezone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name_ar  text := nullif(trim(p_name_ar), '');
  v_name_en  text := nullif(trim(p_name_en), '');
  v_timezone text := nullif(trim(p_timezone), '');
  v_org      public.organizations;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;

  select * into v_org from public.organizations where id = p_org_id and deleted_at is null for update;
  if not found then
    raise exception 'organization not found' using errcode = '22023';
  end if;

  if (v_org.is_verified or v_org.status = 'active')
     and (v_name_ar is distinct from v_org.name_ar or v_name_en is distinct from v_org.name_en) then
    raise exception 'a verified organization name changes only through an identity change request'
      using errcode = '22023', hint = 'identity_change_requires_review';
  end if;

  update public.organizations
     set name_ar = v_name_ar,
         name_en = v_name_en,
         timezone = v_timezone
   where id = p_org_id;
end;
$$;
revoke all on function public.organization_update_i18n(uuid, text, text, text) from public, anon;
grant execute on function public.organization_update_i18n(uuid, text, text, text) to authenticated;

-- Request a change. NULL = leave unchanged; '' = clear (Arabic / English name only).
create or replace function public.organization_identity_change_request(
  p_org_id  uuid,
  p_name    text default null,
  p_name_ar text default null,
  p_name_en text default null,
  p_slug    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := app.require_verified_caller();
  v_org      public.organizations;
  v_open     public.verifications;
  v_proposed jsonb := '{}'::jsonb;
  v_previous jsonb := '{}'::jsonb;
  v_val      text;
  v_id       uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('org-identity:' || p_org_id::text, 0));

  perform app._lock_org_actor(p_org_id, v_uid);
  select * into v_org from public.organizations where id = p_org_id and deleted_at is null for update;
  if not found or not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  if not (v_org.is_verified or v_org.status = 'active') then
    raise exception 'an organization that is not approved edits its identity through its application'
      using errcode = '22023', hint = 'not_verified';
  end if;
  if v_org.status <> 'active' then
    raise exception 'only an active organization can request an identity change'
      using errcode = '22023', hint = 'not_active';
  end if;

  if p_name is not null then
    v_val := btrim(p_name);
    if char_length(v_val) < 2 or char_length(v_val) > 120 then
      raise exception 'organization name must be 2..120 characters' using errcode = '22023', hint = 'invalid_name';
    end if;
    if v_val is distinct from v_org.name then
      v_proposed := v_proposed || jsonb_build_object('name', v_val);
      v_previous := v_previous || jsonb_build_object('name', v_org.name);
    end if;
  end if;
  if p_name_ar is not null then
    v_val := nullif(btrim(p_name_ar), '');
    if v_val is not null and char_length(v_val) > 120 then
      raise exception 'Arabic name must be at most 120 characters' using errcode = '22023', hint = 'invalid_name';
    end if;
    if v_val is distinct from v_org.name_ar then
      v_proposed := v_proposed || jsonb_build_object('name_ar', v_val);
      v_previous := v_previous || jsonb_build_object('name_ar', v_org.name_ar);
    end if;
  end if;
  if p_name_en is not null then
    v_val := nullif(btrim(p_name_en), '');
    if v_val is not null and char_length(v_val) > 120 then
      raise exception 'English name must be at most 120 characters' using errcode = '22023', hint = 'invalid_name';
    end if;
    if v_val is distinct from v_org.name_en then
      v_proposed := v_proposed || jsonb_build_object('name_en', v_val);
      v_previous := v_previous || jsonb_build_object('name_en', v_org.name_en);
    end if;
  end if;
  if p_slug is not null then
    v_val := lower(btrim(p_slug));
    if v_val !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_val) > 80 then
      raise exception 'invalid public address' using errcode = '22023', hint = 'invalid_slug';
    end if;
    if v_val is distinct from v_org.slug then
      if exists (select 1 from public.organizations o where o.slug = v_val and o.id <> p_org_id) then
        raise exception 'that public address is already taken' using errcode = '23505', hint = 'slug_taken';
      end if;
      v_proposed := v_proposed || jsonb_build_object('slug', v_val);
      v_previous := v_previous || jsonb_build_object('slug', v_org.slug);
    end if;
  end if;

  if v_proposed = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023', hint = 'no_changes';
  end if;

  select * into v_open from public.verifications v
   where v.verification_type = 'organization_identity' and v.organization_id = p_org_id
     and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
   for update;
  if found then
    if v_open.status in ('submitted', 'under_review') then
      raise exception 'an identity change is already awaiting a decision'
        using errcode = '22023', hint = 'change_pending';
    end if;
    -- needs changes: the new request supersedes it (the old record and its reason are kept)
    update public.verifications set status = 'cancelled', decided_at = now() where id = v_open.id;
  end if;

  insert into public.verifications (subject_type, organization_id, verification_type, status, submitted_at, metadata)
  values ('organization', p_org_id, 'organization_identity', 'submitted', clock_timestamp(),
          jsonb_build_object('previous', v_previous, 'proposed', v_proposed, 'requested_by', v_uid))
  returning id into v_id;

  perform app.record_audit_event('organization.identity_change_requested', 'verification', v_id, p_org_id,
    jsonb_build_object('requested_by', v_uid, 'previous', v_previous, 'proposed', v_proposed));
  return v_id;
end;
$$;
revoke all on function public.organization_identity_change_request(uuid, text, text, text, text) from public, anon;
grant execute on function public.organization_identity_change_request(uuid, text, text, text, text) to authenticated;

create or replace function public.organization_identity_change_withdraw(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_open public.verifications;
begin
  perform pg_advisory_xact_lock(hashtextextended('org-identity:' || p_org_id::text, 0));
  if p_org_id is null or not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  select * into v_open from public.verifications v
   where v.verification_type = 'organization_identity' and v.organization_id = p_org_id
     and v.status in ('submitted', 'under_review', 'needs_more_info')
   for update;
  if not found then return; end if;
  if v_open.status = 'under_review' then
    raise exception 'a change under review cannot be withdrawn' using errcode = '22023', hint = 'awaiting_decision';
  end if;
  update public.verifications set status = 'cancelled', decided_at = now() where id = v_open.id;
  perform app.record_audit_event('organization.identity_change_withdrawn', 'verification', v_open.id, p_org_id,
    jsonb_build_object('withdrawn_by', v_uid));
end;
$$;
revoke all on function public.organization_identity_change_withdraw(uuid) from public, anon;
grant execute on function public.organization_identity_change_withdraw(uuid) to authenticated;

create or replace function public.organization_identity_state(p_org_id uuid)
returns table (
  locked         boolean,
  name           text,
  name_ar        text,
  name_en        text,
  slug           text,
  request_id     uuid,
  request_status text,
  proposed       jsonb,
  reason         text,
  requested_at   timestamptz,
  decided_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_identity_locked(o.id), o.name, o.name_ar, o.name_en, o.slug,
         r.id,
         case r.status::text
           when 'submitted' then 'pending_review' when 'under_review' then 'pending_review'
           when 'needs_more_info' then 'needs_changes' when 'rejected' then 'rejected' end,
         r.metadata -> 'proposed', r.reason, r.submitted_at, r.decided_at
    from public.organizations o
    left join lateral (
      select v.* from public.verifications v
       where v.verification_type = 'organization_identity' and v.organization_id = o.id
         and v.status in ('submitted', 'under_review', 'needs_more_info', 'rejected')
       order by v.submitted_at desc, v.created_at desc limit 1
    ) r on true
   where o.id = p_org_id and o.deleted_at is null and app.is_org_member(o.id);
$$;
revoke all on function public.organization_identity_state(uuid) from public, anon;
grant execute on function public.organization_identity_state(uuid) to authenticated;

-- 4. B. verified co-owners ------------------------------------------------------------------------
create table public.org_co_owners (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  verification_id uuid not null unique references public.verifications (id),
  status          text not null default 'active' check (status in ('active', 'revoked')),
  verified_by     uuid references public.users (id) on delete set null,
  verified_at     timestamptz not null default now(),
  revoked_by      uuid references public.users (id) on delete set null,
  revoked_at      timestamptz,
  revoked_reason  text check (revoked_reason is null or char_length(revoked_reason) between 1 and 2000),
  created_at      timestamptz not null default now(),
  constraint ck_org_co_owners_revocation check ((status = 'revoked') = (revoked_at is not null))
);
create unique index uq_org_co_owners_active on public.org_co_owners (organization_id, user_id) where status = 'active';
create index ix_org_co_owners_user on public.org_co_owners (user_id);

alter table public.org_co_owners enable row level security;
-- a person sees their own record; platform staff see all. Nobody writes through the API.
create policy org_co_owners_select_self on public.org_co_owners for select to authenticated
  using (user_id = (select auth.uid()));
create policy org_co_owners_select_platform on public.org_co_owners for select to authenticated
  using (app.is_platform('support'::public.platform_role));
revoke all on public.org_co_owners from public, anon, authenticated;
grant select on public.org_co_owners to authenticated;

create or replace function app.is_verified_co_owner(p_uid uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.org_co_owners c
      join public.organizations o on o.id = c.organization_id and o.deleted_at is null and o.status = 'active'
      join public.memberships m on m.organization_id = c.organization_id and m.user_id = c.user_id
                               and m.status = 'active'
     where c.user_id = p_uid and c.organization_id = p_org_id and c.status = 'active');
$$;
revoke all on function app.is_verified_co_owner(uuid, uuid) from public, anon, authenticated, service_role;

-- A request is only a claim. Any ACTIVE member of an APPROVED organization may file one; nothing
-- changes for them until an Admin approves it.
create or replace function public.org_co_owner_request(p_org_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_org  public.organizations;
  v_open public.verifications;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note must be at most 500 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('org-co-owner:' || p_org_id::text || ':' || v_uid::text, 0));
  perform app._lock_org_actor(p_org_id, v_uid);

  select * into v_org from public.organizations where id = p_org_id and deleted_at is null;
  if not found or not app.is_org_member(p_org_id) then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  if v_org.status <> 'active' then
    raise exception 'only an approved organization can verify a co-owner' using errcode = '22023', hint = 'org_not_approved';
  end if;
  if v_org.created_by = v_uid then
    raise exception 'the organization founder is already its primary owner' using errcode = '22023', hint = 'already_primary_owner';
  end if;
  if exists (select 1 from public.org_co_owners c
              where c.organization_id = p_org_id and c.user_id = v_uid and c.status = 'active') then
    raise exception 'you are already a verified co-owner' using errcode = '22023', hint = 'already_verified';
  end if;

  select * into v_open from public.verifications v
   where v.verification_type = 'co_owner' and v.organization_id = p_org_id
     and v.metadata ->> 'candidate_user_id' = v_uid::text
     and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
   for update;
  if found then
    if v_open.status in ('submitted', 'under_review') then return v_open.id; end if;
    update public.verifications set status = 'cancelled', decided_at = now() where id = v_open.id;
  end if;

  insert into public.verifications (subject_type, organization_id, verification_type, status, submitted_at, metadata)
  values ('organization', p_org_id, 'co_owner', 'submitted', clock_timestamp(),
          jsonb_build_object('candidate_user_id', v_uid, 'note', v_note))
  returning id into v_id;

  perform app.record_audit_event('organization.co_owner_requested', 'verification', v_id, p_org_id,
    jsonb_build_object('candidate_user_id', v_uid));
  return v_id;
end;
$$;
revoke all on function public.org_co_owner_request(uuid, text) from public, anon;
grant execute on function public.org_co_owner_request(uuid, text) to authenticated;

create or replace function app._apply_co_owner(p_v public.verifications)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate uuid := nullif(p_v.metadata ->> 'candidate_user_id', '')::uuid;
begin
  if v_candidate is null then
    raise exception 'co-owner verification has no candidate' using errcode = '23514';
  end if;
  perform app._lock_org_actor(p_v.organization_id, v_candidate);
  if not exists (select 1 from public.organizations o where o.id = p_v.organization_id and o.status = 'active' and o.deleted_at is null) then
    raise exception 'only an approved organization can verify a co-owner' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships m where m.organization_id = p_v.organization_id
                    and m.user_id = v_candidate and m.status = 'active') then
    raise exception 'the candidate is not an active member of this organization' using errcode = '22023';
  end if;
  insert into public.org_co_owners (organization_id, user_id, verification_id, verified_by)
  values (p_v.organization_id, v_candidate, p_v.id, p_v.reviewer_id)
  on conflict (verification_id) do nothing;
  perform app.record_audit_event('organization.co_owner_verified', 'organization', p_v.organization_id,
    p_v.organization_id, jsonb_build_object('candidate_user_id', v_candidate, 'verification_id', p_v.id,
                                            'reviewer_id', p_v.reviewer_id));
end;
$$;
revoke all on function app._apply_co_owner(public.verifications) from public, anon, authenticated, service_role;

-- Revocation: platform administrators only. The record is kept (status 'revoked'); past applications are untouched.
create or replace function public.org_co_owner_revoke(p_org_id uuid, p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row    public.org_co_owners;
begin
  if not app.is_platform('administrator'::public.platform_role) then
    raise exception 'platform administrator authority required' using errcode = '42501';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required' using errcode = '22023';
  end if;
  select * into v_row from public.org_co_owners c
   where c.organization_id = p_org_id and c.user_id = p_user_id and c.status = 'active' for update;
  if not found then return; end if;
  update public.org_co_owners
     set status = 'revoked', revoked_by = v_uid, revoked_at = now(), revoked_reason = v_reason
   where id = v_row.id;
  perform app.record_audit_event('organization.co_owner_revoked', 'organization', p_org_id, p_org_id,
    jsonb_build_object('user_id', p_user_id, 'reason', v_reason, 'verification_id', v_row.verification_id));
end;
$$;
revoke all on function public.org_co_owner_revoke(uuid, uuid, text) from public, anon;
grant execute on function public.org_co_owner_revoke(uuid, uuid, text) to authenticated;

create or replace function public.my_co_owner_state()
returns table (
  organization_id   uuid,
  name              text,
  relationship      text,
  request_id        uuid,
  request_status    text,
  reason            text,
  can_request       boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name,
         case when o.created_by = (select auth.uid()) then 'primary_owner'
              when app.is_verified_co_owner((select auth.uid()), o.id) then 'verified_co_owner'
              else 'member' end,
         r.id,
         case r.status::text
           when 'submitted' then 'pending_review' when 'under_review' then 'pending_review'
           when 'needs_more_info' then 'needs_changes' when 'rejected' then 'rejected' end,
         r.reason,
         (o.created_by <> (select auth.uid())
            and not app.is_verified_co_owner((select auth.uid()), o.id)
            and coalesce(r.status::text, 'none') not in ('submitted', 'under_review'))
    from public.organizations o
    join public.memberships m on m.organization_id = o.id and m.user_id = (select auth.uid()) and m.status = 'active'
    left join lateral (
      select v.* from public.verifications v
       where v.verification_type = 'co_owner' and v.organization_id = o.id
         and v.metadata ->> 'candidate_user_id' = (select auth.uid())::text
         and v.status in ('submitted', 'under_review', 'needs_more_info', 'rejected')
       order by v.submitted_at desc, v.created_at desc limit 1
    ) r on true
   where o.deleted_at is null and o.status = 'active'
   order by o.created_at;
$$;
revoke all on function public.my_co_owner_state() from public, anon;
grant execute on function public.my_co_owner_state() to authenticated;

-- What counts toward an applicant's own organizations (and so toward the one-open-application
-- slot): organizations they FOUNDED and still manage, plus approved organizations where an Admin
-- has verified them as a co-owner. An org.manage capability alone is not ownership.
create or replace function app.owned_org_ids(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
    from public.organizations o
    join public.memberships m on m.organization_id = o.id and m.user_id = p_uid and m.status = 'active'
   where o.deleted_at is null and o.status <> 'archived'::public.org_status
     and ( (o.created_by = p_uid
            and exists (select 1 from public.membership_capabilities c
                         where c.membership_id = m.id and c.capability_key = 'org.manage'))
        or app.is_verified_co_owner(p_uid, o.id) );
$$;
revoke all on function app.owned_org_ids(uuid) from public, anon, authenticated, service_role;

-- 5. C. branches ---------------------------------------------------------------------------------
alter table public.branches
  add column public_identity jsonb,
  add column verified_at     timestamptz,
  add column verified_by     uuid references public.users (id) on delete set null,
  add constraint ck_branches_public_identity_object
    check (public_identity is null or jsonb_typeof(public_identity) = 'object'),
  add constraint ck_branches_verified_pair check ((public_identity is null) = (verified_at is null));
-- (clients have SELECT only on branches; these columns are written solely by the approval trigger)

create or replace function app.branch_public_fields(p_b public.branches)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('name', p_b.name, 'name_ar', p_b.name_ar, 'name_en', p_b.name_en,
                            'address_ar', p_b.address_ar, 'address_en', p_b.address_en,
                            'locality_id', p_b.locality_id);
$$;
revoke all on function app.branch_public_fields(public.branches) from public, anon, authenticated, service_role;

create or replace function public.branch_create(
  p_org_id      uuid,
  p_name        text,
  p_name_ar     text default null,
  p_name_en     text default null,
  p_address_ar  text default null,
  p_address_en  text default null,
  p_locality_id uuid default null,
  p_timezone    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('org-branches:' || p_org_id::text, 0));
  perform app._lock_org_actor(p_org_id, v_uid);

  if not app.is_org_member(p_org_id) then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  if not (app.has_capability(p_org_id, 'branch.manage') or app.has_capability(p_org_id, 'org.manage')) then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  if not app.org_is_approved(p_org_id) then
    raise exception 'an organization must be approved before it can add branches'
      using errcode = '22023', hint = 'org_not_approved';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'branch name must be 2..120 characters' using errcode = '22023', hint = 'invalid_name';
  end if;
  if (select count(*) from public.branches b where b.organization_id = p_org_id and b.deleted_at is null) >= 100 then
    raise exception 'branch limit reached' using errcode = '22023', hint = 'branch_limit';
  end if;
  if exists (select 1 from public.branches b
              where b.organization_id = p_org_id and b.deleted_at is null and lower(b.name) = lower(v_name)) then
    raise exception 'a branch with this name already exists' using errcode = '23505', hint = 'duplicate_branch_name';
  end if;

  insert into public.branches (organization_id, name, name_ar, name_en, address_ar, address_en, locality_id, timezone)
  values (p_org_id, v_name, nullif(btrim(coalesce(p_name_ar, '')), ''), nullif(btrim(coalesce(p_name_en, '')), ''),
          nullif(btrim(coalesce(p_address_ar, '')), ''), nullif(btrim(coalesce(p_address_en, '')), ''),
          p_locality_id, nullif(btrim(coalesce(p_timezone, '')), ''))
  returning id into v_id;

  perform app.record_audit_event('branch.created', 'branch', v_id, p_org_id,
    jsonb_build_object('created_by', v_uid, 'name', v_name));
  return v_id;
end;
$$;
revoke all on function public.branch_create(uuid, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.branch_create(uuid, text, text, text, text, text, uuid, text) to authenticated;

create or replace function public.branch_set_locality(p_branch_id uuid, p_locality_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_org uuid;
begin
  select organization_id into v_org from public.branches where id = p_branch_id and deleted_at is null;
  if v_org is not null then perform app._lock_org_actor(v_org, v_uid); end if;
  if v_org is null or not app.is_org_member(v_org) then
    raise exception 'branch not found' using errcode = '22023';
  end if;
  if not (app.has_capability(v_org, 'branch.manage') or app.has_capability(v_org, 'org.manage')) then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  update public.branches set locality_id = p_locality_id where id = p_branch_id;
end;
$$;
revoke all on function public.branch_set_locality(uuid, uuid) from public, anon;
grant execute on function public.branch_set_locality(uuid, uuid) to authenticated;

create or replace function public.branch_set_active(p_branch_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_org uuid;
begin
  select organization_id into v_org from public.branches where id = p_branch_id and deleted_at is null;
  if v_org is not null then
    perform pg_advisory_xact_lock(hashtextextended('org-branches:' || v_org::text, 0));
    perform app._lock_org_actor(v_org, v_uid);
    perform 1 from public.branches where id = p_branch_id for update;
  end if;
  if v_org is null or not app.is_org_member(v_org) then
    raise exception 'branch not found' using errcode = '22023';
  end if;
  if not (app.has_capability(v_org, 'branch.manage') or app.has_capability(v_org, 'org.manage')) then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  if p_active is not true and not exists (select 1 from public.branches b
        where b.organization_id = v_org and b.deleted_at is null and b.is_active and b.id <> p_branch_id) then
    raise exception 'an organization keeps at least one active branch' using errcode = '22023', hint = 'last_active_branch';
  end if;
  update public.branches set is_active = coalesce(p_active, true) where id = p_branch_id;
  perform app.record_audit_event(case when p_active then 'branch.reactivated' else 'branch.deactivated' end,
    'branch', p_branch_id, v_org, jsonb_build_object('by', v_uid));
end;
$$;
revoke all on function public.branch_set_active(uuid, boolean) from public, anon;
grant execute on function public.branch_set_active(uuid, boolean) to authenticated;

-- Ask for the branch's CURRENT public fields to be verified (first time, or after an amendment).
create or replace function public.branch_verification_request(p_branch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := app.require_verified_caller();
  v_b        public.branches;
  v_open     public.verifications;
  v_proposed jsonb;
  v_id       uuid;
begin
  select * into v_b from public.branches where id = p_branch_id and deleted_at is null;
  if found then
    perform app._lock_org_actor(v_b.organization_id, v_uid);
    select * into v_b from public.branches where id = p_branch_id and deleted_at is null for update;
  end if;
  if not found or not app.is_org_member(v_b.organization_id) then
    raise exception 'branch not found' using errcode = '22023';
  end if;
  if not (app.has_capability(v_b.organization_id, 'branch.manage') or app.has_capability(v_b.organization_id, 'org.manage')) then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  if not app.org_is_approved(v_b.organization_id) then
    raise exception 'an organization must be approved before its branches can be verified'
      using errcode = '22023', hint = 'org_not_approved';
  end if;
  if not v_b.is_active then
    raise exception 'an inactive branch cannot be verified' using errcode = '22023', hint = 'branch_inactive';
  end if;
  if v_b.address_ar is null and v_b.address_en is null then
    raise exception 'an address is required to verify a location' using errcode = '22023', hint = 'address_required';
  end if;

  v_proposed := app.branch_public_fields(v_b);
  if v_b.public_identity is not null and v_b.public_identity = v_proposed then
    raise exception 'nothing to verify: the public details are already verified'
      using errcode = '22023', hint = 'no_changes';
  end if;

  select * into v_open from public.verifications v
   where v.verification_type = 'branch_location' and v.metadata ->> 'branch_id' = p_branch_id::text
     and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
   for update;
  if found then
    if v_open.status in ('submitted', 'under_review') then
      raise exception 'a verification for this branch is already awaiting a decision'
        using errcode = '22023', hint = 'change_pending';
    end if;
    update public.verifications set status = 'cancelled', decided_at = now() where id = v_open.id;
  end if;

  insert into public.verifications (subject_type, organization_id, verification_type, status, submitted_at, metadata)
  values ('organization', v_b.organization_id, 'branch_location', 'submitted', clock_timestamp(),
          jsonb_build_object('branch_id', p_branch_id, 'proposed', v_proposed,
                             'previous', v_b.public_identity, 'requested_by', v_uid))
  returning id into v_id;

  perform app.record_audit_event('branch.verification_requested', 'verification', v_id, v_b.organization_id,
    jsonb_build_object('branch_id', p_branch_id, 'requested_by', v_uid, 'amendment', v_b.public_identity is not null));
  return v_id;
end;
$$;
revoke all on function public.branch_verification_request(uuid) from public, anon;
grant execute on function public.branch_verification_request(uuid) to authenticated;

create or replace function app._apply_branch_location(p_v public.verifications)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid := nullif(p_v.metadata ->> 'branch_id', '')::uuid;
  v_b      public.branches;
begin
  perform 1 from public.organizations o where o.id = p_v.organization_id for share;
  select * into v_b from public.branches where id = v_branch for update;
  if not found or v_b.organization_id <> p_v.organization_id or v_b.deleted_at is not null then
    raise exception 'branch does not belong to the reviewed organization' using errcode = '23514';
  end if;
  if not app.org_is_approved(p_v.organization_id) then
    raise exception 'only an approved organization can have verified branches' using errcode = '22023';
  end if;
  update public.branches
     set public_identity = p_v.metadata -> 'proposed', verified_at = now(), verified_by = p_v.reviewer_id
   where id = v_branch;
  perform app.record_audit_event('branch.verified', 'branch', v_branch, p_v.organization_id,
    jsonb_build_object('verification_id', p_v.id, 'reviewer_id', p_v.reviewer_id,
                       'previous', v_b.public_identity, 'verified', p_v.metadata -> 'proposed'));
end;
$$;
revoke all on function app._apply_branch_location(public.verifications) from public, anon, authenticated, service_role;

create or replace function public.my_branches(p_org_id uuid)
returns table (
  id                    uuid,
  name                  text,
  name_ar               text,
  name_en               text,
  address_ar            text,
  address_en            text,
  locality_id           uuid,
  timezone              text,
  is_active             boolean,
  location_verified     boolean,
  verified_at           timestamptz,
  review_status         text,
  review_reason         text,
  has_unreviewed_changes boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.name_ar, b.name_en, b.address_ar, b.address_en, b.locality_id, b.timezone, b.is_active,
         b.public_identity is not null, b.verified_at,
         case r.status::text
           when 'submitted' then 'pending_review' when 'under_review' then 'pending_review'
           when 'needs_more_info' then 'needs_changes' when 'rejected' then 'rejected'
           else 'none' end,
         r.reason,
         (b.public_identity is not null and b.public_identity <> app.branch_public_fields(b))
    from public.branches b
    left join lateral (
      select v.* from public.verifications v
       where v.verification_type = 'branch_location' and v.metadata ->> 'branch_id' = b.id::text
         and v.status in ('submitted', 'under_review', 'needs_more_info', 'rejected')
       order by v.submitted_at desc, v.created_at desc limit 1
    ) r on true
   where b.organization_id = p_org_id and b.deleted_at is null
     and app.is_org_member(p_org_id)
     and (app.has_capability(p_org_id, 'branch.manage') or app.has_capability(p_org_id, 'org.manage'))
   order by b.created_at;
$$;
revoke all on function public.my_branches(uuid) from public, anon;
grant execute on function public.my_branches(uuid) to authenticated;

-- The only public view of branches. Approved organizations only; the PUBLIC name is the approved
-- snapshot, and an unverified branch is flagged rather than presented as a verified location.
drop function public.showroom_branches(uuid);
create function public.showroom_branches(p_org_id uuid)
returns table (id uuid, name text, location_verified boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_verified_caller();
  return query
    select b.id,
           case when b.public_identity is not null then coalesce(b.public_identity ->> 'name', b.name) else b.name end,
           b.public_identity is not null
    from public.branches b
    join public.organizations o on o.id = b.organization_id
    where b.organization_id = p_org_id
      and b.is_active and b.deleted_at is null
      and o.deleted_at is null
      and o.status = 'active'
      and o.org_type = 'showroom_dealer'
    order by (b.public_identity is not null) desc, b.created_at;
end;
$$;
revoke all on function public.showroom_branches(uuid) from public, anon;
grant execute on function public.showroom_branches(uuid) to authenticated;

-- 6. approval dispatch ---------------------------------------------------------------------------
create or replace function app._apply_identity_change(p_v public.verifications)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_p   jsonb := p_v.metadata -> 'proposed';
begin
  select * into v_org from public.organizations where id = p_v.organization_id for update;
  if not found or v_org.deleted_at is not null then
    raise exception 'organization not found' using errcode = '23503';
  end if;
  if v_org.status <> 'active' then
    raise exception 'only an active organization can change its verified identity' using errcode = '22023';
  end if;
  -- org_type is deliberately absent: a business type never changes through this workflow
  update public.organizations
     set name    = case when v_p ? 'name'    then v_p ->> 'name'    else name end,
         name_ar = case when v_p ? 'name_ar' then v_p ->> 'name_ar' else name_ar end,
         name_en = case when v_p ? 'name_en' then v_p ->> 'name_en' else name_en end,
         slug    = case when v_p ? 'slug'    then v_p ->> 'slug'    else slug end
   where id = v_org.id;
  perform app.record_audit_event('organization.identity_changed', 'organization', v_org.id, v_org.id,
    jsonb_build_object('verification_id', p_v.id, 'reviewer_id', p_v.reviewer_id,
                       'previous', p_v.metadata -> 'previous', 'proposed', v_p));
end;
$$;
revoke all on function app._apply_identity_change(public.verifications) from public, anon, authenticated, service_role;

create or replace function app._apply_org_approval(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v   public.verifications;
  v_org public.organizations;
begin
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found or v_v.status <> 'approved' or v_v.applied_at is not null then return; end if;
  if v_v.subject_type <> 'organization' or v_v.organization_id is null then return; end if;

  if v_v.verification_type = 'organization_identity' then
    perform app._apply_identity_change(v_v);
  elsif v_v.verification_type = 'co_owner' then
    perform app._apply_co_owner(v_v);
  elsif v_v.verification_type = 'branch_location' then
    perform app._apply_branch_location(v_v);
  elsif v_v.verification_type = 'organization' then
    select * into v_org from public.organizations where id = v_v.organization_id for update;
    if not found then
      raise exception 'verification subject has no organization row' using errcode = '23503';
    end if;
    -- A suspended or archived organization is NOT silently reopened: approval is a
    -- trust decision, not a lifecycle override.
    if not v_org.is_verified or v_org.status in ('draft', 'pending_verification') then
      update public.organizations
         set is_verified = true,
             status = case when status in ('draft', 'pending_verification')
                           then 'active'::public.org_status else status end
       where id = v_org.id;
      perform app.record_audit_event('organization.verified', 'organization', v_org.id, v_org.id,
        jsonb_build_object('from_status', v_org.status, 'was_verified', v_org.is_verified,
                           'verification_id', v_v.id, 'reviewer_id', v_v.reviewer_id));
    end if;
  else
    return;
  end if;
  update public.verifications set applied_at = now() where id = v_v.id;
end;
$$;
revoke all on function app._apply_org_approval(uuid) from public, anon, authenticated, service_role;
