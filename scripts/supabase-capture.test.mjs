import { test } from "node:test";
import assert from "node:assert/strict";
import { cliEnv, cliErrorFrom, diagnose, expectsJson, hasJsonObject, main, outputShape, parseArgs, redact } from "./supabase-capture.mjs";

const ERROR_JSON = JSON.stringify({
  _tag: "Error",
  error: {
    code: "LegacyDbConnectError",
    message: "failed to connect to postgres: effect/sql/SqlError: PgClient: Failed to connect",
    suggestion: "Connect to your database by setting the env var correctly: SUPABASE_DB_PASSWORD",
  },
});

test("a CLI error object on STDOUT is recognised and its safe fields are extracted", () => {
  assert.deepEqual(cliErrorFrom(`${ERROR_JSON}\n`), {
    code: "LegacyDbConnectError",
    message: "failed to connect to postgres: effect/sql/SqlError: PgClient: Failed to connect",
    suggestion: "Connect to your database by setting the env var correctly: SUPABASE_DB_PASSWORD",
  });
  assert.equal(cliErrorFrom('{"migrations":[]}'), null, "an ordinary result is not an error");
  assert.equal(cliErrorFrom("not json"), null);
  assert.equal(cliErrorFrom(""), null);
});

test("a failing command prints code, message and suggestion instead of only 'exit code 1'", () => {
  const lines = diagnose({ label: "supabase migration list --linked", status: 1, stdout: ERROR_JSON, stderr: "Connecting to remote database...\n" });
  const text = lines.join("\n");
  assert.match(text, /supabase migration list --linked failed \(exit 1\)/);
  assert.match(text, /error\.code:\s+LegacyDbConnectError/);
  assert.match(text, /error\.message:\s+failed to connect to postgres/);
  assert.match(text, /error\.suggestion:\s+Connect to your database/);
});

test("exit 0 with an error object on stdout is still a failure (the CLI can do that)", () => {
  assert.ok(diagnose({ label: "x", status: 0, stdout: ERROR_JSON, stderr: "" }).length > 0);
  assert.deepEqual(diagnose({ label: "x", status: 0, stdout: '{"upToDate":true}', stderr: "" }), []);
});

test("a failure without an error object shows a redacted tail of stderr", () => {
  const lines = diagnose({ label: "x", status: 3, stdout: "", stderr: "boom\nsecond line\n" });
  assert.ok(lines.some((l) => l.includes("second line")));
  assert.ok(diagnose({ label: "x", status: 3, stdout: "", stderr: "" }).join("\n").includes("printed nothing"));
});

test("secrets and credential-bearing URIs are never echoed", () => {
  // Built at run time so no token-shaped literal sits in the repository (secret scanning would, rightly, flag it).
  const fakeToken = ["sbp", "_", "0123456789", "abcdef0123456789abcdef01234567"].join("");
  const env = { SUPABASE_ACCESS_TOKEN: fakeToken, SUPABASE_DB_PASSWORD: "hunter2-secret-pw" };
  const noisy = [
    `token ${fakeToken}`,
    `shape-only ${["sbp", "_", "ZZZZZZZZ", "ZZZZZZZZ"].join("")}`,
    "pw hunter2-secret-pw",
    "uri postgresql://postgres:hunter2-secret-pw@db.example.supabase.co:5432/postgres",
    "other postgres://user:abc@host/db",
    `jwt ${["eyJ", "hbGciOiJIUzI1NiJ9"].join("")}.${["eyJ", "yb2xlIjoic2VydmljZSJ9"].join("")}.abcdefghijk`,
  ].join("\n");
  const out = redact(noisy, env);
  for (const leaked of [fakeToken.slice(0, 14), "ZZZZZZZZ", "hunter2", "postgresql://", "postgres://", "eyJhbGci"]) assert.ok(!out.includes(leaked), `leaked ${leaked}`);
  const error = JSON.stringify({ _tag: "Error", error: { code: "X", message: "see postgres://u:hunter2-secret-pw@h/db", suggestion: "" } });
  const text = diagnose({ label: "x", status: 1, stdout: error, stderr: "" }, env).join("\n");
  assert.ok(!text.includes("hunter2") && !text.includes("postgres://"));
});

test("the CLI never sees SUPABASE_DB_PASSWORD (token auth only), whatever the caller's environment holds", () => {
  const env = cliEnv({ SUPABASE_DB_PASSWORD: "x", SUPABASE_ACCESS_TOKEN: "t", PATH: "/bin" });
  assert.ok(!("SUPABASE_DB_PASSWORD" in env));
  assert.equal(env.SUPABASE_ACCESS_TOKEN, "t");
});

test("argument parsing: --out and a command after `--` are both required", () => {
  assert.deepEqual(parseArgs(["--out", "f.json", "--", "db", "push", "--linked", "--dry-run"]), { out: "f.json", cliArgs: ["db", "push", "--linked", "--dry-run"] });
  assert.throws(() => parseArgs(["--", "db"]));
  assert.throws(() => parseArgs(["--out", "f.json"]));
});

