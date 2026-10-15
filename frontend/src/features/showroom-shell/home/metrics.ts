import type { ShowroomKpiKey } from "./kpi-catalog";

/**
 * The shape `showroom_home_metrics` returns, parsed strictly. A missing or
 * non-numeric key is a contract break between the database and the app, so it
 * throws (surfacing the Home's error state) instead of rendering a silent zero
 * that would read as real data.
 */
export const SHOWROOM_METRIC_KEYS = [
  "rfqs_sent",
  "quotes_received",
  "purchase_orders_active",
  "total_purchases",
  "customer_rfqs_received",
  "customer_quotes_sent",
  "total_sales",
  "active_projects",
  "saved_products",
] as const;

export type ShowroomHomeMetrics = Record<(typeof SHOWROOM_METRIC_KEYS)[number], number>;

export function parseShowroomHomeMetrics(raw: unknown): ShowroomHomeMetrics {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("showroom_home_metrics returned an unexpected shape");
  }
  const record = raw as Record<string, unknown>;
  const out = {} as ShowroomHomeMetrics;
  for (const key of SHOWROOM_METRIC_KEYS) {
    const value = Number(record[key]);
    if (record[key] === null || record[key] === undefined || !Number.isFinite(value)) {
      throw new Error(`showroom_home_metrics is missing a numeric "${key}"`);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Two order counts that `showroom_home_metrics` does not carry, read by the application from the same RLS-scoped
 * `order_list` view: orders this organization PLACED that completed inside the period, and orders it placed that
 * are confirmed but not yet started (a "now" figure - it has no period).
 */
export type ShowroomOrderCounts = { completedOrders: number; awaitingExecution: number };

/** Which metric backs each card — the one place a card maps to its live figure. */
export function showroomKpiValue(key: ShowroomKpiKey, metrics: ShowroomHomeMetrics, orders: ShowroomOrderCounts): { value: number; money: boolean } {
  switch (key) {
    case "rfqs_sent": return { value: metrics.rfqs_sent, money: false };
    case "quotes_received": return { value: metrics.quotes_received, money: false };
    case "orders_in_progress": return { value: metrics.purchase_orders_active, money: false };
    case "total_purchases": return { value: metrics.total_purchases, money: true };
    case "customer_rfqs_received": return { value: metrics.customer_rfqs_received, money: false };
    case "customer_quotes_sent": return { value: metrics.customer_quotes_sent, money: false };
    case "total_sales": return { value: metrics.total_sales, money: true };
    case "projects": return { value: metrics.active_projects, money: false };
    case "saved_products": return { value: metrics.saved_products, money: false };
    case "completed_orders": return { value: orders.completedOrders, money: false };
    case "orders_awaiting_execution": return { value: orders.awaitingExecution, money: false };
  }
}
