import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { migrateBatch } from "./media-storage.mjs";
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const sharp = require("sharp");
const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
const row = { namespace: "portfolio", object_key: "fixture.png", source_exists: true, migration_tracked: true, provider: "supabase", content_type: "image/png", max_bytes: 5242880 };
function fixture() {
  const calls = [];
  return { calls, io: { sourceBytes: async () => bytes,
    writeDestination: async () => calls.push("copy"), destinationBytes: async () => bytes,
    switchReference: async (_row, _verified, rollback) => calls.push(rollback ? "rollback" : "switch") } };
}
test("default dry-run performs no copy or reference mutation", async () => {
  const { calls, io } = fixture();
  assert.equal((await migrateBatch([row], io)).skipped, 1);
  assert.deepEqual(calls, []);
});
test("missing source is never counted as a migrated object", async () => {
  const { calls, io } = fixture();
  const result = await migrateBatch([{ ...row, source_exists: false }], io, { execute: true });
  assert.equal(result.missing, 1); assert.equal(result.switched, 0); assert.deepEqual(calls, []);
});
test("destination mismatch leaves the provider reference untouched", async () => {
  const { calls, io } = fixture(); io.destinationBytes = async () => new Uint8Array([1,2,3]);
  const result = await migrateBatch([row], io, { execute: true });
  assert.equal(result.failed, 1); assert.deepEqual(calls, ["copy"]);
});
test("verified copies switch only after integrity verification", async () => {
  const { calls, io } = fixture();
  assert.equal((await migrateBatch([row], io, { execute: true })).switched, 1);
  assert.deepEqual(calls, ["copy", "switch"]);
});
test("restart skips already switched records", async () => {
  const { calls, io } = fixture();
  assert.equal((await migrateBatch([{ ...row, provider: "r2" }], io, { execute: true })).skipped, 1);
  assert.deepEqual(calls, []);
});

test("native R2 objects need no legacy source and are never eligible for rollback", async () => {
  const { calls, io } = fixture();
  const native = { ...row, namespace: "product", provider: "r2", source_exists: false, migration_tracked: false };
  assert.equal((await migrateBatch([native], io, { execute: true })).skipped, 1);
  assert.equal((await migrateBatch([native], io, { execute: true, rollback: true })).skipped, 1);
  assert.deepEqual(calls, []);
});
test("rollback verifies retained source and never deletes or rewrites an object", async () => {
  const { calls, io } = fixture();
  assert.equal((await migrateBatch([{ ...row, provider: "r2" }], io, { execute: true, rollback: true })).switched, 1);
  assert.deepEqual(calls, ["rollback"]);
});
test("interruption after copy can be retried without switching invalid data", async () => {
  const { calls, io } = fixture(); const original = io.switchReference;
  io.switchReference = async () => { throw new Error("interrupted"); };
  assert.equal((await migrateBatch([row], io, { execute: true })).failed, 1);
  io.switchReference = original;
  assert.equal((await migrateBatch([row], io, { execute: true })).switched, 1);
  assert.deepEqual(calls, ["copy", "copy", "switch"]);
});
