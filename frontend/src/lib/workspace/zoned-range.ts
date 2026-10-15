/**
 * The half-open UTC interval [start, end) covered by the calendar days `from`..`to` (inclusive, yyyy-mm-dd)
 * in an IANA timezone. This is the same window `showroom_home_metrics` computes in SQL
 * (`from::timestamp at time zone tz` .. `(to + 1)::timestamp at time zone tz`), so a figure counted in the
 * application and a figure counted by that function describe the same period.
 */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

/** The instant at which `date` (yyyy-mm-dd) starts in `timeZone`. */
export function startOfZonedDay(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  let instant = naive - offsetMinutes(naive, timeZone) * 60000;
  // One refinement handles a day whose start sits on the far side of a DST change.
  instant = naive - offsetMinutes(instant, timeZone) * 60000;
  return new Date(instant);
}

function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function zonedRange(from: string, to: string, timeZone: string): { start: string; end: string } {
  return { start: startOfZonedDay(from, timeZone).toISOString(), end: startOfZonedDay(nextDay(to), timeZone).toISOString() };
}