function run(result, extra = {}) {
  const calls = [];
  const writes = [];
  const logs = [];
  const code = main(["--out", "out.json", "--", "migration", "list", "--linked", "--output-format", "json"], {
    spawn: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return result;
    },
    env: { SUPABASE_DB_PASSWORD: "pw-should-not-reach-the-cli", SUPABASE_ACCESS_TOKEN: "tok-should-not-print-1234", ...extra },
    write: (file, data) => writes.push([file, data]),
    log: (line) => logs.push(line),
  });
  return { code, calls, writes, logs };
}

test("main: success writes stdout verbatim to the file, prints nothing, exits 0, and drops the password from the child env", () => {
  const { code, calls, writes, logs } = run({ status: 0, stdout: '{"migrations":[]}', stderr: "Connecting...\n" });
  assert.equal(code, 0);
  assert.deepEqual(writes, [["out.json", '{"migrations":[]}']]);
  assert.deepEqual(logs, []);
  assert.deepEqual(calls[0].args, ["exec", "supabase", "migration", "list", "--linked", "--output-format", "json"]);
  assert.ok(!("SUPABASE_DB_PASSWORD" in calls[0].options.env));
  assert.ok(!calls[0].args.includes("-p"), "no password flag");
});

test("main: the real LegacyDbConnectError case is now visible, still exits non-zero, and leaks nothing", () => {
  const { code, writes, logs } = run({ status: 1, stdout: ERROR_JSON, stderr: "Connecting to remote database...\n" });
  assert.equal(code, 1);
  assert.equal(writes[0][1], ERROR_JSON, "the file still holds what the CLI wrote");
  const text = logs.join("\n");
  assert.match(text, /LegacyDbConnectError/);
  assert.match(text, /failed to connect to postgres/);
  assert.ok(!text.includes("tok-should-not-print-1234") && !text.includes("pw-should-not-reach-the-cli"));
});

test("main: a command that cannot even start fails closed", () => {
  const { code, logs } = run({ status: null, error: new Error("spawn pnpm ENOENT"), stdout: "", stderr: "" });
  assert.equal(code, 1);
  assert.match(logs.join("\n"), /could not start the command/);
});

test("main: bad usage exits 2 without running anything", () => {
  const logs = [];
  let ran = false;
  const code = main(["--out", "f"], { spawn: () => { ran = true; return {}; }, log: (l) => logs.push(l) });
  assert.equal(code, 2);
  assert.equal(ran, false);
});

test("the command label is redacted too (a connection URI passed as an argument is never echoed)", () => {
  const lines = diagnose({ label: "supabase migration list --db-url postgres://user:pw@db.example.co:5432/postgres", status: 1, stdout: "", stderr: "" });
  const text = lines.join("\n");
  assert.ok(!text.includes("postgres://") && !text.includes("pw@"));
  assert.match(text, /<redacted-uri>/);
});

/* ---- JSON output contract ------------------------------------------------------------------------------------------------ */
// The real CI failure: on a runner (not a coding agent) `db push --dry-run` prints a TEXT sentence unless JSON is requested.
const TEXT_STDOUT = "Remote database is up to date.\n";
const SENSITIVE_TEXT = `Connecting to postgresql://postgres.abcdefghijklmnopqrst:pw-in-stdout@aws-0-eu-west-3.pooler.supabase.com:5432/postgres\n`;

test("`--output-format json` is recognised in any position (global flag first, flag last, or `=` form)", () => {
  assert.equal(expectsJson(["--output-format", "json", "migration", "list", "--linked"]), true);
  assert.equal(expectsJson(["migration", "list", "--linked", "--output-format", "json"]), true);
  assert.equal(expectsJson(["db", "push", "--output-format=json", "--dry-run"]), true);
  assert.equal(expectsJson(["db", "push", "--linked", "--dry-run"]), false);
  assert.equal(expectsJson(["--output-format", "text", "migration", "list"]), false);
  assert.equal(expectsJson(["--output-format"]), false);
  assert.equal(expectsJson([]), false);
});

test("a successful command that returns NON-JSON stdout is reported as unexpected_output_format, expected=json", () => {
  const text = diagnose({ label: "supabase --output-format json db push --linked --dry-run", status: 0, stdout: TEXT_STDOUT, stderr: "", expectJson: true }).join("\n");
  assert.match(text, /failed: unexpected_output_format/);
  assert.match(text, /expected=json/);
  assert.match(text, /stdout_bytes=31/);
  assert.match(text, /stdout_lines=1/);
  assert.match(text, /stdout_starts_with=letter/);
  assert.match(text, /stdout_has_json_object=false/);
});

