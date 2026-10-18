import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { readMaintenanceEnv } from "../frontend/src/lib/env/media-maintenance.mjs";
import { readBoundedBody, verifyMediaBytes } from "../frontend/src/server/storage/content-validation.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Bounded, restartable, single-write migration. Nothing changes in the default dry-run. */
export async function migrateBatch(rows, io, { execute = false, rollback = false } = {}) {
  const result = { inspected: rows.length, missing: 0, copied: 0, switched: 0, skipped: 0, failed: 0 };
  for (const row of rows) {
    if (rollback && !row.migration_tracked) { result.skipped++; continue; }
    if (!rollback && row.provider === "r2") { result.skipped++; continue; }
    if (!row.source_exists) { result.missing++; continue; }
    if (!execute) { result.skipped++; continue; }
    try {
      const source = await io.sourceBytes(row);
      const verified = await verifyMediaBytes(source, row.content_type, row.max_bytes);
      if (!rollback) {
        await io.writeDestination(row, source);
        const destination = await io.destinationBytes(row);
        if (destination.length !== source.length || hash(destination) !== verified.sha256) throw new Error("checksum mismatch");
        result.copied++;
      }
      await io.switchReference(row, verified, rollback);
      result.switched++;
    } catch {
      // Continue independent rows; never log signed URLs, credentials, filenames or private content.
      result.failed++;
    }
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const execute = args.includes("--execute");
  const rollback = args.includes("--rollback");
  const cleanup = args.includes("--cleanup");
  if (cleanup && rollback) throw new Error("Choose cleanup or rollback");
  const value = (name, fallback) => args[args.indexOf(name) + 1] ?? fallback;
  if (args.includes("--help")) {
    console.log("node scripts/media-storage.mjs --project <ref|local> [--limit 25] [--after cursor] [--execute] [--rollback|--cleanup]");
    console.log("Dry-run is the default. --execute permits copies/reference changes; cleanup deletes ONLY R2 objects. Production execution is blocked.");
    return;
  }
  if (!args.includes("--project")) throw new Error("Explicit --project is required");
  const env = readMaintenanceEnv();
  const url = new URL(env.SUPABASE_URL);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  const project = local ? "local" : url.hostname.split(".")[0];
  if (value("--project") !== project) throw new Error("Requested project does not match configured environment");
  if (execute && !local && project !== "kkpkgjrweysgvhvkhzun") throw new Error("Production execution requires separate verified approval");
  const limit = Number(args.includes("--limit") ? value("--limit") : 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be 1..100");
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error } = await supabase.rpc(cleanup ? "media_cleanup_candidates" : "media_migration_inventory",
    cleanup ? { p_limit: limit } : { p_limit: limit, p_after: args.includes("--after") ? value("--after") : "" });
  if (error) throw new Error("Inventory query failed; confirm the provider migration is installed in the selected environment");
  if (!execute) {
    const { data: inventory, error: inventoryError } = await supabase.rpc("media_source_inventory_summary");
    if (inventoryError) throw new Error("Source inventory failed");
    console.log(JSON.stringify({ dryRun: true, project, sourceInventory: inventory, inspected: rows.length,
      missing: rows.filter((row) => !cleanup && row.provider !== "r2" && !row.source_exists).length,
      providers: rows.reduce((counts, row) => ({ ...counts, [row.provider]: (counts[row.provider] ?? 0) + 1 }), {}),
      nextCursor: rows.at(-1)?.cursor_key ?? null }));
    return;
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PRIVATE_BUCKET) throw new Error("R2 settings are required for execution");
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const s3 = new S3Client({ region: "auto", forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 3, requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 } });
  const key = (row) => `${row.namespace}/${row.object_key}`;
  const buckets = { avatar: "avatars", portfolio: "professional-portfolio", certificate: "professional-certificates",
    product: "product-images", organization: "organization-images" };
  if (cleanup) {
    let retired = 0;
    for (const row of rows) {
      if (row.provider !== "r2") continue; // Legacy source objects are never removed by this tool.
      const { error: retireError } = await supabase.rpc("media_cleanup_retire", {
        p_namespace: row.namespace, p_key: row.object_key, p_owner: row.owner_user_id,
      });
      if (retireError) continue;
      for (const objectKey of [key(row), `pending/${key(row)}`]) {
        await s3.send(new DeleteObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: objectKey }));
      }
      const { error: completeError } = await supabase.rpc("media_cleanup_complete", {
        p_namespace: row.namespace, p_key: row.object_key, p_owner: row.owner_user_id,
      });
      if (completeError) throw new Error("Cleanup completion failed; retry safely");
      retired++;
    }
    console.log(JSON.stringify({ project, retired, preservedLegacy: rows.filter((row) => row.provider === "supabase").length }));
    return;
  }
  const io = {
    sourceBytes: async (row) => {
      const { data, error: signError } = await supabase.storage.from(buckets[row.namespace]).createSignedUrl(row.object_key, 60);
      if (signError || !data?.signedUrl) throw new Error("Source missing");
      return readBoundedBody(await fetch(data.signedUrl, { signal: AbortSignal.timeout(30_000), cache: "no-store" }), row.max_bytes);
    },
    writeDestination: async (row, bytes) => {
      try { await s3.send(new PutObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key(row), Body: bytes,
        ContentType: row.content_type, CacheControl: "private, no-store", IfNoneMatch: "*" })); }
      catch (error) { if (error?.$metadata?.httpStatusCode !== 412) throw error; }
    },
    destinationBytes: async (row) => {
      const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key(row) }), { expiresIn: 60 });
      return readBoundedBody(await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" }), row.max_bytes);
    },
    switchReference: async (row, verified, undo) => {
      const { error: switchError } = await supabase.rpc(undo ? "media_migration_rollback" : "media_migration_switch", {
        p_namespace: row.namespace, p_key: row.object_key, p_sha256: verified.sha256,
        ...(!undo ? { p_owner: row.owner_user_id, p_size: verified.size, p_content_type: verified.contentType } : {}),
      });
      if (switchError) throw new Error("Reference switch refused");
    },
  };
  const result = await migrateBatch(rows, io, { execute, rollback });
  console.log(JSON.stringify({ project, ...result, nextCursor: rows.at(-1)?.cursor_key ?? null }));
  if (result.failed || result.missing) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Media maintenance failed; verify selected environment, settings, and permissions. No source deletion was attempted."); process.exitCode = 1; });
}
