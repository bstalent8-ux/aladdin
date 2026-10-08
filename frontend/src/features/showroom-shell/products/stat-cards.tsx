import Link from "next/link";
import type { ComponentType } from "react";
import { cn } from "@/lib/ui/cn";
import { IconStat } from "@/components/ui/icon-stat";

export type ProductStat = {
  key: string;
  label: string;
  /** Already formatted for the reader's numerals (same as every other count on the page). */
  value: string;
  href: string;
  active: boolean;
  viewAll: string;
  Icon: ComponentType<{ size?: number }>;
};

/**
 * The four summary cards of My products. Each is also the status filter it
 * summarizes ("View all" opens exactly those products), so the page needs no
 * second set of tabs. The numbers come from one unfiltered count, so they describe
 * the shelf, not the current search.
 */
export function ProductStatCards({ stats }: { stats: ProductStat[] }) {
  return (
    <ul className="grid grid-cols-2 gap-sm desktop:grid-cols-4 desktop:gap-md" data-testid="my-products-stats">
      {stats.map(({ key, label, value, href, active, viewAll, Icon }) => (
        <li key={key} className="min-w-0">
          <Link
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`stat-${key}`}
            className={cn(
              "flex h-full flex-col gap-2 rounded-md border bg-surface p-sm shadow-card transition-colors hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus tablet:p-md",
              active ? "border-accent" : "border",
            )}
          >
            <IconStat Icon={Icon} label={label} value={value} />
            <span className="mt-auto inline-flex items-center gap-1 text-label font-medium text-accent">
              <span aria-hidden="true" className="rtl:rotate-180">←</span>
              {viewAll}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