test("the unexpected-format diagnostic NEVER prints stdout (it could hold connection details)", () => {
  const lines = diagnose({ label: "supabase db push --linked --dry-run", status: 0, stdout: SENSITIVE_TEXT, stderr: "", expectJson: true });
  const text = lines.join("\n");
  assert.match(text, /unexpected_output_format/);
  for (const leaked of ["postgresql://", "pw-in-stdout", "pooler.supabase.com", "aws-0-eu-west-3", "Connecting to", "abcdefghijklmnopqrst"]) assert.ok(!text.includes(leaked), `leaked: ${leaked}`);
  // only the closed vocabulary appears
  for (const line of lines.slice(1, -1)) assert.match(line, /^ {2}(expected=json|stdout_bytes=\d+|stdout_lines=\d+|stdout_starts_with=(empty|brace|bracket|letter|digit|other)|stdout_has_json_object=false)$/);
});

test("empty stdout from a JSON-expecting success is also unexpected_output_format", () => {
  const text = diagnose({ label: "x", status: 0, stdout: "", stderr: "", expectJson: true }).join("\n");
  assert.match(text, /unexpected_output_format/);
  assert.match(text, /stdout_bytes=0/);
  assert.match(text, /stdout_starts_with=empty/);
});

test("valid JSON stdout from a JSON-expecting success passes; a non-expecting command is not judged on its format", () => {
  assert.deepEqual(diagnose({ label: "x", status: 0, stdout: '{"migrations":[]}', stderr: "", expectJson: true }), []);
  assert.deepEqual(diagnose({ label: "x", status: 0, stdout: `log line\n{"upToDate":true}\n`, stderr: "", expectJson: true }), [], "surrounding log lines are tolerated, as the guard tolerates them");
  assert.deepEqual(diagnose({ label: "x", status: 0, stdout: TEXT_STDOUT, stderr: "", expectJson: false }), []);
  assert.equal(hasJsonObject("[1,2]"), false, "a bare array is not the object the guard needs");
  assert.equal(hasJsonObject("{ not json }"), false);
});

test("outputShape is a closed description: sizes and the class of the first character only", () => {
  assert.deepEqual(outputShape(""), { bytes: 0, lines: 0, startsWith: "empty" });
  assert.deepEqual(outputShape("{}\n"), { bytes: 3, lines: 1, startsWith: "brace" });
  assert.deepEqual(outputShape("[1]"), { bytes: 3, lines: 1, startsWith: "bracket" });
  assert.deepEqual(outputShape("a\nb\n"), { bytes: 4, lines: 2, startsWith: "letter" });
  assert.equal(outputShape("9").startsWith, "digit");
  assert.equal(outputShape("#x").startsWith, "other");
});

test("a CLI error object still wins over the format check (the real error is shown, not a format message)", () => {
  const text = diagnose({ label: "x", status: 1, stdout: ERROR_JSON, stderr: "", expectJson: true }).join("\n");
  assert.match(text, /LegacyDbConnectError/);
  assert.ok(!text.includes("unexpected_output_format"));
});

function runWith(args, stdout, status = 0) {
  const logs = [];
  const writes = [];
  const code = main(["--out", "out.json", "--", ...args], {
    spawn: () => ({ status, stdout, stderr: "Connecting to remote database...\n" }),
    env: {},
    write: (file, data) => writes.push([file, data]),
    log: (l) => logs.push(l),
  });
  return { code, logs: logs.join("\n"), writes };
}

test("main: the global flag FIRST is passed through unchanged, and text stdout from a JSON command fails closed with exit 1", () => {
  const seen = [];
  const code = main(["--out", "out.json", "--", "--output-format", "json", "db", "push", "--linked", "--dry-run"], {
    spawn: (cmd, args) => { seen.push(args); return { status: 0, stdout: TEXT_STDOUT, stderr: "" }; },
    env: {},
    write: () => {},
    log: () => {},
  });
  assert.equal(code, 1);
  assert.deepEqual(seen[0], ["exec", "supabase", "--output-format", "json", "db", "push", "--linked", "--dry-run"], "argument order is exactly what the workflow passed");
});

test("main: text stdout from a JSON-expecting command -> exit 1, named reason, no raw stdout, the file still holds what the CLI wrote", () => {
  const { code, logs, writes } = runWith(["--output-format", "json", "migration", "list", "--linked"], SENSITIVE_TEXT);
  assert.equal(code, 1);
  assert.match(logs, /unexpected_output_format/);
  assert.match(logs, /expected=json/);
  assert.ok(!logs.includes("pw-in-stdout") && !logs.includes("postgresql://"));
  assert.equal(writes[0][1], SENSITIVE_TEXT);
});

test("main: valid JSON from a JSON-expecting command -> exit 0; a command that did not ask for JSON is not format-checked", () => {
  assert.equal(runWith(["--output-format", "json", "db", "push", "--linked", "--dry-run"], '{"upToDate":true,"dryRun":true,"migrations":[]}').code, 0);
  assert.equal(runWith(["db", "push", "--linked", "--dry-run"], TEXT_STDOUT).code, 0);
});
