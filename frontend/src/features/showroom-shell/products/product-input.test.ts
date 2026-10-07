import { describe, expect, it } from "vitest";
import {
  availableLifecycleActions,
  isLifecycleAction,
  normalizeColors,
  ownProductStatus,
  parseOwnProductForm,
} from "./product-input";

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
      form({ ...valid, name: "  Matt   Emulsion  ", code: "  pnt  001 ", color: ["Warm  White", "warm white", " Sand "], weightKg: "3,5", sizeLabel: " 18  L ", brand: " DeltaCoat ", description: " Washable " }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Matt Emulsion",
        code: "pnt 001",
        categoryCode: "paints",
        unit: "pail",
        colors: ["Warm White", "Sand"],
        weightKg: 3.5,
        sizeLabel: "18 L",
        brand: "DeltaCoat",
        description: "Washable",
      },
    });
  });

  it("treats every optional field as optional", () => {
    const r = parseOwnProductForm(form(valid));
    expect(r.ok && r.value).toMatchObject({ colors: [], weightKg: null, sizeLabel: null, brand: null, description: null });
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
    expect(parseOwnProductForm(form({ ...valid, unit: "box" }))).toMatchObject({ ok: false, fieldErrors: { unit: "showroomProducts.errors.unitInvalid" } });
    expect(parseOwnProductForm(form({ ...valid, unit: "box" }), "box").ok).toBe(true);
    expect(parseOwnProductForm(form({ ...valid, unit: "ton" }), "box").ok).toBe(false);
  });

  it.each([["-1"], ["abc"], ["1000001"], ["NaN"]])("refuses the weight %j", (weightKg) => {
    expect(parseOwnProductForm(form({ ...valid, weightKg }))).toMatchObject({ ok: false, fieldErrors: { weight: "showroomProducts.validation.weightInvalid" } });
  });

  it("accepts zero and a decimal weight, kept to grams", () => {
    expect(parseOwnProductForm(form({ ...valid, weightKg: "0" }))).toMatchObject({ ok: true, value: { weightKg: 0 } });
    expect(parseOwnProductForm(form({ ...valid, weightKg: "2.34567" }))).toMatchObject({ ok: true, value: { weightKg: 2.346 } });
  });

  it("limits colors to twelve distinct names of at most forty characters", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `Color ${i}`);
    expect(parseOwnProductForm(form({ ...valid, color: twelve })).ok).toBe(true);
    expect(parseOwnProductForm(form({ ...valid, color: [...twelve, "One more"] }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorsTooMany" } });
    expect(parseOwnProductForm(form({ ...valid, color: ["x".repeat(41)] }))).toMatchObject({ ok: false, fieldErrors: { colors: "showroomProducts.validation.colorTooLong" } });
  });
});

describe("normalizeColors", () => {
  it("trims, collapses whitespace, drops blanks and case-insensitive duplicates, keeping the first spelling", () => {
    expect(normalizeColors(["  Warm   White ", "", "warm white", "WARM WHITE", "Sand"])).toEqual(["Warm White", "Sand"]);
  });

  it("does not alter non-Latin names — display language never rewrites stored values", () => {
    expect(normalizeColors(["أبيض دافئ", " رمادي  فاتح ", "أبيض دافئ"])).toEqual(["أبيض دافئ", "رمادي فاتح"]);
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
