/**
 * Product-browsing display preference (grid or list).
 *
 * Presentation-only, so it lives in a per-browser cookie exactly like the theme,
 * locale and sidebar-mode preferences — no database row. A cookie (not
 * localStorage) lets the server render the chosen layout in the first byte, so
 * the page never paints one layout and then snaps to the other.
 */
export const CATALOG_VIEW_COOKIE = "aladdin-catalog-view";

export type CatalogView = "grid" | "list";

/** Unknown/absent cookie falls back to the default: grid. */
export function resolveCatalogView(value: string | undefined): CatalogView {
  return value === "list" ? "list" : "grid";
}
