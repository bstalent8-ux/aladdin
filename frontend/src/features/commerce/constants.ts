import type { Database } from "@/types/database.types";

/**
 * Shared commerce constants and formatters. Enum value lists mirror the DB enums
 * exactly (product_category / product_unit); the UI maps each value to a
 * bilingual label via i18n keys `commerce.categories.*` / `commerce.units.*`.
 */
export type ProductCategory = Database["public"]["Enums"]["product_category"];
export type ProductUnit = Database["public"]["Enums"]["product_unit"];

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  "finishing",
  "construction",
  "interior_design",
  "furnishing",
  "supply",
  "tools",
  "other",
];

export const PRODUCT_UNITS: ProductUnit[] = [
  "piece",
  "box",
  "set",
  "meter",
  "square_meter",
  "linear_meter",
  "kilogram",
  "ton",
  "liter",
  "roll",
  "bag",
  "pack",
  "gallon",
  "pail",
  "sheet",
];

/**
 * The canonical showroom product taxonomy (`public.product_categories`, stable
 * English codes; AR/EN labels in `commerce.canonicalCategories.*`). It is
 * ADDITIVE to the legacy broad `PRODUCT_CATEGORIES` above, which stays the
 * compatibility bucket for historical products — nothing is mapped between them.
 */
export const CANONICAL_CATEGORY_CODES = [
  "wallpaper",
  "wood_alternative",
  "marble_alternative",
  "chipboard",
  "cornices",
  "corners",
  "panels",
  "skirting",
  "interior_doors",
  "security_doors",
  "vinyl_flooring",
  "spc_flooring",
  "curtains",
  "posters",
  "paints",
] as const;
export type CanonicalCategoryCode = (typeof CANONICAL_CATEGORY_CODES)[number];

export function isCanonicalCategoryCode(value: unknown): value is CanonicalCategoryCode {
  return typeof value === "string" && (CANONICAL_CATEGORY_CODES as readonly string[]).includes(value);
}

/**
 * The ONE shared unit list for showroom products and Purchase Requests (mirrors `app.showroom_units()`
 * and `public.measurement_units`): the original six first, then the finishing additions. `meter` and
 * `linear_meter` are different units; nothing is ever converted between units.
 */
export const SHARED_UNITS = [
  "kilogram",
  "gallon",
  "pail",
  "roll",
  "meter",
  "sheet",
  "piece",
  "square_meter",
  "linear_meter",
  "liter",
  "box",
  "set",
] as const;
export type SharedUnit = (typeof SHARED_UNITS)[number];

/** Kept under its original name: the units an own product can be sold by. */
export const OWN_PRODUCT_UNITS = SHARED_UNITS;
export type OwnProductUnit = SharedUnit;

/**
 * Units worth suggesting first for a canonical category. A SUGGESTION only: every shared unit stays
 * selectable for every category, and nothing is converted between units.
 */
export const UNIT_SUGGESTIONS_BY_CATEGORY: Readonly<Record<string, readonly SharedUnit[]>> = {
  wallpaper: ["roll", "square_meter"],
  wood_alternative: ["sheet", "square_meter", "piece"],
  marble_alternative: ["sheet", "square_meter", "piece"],
  chipboard: ["sheet", "piece"],
  cornices: ["linear_meter", "piece", "box"],
  corners: ["linear_meter", "piece", "box"],
  panels: ["sheet", "square_meter", "piece"],
  skirting: ["linear_meter", "piece", "box"],
  interior_doors: ["piece", "set"],
  security_doors: ["piece", "set"],
  vinyl_flooring: ["square_meter", "box"],
  spc_flooring: ["square_meter", "box"],
  curtains: ["meter", "piece", "set"],
  posters: ["piece", "set"],
  paints: ["pail", "gallon", "liter", "kilogram"],
};

/** The shared units with the category's suggestions first (all units always present, no duplicates). */
export function unitsForCategory(categoryCode: string | null | undefined): { suggested: SharedUnit[]; all: SharedUnit[] } {
  const suggested = [...(UNIT_SUGGESTIONS_BY_CATEGORY[categoryCode ?? ""] ?? [])];
  return { suggested, all: [...suggested, ...SHARED_UNITS.filter((u) => !suggested.includes(u))] };
}

export function isOwnProductUnit(value: unknown): value is OwnProductUnit {
  return typeof value === "string" && (OWN_PRODUCT_UNITS as readonly string[]).includes(value);
}

/** The one limit for every showroom Description / Details free-text field. */
export const DESCRIPTION_MAX_CHARS = 250;

/** Limits mirrored from the database (the database is the authority). */
export const PRODUCT_LIMITS = {
  nameMin: 2,
  nameMax: 160,
  codeMax: 60,
  brandMax: 120,
  /** The description limit is 250 CHARACTERS (Unicode, not bytes, not words); the database enforces the same rule. */
  descriptionMax: DESCRIPTION_MAX_CHARS,
  priceMax: 100_000_000,
  sizeMax: 80,
  colorMax: 40,
  colorsMax: 12,
  weightMax: 1_000_000,
  imagesMax: 3,
} as const;

/**
 * Money and quantity are NOT redefined here.
 *
 * They used to be, with their own `Intl` calls and their own locale tag, which
 * is precisely how the Arabic UI ended up with two numeral systems on one page:
 * a quantity formatted by this file and a total formatted by `lib/ui/format`
 * could disagree about the numbering system. There is now ONE formatting layer
 * and this module re-exports from it, so the hundred-odd existing imports keep
 * working and no caller can pick the wrong copy.
 */
export { formatMoney, formatQuantity } from "@/lib/ui/format";
