-- ===========================================================================
-- Canonical account taxonomy (nine public accounts) + retired-value cleanup
--
-- The approved public accounts are Showroom, Supplier, Manufacturer, Importer,
-- Contractor, Engineer, Craftsman, Sales Team and Personal. Business subtypes
-- live in public.activities (already seeded: Showroom 4, Supplier 2,
-- Manufacturer 2, Importer 2, Engineer 1) and the Craftsman specialties in
-- public.trades (14 active, multi-select through user_trades).
--
-- This migration:
--   1. remaps TEST rows that carry a retired value:
--        interior_designer -> engineer   (the only engineer-related account)
--        wholesaler (org)  -> supplier + the `wholesaler` supplier subtype
--        trainer / trainee -> no value (never had an approved mapping)
--   2. rebuilds the two enums WITHOUT the retired labels (Postgres cannot drop
--      a label in place):
--        persona_type      : end_consumer, engineer, installer_technician,
--                            contractor, sales
--        organization_type : showroom_dealer, supplier, manufacturer, importer,
--                            contractor_company, design_office
--      `contractor_company` and `design_office` stay as the INTERNAL business
--      identifiers behind the public Contractor and Engineer accounts; neither
--      is a public registration choice and neither adds a tenth account.
--   3. restricts the business registration track to the approved business
--      types, and
--   4. enforces subtype integrity in the database (an activity can only be
--      attached to an organization / person of the type it belongs to).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Data remap (test accounts)
-- ---------------------------------------------------------------------------
-- APPROVED PRODUCT DECISION (2026-10-15): Interior Designer is consolidated into Engineer; Trainer / Trainee are cleared.
-- Before any row changes, the ORIGINAL classification and the affected record identifiers are archived (service-role / owner only)
-- so the change stays auditable and reversible. Nothing is approved, activated or granted by this remap: only the account-type
-- value changes; status, reviewer, timestamps, reasons and permissions are untouched.
create table if not exists app.taxonomy_remap_archive (
  id           bigint generated always as identity primary key,
  archived_at  timestamptz not null default now(),
  source_table text not null,
  source_id    text not null,
  source_column text not null,
  original_value text not null,
  new_value    text
);
alter table app.taxonomy_remap_archive enable row level security;
revoke all on app.taxonomy_remap_archive from public, anon, authenticated, service_role;
insert into app.taxonomy_remap_archive (source_table, source_id, source_column, original_value, new_value)
select 'public.users', id::text, 'primary_account_type', primary_account_type::text,
       case when primary_account_type::text = 'interior_designer' then 'engineer' end
  from public.users where primary_account_type::text in ('interior_designer','trainer','trainee')
union all
select 'public.individual_onboarding', user_id::text, 'prof_concrete_type', prof_concrete_type::text,
       case when prof_concrete_type::text = 'interior_designer' then 'engineer' end
  from public.individual_onboarding where prof_concrete_type::text in ('interior_designer','trainer','trainee')
union all
select 'public.onboarding_progress', user_id::text, 'selected_persona', selected_persona::text,
       case when selected_persona::text = 'interior_designer' then 'engineer' end
  from public.onboarding_progress where selected_persona::text in ('interior_designer','trainer','trainee')
union all
select 'public.verifications', id::text, 'requested_account_type', requested_account_type::text,
       case when requested_account_type::text = 'interior_designer' then 'engineer' end
  from public.verifications where requested_account_type::text in ('interior_designer','trainer','trainee');

update public.users set primary_account_type = 'engineer'
 where primary_account_type::text = 'interior_designer';
update public.users set primary_account_type = null
 where primary_account_type::text in ('trainer', 'trainee');

update public.individual_onboarding set prof_concrete_type = 'engineer'
 where prof_concrete_type::text = 'interior_designer';
update public.individual_onboarding set prof_concrete_type = null
 where prof_concrete_type::text in ('trainer', 'trainee');

update public.onboarding_progress set selected_persona = 'engineer'
 where selected_persona::text = 'interior_designer';
update public.onboarding_progress set selected_persona = null
 where selected_persona::text in ('trainer', 'trainee');
-- The verification immutability guard (app.guard_verification_update) forbids changing requested_account_type on a submitted request.
-- It is suspended for EXACTLY the verifications remap below, inside this migration's transaction, then re-enabled; a DO block
-- after it fails the whole migration if the guard is not back on.
alter table public.verifications disable trigger guard_verification_update;
update public.verifications set requested_account_type = 'engineer'
 where requested_account_type::text = 'interior_designer';
