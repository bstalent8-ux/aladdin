-- ===========================================================================
-- M4a stage 1 - publisher identity (additive; nothing existing changes behaviour here).
--
-- A PUBLISHER is the one authoritative seller identity of a product or commercial offer:
--   organization            one per organization (created for every organization, backfilled below)
--   independent_contractor  an individual Contractor, ONLY after an Admin approves commercial publishing
--   independent_engineer    an individual Engineer, ONLY after an Admin approves commercial publishing
-- No fake organization is ever created for an independent professional.
--
-- Independent approval reuses the existing review system (verification type independent_publisher,
-- subject = the user). It is distinct from user verification, organization approval and membership.
-- A publisher row never overrides a suspended / unapproved organization: for the organization kind
-- every authority check still goes through the organization's own approval and capabilities.
--
-- ROLLOUT GATE: independent content is never public / buyer-visible unless the platform flag
-- 'independent_commerce' is enabled. It defaults to disabled, has NO client or API writer (only the
-- database owner can change it), and is enabled only inside isolated local tests.
-- ===========================================================================

create type public.publisher_kind as enum ('organization', 'independent_contractor', 'independent_engineer');
create type public.publisher_status as enum ('active', 'suspended', 'revoked');

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
  'branch.reactivated',
  'branch.verification_revoked',
  'publisher.requested',
  'publisher.approved',
  'publisher.suspended',
  'publisher.revoked',
  'publisher.reinstated'
)) not valid;

-- 1. platform flags (the rollout gate) ----------------------------------------------------------
create table public.platform_flags (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.platform_flags (key, enabled) values ('independent_commerce', false);
alter table public.platform_flags enable row level security;
revoke all on public.platform_flags from public, anon, authenticated;

create or replace function app.flag_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.platform_flags f where f.key = p_key), false);
$$;
revoke all on function app.flag_enabled(text) from public, anon, authenticated, service_role;

