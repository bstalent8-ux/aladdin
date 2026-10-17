import { describe, expect, it } from "vitest";
import { zonedRange, startOfZonedDay } from "./zoned-range";

describe("zonedRange", () => {
  it("maps calendar days to the organization's own midnight", () => {
    // Cairo is UTC+2 in January and UTC+3 during daylight saving time.
    expect(zonedRange("2026-01-10", "2026-01-10", "Africa/Cairo")).toEqual({ start: "2026-01-09T22:00:00.000Z", end: "2026-01-10T22:00:00.000Z" });
    expect(startOfZonedDay("2026-07-01", "Africa/Cairo").toISOString()).toBe("2026-06-30T21:00:00.000Z");
  });
  it("is inclusive of the last day and exclusive of the next", () => {
    const r = zonedRange("2026-01-01", "2026-01-31", "UTC");
    expect(r).toEqual({ start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" });
  });
  it("handles zones west of UTC", () => {
    expect(startOfZonedDay("2026-01-10", "America/New_York").toISOString()).toBe("2026-01-10T05:00:00.000Z");
  });
});
