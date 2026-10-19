import {
  VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, VIDEO_PARTS_PER_REQUEST, VIDEO_UPLOAD_CONCURRENCY,
  isVideoType, type VideoContentType, type VideoScope,
} from "@/lib/media/video-policy";

/**
 * The browser side of a video upload. Bytes go from the file straight to R2
 * through part URLs the server signs; the app server never sees them.
 *
 *   * PROGRESS is per byte (XMLHttpRequest upload events), summed over parts.
 *   * RETRY: each part is retried with backoff (1, 2, 4, 8 s); an expired part
 *     URL is simply re-signed on the next attempt.
 *   * RESUME: the upload id is remembered per file (name, size, mtime). Choosing
 *     the same file again asks the server which parts R2 already holds and sends
 *     only the rest. Nothing about the file is stored except that fingerprint.
 */
export type UploadErrorCode = "type" | "size" | "duration" | "unreadable" | "network" | "server" | "limit"
  | "not_allowed" | "rate_limited" | "aborted";
export class UploadFailure extends Error {
  constructor(readonly code: UploadErrorCode) { super(code); }
}

type Plan = { id: string; partBytes: number; partCount: number; uploaded: number[]; state?: string };
type Fetcher = typeof fetch;

const RESUME_KEY = "aladdin.video-upload.v1";
const RETRIES = 4;

export function fileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function readResume(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function writeResume(map: Record<string, string>) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(map)); } catch { /* private mode: no resume */ }
}
export function rememberUpload(file: File, id: string | null) {
  const map = readResume();
  if (id) map[fileFingerprint(file)] = id; else delete map[fileFingerprint(file)];
  writeResume(map);
}
export function rememberedUpload(file: File): string | null {
  return readResume()[fileFingerprint(file)] ?? null;
}

/** Type, size and (from the file's own metadata) duration, before any byte is sent. */
export async function checkVideoFile(file: File, probeDuration: (file: File) => Promise<number | null> = probe): Promise<VideoContentType> {
  if (!isVideoType(file.type)) throw new UploadFailure("type");
  if (file.size <= 0 || file.size > VIDEO_MAX_BYTES) throw new UploadFailure("size");
  const seconds = await probeDuration(file);
  // A container the browser cannot read is left to the server-side probe.
  if (seconds !== null && seconds > VIDEO_MAX_SECONDS + 0.5) throw new UploadFailure("duration");
  return file.type;
}

function probe(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => { URL.revokeObjectURL(url); resolve(value); };
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 10_000);
    video.src = url;
  });
}

async function api<T>(fetcher: Fetcher, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, { method: init?.method ?? "GET", credentials: "same-origin",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
  } catch { throw new UploadFailure("network"); }
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    const map: Record<string, UploadErrorCode> = { limit: "limit", not_allowed: "not_allowed", rate_limited: "rate_limited",
      invalid: "server", incomplete: "server", not_found: "server", unavailable: "server" };
    throw new UploadFailure(map[body.error ?? ""] ?? "server");
  }
  return body;
}

export type PutPart = (url: string, blob: Blob, onProgress: (sent: number) => void, signal: AbortSignal) => Promise<void>;

/** XMLHttpRequest, because fetch() reports no upload progress. */
export const xhrPut: PutPart = (url, blob, onProgress, signal) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("PUT", url);
  xhr.upload.onprogress = (event) => onProgress(event.loaded);
  xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadFailure("network")));
  xhr.onerror = () => reject(new UploadFailure("network"));
  xhr.onabort = () => reject(new UploadFailure("aborted"));
  signal.addEventListener("abort", () => xhr.abort(), { once: true });
  xhr.send(blob);
});

export type UploadOptions = {
  file: File; title: string; scope: VideoScope; productId?: string;
  onProgress: (fraction: number) => void; signal: AbortSignal;
  fetcher?: Fetcher; putPart?: PutPart; sleep?: (ms: number) => Promise<void>;
  probeDuration?: (file: File) => Promise<number | null>;
};

/** Uploads (or resumes) one file and returns the video id once processing is queued. */
export async function uploadVideo(options: UploadOptions): Promise<string> {
  const { file, signal } = options;
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const putPart = options.putPart ?? xhrPut;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const contentType = await checkVideoFile(file, options.probeDuration);

  let plan: Plan | null = null;
  const previous = rememberedUpload(file);
  if (previous) {
    plan = await api<Plan>(fetcher, `/api/video/uploads/${previous}`).catch(() => null);
    if (plan && plan.state !== "uploading") plan = null;
  }
  if (!plan) {
    plan = await api<Plan>(fetcher, "/api/video/uploads", { method: "POST",
      body: { scope: options.scope, productId: options.productId, title: options.title, contentType, bytes: file.size } });
    rememberUpload(file, plan.id);
  }
  const { id, partBytes, partCount } = plan;
  const done = new Set(plan.uploaded);
  const sent = new Map<number, number>();
  const length = (n: number) => (n < partCount ? partBytes : file.size - partBytes * (partCount - 1));
  const report = () => {
    let bytes = 0;
    for (const n of done) bytes += length(n);
    for (const [n, b] of sent) if (!done.has(n)) bytes += b;
    options.onProgress(Math.min(1, bytes / file.size));
  };
  report();

  const pending = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const urls = new Map<number, string>();
  async function urlFor(n: number, fresh: boolean): Promise<string> {
    if (!fresh && urls.has(n)) return urls.get(n)!;
    // Sign this part and the next few still pending, in one request.
    const batch = [n, ...pending.filter((m) => m !== n && !done.has(m) && !urls.has(m))].slice(0, VIDEO_PARTS_PER_REQUEST);
    const { urls: signed } = await api<{ urls: Record<string, string> }>(fetcher, `/api/video/uploads/${id}/parts`, { method: "POST", body: { parts: batch } });
    for (const [k, v] of Object.entries(signed)) urls.set(Number(k), v);
    return urls.get(n)!;
  }

  async function sendPart(n: number) {
    const blob = file.slice((n - 1) * partBytes, (n - 1) * partBytes + length(n));
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw new UploadFailure("aborted");
      try {
        await putPart(await urlFor(n, attempt > 0), blob, (b) => { sent.set(n, b); report(); }, signal);
        done.add(n);
        report();
        return;
      } catch (error) {
        if (error instanceof UploadFailure && (error.code === "aborted" || error.code === "not_allowed" || error.code === "rate_limited")) throw error;
        if (attempt >= RETRIES) throw new UploadFailure("network");
        sent.delete(n);
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  const queue = [...pending];
  await Promise.all(Array.from({ length: Math.min(VIDEO_UPLOAD_CONCURRENCY, queue.length) }, async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) await sendPart(n);
  }));
  await api(fetcher, `/api/video/uploads/${id}/complete`, { method: "POST", body: {} });
  rememberUpload(file, null);
  return id;
}

export async function cancelUpload(id: string, fetcher: Fetcher = fetch.bind(globalThis)) {
  await api(fetcher, `/api/video/${id}`, { method: "DELETE" }).catch(() => undefined);
}
