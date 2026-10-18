-- B2 (Option C): the remaining deterministic stale-version / stale-timestamp guards raise 'VC001'
-- instead of the retryable SQLSTATE 40001.
--
-- Why (measured, see 20261026090001 and docs/operations/showroom-v2-40001-audit.md): PostgREST treats
-- 40001 as retryable and re-runs the RPC until the 60 s gateway timeout. A stale version can never
-- succeed on retry, so the caller waited a minute for a refusal the database gave in under 1 ms, and
-- every stale click re-executed the function thousands of times.
--
-- Scope: exactly the 24 audited definitions. Each one raises 40001 from our own
-- `if version <> expected` / `updated_at <> expected` check, taken AFTER the row lock. No function in
-- the application sets SERIALIZABLE or REPEATABLE READ, so no genuine PostgreSQL serialization failure
-- is raised by these bodies; PostgreSQL's own 40001 is unaffected by this migration.
--
-- Each definition is rewritten from its live text (guard condition, row lock, authorization order,
-- audit, optional `p_expected_* is not null` behavior and every other statement stay byte-identical;
-- only the SQLSTATE literal changes) and the migration refuses to run unless every function matches
-- exactly once, so nothing is skipped and nothing else is touched. The message text ("... was modified
-- concurrently ...") is unchanged, so the frontend mappers keep working.

do $$
declare
  v_targets text[] := array[
    'app.purchase_request_transition',
    'public.assign_lead', 'public.transition_lead', 'public.update_lead_details', 'public.set_lead_source_branch',
    'public.update_customer', 'public.set_customer_ownership',
    'public.update_follow_up', 'public.reassign_follow_up',
    'public.update_product', 'public.own_product_update', 'public.own_product_set_archived', 'public.set_product_published',
    'public.own_offer_save', 'public.own_offer_set_status', 'public.publisher_offer_save',
    'public.purchase_request_save',
    'public.job_update', 'public.job_publish', 'public.job_close', 'public.job_cancel',
    'public.job_assignment_start', 'public.job_assignment_complete', 'public.job_assignment_cancel'
  ];
  r record;
  v_def text;
  v_new text;
  v_done int := 0;
begin
  for r in
    select p.oid, n.nspname || '.' || p.proname as fqn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.prokind = 'f'
       and n.nspname || '.' || p.proname = any (v_targets)
  loop
    v_def := pg_get_functiondef(r.oid);
    if (length(v_def) - length(replace(v_def, 'errcode = ''40001''', ''))) <> length('errcode = ''40001''') then
      raise exception 'B2: % must contain exactly one 40001 guard', r.fqn;
    end if;
    v_new := replace(v_def, 'errcode = ''40001''', 'errcode = ''VC001''');
    execute v_new;
    v_done := v_done + 1;
  end loop;

  if v_done <> array_length(v_targets, 1) then
    raise exception 'B2: expected to convert % functions, converted %', array_length(v_targets, 1), v_done;
  end if;

  -- nothing deterministic may be left behind
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prokind = 'f' and n.nspname in ('public', 'app')
       and pg_get_functiondef(p.oid) like '%40001%'
  ) then
    raise exception 'B2: a function in public/app still raises 40001';
  end if;
end;
$$;
