-- pgTAP: deterministic version conflicts use VC001, never the retryable 40001 (20261015090045, 20261015090048).
-- Claims:
--   * REGRESSION GUARD: no function in public/app raises SQLSTATE 40001. PostgREST re-runs a 40001 until
--     the gateway timeout (measured: 13,143 re-executions in 3 minutes, a 504 after 60 s), so a stale-version
--     check must never use it. A new deterministic guard that reintroduces 40001 fails this file.
--   * Every audited stale-version / stale-timestamp guard (the 8 commerce functions of B2 and the 24 of
--     Option C) raises VC001 exactly once and is still a real guard (`<>` comparison, not removed).
--   * Behavior, as the job poster: a stale version is refused at once with VC001 on job_publish, job_update,
--     job_close and job_cancel, and the job is unchanged. (Products, offers, leads, customers, follow-ups and
--     purchase requests are asserted in their own suites: 15, 18, 19, 23, 24, 69, 70, 73.)
create extension if not exists pgtap;

begin;
select plan(11);

-- A. Guard.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname in ('public', 'app') and pg_get_functiondef(p.oid) like '%40001%'),
  0, 'no function in public/app raises SQLSTATE 40001');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname || '.' || p.proname = any (array[
        'public.update_rfq', 'public.submit_rfq', 'public.update_quotation', 'public.submit_quotation',
        'public.decide_quotation', 'public.start_order', 'public.activate_project', 'public.complete_project',
        'app.purchase_request_transition',
        'public.assign_lead', 'public.transition_lead', 'public.update_lead_details', 'public.set_lead_source_branch',
        'public.update_customer', 'public.set_customer_ownership',
        'public.update_follow_up', 'public.reassign_follow_up',
        'public.update_product', 'public.own_product_update', 'public.own_product_set_archived', 'public.set_product_published',
        'public.own_offer_save', 'public.own_offer_set_status', 'public.publisher_offer_save',
        'public.purchase_request_save',
        'public.job_update', 'public.job_publish', 'public.job_close', 'public.job_cancel',
        'public.job_assignment_start', 'public.job_assignment_complete', 'public.job_assignment_cancel'])
      and pg_get_functiondef(p.oid) like '%errcode = ''VC001''%'
      and (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'errcode = ''VC001''', '')))
          = length('errcode = ''VC001''')),
  32, 'all 32 audited stale-version guards (8 commerce + 24 remaining) raise VC001 exactly once');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname || '.' || p.proname in (
        'public.update_customer', 'public.set_customer_ownership', 'public.update_follow_up', 'public.reassign_follow_up')
      and pg_get_functiondef(p.oid) ~ 'p_expected_(version|updated_at) is not null and'),
  4, 'the optional expected-version / expected-timestamp behavior is preserved (guard only when a token is supplied)');

-- B. Behavior as the poster of the two seeded jobs (draft f1000002, open f1000001).
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok($$select public.job_publish('f1000002-0000-4000-8000-000000000002', 99)$$,
  'VC001', null, 'a stale job_publish is a version conflict');
select throws_ok($$select public.job_update('f1000002-0000-4000-8000-000000000002', 99, 'Stale edit', 'wallpaper_installation', 100)$$,
  'VC001', null, 'a stale job_update is a version conflict');
select throws_ok($$select public.job_close('f1000001-0000-4000-8000-000000000001', 99)$$,
  'VC001', null, 'a stale job_close is a version conflict');
select throws_ok($$select public.job_cancel('f1000001-0000-4000-8000-000000000001', 99, 'Stale cancel')$$,
  'VC001', null, 'a stale job_cancel is a version conflict');

reset role;
select is((select status::text || ':' || version::text from public.jobs where id = 'f1000002-0000-4000-8000-000000000002'),
  'draft:1', 'the stale publish / update changed nothing');
select is((select status::text || ':' || version::text from public.jobs where id = 'f1000001-0000-4000-8000-000000000001'),
  'open:1', 'the stale close / cancel changed nothing');

-- the current version still works (the guard is a guard, not a wall)
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok($$select public.job_close('f1000001-0000-4000-8000-000000000001', 1)$$,
  'the same call with the current version succeeds');
reset role;
select is((select count(*)::int from public.audit_log where subject_id = 'f1000001-0000-4000-8000-000000000001' and action = 'job.closed'),
  1, 'exactly one audit row for the one successful close');

select * from finish();
rollback;
