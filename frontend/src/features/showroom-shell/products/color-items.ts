import type { Json } from "@/types/database.types";
import { CUSTOM_COLOR_CODE, colorByCode, libraryColorName, type LibraryColor } from "./color-library";

/**
 * A product color: a name the owner chose and the visual value they picked.
 * `hex` is canonical upper-case `#RRGGBB`, or null for a LEGACY named color whose
 * value was never chosen — it is never guessed from the name, so it renders as a
 * neutral "unset" swatch until the owner edits it.
 */
export type ProductColor = {
  name: string;
  hex: string | null;
  /**
   * The stable identity of a library colour (`red`, `dark_blue`…) — what readers resolve to a name in THEIR
   * language — or `custom` for a value with no library name. Absent on historical colours, which keep the stored name.
   */
  code?: string;
};

export const COLOR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const HEX_PATTERN = /^#[0-9A-F]{6}$/;

/** Canonical `#RRGGBB` (accepts lower-case and a missing `#`), or null when it is not a 6-digit hex. */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return HEX_PATTERN.test(withHash) ? withHash : null;
}

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

/**
 * Trim names, drop empties and duplicates (first wins), keep order. A duplicate is the same name
 * (case-insensitively) or the same library colour; the reserved `custom` code may repeat — its names differ.
 */
export function normalizeColorItems(items: readonly ProductColor[]): ProductColor[] {
  const seen = new Set<string>();
  const seenCodes = new Set<string>();
  const out: ProductColor[] = [];
  for (const item of items) {
    const name = collapse(item.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const code = item.code && COLOR_CODE_PATTERN.test(item.code) ? item.code : undefined;
    if (code && code !== CUSTOM_COLOR_CODE && seenCodes.has(code)) continue;
    seen.add(key);
    if (code) seenCodes.add(code);
    out.push({ name, hex: item.hex ? normalizeHex(item.hex) : null, ...(code ? { code } : {}) });
  }
  return out;
}

/** A library colour as the product stores it: its name in the picker's language, its value and its stable code. */
export function colorFromLibrary(color: LibraryColor, locale: "ar" | "en"): ProductColor {
  return { name: libraryColorName(color, locale), hex: color.hex, code: color.code };
}

/**
 * A value with no library name. The owner MAY give it a name of their own (`customName`); otherwise the stored name is
 * just the hex — a language-neutral placeholder that keeps the value unique and that every reader shows as
 * "Custom colour #hex" in their own language. A library colour is never built here, so it cannot be renamed.
 */
export function customColor(hex: string, customName?: string): ProductColor {
  const named = collapse(customName ?? "");
  return { name: named || hex, hex, code: CUSTOM_COLOR_CODE };
}

/** Is the stored name of a custom colour just the automatic placeholder (the hex itself, or the older "Custom colour #hex" labels)? */
export function isAutoCustomName(color: ProductColor): boolean {
  if (color.code !== CUSTOM_COLOR_CODE || !color.hex) return false;
  const name = collapse(color.name);
  if (name.toUpperCase() === color.hex) return true;
  // older automatic labels: "<label> #hex" with the English or Arabic label
  return AUTO_LABELS.some((label) => name.toLowerCase() === `${label} ${color.hex}`.toLowerCase());
}

const AUTO_LABELS = ["custom color", "custom colour", "لون مخصص"];

/**
 * The name a READER sees: a library colour in their language, a custom value with the owner's own name as that name,
 * an unnamed custom value as "Custom colour #hex", and a historical colour exactly as stored.
 */
export function colorDisplayName(color: ProductColor, locale: "ar" | "en", customLabel: string): string {
  const lib = colorByCode(color.code);
  if (lib) return libraryColorName(lib, locale);
  if (color.code === CUSTOM_COLOR_CODE && color.hex && isAutoCustomName(color)) return `${customLabel} ${color.hex}`;
  return color.name;
}

/**
 * The colors a product row actually has: the structured items when it has them,
 * otherwise its legacy names (with no value). Both forms are valid states.
 */
export function effectiveColors(row: { color_items?: Json | null; colors?: readonly string[] | null }): ProductColor[] {
  const items = Array.isArray(row.color_items) ? row.color_items : [];
  const structured = items.flatMap((entry): ProductColor[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const { name, hex, code } = entry as { name?: unknown; hex?: unknown; code?: unknown };
    if (typeof name !== "string" || !name) return [];
    return [{ name, hex: typeof hex === "string" && HEX_PATTERN.test(hex) ? hex : null, ...(typeof code === "string" && COLOR_CODE_PATTERN.test(code) ? { code } : {}) }];
  });
  if (structured.length > 0) return structured;
  return (row.colors ?? []).map((name) => ({ name, hex: null }));
}
