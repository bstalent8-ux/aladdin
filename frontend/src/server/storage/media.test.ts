import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
const adminRpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: adminRpc, storage: { from: () => ({ createSignedUrl: sign, remove }) } }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" }) }));
const settings = vi.hoisted(() => ({ R2_STORAGE_ENABLED: false, SUPABASE_SERVICE_ROLE_KEY: "test-only-key" }));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => settings }));
const r2Upload = vi.hoisted(() => vi.fn());
vi.mock("./r2-provider", () => ({ CloudflareR2StorageProvider: class { createUploadUrl = r2Upload; } }));
import { authorizeMediaUpload, readMediaUrl, removeMedia, verifyPendingMedia } from "./media";

const OWNER = "70000009-0000-4000-8000-000000000009";
const rpc = vi.fn(); const sign = vi.fn(); const remove = vi.fn(); const upload = vi.fn();
// Controlled caller-scoped client: no network or shared data.
const client = { rpc, storage: { from: () => ({ createSignedUrl: sign, remove, createSignedUploadUrl: upload }) } } as unknown as ReturnType<typeof createClient>;
const pending = { provider: "supabase", reserved: true, contentType: "image/png", state: "pending", owner: OWNER };
beforeEach(() => {
  vi.clearAllMocks(); settings.R2_STORAGE_ENABLED = false;
  rpc.mockResolvedValue({ data: pending, error: null });
  sign.mockResolvedValue({ data: { signedUrl: "https://test.invalid/image" }, error: null });
  adminRpc.mockResolvedValue({ error: null });
});

describe("mixed-provider authorization and finalization", () => {
  it("verifies organization pending bytes through upload authority without granting pending reads", async () => {
    rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "read" ? null : pending, error: null }));
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
    await verifyPendingMedia(client, "product", "key.png");
    expect(rpc).not.toHaveBeenCalledWith("organization_media_resolve", expect.objectContaining({ p_operation: "read" }));
    expect(adminRpc).toHaveBeenCalledWith("media_storage_attest", expect.objectContaining({ p_namespace: "product", p_size: bytes.length }));
  });
  it("refuses missing bytes without writing a verification receipt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(verifyPendingMedia(client, "portfolio", "key.png")).rejects.toThrow();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("records trustworthy actual size/hash only after full content validation", async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
    await verifyPendingMedia(client, "portfolio", "key.png");
    expect(adminRpc).toHaveBeenCalledWith("media_storage_attest", expect.objectContaining({
      p_owner: OWNER, p_size: bytes.length, p_content_type: "image/png", p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
  it("blocks wrong-type bytes and authorization refusal before privileged writes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<script>bad</script>")));
    await expect(verifyPendingMedia(client, "certificate", "key.pdf")).rejects.toThrow();
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(authorizeMediaUpload(client, "avatar", "foreign.jpg")).rejects.toThrow();
    await expect(removeMedia(client, "avatar", "foreign.jpg")).rejects.toThrow();
    expect(adminRpc).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("preserves Supabase reads when routing is enabled, and R2 reads when it is disabled", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: { ...pending, state: "ready" }, error: null });
    expect(await readMediaUrl(client, "portfolio", "key.png")).toContain("/api/media/portfolio?key=");
    settings.R2_STORAGE_ENABLED = false;
    rpc.mockResolvedValue({ data: { ...pending, provider: "r2" }, error: null });
    r2Upload.mockResolvedValue({ provider: "r2", url: "https://r2.test/pending" });
    expect((await authorizeMediaUpload(client, "portfolio", "key.png", 93)).provider).toBe("r2");
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("does not reverify legacy ready objects on an idempotent retry", async () => {
    rpc.mockResolvedValue({ data: { ...pending, state: "ready" }, error: null });
    await verifyPendingMedia(client, "portfolio", "key.png");
    expect(sign).not.toHaveBeenCalled(); expect(adminRpc).not.toHaveBeenCalled();
  });
});
