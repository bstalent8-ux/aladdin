#!/usr/bin/env node
/** Generate a new forward metadata snapshot; never rewrite an applied migration. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "frontend/node_modules/libphonenumber-js/metadata.max.json");
const bytes = readFileSync(source);
const metadata = JSON.parse(bytes);
const version = JSON.parse(readFileSync(resolve(root, "frontend/node_modules/libphonenumber-js/package.json"))).version;
const license = readFileSync(resolve(root, "frontend/node_modules/libphonenumber-js/LICENSE"), "utf8");
if (metadata.version !== 4) throw new Error("Review changed phone metadata format before generating SQL");
const printOnly = process.argv[2] === "--stdout";
const target = printOnly ? null : resolve(process.argv[2] ?? "");
if (!printOnly && !target.startsWith(resolve(root, "supabase/migrations") + "/") && !target.startsWith(resolve(root, "supabase/migrations") + "\\")) throw new Error("Supply a new migration path inside this repository");
const quote = value => value == null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const rows = [];
for (const [country, data] of Object.entries(metadata.countries)) {
  const callingCode = data[0];
  const priority = metadata.country_calling_codes[callingCode].indexOf(country) + 1;
  if (!priority) throw new Error("Country missing calling-code order: " + country);
  const hasTypes = !!data[11] && data[11].length > 0;
  const types = (data[11] || []).filter(type => type?.[0]).map(type => ({ pattern: type[0], lengths: type[1] || data[3] }));
  rows.push(`(${quote(country)},${quote(callingCode)},${priority},${quote(data[10] || null)},${quote(data[2])},${hasTypes},${quote(JSON.stringify(types))}::jsonb)`);
}
const hash = createHash("sha256").update(bytes).digest("hex");
const sql = `-- Generated from libphonenumber-js ${version} metadata.max.json (MIT license).
-- SHA256 ${hash}; metadata format4; ${rows.length} countries.
-- Same national/type patterns and lengths as the application; no invented phone rules.
-- Regenerate into a NEW forward migration when the library changes; parity is tested.
/* Metadata license:
${license}
*/
set standard_conforming_strings = on;
create table app.business_phone_numbering_plans (
 country text primary key check(country ~ '^[A-Z]{2}$'), calling_code text not null,
 country_order integer not null, leading_pattern text, national_pattern text not null,
 has_types boolean not null, number_types jsonb not null,
 unique(calling_code,country_order)
);
alter table app.business_phone_numbering_plans enable row level security;
revoke all on app.business_phone_numbering_plans from public,anon,authenticated,service_role;
insert into app.business_phone_numbering_plans values
${rows.join(",\n")};
comment on table app.business_phone_numbering_plans is 'libphonenumber-js ${version} max metadata; SHA256 ${hash}; generated private read-only validation data, not contact verification.';

create function app.business_phone_matches_plan(p_national text,p_country text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_plan app.business_phone_numbering_plans; v_type jsonb;
begin
 select * into v_plan from app.business_phone_numbering_plans where country=p_country;
 if not found or p_national !~ ('^('||v_plan.national_pattern||')$') then return false; end if;
 if not v_plan.has_types then return true; end if;
 for v_type in select value from jsonb_array_elements(v_plan.number_types) loop
  if exists(select 1 from jsonb_array_elements_text(v_type->'lengths') n where n::integer=char_length(p_national))
   and p_national ~ ('^('||(v_type->>'pattern')||')$') then return true; end if;
 end loop;
 return false;
end;
$$;
revoke all on function app.business_phone_matches_plan(text,text) from public,anon,authenticated,service_role;

create function app.business_contact_phone_valid(p_phone text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_code text; v_national text; v_plan app.business_phone_numbering_plans; v_count integer;
begin
 if p_phone is null or char_length(p_phone)>16 or p_phone !~ '^\\+[1-9][0-9]{1,14}$' then return false; end if;
 select calling_code into v_code from app.business_phone_numbering_plans
 where substring(p_phone from 2 for char_length(calling_code))=calling_code order by char_length(calling_code) limit 1;
 if v_code is null then return false; end if;
 v_national:=substring(p_phone from char_length(v_code)+2);
 select count(*) into v_count from app.business_phone_numbering_plans where calling_code=v_code;
 for v_plan in select * from app.business_phone_numbering_plans where calling_code=v_code order by country_order loop
  -- Shared calling codes use the library's ordered leading-digit/type resolution.
  if v_count=1 then return app.business_phone_matches_plan(v_national,v_plan.country); end if;
  if v_plan.leading_pattern is not null then
   if v_national ~ ('^('||v_plan.leading_pattern||')') then return app.business_phone_matches_plan(v_national,v_plan.country); end if;
  elsif app.business_phone_matches_plan(v_national,v_plan.country) then return true;
  end if;
 end loop;
 return false;
end;
$$;
revoke all on function app.business_contact_phone_valid(text) from public,anon,authenticated,service_role;

create function app.business_contact_phone_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.contact_phone is not null and (tg_op='INSERT' or new.contact_phone is distinct from old.contact_phone)
 and not app.business_contact_phone_valid(new.contact_phone) then
  raise exception 'invalid business contact phone numbering pattern' using errcode='22023';
 end if;
 return new;
end;
$$;
revoke all on function app.business_contact_phone_guard() from public,anon,authenticated,service_role;
create trigger business_draft_phone_numbering before insert or update of contact_phone on public.business_creation_drafts for each row execute function app.business_contact_phone_guard();
create trigger organization_phone_numbering before insert or update of contact_phone on public.organizations for each row execute function app.business_contact_phone_guard();
`;
// CLI-created scaffolds can receive reviewed --stdout output through ordinary
// editing; the generator itself must never overwrite an existing migration.
if (printOnly) process.stdout.write(sql);
else {
 writeFileSync(target, sql, { flag: "wx" });
 console.log(`Generated ${rows.length} country plans; libphonenumber-js ${version}; SHA256 ${hash}`);
}
