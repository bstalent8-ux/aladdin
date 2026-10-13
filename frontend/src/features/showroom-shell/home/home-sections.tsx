import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locales";
import { Badge } from "@/components/ui/primitives";
import { DonutSplit } from "@/components/ui/charts";
import { BadgeCheckIcon, CheckIcon } from "@/components/ui/icons";
import { ProductMedia } from "@/features/commerce/product-media";
import { catalogCategoryLabel } from "@/features/showroom-shell/products/labels";
import { cn } from "@/lib/ui/cn";
import { formatPlural } from "@/lib/i18n/plural";
import { formatCompactMoney, formatCount, formatDate, formatMoney, formatPercent } from "@/lib/ui/format";
import type { ActiveDirectRfq, CategorySpend, IncomingQuotation } from "@/server/queries/showroom-home";
import type { CatalogRow } from "@/server/queries/commerce";

type T = (key: string, vars?: Record<string, string | number>) => string;

const ITEM_FORMS = {
  en: { one: "{count} item", other: "{count} items" },
  ar: { zero: "لا بنود", one: "بند واحد", two: "بندان", few: "{count} بنود", many: "{count} بندًا", other: "{count} بند" },
} as const;
const itemsLabel = (count: number, locale: Locale) => formatPlural(count, locale, ITEM_FORMS[locale]);

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/** A titled dashboard section on the V2 surface. */
export function HomeSection({ id, title, subtitle, action, children, className }: {
  id: string; title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-md", className)} data-testid={id}>
      <div className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className="text-title text-fg">{title}</h2>
          {subtitle ? <p className="text-label text-fg-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ViewAllLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className={cn("rounded-sm px-2 py-1 text-label font-medium text-accent transition-colors hover:bg-surface-hover", focusRing)}>{label}</Link>;
}

const Empty = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p className="rounded-md border border-dashed bg-surface p-lg text-body text-fg-muted" data-testid={testId}>{children}</p>
);

// --- KPI cards -------------------------------------------------------------------------------------------------

export type KpiCardData = {
  key: string;
  label: string;
  value: string | number;
  hint: string;
  href: string;
  Icon: ComponentType<{ size?: number }>;
};

/** Six separate cards: icon chip, figure, label, one honest line of context. */
export function KpiCards({ cards }: { cards: KpiCardData[] }) {
  return (
    <ul className="grid grid-cols-2 gap-md tablet:grid-cols-3 desktop:grid-cols-6" data-testid="showroom-kpis">
      {cards.map((card) => (
        <li key={card.key} className="min-w-0">
          <Link href={card.href} data-testid={`kpi-${card.key}`} className={cn("flex h-full min-w-0 flex-col gap-3 rounded-md bg-surface p-md transition-colors hover:bg-surface-2/50", focusRing)}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent"><card.Icon size={20} /></span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("break-words font-semibold text-fg", String(card.value).length > 6 ? "text-title" : "text-headline")} dir="auto">{card.value}</span>
              <span className="text-body font-medium leading-snug text-fg">{card.label}</span>
              <span className="text-label text-fg-muted">{card.hint}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Discover new products -------------------------------------------------------------------------------------

export type DiscoverProduct = CatalogRow & { id: string };

/**
 * A horizontal scroll-snap rail (native scrolling, no script): every card is a real published product the
 * viewer's WORKSPACE audience may see, with its signed image or an honest "no photo" panel.
 */
export function DiscoverRail({ products, imageUrls, t, href }: {
  products: DiscoverProduct[]; imageUrls: Record<string, string>; t: T; href: (id: string) => string;
}) {
  if (products.length === 0) return <Empty testId="showroom-discover-empty">{t("showroomHome.v2.discover.empty")}</Empty>;
  return (
    <ul className="-mx-1 flex snap-x snap-mandatory gap-md overflow-x-auto px-1 pb-2 [scrollbar-width:thin]" data-testid="showroom-discover-rail" tabIndex={0} aria-label={t("showroomHome.v2.discover.title")}>
      {products.map((product) => (
        <li key={product.id} className="w-[15.5rem] shrink-0 snap-start tablet:w-[17rem]">
          <article className="flex h-full flex-col gap-2 rounded-md bg-surface p-2" data-testid="showroom-discover-card">
            <div className="relative">
              <ProductMedia src={imageUrls[product.id] ?? null} alt={product.name ?? ""} aspect="aspect-[4/3]" />
              <span className="absolute start-1.5 top-1.5 max-w-[calc(100%-0.75rem)]"><Badge tone="neutral">{catalogCategoryLabel(t, product)}</Badge></span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 px-1 pb-1">
              <h3 className="line-clamp-2 text-body font-medium leading-snug text-fg" dir="auto">{product.name}</h3>
              <p className="flex min-w-0 items-center gap-1 text-label text-fg-secondary">
                <span className="truncate" dir="auto">{product.supplier_name ?? product.brand ?? ""}</span>
                {product.supplier_verified ? <span className="shrink-0 text-success"><BadgeCheckIcon size={13} /></span> : null}
              </p>
              {product.short_description ? <p className="line-clamp-2 text-label text-fg-muted" dir="auto">{product.short_description}</p> : null}
              <Link href={href(product.id)} className={cn("mt-auto self-start rounded-sm py-1 text-label font-medium text-accent hover:underline", focusRing)}>{t("showroomHome.v2.discover.view")}</Link>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

// --- Latest incoming quotations ---------------------------------------------------------------------------------

const QUOTE_TONE: Record<string, "info" | "success" | "danger" | "neutral"> = { submitted: "info", accepted: "success", rejected: "danger" };

export function IncomingQuotations({ rows, locale, t, href }: { rows: IncomingQuotation[]; locale: Locale; t: T; href: (id: string) => string }) {
  if (rows.length === 0) return <Empty testId="showroom-quotes-empty">{t("showroomHome.v2.quotes.empty")}</Empty>;
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-md bg-surface" data-testid="showroom-quotes">
      {rows.map((q) => (
        <li key={q.id}>
          <Link href={href(q.id)} className={cn("flex min-w-0 flex-col gap-1 p-md transition-colors hover:bg-surface-2/50", focusRing)}>
            <span className="flex min-w-0 items-start justify-between gap-sm">
              <span className="truncate text-body font-medium text-fg" dir="auto">{q.supplierName}</span>
              <Badge tone={QUOTE_TONE[q.status] ?? "neutral"}>{t(`showroomHome.v2.quotes.status.${q.status}`)}</Badge>
            </span>
            <span className="truncate text-label text-fg-secondary" dir="auto">{t("showroomHome.v2.quotes.forRfq", { title: q.rfqTitle })}</span>
            <span className="flex flex-wrap items-center justify-between gap-x-md gap-y-0.5 text-label text-fg-muted">
              <span>{[itemsLabel(q.itemCount, locale), q.submittedAt ? formatDate(q.submittedAt, locale) : null].filter(Boolean).join(" · ")}</span>
              {q.total !== null ? <span className="font-medium text-fg">{formatMoney(q.total, locale)}</span> : null}
            </span>
            {q.validityDate ? <span className="text-label text-fg-muted">{t("showroomHome.v2.quotes.validUntil", { date: formatDate(q.validityDate, locale) })}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Purchasing by category -------------------------------------------------------------------------------------

export function CategoryDistribution({ spend, locale, t, periodLabel }: { spend: CategorySpend[]; locale: Locale; t: T; periodLabel: string }) {
  return (
    <div className="flex flex-col gap-md rounded-md bg-surface p-md" data-testid="showroom-category-chart">
      <DonutSplit
        slices={spend.map((s) => ({ label: t(`commerce.categories.${s.category}`), value: s.amount }))}
        emptyLabel={t("showroomHome.v2.category.empty")}
        ariaLabel={t("showroomHome.v2.category.aria")}
        centerLabel={t("showroomHome.v2.category.center")}
        formatValue={(v) => formatCompactMoney(v, locale)}
        formatShare={(pct) => formatPercent(pct, locale)}
      />
      {spend.length > 0 ? <p className="border-t pt-sm text-label text-fg-muted">{t("showroomHome.v2.category.note")}</p> : null}
      <span className="sr-only">{periodLabel}</span>
    </div>
  );
}

// --- Active Direct RFQs ------------------------------------------------------------------------------------------

const STAGES = ["submitted", "quoted", "closed"] as const;

/** Three honest steps - the lifecycle the data actually has - never a percentage. */
function StageSteps({ status, t }: { status: ActiveDirectRfq["status"]; t: T }) {
  const at = STAGES.indexOf(status);
  return (
    <ol className="flex items-center gap-1.5" aria-label={t("showroomHome.v2.requests.stageAria", { stage: t(`showroomHome.v2.requests.stage.${status}`) })}>
      {STAGES.map((stage, i) => (
        <li key={stage} className="flex items-center gap-1.5" aria-current={i === at ? "step" : undefined}>
          <span className={cn("grid h-5 min-w-5 place-items-center rounded-pill px-1.5 text-[11px] font-medium", i <= at ? "bg-accent-solid/15 text-accent" : "border text-fg-muted")}>
            {i < at ? <CheckIcon size={11} /> : t(`showroomHome.v2.requests.stage.${stage}`)}
          </span>
          {i < STAGES.length - 1 ? <span aria-hidden className={cn("h-px w-3", i < at ? "bg-accent-solid/50" : "bg-surface-2")} /> : null}
        </li>
      ))}
    </ol>
  );
}

export function ActiveRfqs({ rows, locale, t, href }: { rows: ActiveDirectRfq[]; locale: Locale; t: T; href: (id: string) => string }) {
  if (rows.length === 0) return <Empty testId="showroom-requests-empty">{t("showroomHome.v2.requests.empty")}</Empty>;
  return (
    <ul className="flex flex-col divide-y overflow-hidden rounded-md bg-surface" data-testid="showroom-requests">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={href(r.id)} className={cn("grid min-w-0 gap-x-md gap-y-1 p-md transition-colors hover:bg-surface-2/50 tablet:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto] tablet:items-center", focusRing)}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-body font-medium text-fg" dir="auto">{r.title}</span>
              <span className="truncate text-label text-fg-muted" dir="auto">{[r.supplierName, itemsLabel(r.itemCount, locale), r.requiredDate ? t("showroomHome.v2.requests.required", { date: formatDate(r.requiredDate, locale) }) : null].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="text-label text-fg-muted">{r.submittedAt ? formatDate(r.submittedAt, locale) : ""}</span>
            <StageSteps status={r.status} t={t} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// --- Quick actions & benefits ------------------------------------------------------------------------------------

export type QuickAction = { key: string; label: string; href: string; Icon: ComponentType<{ size?: number }> };

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-sm min-[480px]:grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-6" data-testid="showroom-quick-actions">
      {actions.map((a) => (
        <li key={a.key}>
          <Link href={a.href} className={cn("flex min-w-0 items-center gap-2.5 rounded-md bg-surface p-3 text-label font-medium text-fg transition-colors hover:bg-surface-2/50", focusRing)}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent"><a.Icon size={16} /></span>
            <span className="min-w-0 leading-snug">{a.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Benefits({ items }: { items: { key: string; title: string; body: string; Icon: ComponentType<{ size?: number }> }[] }) {
  return (
    <ul className="grid grid-cols-1 gap-md tablet:grid-cols-3" data-testid="showroom-benefits">
      {items.map((b) => (
        <li key={b.key} className="flex gap-3 rounded-md bg-surface p-md">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-surface-2 text-accent"><b.Icon size={20} /></span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body font-medium text-fg">{b.title}</span>
            <span className="text-label text-fg-muted">{b.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
