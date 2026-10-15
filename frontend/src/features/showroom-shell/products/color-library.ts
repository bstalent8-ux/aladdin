/**
 * THE canonical, searchable product-colour library (data, not styling).
 *
 * Owners pick a colour by NAME from this list; the hex comes with it. Nobody invents a colour name:
 * a value that matches no library entry is a "custom colour" (see CUSTOM_COLOR_CODE) with an automatic,
 * neutral label. Every entry has a stable `code` (the identity that is stored), an Arabic and an English
 * name (what readers see, in THEIR language) and search aliases. It is plain local data — no network, no
 * runtime generation — and, like the rest of the product-colour data, the one place raw hex lives
 * (allow-listed in eslint/ui-foundation-guard.mjs); component styling still uses tokens only.
 *
 * It is a practical working set of finishing-material tones, not a paint-manufacturer catalogue.
 */
export type LibraryColor = {
  /** Stable identity (stored on the product). Lower-case ascii. */
  code: string;
  ar: string;
  en: string;
  /** Canonical upper-case #RRGGBB. Unique across the library, so a hex resolves to at most one name. */
  hex: string;
  /** Extra search terms (either language), e.g. the family a shade belongs to. */
  aliases: readonly string[];
};

const c = (code: string, ar: string, en: string, hex: string, aliases: readonly string[] = []): LibraryColor => ({ code, ar, en, hex, aliases });

