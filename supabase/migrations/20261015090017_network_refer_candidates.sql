-- ===========================================================================
-- network.refer + supplier / craftsman candidates (Phase 6+7 Milestone A)
--
-- A showroom (or any business workspace) can tell Aladdin about a supplier,
-- manufacturer, importer or craftsman that is NOT yet registered. The submission
-- is pure referral DATA awaiting platform review:
--   * it creates NO Auth user, NO organization and NO public profile - ever,
--     including on approval (approved = "reviewed lead", nothing more);
--   * it exposes NO contact information anywhere (the typed phone / WhatsApp /
--     e-mail stay inside this row; no directory, view or reader projects them);
--   * it awards NO Points - this migration contains no app.award_points call, and
--     approval is a status change only. Reward eligibility is a separate, deferred
--     decision.
--
-- WHY A SEPARATE TABLE (and not new columns on network_referrals): that table's
-- constraints and its approve RPC encode the SHOWROOM case (origin shape,
-- case-A/B status rules, materialising an unowned showroom organization and paying
-- the one approved Points event). Reusing it would put the Points path one branch
-- away from the new kinds. The REVIEW ARCHITECTURE is reused (RPC-only writes,
-- app.require_verified_caller, platform-support review via app.is_platform,
-- pending -> decided stamps, version-free idempotent pending guard, audit verbs
-- in their own family); the craftsman-refers-showroom flow is untouched.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The capability: network.refer
-- ---------------------------------------------------------------------------
alter table public.membership_capabilities drop constraint ck_membership_capability_key;
alter table public.membership_capabilities add constraint ck_membership_capability_key check (capability_key in (
  'org.manage', 'org.members.manage', 'branch.manage',
  'verification.submit', 'verification.read',
  'catalog.read', 'catalog.write', 'catalog.publish',
  'inventory.write',
  'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
  'sales.task.write', 'sales.followup.send',
  'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
  'rfq.create', 'rfq.respond',
  'quote.submit', 'quote.decide',
  'order.create', 'order.manage',
  'project.read', 'project.write',
  'conversation.participate',
  'job.post', 'job.manage',
  'ad.manage',
  'subscription.read', 'subscription.manage',
  'analytics.view',
  'export.data',
  'activity.read',
  'network.refer'
));

-- org.manage implies it, exactly like every other can_* gate.
create or replace function app.can_refer_network(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'network.refer') or app.has_capability(p_org_id, 'org.manage');
$$;
revoke execute on function app.can_refer_network(uuid) from public;
grant execute on function app.can_refer_network(uuid) to authenticated;

