import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERDICTS, main, poolerConfigPath, probe, render } from "./supabase-pooler-api-diagnostic.mjs";

const REF = "abcdefghijklmnopqrst";
// Secret-shaped values are assembled at run time so no token-shaped literal sits in the repository.
const TOKEN = ["sbp", "_", "0123456789", "abcdef0123456789abcdef01234567"].join("");
const PW = "hunter2-fixture-pw";
const HOST = "aws-0-eu-west-3.pooler.supabase.com";
const USER = `postgres.${REF}`;
const CONN = `postgresql://${USER}:${PW}@${HOST}:6543/postgres`;
const ORG = "org-fixture-identifier-12345";

const primary = (over = {}) => ({ identifier: ORG, database_type: "PRIMARY", db_user: USER, db_host: HOST, db_port: 6543, db_name: "postgres", connection_string: CONN, pool_mode: "transaction", ...over });
const json = (status, body) => ({ status, json: async () => body, text: async () => JSON.stringify(body) });
const calls = [];
const respond = (status, body) => async (url, init) => {
  calls.push({ url, init });
  return json(status, body);
};

/** Everything a diagnostic must never contain. */
function assertNoLeak(text) {
  for (const leaked of [TOKEN, "Bearer", "Authorization", "authorization", PW, HOST, "aws-0-eu-west-3", "pooler.supabase.com", USER, CONN, "postgresql://", ORG, "6543", "api.supabase.com"]) {
    assert.ok(!text.includes(leaked), `leaked: ${leaked}`);
  }
}
const run = async (fetchImpl, env = { SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF }) => {
  const logs = [];
  const code = await main([], { env, fetchImpl, log: (l) => logs.push(l), summaryFile: undefined });
  return { code, text: logs.join("\n") };
};

