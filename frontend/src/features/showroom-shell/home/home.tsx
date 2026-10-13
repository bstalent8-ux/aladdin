import { getMessages, createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { resolveBilingualText } from "@/lib/i18n/bilingual";
import { resolveTimezone } from "@/lib/workspace/timezone";
import { zonedRange } from "@/lib/workspace/zoned-range";
import {
  resolveDashboardPeriod,
  dashboardPeriodRange,
  DASHBOARD_PERIOD_ORDER,
} from "@/lib/workspace/dashboard-period";
import { formatCompactMoney, formatCount } from "@/lib/ui/format";
import { orgBilingualNames } from "@/server/queries/organization-i18n";
import { loadAccountIdentity } from "@/server/queries/identity";
import { countQuotations } from "@/server/queries/commerce";
import { overdueFollowUps } from "@/server/queries/sales";
import { listJoinRequests } from "@/server/queries/affiliation";
import {
  loadActiveDirectRfqs,
  loadLatestIncomingQuotations,
  loadPurchasingByCategory,
  loadShowroomHeadlineExtras,
  loadShowroomHomeMetrics,
  loadShowroomKpiLayout,
  type ActiveDirectRfq,
  type CategorySpend,
  type IncomingQuotation,
  type ShowroomHeadlineExtras,
} from "@/server/queries/showroom-home";
import { DashboardPeriodSelect } from "@/features/home/dashboard-period-select";
import { KpiCustomizeDialog } from "@/features/home/kpi-customize-dialog";
import { NeedsAttentionSection } from "@/features/home/needs-attention";
import { StatTiles, type Tile } from "@/components/ui/stat-tiles";
import { ExpandCollapse } from "@/components/ui/expand-collapse";
import {
  BuildingIcon, ClipboardIcon, CheckIcon, PlusIcon, ScrollIcon, SendIcon, SettingsIcon, StorefrontIcon, TagIcon, UsersIcon,
} from "@/components/ui/icons";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";
import { loadCatalogBatch } from "@/features/showroom-shell/catalog/catalog-data";
import { showroomKpiValue } from "./metrics";
import {
  availableShowroomKpis,
  resolveShowroomKpiOrder,
  showroomKpiHref,
  type ShowroomKpiEntry,
  type ShowroomKpiKey,
} from "./kpi-catalog";
import {
  ActiveRfqs, Benefits, CategoryDistribution, DiscoverRail, HomeSection, IncomingQuotations, KpiCards, QuickActions, ViewAllLink,
  type DiscoverProduct, type KpiCardData, type QuickAction,
} from "./home-sections";
import type { requireShowroomContext } from "../context";

type Ctx = Awaited<ReturnType<typeof requireShowroomContext>>;

const ITEMS = new Map(SHOWROOM_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item]));
const item = (id: string) => ITEMS.get(id)!;

/** Figures that already appear in the six headline cards; the customizable "more figures" row never repeats them. */
const HEADLINE_KEYS: readonly ShowroomKpiKey[] = ["quotes_received", "orders_in_progress", "total_purchases"];
const DISCOVER_LIMIT = 10;

const EMPTY_EXTRAS: ShowroomHeadlineExtras = { activeRfqs: 0, completedOrders: 0 };

