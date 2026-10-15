-- ===========================================================================
-- Contact visibility (Phase 6+7 Milestone A)
--
-- Three contact fields, each independently owner-controlled and HIDDEN BY DEFAULT:
--   phone, WhatsApp, contact e-mail.
--
-- WHERE THE VALUES LIVE (reuse before invent):
--   * Organizations had NO contact columns (organization_public_directory carries
--     none, and must keep carrying none). A new tenant-owned table holds the
--     business contact + the three flags.
--   * People (craftsmen / listed professionals) already own their data:
--     profiles.phone_e164 (canonical, libphonenumber-validated) and the verified
--     public.contacts rows (whatsapp / email). Only the three flags are new
--     (profile_contact_visibility); no value is copied, so a changed or removed
--     contact can never leave a stale published copy behind.
--
-- WHO READS A VALUE: only an authenticated member of an ACTIVE business
-- organization, acting through that workspace (p_viewer_org_id is verified
-- against membership - the same "selected workspace" rule as the product
-- readers), and only for a target that is already in the public directory
-- (verified/active org, listed/active professional) and only the fields the
-- owner switched on. Sales Team members act through the workspace they belong
-- to; nothing here widens that.
--
-- Pending / approved network candidates (a later migration) are NEVER read by
-- these functions: candidate contact data stays inside the referral record.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Business contact (tenant-owned)
-- ---------------------------------------------------------------------------
create table public.organization_contacts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  phone_e164      text,
  whatsapp_e164   text,
  contact_email   text,
  show_phone      boolean not null default false,
  show_whatsapp   boolean not null default false,
  show_email      boolean not null default false,
  updated_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_orgcontacts_phone    check (phone_e164    is null or phone_e164    ~ '^\+[1-9]\d{1,14}$'),
  constraint ck_orgcontacts_whatsapp check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9]\d{1,14}$'),
  constraint ck_orgcontacts_email    check (contact_email is null
    or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  -- A field can only be exposed while it has a value: "visible but empty" is not a state.
  constraint ck_orgcontacts_show_needs_value check (
    (not show_phone    or phone_e164    is not null)
    and (not show_whatsapp or whatsapp_e164 is not null)
    and (not show_email    or contact_email is not null))
);
comment on table public.organization_contacts is
  'Business contact (phone / WhatsApp / e-mail) owned by an organization. Every show_* flag defaults to false. Readable by org.manage members only; other businesses read exposed fields exclusively through public.business_contact.';

create trigger set_organization_contacts_updated_at
  before update on public.organization_contacts
  for each row execute function app.set_updated_at();

alter table public.organization_contacts enable row level security;
create policy organization_contacts_select_owner on public.organization_contacts
  for select to authenticated
  using (app.has_capability(organization_id, 'org.manage'));
revoke all on public.organization_contacts from public, anon, authenticated, service_role;
grant select on public.organization_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Personal (craftsman / professional) visibility flags
-- ---------------------------------------------------------------------------
create table public.profile_contact_visibility (
  user_id       uuid primary key references public.users (id) on delete cascade,
  show_phone    boolean not null default false,
  show_whatsapp boolean not null default false,
  show_email    boolean not null default false,
  updated_at    timestamptz not null default now()
);
comment on table public.profile_contact_visibility is
  'Which of a person''s EXISTING contact values (profiles.phone_e164, verified whatsapp / email contacts) may be shown to business viewers. No value is stored here. All flags default to false.';

create trigger set_profile_contact_visibility_updated_at
  before update on public.profile_contact_visibility
  for each row execute function app.set_updated_at();

alter table public.profile_contact_visibility enable row level security;
create policy profile_contact_visibility_select_self on public.profile_contact_visibility
  for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.profile_contact_visibility from public, anon, authenticated, service_role;
grant select on public.profile_contact_visibility to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit vocabulary (values are never logged, only which flags changed)
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
  'profile.contact_visibility_set'
)) not valid;

