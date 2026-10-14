import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Structural tests of .github/workflows/deploy-staging.yml (no YAML library: the file's layout is regular).
 *
 * The workflow's WRITE steps (`supabase db push --yes`, `vercel promote`, and everything that depends on them) are
 * conditioned on the answers of three freshness checks. These tests evaluate the workflow's real `if:` conditions for every
 * way a run can be superseded, and assert that the two writes cannot run after their own freshness check says "superseded".
 */
const WORKFLOW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "deploy-staging.yml"), "utf8");

function parseSteps(text) {
  const body = text.slice(text.indexOf("\n    steps:\n") + "\n    steps:\n".length);
  const blocks = [];
  let current = null;
  for (const line of body.split("\n")) {
    if (/^ {6}- /.test(line)) {
      current = [line];
      blocks.push(current);
    } else if (current) current.push(line);
  }
  return blocks.map((lines) => {
    const block = lines.join("\n");
    const field = (key) => new RegExp(`^ {6}(?:- )?${key}: (.*)$|^ {8}${key}: (.*)$`, "m").exec(block)?.slice(1).find(Boolean);
    const runMatch = /^ {8}run: \|\n((?:(?: {10}.*)?\n?)*)/m.exec(block);
    const run = runMatch ? runMatch[1] : (field("run") ?? "");
    return { name: field("name") ?? field("uses") ?? "", id: field("id"), if: field("if"), run, block };
  });
}

const STEPS = parseSteps(WORKFLOW);
const byId = (id) => {
  const step = STEPS.find((s) => s.id === id);
  assert.ok(step, `step with id ${id} exists`);
  return step;
};

/** The subset of GitHub's expression language the workflow uses: `a == 'x' && b != 'y'`, over steps.<id>.outputs.<name>. */
function evalIf(expr, outputs) {
  if (expr === undefined) return true; // no condition: runs (previous steps succeeded)
  return expr.split("&&").every((raw) => {
    const m = /^\s*steps\.([a-z_]+)\.outputs\.([a-z_]+)\s*(==|!=)\s*'([^']*)'\s*$/.exec(raw);
    assert.ok(m, `unsupported condition term: ${raw.trim()}`);
    const actual = outputs[`${m[1]}.${m[2]}`] ?? ""; // an unset output is the empty string
    return m[3] === "==" ? actual === m[4] : actual !== m[4];
  });
}

/** Run the job's steps in order with the given answers; return which of them executed. */
function simulate({ deploy, fresh, freshMigrate, freshPromote, alreadyPromoted = "false", configured = "true" }) {
  const answers = { fresh, fresh_migrate: freshMigrate, fresh_promote: freshPromote };
  const outputs = { "gate.deploy": String(deploy), "preflight.configured": configured, "vercel.already_promoted": alreadyPromoted };
  const ran = new Set();
  for (const step of STEPS) {
    if (!step.if || step.if.includes("failure()")) {
      if (step.if) continue; // the rollback-instruction step only runs after a smoke failure
    }
    if (!evalIf(step.if, outputs)) continue;
    ran.add(step.id ?? step.name);
    if (step.id in answers && answers[step.id] !== undefined) outputs[`${step.id}.current`] = String(answers[step.id]);
  }
  return ran;
}

const WRITES = ["migrate", "verify", "vercel", "previous", "fresh_promote", "promote", "smoke"];
const WRITE_NAMES = ["Install the smoke browser"];
const didRun = (ran, ...ids) => ids.filter((id) => ran.has(id));

test("the three freshness checks exist, use ONE helper, and the workflow has no inline git ls-remote", () => {
  const stages = { fresh: "initial", fresh_migrate: "pre-migrate", fresh_promote: "pre-promote" };
  for (const [id, stage] of Object.entries(stages)) {
    assert.ok(byId(id).run.includes(`node scripts/main-head-check.mjs --stage ${stage} --sha "$COMMIT_SHA"`), id);
    assert.match(byId(id).block, /COMMIT_SHA: \$\{\{ github\.sha \}\}/, `${id} compares against the full triggering SHA`);
  }
  assert.ok(!/ls-remote/.test(STEPS.map((s) => s.run).join("\n")), "no fragile inline head check remains in the workflow");
  assert.equal(STEPS.filter((s) => s.run.includes("main-head-check.mjs")).length, 3);
});

test("the freshness check sits IMMEDIATELY before each write", () => {
  const index = (id) => STEPS.findIndex((s) => s.id === id);
  assert.equal(index("fresh_migrate") + 1, index("migrate"), "pre-migrate check is the step right before `db push`");
  assert.equal(index("fresh_promote") + 1, index("promote"), "pre-promote check is the step right before `vercel promote`");
});

