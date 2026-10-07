import { describe, expect, it } from "vitest";
import { SHOWROOM_METRIC_KEYS, parseShowroomHomeMetrics, showroomKpiValue } from "./metrics";
import { SHOWROOM_KPI_CATALOG } from "./kpi-catalog";

const full = Object.fromEntries(SHOWROOM_METRIC_KEYS.map((k, i) => [k, i + 1]));

describe("showroom_home_metrics parsing", () => {
  it("parses a complete payload, including numeric strings from jsonb numerics", () => {
    const parsed = parseShowroomHomeMetrics({ ...full, total_sales: "565500.00" });
    expect(parsed.total_sales).toBe(565500);
    expect(parsed.rfqs_sent).toBe(full.rfqs_sent);
  });

  it.each([null, undefined, "x", 3, []])("rejects a non-object payload (%s)", (raw) => {
    expect(() => parseShowroomHomeMetrics(raw)).toThrow(/unexpected shape/);
  });

  it.each(SHOWROOM_METRIC_KEYS)("rejects a payload missing %s instead of rendering a silent zero", (key) => {
    const rest: Record<string, number> = { ...full };
    delete rest[key];
    expect(() => parseShowroomHomeMetrics(rest)).toThrow(key);
  });

  it("rejects a non-numeric figure", () => {
    expect(() => parseShowroomHomeMetrics({ ...full, total_purchases: "lots" })).toThrow(/total_purchases/);
  });
});

describe("card -> figure mapping keeps directions apart", () => {
  const metrics = parseShowroomHomeMetrics(full);
  const value = (key: (typeof SHOWROOM_KPI_CATALOG)[number]["key"]) => showroomKpiValue(key, metrics);

  it("reads purchasing cards from the purchasing figures", () => {
    expect(value("open_purchase_requests").value).toBe(metrics.open_purchase_requests);
    expect(value("rfqs_sent").value).toBe(metrics.rfqs_sent);
    expect(value("quotes_received").value).toBe(metrics.quotes_received);
    expect(value("orders_in_progress").value).toBe(metrics.purchase_orders_active);
    expect(value("total_purchases")).toEqual({ value: metrics.total_purchases, money: true });
  });

  it("reads sales cards from the sales figures", () => {
    expect(value("customer_rfqs_received").value).toBe(metrics.customer_rfqs_received);
    expect(value("customer_quotes_sent").value).toBe(metrics.customer_quotes_sent);
    expect(value("total_sales")).toEqual({ value: metrics.total_sales, money: true });
  });

  it("never maps two cards to the same figure", () => {
    const seen = SHOWROOM_KPI_CATALOG.map((e) => value(e.key).value);
    expect(new Set(seen).size).toBe(SHOWROOM_KPI_CATALOG.length);
  });

  it("formats only the two totals as money", () => {
    const money = SHOWROOM_KPI_CATALOG.filter((e) => value(e.key).money).map((e) => e.key).sort();
    expect(money).toEqual(["total_purchases", "total_sales"]);
  });
});
