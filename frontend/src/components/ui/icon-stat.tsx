import type { ComponentType } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The icon + label + figure of a summary card, as ONE inline group.
 *
 * The rule across the suite: an icon that represents a label sits immediately beside it — never at
 * the far edge of the card from the text it describes. The group follows the reading direction
 * (icon first in LTR, icon on the right in Arabic RTL), the label sits over the figure, and the
 * figure stays Latin-digit LTR. Server-safe.
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
    <span className={cn("flex min-w-0 items-center gap-3", className)} data-testid="icon-stat">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-accent-solid/15 text-accent tablet:h-11 tablet:w-11">
        <Icon size={20} />
      </span>
      <span className="flex min-w-0 flex-col gap-1 text-start">
        <span className="text-label leading-snug text-fg-secondary">{label}</span>
        <span className="text-headline font-bold leading-none text-fg" dir="ltr">{value}</span>
      </span>
    </span>
  );
}
