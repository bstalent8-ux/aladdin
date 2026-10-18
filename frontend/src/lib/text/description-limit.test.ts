import { describe, expect, it } from "vitest";
import { DESCRIPTION_MAX_CHARS, checkDescription, isAcceptableEdit, normalizeDescription } from "./description-limit";

describe("description limit", () => {
  it("is 250 characters", () => {
    expect(DESCRIPTION_MAX_CHARS).toBe(250);
  });

  it("accepts exactly 250 and rejects 251 characters", () => {
    expect(checkDescription("a".repeat(250))).toEqual({ ok: true, value: "a".repeat(250) });
    expect(checkDescription("a".repeat(251))).toEqual({ ok: false, count: 251 });
  });

  it("counts an Arabic letter as one character, not bytes", () => {
    expect(checkDescription("ع".repeat(250)).ok).toBe(true);
    expect(checkDescription("ع".repeat(251)).ok).toBe(false);
  });

  it("counts an emoji as one character, like the database", () => {
    expect(checkDescription("😀".repeat(250)).ok).toBe(true);
    expect(checkDescription("😀".repeat(251)).ok).toBe(false);
  });

  it("counts a CRLF line break once", () => {
    const value = `${"a".repeat(125)}\r\n${"b".repeat(124)}`;
    expect(value.length).toBe(251);
    expect(checkDescription(value)).toEqual({ ok: true, value: `${"a".repeat(125)}\n${"b".repeat(124)}` });
  });

  it("clears whitespace-only input to null and never truncates", () => {
    expect(normalizeDescription("  \r\n ")).toBeNull();
    expect(normalizeDescription(null)).toBeNull();
    const long = "x".repeat(400);
    expect(checkDescription(long)).toEqual({ ok: false, count: 400 });
  });

  it("accepts an unchanged legacy over-limit value but not a changed one", () => {
    const legacy = "x".repeat(400);
    expect(isAcceptableEdit(legacy, legacy)).toBe(true);
    expect(isAcceptableEdit(`${legacy}
`, legacy)).toBe(true);
    expect(isAcceptableEdit("y".repeat(400), legacy)).toBe(false);
    expect(isAcceptableEdit("y".repeat(100), legacy)).toBe(true);
    expect(isAcceptableEdit("y".repeat(251), null)).toBe(false);
  });
});
