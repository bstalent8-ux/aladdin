-- ===========================================================================
-- One shared unit-of-measure list for products and Purchase Requests
--
-- Finishing products and requests need more than the original six units
-- (kilogram, gallon, pail, roll, meter, sheet). The enum `product_unit` already
-- holds every code, so nothing is added to it and no existing code is
-- reinterpreted: `meter` stays `meter`, and `linear_meter` is a separate unit.
-- The list of units a showroom product / request item may use is now ONE
-- immutable function, referenced by the product validator, the request item
-- normalizer and the request-item CHECK, plus a reference table that carries
-- the grouping the UI uses for category-appropriate suggestions.
--
-- No conversion exists or is implied between units (a carton is not a number of
-- square metres); a response must use the unit that was requested.
-- ===========================================================================
create or replace function app.showroom_units()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['kilogram', 'gallon', 'pail', 'roll', 'meter', 'sheet',
               'piece', 'square_meter', 'linear_meter', 'liter', 'box', 'set']::text[];
$$;
revoke all on function app.showroom_units() from public;
grant execute on function app.showroom_units() to authenticated, service_role;

create table public.measurement_units (
  code       public.product_unit primary key,
  kind       text not null check (kind in ('count', 'package', 'length', 'area', 'volume', 'weight', 'roll_sheet')),
  sort_order smallint not null,
  is_original boolean not null default false
);
comment on table public.measurement_units is
  'The twelve units a showroom product or Purchase Request item may use (app.showroom_units()). kind groups them for category-appropriate suggestions in the UI; there is no conversion between units. is_original marks the first six, kept unchanged.';

insert into public.measurement_units (code, kind, sort_order, is_original) values
  ('kilogram',     'weight',     10, true),
  ('gallon',       'volume',     20, true),
  ('pail',         'package',    30, true),
  ('roll',         'roll_sheet', 40, true),
  ('meter',        'length',     50, true),
  ('sheet',        'roll_sheet', 60, true),
  ('piece',        'count',      70, false),
  ('square_meter', 'area',       80, false),
  ('linear_meter', 'length',     90, false),
  ('liter',        'volume',    100, false),
  ('box',          'package',   110, false),
  ('set',          'count',     120, false);

alter table public.measurement_units enable row level security;
create policy measurement_units_read on public.measurement_units for select to authenticated using (true);
revoke all on public.measurement_units from public, anon, authenticated, service_role;
grant select on public.measurement_units to authenticated;

-- The validators and the CHECK read the one function.
do $$
declare
  fn    record;
  v_def text;
begin
  for fn in
    select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
      from pg_proc p
     where p.pronamespace = 'app'::regnamespace
       and p.proname in ('own_product_validate', 'request_item_normalize')
  loop
    v_def := replace(fn.def, 'array[''kilogram'', ''gallon'', ''pail'', ''roll'', ''meter'', ''sheet'']', 'app.showroom_units()');
    if v_def = fn.def then
      raise exception 'function % does not contain the original six-unit list', fn.sig;
    end if;
    execute v_def;
  end loop;
end $$;

alter table public.purchase_request_items drop constraint ck_pri_unit;
alter table public.purchase_request_items
  add constraint ck_pri_unit check (unit::text = any (app.showroom_units()));
