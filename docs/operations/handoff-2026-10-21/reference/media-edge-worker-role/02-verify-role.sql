-- Read-only privilege audit for media_edge_worker. Every row of the final check must say ok.
with r as (select oid from pg_roles where rolname = 'media_edge_worker'),
flags as (select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin, rolconnlimit from pg_roles where rolname='media_edge_worker'),
members as (select string_agg(g.rolname, ',' order by g.rolname) m from pg_auth_members am join pg_roles g on g.oid=am.roleid where am.member=(select oid from r)),
tbls as (select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','v','m','p','f') and n.nspname not in ('pg_catalog','information_schema')
    and has_schema_privilege('media_edge_worker', n.oid, 'USAGE')
    and has_table_privilege('media_edge_worker', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),
defs as (select coalesce(string_agg(n.nspname||'.'||p.proname, ', ' order by 1), '') l, count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
    and has_schema_privilege('media_edge_worker', n.oid, 'USAGE')
    and has_function_privilege('media_edge_worker', p.oid, 'EXECUTE'))
select 'no superuser/bypassrls/createrole/createdb/replication' chk,
       case when not (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication) then 'ok' else 'FAIL' end res from flags
union all select 'login, connection limit 20', case when rolcanlogin and rolconnlimit=20 then 'ok' else 'FAIL' end from flags
union all select 'member of media_edge only ('||coalesce(m,'')||')', case when m='media_edge' then 'ok' else 'FAIL' end from members
union all select 'table/view privileges outside catalogs: '||n, case when n=0 then 'ok' else 'FAIL' end from tbls
union all select 'security-definer functions it can run: '||l, case when l in ('public.media_edge_authorize, public.media_edge_public, public.media_edge_video') then 'ok' else 'FAIL' end from defs
union all select 'schemas with USAGE: '||string_agg(nspname, ',' order by nspname), case when string_agg(nspname, ',' order by nspname)='public' then 'ok' else 'FAIL' end
  from pg_namespace where nspname not like 'pg_%' and nspname<>'information_schema' and has_schema_privilege('media_edge_worker', oid, 'USAGE');
