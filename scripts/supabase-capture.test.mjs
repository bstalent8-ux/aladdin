import { test } from "node:test";
import assert from "node:assert/strict";
import { cliEnv, cliErrorFrom, diagnose, main, parseArgs, redact } from "./supabase-capture.mjs";

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
