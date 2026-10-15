-- B-1: organization_identity_state returned an OLDER rejected request after a LATER corrected request was
-- approved, because approved rows were excluded from the "latest request" lookup. The panel then showed a
-- stale rejection, its reviewer note and a misleading "send a corrected request".
--
-- Correction: pick the latest request across ALL outcomes (including approved). A newest approved request
-- is the current outcome: it is applied to the organization already, so there is no open request to show
-- (request_status and its details are NULL). Older rejections stay in `verifications` / the audit log as
-- history; they are simply no longer the current outcome. Same signature, same security, same grants.
-- Only the lookup changes: no write path, approval rule or permission is touched.
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
         case when r.status = 'approved' then null else r.id end,
         case r.status::text
           when 'submitted' then 'pending_review' when 'under_review' then 'pending_review'
           when 'needs_more_info' then 'needs_changes' when 'rejected' then 'rejected' end,
         case when r.status = 'approved' then null else r.metadata -> 'proposed' end,
         case when r.status = 'approved' then null else r.reason end,
         case when r.status = 'approved' then null else r.submitted_at end,
         case when r.status = 'approved' then null else r.decided_at end
    from public.organizations o
    left join lateral (
      select v.* from public.verifications v
       where v.verification_type = 'organization_identity' and v.organization_id = o.id
         and v.status in ('submitted', 'under_review', 'needs_more_info', 'rejected', 'approved')
       order by v.submitted_at desc, v.created_at desc, v.id desc limit 1
    ) r on true
   where o.id = p_org_id and o.deleted_at is null and app.is_org_member(o.id);
$$;
revoke all on function public.organization_identity_state(uuid) from public, anon;
grant execute on function public.organization_identity_state(uuid) to authenticated;
