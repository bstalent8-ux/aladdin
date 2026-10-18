/**
 * The text a search box sends to the server: Unicode-normalised, trimmed, with runs of whitespace collapsed.
 * Letter case is deliberately NOT changed here — the database matches case-insensitively (ILIKE), so
 * "interior", "INTERIOR" and "iNtErIoR" all find "Interior Wall Paint" and "fx-sara-58" finds "FX-SARA-58".
 */
export function normalizeSearchInput(raw: string | null | undefined, max = 100): string {
  return (raw ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max);
}

/** How long typing must pause before a live search asks the server. */
export const LIVE_SEARCH_DEBOUNCE_MS = 300;
