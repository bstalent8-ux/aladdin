/**
 * Offer dates are instants (timestamptz). The owner types a date and a time in THEIR
 * business time zone; these helpers convert to and from the instant without trusting the
 * browser's own zone, so the same offer means the same moment for everyone.
 */
export const DEFAULT_OFFER_TIMEZONE = "Africa/Cairo";

function validZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_OFFER_TIMEZONE;
  }
}

/** The zone's offset from UTC (ms) at a given instant. */
function offsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/** "2026-10-15" + "10:00" in `zone` -> ISO instant, or null when the input is not a real date/time. */
export function zonedToUtcIso(date: string, time: string, zone: string): string | null {
  const d = DATE.exec(date);
  const t = TIME.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, hh, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return null;
  const z = validZone(zone);
  const wall = Date.UTC(y, mo - 1, da, hh, mi);
  // A real calendar date (rejects 2026-02-31).
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da) return null;
  // The offset depends on the instant itself (daylight saving), so settle it in two passes.
  let guess = wall - offsetMs(wall, z);
  guess = wall - offsetMs(guess, z);
  return new Date(guess).toISOString();
}

/** ISO instant -> the date/time fields an input shows, in `zone`. */
export function utcToZonedFields(iso: string, zone: string): { date: string; time: string } {
  const z = validZone(zone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: z,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** "15 October 2026" in the reader's language, Latin digits (same convention as the rest of the suite's figures). */
export function formatOfferDate(iso: string, locale: "ar" | "en", zone: string = DEFAULT_OFFER_TIMEZONE): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    timeZone: validZone(zone),
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}
