/**
 * Product-colour DATA (not styling): the starting palette offered in the Add color popover
 * and the default picker value. These are finishing-material tones the owner can choose
 * for a product — values stored on the product itself — so they are literal by nature
 * and, like brand artwork, live in the one allow-listed file (eslint/ui-foundation-guard.mjs).
 * Component styling still uses tokens only.
 */
export const PRODUCT_COLOR_PALETTE = [
  "#FFFFFF",
  "#F2E9D8",
  "#D8C7A6",
  "#C9B28A",
  "#9A9A9A",
  "#3B3B3B",
  "#111111",
  "#B96F52",
  "#7A5230",
  "#5B7F5B",
  "#3F5F8A",
  "#A8403A",
] as const;

export const DEFAULT_PRODUCT_COLOR = "#B96F52";
