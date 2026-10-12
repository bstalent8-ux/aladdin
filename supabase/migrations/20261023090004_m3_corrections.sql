-- ===========================================================================
-- M3 corrections (owner review).
--
--  1. An UNVERIFIED branch is completely private. showroom_branches - the only public branch
--     listing - now returns ONLY branches whose public identity an Admin has approved, and only the
--     approved snapshot name. No hidden-address card, no "unverified" row. Existing branches have no
--     snapshot, so they are private until reviewed.
--  2. The hard-coded 100-branches-per-organization limit is removed. It was an arbitrary guard
--     introduced in M3 with no business approval and no technical justification; branch limits are
--     a commercial/package decision (deferred). Abuse control stays technical: authority, uniqueness
--     of the name inside an organization, the per-organization advisory lock and field lengths.
--  3. A public verification can be REVOKED by a platform administrator (history kept; the branch
--     immediately leaves every public listing).
--  4. Verified co-ownership makes a person eligible to APPLY from ANY approved organization type
--     (previously only Showroom / Supplier / Manufacturer / Importer). It grants no persona, no
--     audience and does not lift any registration restriction: the contractor_company guard
--     (may_hold_contractor_company), the Coming Soon registration gate and the one-open-application
--     rule are untouched and the new organization is still reviewed on its own.
--  5. review_context(): one read-only RPC giving a platform reviewer everything needed to decide
--     an identity amendment, a co-owner claim or a branch verification (who, what changed, the
--     evidence and the history). Backend contract only - no Admin UI change.
-- ===========================================================================

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
  'branch.reactivated',
  'branch.verification_revoked'
));

-- 1. public branch listing ---------------------------------------------------------------------
drop function public.showroom_branches(uuid);
create function public.showroom_branches(p_org_id uuid)
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_verified_caller();
  return query
    select b.id, coalesce(nullif(b.public_identity ->> 'name', ''), b.name)
    from public.branches b
    join public.organizations o on o.id = b.organization_id
    where b.organization_id = p_org_id
      and b.public_identity is not null          -- approved public snapshot only
      and b.is_active and b.deleted_at is null
      and o.deleted_at is null
      and o.status = 'active'
      and o.org_type = 'showroom_dealer'
    order by b.created_at;
end;
$$;
revoke all on function public.showroom_branches(uuid) from public, anon;
grant execute on function public.showroom_branches(uuid) to authenticated;

-- 2. no arbitrary branch count limit -------------------------------------------------------------
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

-- 3. revoke a public verification ---------------------------------------------------------------
create or replace function public.branch_verification_revoke(p_branch_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_b      public.branches;
begin
  if not app.is_platform('administrator'::public.platform_role) then
    raise exception 'platform administrator authority required' using errcode = '42501';
  end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required' using errcode = '22023';
  end if;
  select * into v_b from public.branches where id = p_branch_id for update;
  if not found or v_b.public_identity is null then return; end if;
  update public.branches set public_identity = null, verified_at = null, verified_by = null where id = p_branch_id;
  perform app.record_audit_event('branch.verification_revoked', 'branch', p_branch_id, v_b.organization_id,
    jsonb_build_object('reason', v_reason, 'previous', v_b.public_identity));
end;
$$;
revoke all on function public.branch_verification_revoke(uuid, text) from public, anon;
grant execute on function public.branch_verification_revoke(uuid, text) to authenticated;

-- 4. co-owner eligibility across approved organization types --------------------------------------
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
          -- OWNERSHIP of any APPROVED organization (founder, or an Admin-verified co-owner), whatever its type.
          -- The type of organization that may then be requested is still governed by the draft RPCs
          -- (e.g. a contractor organization needs the Contractor persona).
          or exists (
            select 1
            from app.owned_org_ids(p_uid) owned (id)
            join public.organizations o on o.id = owned.id
            where o.status = 'active'::public.org_status
          )
        )
      )
    ),
    false
  );
$$;
revoke all on function app.can_create_or_complete_business(uuid) from public, anon, authenticated, service_role;

-- 5. reviewer evidence ----------------------------------------------------------------------------
create or replace function public.review_context(p_verification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v        public.verifications;
  v_org    public.organizations;
  v_cand   uuid;
  v_branch public.branches;
  v_out    jsonb;
begin
  if not app.is_platform('support'::public.platform_role) then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v from public.verifications where id = p_verification_id;
  if not found then
    raise exception 'verification not found' using errcode = '22023';
  end if;

  v_out := jsonb_build_object(
    'id', v.id, 'type', v.verification_type, 'status', v.status, 'reason', v.reason,
    'submitted_at', v.submitted_at, 'decided_at', v.decided_at, 'reviewer_id', v.reviewer_id,
    'metadata', v.metadata);

  if v.organization_id is not null then
    select * into v_org from public.organizations where id = v.organization_id;
    v_out := v_out || jsonb_build_object('organization', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'name_ar', v_org.name_ar, 'name_en', v_org.name_en,
      'slug', v_org.slug, 'org_type', v_org.org_type, 'status', v_org.status, 'is_verified', v_org.is_verified,
      'created_by', v_org.created_by));
  end if;

  v_cand := coalesce(nullif(v.metadata ->> 'candidate_user_id', '')::uuid, v.user_id,
                     nullif(v.metadata ->> 'requested_by', '')::uuid);
  if v_cand is not null then
    v_out := v_out || jsonb_build_object('person', (
      select jsonb_build_object('id', u.id, 'email', a.email,
                                'display_name', a.raw_user_meta_data ->> 'display_name',
                                'persona', u.primary_account_type,
                                'is_member', exists (select 1 from public.memberships m
                                   where m.user_id = u.id and m.organization_id = v.organization_id and m.status = 'active'))
        from public.users u join auth.users a on a.id = u.id where u.id = v_cand));
  end if;

  if v.verification_type = 'branch_location' then
    select * into v_branch from public.branches where id = nullif(v.metadata ->> 'branch_id', '')::uuid;
    if found then
      v_out := v_out || jsonb_build_object('branch', jsonb_build_object(
        'id', v_branch.id, 'name', v_branch.name, 'is_active', v_branch.is_active,
        'current', app.branch_public_fields(v_branch), 'approved_public', v_branch.public_identity));
    end if;
  end if;

  v_out := v_out || jsonb_build_object('history', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'reason', h.reason,
                                        'submitted_at', h.submitted_at, 'decided_at', h.decided_at)
                     order by h.submitted_at desc)
      from public.verifications h
     where h.id <> v.id and h.verification_type = v.verification_type
       and h.organization_id is not distinct from v.organization_id
       and h.user_id is not distinct from v.user_id
       and (v.verification_type <> 'branch_location' or h.metadata ->> 'branch_id' = v.metadata ->> 'branch_id')
       and (v.verification_type <> 'co_owner' or h.metadata ->> 'candidate_user_id' = v.metadata ->> 'candidate_user_id')), '[]'::jsonb));
  return v_out;
end;
$$;
revoke all on function public.review_context(uuid) from public, anon;
grant execute on function public.review_context(uuid) to authenticated;