/**
 * The Showroom Home. A Showroom is buyer AND seller, so every figure is scoped to the ACTIVE organization
 * through the caller's own RLS-bound client, and every section is gated by the same capability rule as its
 * destination: a figure is only shown to someone who could open the page behind it, and every link leads to a
 * finished page.
 *
 * Nothing is invented. Not supported yet, and therefore NOT drawn (see docs/frontend/showroom-v2-home-data-map.md):
 *  - a Showroom rating (no showroom-rating data exists; job reviews rate professionals, not showrooms),
 *  - Shared Purchase Requests (طلبات الشراء, Milestone D) - Direct RFQs are a different system and are labelled so,
 *  - a membership/package card (no trustworthy subscription or entitlement state exists).
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
  const has = (...keys: string[]) => caps.includes("org.manage") || keys.some((k) => caps.includes(k));

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
    periodKey === "custom" && searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to } : undefined,
  );
  const window = zonedRange(range.from, range.to, timezone);
  const periodLabel = m.home.period[periodKey];
  const periodRef = { key: periodKey, from: range.from, to: range.to };

  const canRfqs = canNavigate(item("pricing-requests-sent"), caps);
  const canQuotes = canNavigate(item("quotes-received"), caps);
  const canOrders = canNavigate(item("purchase-orders"), caps);
  const canCustomerRfqs = canNavigate(item("customer-rfqs"), caps);
  const canSaved = canNavigate(item("saved"), caps);
  const canCatalog = canNavigate(item("catalog"), caps);
  const sells = has("sales.read", "sales.write", "sales.manage");
  const canManageMembers = has("org.members.manage");

  // The sixth headline card: what a seller-capable Showroom needs most, else the shortlist.
  const sixthKey: ShowroomKpiKey | null = canCustomerRfqs ? "customer_rfqs_received" : canSaved ? "saved_products" : null;
  const available = availableShowroomKpis(caps);
  const moreAvailable = available.filter((entry) => !HEADLINE_KEYS.includes(entry.key) && entry.key !== sixthKey);
  const needMetrics = available.length > 0;

  const [metrics, extras, layout, catalog, quotations, requests, spend, quotationsToDecide, overdue, joinRequests] = await Promise.all([
    needMetrics ? loadShowroomHomeMetrics(supabase, org.organizationId, range, timezone) : Promise.resolve(null),
    canRfqs || canOrders ? loadShowroomHeadlineExtras(supabase, org.organizationId, window) : Promise.resolve(EMPTY_EXTRAS),
    loadShowroomKpiLayout(supabase, org.organizationId, org.membershipId),
    canCatalog ? loadCatalogBatch(supabase, org.organizationId, {}, 0, DISCOVER_LIMIT) : Promise.resolve(null),
    canQuotes ? loadLatestIncomingQuotations(supabase, org.organizationId) : Promise.resolve([] as IncomingQuotation[]),
    canRfqs ? loadActiveDirectRfqs(supabase, org.organizationId) : Promise.resolve([] as ActiveDirectRfq[]),
    canOrders ? loadPurchasingByCategory(supabase, org.organizationId, window) : Promise.resolve([] as CategorySpend[]),
    canQuotes ? countQuotations(supabase, org.organizationId, "requester", ["submitted"]) : Promise.resolve(0),
    sells ? overdueFollowUps(supabase, org.organizationId, org.activeBranchId) : Promise.resolve([]),
    canManageMembers ? listJoinRequests(supabase, org.organizationId) : Promise.resolve([]),
  ]);

  // --- The six headline cards -------------------------------------------------------------------------------
  const kpiHref = (key: ShowroomKpiKey) => showroomKpiHref(available.find((entry) => entry.key === key)!, periodRef);
  const headline: KpiCardData[] = [];
  if (metrics) {
    const cardFor = (key: ShowroomKpiKey, hint: string): KpiCardData => {
      const entry = available.find((e) => e.key === key)!;
      const { value, money } = showroomKpiValue(key, metrics);
      return { key, label: t(entry.labelKey), value: money ? formatCompactMoney(value, locale) : formatCount(value, locale), hint, href: kpiHref(key), Icon: entry.Icon };
    };
    if (canRfqs) headline.push({ key: "active_rfqs", label: t("showroomHome.v2.kpi.activeRfqs"), value: formatCount(extras.activeRfqs, locale), hint: t("showroomHome.v2.hintOpen"), href: item("pricing-requests-sent").href, Icon: SendIcon });
    if (canQuotes) headline.push(cardFor("quotes_received", `${t("showroomHome.v2.hintReceived")} · ${periodLabel}`));
    if (canOrders) {
      headline.push(cardFor("orders_in_progress", t("showroomHome.basisNow")));
      headline.push({ key: "completed_orders", label: t("showroomHome.v2.kpi.completedOrders"), value: formatCount(extras.completedOrders, locale), hint: `${t("showroomHome.v2.hintCompleted")} · ${periodLabel}`, href: item("purchase-orders").href, Icon: CheckIcon });
      headline.push(cardFor("total_purchases", `${t(`showroomHome.direction.purchasing`)} · ${periodLabel}`));
    }
    if (sixthKey) headline.push(cardFor(sixthKey, `${t(`showroomHome.direction.${available.find((e) => e.key === sixthKey)!.direction}`)} · ${available.find((e) => e.key === sixthKey)!.basis === "period" ? periodLabel : t("showroomHome.basisNow")}`));
  }

  // --- The customizable "more figures" row (existing layout machinery, unchanged) --------------------------
  const moreOrder = resolveShowroomKpiOrder(layout.saved, moreAvailable);
  const byKey = new Map<ShowroomKpiKey, ShowroomKpiEntry>(moreAvailable.map((entry) => [entry.key, entry]));
  const moreTiles: Tile[] = metrics
    ? moreOrder.map((key) => {
        const entry = byKey.get(key)!;
        const { value, money } = showroomKpiValue(key, metrics);
        const basis = entry.basis === "period" ? periodLabel : t("showroomHome.basisNow");
        return { label: t(entry.labelKey), value: money ? formatCompactMoney(value, locale) : value, Icon: entry.Icon, hint: `${t(`showroomHome.direction.${entry.direction}`)} · ${basis}`, href: showroomKpiHref(entry, periodRef) };
      })
    : [];

  // --- Header -------------------------------------------------------------------------------------------------
  const personName = identity?.displayName ? resolveBilingualText(locale, identity.displayName, identity.displayNameAr, identity.displayNameEn) : null;
  const greeting = personName ? t("home.greetingNamed", { name: personName }) : m.home.greeting;
  const orgName = resolveBilingualText(locale, org.organizationName, names.orgNameAr, names.orgNameEn);
  const branch = org.branches.find((b) => b.id === org.activeBranchId) ?? (org.branches.length === 1 ? org.branches[0] : undefined);
  const branchName = branch ? resolveBilingualText(locale, branch.name, names.branchNameAr, names.branchNameEn) : null;
  const periodOptions = DASHBOARD_PERIOD_ORDER.map((value) => ({ value, label: m.home.period[value] }));

  // --- Quick actions: only destinations this caller can actually use ----------------------------------------
  const actions: QuickAction[] = [
    ...(canRfqs && has("rfq.create") ? [{ key: "new-rfq", label: t("showroomHome.v2.actions.newRfq"), href: "/b2b/rfqs/new", Icon: PlusIcon }] : []),
    ...(canCatalog ? [{ key: "browse", label: t("showroomHome.v2.actions.browse"), href: item("catalog").href, Icon: StorefrontIcon }] : []),
    ...(canNavigate(item("my-products"), caps) ? [{ key: "add-product", label: t("showroomHome.v2.actions.addProduct"), href: `${SHOWROOM_ROOT}/my-products/new`, Icon: PlusIcon }] : []),
    ...(canNavigate(item("my-offers"), caps) ? [{ key: "new-offer", label: t("showroomHome.v2.actions.newOffer"), href: `${SHOWROOM_ROOT}/my-offers/new`, Icon: TagIcon }] : []),
    ...(canNavigate(item("sales-team"), caps) ? [{ key: "team", label: t("showroomHome.v2.actions.team"), href: item("sales-team").href, Icon: UsersIcon }] : []),
    { key: "settings", label: t("showroomHome.v2.actions.settings"), href: item("settings").href, Icon: SettingsIcon },
  ];
  const benefits = [
    ...(canRfqs ? [{ key: "rfq", title: t("showroomHome.v2.benefits.rfq.title"), body: t("showroomHome.v2.benefits.rfq.body"), Icon: ScrollIcon }] : []),
    ...(canCatalog ? [{ key: "offers", title: t("showroomHome.v2.benefits.offers.title"), body: t("showroomHome.v2.benefits.offers.body"), Icon: TagIcon }] : []),
    ...(canOrders ? [{ key: "orders", title: t("showroomHome.v2.benefits.orders.title"), body: t("showroomHome.v2.benefits.orders.body"), Icon: ClipboardIcon }] : []),
  ];

  const discoverProducts: DiscoverProduct[] = (catalog?.products ?? []).filter((p): p is DiscoverProduct => Boolean(p.id));
  const pendingJoinRequestsCount = joinRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-sm">
          <p className="truncate text-label text-fg-muted">{greeting}</p>
          <div className="flex items-center gap-1.5">
            <h1 className="text-headline text-fg">{t("showroomHome.v2.title")}</h1>
            {moreAvailable.length > 0 ? (
              <KpiCustomizeDialog
                surface="showroom_suite"
                orgId={org.organizationId}
                availableKeys={moreAvailable.map((entry) => entry.key)}
                initialOrder={moreOrder}
                hasPersonal={layout.hasPersonal}
                hasTeamDefault={layout.hasTeamDefault}
                canManageTeamDefault={caps.includes("org.manage")}
              />
            ) : null}
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-label text-fg-secondary" data-testid="showroom-context">
            <BuildingIcon size={14} />
            <span className="truncate" dir="auto">{[orgName, branchName].filter(Boolean).join(" · ")}</span>
          </p>
        </div>
        {needMetrics ? (
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

      {headline.length > 0 ? (
        <div className="flex flex-col gap-md">
          <KpiCards cards={headline} />
          {moreTiles.length > 0 ? (
            <ExpandCollapse moreLabel={m.common.showMore} lessLabel={m.common.showLess}>
              <StatTiles locale={locale} tiles={moreTiles} layout="grid" columns={6} />
            </ExpandCollapse>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-dashed bg-surface p-lg text-body text-fg-muted" data-testid="showroom-kpis-empty">{t("showroomHome.kpiEmpty")}</p>
      )}

      <NeedsAttentionSection
        overdueFollowUpsCount={overdue.length}
        quotationsAwaitingDecisionCount={quotationsToDecide}
        pendingJoinRequestsCount={pendingJoinRequestsCount}
        canSeeOverdueFollowUps={sells}
        canSeeQuotations={canQuotes}
        canSeeJoinRequests={canManageMembers}
        locale={locale}
        m={m}
      />

      {canCatalog ? (
        <HomeSection
          id="showroom-discover"
          title={t("showroomHome.v2.discover.title")}
          subtitle={t("showroomHome.v2.discover.subtitle")}
          action={<ViewAllLink href={item("catalog").href} label={t("showroomHome.v2.discover.viewAll")} />}
        >
          <DiscoverRail products={discoverProducts} imageUrls={catalog?.imageUrls ?? {}} t={t} href={(id) => `${SHOWROOM_ROOT}/catalog/${encodeURIComponent(id)}`} />
        </HomeSection>
      ) : null}

      {canQuotes || canOrders ? (
        <div className="grid gap-lg desktop:grid-cols-2 [&>*]:min-w-0">
          {canQuotes ? (
            <HomeSection id="showroom-quotes-section" title={t("showroomHome.v2.quotes.title")} action={<ViewAllLink href={item("quotes-received").href} label={t("showroomHome.v2.quotes.viewAll")} />}>
              <IncomingQuotations rows={quotations} locale={locale} t={t} href={(id) => `/b2b/quotations/${encodeURIComponent(id)}`} />
            </HomeSection>
          ) : null}
          {canOrders ? (
            <HomeSection id="showroom-category-section" title={t("showroomHome.v2.category.title")} subtitle={t("showroomHome.v2.category.subtitle", { period: periodLabel })}>
              <CategoryDistribution spend={spend} locale={locale} t={t} periodLabel={periodLabel} />
            </HomeSection>
          ) : null}
        </div>
      ) : null}

      {canRfqs ? (
        <HomeSection
          id="showroom-requests-section"
          title={t("showroomHome.v2.requests.title")}
          subtitle={t("showroomHome.v2.requests.subtitle")}
          action={<ViewAllLink href={item("pricing-requests-sent").href} label={t("showroomHome.v2.requests.viewAll")} />}
        >
          <ActiveRfqs rows={requests} locale={locale} t={t} href={(id) => `/b2b/rfqs/${encodeURIComponent(id)}`} />
        </HomeSection>
      ) : null}

      <HomeSection id="showroom-actions-section" title={t("showroomHome.v2.actions.title")}>
        <QuickActions actions={actions} />
      </HomeSection>

      {benefits.length > 0 ? (
        <HomeSection id="showroom-benefits-section" title={t("showroomHome.v2.benefits.title")}>
          <Benefits items={benefits} />
        </HomeSection>
      ) : null}
    </div>
  );
}
