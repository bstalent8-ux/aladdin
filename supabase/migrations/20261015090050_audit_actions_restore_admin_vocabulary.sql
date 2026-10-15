-- rc1 (Finding B): restore the Admin audit vocabulary.
--
-- Several Showroom migrations rewrite `ck_audit_action_known` from a LITERAL list written before main's Admin migrations
-- (20260929100001, 20260930100001, 20260930100006). Applied after main they silently DROP 22 Admin actions (suspend /
-- restore account and organization, admin roles, cases, notes, follow-ups, duplicate handling). The next Admin operation
-- would then fail with 23514. This migration is idempotent: it re-adds exactly those actions to whatever list is current,
-- never removes one, and fails loudly if the constraint has an unexpected shape.
do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array[
    'account.platform_cleanup','account.platform_prepared','account.restored','account.suspended',
    'admin_case.created','admin_follow_up.completed','admin_follow_up.logged','admin_note.created',
    'admin_role.archived','admin_role.assigned','admin_role.assignment_changed','admin_role.created',
    'admin_role.permissions_changed','admin_role.restored','admin_role.unassigned','admin_role.updated',
    'admin_staff.disabled','admin_staff.restored',
    'organization.duplicate_dismissed','organization.duplicate_linked','organization.restored','organization.suspended'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)$' then
    raise exception 'ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) = 0 then return; end if;
  alter table public.audit_log drop constraint ck_audit_action_known;
  execute 'alter table public.audit_log add constraint ck_audit_action_known '
    || regexp_replace(v_def, '\]\)\)\)$',
         (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a));
end $$;
