import "server-only";
import { createHmac } from "node:crypto";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStorageEnv } from "@/lib/env/storage";
import { applicationMediaUrl } from "@/lib/storage/media-url";
import { isOrganizationMedia } from "@/lib/storage/media-policy";
import { resolveMedia } from "./media";
import type { MediaNamespace, StorageProviderName } from "@/lib/storage/provider-types";

/**
 * Edge media tickets (ticket v1, shared with edge/media-worker/src/ticket.ts and
 * pinned by edge/media-worker/test/ticket-vectors.json).
 *
 * A ticket is NOT authority. It binds one object, variant, viewer, Auth session
 * and workspace for at most 120 s; the Worker re-runs the database authorization
 * (public.media_edge_authorize) on every request, so delete, unpublish, audience
 * change, suspension and sign-out deny the next request whatever the ticket says.
 */
export const TICKET_PREFIX = "aladdin.media-edge.v1.";
export type EdgeVariant = "original" | "thumb" | "card" | "full";
export type TicketClaims = {
  v: 1; ns: MediaNamespace; k: string; var: EdgeVariant;
  sub: string; sid: string; ws: string | null; exp: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Canonical field order; must stay byte-identical to the Worker's encoder. */
export function encodeClaims(c: TicketClaims): string {
  return JSON.stringify({ v: c.v, ns: c.ns, k: c.k, var: c.var, sub: c.sub, sid: c.sid, ws: c.ws, exp: c.exp });
}

export function mintTicket(kid: string, secret: Buffer, claims: TicketClaims): string {
  const payload = Buffer.from(encodeClaims(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(`${TICKET_PREFIX}${kid}.${payload}`).digest("base64url");
  return `${kid}.${payload}.${mac}`;
}

/**
 * Expiry rounded up to the next minute plus one: 60–120 s of life, and the same
 * URL for every render inside one minute (no image re-fetch on router.refresh()).
 */
export function ticketExpiry(nowMs: number): number {
  return Math.ceil(nowMs / 60_000) * 60 + 60;
}

type EdgeConfig = { origin: string; kid: string; secret: Buffer; publicEnabled: boolean };

/** Null while edge delivery is off; the schema fails fast if it is on but incomplete. */
export function edgeConfig(): EdgeConfig | null {
  const env = readStorageEnv();
  if (!env.MEDIA_EDGE_DELIVERY_ENABLED) return null;
  return { origin: env.MEDIA_EDGE_ORIGIN!.replace(/\/$/, ""), kid: env.MEDIA_EDGE_TICKET_KID!,
    secret: Buffer.from(env.MEDIA_EDGE_TICKET_SECRET!, "base64url"), publicEnabled: env.MEDIA_EDGE_PUBLIC_ENABLED };
}

/**
 * The verified viewer and Auth session behind this request, once per request
 * (React cache keyed by the caller's client). Null means no edge ticket.
 */
export const edgeViewer = cache(async (client: SupabaseClient): Promise<{ sub: string; sid: string } | null> => {
  const { data, error } = await client.auth.getClaims();
  const sub = data?.claims?.sub;
  const sid = data?.claims?.session_id;
  if (error || typeof sub !== "string" || typeof sid !== "string" || !UUID.test(sub) || !UUID.test(sid)) return null;
  return { sub, sid };
});

/**
 * The URL rendering code receives for media the caller is ALREADY authorized to
 * read: an edge URL with a fresh ticket for R2 rows while edge delivery is on,
 * otherwise the unchanged application proxy URL.
 */
export async function privateMediaUrl(client: SupabaseClient, namespace: MediaNamespace, key: string,
  provider: StorageProviderName, options: { workspace?: string | null; variant?: EdgeVariant; nowMs?: number } = {}): Promise<string> {
  const config = provider === "r2" ? edgeConfig() : null;
  const viewer = config ? await edgeViewer(client) : null;
  if (!config || !viewer) return applicationMediaUrl(namespace, key, options.workspace);
  const variant = options.variant ?? "original";
  const ws = namespace === "product" || namespace === "organization" ? options.workspace ?? null : null;
  const ticket = mintTicket(config.kid, config.secret, { v: 1, ns: namespace, k: key, var: variant,
    sub: viewer.sub, sid: viewer.sid, ws, exp: ticketExpiry(options.nowMs ?? Date.now()) });
  return `${config.origin}/m/${namespace}/${variant}?t=${ticket}`;
}

/**
 * `readMediaUrl` (server/storage/media.ts) with the provider-aware URL switch:
 * the same caller-scoped resolve and ownership rule, then an edge or proxy URL.
 */
export async function readableMediaUrl(client: SupabaseClient, namespace: MediaNamespace, key: string): Promise<string> {
  const media = await resolveMedia(client, namespace, key, "read");
  if ((!isOrganizationMedia(namespace) && !media.owner) || media.state !== "ready") throw new Error("media unavailable");
  return privateMediaUrl(client, namespace, key, media.provider);
}

/**
 * Public media by opaque id (portfolio item id, listed profile id). Edge URLs
 * carry no ticket and no key: the Worker re-checks eligibility on every request.
 */
export function publicMediaUrl(namespace: "portfolio" | "avatar", id: string, onEdge: boolean, variant: EdgeVariant = "original"): string | null {
  const config = onEdge ? edgeConfig() : null;
  if (config?.publicEnabled) return `${config.origin}/c/${namespace}/${id}/${variant}`;
  return namespace === "portfolio" ? `/p/media/${id}` : null;
}

/** Ids among `ids` that are currently public AND stored on R2; empty while Mode C is off. */
export async function publicEdgeIds(client: SupabaseClient, namespace: "portfolio" | "avatar", ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0 || !edgeConfig()?.publicEnabled) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await client.rpc("public_media_edge_ids", { p_namespace: namespace, p_ids: ids.slice(i, i + 100) });
    if (error || !Array.isArray(data)) return new Set();
    for (const id of data) if (typeof id === "string") out.add(id);
  }
  return out;
}