-- Delegation: the existing no-escalation RPC, with ONE addition - an org.manage
-- holder may grant network.refer (they hold it implicitly) without being given a
-- literal row. Every other key keeps the strict "you must hold it" rule.
create or replace function public.membership_set_capabilities(
  p_membership_id uuid,
  p_capabilities text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
  v_cap text;
  v_before text[];
  v_after text[];
begin
  if p_capabilities is null then
    raise exception 'capabilities must be an array (empty means remove all)'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_capabilities) c where c is null)
     or cardinality(p_capabilities) <> (select count(distinct c) from unnest(p_capabilities) c) then
    raise exception 'capabilities must contain unique, non-null keys'
      using errcode = '22023';
  end if;

  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
    into v_before
    from public.membership_capabilities c where c.membership_id = p_membership_id;

  foreach v_cap in array p_capabilities loop
    if v_cap not in (
      'org.manage', 'org.members.manage', 'branch.manage',
      'verification.submit', 'verification.read',
      'catalog.read', 'catalog.write', 'catalog.publish',
      'inventory.write',
      -- Sprint 3 sales domain (the keys the live sales RPCs enforce).
      'sales.read', 'sales.write', 'sales.assign', 'sales.manage',
      'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
      'sales.task.write', 'sales.followup.send',
      -- Sprint 9/10 commerce + execution domains.
      'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
      'order.create', 'order.manage',
      'project.read', 'project.write', 'conversation.participate',
      'ad.manage', 'subscription.read', 'subscription.manage',
      'analytics.view', 'export.data', 'activity.read', 'network.refer'
    ) then
      raise exception 'invalid capability key: %', v_cap using errcode = '22023';
    end if;
    if not (app.has_capability(v_m.organization_id, v_cap)
            or (v_cap = 'network.refer' and app.has_capability(v_m.organization_id, 'org.manage'))) then
      raise exception 'cannot grant a capability you do not hold: %', v_cap using errcode = '42501';
    end if;
  end loop;

  if 'org.manage' = any(v_before) and not ('org.manage' = any(p_capabilities)) then
    perform app.assert_not_last_owner(p_membership_id);
  end if;

  delete from public.membership_capabilities where membership_id = p_membership_id;
  insert into public.membership_capabilities (membership_id, capability_key)
    select p_membership_id, c from unnest(p_capabilities) c;

  select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
    into v_after
    from public.membership_capabilities c where c.membership_id = p_membership_id;
  perform app.record_audit_event('membership.role_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
end;
$$;
revoke execute on function public.membership_set_capabilities(uuid, text[]) from public;
grant execute on function public.membership_set_capabilities(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 1b. Audit vocabulary
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  'onboarding.organization_created',
  'product.created', 'product.updated', 'product.published', 'product.unpublished',
  'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected',
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed',
  'organization.verified',
  'affiliation.requested', 'affiliation.cancelled',
  'affiliation.approved', 'affiliation.rejected',
  'referral.submitted', 'referral.approved', 'referral.rejected',
  'conversation.opened',
  'points.adjusted', 'points.reversed',
  'job.created', 'job.updated', 'job.published', 'job.closed', 'job.cancelled',
  'job.application.submitted', 'job.application.withdrawn',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.started', 'job.assignment.progress_updated',
  'job.assignment.completed', 'job.assignment.cancelled',
  'job.review.submitted', 'job.review.suppressed', 'job.review.restored',
  'network_referral.submitted', 'network_referral.joined',
  'network_referral.approved', 'network_referral.rejected', 'network_referral.cancelled',
  'profile.username_set', 'profile.phone_set', 'profile.avatar_set',
  'organization.activities_set', 'user.activities_set',
  'product.archived', 'product.restored',
  'product.image_added', 'product.image_removed', 'product.image_reordered',
  -- Product Offers
  'offer.created', 'offer.updated', 'offer.published', 'offer.paused', 'offer.resumed', 'offer.archived',
  -- Phase 6+7 Milestone A
  'organization.contact_set',
  'profile.contact_visibility_set',
  'network_candidate.submitted',
  'network_candidate.approved',
  'network_candidate.rejected',
  'network_candidate.cancelled'
));

