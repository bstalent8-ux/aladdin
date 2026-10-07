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

/** The six units an own product can be sold by (kilogram, gallon, pail, roll, meter, sheet). */
export const OWN_PRODUCT_UNITS = ["kilogram", "gallon", "pail", "roll", "meter", "sheet"] as const;
export type OwnProductUnit = (typeof OWN_PRODUCT_UNITS)[number];

export function isOwnProductUnit(value: unknown): value is OwnProductUnit {
  return typeof value === "string" && (OWN_PRODUCT_UNITS as readonly string[]).includes(value);
}

/** Limits mirrored from the database (the database is the authority). */
export const PRODUCT_LIMITS = {
  nameMin: 2,
  nameMax: 160,
  codeMax: 60,
  brandMax: 120,
  descriptionMax: 600,
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
