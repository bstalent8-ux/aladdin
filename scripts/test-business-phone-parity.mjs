#!/usr/bin/env node
/** Read-only database parity check against the application's actual pinned library. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parsePhoneNumberFromString, getExampleNumber } = require("libphonenumber-js/max");
const examples = require("libphonenumber-js/examples.mobile.json");
const metadata = require("libphonenumber-js/metadata.max.json");
const args = process.argv.slice(2);
const container = args[args.indexOf("--container") + 1], database = args[args.indexOf("--database") + 1];
if (!args.includes("--container") || !args.includes("--database") || !/^supabase_db_[a-z0-9_]+$/.test(container) || !/^[a-z0-9_]+$/.test(database)) throw new Error("Pass explicit local --container and --database");
const cases = new Map();
function add(number) {
 const parsed = parsePhoneNumberFromString(number);
 cases.set(number, /^\+[1-9][0-9]{1,14}$/.test(number) && !!parsed?.country && parsed.isValid() && parsed.number === number);
}
let state = 84;
const digit = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return String(state % 10); };
for (const [country, plan] of Object.entries(metadata.countries)) {
 const sample = getExampleNumber(country, examples);
 if (sample) {
  add(sample.number); add(sample.number + "0"); add(sample.number.slice(0, -1));
  add("+" + plan[0] + "0" + sample.nationalNumber);
  for (let position = plan[0].length + 1; position < sample.number.length; position++) add(sample.number.slice(0, position) + digit() + sample.number.slice(position + 1));
 }
 for (const length of plan[3]) for (let i = 0; i < 10; i++) add("+" + plan[0] + Array.from({length}, digit).join(""));
}
for (const value of ["+201399999999", "+2001012345678", "+201012345678", "+14155552671", "+18005551234", "+442079460000", "+919876543210", "+971501234567", "+33612345678", "+39066982", "+999123456789", "+80012345678", "+201012345678\n", "01012345678", "", "+" + "1".repeat(100)]) add(value);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const rows = [...cases].map(([phone, expected]) => `(${quote(phone)},${expected})`);
const hash = createHash("sha256").update(readFileSync(require.resolve("libphonenumber-js/metadata.max.json"))).digest("hex");
const sql = `select (obj_description('app.business_phone_numbering_plans'::regclass) like '%SHA256 ${hash}%')::text;
with fixtures(phone,expected) as (values ${rows.join(",")}) select coalesce(json_agg(json_build_object('phone',phone,'expected',expected,'database',actual)),'[]'::json)::text from (select phone,expected,app.business_contact_phone_valid(phone) actual from fixtures) checks where expected<>actual;`;
const output = execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-qAt"], {input:sql, encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024}).trim().split("\n");
const mismatches = JSON.parse(output[1]);
console.log(`Phone parity: ${cases.size} cases across ${Object.keys(metadata.countries).length} countries; metadata hash matches=${output[0]}; mismatches=${mismatches.length}`);
if(output[0]!=="true" || mismatches.length){ console.log(JSON.stringify(mismatches.slice(0,10))); process.exitCode=1; }