-- ---------------------------------------------------------------------------
-- 2. network_candidates
-- ---------------------------------------------------------------------------
create table public.network_candidates (
  id                   uuid primary key default extensions.gen_random_uuid(),
  candidate_kind       text not null,
  submitted_by         uuid not null references public.users (id) on delete cascade,
  submitted_by_org_id  uuid not null references public.organizations (id) on delete cascade,

  display_name         text not null,
  -- supplier candidates: which canonical organization_type they claim to be.
  business_type        text,
  -- craftsman candidates: canonical trade (public.trades.key), optional.
  trade_key            text references public.trades (key),
  governorate          text,
  city                 text,
  contact_phone        text,
  contact_whatsapp     text,
  contact_email        text,
  note                 text,

  status               text not null default 'pending',
  decided_by           uuid references public.users (id) on delete set null,
  decided_at           timestamptz,
  decision_reason      text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint ck_netcand_kind    check (candidate_kind in ('supplier', 'craftsman')),
  constraint ck_netcand_status  check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint ck_netcand_shape   check (
    (candidate_kind = 'supplier'  and business_type in ('supplier', 'manufacturer', 'importer') and trade_key is null)
    or (candidate_kind = 'craftsman' and business_type is null)),
  constraint ck_netcand_name    check (char_length(display_name) between 2 and 120),
  constraint ck_netcand_gov     check (governorate is null or char_length(governorate) <= 80),
  constraint ck_netcand_city    check (city is null or char_length(city) <= 80),
  constraint ck_netcand_phone   check (contact_phone is null or contact_phone ~ '^[+0-9][0-9 ()-]{5,31}$'),
  constraint ck_netcand_wa      check (contact_whatsapp is null or contact_whatsapp ~ '^[+0-9][0-9 ()-]{5,31}$'),
  constraint ck_netcand_email   check (contact_email is null
    or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint ck_netcand_note    check (note is null or char_length(note) <= 500),
  constraint ck_netcand_reason  check (decision_reason is null or char_length(decision_reason) <= 500),
  constraint ck_netcand_stamp   check (
    (status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null))
);
comment on table public.network_candidates is
  'A supplier / manufacturer / importer / craftsman that is NOT registered, submitted by a business workspace holding network.refer for platform review. Creates no account, organization or profile; contact data never leaves this row; approval awards no Points.';

create index ix_netcand_org    on public.network_candidates (submitted_by_org_id, created_at desc);
create index ix_netcand_status on public.network_candidates (status, created_at) where status = 'pending';
create unique index uq_netcand_pending_name
  on public.network_candidates (submitted_by_org_id, candidate_kind, lower(btrim(display_name)))
  where status = 'pending';

create trigger set_network_candidates_updated_at
  before update on public.network_candidates
  for each row execute function app.set_updated_at();

-- Attribution that can be edited can be stolen: submitter, submitting organization,
-- kind and the submitted content are fixed once written; only the review fields move.
create or replace function app.network_candidates_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.candidate_kind is distinct from old.candidate_kind
     or new.submitted_by is distinct from old.submitted_by
     or new.submitted_by_org_id is distinct from old.submitted_by_org_id
     or new.display_name is distinct from old.display_name
     or new.business_type is distinct from old.business_type
     or new.trade_key is distinct from old.trade_key
     or new.contact_phone is distinct from old.contact_phone
     or new.contact_whatsapp is distinct from old.contact_whatsapp
     or new.contact_email is distinct from old.contact_email
     or new.created_at is distinct from old.created_at then
    raise exception 'a network candidate submission cannot be edited' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app.network_candidates_immutable() from public;
create trigger network_candidates_immutable
  before update on public.network_candidates
  for each row execute function app.network_candidates_immutable();

revoke all on public.network_candidates from public, anon, authenticated, service_role;
alter table public.network_candidates enable row level security;

-- The submitter, and members of the submitting organization who may refer, read the
-- row; platform reviewers read all. NO policy for any other tenant or any viewer.
create policy netcand_select_submitter on public.network_candidates
  for select to authenticated
  using (submitted_by = (select auth.uid()));
create policy netcand_select_org on public.network_candidates
  for select to authenticated
  using (app.is_org_member(submitted_by_org_id) and app.can_refer_network(submitted_by_org_id));
create policy netcand_select_platform on public.network_candidates
  for select to authenticated
  using (app.is_platform('support'));
grant select on public.network_candidates to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Submit / cancel (business side)
-- ---------------------------------------------------------------------------
create or replace function public.network_candidate_create(
  p_org_id        uuid,
  p_kind          text,
  p_display_name  text,
  p_business_type text default null,
  p_trade_key     text default null,
  p_governorate   text default null,
  p_city          text default null,
  p_phone         text default null,
  p_whatsapp      text default null,
  p_email         text default null,
  p_note          text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_id   uuid;
begin
  if p_org_id is null or not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_refer_network(p_org_id) then
    raise exception 'network.refer required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = p_org_id and o.deleted_at is null and o.status = 'active'::public.org_status) then
    raise exception 'the workspace is not active' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('supplier', 'craftsman') then
    raise exception 'candidate kind must be supplier or craftsman' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  if p_kind = 'supplier' and coalesce(p_business_type, '') not in ('supplier', 'manufacturer', 'importer') then
    raise exception 'a supplier candidate needs a business type (supplier, manufacturer or importer)' using errcode = '22023';
  end if;
  if p_kind = 'craftsman' and nullif(p_business_type, '') is not null then
    raise exception 'business type applies to supplier candidates only' using errcode = '22023';
  end if;
  if p_kind = 'supplier' and nullif(p_trade_key, '') is not null then
    raise exception 'a trade applies to craftsman candidates only' using errcode = '22023';
  end if;
  if nullif(p_trade_key, '') is not null
     and not exists (select 1 from public.trades t where t.key = p_trade_key and t.is_active) then
    raise exception 'unknown trade' using errcode = '22023';
  end if;
  -- At least one way to reach the candidate: a review without any is not actionable.
  if nullif(btrim(coalesce(p_phone, '')), '') is null
     and nullif(btrim(coalesce(p_whatsapp, '')), '') is null
     and nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception 'at least one contact detail is required' using errcode = '22023';
  end if;

  -- Idempotent: the same open submission from the same workspace is returned, not duplicated.
  select c.id into v_id from public.network_candidates c
   where c.submitted_by_org_id = p_org_id and c.candidate_kind = p_kind
     and c.status = 'pending' and lower(btrim(c.display_name)) = lower(v_name);
  if v_id is not null then return v_id; end if;

  insert into public.network_candidates (
    candidate_kind, submitted_by, submitted_by_org_id, display_name, business_type, trade_key,
    governorate, city, contact_phone, contact_whatsapp, contact_email, note)
  values (
    p_kind, v_uid, p_org_id, v_name,
    case when p_kind = 'supplier' then p_business_type end,
    case when p_kind = 'craftsman' then nullif(p_trade_key, '') end,
    nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_whatsapp, '')), ''),
    nullif(lower(btrim(coalesce(p_email, ''))), ''),
    nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;

  -- Metadata carries kind + name only; contact values stay in the row.
  perform app.record_audit_event('network_candidate.submitted', 'network_candidate', v_id, p_org_id,
    jsonb_build_object('kind', p_kind, 'display_name', v_name));
  return v_id;
