import { countChars } from "./count-chars";

/**
 * The one limit for every user-authored DESCRIPTION field (business, bio, product, offer, portfolio item).
 * It is a CHARACTER limit counted like the database's `char_length` (Unicode code points, a line break once) -
 * not bytes, not words. Technical specifications, names, notes, messages and legal text are different fields
 * and do not use it. The database re-checks every write (`app.description_text`, `app.enforce_description_limit`).
 */
export const DESCRIPTION_MAX_CHARS = 250;

/** Line breaks as LF, edges trimmed, empty -> null. Never cuts text: an over-limit value is reported, not shortened. */
export function normalizeDescription(raw: string | null | undefined): string | null {
  const value = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  return value === "" ? null : value;
}

/** For schema refinements: true when the (trimmed, LF-normalised) text fits. Empty always fits. */
export function isWithinDescriptionLimit(raw: string | null | undefined): boolean {
  return checkDescription(raw).ok;
}

/**
 * For an EDIT of an existing value: an over-limit text is only a problem when the person changed it. A legacy value
 * that is already stored longer than the limit stays savable (and is never cut); changing it must fit.
 */
export function isAcceptableEdit(next: string | null | undefined, stored: string | null | undefined): boolean {
  return isWithinDescriptionLimit(next) || normalizeDescription(next) === normalizeDescription(stored);
}

export type DescriptionCheck = { ok: true; value: string | null } | { ok: false; count: number };

export function checkDescription(raw: string | null | undefined, max: number = DESCRIPTION_MAX_CHARS): DescriptionCheck {
  const value = normalizeDescription(raw);
  if (value === null) return { ok: true, value: null };
  const count = countChars(value);
  return count > max ? { ok: false, count } : { ok: true, value };
}
