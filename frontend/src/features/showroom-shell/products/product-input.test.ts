import { describe, expect, it } from "vitest";
import {
  availableLifecycleActions,
  isLifecycleAction,
  parsePrice,
  ownProductStatus,
  parseOwnProductForm,
} from "./product-input";

/** Hex literals are product DATA here, not styling — built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

function form(entries: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

const valid = { name: "Matt Emulsion 18L", code: "PNT-001", categoryCode: "paints", unit: "pail" };

describe("own product form parsing", () => {
  it("accepts the required fields and normalizes everything it keeps", () => {
    const r = parseOwnProductForm(
      form({ ...valid, name: "  Matt   Emulsion  ", code: "  pnt  001 ", colorItems: JSON.stringify([{ name: "Warm  White", hex: h("f5f0e6") }, { name: "warm white", hex: null }, { name: " Sand ", hex: h("c9b28a") }]), basePrice: "159,5", weightKg: "3,5", sizeLabel: " 18  L ", brand: " DeltaCoat ", description: " Washable " }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Matt Emulsion",
        code: "pnt 001",
        categoryCode: "paints",
        unit: "pail",
        colors: [{ name: "Warm White", hex: h("F5F0E6") }, { name: "Sand", hex: h("C9B28A") }],
        basePrice: 159.5,
        weightKg: 3.5,
        sizeLabel: "18 L",
        brand: "DeltaCoat",
        description: "Washable",
      },
    });
  });

  it("treats every optional field as optional", () => {
    const r = parseOwnProductForm(form(valid));
    expect(r.ok && r.value).toMatchObject({ colors: [], basePrice: null, weightKg: null, sizeLabel: null, brand: null, description: null });
  });

  it("requires a name, a code, a category and a unit with a translated reason each", () => {
    const r = parseOwnProductForm(form({}));
    expect(r).toEqual({
      ok: false,
      fieldErrors: {
        name: "commerce.validation.nameRequired",
        code: "showroomProducts.validation.codeRequired",
        category: "commerce.validation.categoryRequired",
        unit: "commerce.validation.unitRequired",
      },
    });
  });

  it("bounds the name and the code", () => {
    expect(parseOwnProductForm(form({ ...valid, name: "x" }))).toMatchObject({ ok: false, fieldErrors: { name: "showroomProducts.validation.nameLength" } });
    expect(parseOwnProductForm(form({ ...valid, name: "x".repeat(161) }))).toMatchObject({ ok: false, fieldErrors: { name: "showroomProducts.validation.nameLength" } });
    expect(parseOwnProductForm(form({ ...valid, code: "C".repeat(61) }))).toMatchObject({ ok: false, fieldErrors: { code: "showroomProducts.validation.codeLength" } });
    expect(parseOwnProductForm(form({ ...valid, code: "C".repeat(60) })).ok).toBe(true);
  });

  it.each(["wallpaper", "paints", "spc_flooring"])("accepts the canonical category %s", (categoryCode) => {
    expect(parseOwnProductForm(form({ ...valid, categoryCode })).ok).toBe(true);
  });

  it.each(["finishing", "other", "ورق حائط", "PAINTS", "paints "])("refuses %j as a category — legacy codes and labels are not canonical identifiers", (categoryCode) => {
    expect(parseOwnProductForm(form({ ...valid, categoryCode }))).toMatchObject({ ok: false, fieldErrors: { category: expect.any(String) } });
  });

  it.each(["kilogram", "gallon", "pail", "roll", "meter", "sheet"])("accepts the required unit %s", (unit) => {
    expect(parseOwnProductForm(form({ ...valid, unit })).ok).toBe(true);
  });

  it("refuses other units for a new product but lets a historical product keep its own", () => {
    expect(parseOwnProductForm(form({ ...valid, unit: "ton" }))).toMatchObject({ ok: false, fieldErrors: { unit: "showroomProducts.errors.unitInvalid" } });
    expect(parseOwnProductForm(form({ ...valid, unit: "ton" }), "ton").ok).toBe(true);
    expect(parseOwnProductForm(form({ ...valid, unit: "bag" }), "ton").ok).toBe(false);
  });

  it.each([["-1"], ["abc"], ["1000001"], ["NaN"]])("refuses the weight %j", (weightKg) => {
    expect(parseOwnProductForm(form({ ...valid, weightKg }))).toMatchObject({ ok: false, fieldErrors: { weight: "showroomProducts.validation.weightInvalid" } });
  });

  it("accepts zero and a decimal weight, kept to grams", () => {
    expect(parseOwnProductForm(form({ ...valid, weightKg: "0" }))).toMatchObject({ ok: true, value: { weightKg: 0 } });
    expect(parseOwnProductForm(form({ ...valid, weightKg: "2.34567" }))).toMatchObject({ ok: true, value: { weightKg: 2.346 } });
  });

  const items = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: `Color ${i}`, hex: h("B96F52") })));

  it("limits colors to twelve distinct names of at most forty characters", () => {
    expect(parseOwnProductForm(form({ ...valid, colorItems: items(12) })).ok).toBe(true);
    expect(parseOwnProductForm(form({ ...valid, colorItems: items(13) }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorsTooMany" } });
    expect(parseOwnProductForm(form({ ...valid, colorItems: JSON.stringify([{ name: "x".repeat(41), hex: h("B96F52") }]) }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorTooLong" } });
  });

  it("accepts a legacy color with no value, canonicalizes hex, and refuses anything that is not #RRGGBB", () => {
    const ok = parseOwnProductForm(form({ ...valid, colorItems: JSON.stringify([{ name: "Sand", hex: null }, { name: "Cream", hex: "f2e9d8" }]) }));
    expect(ok.ok && ok.value.colors).toEqual([{ name: "Sand", hex: null }, { name: "Cream", hex: h("F2E9D8") }]);
    for (const hex of ["#GGGGGG", h("fff"), "red", "#12345", "#1234567", "javascript:1"]) {
      expect(parseOwnProductForm(form({ ...valid, colorItems: JSON.stringify([{ name: "X", hex }]) }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorHexInvalid" } });
    }
    expect(parseOwnProductForm(form({ ...valid, colorItems: "{not json" }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorHexInvalid" } });
  });

  it("requires a price on create when asked, and refuses zero, negative, over-precise and absurd amounts", () => {
    expect(parseOwnProductForm(form(valid), null, { priceRequired: true })).toMatchObject({ ok: false, fieldErrors: { price: "showroomProducts.validation.priceRequired" } });
    expect(parseOwnProductForm(form(valid)).ok).toBe(true);
    for (const basePrice of ["0", "-5", "1.234", "abc", "1e3", "100000001", "12.", ".5"]) {
      expect(parseOwnProductForm(form({ ...valid, basePrice }))).toMatchObject({ ok: false, fieldErrors: { price: "showroomProducts.validation.priceInvalid" } });
    }
    const r = parseOwnProductForm(form({ ...valid, basePrice: "159.99" }), null, { priceRequired: true });
    expect(r.ok && r.value.basePrice).toBe(159.99);
  });

  it("keeps the owner's own name for a custom colour, but never lets a canonical library colour be renamed or re-valued", () => {
    const parse = (items: unknown[]) => {
      const r = parseOwnProductForm(form({ ...valid, colorItems: JSON.stringify(items) }));
      return r.ok ? r.value.colors : null;
    };
    // custom value: the owner's name survives, a blank one falls back to the hex placeholder
    expect(parse([{ name: "بني طوبي", hex: h("AF725A"), code: "custom" }])).toEqual([{ name: "بني طوبي", hex: h("AF725A"), code: "custom" }]);
    expect(parse([{ name: h("AF725A"), hex: h("AF725A"), code: "custom" }])).toEqual([{ name: h("AF725A"), hex: h("AF725A"), code: "custom" }]);
    // a library code cannot carry an invented name or a different value
    expect(parse([{ name: "Sky maroon", hex: h("000001"), code: "dark_red" }])).toEqual([{ name: "Dark Red", hex: h("8B1A1A"), code: "dark_red" }]);
    // either canonical language name is kept as is
    expect(parse([{ name: "أحمر داكن", hex: h("8B1A1A"), code: "dark_red" }])).toEqual([{ name: "أحمر داكن", hex: h("8B1A1A"), code: "dark_red" }]);
    // a "custom" value that is exactly a library colour IS that library colour
    expect(parse([{ name: "My red", hex: h("8B1A1A"), code: "custom" }])).toEqual([{ name: "Dark Red", hex: h("8B1A1A"), code: "dark_red" }]);
    // the custom name obeys the 40-character colour-name limit
    expect(parseOwnProductForm(form({ ...valid, colorItems: JSON.stringify([{ name: "x".repeat(41), hex: h("AF725A"), code: "custom" }]) }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorTooLong" } });
  });

  it("limits the description to 250 CHARACTERS (not words), in Arabic, English and mixed text", () => {
    const desc = (description: string) => parseOwnProductForm(form({ ...valid, description }));
    const tooLong = { ok: false, fieldErrors: { description: "showroomProducts.validation.descriptionChars" } };
    expect(desc("").ok).toBe(true); // optional
    expect(desc("a".repeat(250)).ok).toBe(true);
    expect(desc("a".repeat(251))).toMatchObject(tooLong);
    expect(desc("ك".repeat(250)).ok).toBe(true);
    expect(desc("ك".repeat(251))).toMatchObject(tooLong);
    expect(desc("كلمة ".repeat(40) + "mix ".repeat(12).trim()).ok).toBe(true);
    expect(desc("كلمة ".repeat(50) + "mix ".repeat(4))).toMatchObject(tooLong);
    // 250 one-letter WORDS is 499 characters: the unit is characters now, so it is refused.
    expect(desc(Array.from({ length: 250 }, () => "w").join(" "))).toMatchObject(tooLong);
    // an astral character (emoji) is one character, like the database's char_length
    expect(desc("😀".repeat(250)).ok).toBe(true);
    expect(desc("😀".repeat(251))).toMatchObject(tooLong);
    // line breaks count once, whichever way the browser sends them
    expect(desc(("a".repeat(124) + String.fromCharCode(13, 10)).repeat(2)).ok).toBe(true);
  });
});

describe("price helpers", () => {
  it("parses exact money from Latin or Arabic-Indic digits", () => {
    expect(parsePrice("159.5")).toEqual({ ok: true, value: 159.5 });
    expect(parsePrice("١٥٩٫٥")).toEqual({ ok: true, value: 159.5 });
    expect(parsePrice("0.01")).toEqual({ ok: true, value: 0.01 });
    expect(parsePrice("0")).toEqual({ ok: false });
  });
});

describe("product lifecycle", () => {
  it("derives the management status: archived beats published beats draft", () => {
    expect(ownProductStatus({ status: "published", archived_at: null })).toBe("active");
    expect(ownProductStatus({ status: "draft", archived_at: null })).toBe("inactive");
    expect(ownProductStatus({ status: "draft", archived_at: "2026-10-08T00:00:00Z" })).toBe("archived");
    expect(ownProductStatus({ status: "published", archived_at: "2026-10-08T00:00:00Z" })).toBe("archived");
  });

  it("offers each status only the transitions it allows", () => {
    const all = { write: true, publish: true };
    expect(availableLifecycleActions("inactive", all)).toEqual(["activate", "archive"]);
    expect(availableLifecycleActions("active", all)).toEqual(["deactivate", "archive"]);
    expect(availableLifecycleActions("archived", all)).toEqual(["restore"]);
  });

  it("follows the caller's capabilities — a courtesy; the database re-checks every one", () => {
    expect(availableLifecycleActions("inactive", { write: true, publish: false })).toEqual(["archive"]);
    expect(availableLifecycleActions("inactive", { write: false, publish: true })).toEqual(["activate"]);
    expect(availableLifecycleActions("archived", { write: false, publish: true })).toEqual([]);
    expect(availableLifecycleActions("active", { write: false, publish: false })).toEqual([]);
  });

  it("recognises only the four actions", () => {
    expect(["activate", "deactivate", "archive", "restore"].every(isLifecycleAction)).toBe(true);
    expect(isLifecycleAction("delete")).toBe(false);
    expect(isLifecycleAction(undefined)).toBe(false);
  });
});
