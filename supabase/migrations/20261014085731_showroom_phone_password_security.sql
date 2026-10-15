-- One durable limiter shared by both phone/password entry points. HMAC keys,
-- not phone numbers/IPs, enter storage. No client read/write/execute grants.
create table app.phone_auth_attempts (
  action text not null check (action in ('sign-in', 'sign-up')),
  subject text not null check (subject in ('ip', 'phone')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (action, subject, key_hash)
);
alter table app.phone_auth_attempts enable row level security;
revoke all on app.phone_auth_attempts from public, anon, authenticated, service_role;

create or replace function public.phone_auth_consume_limit(p_action text, p_ip_key text, p_phone_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_subject text;
  v_key text;
  v_count integer;
  v_limit integer;
  v_allowed boolean := true;
begin
  if p_action is null or p_action not in ('sign-in', 'sign-up')
     or p_ip_key is null or p_ip_key !~ '^[a-f0-9]{64}$'
     or p_phone_key is null or p_phone_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid throttle input' using errcode = '22023';
  end if;
  -- Bound retention; indexed window_start supports expiry without full scans.
  delete from app.phone_auth_attempts where window_start < v_now - interval '1 day';
  -- Always lock IP then phone. The UPSERT row lock serializes concurrent attempts
  -- across app replicas; a new IP cannot reset an account bucket.
  foreach v_subject in array array['ip', 'phone'] loop
    v_key := case when v_subject = 'ip' then p_ip_key else p_phone_key end;
    v_limit := case when p_action = 'sign-up' then case when v_subject = 'ip' then 10 else 5 end
                    else case when v_subject = 'ip' then 30 else 10 end end;
    insert into app.phone_auth_attempts as buckets (action, subject, key_hash, window_start, attempts)
      values (p_action, v_subject, v_key, v_now, 1)
    on conflict (action, subject, key_hash) do update set
      attempts = case when buckets.window_start <= v_now - interval '15 minutes' then 1
                      else least(buckets.attempts + 1, 1000000) end,
      window_start = case when buckets.window_start <= v_now - interval '15 minutes' then v_now
                          else buckets.window_start end
    returning attempts into v_count;
    if v_count > v_limit then
      -- An IP already over budget cannot grow storage by rotating phone keys.
      if v_subject = 'ip' then return false; end if;
      v_allowed := false;
    end if;
  end loop;
  return v_allowed;
end;
$$;
create index ix_phone_auth_attempts_expiry on app.phone_auth_attempts (window_start);
revoke all on function public.phone_auth_consume_limit(text, text, text) from public, anon, authenticated;
grant execute on function public.phone_auth_consume_limit(text, text, text) to service_role;

-- Argument-free identity authority: caller id comes only from auth.uid(). A
-- route choice, registration_source or editable user_metadata grants nothing.
create or replace function public.phone_password_account_allowed(p_kind text, p_phone text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select auth.uid()) is not null
    and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.phone_e164 = p_phone)
    and case p_kind
      when 'installer' then app.effective_persona((select auth.uid())) = 'installer_technician'::public.persona_type
      when 'showroom' then
        (app.mandatory_registration_business_type((select auth.uid())) = 'showroom_dealer'::public.organization_type
         and app.can_create_or_complete_business((select auth.uid())))
        or exists (select 1 from public.my_workspaces() w where w.kind = 'business' and w.org_type = 'showroom_dealer')
      else false end,
    false
  );
$$;
revoke all on function public.phone_password_account_allowed(text, text) from public, anon;
grant execute on function public.phone_password_account_allowed(text, text) to authenticated;

-- Internal aliases are stable login keys. Changing their profile phone without
-- verified identity re-keying would free the number for a different human while
-- the old credential still authenticates its original alias. Block at the DB,
-- including direct RPC/PostgREST writes, rather than only disabling the UI.
create or replace function app.guard_phone_password_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = new.user_id;
  if v_email ~ '^p[1-9][0-9]{6,14}@craftsman-login\.aladdin\.invalid$'
     and new.phone_e164 is distinct from ('+' || split_part(split_part(v_email, '@', 1), 'p', 2)) then
    raise exception 'phone identity changes require verified recovery' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_phone_password_identity() from public, anon, authenticated;
create trigger guard_phone_password_identity before update of phone_e164 on public.profiles
  for each row execute function app.guard_phone_password_identity();

notify pgrst, 'reload schema';

-- Registration compensation deletes its newly created identity. The existing
-- audit FK uses ON DELETE SET NULL, but the blanket no-update trigger rejects
-- that referential action after consent/phone audit events exist. Permit ONLY
-- the FK's nested actor-null transition for a user that has actually gone away;
-- keep the complete event and every other column immutable.
create or replace function app.guard_audit_actor_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1
     and old.actor_user_id is not null and new.actor_user_id is null
     and (to_jsonb(old) - 'actor_user_id') = (to_jsonb(new) - 'actor_user_id')
     and not exists (select 1 from public.users where id = old.actor_user_id) then
    return new;
  end if;
  raise exception 'audit_log is append-only (UPDATE forbidden)';
end;
$$;
revoke all on function app.guard_audit_actor_deletion() from public, anon, authenticated;
drop trigger audit_log_no_update on public.audit_log;
create trigger audit_log_no_update before update on public.audit_log
  for each row execute function app.guard_audit_actor_deletion();
