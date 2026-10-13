#!/usr/bin/env node
/**
 * Safe, read-only probe of the Management API call that `supabase link` makes to learn the project's pooler URL.
 *
 * WHY. In Supabase CLI 2.110.0 (apps/cli/src/legacy/shared/legacy-link-services-core.ts, tag v2.110.0) `supabase link` runs
 * `linkPooler` as part of its BEST-EFFORT service links. linkPooler:
 *     configs = GET /v1/projects/{ref}/config/database/pooler          (expected 200, a JSON ARRAY of pooler configs)
 *     primary = configs.find(c => c.database_type === "PRIMARY")        (none -> return, writes nothing)
 *     write supabase/.temp/pooler-url = primary.connection_string       (placeholder stripped; port 5432 unless session mode)
 * and the whole thing is piped through `Effect.ignore`. So ANY failure (network, 401/403/404, an unexpected status, a response
 * that does not decode, no PRIMARY entry) leaves NO pooler-url while `supabase link` still prints "Finished supabase link." and
 * writes project-ref. This script performs the SAME request with the SAME token and reports, in a closed vocabulary, which
 * of those it is.
 *
 * READ ONLY and SECRET-SAFE. One GET. It sends the access token only as the Authorization header and never prints it, a header,
 * a response body, a connection string, a host, user, password, an organisation id, or any server-supplied string, nor an
 * exception message (a fetch error can embed a URL). The response body is read ONLY on HTTP 200 and only to compute
 * the booleans / counts / enumerations below; for every other status the body is never read. A short timeout bounds it.
 *
 * Exit codes: 0 = observed (a finding such as 403 is still exit 0); 2 = malformed invocation (missing token / bad project ref).
 *
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/supabase-pooler-api-diagnostic.mjs
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const API_BASE = "https://api.supabase.com";
const TIMEOUT_MS = 10_000;
const REF = /^[a-z0-9]{10,40}$/i;

export const VERDICTS = [
  "request_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "unexpected_status",
  "malformed_response",
  "no_primary",
  "primary_missing_connection_string",
  "looks_valid",
];

/** The route the CLI uses (apps/cli-e2e recorded fixture + legacy-link-services-core.ts at v2.110.0). */
export const poolerConfigPath = (ref) => `/v1/projects/${ref}/config/database/pooler`;

function emptyFacts() {
  return {
    pooler_api_request_completed: false,
    pooler_api_http_status: "n/a",
    pooler_api_success_status: false,
    pooler_api_json_parseable: "n/a",
    pooler_api_entry_count: "n/a",
    pooler_api_primary_found: false,
    pooler_api_primary_connection_string_present: false,
    pooler_api_primary_pool_mode: "unknown",
    pooler_api_verdict: "request_failed",
  };
}

/**
 * Perform the probe. `fetchImpl` is injectable for tests. Returns ONLY the closed-vocabulary facts.
 * Nothing thrown by fetch (or by reading the body) ever leaves this function.
 */
export async function probe({ token, ref, fetchImpl = globalThis.fetch }) {
  const facts = emptyFacts();
  let response;
  try {
    response = await fetchImpl(`${API_BASE}${poolerConfigPath(ref)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return facts; // request_failed: no message, no error object
  }
  const status = Number(response?.status);
  facts.pooler_api_request_completed = true;
  facts.pooler_api_http_status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : "n/a";
  facts.pooler_api_success_status = status === 200;

  if (status === 401) return { ...facts, pooler_api_verdict: "unauthorized" };
  if (status === 403) return { ...facts, pooler_api_verdict: "forbidden" };
  if (status === 404) return { ...facts, pooler_api_verdict: "not_found" };
  if (status !== 200) return { ...facts, pooler_api_verdict: "unexpected_status" };

  let body;
  try {
    body = await response.json();
    facts.pooler_api_json_parseable = true;
  } catch {
    return { ...facts, pooler_api_json_parseable: false, pooler_api_verdict: "malformed_response" };
  }
  if (!Array.isArray(body)) return { ...facts, pooler_api_verdict: "malformed_response" };
  facts.pooler_api_entry_count = body.length;

  const primary = body.find((entry) => entry !== null && typeof entry === "object" && entry.database_type === "PRIMARY");
  if (primary === undefined) return { ...facts, pooler_api_verdict: "no_primary" };
  facts.pooler_api_primary_found = true;
  facts.pooler_api_primary_pool_mode = primary.pool_mode === "session" || primary.pool_mode === "transaction" ? primary.pool_mode : "unknown";
  facts.pooler_api_primary_connection_string_present = typeof primary.connection_string === "string" && primary.connection_string.trim() !== "";
  facts.pooler_api_verdict = facts.pooler_api_primary_connection_string_present ? "looks_valid" : "primary_missing_connection_string";
  return facts;
}

export const render = (facts) => Object.entries(facts).map(([k, v]) => `${k}=${v}`);

export async function main(argv, { env = process.env, fetchImpl = globalThis.fetch, log = console.log, summaryFile = env.GITHUB_STEP_SUMMARY } = {}) {
  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.SUPABASE_PROJECT_REF;
  if (argv.length > 0 || typeof token !== "string" || token.trim() === "" || typeof ref !== "string" || !REF.test(ref)) {
    log("usage: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be set (no arguments); nothing was requested.");
    return 2;
  }
  const facts = await probe({ token, ref, fetchImpl });
  const lines = render(facts);
  log(["Supabase pooler Management API diagnostic (safe facts only; no response content is printed):", ...lines.map((l) => `  ${l}`)].join("\n"));
  if (summaryFile) appendFileSync(summaryFile, `### Supabase pooler Management API diagnostic\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
