-- Showroom business profile image.
--
-- A BUSINESS image: owned by the organization, set and removed only by an organization manager
-- (org.manage), never the owner's personal avatar and never copied from it. Same ownership model as
-- avatars/portfolio (pending metadata row -> server-generated key -> upload -> confirm) with three
-- deliberate differences:
--   * the storage key is prefixed with the organization id and every predicate re-checks the CALLER's
--     live capability on that organization, so a revoked manager cannot upload or remove;
--   * the object is readable only by MEMBERS of the organization (no public or anon signing). The existing
--     `organization_public_directory` view carries `logo_media_id` (an id; nothing resolves it) - exposing the
--     image publicly is a later, separately approved decision;
--   * `organizations.logo_media_id` (nullable uuid created with no foreign key, "later phase") becomes the
--     pointer to the current image row, now with its foreign key.
-- No gallery and no cover image: exactly one current image per organization.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-images', 'organization-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.organization_images (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  object_key      text not null unique
                  check (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  content_type    text not null,
  state           public.professional_asset_state not null default 'pending',
  created_by      uuid not null references public.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_organization_images_key_prefix check (split_part(object_key, '/', 1) = organization_id::text)
);
comment on table public.organization_images is
  'Metadata row for an organization (business) profile image - the authority storage RLS consults. A well-formed key proves nothing; only a pending row for THIS organization plus the caller''s live org.manage allows an upload. Written only by organization_image_request_upload / organization_image_confirm_upload / organization_image_remove.';

create index ix_organization_images_org on public.organization_images (organization_id);

revoke all on public.organization_images from anon, authenticated, service_role;
grant select on public.organization_images to authenticated;
alter table public.organization_images enable row level security;
create policy organization_images_select_member on public.organization_images
  for select to authenticated using (app.is_org_member(organization_id));

create trigger set_organization_images_updated_at
  before update on public.organization_images
  for each row execute function app.set_updated_at();

alter table public.organizations
  add constraint fk_organizations_logo_media_id
  foreign key (logo_media_id) references public.organization_images (id) on delete set null;
-- The pointer is written only by the RPCs below: a manager must not be able to aim it at another organization's row.
revoke update (logo_media_id) on public.organizations from authenticated;

comment on column public.organizations.logo_media_id is
  'Current business profile image (organization_images.id). Set only by organization_image_confirm_upload, cleared only by organization_image_remove. Members-only object; the public directory view exposes this id but nothing resolves it for non-members.';

-- Predicates --------------------------------------------------------------------------------------------
create or replace function app.can_upload_organization_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_images i
     where i.object_key = p_key and i.state = 'pending'
       and app.has_capability(i.organization_id, 'org.manage'));
$$;
create or replace function app.can_read_organization_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_images i
     where i.object_key = p_key and i.state in ('pending', 'ready') and app.is_org_member(i.organization_id));
$$;
create or replace function app.can_delete_organization_image_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_images i
     where i.object_key = p_key and app.has_capability(i.organization_id, 'org.manage'));
$$;
revoke execute on function app.can_upload_organization_image_object(text), app.can_read_organization_image_object(text),
  app.can_delete_organization_image_object(text) from public, anon;
grant execute on function app.can_upload_organization_image_object(text), app.can_read_organization_image_object(text),
  app.can_delete_organization_image_object(text) to authenticated;

create policy organization_images_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'organization-images' and app.can_upload_organization_image_object(name));
create policy organization_images_select_member on storage.objects
  for select to authenticated
  using (bucket_id = 'organization-images' and app.can_read_organization_image_object(name));
create policy organization_images_delete_manager on storage.objects
  for delete to authenticated
  using (bucket_id = 'organization-images' and app.can_delete_organization_image_object(name));
-- No UPDATE policy: a key is immutable; replacement is new object + pointer switch + cleanup.

-- Audit allow-list (extended from the live definition so earlier additions are never lost) ----------------
do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conname = 'ck_audit_action_known';
  alter table public.audit_log drop constraint ck_audit_action_known;
  execute 'alter table public.audit_log add constraint ck_audit_action_known '
    || regexp_replace(v_def, '\]\)\)\)$', ', ''organization.image_set''::text, ''organization.image_removed''::text])))');
end $$;

-- RPCs -----------------------------------------------------------------------------------------------------
create or replace function public.organization_image_request_upload(p_org_id uuid, p_content_type text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_ext text;
  v_key text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id and o.deleted_at is null) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then raise exception 'unsupported content type' using errcode = '22023'; end if;
  v_key := p_org_id::text || '/' || extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.organization_images (organization_id, object_key, content_type, state, created_by)
  values (p_org_id, v_key, p_content_type, 'pending', v_uid);
  return v_key;
end;
$$;

create or replace function public.organization_image_confirm_upload(p_object_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.organization_images;
  v_prev uuid;
  v_prev_key text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into v_row from public.organization_images where object_key = p_object_key and state = 'pending';
  if not found then raise exception 'no matching pending image upload' using errcode = 'P0002'; end if;
  if not app.has_capability(v_row.organization_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  select logo_media_id into v_prev from public.organizations where id = v_row.organization_id;
  if v_prev is not null then select object_key into v_prev_key from public.organization_images where id = v_prev; end if;
  update public.organization_images set state = 'ready' where id = v_row.id;
  update public.organizations set logo_media_id = v_row.id where id = v_row.organization_id;
  if v_prev is not null then update public.organization_images set state = 'deleted' where id = v_prev; end if;
  perform app.record_audit_event('organization.image_set', 'organization', v_row.organization_id, v_row.organization_id,
    jsonb_build_object('image_id', v_row.id));
  return v_prev_key;
end;
$$;

create or replace function public.organization_image_remove(p_org_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_prev uuid;
  v_prev_key text;
begin
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  select logo_media_id into v_prev from public.organizations where id = p_org_id;
  if v_prev is null then return null; end if;
  select object_key into v_prev_key from public.organization_images where id = v_prev;
  update public.organizations set logo_media_id = null where id = p_org_id;
  update public.organization_images set state = 'deleted' where id = v_prev;
  perform app.record_audit_event('organization.image_removed', 'organization', p_org_id, p_org_id,
    jsonb_build_object('image_id', v_prev));
  return v_prev_key;
end;
$$;

-- The current image key, for MEMBERS only (the application signs it with the caller's own client).
create or replace function public.organization_image_current(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select i.object_key
    from public.organizations o
    join public.organization_images i on i.id = o.logo_media_id and i.organization_id = o.id and i.state = 'ready'
   where o.id = p_org_id and o.deleted_at is null and app.is_org_member(o.id);
$$;

revoke execute on function public.organization_image_request_upload(uuid, text), public.organization_image_confirm_upload(text),
  public.organization_image_remove(uuid), public.organization_image_current(uuid) from public, anon;
grant execute on function public.organization_image_request_upload(uuid, text), public.organization_image_confirm_upload(text),
  public.organization_image_remove(uuid), public.organization_image_current(uuid) to authenticated;
