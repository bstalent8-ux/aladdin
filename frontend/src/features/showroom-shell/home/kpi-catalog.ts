import type { ComponentType } from "react";
import {
  BookmarkIcon,
  ClipboardIcon,
  InboxIcon,
  LayersIcon,
  MoneyIcon,
  ScrollIcon,
  SendIcon,
  ShoppingBagIcon,
  TrendingUpIcon,
} from "@/components/ui/icons";
import type { DashboardPeriodKey } from "@/lib/workspace/dashboard-period";
import { SHOWROOM_GROUPS, SHOWROOM_ROOT, canNavigate } from "@/features/showroom-shell/navigation";

/**
 * The showroom suite Home's KPI catalog — the ten cards a showroom (buyer AND
 * seller) sees, in the order they are offered. Mirrors the allowlisted
 * `dashboard_kpi_card_key` values for the `showroom_suite` surface
 * (20261007090001); the database rejects anything not on this list.
 *
 * Client-safe on purpose: the shared customization dialog resolves labels and
 * icons from here, while live values stay a server concern (showroom-home.ts).
 *
 * Direction is part of the card's identity, never inferred:
 *   purchasing = the organization is the REQUESTER of the chain,
 *   sales      = the organization is the SUPPLIER of the chain.
 */
export type ShowroomKpiKey =
  | "open_purchase_requests"
  | "rfqs_sent"
  | "quotes_received"
  | "orders_in_progress"
  | "total_purchases"
  | "customer_rfqs_received"
  | "customer_quotes_sent"
  | "total_sales"
  | "projects"
  | "saved_products";

export type ShowroomKpiDirection = "purchasing" | "sales" | "operations";
/** `now` cards describe what is true right now; `period` cards follow the period selector. */
export type ShowroomKpiBasis = "now" | "period";

export type ShowroomKpiEntry = {
  key: ShowroomKpiKey;
  Icon: ComponentType<{ size?: number }>;
  /** Dotted path into the message catalog for the card's visible label. */
  labelKey: string;
  /** Same label with its direction spelled out — the customization dialog lists cards without their tile hint. */
  dialogLabelKey: string;
  direction: ShowroomKpiDirection;
  basis: ShowroomKpiBasis;
  /** Destination page id under the suite root; availability is that page's own capability gate. */
  page: string;
  /** Safe filter carried to the destination for later reuse. */
  query?: Record<string, string>;
  /**
   * Any-of capabilities the card needs IN ADDITION to its destination page's
   * own gate (org.manage always satisfies it). Used where a shared page (the
   * reports page serves buyers and sellers) would otherwise let a buyer-only
   * member see a seller-side figure.
   */
  requires?: readonly string[];
};

/** Capabilities that make an organization a SELLER in the commerce chain. */
const SELLER_CAPABILITIES = ["rfq.respond", "quote.submit", "order.manage"] as const;

/** Everything the dialog may offer, in the product's canonical order. */
export const SHOWROOM_KPI_CATALOG: readonly ShowroomKpiEntry[] = [
  { key: "open_purchase_requests", Icon: ShoppingBagIcon, labelKey: "showroomHome.kpi.openPurchaseRequests", dialogLabelKey: "showroomHome.kpiDialog.openPurchaseRequests", direction: "purchasing", basis: "now", page: "purchase-requests", query: { status: "open" } },
  { key: "rfqs_sent", Icon: SendIcon, labelKey: "showroomHome.kpi.rfqsSent", dialogLabelKey: "showroomHome.kpiDialog.rfqsSent", direction: "purchasing", basis: "period", page: "pricing-requests-sent" },
  { key: "quotes_received", Icon: InboxIcon, labelKey: "showroomHome.kpi.quotesReceived", dialogLabelKey: "showroomHome.kpiDialog.quotesReceived", direction: "purchasing", basis: "period", page: "quotes-received" },
  { key: "orders_in_progress", Icon: ClipboardIcon, labelKey: "showroomHome.kpi.ordersInProgress", dialogLabelKey: "showroomHome.kpiDialog.ordersInProgress", direction: "purchasing", basis: "now", page: "purchase-orders", query: { status: "active" } },
  { key: "total_purchases", Icon: MoneyIcon, labelKey: "showroomHome.kpi.totalPurchases", dialogLabelKey: "showroomHome.kpiDialog.totalPurchases", direction: "purchasing", basis: "period", page: "purchase-orders" },
  { key: "customer_rfqs_received", Icon: ScrollIcon, labelKey: "showroomHome.kpi.customerRfqsReceived", dialogLabelKey: "showroomHome.kpiDialog.customerRfqsReceived", direction: "sales", basis: "period", page: "customer-rfqs" },
  { key: "customer_quotes_sent", Icon: SendIcon, labelKey: "showroomHome.kpi.customerQuotesSent", dialogLabelKey: "showroomHome.kpiDialog.customerQuotesSent", direction: "sales", basis: "period", page: "customer-quotes" },
  { key: "total_sales", Icon: TrendingUpIcon, labelKey: "showroomHome.kpi.totalSales", dialogLabelKey: "showroomHome.kpiDialog.totalSales", direction: "sales", basis: "period", page: "reports", query: { view: "sales" }, requires: SELLER_CAPABILITIES },
  { key: "projects", Icon: LayersIcon, labelKey: "showroomHome.kpi.projects", dialogLabelKey: "showroomHome.kpiDialog.projects", direction: "operations", basis: "now", page: "projects", query: { status: "active" } },
  { key: "saved_products", Icon: BookmarkIcon, labelKey: "showroomHome.kpi.savedProducts", dialogLabelKey: "showroomHome.kpiDialog.savedProducts", direction: "operations", basis: "now", page: "saved" },
];

