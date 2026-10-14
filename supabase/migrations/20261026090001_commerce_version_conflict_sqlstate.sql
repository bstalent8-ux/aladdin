-- B2: a stale expected_version on the commerce lifecycle RPCs is a BUSINESS conflict, not a
-- transient database failure, so it must not use SQLSTATE 40001 (serialization_failure).
--
-- Measured root cause (local, 2026-10-14): PostgREST v14 treats 40001 as retryable and re-runs the
-- RPC in a tight loop (~13,000 executions in 3 minutes, one every ~3 ms) until the gateway gives
-- up with 504 after 60 s. The database itself answers the stale call in under 1 ms. A retry can
-- never succeed here (the version is only ever read, never changed, by the failed attempt), so
-- the user waited a full minute for a deterministic refusal.
--
-- Fix: the SAME guards raise a dedicated application SQLSTATE, 'VC001' (version conflict; class 'VC'
-- is not used by PostgreSQL). PostgREST answers it immediately as HTTP 400 with the unchanged
-- message "<record> was modified concurrently", which the frontend already maps to the localized
-- conflict message. Nothing else changes: the guard condition, the lifecycle, authorization, audit
-- and every other statement in each function body are copied verbatim by rewriting the live
-- definition, so this migration cannot drift from the previous one.
--
-- Scope: RFQ, quotation, order and project transitions (the Direct RFQ -> Quotation -> Order chain).
-- Other domains that still raise 40001 for a stale version (leads, customers, follow-ups, products,
-- offers, shared purchase requests, publishers, jobs) share the exposure and are listed in
-- docs/operations/showroom-v2-b2-stale-conflict.md for a separate decision.

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_done int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('update_rfq', 'submit_rfq', 'update_quotation', 'submit_quotation',
                         'decide_quotation', 'start_order', 'activate_project', 'complete_project')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, 'errcode = ''40001''', 'errcode = ''VC001''');
    if v_new = v_def then
      raise exception 'B2: % has no 40001 guard to convert', r.proname;
    end if;
    execute v_new;
    v_done := v_done + 1;
  end loop;

  if v_done <> 8 then
    raise exception 'B2: expected to convert 8 functions, converted %', v_done;
  end if;
end;
$$;
