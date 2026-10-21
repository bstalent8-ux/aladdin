-- Acceptance only: run on nxossqhdfltcqdwvbewi AFTER migration 20261019100000 (creates NOLOGIN media_edge).
-- No password here. Set it afterwards from your own machine with psql: \password media_edge_worker
do $$ begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'media_edge') then
    raise exception 'media_edge group role missing: apply 20261019100000_media_edge_authorization first';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'media_edge_worker') then
    raise exception 'media_edge_worker already exists';
  end if;
end $$;
create role media_edge_worker
  login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls
  connection limit 20;
grant media_edge to media_edge_worker;                 -- EXECUTE on the media_edge_* functions only
alter role media_edge_worker set statement_timeout = '3s';
alter role media_edge_worker set idle_in_transaction_session_timeout = '5s';
alter role media_edge_worker set lock_timeout = '1s';
alter role media_edge_worker set default_transaction_read_only = on;   -- the edge functions never write
alter role media_edge_worker set search_path = '';
