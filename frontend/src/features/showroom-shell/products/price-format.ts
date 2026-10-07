/**
 * A product's base price for display: Latin digits (readable beside the Arabic text, and the
 * same convention as this page's counts), grouped thousands, two decimals only when the
 * amount has them, then the localized currency label. Formatting only — never arithmetic.
 */
export function formatProductPrice(amount: number, currencyLabel: string): string {
  const whole = Number.isInteger(amount);
  const text = new Intl.NumberFormat("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
  return `${text} ${currencyLabel}`;
}
