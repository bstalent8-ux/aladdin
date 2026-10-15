-- ===========================================================================
-- Organization governance (Phase 6+7 continuation, M1)
--
-- Separates three things that were previously blurred:
--   A. user identity verification  (email-verified caller; unchanged)
--   B. organization approval       (this migration: an Admin decision per organization)
--   C. independent publisher       (deferred to M4 - not touched here)
--
-- WHAT WAS WRONG
--   * A `pending_verification` organization behaved like an approved one: it resolved
--     a business audience (app.org_product_audience), was listed as a workspace, and
--     passed every seller-side capability gate. Being OWNER of an unreviewed business
--     entitled the caller to the audience of that business type.
--   * Nothing let the owner SUBMIT the organization for Admin review (the Admin console
--     could review a `verifications` row, but no self-service path created one).
--   * Approval was two steps (review_approve, then apply_organization_verification), so
--     an approved organization could be left pending if the second step never ran.
--   * Nothing stopped a user from opening business after business before any was approved.
--
-- WHAT THIS DOES (reusing the existing review system - no second one is introduced)
--   1. app.org_is_approved(org): the single "is this business operational" predicate.
--      An organization is operational ONLY when organizations.status = 'active'. The
--      only writers of that value are the Admin approval path and seed/admin tooling;
--      a client cannot set it (column-scoped grants).
--   2. A pending organization is NON-OPERATIONAL:
--        - resolves NO product audience, offer audience or request audience;
--        - cannot publish a product/offer, create an RFQ, respond to a request or
--          decide a quotation (can_publish_catalog / can_create_rfq / can_respond_rfq /
--          can_decide_quote are all approval-gated);
--        - its published products/offers are not visible to anyone else.
--      The owner can still sign in, complete the profile, submit the application,
--      upload application documents and track the review.
--   3. The Organization Application IS a `verifications` row (subject 'organization').
--      organization_application_submit() creates / resubmits it; one OPEN application
--      per organization is a unique index. my_organization_applications() reports the
--      owner-facing status (draft / pending_review / needs_changes / rejected / approved).
--   4. Approval is ATOMIC: an AFTER UPDATE trigger applies an approved organization
--      verification in the same transaction as review_approve. apply_organization_verification
--      stays as an idempotent no-op for already-applied rows (the Admin UI is unchanged).
--   5. Second and later organizations: business_draft_save / business_draft_submit refuse
--      unless the caller holds NO organization yet (the first) or already holds an
--      APPROVED one. Serialised per user with an advisory lock so concurrent submits
--      cannot slip two applications through. Each additional organization needs its own
--      approval; approval is never inherited.
--   6. contractor_company becomes obtainable ONLY through this application path, and only
--      by a Contractor. The organizations guard trigger still refuses every direct
--      insert/update by a signed-in user.
--   7. my_workspaces() now reports `is_approved`, so a client can show pending entries
--      without offering them as an active business workspace.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit allow-list (+ organization.application_submitted)
-- ---------------------------------------------------------------------------
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
  'organization.application_submitted'
)) not valid;

-- ---------------------------------------------------------------------------
-- 2. The single operational predicate
-- ---------------------------------------------------------------------------
create or replace function app.org_is_approved(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select o.status = 'active'::public.org_status
      from public.organizations o
     where o.id = p_org_id and o.deleted_at is null
  ), false);
$$;
revoke execute on function app.org_is_approved(uuid) from public, anon;
grant execute on function app.org_is_approved(uuid) to authenticated, service_role;
comment on function app.org_is_approved(uuid) is
  'True only for a live organization whose status is active - i.e. one an Admin approved. Pending, draft, suspended and archived organizations are non-operational: no audience, no publishing, no RFQ/response authority.';

