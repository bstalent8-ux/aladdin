import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { resolveTimezone } from "@/lib/workspace/timezone";
import { zonedRange } from "@/lib/workspace/zoned-range";
import {
  resolveDashboardPeriod,
  dashboardPeriodRange,
  previousDashboardPeriodRange,
  DASHBOARD_PERIOD_ORDER,
} from "@/lib/workspace/dashboard-period";
import { formatCompactMoneyFine, formatCount } from "@/lib/ui/format";
import { orgBilingualNames } from "@/server/queries/organization-i18n";
import { listCatalogImages, signProductImageUrls } from "@/server/queries/product-images";
import {
  loadLatestIncomingQuotations,
  loadPurchasingByCategory,
  loadShowroomHomeMetrics,
  loadShowroomKpiLayout,
  loadShowroomOrderCounts,
  type CategorySpend,
  type IncomingQuotation,
} from "@/server/queries/showroom-home";
import { DashboardPeriodSelect } from "@/features/home/dashboard-period-select";
import { KpiCustomizeDialog } from "@/features/home/kpi-customize-dialog";
import { ExpandCollapse } from "@/components/ui/expand-collapse";
import { BarChartIcon, FileTextIcon, PackageIcon } from "@/components/ui/icons";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { loadCatalogBatch } from "@/features/showroom-shell/catalog/catalog-data";
import { showroomKpiValue, type ShowroomOrderCounts } from "./metrics";
import {
  SHOWROOM_KPI_PRIMARY_COUNT,
  availableShowroomKpis,
  resolveShowroomKpiOrder,
  showroomKpiHref,
  type ShowroomKpiKey,
} from "./kpi-catalog";
import {
  CategoryDistribution, DiscoverRail, HomePanel, IncomingQuotations, KpiCards, ViewAllLink, trendFor,
  type DiscoverProduct, type KpiCardData,
} from "./home-sections";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const ITEMS = new Map(SHOWROOM_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item]));
const item = (id: string) => ITEMS.get(id)!;
const DISCOVER_LIMIT = 6;
const NO_ORDER_COUNTS: ShowroomOrderCounts = { completedOrders: 0, awaitingExecution: 0 };

