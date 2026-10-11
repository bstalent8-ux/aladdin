-- Milestone C hardening (security review: authorization-state-bypass).
--
-- 1. ATTACHMENTS ARE DRAFT-ONLY. request_upload and remove refused a non-draft request, but
--    confirm_upload and the storage INSERT predicate did not: an image ticket issued while the
--    request was a draft could be uploaded and CONFIRMED after the request was published,
--    changing the attachments of published demand. Both now require a draft.
-- 2. A CANCELLED OR DRAFT REQUEST IS NOT READABLE BY RESPONDERS. A responder keeps access to a
--    request it answered after the requester CLOSES it (history), but a request the requester
--    CANCELLED (or that is not published) must disappear for everyone except its owner side -
--    including its image signing.

create or replace function public.purchase_request_image_confirm_upload(p_object_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_i public.purchase_request_images; v_r public.purchase_requests;
begin
  perform app.require_verified_caller();
  select * into v_i from public.purchase_request_images
   where object_key = p_object_key and state = 'pending' and created_by = (select auth.uid()) for update;
  if not found then raise exception 'no matching pending image upload for this caller' using errcode = 'P0002'; end if;
  select * into v_r from public.purchase_requests where id = v_i.request_id for update;
  if not app.can_manage_request(v_i.request_id) then raise exception 'rfq.create required' using errcode = '42501'; end if;
  if v_r.status <> 'draft' then
    -- A non-draft request's attachments are frozen; the pending ticket never becomes ready.
    raise exception 'only a draft request can be edited' using errcode = '22023';
  end if;
  update public.purchase_request_images set state = 'ready' where id = v_i.id;
  perform app.record_audit_event('purchase_request.image_added', 'purchase_request', v_i.request_id,
    v_r.requester_org_id, jsonb_build_object('slot', v_i.slot));
  return v_i.id;
end;
$$;

create or replace function app.can_upload_request_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.purchase_request_images i
                   join public.purchase_requests r on r.id = i.request_id
                  where i.object_key = p_key and i.state = 'pending' and r.status = 'draft'
                    and i.created_by = (select auth.uid()) and app.can_manage_request(i.request_id));
$$;

create or replace function app.request_readable_by_workspace(p_request_id uuid, p_viewer_org_id uuid, p_viewer_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.request_visible_to(p_request_id, p_viewer_org_id, p_viewer_audience)
      or exists (select 1
                   from public.purchase_request_responses x
                   join public.purchase_requests r on r.id = x.request_id
                  where x.request_id = p_request_id and x.responder_org_id = p_viewer_org_id
                    and x.status = 'submitted'
                    and r.status in ('published', 'closed'));
$$;