/** The first screen: six cards. The rest sit behind "show more" (the production customization behavior). */
export const SHOWROOM_KPI_PRIMARY_COUNT = 6;
export const SHOWROOM_KPI_MAX = SHOWROOM_KPI_CATALOG.length;

/**
 * What a showroom sees before anyone customizes: the balanced six — three per
 * direction pair — first, then the supporting four. Never duplicated elsewhere.
 */
export const SHOWROOM_KPI_DEFAULT_ORDER: readonly ShowroomKpiKey[] = [
  "open_purchase_requests",
  "quotes_received",
  "orders_in_progress",
  "customer_rfqs_received",
  "total_purchases",
  "total_sales",
  "rfqs_sent",
  "customer_quotes_sent",
  "projects",
  "saved_products",
];

const PAGE_ITEMS = new Map(SHOWROOM_GROUPS.flatMap((group) => group.items).map((item) => [item.id, item]));

/**
 * A card is offered only if its destination page is reachable by this caller —
 * the same gate the sidebar and the page itself apply — and any extra
 * direction capability the card declares is held. A KPI can therefore never
 * lead to a 404, a buyer-only member never sees a seller figure, and a
 * hidden-by-capability card can never be re-enabled from a stale saved layout.
 */
export function availableShowroomKpis(capabilities: readonly string[]): ShowroomKpiEntry[] {
  return SHOWROOM_KPI_CATALOG.filter((entry) => {
    const item = PAGE_ITEMS.get(entry.page);
    if (!item || !canNavigate(item, capabilities)) return false;
    if (!entry.requires) return true;
    return capabilities.includes("org.manage") || entry.requires.some((cap) => capabilities.includes(cap));
  });
}

/**
 * The effective, ordered card list: a saved layout (personal → team default →
 * system default, resolved by the query), filtered to what this caller may see,
 * with unknown keys dropped and repeats removed.
 */
export function resolveShowroomKpiOrder(
  saved: readonly string[] | null | undefined,
  available: readonly ShowroomKpiEntry[],
): ShowroomKpiKey[] {
  const allowed = new Set<string>(available.map((entry) => entry.key));
  const source = saved && saved.length > 0 ? saved : SHOWROOM_KPI_DEFAULT_ORDER;
  const seen = new Set<string>();
  const out: ShowroomKpiKey[] = [];
  for (const key of source) {
    if (allowed.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key as ShowroomKpiKey);
    }
  }
  return out;
}

/** Destination for a card, carrying its filter and — for period cards — the same period the Home resolved. */
export function showroomKpiHref(
  entry: ShowroomKpiEntry,
  period: { key: DashboardPeriodKey; from?: string; to?: string },
): string {
  const params = new URLSearchParams(entry.query);
  if (entry.basis === "period") {
    params.set("period", period.key);
    if (period.key === "custom" && period.from && period.to) {
      params.set("from", period.from);
      params.set("to", period.to);
    }
  }
  const qs = params.toString();
  return `${SHOWROOM_ROOT}/${entry.page}${qs ? `?${qs}` : ""}`;
}
