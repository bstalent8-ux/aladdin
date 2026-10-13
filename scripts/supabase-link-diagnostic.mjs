#!/usr/bin/env node
/**
 * Safe, read-only diagnostic of what `supabase link` left behind, for the staging workflow.
 *
 * WHY. Supabase CLI 2.110.0 resolves a `--linked` database connection like this (apps/cli/src/legacy/shared/
 * legacy-db-config.layer.ts at tag v2.110.0):
 *   1. probe TCP reachability of the direct host db.<ref>.supabase.co:5432;
 *   2. reachable -> use it (password if given, otherwise mint a temporary login role);
 *   3. NOT reachable (GitHub runners have no IPv6) -> use the pooler URL saved by `supabase link` in
 *      <workdir>/supabase/.temp/pooler-url (read as "present and non-empty"; on the linked path there is NO Management API
 *      fallback), validate it, and mint a temporary login role through it;
 *   4. no usable pooler URL (absent, empty, unparseable, username/`reference` option not bound to the ref, or a domain that
 *      is not the profile's pooler domain) -> LegacyDbConfigIpv6Error "IPv6 is not supported on your current network".
 * This script answers, from the file system alone, which of those the runner is in -- WITHOUT changing anything.
 *
 * OBSERVATION ONLY. It never writes, deletes, generates or fetches a pooler URL, never opens a connection, and never reads
 * a token. It reads exactly two files, supabase/.temp/project-ref and supabase/.temp/pooler-url, and prints ONLY a fixed
 * vocabulary of booleans / enumerations / one port number. The pooler URL, its host, user, password, placeholder and query
 * string are never printed -- nor anything derived from them beyond those booleans.
 *
 * Exit codes: 0 = observed (including "no pooler URL": that is a finding, not a failure); 1 = the linked project-ref does not
 * match the expected one (fail closed, nothing else is trustworthy); 2 = malformed invocation.
 *
 *   node scripts/supabase-link-diagnostic.mjs --expected-ref <ref> [--dir <supabase/.temp>]
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const POOLER_HOST = /(^|\.)pooler\.supabase\.com$/i;

/** The pooler URL as the CLI parses it: placeholder removed first, then `postgres(ql)://user[:pw]@host[:port]/db[?query]`. */
function parsePoolerUrl(text) {
  const sanitized = text.trim().replaceAll("[YOUR-PASSWORD]", "");
  let url;
  try {
    url = new URL(sanitized);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname === "") return null;
  return url;
}

/**
 * Pure: facts about the two files. `projectRefText` / `poolerText` are the file contents, or `null` when the file is absent.
 * Returns ONLY booleans, enumerations and a port number.
 */
export function inspectLink({ projectRefText, poolerText, expectedRef }) {
  const projectRef = projectRefText === null ? "" : projectRefText.replace(/\s+/g, "");
  const facts = {
    project_ref_present: projectRefText !== null && projectRef !== "",
    project_ref_matches_expected: projectRef !== "" && projectRef === expectedRef,
    pooler_url_present: poolerText !== null,
    pooler_url_nonempty: poolerText !== null && poolerText.trim() !== "",
    pooler_url_parseable: false,
    pooler_host_is_supabase_pooler: false,
    pooler_project_binding_matches: "unknown",
    pooler_port: "n/a",
    pooler_verdict: "",
  };

  if (!facts.pooler_url_present) facts.pooler_verdict = "missing";
  else if (!facts.pooler_url_nonempty) facts.pooler_verdict = "empty";
  else {
    const url = parsePoolerUrl(poolerText);
    facts.pooler_url_parseable = url !== null;
    if (!url) facts.pooler_verdict = "unparseable";
    else {
      facts.pooler_host_is_supabase_pooler = POOLER_HOST.test(url.hostname);
      if (url.port !== "" && /^\d{1,5}$/.test(url.port)) facts.pooler_port = url.port;
      // The CLI's binding rule: a dotted user must end in `.<ref>`; an undotted user must not carry a different `reference` option.
      let user = url.username;
      try {
        user = decodeURIComponent(user);
      } catch {
        /* keep the raw user: the binding check below simply will not match */
      }
      const dot = user.indexOf(".");
      if (dot !== -1) facts.pooler_project_binding_matches = user.slice(dot + 1) === expectedRef;
      else {
        const options = (url.searchParams.get("options") ?? "").split(",");
        const reference = options.map((o) => o.split("=")).find(([k]) => k === "reference");
        facts.pooler_project_binding_matches = reference ? reference.slice(1).join("=") === expectedRef : "unknown";
      }
      if (!facts.pooler_host_is_supabase_pooler) facts.pooler_verdict = "not_supabase_pooler";
      else if (facts.pooler_project_binding_matches === false) facts.pooler_verdict = "project_binding_mismatch";
      else facts.pooler_verdict = "looks_valid";
    }
  }
  return facts;
}

export function render(facts) {
  return Object.entries(facts).map(([k, v]) => `${k}=${v}`);
}

export function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const expectedRef = get("--expected-ref");
  if (!expectedRef || !/^[a-z0-9]{10,40}$/i.test(expectedRef)) throw new Error("usage: supabase-link-diagnostic.mjs --expected-ref <project-ref> [--dir <supabase/.temp>]");
  return { expectedRef, dir: get("--dir") ?? join("supabase", ".temp") };
}

export function main(argv, { read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null), log = console.log, summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    log(error.message);
    return 2;
  }
  const facts = inspectLink({
    projectRefText: read(join(args.dir, "project-ref")),
    poolerText: read(join(args.dir, "pooler-url")),
    expectedRef: args.expectedRef,
  });
  const lines = ["Supabase link diagnostic (safe facts only; no file contents are printed):", ...render(facts).map((l) => `  ${l}`)];
  if (!facts.project_ref_matches_expected) {
    lines.push("The linked project-ref does not match SUPABASE_PROJECT_REF. Refusing (fail closed).");
    log(lines.join("\n"));
    return 1;
  }
  log(lines.join("\n"));
  if (summaryFile) appendFileSync(summaryFile, `### Supabase link diagnostic\n\n\`\`\`\n${render(facts).join("\n")}\n\`\`\`\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