test("`supabase db push --yes` and `vercel promote` each exist exactly once, behind their own freshness answer", () => {
  const dbPushWrites = STEPS.filter((s) => /db push --linked --yes/.test(s.run));
  assert.equal(dbPushWrites.length, 1);
  assert.equal(dbPushWrites[0].id, "migrate");
  assert.ok(dbPushWrites[0].if.includes("steps.fresh_migrate.outputs.current == 'true'"));
  assert.ok(dbPushWrites[0].if.includes("steps.gate.outputs.deploy == 'true'"));

  const promotes = STEPS.filter((s) => /vercel@\S+"? promote|\bpromote "\$DEPLOYMENT_URL"/.test(s.run));
  assert.equal(promotes.length, 1);
  assert.equal(promotes[0].id, "promote");
  assert.ok(promotes[0].if.includes("steps.fresh_promote.outputs.current == 'true'"));
  assert.ok(promotes[0].if.includes("steps.gate.outputs.deploy == 'true'"));
});

test("forbidden commands never appear in the workflow", () => {
  const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  for (const forbidden of ["--include-all", "migration repair", "db reset"]) assert.ok(!code.includes(forbidden), forbidden);
});

test("everything current, deploy mode: the full path runs", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: true });
  for (const id of WRITES) assert.ok(ran.has(id), `${id} runs`);
  assert.ok(ran.has("Install the smoke browser"));
});

test("superseded at the initial check: no database write, no promotion, nothing after it", () => {
  const ran = simulate({ deploy: true, fresh: false });
  assert.deepEqual(didRun(ran, ...WRITES, "fresh_migrate"), []);
  assert.ok(!ran.has("Install the smoke browser"));
});

test("superseded BEFORE the migration: `db push --yes` and everything after it are skipped", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: false });
  assert.ok(ran.has("fresh_migrate"), "the check itself ran");
  assert.deepEqual(didRun(ran, ...WRITES), [], "no migrate, verify, deployment lookup, promotion or smoke");
  assert.ok(!ran.has("Install the smoke browser"));
});

test("superseded AFTER the migration: the migration ran, but `vercel promote` and the smoke are skipped", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: false });
  assert.deepEqual(didRun(ran, "migrate", "verify", "vercel", "previous", "fresh_promote"), ["migrate", "verify", "vercel", "previous", "fresh_promote"]);
  assert.deepEqual(didRun(ran, "promote", "smoke"), [], "no promotion and no smoke of an unpromoted deployment");
  assert.ok(!ran.has("Install the smoke browser"));
});

test("plan mode (switch off): not one write step can run, whatever the freshness answers say", () => {
  for (const fresh of [true, false]) {
    for (const freshMigrate of [true, false]) {
      for (const freshPromote of [true, false]) {
        const ran = simulate({ deploy: false, fresh, freshMigrate, freshPromote });
        assert.deepEqual(didRun(ran, ...WRITES, "fresh_migrate"), []);
      }
    }
  }
});

test("a freshness step that could not answer (its output never set) leaves every later write skipped", () => {
  // fresh_migrate ran but failed closed -> the job fails; even if it were continue-on-error the output is empty:
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: undefined });
  assert.deepEqual(didRun(ran, ...WRITES), []);
  const ran2 = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: undefined });
  assert.deepEqual(didRun(ran2, "promote", "smoke"), []);
});

test("already promoted (idempotent re-run): no second promote, the smoke still runs", () => {
  const ran = simulate({ deploy: true, fresh: true, freshMigrate: true, freshPromote: true, alreadyPromoted: "true" });
  assert.ok(!ran.has("promote"));
  assert.ok(ran.has("smoke"));
});

test("exhaustive: over every combination of answers, a write never runs after its own check says superseded", () => {
  const vals = [true, false, undefined];
  for (const deploy of [true, false]) {
    for (const fresh of vals) for (const fm of vals) for (const fp of vals) {
      const ran = simulate({ deploy, fresh, freshMigrate: fm, freshPromote: fp });
      if (ran.has("migrate")) assert.ok(deploy && fm === true && fresh === true, `migrate ran with deploy=${deploy} fresh=${fresh} fm=${fm}`);
      if (ran.has("promote")) assert.ok(deploy && fp === true && fm === true && fresh === true, `promote ran with deploy=${deploy} fresh=${fresh} fm=${fm} fp=${fp}`);
      for (const id of ["verify", "vercel", "previous"]) if (ran.has(id)) assert.ok(fm === true, `${id} ran after a non-current pre-migrate check`);
      if (ran.has("smoke")) assert.ok(fp === true, "smoke ran after a non-current pre-promote check");
    }
  }
});

