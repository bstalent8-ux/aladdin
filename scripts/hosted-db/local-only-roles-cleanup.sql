-- Restore step, LOCAL rehearsal stack only (run as supabase_admin with -v prod_roles='a,b,...').
-- The security tail revokes and re-grants privileges for every role that exists on Production. A role the local
-- Supabase image creates but Production does not have is not in that list, so the grants and default privileges
-- the image gives it survive the restore and make the ACL fingerprints differ from Production's. This strips that
-- role's privileges on public/app objects and its default privileges, and prints what it removed (names only).
create temp table _prod_roles as select unnest(string_to_array(:'prod_roles', ',')) r;
create temp table _local_only as
  select rolname from pg_roles
  where rolname !~ '^pg_' and rolname !~ '^cli_login_' and rolname <> 'supabase_admin' and rolname not in (select r from _prod_roles);
select format('local-only role %s: %s table/sequence, %s column, %s function, %s default privilege entries', l.rolname,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
     where n.nspname in ('public','app') and a.grantee = r.oid),
  (select count(*) from pg_attribute t join pg_class c on c.oid = t.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(t.attacl) a
     where n.nspname in ('public','app') and a.grantee = r.oid),
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
     where n.nspname in ('public','app') and a.grantee = r.oid),
  (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a where a.grantee = r.oid))
from _local_only l join pg_roles r on r.rolname = l.rolname order by 1;
do $$
declare x record; d record; kind text;
begin
  for x in select rolname from _local_only loop
    execute format('revoke all on all tables in schema public, app from %I', x.rolname);
    execute format('revoke all on all sequences in schema public, app from %I', x.rolname);
    execute format('revoke all on all functions in schema public, app from %I', x.rolname);
    for d in select pg_get_userbyid(da.defaclrole) owner, n.nspname, da.defaclobjtype t
             from pg_default_acl da left join pg_namespace n on n.oid = da.defaclnamespace, aclexplode(da.defaclacl) a
             where a.grantee = (select oid from pg_roles where rolname = x.rolname) loop
      kind := case d.t when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end;
      execute format('alter default privileges for role %I %s revoke all on %s from %I', d.owner,
        case when d.nspname is null then '' else format('in schema %I', d.nspname) end, kind, x.rolname);
    end loop;
  end loop;
end $$;
