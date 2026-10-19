/**
 * Video limits shared by the browser (pre-upload checks), the server (signing)
 * and, as CHECK constraints, the database (20261019150000_media_videos.sql).
 * The database and the transcode worker are authoritative; the browser checks
 * only save a wasted upload.
 */
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 300;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type VideoContentType = (typeof VIDEO_TYPES)[number];
export const VIDEO_TITLE_MAX = 120;

/** Multipart part size. R2 needs at least 5 MiB for every part but the last. */
export const VIDEO_PART_BYTES = 8 * 1024 * 1024;
/** How many part URLs one signing request may ask for. */
export const VIDEO_PARTS_PER_REQUEST = 8;
/** Parallel part uploads in the browser. */
export const VIDEO_UPLOAD_CONCURRENCY = 3;

export type VideoScope = "portfolio" | "product";
export type VideoState = "uploading" | "processing" | "ready" | "failed" | "deleted";

export function isVideoType(value: unknown): value is VideoContentType {
  return typeof value === "string" && (VIDEO_TYPES as readonly string[]).includes(value);
}

export function videoPartCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / VIDEO_PART_BYTES));
}

/** Byte length of part `n` (1-based) of an upload of `bytes`. */
export function videoPartLength(bytes: number, n: number): number {
  const count = videoPartCount(bytes);
  if (!Number.isInteger(n) || n < 1 || n > count) throw new Error("part out of range");
  return n < count ? VIDEO_PART_BYTES : bytes - VIDEO_PART_BYTES * (count - 1);
}

/**
 * The container signature of the first bytes: ISO-BMFF (`ftyp` at offset 4) for
 * MP4 and QuickTime, EBML for WebM. The worker's ffprobe is the real check.
 */
export function videoSignatureMatches(contentType: VideoContentType, head: Uint8Array): boolean {
  if (contentType === "video/webm") {
    return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }
  return head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}
