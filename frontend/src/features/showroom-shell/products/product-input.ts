import {
  PRODUCT_LIMITS,
  isCanonicalCategoryCode,
  isOwnProductUnit,
  type CanonicalCategoryCode,
} from "@/features/commerce/constants";
import { COLOR_CODE_PATTERN, normalizeColorItems, normalizeHex, type ProductColor } from "./color-items";

/**
 * One validation path for the own-product form, shared by the create and edit
 * server actions and unit-tested on its own. It mirrors the database's rules so
 * the common mistakes are answered instantly with a translated message — but the
 * database (`app.own_product_validate`, the unique index, the check constraints)
 * remains the authority and re-checks everything.
 */
export type OwnProductInput = {
  name: string;
  code: string;
  categoryCode: CanonicalCategoryCode;
  /** A canonical unit, or the product's existing historical unit when it is being kept. */
  unit: string;
  colors: ProductColor[];
  /** Regular selling price in EGP (two decimals at most), or null when none was entered. */
  basePrice: number | null;
  weightKg: number | null;
  sizeLabel: string | null;
  brand: string | null;
  description: string | null;
};

export type OwnProductFieldErrors = Partial<
  Record<"name" | "code" | "category" | "unit" | "weight" | "colors" | "size" | "brand" | "description" | "price", string>
>;

export type OwnProductParse =
  | { ok: true; value: OwnProductInput }
  | { ok: false; fieldErrors: OwnProductFieldErrors };

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