update public.verifications set requested_account_type = null
 where requested_account_type::text in ('trainer', 'trainee');
alter table public.verifications enable trigger guard_verification_update;
do $$ begin
  if (select tgenabled from pg_trigger where tgrelid = 'public.verifications'::regclass and tgname = 'guard_verification_update') is distinct from 'O' then
    raise exception 'guard_verification_update is not enabled again';
  end if;
end $$;

-- A wholesaler is a SUPPLIER subtype. Organizations were remapped earlier
-- (20260924090004); this is a no-op on a database where that already ran, and a
-- safety net on any row that slipped in since.
insert into public.organization_activities (organization_id, activity_id)
select o.id, a.id
  from public.organizations o
  join public.activities a on a.organization_type = 'supplier' and a.key = 'wholesaler'
 where o.org_type::text = 'wholesaler'
on conflict do nothing;
update public.organizations set org_type = 'supplier' where org_type::text = 'wholesaler';
update public.onboarding_progress set selected_org_type = 'supplier' where selected_org_type::text = 'wholesaler';
update public.business_onboarding set org_type = 'supplier' where org_type::text = 'wholesaler';
update public.business_creation_drafts set org_type = 'supplier' where org_type::text = 'wholesaler';
update public.organization_referrals set org_type = 'supplier' where org_type::text = 'wholesaler';

-- Subtype rows scoped to a retired value have nothing left to describe.
delete from public.activities
 where persona_type::text in ('interior_designer', 'trainer', 'trainee')
    or organization_type::text = 'wholesaler';

-- ---------------------------------------------------------------------------
-- 2. Enum rebuild
-- ---------------------------------------------------------------------------
create temporary table _tax_fn (
  ord       int generated always as identity,
  sig       text not null,
  def       text not null,
  acl       aclitem[],
  descr     text
);

create temporary table _tax_view (
  ord     int generated always as identity,
  name    text not null,
  def     text not null,
  opts    text[],
  acl     aclitem[],
  descr   text
);

create temporary table _tax_check (
  rel  text not null,
  name text not null,
  def  text not null
);

create temporary table _tax_default (
  rel  text not null,
  col  text not null,
  expr text not null
);

do $$
declare
  fn  record;
  col record;
  v_ck text;