test("the parser really sees the workflow (guards against silently testing nothing)", () => {
  assert.ok(STEPS.length >= 20, `parsed ${STEPS.length} steps`);
  for (const id of ["gate", "fresh", "preflight", "fresh_migrate", "migrate", "verify", "vercel", "previous", "fresh_promote", "promote", "smoke"]) byId(id);
  assert.ok(WRITE_NAMES.every((n) => STEPS.some((s) => s.name === n)));
});

/* ---- Supabase authentication: token only, never a database password; failures are visible -------------------------- */
const codeLines = () => WORKFLOW.split("\n").filter((line) => !line.trim().startsWith("#"));

test("no step passes a database password (`-p`) to a Supabase command, and no step injects SUPABASE_DB_PASSWORD", () => {
  const code = codeLines().join("\n");
  assert.ok(!code.includes("SUPABASE_DB_PASSWORD"), "SUPABASE_DB_PASSWORD appears nowhere in the workflow's code");
  for (const step of STEPS.filter((s) => /\bsupabase\b/.test(s.run))) {
    // Per command line (`node -p` in the version check is node's flag, not a Supabase password).
    for (const line of step.run.split("\n").filter((l) => /pnpm exec supabase|supabase-capture\.mjs/.test(l))) {
      assert.ok(!/\s(-p|--password)(\s|=|$)/.test(line), `${step.name}: no password flag on: ${line.trim()}`);
    }
    assert.ok(!/DB_PASSWORD/.test(step.block.replace(/^\s*#.*$/gm, "")), `${step.name}: no DB password in the step`);
  }
});

test("the Supabase steps authenticate with exactly SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF", () => {
  const link = STEPS.find((s) => /supabase link/.test(s.run));
  assert.ok(link);
  assert.match(link.run, /supabase link --project-ref "\$SUPABASE_PROJECT_REF" --yes/);
  assert.match(link.block, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(link.block, /SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_PROJECT_REF \}\}/);
  for (const id of ["migrate", "verify"]) assert.match(byId(id).block, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/, id);
});

test("preflight requires the Supabase token and project ref, and NOT a database password", () => {
  const preflight = byId("preflight");
  assert.match(preflight.run, /need SUPABASE_ACCESS_TOKEN; need SUPABASE_PROJECT_REF/);
  assert.ok(!/PASSWORD/.test(preflight.run.split("\n").filter((l) => /SUPABASE/.test(l)).join("\n")), "no Supabase password in the preflight needs");
});

test("the real write is exactly `supabase db push --linked --yes`, once, in deploy mode behind the freshness check", () => {
  const writes = STEPS.filter((s) => /db push\b(?!.*--dry-run)/.test(s.run));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, "migrate");
  assert.match(writes[0].run, /^\s*pnpm exec supabase db push --linked --yes\s*$/m);
  assert.ok(writes[0].if.includes("steps.gate.outputs.deploy == 'true'"));
  assert.ok(writes[0].if.includes("steps.fresh_migrate.outputs.current == 'true'"));
});

test("plan mode has no write path: the plan step only lists and dry-runs, through the capture helper", () => {
  const plan = STEPS.find((s) => /Plan - migration history/.test(s.name));
  assert.ok(plan);
  assert.match(plan.run, /supabase-capture\.mjs --out "\$RUNNER_TEMP\/migration-list\.json" -- --output-format json migration list --linked/);
  assert.match(plan.run, /supabase-capture\.mjs --out "\$RUNNER_TEMP\/dry-run\.json" -- --output-format json db push --linked --dry-run/);
  assert.ok(!/--yes/.test(plan.run) && !/db push --linked\s*$/m.test(plan.run), "no real push in the plan step");
  assert.equal(plan.if, "steps.preflight.outputs.configured == 'true'");
});

test("CLI output is never silently redirected: every list/dry-run goes through the capture helper", () => {
  for (const step of STEPS) {
    for (const line of step.run.split("\n")) {
      if (/\bsupabase\b.*\b(migration list|db push)\b.*--dry-run|\bsupabase\b.*migration list/.test(line) && !/^\s*pnpm exec supabase db push --linked --yes\s*$/.test(line)) {
        assert.match(line, /node scripts\/supabase-capture\.mjs --out /, `${step.name}: ${line.trim()}`);
        assert.ok(!/>\s*"?\$RUNNER_TEMP/.test(line), `${step.name}: no bare redirect to a file`);
      }
    }
  }
});

test("the post-write verification uses the same visible, token-only commands", () => {
  const verify = byId("verify");
  assert.match(verify.run, /supabase-capture\.mjs --out "\$RUNNER_TEMP\/migration-list-after\.json" -- --output-format json migration list --linked/);
  assert.match(verify.run, /supabase-capture\.mjs --out "\$RUNNER_TEMP\/dry-run-after\.json" -- --output-format json db push --linked --dry-run/);
});

/* ---- machine-readable output contract: EVERY captured command asks for JSON, with the GLOBAL flag first -------------- */
test("every supabase-capture command that feeds the guard requests JSON, with the global --output-format flag BEFORE the subcommand", () => {
  const captured = [];
  for (const step of STEPS) {
    for (const line of step.run.split("\n")) {
      const m = /node scripts\/supabase-capture\.mjs --out "([^"]+)" -- (.+)$/.exec(line.trim());
      if (m) captured.push({ step: step.name, out: m[1], args: m[2] });
    }
  }
  assert.equal(captured.length, 4, "list + dry run, before and after the write");
  for (const c of captured) {
    assert.match(c.args, /^--output-format json (migration list --linked|db push --linked --dry-run)$/, `${c.step}: ${c.args}`);
  }
  assert.deepEqual(captured.map((c) => c.args), [
    "--output-format json migration list --linked",
    "--output-format json db push --linked --dry-run",
    "--output-format json migration list --linked",
    "--output-format json db push --linked --dry-run",
  ]);
});