-- ---------------------------------------------------------------------------
-- 4. Owner write paths
-- ---------------------------------------------------------------------------
create or replace function public.organization_contact_set(
  p_org_id        uuid,
  p_phone_e164    text,
  p_whatsapp_e164 text,
  p_contact_email text,
  p_show_phone    boolean,
  p_show_whatsapp boolean,
  p_show_email    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_verified_caller();
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_wa    text := nullif(btrim(coalesce(p_whatsapp_e164, '')), '');
  v_mail  text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id and o.deleted_at is null) then
    raise exception 'organization not found' using errcode = '22023';
  end if;
  if p_show_phone is null or p_show_whatsapp is null or p_show_email is null then
    raise exception 'visibility flags are required' using errcode = '22023';
  end if;
  if (p_show_phone and v_phone is null) or (p_show_whatsapp and v_wa is null) or (p_show_email and v_mail is null) then
    raise exception 'a field cannot be shown without a value' using errcode = '22023';
  end if;
  if (v_phone is not null and v_phone !~ '^\+[1-9]\d{1,14}$')
     or (v_wa is not null and v_wa !~ '^\+[1-9]\d{1,14}$') then
    raise exception 'phone numbers must be in international E.164 form' using errcode = '22023';
  end if;
  if v_mail is not null and (char_length(v_mail) > 254 or v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'invalid contact e-mail' using errcode = '22023';
  end if;

  insert into public.organization_contacts as c (
    organization_id, phone_e164, whatsapp_e164, contact_email,
    show_phone, show_whatsapp, show_email, updated_by)
  values (p_org_id, v_phone, v_wa, v_mail, p_show_phone, p_show_whatsapp, p_show_email, v_uid)
  on conflict (organization_id) do update set
    phone_e164 = excluded.phone_e164, whatsapp_e164 = excluded.whatsapp_e164,
    contact_email = excluded.contact_email,
    show_phone = excluded.show_phone, show_whatsapp = excluded.show_whatsapp,
    show_email = excluded.show_email, updated_by = excluded.updated_by;

  perform app.record_audit_event('organization.contact_set', 'organization', p_org_id, p_org_id,
    jsonb_build_object('show_phone', p_show_phone, 'show_whatsapp', p_show_whatsapp, 'show_email', p_show_email));
end;
$$;
revoke execute on function public.organization_contact_set(uuid, text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.organization_contact_set(uuid, text, text, text, boolean, boolean, boolean) to authenticated;

create or replace function public.profile_contact_visibility_set(
  p_show_phone    boolean,
  p_show_whatsapp boolean,
  p_show_email    boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
begin
  if p_show_phone is null or p_show_whatsapp is null or p_show_email is null then
    raise exception 'visibility flags are required' using errcode = '22023';
  end if;
  -- Only an EXISTING value can be exposed.
  if p_show_phone and not exists (
       select 1 from public.profiles p where p.user_id = v_uid and p.phone_e164 is not null and p.deleted_at is null) then
    raise exception 'no phone number on your profile' using errcode = '22023';
  end if;
  if p_show_whatsapp and not exists (
       select 1 from public.contacts c where c.user_id = v_uid and c.channel = 'whatsapp' and c.is_verified) then
    raise exception 'no verified WhatsApp contact' using errcode = '22023';
  end if;
  if p_show_email and not exists (
       select 1 from public.contacts c where c.user_id = v_uid and c.channel = 'email' and c.is_verified) then
    raise exception 'no verified e-mail contact' using errcode = '22023';
  end if;

  insert into public.profile_contact_visibility (user_id, show_phone, show_whatsapp, show_email)
  values (v_uid, p_show_phone, p_show_whatsapp, p_show_email)
  on conflict (user_id) do update set
    show_phone = excluded.show_phone, show_whatsapp = excluded.show_whatsapp, show_email = excluded.show_email;

  perform app.record_audit_event('profile.contact_visibility_set', 'user', v_uid, null,
    jsonb_build_object('show_phone', p_show_phone, 'show_whatsapp', p_show_whatsapp, 'show_email', p_show_email));
end;
$$;
revoke execute on function public.profile_contact_visibility_set(boolean, boolean, boolean) from public;
grant execute on function public.profile_contact_visibility_set(boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Viewer gate + readers
-- ---------------------------------------------------------------------------
-- A viewer is an authenticated member of an ACTIVE, non-deleted business
-- organization, naming that workspace explicitly. Never raises for an ineligible
-- target (no enumeration oracle) but does raise for a workspace the caller is not in.
create or replace function app.assert_business_viewer(p_viewer_org_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_viewer_org_id is null or not app.is_org_member(p_viewer_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = p_viewer_org_id and o.deleted_at is null and o.status = 'active'::public.org_status
  ) then
    raise exception 'the workspace is not active' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function app.assert_business_viewer(uuid) from public;
grant execute on function app.assert_business_viewer(uuid) to authenticated;

create or replace function public.business_contact(p_viewer_org_id uuid, p_organization_id uuid)
returns table (phone text, whatsapp text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_business_viewer(p_viewer_org_id);
  return query
    select case when c.show_phone    then c.phone_e164    end,
           case when c.show_whatsapp then c.whatsapp_e164 end,
           case when c.show_email    then c.contact_email end
    from public.organization_contacts c
    join public.organizations o on o.id = c.organization_id
    where c.organization_id = p_organization_id
      and o.status = 'active'::public.org_status and o.is_verified and o.deleted_at is null
      and (c.show_phone or c.show_whatsapp or c.show_email);
end;
$$;
comment on function public.business_contact(uuid, uuid) is
  'Contact fields a directory-eligible business has chosen to expose, for an authenticated member of an active business workspace. Hidden fields come back NULL; an ineligible target returns no row.';
revoke execute on function public.business_contact(uuid, uuid) from public, anon;
grant execute on function public.business_contact(uuid, uuid) to authenticated;

create or replace function public.craftsman_contact(p_viewer_org_id uuid, p_profile_id uuid)
returns table (phone text, whatsapp text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.assert_business_viewer(p_viewer_org_id);
  return query
    select case when v.show_phone then pr.phone_e164 end,
           case when v.show_whatsapp then
             (select c.value from public.contacts c
               where c.user_id = pr.user_id and c.channel = 'whatsapp' and c.is_verified
               order by c.is_primary desc, c.created_at limit 1) end,
           case when v.show_email then
             (select c.value from public.contacts c
               where c.user_id = pr.user_id and c.channel = 'email' and c.is_verified
               order by c.is_primary desc, c.created_at limit 1) end
    from public.profiles pr
    join public.profile_contact_visibility v on v.user_id = pr.user_id
    where pr.id = p_profile_id
      -- only a profile that is already publicly listed (listed + active + professional)
      and exists (select 1 from app._profile_public_directory() d where d.id = pr.id)
      and (v.show_phone or v.show_whatsapp or v.show_email);
end;
$$;
comment on function public.craftsman_contact(uuid, uuid) is
  'Contact values a listed professional has chosen to expose (their own profiles.phone_e164 / verified contacts), for an authenticated member of an active business workspace.';
revoke execute on function public.craftsman_contact(uuid, uuid) from public, anon;
grant execute on function public.craftsman_contact(uuid, uuid) to authenticated;
