-- rc1: for THIS release the start and the final approval of an ORGANIZATION application are Administrator-only.
-- main's Admin RBAC lets any holder of `organizations.verify` (Moderator included) review organizations. That stays true for every
-- other review type; for an organization subject a platform Administrator is now also required. Delegated organization approval
-- comes back only through a separately approved, scoped delegation (decision D-A1) by removing this one extra condition.
-- Rewrites the LIVE guard in review_start / review_approve (exactly one occurrence each), like main's own re-tier.
create or replace function app.org_review_requires_administrator(p_verification_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.verifications v
                  where v.id = p_verification_id and v.subject_type = 'organization')
     and not app.is_platform('administrator');
$$;
revoke all on function app.org_review_requires_administrator(uuid) from public, anon, authenticated, service_role;

do $$
declare
  v_fn regprocedure;
  v_def text;
  v_old constant text := 'if not app.can_review_verification(p_verification_id) then';
  v_new constant text := 'if not app.can_review_verification(p_verification_id) or app.org_review_requires_administrator(p_verification_id) then';
  v_n int;
begin
  foreach v_fn in array array['public.review_start(uuid)'::regprocedure, 'public.review_approve(uuid,boolean)'::regprocedure] loop
    v_def := pg_get_functiondef(v_fn);
    if position(v_new in v_def) > 0 then continue; end if;   -- idempotent
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_n <> 1 then raise exception '%: expected exactly one RBAC guard, found %', v_fn, v_n; end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $$;
