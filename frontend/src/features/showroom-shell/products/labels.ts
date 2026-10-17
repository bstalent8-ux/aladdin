import { isCanonicalCategoryCode } from "@/features/commerce/constants";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The category label a product shows. A canonical `category_code` wins; a
 * historical product (no code) falls back to its legacy broad category — never to
 * a guessed canonical one.
 */
export function catalogCategoryLabel(
  t: Translate,
  product: { category_code?: string | null; category?: string | null },
): string {
  if (isCanonicalCategoryCode(product.category_code)) return t(`commerce.canonicalCategories.${product.category_code}`);
  return product.category ? t(`commerce.categories.${product.category}`) : t("showroomProducts.unclassified");
}

/** Management view: an unclassified historical product says so instead of showing a broad bucket as if it were canonical. */
export function ownCategoryLabel(t: Translate, product: { category_code?: string | null }): string {
  return isCanonicalCategoryCode(product.category_code)
    ? t(`commerce.canonicalCategories.${product.category_code}`)
    : t("showroomProducts.unclassified");
}

/**
 * The compact "unit • size • weight" line of a product card (e.g. "Roll • 10 m • 1.2 kg").
 * Only values the product actually has are rendered: a missing size or weight leaves no
 * empty separator, and a product with none of them yields "" (render nothing).
 */
export function productMetaLine(
  t: Translate,
  p: { unit?: string | null; sizeLabel?: string | null; weightKg?: number | null },
): string {
  return [
    p.unit ? t(`commerce.units.${p.unit}`) : null,
    p.sizeLabel?.trim() || null,
    p.weightKg !== null && p.weightKg !== undefined ? `${p.weightKg} ${t("showroomProducts.kg")}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
}
