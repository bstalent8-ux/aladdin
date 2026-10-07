import type { Json } from "@/types/database.types";

/**
 * A product color: a name the owner chose and the visual value they picked.
 * `hex` is canonical upper-case `#RRGGBB`, or null for a LEGACY named color whose
 * value was never chosen — it is never guessed from the name, so it renders as a
 * neutral "unset" swatch until the owner edits it.
 */
export type ProductColor = { name: string; hex: string | null };

export const HEX_PATTERN = /^#[0-9A-F]{6}$/;

/** Canonical `#RRGGBB` (accepts lower-case and a missing `#`), or null when it is not a 6-digit hex. */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return HEX_PATTERN.test(withHash) ? withHash : null;
}

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

/** Trim names, drop empties and case-insensitive duplicates (first wins), keep order. */
export function normalizeColorItems(items: readonly ProductColor[]): ProductColor[] {
  const seen = new Set<string>();
  const out: ProductColor[] = [];
  for (const item of items) {
    const name = collapse(item.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, hex: item.hex ? normalizeHex(item.hex) : null });
  }
  return out;
}

/**
 * The colors a product row actually has: the structured items when it has them,
 * otherwise its legacy names (with no value). Both forms are valid states.
 */
export function effectiveColors(row: { color_items?: Json | null; colors?: readonly string[] | null }): ProductColor[] {
  const items = Array.isArray(row.color_items) ? row.color_items : [];
  const structured = items.flatMap((entry): ProductColor[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const { name, hex } = entry as { name?: unknown; hex?: unknown };
    if (typeof name !== "string" || !name) return [];
    return [{ name, hex: typeof hex === "string" && HEX_PATTERN.test(hex) ? hex : null }];
  });
  if (structured.length > 0) return structured;
  return (row.colors ?? []).map((name) => ({ name, hex: null }));
}
