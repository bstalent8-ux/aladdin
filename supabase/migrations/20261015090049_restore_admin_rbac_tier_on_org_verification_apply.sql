-- rc1: main's Admin RBAC (20260929100001) re-tiered public.apply_organization_verification from the legacy
-- `app.is_platform('support')` shim to the named permission `organizations.verify`. Showroom's
-- 20261015090028 re-created that function from a pre-RBAC copy and silently put the Support-level guard back
-- (Support/Moderator could apply an organization approval). This restores main's tier on the LIVE definition
-- (same exact-one-occurrence rewrite main used), so organization approval stays Administrator-level, and
-- delegation stays possible only through main's explicit, scoped admin roles.
do $$
declare
  v_def text := pg_get_functiondef('public.apply_organization_verification(uuid)'::regprocedure);
  v_old constant text := 'if not app.is_platform(''support'') then';
  v_new constant text := 'if not app.has_admin_permission(''organizations.verify'') then';
  v_n int := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
begin
  if v_n = 0 and position(v_new in v_def) > 0 then return; end if;   -- already restored: idempotent
  if v_n <> 1 then
    raise exception 'apply_organization_verification: expected exactly one legacy guard, found %', v_n;
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
