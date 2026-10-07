import {
  PRODUCT_LIMITS,
  isCanonicalCategoryCode,
  isOwnProductUnit,
  type CanonicalCategoryCode,
} from "@/features/commerce/constants";

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
  colors: string[];
  weightKg: number | null;
  sizeLabel: string | null;
  brand: string | null;
  description: string | null;
};

export type OwnProductFieldErrors = Partial<
  Record<"name" | "code" | "category" | "unit" | "weight" | "colors" | "size" | "brand" | "description", string>
>;

export type OwnProductParse =
  | { ok: true; value: OwnProductInput }
  | { ok: false; fieldErrors: OwnProductFieldErrors };

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

/** Trim, collapse inner whitespace, drop empties and case-insensitive duplicates (first spelling wins). */
export function normalizeColors(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const color = collapse(entry);
    if (!color) continue;
    const key = color.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(color);
  }
  return out;
}

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * @param keepUnit the product's current unit when editing: a historical product may
 *                 keep a unit outside the six, but cannot switch to another one.
 */
export function parseOwnProductForm(fd: FormData, keepUnit?: string | null): OwnProductParse {
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

  const colorsRaw = fd.getAll("color").filter((v): v is string => typeof v === "string");
  if (colorsRaw.some((c) => collapse(c).length > PRODUCT_LIMITS.colorMax)) {
    fieldErrors.colors = "showroomProducts.validation.colorTooLong";
  }
  const colors = normalizeColors(colorsRaw);
  if (colors.length > PRODUCT_LIMITS.colorsMax) fieldErrors.colors = "showroomProducts.validation.colorsTooMany";

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
  if (description && description.length > PRODUCT_LIMITS.descriptionMax) fieldErrors.description = "showroomProducts.errors.invalid";

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: {
      name,
      code,
      categoryCode: categoryRaw as CanonicalCategoryCode,
      unit,
      colors,
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
