import Link from "next/link";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { resolveBilingualText } from "@/lib/i18n/bilingual";
import { resolveTimezone } from "@/lib/workspace/timezone";
import {
  resolveDashboardPeriod,
  dashboardPeriodRange,
  DASHBOARD_PERIOD_ORDER,
} from "@/lib/workspace/dashboard-period";
import { formatCompactMoney } from "@/lib/ui/format";
import { orgBilingualNames } from "@/server/queries/organization-i18n";
import { loadAccountIdentity } from "@/server/queries/identity";
import {
  loadRecommendedProducts,
  loadShowroomHomeMetrics,
  loadShowroomKpiLayout,
  type RecommendedProduct,
} from "@/server/queries/showroom-home";
import { DashboardPeriodSelect } from "@/features/home/dashboard-period-select";
import { KpiCustomizeDialog } from "@/features/home/kpi-customize-dialog";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { ExpandCollapse } from "@/components/ui/expand-collapse";
import { BadgeCheckIcon, PackageIcon } from "@/components/ui/icons";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { showroomKpiValue } from "./metrics";
import {
  SHOWROOM_KPI_PRIMARY_COUNT,
  availableShowroomKpis,
  resolveShowroomKpiOrder,
  showroomKpiHref,
  type ShowroomKpiEntry,
  type ShowroomKpiKey,
} from "./kpi-catalog";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const CATALOG_ITEM = SHOWROOM_GROUPS.flatMap((group) => group.items).find((item) => item.id === "catalog")!;

/**
 * The showroom suite Home. A showroom is buyer AND seller, so the cards are
 * directional and every figure is scoped to the ACTIVE organization through the
 * caller's own RLS-bound client (`showroom_home_metrics`). Layout, period and
 * customization reuse the production Home machinery; nothing here is a mock.
 */