/** Words are runs of non-whitespace — the same rule the database applies (`app.word_count`). */
export function countWords(value: string): number {
  const t = value.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Money is parsed from text into a number that is exact for what is allowed here: a
 * positive amount, at most two decimals, at most priceMax. Arabic-Indic digits and the
 * Arabic decimal separator are accepted as typed. Never a float computation — the
 * regex gates the shape, and the database stores numeric(14,2).
 */
export function parsePrice(raw: string): { ok: true; value: number } | { ok: false } {
  const t = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[٫,]/g, ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return { ok: false };
  const n = Number(t);
  return n > 0 && n <= PRODUCT_LIMITS.priceMax ? { ok: true, value: n } : { ok: false };
}

/** The structured colors arrive as one JSON field (`colorItems`); anything malformed is rejected, not repaired. */
function readColorItems(fd: FormData): { items: ProductColor[]; error?: string } {
  const raw = fd.get("colorItems");
  if (typeof raw !== "string" || raw.trim() === "") return { items: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { items: [], error: "showroomProducts.validation.colorHexInvalid" };
  }
  if (!Array.isArray(data)) return { items: [], error: "showroomProducts.validation.colorHexInvalid" };
  const items: ProductColor[] = [];
  for (const entry of data) {
    const name = typeof entry?.name === "string" ? entry.name.replace(/\s+/g, " ").trim() : "";
    if (!name) continue;
    if (name.length > PRODUCT_LIMITS.colorMax) return { items: [], error: "showroomProducts.validation.colorTooLong" };
    const codeRaw = entry?.code;
    if (codeRaw !== undefined && codeRaw !== null && (typeof codeRaw !== "string" || !COLOR_CODE_PATTERN.test(codeRaw))) {
      return { items: [], error: "showroomProducts.validation.colorHexInvalid" };
    }
    const code = typeof codeRaw === "string" ? { code: codeRaw } : {};
    const hexRaw = entry?.hex;
    if (hexRaw === null || hexRaw === undefined || hexRaw === "") {
      items.push({ name, hex: null, ...code });
      continue;
    }
    const hex = typeof hexRaw === "string" ? normalizeHex(hexRaw) : null;
    if (!hex) return { items: [], error: "showroomProducts.validation.colorHexInvalid" };
    items.push({ name, hex, ...code });
  }
  return { items };
}

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * @param keepUnit the product's current unit when editing: a historical product may
 *                 keep a unit outside the six, but cannot switch to another one.
 */
export function parseOwnProductForm(fd: FormData, keepUnit?: string | null, opts: { priceRequired?: boolean } = {}): OwnProductParse {
  const fieldErrors: OwnProductFieldErrors = {};

  const name = collapse(text(fd, "name"));
  if (name.length < PRODUCT_LIMITS.nameMin || name.length > PRODUCT_LIMITS.nameMax) {
    fieldErrors.name = name ? "showroomProducts.validation.nameLength" : "commerce.validation.nameRequired";
  }

  const code = collapse(text(fd, "code"));
  if (!code) fieldErrors.code = "showroomProducts.validation.codeRequired";
  else if (code.length > PRODUCT_LIMITS.codeMax) fieldErrors.code = "showroomProducts.validation.codeLength";

  const categoryRaw = text(fd, "categoryCode");
  if (!isCanonicalCategoryCode(categoryRaw)) {
    fieldErrors.category = categoryRaw ? "showroomProducts.errors.categoryInvalid" : "commerce.validation.categoryRequired";
  }

  const unit = text(fd, "unit");
  if (!unit) fieldErrors.unit = "commerce.validation.unitRequired";
  else if (!isOwnProductUnit(unit) && unit !== keepUnit) fieldErrors.unit = "showroomProducts.errors.unitInvalid";

  const { items: parsedColors, error: colorError } = readColorItems(fd);
  if (colorError) fieldErrors.colors = colorError;
  const colors = normalizeColorItems(parsedColors);
  if (colors.length > PRODUCT_LIMITS.colorsMax) fieldErrors.colors = "showroomProducts.validation.colorsTooMany";

  let basePrice: number | null = null;
  const priceRaw = text(fd, "basePrice").trim();
  if (priceRaw === "") {
    if (opts.priceRequired) fieldErrors.price = "showroomProducts.validation.priceRequired";
  } else {
    const parsedPrice = parsePrice(priceRaw);
    if (parsedPrice.ok) basePrice = parsedPrice.value;
    else fieldErrors.price = "showroomProducts.validation.priceInvalid";
  }

  let weightKg: number | null = null;
  const weightRaw = text(fd, "weightKg").trim();
  if (weightRaw !== "") {
    const n = Number(weightRaw.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > PRODUCT_LIMITS.weightMax) fieldErrors.weight = "showroomProducts.validation.weightInvalid";
    else weightKg = Math.round(n * 1000) / 1000;
  }

  const sizeLabel = collapse(text(fd, "sizeLabel")) || null;
  if (sizeLabel && sizeLabel.length > PRODUCT_LIMITS.sizeMax) fieldErrors.size = "showroomProducts.errors.invalid";
  const brand = collapse(text(fd, "brand")) || null;
  if (brand && brand.length > PRODUCT_LIMITS.brandMax) fieldErrors.brand = "showroomProducts.errors.invalid";
  const description = text(fd, "description").trim() || null;
  if (description && (countWords(description) > PRODUCT_LIMITS.descriptionWordsMax || description.length > PRODUCT_LIMITS.descriptionCharsMax)) {
    fieldErrors.description = "showroomProducts.validation.descriptionWords";
  }

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: {
      name,
      code,
      categoryCode: categoryRaw as CanonicalCategoryCode,
      unit,
      colors,
      basePrice,
      weightKg,
      sizeLabel,
      brand,
      description,
    },
  };
}

/** Which action a lifecycle button performs. */
export type OwnProductLifecycleAction = "activate" | "deactivate" | "archive" | "restore";

export function isLifecycleAction(value: unknown): value is OwnProductLifecycleAction {
  return value === "activate" || value === "deactivate" || value === "archive" || value === "restore";
}

export type OwnProductStatus = "active" | "inactive" | "archived";

/** The management status of a product row: archived beats published beats draft. */
export function ownProductStatus(row: { status: string; archived_at: string | null }): OwnProductStatus {
  if (row.archived_at) return "archived";
  return row.status === "published" ? "active" : "inactive";
}

/** The actions a status offers, given what the caller may do. */
export function availableLifecycleActions(
  status: OwnProductStatus,
  can: { write: boolean; publish: boolean },
): OwnProductLifecycleAction[] {
  const out: OwnProductLifecycleAction[] = [];
  if (status === "archived") {
    if (can.write) out.push("restore");
    return out;
  }
  if (status === "inactive" && can.publish) out.push("activate");
  if (status === "active" && can.publish) out.push("deactivate");
  if (can.write) out.push("archive");
  return out;
}