test("the dry run in particular can never omit the JSON request again (the CI failure: text output, no JSON object)", () => {
  const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  const dryRuns = code.split("\n").filter((l) => /db push --linked --dry-run/.test(l));
  assert.equal(dryRuns.length, 2);
  for (const l of dryRuns) assert.match(l, /-- --output-format json db push --linked --dry-run/);
});

test("the guard still consumes both files, still fail-closed, and the plan is unchanged apart from the output flag", () => {
  const plan = byId("preflight") && STEPS.find((s) => /Plan - migration history/.test(s.name));
  assert.ok(plan);
  assert.match(plan.run, /node scripts\/migration-history-guard\.mjs "\$RUNNER_TEMP\/migration-list\.json" --expect plan --dry-run "\$RUNNER_TEMP\/dry-run\.json"/);
  const verify = byId("verify");
  assert.match(verify.run, /node scripts\/migration-history-guard\.mjs "\$RUNNER_TEMP\/migration-list-after\.json" --expect up-to-date --dry-run "\$RUNNER_TEMP\/dry-run-after\.json"/);
  const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  for (const forbidden of ["--include-all", "migration repair", "db reset", "--db-url", "SUPABASE_DB_PASSWORD"]) assert.ok(!code.includes(forbidden), forbidden);
});

/* ---- Vercel CLI scope: the team SLUG, never the team_... id ---------------------------------------------------------- */
const workflowLines = () => WORKFLOW.split("\n");
const stepById = (id) => byId(id);

test("the promote step passes the team SLUG to `--scope`, and still sets the project identity for the CLI", () => {
  const promote = stepById("promote");
  assert.match(promote.run, /^npx --yes "vercel@\$VERCEL_CLI_VERSION" promote "\$DEPLOYMENT_URL" --yes --timeout 5m --scope "\$VERCEL_TEAM_SLUG"$/m);
  assert.match(promote.block, /VERCEL_TEAM_SLUG: \$\{\{ vars\.VERCEL_TEAM_SLUG \}\}/);
  assert.match(promote.block, /VERCEL_ORG_ID: \$\{\{ vars\.VERCEL_ORG_ID \}\}/, "the CLI still needs the org + project ids to identify the project");
  assert.match(promote.block, /VERCEL_PROJECT_ID: \$\{\{ vars\.VERCEL_PROJECT_ID \}\}/);
  assert.match(promote.block, /VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/, "the token is unchanged");
});

test("no `--scope` anywhere is given the team id (the `User not found (404)` bug)", () => {
  const scopeLines = workflowLines().filter((l) => /--scope\b/.test(l) && !l.trim().startsWith("#"));
  assert.ok(scopeLines.length >= 2, "the promote command and the printed rollback command both use --scope");
  for (const line of scopeLines) {
    assert.ok(!/VERCEL_ORG_ID|\$ORG\b|\$\{ORG\}|team_/.test(line), `--scope must not take the team id: ${line.trim()}`);
    assert.match(line, /--scope "?\$(VERCEL_TEAM_SLUG|TEAM)"?/, line.trim());
  }
});