end;
$$;
revoke execute on function public.network_candidate_create(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.network_candidate_create(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.network_candidate_cancel(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_c   public.network_candidates;
begin
  select * into v_c from public.network_candidates where id = p_candidate_id for update;
  if not found
     or not (v_c.submitted_by = v_uid
             or (app.is_org_member(v_c.submitted_by_org_id) and app.has_capability(v_c.submitted_by_org_id, 'org.manage'))) then
    raise exception 'candidate not found' using errcode = '42501';
  end if;
  if v_c.status <> 'pending' then return; end if;
  update public.network_candidates set status = 'cancelled', decided_by = v_uid, decided_at = now()
   where id = p_candidate_id;
  perform app.record_audit_event('network_candidate.cancelled', 'network_candidate', p_candidate_id,
    v_c.submitted_by_org_id, jsonb_build_object('kind', v_c.candidate_kind));
end;
$$;
revoke execute on function public.network_candidate_cancel(uuid) from public, anon;
grant execute on function public.network_candidate_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Platform review - status change ONLY (no account, no organization, no Points)
-- ---------------------------------------------------------------------------
create or replace function public.network_candidate_approve(p_candidate_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.network_candidates;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_c from public.network_candidates where id = p_candidate_id for update;
  if not found then raise exception 'candidate not found' using errcode = '22023'; end if;
  if v_c.status = 'approved' then return; end if;
  if v_c.status <> 'pending' then
    raise exception 'only a pending candidate can be approved (status=%)', v_c.status using errcode = '22023';
  end if;
  update public.network_candidates
     set status = 'approved', decided_by = (select auth.uid()), decided_at = now(),
         decision_reason = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_candidate_id;
  perform app.record_audit_event('network_candidate.approved', 'network_candidate', p_candidate_id,
    v_c.submitted_by_org_id, jsonb_build_object('kind', v_c.candidate_kind, 'submitted_by', v_c.submitted_by));
end;
$$;
revoke execute on function public.network_candidate_approve(uuid, text) from public, anon;
grant execute on function public.network_candidate_approve(uuid, text) to authenticated;

create or replace function public.network_candidate_reject(p_candidate_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_c      public.network_candidates;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'a reason is required to reject a candidate' using errcode = '22023';
  end if;
  select * into v_c from public.network_candidates where id = p_candidate_id for update;
  if not found then raise exception 'candidate not found' using errcode = '22023'; end if;
  if v_c.status = 'rejected' then return; end if;
  if v_c.status <> 'pending' then
    raise exception 'only a pending candidate can be rejected (status=%)', v_c.status using errcode = '22023';
  end if;
  update public.network_candidates
     set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(),
         decision_reason = left(v_reason, 500)
   where id = p_candidate_id;
  perform app.record_audit_event('network_candidate.rejected', 'network_candidate', p_candidate_id,
    v_c.submitted_by_org_id, jsonb_build_object('kind', v_c.candidate_kind));
end;
$$;
revoke execute on function public.network_candidate_reject(uuid, text) from public, anon;
grant execute on function public.network_candidate_reject(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Read model (RLS-scoped: the submitter's rows + their organization's for referrers)
-- ---------------------------------------------------------------------------
create view public.my_network_candidates with (security_invoker = true) as
  select id, candidate_kind, submitted_by, submitted_by_org_id, display_name, business_type, trade_key,
         governorate, city, contact_phone, contact_whatsapp, contact_email, note,
         status, decision_reason, created_at, decided_at
  from public.network_candidates;
comment on view public.my_network_candidates is
  'Candidates the caller submitted, or that were submitted by an organization where they may refer (RLS-scoped). Never another tenant''s rows.';
revoke all on public.my_network_candidates from public, anon, authenticated, service_role;
grant select on public.my_network_candidates to authenticated;
