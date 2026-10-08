import { describe, expect, it } from "vitest";
import { COLOR_LIBRARY, colorByCode, colorByHex, normalizeColorSearch, searchColors } from "./color-library";
import { colorDisplayName, colorFromLibrary, customColor, normalizeColorItems } from "./color-items";

const names = (q: string, n = 99) => searchColors(q, n).map((c) => c.en);

describe("the canonical colour library", () => {
  it("has stable unique codes, unique canonical hex values and both names for every entry", () => {
    const codes = new Set(COLOR_LIBRARY.map((c) => c.code));
    const hexes = new Set(COLOR_LIBRARY.map((c) => c.hex));
    expect(codes.size).toBe(COLOR_LIBRARY.length);
    expect(hexes.size).toBe(COLOR_LIBRARY.length);
    for (const c of COLOR_LIBRARY) {
      expect(c.code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.ar.length).toBeGreaterThan(0);
      expect(c.en.length).toBeGreaterThan(0);
      expect(c.ar.length).toBeLessThanOrEqual(40);
    }
    expect(COLOR_LIBRARY.length).toBeGreaterThanOrEqual(60);
  });
  it("resolves a hex to a name only on an EXACT match", () => {
    expect(colorByHex("#c62828")?.code).toBe("red");
    expect(colorByHex("#C62829")).toBeUndefined();
    expect(colorByCode("dark_blue")?.en).toBe("Dark Blue");
  });
});

describe("colour search", () => {
  it("finds the red family from the Arabic word, best matches first", () => {
    const found = searchColors("أحمر").map((c) => c.ar);
    expect(found.slice(0, 3)).toEqual(["أحمر", "أحمر داكن", "أحمر فاتح"]);
    expect(found).toContain("قرمزي");
    expect(found).toContain("خمري");
  });
  it("ignores hamza/alef spelling and finds partial Arabic words", () => {
    expect(searchColors("احمر")[0]!.ar).toBe("أحمر");
    expect(searchColors("ازر").map((c) => c.ar).slice(0, 3)).toEqual(["أزرق", "أزرق داكن", "أزرق فاتح"]);
    expect(searchColors("ازر").map((c) => c.ar)).toContain("أزرق سماوي");
  });
  it("finds colours from English words, and across languages", () => {
    expect(names("red", 5)).toEqual(["Red", "Dark Red", "Light Red", "Crimson", "Burgundy"]);
    expect(names("blue")).toEqual(expect.arrayContaining(["Blue", "Dark Blue", "Sky Blue", "Navy"]));
    expect(names("grey")).toContain("Gray");
    expect(names("كحلي")).toContain("Navy");
  });
  it("needs every typed word to match, returns nothing for nonsense and everything for an empty query", () => {
    expect(names("dark red")[0]).toBe("Dark Red");
    expect(names("zzzz")).toEqual([]);
    expect(searchColors("")).toHaveLength(COLOR_LIBRARY.length);
  });
  it("normalizes Arabic digits, diacritics and tatweel", () => {
    expect(normalizeColorSearch("  أَحْمَر ")).toBe("احمر");
    expect(normalizeColorSearch("١٢")).toBe("12");
  });
});

describe("stored colours", () => {
  it("a library colour is stored with its stable code and displayed in the reader language", () => {
    const stored = colorFromLibrary(colorByCode("dark_red")!, "ar");
    expect(stored).toEqual({ name: "أحمر داكن", hex: "#8B1A1A", code: "dark_red" });
    expect(colorDisplayName(stored, "en", "Custom color")).toBe("Dark Red");
    expect(colorDisplayName(stored, "ar", "لون مخصص")).toBe("أحمر داكن");
  });
  it("a value with no library name is a Custom colour with its hex and stays unique per value", () => {
    const a = customColor("#3A5F8A", "Custom color");
    const b = customColor("#112233", "Custom color");
    expect(colorDisplayName(a, "ar", "لون مخصص")).toBe("لون مخصص #3A5F8A");
    expect(normalizeColorItems([a, b, a])).toHaveLength(2);
  });
  it("one library colour is stored once, even under two language names; historical colours are untouched", () => {
    expect(normalizeColorItems([{ name: "Red", hex: "#C62828", code: "red" }, { name: "أحمر", hex: "#C62828", code: "red" }, { name: "Sand", hex: null }])).toEqual([
      { name: "Red", hex: "#C62828", code: "red" },
      { name: "Sand", hex: null },
    ]);
    expect(colorDisplayName({ name: "Sand", hex: null }, "ar", "لون مخصص")).toBe("Sand");
  });
});