begin
  -- 2a. Functions whose signature mentions either enum are dropped and
  --     re-created after the swap (their bodies are re-created with the retired
  --     labels removed).
  -- Functions whose arguments, OUT columns or result mention either enum.
  create temporary table _tax_fn_oid as
    select p.oid as oid
      from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
       and (p.proargtypes::oid[] && array['public.organization_type'::regtype::oid, 'public.persona_type'::regtype::oid]
            or coalesce(p.proallargtypes, '{}'::oid[]) && array['public.organization_type'::regtype::oid, 'public.persona_type'::regtype::oid]
            or p.prorettype in ('public.organization_type'::regtype, 'public.persona_type'::regtype));

  -- Views that select through those functions (transitively), captured in
  -- dependency order so they can be re-created in the same order.
  loop
    insert into _tax_view (name, def, opts, acl, descr)
    select v.oid::regclass::text, pg_get_viewdef(v.oid), v.reloptions, v.relacl, obj_description(v.oid, 'pg_class')
      from (
        select distinct rw.ev_class as oid
          from pg_depend d
          join pg_rewrite rw on rw.oid = d.objid and d.classid = 'pg_rewrite'::regclass
         where (d.refclassid = 'pg_proc'::regclass and d.refobjid in (select oid from _tax_fn_oid))
            or (d.refclassid = 'pg_class'::regclass and d.refobjid in (select c.oid from pg_class c join _tax_view tv on tv.name = c.oid::regclass::text))
      ) x
      join pg_class v on v.oid = x.oid and v.relkind = 'v'
     where v.oid::regclass::text not in (select name from _tax_view);
    exit when not found;
  end loop;

  for fn in select name from _tax_view order by ord desc loop
    execute format('drop view %s', fn.name);
  end loop;

  for fn in
    select p.oid, p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def,
           p.proacl, obj_description(p.oid, 'pg_proc') as descr
      from pg_proc p where p.oid in (select oid from _tax_fn_oid)
  loop
    insert into _tax_fn (sig, def, acl, descr) values (fn.sig, fn.def, fn.proacl, fn.descr);
    execute format('drop function %s', fn.sig);
  end loop;

  -- 2b. CHECK constraints over an affected column keep a cast bound to the OLD
  --     type, so they are dropped and re-created from their text afterwards
  --     (the names then resolve to the new types; a retired label is removed).
  for col in
    select distinct c.conrelid::regclass::text as rel, c.conname as name, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'c' and c.connamespace = 'public'::regnamespace
       and a.atttypid in ('public.organization_type'::regtype, 'public.persona_type'::regtype)
       and not a.attisdropped
  loop
    insert into _tax_check values (col.rel, col.name, col.def);
    execute format('alter table %s drop constraint %I', col.rel, col.name);
  end loop;

  -- 2c. Defaults typed with the old enum cannot be cast automatically.
  for col in
    select c.oid::regclass::text as rel, a.attname as col, pg_get_expr(d.adbin, d.adrelid) as expr
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.atttypid in ('public.organization_type'::regtype, 'public.persona_type'::regtype) and not a.attisdropped
  loop
    insert into _tax_default values (col.rel, col.col, col.expr);
    execute format('alter table %s alter column %I drop default', col.rel, col.col);
  end loop;

  -- 2d. Swap the types.
  alter type public.persona_type rename to persona_type_old;
  create type public.persona_type as enum ('end_consumer', 'engineer', 'installer_technician', 'contractor', 'sales');
  alter type public.organization_type rename to organization_type_old;
  create type public.organization_type as enum ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'contractor_company', 'design_office');

  for col in
    select c.oid::regclass::text as rel, a.attname as col, t.typname as tname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      join pg_type t on t.oid = a.atttypid
     where t.typname in ('persona_type_old', 'organization_type_old') and not a.attisdropped
  loop
    execute format('alter table %s alter column %I type public.%I using %I::text::public.%I',
                   col.rel, col.col, replace(col.tname, '_old', ''), col.col, replace(col.tname, '_old', ''));
  end loop;

  for col in select * from _tax_default loop
    execute format('alter table %s alter column %I set default %s', col.rel, col.col, col.expr);
  end loop;

  drop type public.persona_type_old;
  drop type public.organization_type_old;

  for col in select * from _tax_check loop
    v_ck := col.def;
    v_ck := replace(v_ck, '''interior_designer''::persona_type_old, ', '');
    v_ck := replace(v_ck, '''interior_designer''::persona_type, ', '');
    v_ck := replace(v_ck, ', ''interior_designer''::persona_type', '');
    if v_ck ~ '(interior_designer|trainer|trainee|wholesaler|_old)' then
      raise exception 'constraint % on % still names a retired value: %', col.name, col.rel, v_ck;
    end if;
    execute format('alter table %s add constraint %I %s', col.rel, col.name, v_ck);
  end loop;
end $$;

-- 2e. Re-create the dropped functions. Retired labels are removed from the
--     literal lists; the business registration track gets an explicit
--     allow-list (below); everything else is byte-for-byte what was live.
do $$
declare
  fn    record;
  v_def text;
  g     record;
begin
  for fn in select * from _tax_fn order by ord loop
    v_def := fn.def;
    v_def := replace(v_def, '''interior_designer'', ', '');
    v_def := replace(v_def, ', ''interior_designer''', '');
    v_def := replace(v_def, '''interior_designer'',' || E'\n', E'\n');
    if fn.sig like 'onboarding_select_account_type%' then
      v_def := replace(
        v_def,
        'unnest(enum_range(null::public.organization_type)) e',
        'unnest(array[''showroom_dealer'', ''supplier'', ''manufacturer'', ''importer'', ''design_office'']::public.organization_type[]) e'
      );
    end if;
    if v_def ~ '''(interior_designer|trainer|trainee|wholesaler)''' then
      raise exception 'function % still names a retired account value', fn.sig;
    end if;
    execute v_def;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn.sig);
    for g in
      select (aclexplode(fn.acl)).grantee as grantee, (aclexplode(fn.acl)).privilege_type as priv
    loop
      if g.grantee <> 0 and g.priv = 'EXECUTE' then
        execute format('grant execute on function %s to %I', fn.sig, (select rolname from pg_roles where oid = g.grantee));
      end if;
    end loop;
    if fn.descr is not null then
      execute format('comment on function %s is %L', fn.sig, fn.descr);
    end if;
  end loop;
end $$;

-- 2e-bis. Functions that do NOT mention an enum in their signature but compare
--     against a retired label inside the body (plpgsql / sql bodies are bound
--     lazily, so they would fail at first call). CREATE OR REPLACE keeps their
--     grants and comments.
do $$
declare
  fn    record;
  v_def text;
begin
  for fn in
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
      from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
       and p.prokind = 'f'
       and p.prosrc ~ '''(interior_designer|trainer|trainee|wholesaler)'''
  loop
    v_def := fn.def;
    v_def := replace(v_def, '''interior_designer'', ', '');
    v_def := replace(v_def, ', ''interior_designer''', '');
    v_def := replace(v_def, '''interior_designer'',' || E'
', E'
');
    if fn.sig like 'onboarding_select_account_type%' then
      v_def := replace(
        v_def,
        'unnest(enum_range(null::public.organization_type)) e',
        'unnest(array[''showroom_dealer'', ''supplier'', ''manufacturer'', ''importer'', ''design_office'']::public.organization_type[]) e'
      );
    end if;
    if v_def ~ '''(interior_designer|trainer|trainee|wholesaler)''' then
      raise exception 'function % still names a retired account value', fn.sig;
    end if;
    execute v_def;
  end loop;
end $$;

-- 2f. Re-create the views that select through those functions.
do $$
declare
  vw record;
  g  record;
begin
  for vw in select * from _tax_view order by ord loop
    execute format('create view %s %s as %s', vw.name,
                   case when vw.opts is null then '' else 'with (' || array_to_string(vw.opts, ', ') || ')' end,
                   vw.def);
    execute format('revoke all on %s from public, anon, authenticated, service_role', vw.name);
    for g in
      select (aclexplode(vw.acl)).grantee as grantee, (aclexplode(vw.acl)).privilege_type as priv
    loop
      if g.grantee <> 0 and (select rolname from pg_roles where oid = g.grantee) not in ('postgres') then
        execute format('grant %s on %s to %I', g.priv, vw.name, (select rolname from pg_roles where oid = g.grantee));
      end if;
    end loop;
    if vw.descr is not null then
      execute format('comment on view %s is %L', vw.name, vw.descr);
    end if;
  end loop;
end $$;

drop table _tax_fn_oid, _tax_fn, _tax_view, _tax_check, _tax_default;

-- ---------------------------------------------------------------------------
-- 3. Subtype integrity (server-side, not only in the RPCs)
-- ---------------------------------------------------------------------------
create or replace function app.guard_organization_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.organizations o
      join public.activities a on a.id = new.activity_id
     where o.id = new.organization_id
       and a.organization_type = o.org_type
  ) then
    raise exception 'this subtype does not belong to the organization''s account type'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_organization_activity() from public;

create trigger organization_activities_type_guard
  before insert or update on public.organization_activities
  for each row execute function app.guard_organization_activity();

create or replace function app.guard_user_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.activities a
     where a.id = new.activity_id
       and a.persona_type is not null
       and a.persona_type = app.effective_persona(new.user_id)
  ) then
    raise exception 'this specialization does not belong to the person''s account type'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_user_activity() from public;

create trigger user_activities_type_guard
  before insert or update on public.user_activities
  for each row execute function app.guard_user_activity();

-- An organization cannot change type while it holds subtypes of the old one.
create or replace function app.guard_organization_type_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_type is distinct from old.org_type and exists (
    select 1
      from public.organization_activities oa
      join public.activities a on a.id = oa.activity_id
     where oa.organization_id = old.id
       and a.organization_type is distinct from new.org_type
  ) then
    raise exception 'remove the organization''s subtypes before changing its account type'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_organization_type_change() from public;

create trigger organizations_type_change_guard
  before update of org_type on public.organizations
  for each row execute function app.guard_organization_type_change();

comment on table public.activities is
  'Business subtypes and specializations of the nine public accounts: Showroom (4), Supplier (2, incl. wholesaler), Manufacturer (2), Importer (2), Engineer (1 - finishing), plus the Sales Team staff roles. Attached to an organization / person only when the activity belongs to its type (triggers organization_activities_type_guard / user_activities_type_guard).';
