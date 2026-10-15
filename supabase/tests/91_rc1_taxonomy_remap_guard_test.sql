-- pgTAP: after the taxonomy migration the verification immutability guard is ON and the remap archive is closed to clients.
create extension if not exists pgtap;
begin;
select plan(4);
select is((select tgenabled::text from pg_trigger where tgrelid = 'public.verifications'::regclass and tgname = 'guard_verification_update'), 'O',
  'the verification immutability guard is enabled');
select has_table('app', 'taxonomy_remap_archive', 'the taxonomy remap archive exists');
select is((select relrowsecurity from pg_class where oid = 'app.taxonomy_remap_archive'::regclass), true, 'the archive has row level security on');
select is(has_table_privilege('authenticated', 'app.taxonomy_remap_archive', 'select'), false, 'clients cannot read the archive');
select * from finish();
rollback;