export async function ShowroomHome({
  ctx,
  locale,
  searchParams,
}: {
  ctx: Ctx;
  locale: Locale;
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const { supabase, org } = ctx;
  const m = getMessages(locale);
  const t = createTranslator(locale);
  const caps = org.capabilities;

  const [names, identity] = await Promise.all([
    orgBilingualNames(supabase, org.organizationId, org.activeBranchId),
    loadAccountIdentity(),
  ]);
  const timezone = resolveTimezone(names.branchTimezone, names.orgTimezone);
  const periodKey = resolveDashboardPeriod(searchParams.period, searchParams.from, searchParams.to);
  const range = dashboardPeriodRange(
    periodKey,
    new Date(),
    timezone,
    periodKey === "custom" && searchParams.from && searchParams.to
      ? { from: searchParams.from, to: searchParams.to }
      : undefined,
  );

  const available = availableShowroomKpis(caps);
  const showProducts = canNavigate(CATALOG_ITEM, caps);

  const [metrics, layout, products] = await Promise.all([
    available.length > 0 ? loadShowroomHomeMetrics(supabase, org.organizationId, range, timezone) : Promise.resolve(null),
    loadShowroomKpiLayout(supabase, org.organizationId, org.membershipId),
    showProducts ? loadRecommendedProducts(supabase, org.organizationId) : Promise.resolve([] as RecommendedProduct[]),
  ]);

  const orderedKeys = resolveShowroomKpiOrder(layout.saved, available);
  const byKey = new Map<ShowroomKpiKey, ShowroomKpiEntry>(available.map((entry) => [entry.key, entry]));
  const periodLabel = m.home.period[periodKey];
  const periodRef = { key: periodKey, from: range.from, to: range.to };

  const tiles: Tile[] = metrics
    ? orderedKeys.map((key) => {
        const entry = byKey.get(key)!;
        const { value, money } = showroomKpiValue(key, metrics);
        const basis = entry.basis === "period" ? periodLabel : t("showroomHome.basisNow");
        return {
          label: t(entry.labelKey),
          value: money ? formatCompactMoney(value, locale) : value,
          Icon: entry.Icon,
          hint: `${t(`showroomHome.direction.${entry.direction}`)} · ${basis}`,
          href: showroomKpiHref(entry, periodRef),
        };
      })
    : [];
  const primaryTiles = tiles.slice(0, SHOWROOM_KPI_PRIMARY_COUNT);
  const secondaryTiles = tiles.slice(SHOWROOM_KPI_PRIMARY_COUNT);

  const personName = identity?.displayName
    ? resolveBilingualText(locale, identity.displayName, identity.displayNameAr, identity.displayNameEn)
    : null;
  const greeting = personName ? t("home.greetingNamed", { name: personName }) : m.home.greeting;
  const periodOptions = DASHBOARD_PERIOD_ORDER.map((value) => ({ value, label: m.home.period[value] }));

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-sm">
          <p className="truncate text-label text-fg-muted">{greeting}</p>
          <div className="flex items-center gap-1.5">
            <h1 className="text-headline text-fg">{m.home.title}</h1>
            {available.length > 0 ? (
              <KpiCustomizeDialog
                surface="showroom_suite"
                orgId={org.organizationId}
                availableKeys={available.map((entry) => entry.key)}
                initialOrder={orderedKeys}
                hasPersonal={layout.hasPersonal}
                hasTeamDefault={layout.hasTeamDefault}
                canManageTeamDefault={caps.includes("org.manage")}
              />
            ) : null}
          </div>
        </div>
        {available.length > 0 ? (
          <DashboardPeriodSelect
            value={periodKey}
            from={periodKey === "custom" ? range.from : undefined}
            to={periodKey === "custom" ? range.to : undefined}
            basePath={`${SHOWROOM_ROOT}/home`}
            label={m.home.period.label}
            options={periodOptions}
            fromLabel={m.home.period.from}
            toLabel={m.home.period.to}
            applyLabel={m.home.period.apply}
          />
        ) : null}
      </div>

      {tiles.length > 0 ? (
        <div className="flex flex-col gap-md" data-testid="showroom-kpis">
          <StatTiles locale={locale} tiles={primaryTiles} layout="grid" columns={6} />
          {secondaryTiles.length > 0 ? (
            <ExpandCollapse moreLabel={m.common.showMore} lessLabel={m.common.showLess}>
              <StatTiles locale={locale} tiles={secondaryTiles} layout="grid" columns={6} />
            </ExpandCollapse>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-dashed bg-surface p-lg text-body text-fg-muted" data-testid="showroom-kpis-empty">
          {t("showroomHome.kpiEmpty")}
        </p>
      )}

      {showProducts ? <RecommendedProducts products={products} t={t} /> : null}
    </div>
  );
}

function RecommendedProducts({ products, t }: { products: RecommendedProduct[]; t: (key: string) => string }) {
  return (
    <section aria-labelledby="showroom-products-title" className="flex flex-col gap-md" data-testid="showroom-products">
      <div className="flex flex-wrap items-end justify-between gap-sm">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="showroom-products-title" className="text-title text-fg">{t("showroomHome.productsTitle")}</h2>
          <p className="text-label text-fg-muted">{t("showroomHome.productsSource")}</p>
        </div>
        <Link
          href={`${SHOWROOM_ROOT}/catalog`}
          className="rounded-sm px-2 py-1 text-label font-medium text-accent transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t("showroomHome.productsViewAll")}
        </Link>
      </div>
      {products.length === 0 ? (
        <p className="rounded-md border border-dashed bg-surface p-lg text-body text-fg-muted" data-testid="showroom-products-empty">
          {t("showroomHome.productsEmpty")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-md min-[520px]:grid-cols-2 desktop:grid-cols-4">
          {products.map((product) => (
            <li key={product.id}>
              <Link
                href={`${SHOWROOM_ROOT}/catalog?product=${encodeURIComponent(product.id)}`}
                className="flex h-full w-full items-center gap-3 rounded-md bg-surface p-md transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm bg-surface-2 text-fg-secondary">
                  <PackageIcon size={18} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-body font-medium text-fg" dir="auto">{product.name}</span>
                  <span className="flex min-w-0 items-center gap-1 text-label text-fg-muted">
                    <span className="truncate" dir="auto">{product.supplier_name ?? product.brand ?? ""}</span>
                    {product.supplier_verified ? <BadgeCheckIcon size={13} /> : null}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
