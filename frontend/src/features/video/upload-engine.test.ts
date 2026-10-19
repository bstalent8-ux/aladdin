import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_MAX_BYTES } from "@/lib/media/video-policy";
import { UploadFailure, checkVideoFile, rememberUpload, rememberedUpload, uploadVideo, type PutPart } from "./upload-engine";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
});
const ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PART = 4;
const file = (bytes = 10, type = "video/mp4") => new File([new Uint8Array(bytes)], "clip.mp4", { type, lastModified: 1 });
const noProbe = async () => null;

function server(plan: { uploaded?: number[]; state?: string } = {}, resumeId: string | null = null) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init.method ?? "GET", body });
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (path === "/api/video/uploads") return reply({ id: ID, partBytes: PART, partCount: 3, uploaded: [] }, 201);
    if (resumeId && path === `/api/video/uploads/${resumeId}`) return reply({ id: resumeId, partBytes: PART, partCount: 3, uploaded: plan.uploaded ?? [], state: plan.state ?? "uploading" });
    if (path.endsWith("/parts")) return reply({ urls: Object.fromEntries((body.parts as number[]).map((n) => [n, `https://r2/${n}`])) });
    if (path.endsWith("/complete")) return reply({ state: "processing" });
    return reply({ error: "not_found" }, 404);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

beforeEach(() => store.clear());

describe("checkVideoFile", () => {
  it("refuses wrong types, empty and oversize files, and long durations before sending anything", async () => {
    await expect(checkVideoFile(file(10, "video/x-msvideo"), noProbe)).rejects.toMatchObject({ code: "type" });
    await expect(checkVideoFile(file(0), noProbe)).rejects.toMatchObject({ code: "size" });
    await expect(checkVideoFile({ type: "video/mp4", size: VIDEO_MAX_BYTES + 1 } as File, noProbe)).rejects.toMatchObject({ code: "size" });
    await expect(checkVideoFile(file(), async () => 301)).rejects.toMatchObject({ code: "duration" });
    expect(await checkVideoFile(file(), async () => 300)).toBe("video/mp4");
  });
});

describe("uploadVideo", () => {
  it("sends every part with exact slices, reports progress to 100% and completes", async () => {
    const { fetcher, calls } = server();
    const sent: [string, number][] = [];
    const putPart: PutPart = async (url, blob, onProgress) => { sent.push([url, blob.size]); onProgress(blob.size); };
    const progress: number[] = [];
    const id = await uploadVideo({ file: file(10), title: "t", scope: "portfolio", onProgress: (f) => progress.push(f),
      signal: new AbortController().signal, fetcher, putPart, probeDuration: noProbe });
    expect(id).toBe(ID);
    expect(sent.sort()).toEqual([["https://r2/1", 4], ["https://r2/2", 4], ["https://r2/3", 2]]);
    expect(progress.at(-1)).toBe(1);
    expect(calls.at(-1)).toMatchObject({ path: `/api/video/uploads/${ID}/complete`, method: "POST" });
    expect(rememberedUpload(file(10))).toBeNull();
  });

  it("retries a failed part with a freshly signed URL and backoff", async () => {
    const { fetcher, calls } = server();
    let failures = 1;
    const putPart: PutPart = async (url) => { if (url.endsWith("/2") && failures-- > 0) throw new UploadFailure("network"); };
    const sleep = vi.fn(async () => undefined);
    await uploadVideo({ file: file(10), title: "t", scope: "portfolio", onProgress: () => undefined,
      signal: new AbortController().signal, fetcher, putPart, sleep, probeDuration: noProbe });
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(calls.filter((c) => c.path.endsWith("/parts")).length).toBeGreaterThanOrEqual(2);
  });

  it("gives up after four retries and keeps the upload for resume", async () => {
    const { fetcher } = server();
    const putPart: PutPart = async () => { throw new UploadFailure("network"); };
    await expect(uploadVideo({ file: file(10), title: "t", scope: "portfolio", onProgress: () => undefined,
      signal: new AbortController().signal, fetcher, putPart, sleep: async () => undefined, probeDuration: noProbe }))
      .rejects.toMatchObject({ code: "network" });
    expect(rememberedUpload(file(10))).toBe(ID);
  });

  it("resumes: sends only the parts the server does not hold", async () => {
    const resumeId = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
    rememberUpload(file(10), resumeId);
    const { fetcher, calls } = server({ uploaded: [1, 3] }, resumeId);
    const sent: string[] = [];
    await uploadVideo({ file: file(10), title: "t", scope: "portfolio", onProgress: () => undefined,
      signal: new AbortController().signal, fetcher, putPart: async (url) => void sent.push(url), probeDuration: noProbe });
    expect(sent).toEqual(["https://r2/2"]);
    expect(calls.some((c) => c.path === "/api/video/uploads")).toBe(false);
  });

  it("starts over when the remembered upload is no longer open", async () => {
    const resumeId = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
    rememberUpload(file(10), resumeId);
    const { fetcher, calls } = server({ state: "expired" }, resumeId);
    await uploadVideo({ file: file(10), title: "t", scope: "portfolio", onProgress: () => undefined,
      signal: new AbortController().signal, fetcher, putPart: async () => undefined, probeDuration: noProbe });
    expect(calls.some((c) => c.path === "/api/video/uploads" && c.method === "POST")).toBe(true);
  });

  it("stops at once when paused, and on a server refusal", async () => {
    const { fetcher } = server();
    const controller = new AbortController();
    controller.abort();
    await expect(uploadVideo({ file: file(10), title: "t", scope: "portfolio", onProgress: () => undefined,
      signal: controller.signal, fetcher, putPart: async () => undefined, probeDuration: noProbe })).rejects.toMatchObject({ code: "aborted" });
    const refusing = (async () => new Response(JSON.stringify({ error: "limit" }), { status: 409 })) as unknown as typeof fetch;
    await expect(uploadVideo({ file: file(10, "video/webm"), title: "t", scope: "portfolio", onProgress: () => undefined,
      signal: new AbortController().signal, fetcher: refusing, probeDuration: noProbe })).rejects.toMatchObject({ code: "limit" });
  });
});
