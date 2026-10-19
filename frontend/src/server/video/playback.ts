import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStorageEnv } from "@/lib/env/storage";
import { edgeConfig, edgeViewer, ticketExpiry } from "@/server/storage/edge-ticket";
import { mintVideoTicket } from "./ticket";

/**
 * Playback URLs. Video is delivered ONLY by the media Worker (`/v/<id>/...`):
 * there is no application-proxy fallback, because video bytes must never pass
 * through Vercel or Supabase. With video or edge delivery off, nothing plays.
 */
export type VideoSummary = {
  id: string;
  title: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasPoster: boolean;
};
export type VideoPlayback = VideoSummary & { src: string; poster: string | null };

export function videoEnabled(): boolean {
  return readStorageEnv().VIDEO_ENABLED && edgeConfig() !== null;
}

/** A published portfolio video: no ticket; the Worker re-checks publication on every request. */
export function publicVideoPlayback(video: VideoSummary): VideoPlayback | null {
  const config = videoEnabled() ? edgeConfig() : null;
  if (!config) return null;
  const base = `${config.origin}/v/${video.id}`;
  return { ...video, src: `${base}/master.m3u8`, poster: video.hasPoster ? `${base}/poster.jpg` : null };
}

/**
 * A video the caller may watch privately (their own, or a product video in the
 * caller's workspace). The page ticket lives 60–120 s; the Worker swaps it for a
 * play ticket when it serves the master playlist.
 */
export async function privateVideoPlayback(client: SupabaseClient, video: VideoSummary,
  options: { workspace?: string | null; nowMs?: number } = {}): Promise<VideoPlayback | null> {
  const config = videoEnabled() ? edgeConfig() : null;
  const viewer = config ? await edgeViewer(client) : null;
  if (!config || !viewer) return null;
  const ticket = mintVideoTicket(config.kid, config.secret, { v: 1, vid: video.id, sub: viewer.sub, sid: viewer.sid,
    ws: options.workspace ?? null, use: "page", exp: ticketExpiry(options.nowMs ?? Date.now()) });
  const base = `${config.origin}/v/${video.id}`;
  return { ...video, src: `${base}/master.m3u8?t=${ticket}`, poster: video.hasPoster ? `${base}/poster.jpg?t=${ticket}` : null };
}
