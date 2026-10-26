// Types for check-cloudflare-production.mjs (imported by its tests).
export const LIVE_SUPABASE_URL: string;
export const LIVE_HOSTNAMES: string[];
export function parseJsonc(text: string): Record<string, any>;
export function checkFrontend(config: Record<string, any>): string[];
export function checkBackend(config: Record<string, any>): string[];
export function jwtProjectRef(key: string): string | null;
export function checkLiveValues(values: Record<string, string | undefined>): string[];
