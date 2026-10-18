import type { ComponentType } from "react";
import {
  BookmarkIcon,
  CheckIcon,
  ClipboardIcon,
  FileTextIcon,
  ClockIcon,
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
 * The showroom suite Home's KPI catalog — the nine cards a showroom (buyer AND
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
  | "rfqs_sent"
  | "quotes_received"
  | "orders_in_progress"
  | "total_purchases"
  | "customer_rfqs_received"
  | "customer_quotes_sent"
  | "total_sales"
  | "projects"
  | "saved_products"
  | "completed_orders"
  | "orders_awaiting_execution";

export type ShowroomKpiDirection = "purchasing" | "sales" | "operations";
/** `now` cards describe what is true right now; `period` cards follow the period selector. */
export type ShowroomKpiBasis = "now" | "period";

export type ShowroomKpiEntry = {
  key: ShowroomKpiKey;
  Icon: ComponentType<{ size?: number }>;
  /** Dotted path into the message catalog for the card's visible label. */
  labelKey: string;
  /** The "View ..." link at the foot of the card on the Home. */
  linkLabelKey: string;
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

/**
 * There is deliberately NO "open purchase requests" card. A Purchase Request is a
 * distinct procurement need that comes BEFORE an RFQ (purchase request → RFQ sent →
 * quotation received → purchase order); the data model has no such entity yet, and
 * counting RFQs under that name would mislabel a different stage. The card returns
 * when the purchase-request lifecycle exists. The historical enum value stays in
 * the database (removing it would be destructive) but is never offered or rendered.
 */

/** Everything the dialog may offer, in the product's canonical order. */
export const SHOWROOM_KPI_CATALOG: readonly ShowroomKpiEntry[] = [
  { key: "rfqs_sent", Icon: ShoppingBagIcon, labelKey: "showroomHome.kpi.rfqsSent", linkLabelKey: "showroomHome.link.viewRequests", dialogLabelKey: "showroomHome.kpiDialog.rfqsSent", direction: "purchasing", basis: "period", page: "pricing-requests-sent" },
  { key: "quotes_received", Icon: FileTextIcon, labelKey: "showroomHome.kpi.quotesReceived", linkLabelKey: "showroomHome.link.viewQuotations", dialogLabelKey: "showroomHome.kpiDialog.quotesReceived", direction: "purchasing", basis: "period", page: "quotes-received" },
  { key: "orders_in_progress", Icon: ClipboardIcon, labelKey: "showroomHome.kpi.ordersInProgress", linkLabelKey: "showroomHome.link.viewOrders", dialogLabelKey: "showroomHome.kpiDialog.ordersInProgress", direction: "purchasing", basis: "now", page: "purchase-orders", query: { status: "active" } },
  { key: "total_purchases", Icon: MoneyIcon, labelKey: "showroomHome.kpi.totalPurchases", linkLabelKey: "showroomHome.link.viewDetails", dialogLabelKey: "showroomHome.kpiDialog.totalPurchases", direction: "purchasing", basis: "period", page: "purchase-orders" },
  { key: "customer_rfqs_received", Icon: ScrollIcon, labelKey: "showroomHome.kpi.customerRfqsReceived", linkLabelKey: "showroomHome.link.viewRequests", dialogLabelKey: "showroomHome.kpiDialog.customerRfqsReceived", direction: "sales", basis: "period", page: "customer-rfqs" },
  { key: "customer_quotes_sent", Icon: SendIcon, labelKey: "showroomHome.kpi.customerQuotesSent", linkLabelKey: "showroomHome.link.viewQuotations", dialogLabelKey: "showroomHome.kpiDialog.customerQuotesSent", direction: "sales", basis: "period", page: "customer-quotes" },
  { key: "total_sales", Icon: TrendingUpIcon, labelKey: "showroomHome.kpi.totalSales", linkLabelKey: "showroomHome.link.viewDetails", dialogLabelKey: "showroomHome.kpiDialog.totalSales", direction: "sales", basis: "period", page: "reports", query: { view: "sales" }, requires: SELLER_CAPABILITIES },
  { key: "projects", Icon: LayersIcon, labelKey: "showroomHome.kpi.projects", linkLabelKey: "showroomHome.link.viewProjects", dialogLabelKey: "showroomHome.kpiDialog.projects", direction: "operations", basis: "now", page: "projects", query: { status: "active" } },
  { key: "completed_orders", Icon: CheckIcon, labelKey: "showroomHome.kpi.completedOrders", linkLabelKey: "showroomHome.link.viewOrders", dialogLabelKey: "showroomHome.kpiDialog.completedOrders", direction: "purchasing", basis: "period", page: "purchase-orders", query: { status: "completed" } },
  { key: "orders_awaiting_execution", Icon: ClockIcon, labelKey: "showroomHome.kpi.ordersAwaitingExecution", linkLabelKey: "showroomHome.link.viewOrders", dialogLabelKey: "showroomHome.kpiDialog.ordersAwaitingExecution", direction: "purchasing", basis: "now", page: "purchase-orders", query: { status: "confirmed" } },
  { key: "saved_products", Icon: BookmarkIcon, labelKey: "showroomHome.kpi.savedProducts", linkLabelKey: "showroomHome.link.viewSaved", dialogLabelKey: "showroomHome.kpiDialog.savedProducts", direction: "operations", basis: "now", page: "saved" },
];

/** The first screen: six cards. The rest sit behind "show more" (the production customization behavior). */
export const SHOWROOM_KPI_PRIMARY_COUNT = 5;
export const SHOWROOM_KPI_MAX = SHOWROOM_KPI_CATALOG.length;

/**
 * What a showroom sees before anyone customizes: the five cards of the approved Home reference, in its
 * reading order. Every other card is one tap away in "تخصيص بطاقات المؤشرات". A card the caller may not see is
 * simply absent - never replaced by a different figure.
 */
export const SHOWROOM_KPI_DEFAULT_ORDER: readonly ShowroomKpiKey[] = [
  "total_purchases",
  "orders_awaiting_execution",
  "completed_orders",
  "quotes_received",
  "rfqs_sent",
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

/**
 * Destination for a card: the destination page's own href (a V2 page or a finished module the shell frames),
 * carrying the card's filter and - for period cards - the same period the Home resolved.
 */
export function showroomKpiHref(
  entry: ShowroomKpiEntry,
  period: { key: DashboardPeriodKey; from?: string; to?: string },
): string {
  const base = PAGE_ITEMS.get(entry.page)?.href ?? `${SHOWROOM_ROOT}/${entry.page}`;
  const [path, existing] = base.split("?");
  const params = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(entry.query ?? {})) params.set(k, v);
  if (entry.basis === "period") {
    params.set("period", period.key);
    if (period.key === "custom" && period.from && period.to) {
      params.set("from", period.from);
      params.set("to", period.to);
    }
  }
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}
