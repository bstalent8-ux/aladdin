import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { inspectLink, main, parseArgs, render } from "./supabase-link-diagnostic.mjs";

const REF = "abcdefghijklmnopqrst";
// Secret-shaped fixtures are assembled at run time so no token-shaped literal sits in the repository.
const FAKE_TOKEN = ["sbp", "_", "0123456789", "abcdef0123456789abcdef01234567"].join("");
const FAKE_JWT = `${["eyJ", "hbGciOiJIUzI1NiJ9"].join("")}.${["eyJ", "yb2xlIjoic2VydmljZSJ9"].join("")}.abcdefghijk`;
const PW = "hunter2-fixture-pw";
const HOST = "aws-0-eu-west-3.pooler.supabase.com";
const VALID = `postgresql://postgres.${REF}:${PW}@${HOST}:6543/postgres`;

const facts = (poolerText, projectRefText = `${REF}\n`, expectedRef = REF) => inspectLink({ projectRefText, poolerText, expectedRef });
const output = (f) => render(f).join("\n");

/** Everything a diagnostic must never contain, for any input. */
function assertNoLeak(text, extra = []) {
  for (const leaked of [HOST, "aws-0-eu-west-3", "pooler.supabase.com", PW, FAKE_TOKEN, FAKE_JWT, "postgresql://", "postgres://", "postgres.", "options=", "[YOUR-PASSWORD]", ...extra]) {
    assert.ok(!text.includes(leaked), `leaked: ${leaked}`);
  }
}

test("1-4: the raw pooler URL, hostname, user/password and token-shaped values are never printed", () => {
  const dirty = `${VALID}?options=reference%3D${REF}&x=${FAKE_TOKEN}&y=${FAKE_JWT}`;
  const text = output(facts(dirty));
  assertNoLeak(text);
  assert.ok(!text.includes(REF.slice(0, 8)) || text.includes("project_ref"), "only the field names carry the word project_ref");
  assert.ok(!text.includes("6543x"), "no fragments");
});

test("the output vocabulary is closed: only known keys, with boolean / enum / number values", () => {
  const keys = ["project_ref_present", "project_ref_matches_expected", "pooler_url_present", "pooler_url_nonempty", "pooler_url_parseable", "pooler_host_is_supabase_pooler", "pooler_project_binding_matches", "pooler_port", "pooler_verdict"];
  for (const input of [null, "", "   \n", "not a url", VALID, `postgresql://u:${PW}@evil.example.com:5432/db`, `postgresql://postgres.zzzzzzzzzzzzzzzzzzzz:${PW}@${HOST}:5432/postgres`]) {
    const f = facts(input);
    assert.deepEqual(Object.keys(f), keys);
    for (const [k, v] of Object.entries(f)) {
      if (k === "pooler_port") assert.match(String(v), /^(n\/a|\d{1,5})$/);
      else if (k === "pooler_verdict") assert.match(v, /^(missing|empty|unparseable|not_supabase_pooler|project_binding_mismatch|looks_valid)$/);
      else if (k === "pooler_project_binding_matches") assert.ok([true, false, "unknown"].includes(v));
      else assert.equal(typeof v, "boolean", k);
    }
    assertNoLeak(output(f));
  }
});

test("5: a missing pooler file is reported safely", () => {
  const f = facts(null);
  assert.equal(f.pooler_url_present, false);
  assert.equal(f.pooler_url_nonempty, false);
  assert.equal(f.pooler_verdict, "missing");
  assert.equal(f.project_ref_matches_expected, true);
});

test("6: an empty (or whitespace-only) pooler file is reported safely, as present but empty", () => {
  for (const text of ["", "  \n\t"]) {
    const f = facts(text);
    assert.equal(f.pooler_url_present, true);
    assert.equal(f.pooler_url_nonempty, false);
    assert.equal(f.pooler_verdict, "empty");
  }
});

test("7: a valid Supabase pooler URL reports only booleans and the port number", () => {
  const f = facts(VALID);
  assert.deepEqual(f, {
    project_ref_present: true,
    project_ref_matches_expected: true,
    pooler_url_present: true,
    pooler_url_nonempty: true,
    pooler_url_parseable: true,
    pooler_host_is_supabase_pooler: true,
    pooler_project_binding_matches: true,
    pooler_port: "6543",
    pooler_verdict: "looks_valid",
  });
  // The CLI strips the [YOUR-PASSWORD] placeholder before parsing; so must the diagnostic.
  assert.equal(facts(`postgresql://postgres.${REF}:[YOUR-PASSWORD]@${HOST}:6543/postgres`).pooler_verdict, "looks_valid");
});

