-- Runs as the role's privilege set. Locally: connect AS media_edge_worker.
-- Hosted (SQL editor / connector, as postgres): first run  set role media_edge;  (same privileges, granted by the migration).
-- Each statement in a DO block must raise; any that succeeds prints FAIL.
do $t$
declare s text; ok int := 0; bad text := '';
begin
  foreach s in array array[
    'select count(*) from public.users', 'select count(*) from public.profiles',
    'select count(*) from public.organizations', 'select count(*) from public.memberships',
    'select count(*) from public.media_storage_locations', 'select count(*) from public.portfolio_items',
    'select count(*) from auth.users', 'select count(*) from auth.sessions', 'select count(*) from storage.objects',
    'update public.profiles set display_name = display_name', 'delete from public.audit_log',
    'select public.my_profile_completion()', 'select app.account_is_active(gen_random_uuid())', 'create table public.x_probe(i int)', 'create schema x_probe'
  ] loop
    begin execute s; bad := bad || ' | ' || s; exception when others then ok := ok + 1; end;
  end loop;
  raise notice 'denied % statements; allowed (FAIL if any):%', ok, coalesce(nullif(bad,''),' none');
end $t$;
-- The three authority functions answer (null/deny for a random viewer, no error):
select public.media_edge_public('portfolio', gen_random_uuid(), 'original') is null as public_denies_unknown,
       public.media_edge_authorize('portfolio', 'x.png', 'original', gen_random_uuid(), gen_random_uuid(), null, now() + interval '60 seconds') is null as private_denies_unknown,
       public.media_edge_video(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null, now() + interval '60 seconds') is null as video_denies_unknown;
