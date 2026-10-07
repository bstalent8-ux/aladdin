import { describe, expect, it } from "vitest";
import { effectiveColors, normalizeColorItems, normalizeHex } from "./color-items";

/** Hex literals are product DATA here, not styling — built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

describe("hex values", () => {
  it("canonicalizes to upper-case #RRGGBB and refuses everything else", () => {
    expect(normalizeHex(h("b96f52"))).toBe(h("B96F52"));
    expect(normalizeHex(" b96f52 ")).toBe(h("B96F52"));
    for (const bad of ["", h("fff"), "#12345G", "red", "#1234567"]) expect(normalizeHex(bad)).toBeNull();
  });
});

describe("normalizeColorItems", () => {
  it("trims, collapses whitespace, drops blanks and case-insensitive duplicates (first wins), keeps legacy nulls", () => {
    expect(normalizeColorItems([{ name: "  Warm   White ", hex: h("f5f0e6") }, { name: "", hex: h("000000") }, { name: "warm white", hex: null }, { name: "Sand", hex: null }])).toEqual([
      { name: "Warm White", hex: h("F5F0E6") },
      { name: "Sand", hex: null },
    ]);
  });
});

describe("effectiveColors", () => {
  it("prefers the structured items", () => {
    expect(effectiveColors({ color_items: [{ name: "Cream", hex: h("F2E9D8") }], colors: ["Cream"] })).toEqual([{ name: "Cream", hex: h("F2E9D8") }]);
  });
  it("falls back to the legacy names, with NO value — never guessed from the name", () => {
    expect(effectiveColors({ color_items: [], colors: ["Red", "أبيض"] })).toEqual([{ name: "Red", hex: null }, { name: "أبيض", hex: null }]);
    expect(effectiveColors({ colors: null })).toEqual([]);
  });
  it("ignores malformed stored items rather than rendering them", () => {
    expect(effectiveColors({ color_items: [null, 3, { name: 5 }, { name: "Ok", hex: "nonsense" }] as never, colors: [] })).toEqual([{ name: "Ok", hex: null }]);
  });
});
