-- Account-owner notification on APPROVAL of a personal/professional verification.
--
-- review_reject already told the owner of a personal subject (user_id) about a rejection, but review_approve notified only
-- organization owners, so an approved professional heard nothing. This adds the missing approval notification through the
-- existing centralized writer (app.notify) with the existing i18n key scheme. Nothing else changes: same signature, owner,
-- search_path, authority checks and audit; the notification is written in the same transaction as the decision and only
-- after it, and the early return for an already-approved verification means a retry can never write a second one.

create or replace function public.review_approve(p_verification_id uuid, p_grant_public_listing boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.can_review_verification(p_verification_id) or app.org_review_requires_administrator(p_verification_id) then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
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
    v_v.organization_id,
    jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false),
                       'subject_type', v_v.subject_type, 'subject_user_id', v_v.user_id, 'subject_organization_id', v_v.organization_id,
                       'admin_initiated', coalesce((v_v.metadata ->> 'initiated_by_admin')::boolean, false)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.approved', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.approved.title', 'notifications.verification.approved.body',
      '{}'::jsonb);
  elsif v_v.user_id is not null then
    -- The account owner is told of an approval too (the rejection path already did this for a personal subject).
    -- Reached once per decision: a retry of an approved verification returns above, before this point.
    perform app.notify(
      v_v.user_id, null,
      'verification.approved', 'verification', p_verification_id,
      '/home/profile',
      'notifications.verification.userApproved.title',
      case when coalesce(p_grant_public_listing, false) then 'notifications.verification.userApproved.bodyListed'
           else 'notifications.verification.userApproved.body' end,
      '{}'::jsonb);
  end if;
end;
$$;