test("8: a pooler URL bound to a DIFFERENT project is detected (dotted user and `reference` option)", () => {
  const other = "zzzzzzzzzzzzzzzzzzzz";
  const dotted = facts(`postgresql://postgres.${other}:${PW}@${HOST}:6543/postgres`);
  assert.equal(dotted.pooler_project_binding_matches, false);
  assert.equal(dotted.pooler_verdict, "project_binding_mismatch");
  const viaOption = facts(`postgresql://postgres:${PW}@${HOST}:6543/postgres?options=reference%3D${other}`);
  assert.equal(viaOption.pooler_project_binding_matches, false);
  const bound = facts(`postgresql://postgres:${PW}@${HOST}:6543/postgres?options=reference%3D${REF}`);
  assert.equal(bound.pooler_project_binding_matches, true);
  assert.equal(facts(`postgresql://postgres:${PW}@${HOST}:6543/postgres`).pooler_project_binding_matches, "unknown");
});

test("unparseable text, a non-Postgres scheme and a foreign host are classified, not echoed", () => {
  assert.equal(facts("this is not a url").pooler_verdict, "unparseable");
  assert.equal(facts(`https://${HOST}/x`).pooler_verdict, "unparseable");
  const foreign = facts(`postgresql://postgres.${REF}:${PW}@db.internal.example.com:5432/postgres`);
  assert.equal(foreign.pooler_url_parseable, true);
  assert.equal(foreign.pooler_host_is_supabase_pooler, false);
  assert.equal(foreign.pooler_verdict, "not_supabase_pooler");
  assertNoLeak(output(foreign), ["internal.example.com", "db.internal"]);
});

test("9: a project-ref mismatch (or absence) fails closed with exit 1 and prints no file content", () => {
  const logs = [];
  const read = (path) => (path.endsWith("project-ref") ? "someotherprojectref00\n" : VALID);
  const code = main(["--expected-ref", REF], { read, log: (l) => logs.push(l), summaryFile: undefined });
  assert.equal(code, 1);
  assert.match(logs.join("\n"), /does not match SUPABASE_PROJECT_REF/);
  assertNoLeak(logs.join("\n"), ["someotherprojectref00"]);
  assert.equal(main(["--expected-ref", REF], { read: (p) => (p.endsWith("project-ref") ? null : VALID), log: () => {}, summaryFile: undefined }), 1, "absent project-ref");
});

test("a missing pooler file does NOT fail the diagnostic: it is an observation", () => {
  const logs = [];
  const code = main(["--expected-ref", REF], { read: (p) => (p.endsWith("project-ref") ? REF : null), log: (l) => logs.push(l), summaryFile: undefined });
  assert.equal(code, 0);
  assert.match(logs.join("\n"), /pooler_verdict=missing/);
});

test("malformed invocation exits 2 and prints usage only", () => {
  for (const argv of [[], ["--expected-ref"], ["--expected-ref", "x"], ["--expected-ref", "bad ref!!"], ["--dir", "x"]]) {
    const logs = [];
    assert.equal(main(argv, { read: () => { throw new Error("must not read"); }, log: (l) => logs.push(l), summaryFile: undefined }), 2);
    assert.match(logs.join("\n"), /usage:/);
  }
  assert.throws(() => parseArgs([]));
});