test("the rollback instruction prints the slug-scoped command", () => {
  const step = STEPS.find((x) => /human rollback instructions/.test(x.name));
  assert.ok(step);
  assert.match(step.block, /TEAM: \$\{\{ vars\.VERCEL_TEAM_SLUG \}\}/);
  assert.ok(!/ORG: /.test(step.block), "no leftover team-id variable");
  assert.match(step.run, /rollback \$\{PREVIOUS_URL:-<previous-deployment-url>\} --scope \$TEAM/);
});

test("REST helper steps keep the team ID and do not take the slug", () => {
  const rest = STEPS.filter((x) => /scripts\/vercel-deploy\.mjs/.test(x.run));
  assert.ok(rest.length >= 3, "check-project (x2), find-deployment, previous-production");
  for (const step of rest) {
    assert.match(step.block, /VERCEL_ORG_ID: \$\{\{ vars\.VERCEL_ORG_ID \}\}/, `${step.name} keeps VERCEL_ORG_ID`);
    assert.ok(!/VERCEL_TEAM_SLUG/.test(step.block), `${step.name} does not need the slug`);
  }
  assert.match(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vercel-deploy.mjs"), "utf8"), /process\.env\.VERCEL_ORG_ID/, "the REST helper still reads the team id");
});

test("preflight: the slug is required in DEPLOY mode only, and is validated", () => {
  const preflight = stepById("preflight");
  assert.match(preflight.block, /VERCEL_TEAM_SLUG: \$\{\{ vars\.VERCEL_TEAM_SLUG \}\}/);
  const lines = preflight.run.split("\n");
  const needLine = lines.findIndex((l) => /need VERCEL_TEAM_SLUG/.test(l));
  const deployOpen = lines.findIndex((l) => /if \[ "\$DEPLOY" = "true" \]; then/.test(l));
  const fi = lines.findIndex((l, i) => i > deployOpen && /^\s*fi\s*$/.test(l));
  assert.ok(needLine > deployOpen && needLine < fi, "`need VERCEL_TEAM_SLUG` sits inside the deploy-only block");
  assert.ok(!lines.slice(0, deployOpen).some((l) => /VERCEL_TEAM_SLUG/.test(l)), "plan mode never requires it");
});

test("the slug validation accepts a team URL slug and rejects the team_... id and malformed values (executes the real shell snippet)", (t) => {
  const match = /case "\$VERCEL_TEAM_SLUG" in .*? esac/.exec(stepById("preflight").run);
  assert.ok(match, "the validation snippet exists");
  const probe = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("bash is not available");
  const run = (slug) => spawnSync("bash", ["-c", `${match[0]}; echo ACCEPTED`], { encoding: "utf8", env: { ...process.env, VERCEL_TEAM_SLUG: slug } });
  for (const good of ["aladdin8", "my-team", "a1", "team"]) {
    const r = run(good);
    assert.equal(r.status, 0, good);
    assert.match(r.stdout, /ACCEPTED/);
  }
  for (const bad of ["team_AbC123xyz", "team_x", "Aladdin8", "-leading", "has space", "under_score", "dots.dots", "slash/x", "ünï"]) {
    const r = run(bad);
    assert.equal(r.status, 1, `rejected: ${bad}`);
    assert.ok(!/ACCEPTED/.test(r.stdout), bad);
    assert.match(r.stdout, /VERCEL_TEAM_SLUG must be the Vercel team URL slug/);
  }
});

test("this change touched nothing else that matters: token, STAGING_PROMOTION_ENABLED handling, Supabase auth and the single DB write", () => {
  const code = WORKFLOW.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.equal((code.match(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g) ?? []).length >= 5, true, "the token is still a secret, passed as before");
  assert.match(code, /PROMOTION_ENABLED: \$\{\{ vars\.STAGING_PROMOTION_ENABLED \}\}/);
  assert.ok(!code.includes("SUPABASE_DB_PASSWORD") && !/--db-url/.test(code));
  assert.equal([...code.matchAll(/^\s*run: pnpm exec supabase db push --linked --yes\s*$/gm)].length, 1);
  assert.equal(STEPS.filter((x) => /\bpromote "\$DEPLOYMENT_URL"/.test(x.run)).length, 1, "exactly one promote");
});
