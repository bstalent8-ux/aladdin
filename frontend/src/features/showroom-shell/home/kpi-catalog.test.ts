import { describe, expect, it } from "vitest";
import {
  SHOWROOM_KPI_CATALOG,
  SHOWROOM_KPI_DEFAULT_ORDER,
  SHOWROOM_KPI_MAX,
  SHOWROOM_KPI_PRIMARY_COUNT,
  availableShowroomKpis,
  resolveShowroomKpiOrder,
  showroomKpiHref,
  type ShowroomKpiKey,
} from "./kpi-catalog";

const entry = (key: ShowroomKpiKey) => SHOWROOM_KPI_CATALOG.find((e) => e.key === key)!;
const keys = (caps: string[]) => availableShowroomKpis(caps).map((e) => e.key);

describe("showroom KPI catalog", () => {
  it("offers exactly the ten approved cards, once each", () => {
    expect(SHOWROOM_KPI_CATALOG).toHaveLength(10);
    expect(new Set(SHOWROOM_KPI_CATALOG.map((e) => e.key)).size).toBe(10);
    expect(SHOWROOM_KPI_MAX).toBe(10);
  });

  it("puts six cards on the first screen and the rest behind show more", () => {
    expect(SHOWROOM_KPI_PRIMARY_COUNT).toBe(6);
    expect([...SHOWROOM_KPI_DEFAULT_ORDER].sort()).toEqual(SHOWROOM_KPI_CATALOG.map((e) => e.key).sort());
  });

  it("keeps purchasing and sales as separate directions", () => {
    const dir = (d: string) => SHOWROOM_KPI_CATALOG.filter((e) => e.direction === d).map((e) => e.key).sort();
    expect(dir("purchasing")).toEqual(
      ["open_purchase_requests", "orders_in_progress", "quotes_received", "rfqs_sent", "total_purchases"].sort(),
    );
    expect(dir("sales")).toEqual(["customer_quotes_sent", "customer_rfqs_received", "total_sales"].sort());
    expect(dir("operations")).toEqual(["projects", "saved_products"].sort());
  });

  it("uses the exact approved Arabic-facing label keys, one per card", () => {
    expect(new Set(SHOWROOM_KPI_CATALOG.map((e) => e.labelKey)).size).toBe(10);
    expect(new Set(SHOWROOM_KPI_CATALOG.map((e) => e.dialogLabelKey)).size).toBe(10);
  });

  it("marks only the totals and flow cards as period-scoped", () => {
    const period = SHOWROOM_KPI_CATALOG.filter((e) => e.basis === "period").map((e) => e.key).sort();
    expect(period).toEqual(
      ["customer_quotes_sent", "customer_rfqs_received", "quotes_received", "rfqs_sent", "total_purchases", "total_sales"].sort(),
    );
  });
});

describe("KPI destinations", () => {
  const period = { key: "30d" as const };

  it.each([
    ["open_purchase_requests", "/preview/showroom-suite-v2/purchase-requests?status=open"],
    ["rfqs_sent", "/preview/showroom-suite-v2/pricing-requests-sent?period=30d"],
    ["quotes_received", "/preview/showroom-suite-v2/quotes-received?period=30d"],
    ["orders_in_progress", "/preview/showroom-suite-v2/purchase-orders?status=active"],
    ["total_purchases", "/preview/showroom-suite-v2/purchase-orders?period=30d"],
    ["customer_rfqs_received", "/preview/showroom-suite-v2/customer-rfqs?period=30d"],
    ["customer_quotes_sent", "/preview/showroom-suite-v2/customer-quotes?period=30d"],
    ["total_sales", "/preview/showroom-suite-v2/reports?view=sales&period=30d"],
    ["projects", "/preview/showroom-suite-v2/projects?status=active"],
    ["saved_products", "/preview/showroom-suite-v2/saved"],
  ] as const)("%s opens %s", (key, href) => {
    expect(showroomKpiHref(entry(key), period)).toBe(href);
  });

  it("carries a custom range to period cards only", () => {
    const custom = { key: "custom" as const, from: "2026-01-01", to: "2026-01-31" };
    expect(showroomKpiHref(entry("rfqs_sent"), custom)).toBe(
      "/preview/showroom-suite-v2/pricing-requests-sent?period=custom&from=2026-01-01&to=2026-01-31",
    );
    expect(showroomKpiHref(entry("projects"), custom)).toBe("/preview/showroom-suite-v2/projects?status=active");
  });

  it("only ever links to pages that exist in the suite navigation", () => {
    const ids = new Set(SHOWROOM_KPI_CATALOG.map((e) => e.page));
    for (const id of ids) expect(showroomKpiHref(SHOWROOM_KPI_CATALOG.find((e) => e.page === id)!, period)).toContain(`/${id}`);
  });
});

describe("capability behavior", () => {
  it("offers every card to an owner (org.manage)", () => {
    expect(keys(["org.manage"])).toHaveLength(10);
  });

  it("offers nothing to a member with no commerce capability", () => {
    expect(keys([])).toEqual([]);
  });

  it("keeps the buying cards away from a seller-only member", () => {
    const k = keys(["rfq.respond"]);
    expect(k).toEqual(expect.arrayContaining(["customer_rfqs_received", "customer_quotes_sent"]));
    expect(k).not.toContain("open_purchase_requests");
    expect(k).not.toContain("rfqs_sent");
    expect(k).not.toContain("quotes_received");
  });

  it("keeps the selling cards away from a buyer-only member", () => {
    const k = keys(["rfq.create"]);
    expect(k).toEqual(expect.arrayContaining(["open_purchase_requests", "rfqs_sent", "quotes_received"]));
    expect(k).not.toContain("customer_rfqs_received");
    expect(k).not.toContain("customer_quotes_sent");
  });
});

describe("persisted layout resolution", () => {
  const all = availableShowroomKpis(["org.manage"]);

  it("falls back to the system default when nothing is saved", () => {
    expect(resolveShowroomKpiOrder(null, all)).toEqual([...SHOWROOM_KPI_DEFAULT_ORDER]);
    expect(resolveShowroomKpiOrder([], all)).toEqual([...SHOWROOM_KPI_DEFAULT_ORDER]);
  });

  it("honours a saved order and treats absence as hidden", () => {
    expect(resolveShowroomKpiOrder(["total_sales", "rfqs_sent"], all)).toEqual(["total_sales", "rfqs_sent"]);
  });

  it("drops unknown, repeated, and no-longer-permitted cards from a stale layout", () => {
    const buyerOnly = availableShowroomKpis(["rfq.create"]);
    expect(
      resolveShowroomKpiOrder(["total_sales", "overdue_followups", "rfqs_sent", "rfqs_sent", "quotes_received"], buyerOnly),
    ).toEqual(["rfqs_sent", "quotes_received"]);
  });

  it("returns nothing when no saved card is permitted, rather than another card", () => {
    const buyerOnly = availableShowroomKpis(["rfq.create"]);
    expect(resolveShowroomKpiOrder(["total_sales"], buyerOnly)).toEqual([]);
  });
});