export const COLOR_LIBRARY: readonly LibraryColor[] = [
  // Whites & neutrals
  c("white", "أبيض", "White", "#FFFFFF"),
  c("off_white", "أبيض مكسور", "Off White", "#F5F2EA", ["أبيض", "white"]),
  c("ivory", "عاجي", "Ivory", "#F7F1DC", ["أيفوري", "أبيض", "white"]),
  c("cream", "كريمي", "Cream", "#F2E9D8", ["كريم", "أبيض", "white"]),
  c("beige", "بيج", "Beige", "#D9C9A8", ["بيچ"]),
  c("sand", "رملي", "Sand", "#D8C7A6", ["beige"]),
  c("champagne", "شامبانيا", "Champagne", "#E6D3B1", ["beige", "ذهبي"]),
  c("light_gray", "رمادي فاتح", "Light Gray", "#D3D3D3", ["grey", "light grey", "فضي"]),
  c("gray", "رمادي", "Gray", "#9A9A9A", ["grey"]),
  c("dark_gray", "رمادي داكن", "Dark Gray", "#4B4B4B", ["dark grey", "رمادي"]),
  c("silver", "فضي", "Silver", "#C0C0C0", ["رمادي", "gray"]),
  c("charcoal", "فحمي", "Charcoal", "#36454F", ["رمادي داكن", "أسود", "dark gray"]),
  c("graphite", "جرافيت", "Graphite", "#3C3F44", ["رمادي داكن", "dark gray"]),
  c("black", "أسود", "Black", "#111111", ["اسود"]),
  // Browns & woods
  c("light_brown", "بني فاتح", "Light Brown", "#A67B5B", ["بني", "brown"]),
  c("brown", "بني", "Brown", "#7A5230"),
  c("dark_brown", "بني داكن", "Dark Brown", "#4A2F1E", ["بني", "brown"]),
  c("chocolate", "شوكولاتة", "Chocolate", "#5A3825", ["بني", "brown", "قهوة"]),
  c("coffee", "قهوة", "Coffee", "#6F4E37", ["بني", "brown"]),
  c("tan", "بني رملي", "Tan", "#C9A27A", ["كاكي", "brown"]),
  c("camel", "جملي", "Camel", "#C19A6B", ["بني", "brown"]),
  c("taupe", "رمادي بني", "Taupe", "#8B7B6B", ["gray", "brown"]),
  c("oak", "سنديان", "Oak", "#B88A55", ["بلوط", "خشب", "wood"]),
  c("walnut", "جوزي", "Walnut", "#5C4033", ["خشب", "wood", "بني"]),
  c("wenge", "ونجي", "Wenge", "#3B2A25", ["خشب", "wood", "بني داكن"]),
  c("mahogany", "ماهوجني", "Mahogany", "#6B2D1F", ["خشب", "wood", "أحمر داكن"]),
  c("terracotta", "تيراكوتا", "Terracotta", "#B96F52", ["طوبي", "برتقالي", "orange"]),
  c("copper", "نحاسي", "Copper", "#B87333", ["نحاس"]),
  c("bronze", "برونزي", "Bronze", "#8C6A3F", ["برونز"]),
  c("gold", "ذهبي", "Gold", "#C9A227", ["دهبي", "أصفر", "yellow"]),
  // Reds & pinks
  c("red", "أحمر", "Red", "#C62828"),
  c("dark_red", "أحمر داكن", "Dark Red", "#8B1A1A", ["أحمر", "red"]),
  c("light_red", "أحمر فاتح", "Light Red", "#E57373", ["أحمر", "red"]),
  c("crimson", "قرمزي", "Crimson", "#DC143C", ["أحمر", "red"]),
  c("burgundy", "خمري", "Burgundy", "#6D1A36", ["أحمر", "أحمر داكن", "red", "wine", "نبيتي"]),
  c("maroon", "عنابي", "Maroon", "#800000", ["أحمر", "أحمر داكن", "red", "كستنائي"]),
  c("brick", "طوبي", "Brick", "#A0452E", ["أحمر", "red", "طوب"]),
  c("coral", "مرجاني", "Coral", "#F26B5B", ["أحمر", "برتقالي", "red", "orange"]),
  c("salmon", "سلموني", "Salmon", "#FA8072", ["وردي", "pink"]),
  c("pink", "وردي", "Pink", "#E8A0B4", ["زهري", "rose"]),
  c("light_pink", "وردي فاتح", "Light Pink", "#F6D5DE", ["وردي", "pink", "زهري"]),
  c("dusty_rose", "وردي مغبر", "Dusty Rose", "#C98B8B", ["وردي", "pink", "rose"]),
  c("fuchsia", "فوشيا", "Fuchsia", "#C2185B", ["وردي", "pink", "magenta"]),
  // Oranges & yellows
  c("orange", "برتقالي", "Orange", "#F57C00"),
  c("dark_orange", "برتقالي داكن", "Dark Orange", "#C85A00", ["برتقالي", "orange"]),
  c("peach", "خوخي", "Peach", "#FFCBA4", ["برتقالي فاتح", "orange"]),
  c("yellow", "أصفر", "Yellow", "#F4C430"),
  c("light_yellow", "أصفر فاتح", "Light Yellow", "#FFF3A3", ["أصفر", "yellow"]),
  c("mustard", "خردلي", "Mustard", "#D4A017", ["أصفر", "yellow"]),
  // Greens
  c("green", "أخضر", "Green", "#2E7D32"),
  c("dark_green", "أخضر داكن", "Dark Green", "#1B4D2B", ["أخضر", "green"]),
  c("light_green", "أخضر فاتح", "Light Green", "#8BC34A", ["أخضر", "green"]),
  c("olive", "زيتي", "Olive", "#6B7A2F", ["أخضر", "زيتوني", "green"]),
  c("khaki", "كاكي", "Khaki", "#BDB76B", ["أخضر", "بيج", "green"]),
  c("sage", "مريمية", "Sage", "#8FA88A", ["أخضر", "green", "أخضر رمادي"]),
  c("mint", "نعناعي", "Mint", "#A8DDB5", ["أخضر", "green", "أخضر فاتح"]),
  c("lime", "ليموني", "Lime", "#A4C639", ["أخضر", "green"]),
  c("emerald", "زمردي", "Emerald", "#046307", ["أخضر", "green"]),
  c("teal", "أخضر مزرق", "Teal", "#1F7A7A", ["تيل", "أزرق", "blue", "green"]),
  c("turquoise", "فيروزي", "Turquoise", "#30C5C1", ["تركواز", "أزرق", "blue"]),
  // Blues
  c("blue", "أزرق", "Blue", "#1E5AA8"),
  c("dark_blue", "أزرق داكن", "Dark Blue", "#123A6D", ["أزرق", "blue"]),
  c("light_blue", "أزرق فاتح", "Light Blue", "#7DB4E6", ["أزرق", "blue"]),
  c("sky_blue", "أزرق سماوي", "Sky Blue", "#87CEEB", ["سماوي", "أزرق", "blue"]),
  c("baby_blue", "أزرق بيبي", "Baby Blue", "#BFD9F2", ["أزرق فاتح", "blue", "light blue"]),
  c("royal_blue", "أزرق ملكي", "Royal Blue", "#2B4FBF", ["أزرق", "blue"]),
  c("navy", "كحلي", "Navy", "#14213D", ["أزرق داكن", "blue", "dark blue"]),
  c("petrol", "بترولي", "Petrol", "#1F4E5F", ["أزرق", "blue", "teal"]),
  // Purples
  c("purple", "بنفسجي", "Purple", "#6A3D9A", ["violet"]),
  c("lavender", "لافندر", "Lavender", "#B9A7D8", ["بنفسجي فاتح", "purple", "lilac"]),
  c("lilac", "ليلكي", "Lilac", "#C8A2C8", ["بنفسجي", "purple"]),
  c("plum", "برقوقي", "Plum", "#6E3B5F", ["بنفسجي", "purple"]),
  c("mauve", "موف", "Mauve", "#B08CA8", ["بنفسجي", "purple", "وردي"]),
];

