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
