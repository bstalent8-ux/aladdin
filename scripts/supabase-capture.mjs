#!/usr/bin/env node
/**
 * Run ONE read-only Supabase CLI command for the staging workflow, keep its stdout in a file for the next guard, and make
 * every failure VISIBLE without ever printing a secret.
 *
 * WHY THIS EXISTS. The first live "Deploy staging" run failed with only "Process completed with exit code 1": with
 * `--output-format json` CLI 2.110.0 writes its error object ({"_tag":"Error","error":{...}}) to STDOUT, and the workflow
 * redirected stdout to a file, so the useful message never reached the Actions log.
 *
 * Contract:
 *   node scripts/supabase-capture.mjs --out <file> -- <supabase args...>
 *   - runs `pnpm exec supabase <args>` with SUPABASE_DB_PASSWORD REMOVED from its environment (the workflow authenticates
 *     with the access token and the CLI's temporary login role; a password would switch the CLI to a direct connection);
 *   - writes the command's stdout to <file>, exactly as the CLI produced it;
 *   - exit 0 only when the command exited 0 AND its stdout is not a CLI error object;
 *   - otherwise prints a SAFE diagnostic (error.code / error.message / error.suggestion, or a redacted tail of stderr)
 *     and exits non-zero. Secrets are never printed: the known secret VALUES are masked and credential-bearing URIs and
 *     Supabase token shapes are redacted from anything that is echoed.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SECRET_ENV_NAMES = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "VERCEL_TOKEN"];

/** Mask known secret values and credential-shaped strings in text that is about to be printed. */
export function redact(text, env = process.env) {
  let out = String(text ?? "");
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name];
    if (value && value.length >= 4) out = out.split(value).join("***");
  }
  return out
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*@[^\s"'<>]*/gi, "<redacted-uri>") // scheme://user:pass@host...
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "<redacted-uri>")
    .replace(/\bsbp_[A-Za-z0-9]{8,}/g, "sbp_***")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "<redacted-jwt>");
}

/** The CLI's JSON error object, if `stdout` holds one: { code, message, suggestion } (strings only), else null. */
export function cliErrorFrom(stdout) {
  if (typeof stdout !== "string") return null;
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let doc;
  try {
    doc = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || doc._tag !== "Error") return null;
  const e = doc.error && typeof doc.error === "object" ? doc.error : {};
  const text = (v) => (typeof v === "string" ? v : "");
  return { code: text(e.code), message: text(e.message), suggestion: text(e.suggestion) };
}

/** Build the diagnostic lines for a finished command. Returns [] when the command succeeded. */
export function diagnose({ label, status, stdout, stderr }, env = process.env) {
  const error = cliErrorFrom(stdout);
  if (status === 0 && !error) return [];
  const lines = [`${redact(label, env)} failed (exit ${status ?? "unknown"}).`];
  if (error) {
    lines.push(`  error.code:       ${redact(error.code, env) || "(none)"}`);
    lines.push(`  error.message:    ${redact(error.message, env) || "(none)"}`);
    if (error.suggestion) lines.push(`  error.suggestion: ${redact(error.suggestion, env)}`);
  } else {
    const tail = redact(stderr, env).split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-12);
    if (tail.length) lines.push("  stderr (last lines, redacted):", ...tail.map((l) => `    ${l}`));
    else lines.push("  The command printed nothing on stderr and no CLI error object on stdout.");
  }
  return lines;
}

/** The environment the CLI runs with: the caller's, minus the database password (token auth only). */
export function cliEnv(env = process.env) {
  const copy = { ...env };
  delete copy.SUPABASE_DB_PASSWORD;
  return copy;
}

export function parseArgs(argv) {
  const dash = argv.indexOf("--");
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const cliArgs = dash === -1 ? [] : argv.slice(dash + 1);
  const outIndex = head.indexOf("--out");
  const out = outIndex === -1 ? undefined : head[outIndex + 1];
  if (!out || cliArgs.length === 0) throw new Error("usage: supabase-capture.mjs --out <file> -- <supabase args...>");
  return { out, cliArgs };
}

export function main(argv, { spawn = spawnSync, env = process.env, write = writeFileSync, log = console.log } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    log(error.message);
    return 2;
  }
  const label = `supabase ${parsed.cliArgs.join(" ")}`;
  const result = spawn("pnpm", ["exec", "supabase", ...parsed.cliArgs], {
    env: cliEnv(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  write(parsed.out, stdout);
  const problems = diagnose({ label, status: result.error ? null : result.status, stdout, stderr }, env);
  if (result.error) problems.push(`  could not start the command: ${redact(result.error.message, env)}`);
  if (problems.length === 0) return 0;
  const text = problems.join("\n");
  log(text);
  if (env.GITHUB_ACTIONS === "true") log(`::error title=Supabase CLI command failed::${text.replace(/\r?\n/g, "%0A")}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