test("the request is the CLI's: GET /v1/projects/<ref>/config/database/pooler with a Bearer token (verified against the v2.110.0 fixture)", async () => {
  calls.length = 0;
  await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, [primary()]) });
  assert.equal(calls.length, 1, "exactly one request");
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${REF}/config/database/pooler`);
  assert.equal(poolerConfigPath(REF), `/v1/projects/${REF}/config/database/pooler`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(calls[0].init.signal, "a timeout signal is set");
  assert.equal(calls[0].init.body, undefined, "no request body: read only");
});

test("1-5: token, Authorization header, raw response, connection string and host/user/password are never printed", async () => {
  const noisy = [primary({ extra: { token: TOKEN, note: "server supplied text that must not appear" } }), { database_type: "READ_REPLICA", connection_string: CONN, identifier: ORG }];
  const { code, text } = await run(respond(200, noisy));
  assert.equal(code, 0);
  assertNoLeak(text);
  assert.ok(!text.includes("server supplied text"));
});

test("6: HTTP 200 with a PRIMARY config -> looks_valid, with only booleans / counts / the pool mode", async () => {
  const facts = await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, [primary(), primary({ database_type: "READ_REPLICA" })]) });
  assert.deepEqual(facts, {
    pooler_api_request_completed: true,
    pooler_api_http_status: 200,
    pooler_api_success_status: true,
    pooler_api_json_parseable: true,
    pooler_api_entry_count: 2,
    pooler_api_primary_found: true,
    pooler_api_primary_connection_string_present: true,
    pooler_api_primary_pool_mode: "transaction",
    pooler_api_verdict: "looks_valid",
  });
  assert.equal((await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, [primary({ pool_mode: "session" })]) })).pooler_api_primary_pool_mode, "session");
  assert.equal((await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, [primary({ pool_mode: "weird server text" })]) })).pooler_api_primary_pool_mode, "unknown", "a server string is never echoed");
});

test("7: HTTP 200 with no PRIMARY (empty array, or only replicas) -> no_primary", async () => {
  for (const body of [[], [primary({ database_type: "READ_REPLICA" })]]) {
    const facts = await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, body) });
    assert.equal(facts.pooler_api_verdict, "no_primary");
    assert.equal(facts.pooler_api_primary_found, false);
    assert.equal(facts.pooler_api_entry_count, body.length);
  }
});

test("8: HTTP 200 PRIMARY with an empty / missing connection string -> primary_missing_connection_string", async () => {
  for (const connection_string of ["", "   ", undefined, null, 5]) {
    const facts = await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, [primary({ connection_string })]) });
    assert.equal(facts.pooler_api_verdict, "primary_missing_connection_string");
    assert.equal(facts.pooler_api_primary_found, true);
    assert.equal(facts.pooler_api_primary_connection_string_present, false);
  }
});

test("9-12: 401 -> unauthorized, 403 -> forbidden, 404 -> not_found, anything else -> unexpected_status; the body is never read", async () => {
  for (const [status, verdict] of [[401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [500, "unexpected_status"], [429, "unexpected_status"], [204, "unexpected_status"], [302, "unexpected_status"]]) {
    let bodyRead = false;
    const fetchImpl = async () => ({ status, json: async () => { bodyRead = true; return { message: `${PW} ${TOKEN}` }; }, text: async () => { bodyRead = true; return PW; } });
    const facts = await probe({ token: TOKEN, ref: REF, fetchImpl });
    assert.equal(facts.pooler_api_verdict, verdict, String(status));
    assert.equal(facts.pooler_api_http_status, status);
    assert.equal(facts.pooler_api_request_completed, true);
    assert.equal(facts.pooler_api_success_status, false);
    assert.equal(facts.pooler_api_json_parseable, "n/a");
    assert.equal(bodyRead, false, `${status}: the response body is not read`);
    const { text } = await run(fetchImpl);
    assertNoLeak(text);
    assert.ok(!text.includes("hunter2"));
  }
});

test("13: malformed JSON, or JSON that is not an array -> malformed_response", async () => {
  const bad = async () => ({ status: 200, json: async () => { throw new SyntaxError(`Unexpected token ${PW} in JSON`); } });
  const facts = await probe({ token: TOKEN, ref: REF, fetchImpl: bad });
  assert.equal(facts.pooler_api_verdict, "malformed_response");
  assert.equal(facts.pooler_api_json_parseable, false);
  assertNoLeak((await run(bad)).text);
  for (const body of [{ database_type: "PRIMARY" }, "text", 5, null]) {
    assert.equal((await probe({ token: TOKEN, ref: REF, fetchImpl: respond(200, body) })).pooler_api_verdict, "malformed_response");
  }
});

test("14: a network error / timeout -> request_failed, and the error text (which may embed a URL or token) is never printed", async () => {
  const boom = async () => { throw new Error(`connect ECONNREFUSED https://api.supabase.com/v1/projects/${REF} with ${TOKEN}`); };
  const facts = await probe({ token: TOKEN, ref: REF, fetchImpl: boom });
  assert.equal(facts.pooler_api_verdict, "request_failed");
  assert.equal(facts.pooler_api_request_completed, false);
  assert.equal(facts.pooler_api_http_status, "n/a");
  const { code, text } = await run(boom);
  assert.equal(code, 0, "a finding is not a failure");
  assertNoLeak(text);
  assert.ok(!text.includes("ECONNREFUSED"));
});

test("the output vocabulary is closed: only known keys, values are booleans / numbers / enums", async () => {
  const keys = ["pooler_api_request_completed", "pooler_api_http_status", "pooler_api_success_status", "pooler_api_json_parseable", "pooler_api_entry_count", "pooler_api_primary_found", "pooler_api_primary_connection_string_present", "pooler_api_primary_pool_mode", "pooler_api_verdict"];
  const scenarios = [respond(200, [primary()]), respond(200, []), respond(200, [primary({ connection_string: "" })]), respond(401, {}), respond(403, {}), respond(404, {}), respond(500, {}), async () => { throw new Error("x"); }, async () => ({ status: 200, json: async () => { throw new Error("x"); } })];
  const seen = new Set();
  for (const fetchImpl of scenarios) {
    const facts = await probe({ token: TOKEN, ref: REF, fetchImpl });
    assert.deepEqual(Object.keys(facts), keys);
    assert.ok(VERDICTS.includes(facts.pooler_api_verdict));
    seen.add(facts.pooler_api_verdict);
    for (const [k, v] of Object.entries(facts)) {
      if (k === "pooler_api_http_status" || k === "pooler_api_entry_count") assert.match(String(v), /^(n\/a|\d{1,4})$/);
      else if (k === "pooler_api_primary_pool_mode") assert.match(v, /^(session|transaction|unknown)$/);
      else if (k === "pooler_api_verdict") continue;
      else assert.ok(typeof v === "boolean" || v === "n/a", `${k}=${v}`);
    }
  }
  assert.deepEqual([...seen].sort(), [...VERDICTS].sort(), "every verdict is reachable");
});