-- ---------------------------------------------------------------------------
-- 3. Seller-side authority requires an approved organization
--    (drafting products stays available to a pending owner; publishing does not)
-- ---------------------------------------------------------------------------
create or replace function app.can_publish_catalog(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.org_is_approved(p_org_id)
     and (app.has_capability(p_org_id, 'catalog.publish') or app.has_capability(p_org_id, 'org.manage'));
$$;
create or replace function app.can_create_rfq(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.org_is_approved(p_org_id)
     and (app.has_capability(p_org_id, 'rfq.create') or app.has_capability(p_org_id, 'org.manage'));
$$;
create or replace function app.can_respond_rfq(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.org_is_approved(p_org_id)
     and (app.has_capability(p_org_id, 'rfq.respond')
          or app.has_capability(p_org_id, 'quote.submit')
          or app.has_capability(p_org_id, 'org.manage'));
$$;
create or replace function app.can_decide_quote(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.org_is_approved(p_org_id)
     and (app.has_capability(p_org_id, 'quote.decide') or app.has_capability(p_org_id, 'org.manage'));
$$;

-- ---------------------------------------------------------------------------
-- 4. Audience resolution: a pending organization has NO audience
-- ---------------------------------------------------------------------------
create or replace function app.org_product_audience(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case o.org_type::text
           when 'showroom_dealer'    then 'showroom_dealer'
           when 'supplier'           then 'supplier'
           when 'manufacturer'       then 'manufacturer'
           when 'importer'           then 'importer'
           when 'design_office'      then 'engineer'
           when 'contractor_company' then 'contractor'
           else null end
    from public.organizations o
   where o.id = p_org_id and o.deleted_at is null
     and o.status = 'active'::public.org_status;
$$;

create or replace function app.viewer_offer_audience(p_org_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v text;
begin
  if (select auth.uid()) is null then return null; end if;
  if p_org_id is not null then
    if not app.is_org_member(p_org_id) then
      raise exception 'not a member of this organization' using errcode = '42501';
    end if;
    select o.org_type::text into v from public.organizations o
     where o.id = p_org_id and o.deleted_at is null and o.status = 'active'::public.org_status;
    return v;
  end if;
  select u.primary_account_type::text into v from public.users u where u.id = (select auth.uid());
  return v;
end;
$$;

-- Another viewer never sees a pending seller's products; a workspace always sees its own.
create or replace function app.product_visible_to(p_product_id uuid, p_viewer_org_id uuid, p_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.products p
      join public.organizations o on o.id = p.organization_id and o.deleted_at is null
     where p.id = p_product_id
       and p.status = 'published' and p.deleted_at is null and p.archived_at is null
       and (p.organization_id = p_viewer_org_id
            or (p_audience is not null
                and o.status = 'active'::public.org_status
                and exists (select 1 from public.product_audiences a
                             where a.product_id = p.id and a.audience = p_audience))));
$$;

-- An offer is live only while its seller is approved.
create or replace function app.offer_is_live(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.product_offers o
      join public.organizations org on org.id = o.organization_id and org.deleted_at is null
     where o.id = p_offer_id
       and org.status = 'active'::public.org_status
       and o.status = 'published'
       and now() >= o.starts_at and now() < o.ends_at
       and exists (select 1 from public.product_offer_items i where i.offer_id = o.id)
       and not exists (
             select 1
               from public.product_offer_items i
               left join public.products p on p.id = i.product_id
              where i.offer_id = o.id
                and (p.id is null or p.status <> 'published' or p.deleted_at is not null or p.archived_at is not null))
  );
$$;

-- Image signing: the offer-audience branch used the raw organization type of the named
-- workspace, so a pending workspace could still be granted an offer's images.
create or replace function app.product_image_viewable(p_product_id uuid, p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_aud  text;
  v_oaud text;
begin
  if v_uid is null then return false; end if;
  if p_org_id is not null then
    if not app.is_org_member(p_org_id) then return false; end if;
    v_aud := app.org_product_audience(p_org_id);
    select o.org_type::text into v_oaud from public.organizations o
     where o.id = p_org_id and o.deleted_at is null and o.status = 'active'::public.org_status;
  else
    select u.primary_account_type::text into v_oaud from public.users u where u.id = v_uid;
    v_aud := app.persona_product_audience(v_oaud);
  end if;
  return app.product_visible_to(p_product_id, p_org_id, v_aud)
      or (v_oaud is not null
          and exists (
                select 1
                  from public.product_offer_items oi
                  join public.product_offers o on o.id = oi.offer_id
                 where oi.product_id = p_product_id
                   and app.offer_is_live(o.id)
                   and exists (select 1 from public.product_offer_audiences a
                                where a.offer_id = o.id and a.audience = v_oaud)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Organization Application = the existing `verifications` review record
-- ---------------------------------------------------------------------------
-- One OPEN application per organization (duplicate-application guard).
create unique index uq_verifications_open_per_org
  on public.verifications (organization_id)
  where subject_type = 'organization'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');

-- Atomic application of an approved organization review. Shared by the trigger (so
-- approval and activation are ONE transaction) and by apply_organization_verification.
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
  update public.verifications set applied_at = now() where id = v_v.id;
end;
$$;
revoke all on function app._apply_org_approval(uuid) from public, anon, authenticated;

create or replace function app.verifications_apply_org_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app._apply_org_approval(new.id);
  return null;
end;
$$;
revoke all on function app.verifications_apply_org_approval() from public, anon, authenticated;

create trigger verifications_apply_org_approval
  after update of status on public.verifications
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved'
        and new.subject_type = 'organization')
  execute function app.verifications_apply_org_approval();

create or replace function public.apply_organization_verification(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  if v_v.applied_at is not null then return; end if;  -- idempotent (the trigger normally got there first)
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'an expired verification cannot be applied' using errcode = '22023';
  end if;
  if v_v.subject_type <> 'organization'
     or v_v.verification_type <> 'organization'
     or v_v.organization_id is null then
    raise exception 'verification is not an organization approval' using errcode = '22023';
  end if;
  perform app._apply_org_approval(p_verification_id);
end;
$$;

-- Owner-facing: submit (or resubmit after changes were requested / after a rejection).
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
  v_id   uuid;
begin
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

  select * into v_open from public.verifications v
   where v.subject_type = 'organization' and v.organization_id = p_org_id
     and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
   for update;

  if found then
    if v_open.status in ('submitted', 'under_review') then
      return v_open.id;                              -- idempotent: already in review
    end if;
    update public.verifications                      -- draft / needs_more_info -> submitted
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

-- Owner-facing status of every organization the caller owns that is not (yet) operational,
-- plus the approved ones, so the UI can render one list.
create or replace function public.my_organization_applications()
returns table (
  organization_id    uuid,
  name               text,
  org_type           public.organization_type,
  application_status text,
  reason             text,
  submitted_at       timestamptz,
  decided_at         timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.org_type,
         case
           when o.status = 'active' then 'approved'
           when v.id is null then 'draft'
           when v.status in ('submitted', 'under_review', 'approved') then 'pending_review'
           when v.status = 'needs_more_info' then 'needs_changes'
           when v.status = 'rejected' then 'rejected'
           else 'draft'
         end,
         case when o.status = 'active' then null else v.reason end,
         v.submitted_at, v.decided_at
    from public.organizations o
    join public.memberships m on m.organization_id = o.id and m.user_id = (select auth.uid())
                             and m.status = 'active'
    join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
    left join lateral (
      select v2.* from public.verifications v2
       where v2.subject_type = 'organization' and v2.organization_id = o.id
       order by v2.submitted_at desc limit 1
    ) v on true
   where o.deleted_at is null
   order by o.created_at;
$$;
revoke execute on function public.my_organization_applications() from public, anon;
grant execute on function public.my_organization_applications() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Second and later organizations
-- ---------------------------------------------------------------------------
-- The slot is open when the caller holds no organization yet (this is the first) or
-- already owns an APPROVED one. Owning = an active membership with org.manage.
create or replace function app.may_apply_for_organization(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uid is not null and (
    not exists (
      select 1 from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        join public.organizations o on o.id = m.organization_id and o.deleted_at is null
       where m.user_id = p_uid and m.status = 'active')
    or exists (
      select 1 from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        join public.organizations o on o.id = m.organization_id and o.deleted_at is null
       where m.user_id = p_uid and m.status = 'active' and o.status = 'active'::public.org_status)
  );
$$;
revoke all on function app.may_apply_for_organization(uuid) from public, anon, authenticated;

-- Entitlement: path C now requires an APPROVED owned organization, and a Contractor
-- persona may apply for its company. (B and A unchanged.)
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
                and op.selected_org_type in ('showroom_dealer', 'supplier', 'manufacturer', 'importer')
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

-- contractor_company: obtainable only through an application, and only by a Contractor.
alter table public.business_creation_drafts drop constraint ck_business_draft_registerable_type;
alter table public.business_creation_drafts
  add constraint ck_business_draft_registerable_type check (
    org_type is null or org_type in
      ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'design_office', 'contractor_company'));

create or replace function app.guard_contractor_company_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_type = 'contractor_company'
     and (tg_op = 'INSERT' or old.org_type is distinct from new.org_type)
     and (select auth.uid()) is not null
     and coalesce(current_setting('app.org_application', true), '') <> 'on' then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_contractor_company_assignment() from public, anon, authenticated, service_role;

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
  -- The Contractor's company is a Contractor's to apply for - nobody else's.
  if p_org_type = 'contractor_company' and app.effective_persona(v_uid) is distinct from 'contractor' then
    raise exception 'this organization type cannot be self-assigned' using errcode = '42501';
  end if;

  -- Transaction-local marker read by the organizations type guard: the ONLY way a
  -- signed-in caller reaches contractor_company is through this vetted path.
  perform set_config('app.org_application', 'on', true);

  -- ALWAYS pending_verification / unverified: a provisional record, non-operational
  -- (see app.org_is_approved) until an Admin approves the application.
  insert into public.organizations (name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  perform set_config('app.org_application', 'off', true);

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

-- business_draft_save: opening a NEW draft is where the slot rule applies.
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
begin
  perform pg_advisory_xact_lock(hashtextextended('org-application:' || v_uid::text, 0));

  if p_org_type = 'contractor_company' and app.effective_persona(v_uid) is distinct from 'contractor' then
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
    if not app.may_apply_for_organization(v_uid) then
      raise exception 'your first organization must be approved before you can add another'
        using errcode = '42501', hint = 'first_organization_not_approved';
    end if;
    -- Opening a NEW draft: a Contractor's organization is a contractor company; the
    -- persona is not a licence to open any other kind of business. (A draft already
    -- open under the earlier rule can still be finished.)
    if p_org_type is not null and p_org_type <> 'contractor_company'
       and app.effective_persona(v_uid) = 'contractor' then
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

-- business_draft_submit: re-checks the slot at CREATION time (a draft opened while the
-- slot was open must not outlive it), then submits the application for review.
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

  -- IDEMPOTENT: this draft already produced its organization.
  if v_d.organization_id is not null then
    return v_d.organization_id;
  end if;

  if app.can_create_or_complete_business(v_uid) is not true then
    raise exception 'adding a business is not available for this account' using errcode = '42501';
  end if;
  if not app.may_apply_for_organization(v_uid) then
    raise exception 'your first organization must be approved before you can add another'
      using errcode = '42501', hint = 'first_organization_not_approved';
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

-- ---------------------------------------------------------------------------
-- 7. my_workspaces reports approval so a pending business is never offered as ACTIVE
-- ---------------------------------------------------------------------------
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
  select 'personal'::text,
         null::uuid,
         coalesce(p.display_name, ''),
         u.primary_account_type,
         null::public.organization_type,
         null::text,
         true
  from public.users u
  left join public.profiles p on p.user_id = u.id and p.deleted_at is null
  where u.id = (select auth.uid())
    and app.has_personal_persona(u.id)
  union all
  select 'business'::text,
         o.id,
         o.name,
         null::public.persona_type,
         o.org_type,
         case
           when exists (
             select 1 from public.membership_capabilities c
             where c.membership_id = m.id and c.capability_key = 'org.manage'
           ) then 'owner'
           when exists (
             select 1 from public.membership_capabilities c
             where c.membership_id = m.id and c.capability_key = 'org.members.manage'
           ) then 'manager'
           else 'member'
         end,
         (o.status = 'active'::public.org_status)
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.deleted_at is null
  order by 1 desc, 3;
$$;
comment on function public.my_workspaces() is 'The caller''s derived work contexts: Personal (when a personal persona was claimed) plus every organization with an ACTIVE membership. `is_approved` is false for an organization still under review: it is listed so the owner can finish and track the application, but it is not an operational workspace - it resolves no audience and holds no publishing authority. Convenience projection only; selecting a workspace is NOT an authorization decision.';
revoke execute on function public.my_workspaces() from public, anon;
grant execute on function public.my_workspaces() to authenticated, service_role;
