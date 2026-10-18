import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";
import { CANONICAL_CATEGORY_CODES, OWN_PRODUCT_UNITS, PRODUCT_CATEGORIES, PRODUCT_UNITS, unitsForCategory } from "./constants";

const MIGRATION = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261015090004_own_products_taxonomy_images.sql"), "utf8");

/** The seed rows of `product_categories` exactly as the migration states them. */
const seeded = [...MIGRATION.matchAll(/\('([a-z_]+)',\s+'([^']+)',\s+'([^']+)',\s+(\d+)\)/g)].map((m) => ({
  code: m[1]!,
  ar: m[2]!,
  en: m[3]!,
  order: Number(m[4]),
}));

describe("canonical product taxonomy", () => {
  it("has exactly the fifteen requested categories, in the requested order", () => {
    expect(seeded.map((s) => s.ar)).toEqual([
      "ورق حائط", "بديل خشب", "بديل رخام", "شيبورد", "كرانيش", "زوايا", "بانوهات", "وزر",
      "ابواب داخلية", "ابواب مصفحة", "ارضيات فينيل", "ارضيات SPC", "ستائر", "بوسترات", "دهانات",
    ]);
    expect(seeded.map((s) => s.order)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it("uses the same stable machine codes in the database and in the app", () => {
    expect(CANONICAL_CATEGORY_CODES).toEqual(seeded.map((s) => s.code));
  });

  it("never uses Arabic as an identifier", () => {
    for (const code of CANONICAL_CATEGORY_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]+$/);
  });

  it("shows the database's own labels in both languages (no drift between the seed and the UI)", () => {
    for (const row of seeded) {
      expect(ar.commerce.canonicalCategories[row.code as keyof typeof ar.commerce.canonicalCategories]).toBe(row.ar);
      expect(en.commerce.canonicalCategories[row.code as keyof typeof en.commerce.canonicalCategories]).toBe(row.en);
    }
  });

  it("leaves the historical broad categories untouched and unmapped", () => {
    expect(PRODUCT_CATEGORIES).toEqual(["finishing", "construction", "interior_design", "furnishing", "supply", "tools", "other"]);
    for (const legacy of PRODUCT_CATEGORIES) expect(CANONICAL_CATEGORY_CODES as readonly string[]).not.toContain(legacy);
  });
});

describe("product units", () => {
  it("offers the twelve shared units, the original six first, each with an Arabic and an English label", () => {
    expect([...OWN_PRODUCT_UNITS]).toEqual(["kilogram", "gallon", "pail", "roll", "meter", "sheet", "piece", "square_meter", "linear_meter", "liter", "box", "set"]);
    expect(OWN_PRODUCT_UNITS.slice(0, 6).map((u) => ar.commerce.units[u])).toEqual(["كيلو", "جالون", "باستلة", "رول", "متر", "لوح"]);
    expect(OWN_PRODUCT_UNITS.slice(0, 6).map((u) => en.commerce.units[u])).toEqual(["Kilogram", "Gallon", "Pail", "Roll", "Meter", "Sheet"]);
    expect(ar.commerce.units.box).toBe("علبة أو كرتونة");
    expect(ar.commerce.units.square_meter).toBe("متر مربع");
    expect(ar.commerce.units.linear_meter).toBe("متر طولي");
    expect(new Set(OWN_PRODUCT_UNITS).size).toBe(12);
  });

  it("suggests category-appropriate units first without removing any other unit", () => {
    expect(unitsForCategory("paints").suggested[0]).toBe("pail");
    expect(unitsForCategory("wallpaper").all.slice(0, 2)).toEqual(["roll", "square_meter"]);
    expect(unitsForCategory("vinyl_flooring").suggested).toContain("square_meter");
    for (const code of [...CANONICAL_CATEGORY_CODES, "", null]) {
      const { all } = unitsForCategory(code);
      expect([...all].sort()).toEqual([...OWN_PRODUCT_UNITS].sort());
    }
    // meter and linear_meter are different units: a suggestion never rewrites one into the other
    expect(unitsForCategory("curtains").suggested).not.toContain("linear_meter");
  });

  it("keeps every historical unit and adds the new ones", () => {
    for (const historical of ["piece", "box", "set", "meter", "square_meter", "linear_meter", "kilogram", "ton", "liter", "roll", "bag", "pack"]) {
      expect(PRODUCT_UNITS as readonly string[]).toContain(historical);
    }
    for (const added of ["gallon", "pail", "sheet"]) expect(PRODUCT_UNITS as readonly string[]).toContain(added);
  });

  it("has a label for every unit the database can hold", () => {
    for (const unit of PRODUCT_UNITS) {
      expect(en.commerce.units[unit]).toBeTruthy();
      expect(ar.commerce.units[unit]).toBeTruthy();
    }
  });

  it("extends the database enum additively", () => {
    expect(MIGRATION).toMatch(/alter type public\.product_unit add value if not exists 'gallon'/);
    expect(MIGRATION).toMatch(/add value if not exists 'pail'/);
    expect(MIGRATION).toMatch(/add value if not exists 'sheet'/);
    expect(MIGRATION).not.toMatch(/rename value|drop type|drop column/i);
  });
});