-- 2. publishers ---------------------------------------------------------------------------------
create table public.publishers (
  id              uuid primary key default extensions.gen_random_uuid(),
  kind            public.publisher_kind not null,
  organization_id uuid unique references public.organizations (id) on delete cascade,
  user_id         uuid unique references public.users (id) on delete restrict,
  display_name    text check (display_name is null or char_length(display_name) between 1 and 160),
  status          public.publisher_status not null default 'active',
  approval_id     uuid references public.verifications (id),
  approved_by     uuid references public.users (id) on delete set null,
  approved_at     timestamptz,
  suspended_at    timestamptz,
  suspended_by    uuid references public.users (id) on delete set null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.users (id) on delete set null,
  status_reason   text check (status_reason is null or char_length(status_reason) between 1 and 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_publishers_identity check (
       (kind = 'organization' and organization_id is not null and user_id is null and status = 'active')
    or (kind <> 'organization' and organization_id is null and user_id is not null and approval_id is not null))
);
create trigger set_publishers_updated_at before update on public.publishers
  for each row execute function app.set_updated_at();

alter table public.publishers enable row level security;
revoke all on public.publishers from public, anon, authenticated;
grant select on public.publishers to authenticated;
-- a person sees their own independent identity; members see their organization's; platform staff see all
create policy publishers_select_self on public.publishers for select to authenticated
  using (user_id = (select auth.uid()));
create policy publishers_select_org on public.publishers for select to authenticated
  using (organization_id is not null and app.is_org_member(organization_id));
create policy publishers_select_platform on public.publishers for select to authenticated
  using (app.is_platform('support'::public.platform_role));

-- one organization publisher per organization: backfill, then keep in step
insert into public.publishers (kind, organization_id, status)
select 'organization', o.id, 'active' from public.organizations o
on conflict (organization_id) do nothing;

create or replace function app.create_org_publisher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.publishers (kind, organization_id, status)
  values ('organization', new.id, 'active')
  on conflict (organization_id) do nothing;
  return new;
end;
$$;
revoke all on function app.create_org_publisher() from public, anon, authenticated, service_role;
create trigger organizations_create_publisher after insert on public.organizations
  for each row execute function app.create_org_publisher();

-- 3. helpers ------------------------------------------------------------------------------------
create or replace function app.org_publisher_id(p_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.publishers p where p.organization_id = p_org_id;
$$;
revoke all on function app.org_publisher_id(uuid) from public, anon, authenticated, service_role;

-- the caller owns this publisher (independent) or is a member of it (organization): read access to own data
create or replace function app.is_publisher_member(p_publisher_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.publishers p
     where p.id = p_publisher_id
       and ((p.organization_id is not null and app.is_org_member(p.organization_id))
         or (p.user_id is not null and p.user_id = (select auth.uid()))));
$$;
revoke all on function app.is_publisher_member(uuid) from public, anon, authenticated, service_role;
-- evaluated inside row-level-security policies, so the signed-in role must be able to execute it
grant execute on function app.is_publisher_member(uuid) to authenticated;

-- an INDEPENDENT publisher is currently allowed to sell: active, and the person still has the persona it was approved for
create or replace function app.independent_publisher_active(p_publisher_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.publishers p
     where p.id = p_publisher_id and p.kind <> 'organization' and p.status = 'active'
       and app.effective_persona(p.user_id)::text = case p.kind when 'independent_contractor' then 'contractor' else 'engineer' end);
$$;
revoke all on function app.independent_publisher_active(uuid) from public, anon, authenticated, service_role;

-- PUBLIC availability gate. Organization publishers: always open (their own organization rules decide, exactly as
-- before). Independent publishers: active AND the rollout flag is on.
create or replace function app.publisher_gate_open(p_publisher_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.publishers p
     where p.id = p_publisher_id
       and (p.kind = 'organization'
            or (app.flag_enabled('independent_commerce') and app.independent_publisher_active(p.id))));
$$;
revoke all on function app.publisher_gate_open(uuid) from public, anon, authenticated, service_role;

-- the audience an independent publisher belongs to is derived from its kind, never stored or supplied
create or replace function app.publisher_audience(p_publisher_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p.kind
           when 'independent_contractor' then 'contractor'
           when 'independent_engineer' then 'engineer'
           else app.org_product_audience(p.organization_id) end
    from public.publishers p where p.id = p_publisher_id;
$$;
revoke all on function app.publisher_audience(uuid) from public, anon, authenticated, service_role;

-- WRITE authority. VOLATILE on purpose: it takes a SHARE lock on the publisher row so a concurrent
-- suspension / revocation (which updates that row) waits for an in-flight writer, and a writer that starts
-- afterwards sees the new status. Organization publishers keep their existing capability rules exactly.
create or replace function app.can_write_publisher(p_publisher_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.publishers;
begin
  select * into v from public.publishers p where p.id = p_publisher_id for share;
  if not found then return false; end if;
  if v.kind = 'organization' then
    return app.can_write_catalog(v.organization_id);
  end if;
  return v.user_id = (select auth.uid()) and app.independent_publisher_active(v.id);
end;
$$;
revoke all on function app.can_write_publisher(uuid) from public, anon, authenticated, service_role;

create or replace function app.can_publish_publisher(p_publisher_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v public.publishers;
begin
  select * into v from public.publishers p where p.id = p_publisher_id for share;
  if not found then return false; end if;
  if v.kind = 'organization' then
    return app.can_publish_catalog(v.organization_id);
  end if;
  return v.user_id = (select auth.uid()) and app.independent_publisher_active(v.id);
end;
$$;
revoke all on function app.can_publish_publisher(uuid) from public, anon, authenticated, service_role;

-- 4. review plumbing for the independent approval ---------------------------------------------------
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
  or ((verification_type = 'independent_publisher' and subject_type = 'user' and user_id is not null
        and requested_account_type in ('contractor', 'engineer')))
);

-- "one open request per user" belongs to the account upgrade / identity reviews; the publisher approval has its own
drop index public.uq_verifications_open_per_user;
create unique index uq_verifications_open_per_user on public.verifications (user_id)
  where subject_type = 'user' and verification_type in ('identity', 'professional')
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');
create unique index uq_verifications_open_independent_publisher on public.verifications (user_id)
  where verification_type = 'independent_publisher'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');

-- 5. request / apply / status ----------------------------------------------------------------------
create or replace function public.independent_publisher_request(p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_verified_caller();
  v_persona text := app.effective_persona(v_uid)::text;
  v_pub     public.publishers;
  v_open    public.verifications;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_name    text;
  v_id      uuid;
begin
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note must be at most 500 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('independent-publisher:' || v_uid::text, 0));
  if v_persona is null or v_persona not in ('contractor', 'engineer') then
    raise exception 'independent publishing is for Contractors and Engineers' using errcode = '42501', hint = 'not_eligible';
  end if;
  if not exists (select 1 from public.users u where u.id = v_uid and u.status = 'active') then
    raise exception 'the account is not active' using errcode = '42501', hint = 'not_eligible';
  end if;

  select * into v_pub from public.publishers p where p.user_id = v_uid for update;
  if found then
    if v_pub.status = 'active' then
      raise exception 'you are already approved to publish' using errcode = '22023', hint = 'already_active';
    elsif v_pub.status = 'suspended' then
      raise exception 'publishing is suspended; contact support' using errcode = '22023', hint = 'suspended';
    end if;
    -- revoked: a fresh approval may be requested
  end if;

  select * into v_open from public.verifications v
   where v.verification_type = 'independent_publisher' and v.user_id = v_uid
     and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info') for update;
  if found then
    if v_open.status in ('submitted', 'under_review') then return v_open.id; end if;
    update public.verifications set status = 'cancelled', decided_at = now() where id = v_open.id;
  end if;

  select pr.display_name into v_name from public.profiles pr where pr.user_id = v_uid and pr.deleted_at is null;
  insert into public.verifications (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, metadata)
  values ('user', v_uid, 'independent_publisher', v_persona::public.persona_type, 'submitted', clock_timestamp(),
          jsonb_build_object('note', v_note, 'display_name', v_name))
  returning id into v_id;
  perform app.record_audit_event('publisher.requested', 'verification', v_id, null,
    jsonb_build_object('persona', v_persona));
  return v_id;
end;
$$;
revoke all on function public.independent_publisher_request(text) from public, anon;
grant execute on function public.independent_publisher_request(text) to authenticated;

create or replace function app._apply_independent_publisher(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v       public.verifications;
  v_pers  text;
  v_kind  public.publisher_kind;
  v_name  text;
  v_pub   public.publishers;
begin
  select * into v from public.verifications where id = p_verification_id for update;
  if not found or v.status <> 'approved' or v.applied_at is not null then return; end if;
  if v.verification_type <> 'independent_publisher' or v.subject_type <> 'user' then return; end if;

  v_pers := app.effective_persona(v.user_id)::text;
  if v_pers is null or v_pers <> v.requested_account_type::text then
    raise exception 'the applicant is no longer a % - the approval cannot be applied', v.requested_account_type
      using errcode = '22023';
  end if;
  v_kind := case v_pers when 'contractor' then 'independent_contractor' else 'independent_engineer' end;
  v_name := coalesce(nullif(v.metadata ->> 'display_name', ''), 'Independent professional');

  select * into v_pub from public.publishers p where p.user_id = v.user_id for update;
  if found then
    if v_pub.kind <> v_kind then
      raise exception 'an existing independent identity of another kind cannot be re-used' using errcode = '22023';
    end if;
    update public.publishers
       set status = 'active', approval_id = v.id, approved_by = v.reviewer_id, approved_at = now(),
           suspended_at = null, suspended_by = null, revoked_at = null, revoked_by = null, status_reason = null,
           display_name = v_name
     where id = v_pub.id;
  else
    insert into public.publishers (kind, user_id, display_name, status, approval_id, approved_by, approved_at)
    values (v_kind, v.user_id, v_name, 'active', v.id, v.reviewer_id, now());
  end if;
  perform app.record_audit_event('publisher.approved', 'verification', v.id, null,
    jsonb_build_object('user_id', v.user_id, 'kind', v_kind, 'reviewer_id', v.reviewer_id));
  update public.verifications set applied_at = now() where id = v.id;
end;
$$;
revoke all on function app._apply_independent_publisher(uuid) from public, anon, authenticated, service_role;

create or replace function app.verifications_apply_publisher_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app._apply_independent_publisher(new.id);
  return null;
end;
$$;
revoke all on function app.verifications_apply_publisher_approval() from public, anon, authenticated, service_role;
create trigger verifications_apply_publisher_approval
  after update of status on public.verifications
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved'
        and new.subject_type = 'user' and new.verification_type = 'independent_publisher')
  execute function app.verifications_apply_publisher_approval();

-- content withdrawal: suspension / revocation takes published items out of availability (never deletes).
-- Reinstatement does NOT restore them: the owner republishes explicitly (auditable).
create or replace function app._withdraw_publisher_content(p_publisher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_products integer; v_offers integer;
begin
  with u as (
    update public.products
       set status = 'draft', published_at = null, version = version + 1
     where publisher_id = p_publisher_id and status = 'published' returning 1)
  select count(*) into v_products from u;
  with u as (
    update public.product_offers
       set status = 'paused', version = version + 1
     where publisher_id = p_publisher_id and status = 'published' returning 1)
  select count(*) into v_offers from u;
  return jsonb_build_object('products_unpublished', v_products, 'offers_paused', v_offers);
end;
$$;
revoke all on function app._withdraw_publisher_content(uuid) from public, anon, authenticated, service_role;

create or replace function public.publisher_suspend(p_publisher_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v public.publishers;
  v_w jsonb;
begin
  if not app.is_platform('administrator'::public.platform_role) then
    raise exception 'platform administrator authority required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 2000 then
    raise exception 'a reason of 1 to 2000 characters is required' using errcode = '22023';
  end if;
  select * into v from public.publishers where id = p_publisher_id for update;
  if not found or v.kind = 'organization' then
    raise exception 'independent publisher not found' using errcode = '22023';
  end if;
  if v.status <> 'active' then return; end if;
  update public.publishers set status = 'suspended', suspended_at = now(), suspended_by = v_uid, status_reason = v_reason
   where id = v.id;
  v_w := app._withdraw_publisher_content(v.id);
  perform app.record_audit_event('publisher.suspended', 'publisher', v.id, null,
    jsonb_build_object('reason', v_reason) || v_w);
end;
$$;
revoke all on function public.publisher_suspend(uuid, text) from public, anon;
grant execute on function public.publisher_suspend(uuid, text) to authenticated;

create or replace function public.publisher_revoke(p_publisher_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v public.publishers;
  v_w jsonb;
begin
  if not app.is_platform('administrator'::public.platform_role) then
    raise exception 'platform administrator authority required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 2000 then
    raise exception 'a reason of 1 to 2000 characters is required' using errcode = '22023';
  end if;
  select * into v from public.publishers where id = p_publisher_id for update;
  if not found or v.kind = 'organization' then
    raise exception 'independent publisher not found' using errcode = '22023';
  end if;
  if v.status = 'revoked' then return; end if;
  update public.publishers set status = 'revoked', revoked_at = now(), revoked_by = v_uid, status_reason = v_reason
   where id = v.id;
  v_w := app._withdraw_publisher_content(v.id);
  perform app.record_audit_event('publisher.revoked', 'publisher', v.id, null,
    jsonb_build_object('reason', v_reason) || v_w);
end;
$$;
revoke all on function public.publisher_revoke(uuid, text) from public, anon;
grant execute on function public.publisher_revoke(uuid, text) to authenticated;

-- Recovery of a SUSPENDED publisher (a revoked one needs a new approval). Content is not restored.
create or replace function public.publisher_reinstate(p_publisher_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v public.publishers;
begin
  if not app.is_platform('administrator'::public.platform_role) then
    raise exception 'platform administrator authority required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 1 and 2000 then
    raise exception 'a reason of 1 to 2000 characters is required' using errcode = '22023';
  end if;
  select * into v from public.publishers where id = p_publisher_id for update;
  if not found or v.kind = 'organization' or v.status <> 'suspended' then
    raise exception 'only a suspended independent publisher can be reinstated' using errcode = '22023';
  end if;
  update public.publishers
     set status = 'active', suspended_at = null, suspended_by = null, status_reason = null
   where id = v.id;
  perform app.record_audit_event('publisher.reinstated', 'publisher', v.id, null, jsonb_build_object('reason', v_reason));
end;
$$;
revoke all on function public.publisher_reinstate(uuid, text) from public, anon;
grant execute on function public.publisher_reinstate(uuid, text) to authenticated;

-- the caller's own state: what they could request, what they hold, how the request stands
create or replace function public.my_independent_publisher()
returns table (
  eligible_kind   text,
  publisher_id    uuid,
  status          text,
  display_name    text,
  request_status  text,
  reason          text,
  can_request     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
       persona as (select app.effective_persona(me.uid)::text as p, me.uid from me)
  select case when persona.p in ('contractor', 'engineer') then persona.p end,
         pb.id, pb.status::text, pb.display_name,
         case r.status::text when 'submitted' then 'pending_review' when 'under_review' then 'pending_review'
                             when 'needs_more_info' then 'needs_changes' when 'rejected' then 'rejected' end,
         coalesce(r.reason, case when pb.status <> 'active' then pb.status_reason end),
         (persona.p in ('contractor', 'engineer')
            and coalesce(pb.status::text, 'none') in ('none', 'revoked')
            and coalesce(r.status::text, 'none') not in ('submitted', 'under_review'))
    from persona
    left join public.publishers pb on pb.user_id = persona.uid
    left join lateral (
      select v.* from public.verifications v
       where v.verification_type = 'independent_publisher' and v.user_id = persona.uid
         and v.status in ('submitted', 'under_review', 'needs_more_info', 'rejected')
       order by v.submitted_at desc, v.created_at desc limit 1) r on true
   where persona.uid is not null;
$$;
revoke all on function public.my_independent_publisher() from public, anon;
grant execute on function public.my_independent_publisher() to authenticated;