test("end to end on a throwaway directory: stdout and the step summary carry no secret-derived text", () => {
  const dir = mkdtempSync(join(tmpdir(), "link-diag-"));
  try {
    const temp = join(dir, "supabase", ".temp");
    mkdirSync(temp, { recursive: true });
    writeFileSync(join(temp, "project-ref"), REF);
    writeFileSync(join(temp, "pooler-url"), `${VALID}?options=reference%3D${REF}&t=${FAKE_TOKEN}`);
    const summary = join(dir, "summary.md");
    const script = join(dirname(fileURLToPath(import.meta.url)), "supabase-link-diagnostic.mjs");
    const run = spawnSync(process.execPath, [script, "--expected-ref", REF, "--dir", temp], { encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: summary, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /pooler_verdict=looks_valid/);
    assert.match(run.stdout, /pooler_port=6543/);
    assertNoLeak(run.stdout + run.stderr);
    assertNoLeak(readFileSync(summary, "utf8"));
    // observation only: the directory is exactly as it was
    assert.equal(readFileSync(join(temp, "pooler-url"), "utf8").includes(HOST), true, "the pooler file is untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---- workflow wiring ---------------------------------------------------------------------------------------------------- */
const WORKFLOW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "deploy-staging.yml"), "utf8");
const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const stepNames = [...WORKFLOW.matchAll(/^ {6}- (?:name|uses): (.+)$/gm)].map((m) => m[1].trim());
const stepBlock = (name) => {
  const start = WORKFLOW.indexOf(`- name: ${name}`);
  assert.ok(start !== -1, `step ${name} exists`);
  const next = WORKFLOW.indexOf("\n      - ", start + 10);
  return WORKFLOW.slice(start, next === -1 ? undefined : next);
};

test("10: the workflow runs the diagnostic IMMEDIATELY after the link-and-verify step, and before the plan", () => {
  const link = stepNames.findIndex((n) => /^Link the Supabase project/.test(n));
  const diag = stepNames.findIndex((n) => /^Diagnose the Supabase link/.test(n));
  const plan = stepNames.findIndex((n) => /^Plan - migration history/.test(n));
  assert.ok(link !== -1 && diag !== -1 && plan !== -1);
  assert.equal(diag, link + 1, "the very next step after link");
  // The Management API diagnostic is the one observation-only step allowed between this diagnostic and the plan.
  assert.ok(plan > diag, "the plan comes after the file diagnostic");
  assert.deepEqual(
    stepNames.slice(diag + 1, plan).filter((n) => !/^Diagnose Supabase pooler Management API/.test(n)),
    [],
    "nothing but the API diagnostic sits between them",
  );
  const block = stepBlock("Diagnose the Supabase link (safe facts only - never prints the pooler URL)");
  assert.match(block, /node scripts\/supabase-link-diagnostic\.mjs --expected-ref "\$SUPABASE_PROJECT_REF"/);
  assert.match(block, /if: steps\.preflight\.outputs\.configured == 'true'/);
  assert.ok(!/SUPABASE_ACCESS_TOKEN/.test(block), "the diagnostic never receives the access token");
});

test("11: the connection commands themselves are unchanged by the diagnostic", () => {
  const plan = stepBlock("Plan - migration history and database dry run");
  assert.match(plan, /node scripts\/supabase-capture\.mjs --out "\$RUNNER_TEMP\/migration-list\.json" -- migration list --linked --output-format json/);
  assert.match(plan, /node scripts\/supabase-capture\.mjs --out "\$RUNNER_TEMP\/dry-run\.json" -- db push --linked --dry-run/);
  assert.match(stepBlock("Link the Supabase project and verify the target"), /supabase link --project-ref "\$SUPABASE_PROJECT_REF" --yes/);
});

test("12-13: no DB-password auth and no --db-url anywhere in the workflow's code", () => {
  assert.ok(!code.includes("SUPABASE_DB_PASSWORD"));
  assert.ok(!/--db-url/.test(code));
  assert.ok(!/\s(-p|--password)\s+"\$/.test(code));
});

test("the diagnostic does not mutate: no rm/mv/cp/curl/echo-to-.temp lines in its step", () => {
  const block = stepBlock("Diagnose the Supabase link (safe facts only - never prints the pooler URL)");
  const run = block.slice(block.indexOf("run:"));
  assert.ok(!/\b(rm|mv|cp|curl|wget|tee|sed)\b|>\s*supabase\/\.temp|pooler-url/.test(run.replace(/#.*$/gm, "")), "no file manipulation or fetching");
});

test("14: the real database write still exists exactly once, deploy-gated", () => {
  const writes = [...code.matchAll(/^\s*run: pnpm exec supabase db push --linked --yes\s*$/gm)];
  assert.equal(writes.length, 1);
  const block = stepBlock("Migrate the database (supabase db push)");
  assert.match(block, /steps\.gate\.outputs\.deploy == 'true'/);
  assert.match(block, /steps\.fresh_migrate\.outputs\.current == 'true'/);
});