/**
 * The Showroom Home, composed as the approved reference: header with the period selector, the KPI cards,
 * product discovery, the latest incoming quotations and purchasing by category.
 *
 * Every figure is read through the caller's own RLS-bound client for the ACTIVE organization, and a section is
 * shown only to a caller who could open the page behind it. Which cards appear, and in which order, is the
 * existing "تخصيص بطاقات المؤشرات" layout (personal, else team default, else the reference's five). Trends compare
 * with the previous period of the same length, computed from two real readings.
 *
 * Not drawn because the data does not exist: a showroom rating, a membership card, Shared Purchase Requests
 * (Milestone D) and a supplier city on product cards. See docs/frontend/showroom-v2-reference-alignment.md.
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

  const names = await orgBilingualNames(supabase, org.organizationId, org.activeBranchId);
  const timezone = resolveTimezone(names.branchTimezone, names.orgTimezone);
  const periodKey = resolveDashboardPeriod(searchParams.period, searchParams.from, searchParams.to);
  const range = dashboardPeriodRange(
    periodKey,
    new Date(),
    timezone,
    periodKey === "custom" && searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to } : undefined,
  );
  const previous = previousDashboardPeriodRange(range, timezone);
  const window = zonedRange(range.from, range.to, timezone);
  const previousWindow = zonedRange(previous.from, previous.to, timezone);
  const periodLabel = m.home.period[periodKey];
  const periodRef = { key: periodKey, from: range.from, to: range.to };

  const canQuotes = canNavigate(item("quotes-received"), caps);
  const canOrders = canNavigate(item("purchase-orders"), caps);
  const canCatalog = canNavigate(item("catalog"), caps);
  const available = availableShowroomKpis(caps);
  const needMetrics = available.length > 0;
  const needOrderCounts = available.some((entry) => entry.key === "completed_orders" || entry.key === "orders_awaiting_execution");

  const [metrics, previousMetrics, orders, previousOrders, layout, catalog, quotations, spend] = await Promise.all([
    needMetrics ? loadShowroomHomeMetrics(supabase, org.organizationId, range, timezone) : Promise.resolve(null),
    needMetrics ? loadShowroomHomeMetrics(supabase, org.organizationId, previous, timezone) : Promise.resolve(null),
    needOrderCounts ? loadShowroomOrderCounts(supabase, org.organizationId, window) : Promise.resolve(NO_ORDER_COUNTS),
    needOrderCounts ? loadShowroomOrderCounts(supabase, org.organizationId, previousWindow) : Promise.resolve(NO_ORDER_COUNTS),
    loadShowroomKpiLayout(supabase, org.organizationId, org.membershipId),
    canCatalog ? loadCatalogBatch(supabase, org.organizationId, {}, 0, DISCOVER_LIMIT) : Promise.resolve(null),
    canQuotes ? loadLatestIncomingQuotations(supabase, org.organizationId) : Promise.resolve([] as IncomingQuotation[]),
    canOrders ? loadPurchasingByCategory(supabase, org.organizationId, window) : Promise.resolve([] as CategorySpend[]),
  ]);

  // Thumbnails of the products on the latest quotations, through the same audience-checked signing as the catalog.
  const quoteProductIds = [...new Set(quotations.flatMap((q) => (q.productId ? [q.productId] : [])))];
  const quoteImages = quoteProductIds.length > 0 ? await listCatalogImages(supabase, org.organizationId, quoteProductIds) : new Map();
  const quoteKeys = [...quoteImages.values()].flatMap((list) => (list[0] ? [list[0].objectKey] : []));
  const signedQuoteKeys = await signProductImageUrls(supabase, quoteKeys, { orgId: org.organizationId });
  const quoteImageUrls: Record<string, string> = {};
  for (const [productId, list] of quoteImages) {
    const url = list[0] ? signedQuoteKeys.get(list[0].objectKey) : undefined;
    if (url) quoteImageUrls[productId] = url;
  }

  // --- KPI cards: the customization layout decides which and in what order -------------------------------------
  const order = resolveShowroomKpiOrder(layout.saved, available);
  const cards: KpiCardData[] = metrics && previousMetrics
    ? order.map((key: ShowroomKpiKey) => {
        const entry = available.find((e) => e.key === key)!;
        const now = showroomKpiValue(key, metrics, orders);
        const before = entry.basis === "period" ? showroomKpiValue(key, previousMetrics, previousOrders).value : null;
        return {
          key,
          label: t(entry.labelKey),
          value: now.money ? formatCompactMoneyFine(now.value, locale) : formatCount(now.value, locale),
          trend: trendFor(now.value, before),
          linkLabel: t(entry.linkLabelKey),
          href: showroomKpiHref(entry, periodRef),
          Icon: entry.Icon,
        };
      })
    : [];
  const primaryCards = cards.slice(0, SHOWROOM_KPI_PRIMARY_COUNT);
  const extraCards = cards.slice(SHOWROOM_KPI_PRIMARY_COUNT);

  const periodOptions = DASHBOARD_PERIOD_ORDER.map((value) => ({ value, label: m.home.period[value] }));
  const discoverProducts: DiscoverProduct[] = (catalog?.products ?? []).filter((p): p is DiscoverProduct => Boolean(p.id));

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-accent-solid/15 text-accent"><BarChartIcon size={24} /></span>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-headline text-fg">{t("showroomHome.v3.title")}</h1>
            <p className="text-label text-fg-muted">{t("showroomHome.v3.subtitle")}</p>
          </div>
        </div>
        {needMetrics ? (
          <div className="flex items-center gap-1.5">
            <KpiCustomizeDialog
              surface="showroom_suite"
              orgId={org.organizationId}
              availableKeys={available.map((entry) => entry.key)}
              initialOrder={order}
              hasPersonal={layout.hasPersonal}
              hasTeamDefault={layout.hasTeamDefault}
              canManageTeamDefault={caps.includes("org.manage")}
            />
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
          </div>
        ) : null}
      </div>

      {cards.length > 0 ? (
        <div className="flex flex-col gap-md">
          <KpiCards cards={primaryCards} locale={locale} t={t} />
          {extraCards.length > 0 ? (
            <ExpandCollapse moreLabel={m.common.showMore} lessLabel={m.common.showLess}>
              <KpiCards cards={extraCards} locale={locale} t={t} />
            </ExpandCollapse>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-dashed bg-surface p-lg text-body text-fg-muted" data-testid="showroom-kpis-empty">{t("showroomHome.kpiEmpty")}</p>
      )}

      {canCatalog ? (
        <HomePanel
          id="showroom-discover"
          Icon={PackageIcon}
          title={t("showroomHome.v3.discover.title")}
          subtitle={t("showroomHome.v3.discover.subtitle")}
          action={<ViewAllLink href={item("catalog").href} label={t("showroomHome.v3.discover.viewAll")} />}
        >
          <DiscoverRail products={discoverProducts} imageUrls={catalog?.imageUrls ?? {}} t={t} href={(id) => `${SHOWROOM_ROOT}/catalog/${encodeURIComponent(id)}`} />
        </HomePanel>
      ) : null}

      {canQuotes || canOrders ? (
        <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
          {canQuotes ? (
            <HomePanel
              id="showroom-quotes-section"
              Icon={FileTextIcon}
              title={t("showroomHome.v3.quotes.title")}
              subtitle={t("showroomHome.v3.quotes.subtitle")}
              action={<ViewAllLink href={item("quotes-received").href} label={t("showroomHome.v3.quotes.viewAll")} />}
            >
              <IncomingQuotations rows={quotations} imageUrls={quoteImageUrls} locale={locale} t={t} href={(id) => `/b2b/quotations/${encodeURIComponent(id)}`} />
            </HomePanel>
          ) : null}
          {canOrders ? (
            <HomePanel
              id="showroom-category-section"
              Icon={BarChartIcon}
              title={t("showroomHome.v3.category.title")}
              subtitle={t("showroomHome.v3.category.subtitle", { period: periodLabel })}
            >
              <CategoryDistribution spend={spend} locale={locale} t={t} />
            </HomePanel>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
