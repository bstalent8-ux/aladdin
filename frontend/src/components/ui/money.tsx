import { cn } from "@/lib/ui/cn";

/**
 * Formats an amount's NUMBER part: Latin digits, grouped thousands, two decimals only when the amount has
 * them. The currency label is drawn separately (see `Money`) so the two can be direction-isolated.
 */
export function formatAmount(amount: number): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount);
}

/**
 * An amount and its currency as ONE bidi-safe unit: "3,900 ج.م" in an Arabic page, "3,900 EGP" in English.
 *
 * The number is isolated as LTR (digits never reverse, `3,900` never becomes `009,3`) and the currency token is
 * isolated in ITS OWN language direction (the Arabic abbreviation `ج.م` keeps its letters and dots in reading
 * order). The two sit side by side in READING order: number first, currency after it — so the number is on the
 * right in Arabic, on the left in English — and the pair never wraps apart. Wrapping the whole string in
 * `dir="ltr"` instead is what used to mangle the Arabic abbreviation.
 */
export function Money({
  amount,
  currency,
  locale,
  className,
  testId,
}: {
  amount: number;
  /** The localized currency label (e.g. "ج.م" / "EGP"). */
  currency: string;
  locale: "ar" | "en";
  className?: string;
  testId?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1 whitespace-nowrap", className)} data-testid={testId}>
      <bdi dir="ltr" className="tabular-nums">{formatAmount(amount)}</bdi>
      {" "}
      <bdi dir={locale === "ar" ? "rtl" : "ltr"}>{currency}</bdi>
    </span>
  );
}