/** Colours with no library name carry this stable code. Their label is automatic and neutral, never typed by the owner. */
export const CUSTOM_COLOR_CODE = "custom";

/** The picker's starting value. */
export const DEFAULT_PRODUCT_COLOR = "#B96F52";

const BY_CODE = new Map(COLOR_LIBRARY.map((x) => [x.code, x]));
const BY_HEX = new Map(COLOR_LIBRARY.map((x) => [x.hex, x]));

export const colorByCode = (code: string | null | undefined): LibraryColor | undefined => (code ? BY_CODE.get(code) : undefined);

/** The library colour whose value is EXACTLY this hex (canonical #RRGGBB), if any. */
export const colorByHex = (hex: string | null | undefined): LibraryColor | undefined => (hex ? BY_HEX.get(hex.toUpperCase()) : undefined);

export const libraryColorName = (color: LibraryColor, locale: "ar" | "en"): string => (locale === "ar" ? color.ar : color.en);

/**
 * Search form: lower-case, no Arabic diacritics/tatweel, alef/ya/ta-marbuta/hamza variants unified and
 * Arabic-Indic digits mapped to Latin — so "احمر", "أحمر" and "اَحمر" are the same query.
 */
export function normalizeColorSearch(raw: string): string {
  return raw
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_INDEX = COLOR_LIBRARY.map((color) => ({
  color,
  names: [normalizeColorSearch(color.ar), normalizeColorSearch(color.en)],
  aliases: color.aliases.map(normalizeColorSearch),
}));

/**
 * Colours matching a typed query in EITHER language, best first: an exact name, a name that starts with the
 * query, a name word that starts with it, a name containing it, then aliases. Every query word must match.
 * An empty query lists the whole library in its natural (family) order.
 */
export function searchColors(query: string, limit = COLOR_LIBRARY.length): LibraryColor[] {
  const q = normalizeColorSearch(query);
  if (!q) return COLOR_LIBRARY.slice(0, limit);
  const words = q.split(" ");
  const scored: Array<{ color: LibraryColor; score: number; order: number }> = [];
  SEARCH_INDEX.forEach(({ color, names, aliases }, order) => {
    let total = 0;
    for (const word of words) {
      let best = Infinity;
      for (const n of names) {
        if (n === q) best = Math.min(best, 0);
        else if (n.startsWith(word)) best = Math.min(best, 1);
        else if (n.split(" ").some((part) => part.startsWith(word))) best = Math.min(best, 2);
        else if (n.includes(word)) best = Math.min(best, 3);
      }
      for (const a of aliases) {
        if (a === q) best = Math.min(best, 4);
        else if (a.startsWith(word)) best = Math.min(best, 5);
        else if (a.includes(word)) best = Math.min(best, 6);
      }
      if (best === Infinity) return;
      total += best;
    }
    scored.push({ color, score: total, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).slice(0, limit).map((s) => s.color);
}
