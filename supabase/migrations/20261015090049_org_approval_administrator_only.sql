-- rc1: organization approval is Administrator-only (Support/Moderator cannot give final approval).
-- Body is the latest definition (20260822090002) plus one guard; signature, grants and every other review type unchanged.
create or replace function public.review_approve(
  p_verification_id uuid,
  p_grant_public_listing boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  -- RELEASE RULE (rc1): the FINAL decision on an organization application is Administrator-only. Support and
  -- Moderator keep every other review type exactly as before; delegated organization approval returns only through a
  -- separately approved, explicit and scoped delegation (decision D-A1).
  if v_v.subject_type = 'organization' and not app.is_platform('administrator') then
    raise exception 'administrator authority required to approve an organization' using errcode = '42501';
  end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not approve their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'approved' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm approval' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to approved from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may approve' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'approved', decided_at = now(),
        grants_public_listing = coalesce(p_grant_public_listing, false)
    where id = p_verification_id;
  perform app.record_audit_event('verification.approved', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.approved', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.approved.title', 'notifications.verification.approved.body',
      '{}'::jsonb);
  end if;
end;
$fn$;