test("malformed invocation fails closed: no token, no ref, a bad ref or arguments -> exit 2 and NO request", async () => {
  let requested = false;
  const fetchImpl = async () => { requested = true; return json(200, []); };
  for (const [env, argv] of [[{}, []], [{ SUPABASE_ACCESS_TOKEN: TOKEN }, []], [{ SUPABASE_PROJECT_REF: REF }, []], [{ SUPABASE_ACCESS_TOKEN: "  ", SUPABASE_PROJECT_REF: REF }, []], [{ SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: "../etc" }, []], [{ SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: `${REF}/x` }, []], [{ SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_PROJECT_REF: REF }, ["--anything"]]]) {
    const logs = [];
    assert.equal(await main(argv, { env, fetchImpl, log: (l) => logs.push(l), summaryFile: undefined }), 2);
    assert.match(logs.join("\n"), /usage:/);
    assertNoLeak(logs.join("\n"));
  }
  assert.equal(requested, false);
  assert.equal(render({ a: 1 })[0], "a=1");
});

/* ---- workflow wiring --------------------------------------------------------------------------------------------- */
const WORKFLOW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "deploy-staging.yml"), "utf8");
const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const stepNames = [...WORKFLOW.matchAll(/^ {6}- (?:name|uses): (.+)$/gm)].map((m) => m[1].trim());
const stepBlock = (name) => {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  assert.ok(start !== -1, `step ${name} exists`);
  const next = WORKFLOW.indexOf("\n      - ", start + 10);
  return WORKFLOW.slice(start, next === -1 ? undefined : next);
};

test("15: the API diagnostic runs AFTER the file diagnostic and BEFORE the plan, only when staging is configured", () => {
  const file = stepNames.findIndex((n) => /^Diagnose the Supabase link/.test(n));
  const api = stepNames.findIndex((n) => /^Diagnose Supabase pooler Management API/.test(n));
  const plan = stepNames.findIndex((n) => /^Plan - migration history/.test(n));
  assert.ok(file !== -1 && api !== -1 && plan !== -1);
  assert.equal(api, file + 1, "immediately after the file diagnostic");
  assert.equal(plan, api + 1, "and the plan follows it");
  const block = stepBlock(stepNames[api]);
  assert.match(block, /if: steps\.preflight\.outputs\.configured == 'true'/);
  assert.match(block, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(block, /SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_PROJECT_REF \}\}/);
  assert.match(block, /run: node scripts\/supabase-pooler-api-diagnostic\.mjs\s*$/m);
  assert.ok(!/continue-on-error/.test(block), "a malformed call fails the step; findings do not");
});

test("16: no existing Supabase connection command changed", () => {
  const plan = stepBlock("Plan - migration history and database dry run");
  assert.match(plan, /node scripts\/supabase-capture\.mjs --out "\$RUNNER_TEMP\/migration-list\.json" -- migration list --linked --output-format json/);
  assert.match(plan, /node scripts\/supabase-capture\.mjs --out "\$RUNNER_TEMP\/dry-run\.json" -- db push --linked --dry-run/);
  assert.match(stepBlock("Link the Supabase project and verify the target"), /supabase link --project-ref "\$SUPABASE_PROJECT_REF" --yes/);
  assert.match(stepBlock("Migrate the database (supabase db push)"), /run: pnpm exec supabase db push --linked --yes\s*$/m);
});

test("17-18: no --db-url and no DB-password auth anywhere in the workflow's code", () => {
  assert.ok(!/--db-url/.test(code));
  assert.ok(!code.includes("SUPABASE_DB_PASSWORD"));
  assert.ok(!/\s(-p|--password)\s+"\$/.test(code));
});

test("the diagnostic is read only: its step writes, fetches and deletes nothing itself", () => {
  const block = stepBlock("Diagnose Supabase pooler Management API");
  const run = block.slice(block.indexOf("run:")).replace(/#.*$/gm, "");
  assert.ok(!/\b(rm|mv|cp|curl|wget|tee|sed)\b|>\s*supabase\/\.temp|pooler-url/.test(run));
});

test("19: the real database write still exists exactly once, deploy-gated", () => {
  assert.equal([...code.matchAll(/^\s*run: pnpm exec supabase db push --linked --yes\s*$/gm)].length, 1);
  const block = stepBlock("Migrate the database (supabase db push)");
  assert.match(block, /steps\.gate\.outputs\.deploy == 'true'/);
  assert.match(block, /steps\.fresh_migrate\.outputs\.current == 'true'/);
});
