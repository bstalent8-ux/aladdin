import type { ComponentType } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The icon + label + figure of a summary card.
 *
 * The rule across the suite: an icon that represents a label is ONE visual group with it — never
 * parked at the far edge of the card from the text it describes. The group sits at the logical START of
 * the card (the right edge in Arabic RTL, the left in English) and the figure sits underneath it, starting
 * from the same edge:
 *
 *     [icon] Offers available to you          العروض المتاحة لك [icon]
 *     37                                                          37
 *
 * The figure is direction-isolated (`<bdi dir="ltr">`) inside a start-aligned block, so a Latin number is
 * never reversed and never drifts to the opposite edge of an RTL card. Server-safe.
 */
export function IconStat({
  Icon,
  label,
  value,
  className,
}: {
  Icon: ComponentType<{ size?: number }>;
  label: string;
  /** Already formatted for the reader's numerals. */
  value: string;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col items-start gap-2 text-start", className)} data-testid="icon-stat">
      <span className="flex min-w-0 max-w-full items-center gap-2" data-testid="icon-stat-head">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-accent-solid/15 text-accent">
          <Icon size={18} />
        </span>
        <span className="min-w-0 text-label font-medium leading-snug text-fg-secondary">{label}</span>
      </span>
      <span className="block text-start text-headline font-bold leading-none text-fg" data-testid="icon-stat-value">
        <bdi dir="ltr">{value}</bdi>
      </span>
    </span>
  );
}
