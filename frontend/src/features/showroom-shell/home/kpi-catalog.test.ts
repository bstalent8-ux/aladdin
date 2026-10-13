import { SHOWROOM_GROUPS } from "@/features/showroom-shell/navigation";
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
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";

const entry = (key: ShowroomKpiKey) => SHOWROOM_KPI_CATALOG.find((e) => e.key === key)!;
const labelOf = (key: ShowroomKpiKey) =>
  SHOWROOM_KPI_CATALOG.find((e) => e.key === key)!.labelKey.split(".").pop() as keyof typeof ar.showroomHome.kpi;
const keys = (caps: string[]) => availableShowroomKpis(caps).map((e) => e.key);

describe("showroom KPI catalog", () => {
  it("offers exactly the eleven approved cards, once each", () => {
    expect(SHOWROOM_KPI_CATALOG).toHaveLength(11);
    expect(new Set(SHOWROOM_KPI_CATALOG.map((e) => e.key)).size).toBe(11);
    expect(SHOWROOM_KPI_MAX).toBe(11);
  });

  it("never presents RFQs as Purchase Requests (no such entity exists yet)", () => {
    expect(SHOWROOM_KPI_CATALOG.map((e) => e.key)).not.toContain("open_purchase_requests");
    expect(SHOWROOM_KPI_DEFAULT_ORDER as readonly string[]).not.toContain("open_purchase_requests");
    expect(SHOWROOM_KPI_CATALOG.map((e) => e.page)).not.toContain("purchase-requests");
    for (const locale of [ar, en]) {
      const labels = [...Object.values(locale.showroomHome.kpi), ...Object.values(locale.showroomHome.kpiDialog)];
      for (const label of labels) expect(label).not.toMatch(/طلبات شراء|purchase request/i);
    }
  });

  it("defaults to the five cards of the approved Home reference, in its reading order", () => {
    expect([...SHOWROOM_KPI_DEFAULT_ORDER]).toEqual([
      "total_purchases",
      "orders_awaiting_execution",
      "completed_orders",
      "quotes_received",
      "rfqs_sent",
    ]);
    expect(SHOWROOM_KPI_DEFAULT_ORDER.map((k) => ar.showroomHome.kpi[labelOf(k)])).toEqual([
      "إجمالي المشتريات",
      "أوامر بانتظار التنفيذ",
      "أوامر الشراء المكتملة",
      "عروض أسعار واردة",
      "طلبات عروض الأسعار المباشرة",
    ]);
  });

  it("puts five cards on the first screen; every other card is reachable through customization", () => {
    expect(SHOWROOM_KPI_PRIMARY_COUNT).toBe(5);
    expect(SHOWROOM_KPI_DEFAULT_ORDER).toHaveLength(5);
    for (const key of SHOWROOM_KPI_DEFAULT_ORDER) expect(SHOWROOM_KPI_CATALOG.map((e) => e.key)).toContain(key);
  });

  it("keeps purchasing and sales as separate directions", () => {
    const dir = (d: string) => SHOWROOM_KPI_CATALOG.filter((e) => e.direction === d).map((e) => e.key).sort();
    expect(dir("purchasing")).toEqual(
      ["completed_orders", "orders_awaiting_execution", "orders_in_progress", "quotes_received", "rfqs_sent", "total_purchases"].sort(),
    );
    expect(dir("sales")).toEqual(["customer_quotes_sent", "customer_rfqs_received", "total_sales"].sort());
    expect(dir("operations")).toEqual(["projects", "saved_products"].sort());
  });

  it("uses the exact approved Arabic-facing label keys, one per card", () => {
    expect(new Set(SHOWROOM_KPI_CATALOG.map((e) => e.labelKey)).size).toBe(11);
    expect(new Set(SHOWROOM_KPI_CATALOG.map((e) => e.dialogLabelKey)).size).toBe(11);
  });

  it("marks only the totals and flow cards as period-scoped", () => {
    const period = SHOWROOM_KPI_CATALOG.filter((e) => e.basis === "period").map((e) => e.key).sort();
    expect(period).toEqual(
      ["completed_orders", "customer_quotes_sent", "customer_rfqs_received", "quotes_received", "rfqs_sent", "total_purchases", "total_sales"].sort(),
    );
  });
});

describe("KPI destinations", () => {
  const period = { key: "30d" as const };

  it.each([
    ["rfqs_sent", "/b2b/rfqs?period=30d"],
    ["quotes_received", "/b2b/quotations?period=30d"],
    ["orders_in_progress", "/b2b/orders?status=active"],
    ["total_purchases", "/b2b/orders?period=30d"],
    ["customer_rfqs_received", "/b2b/rfqs?view=received&period=30d"],
    ["customer_quotes_sent", "/b2b/quotations?view=sent&period=30d"],
    ["total_sales", "/b2b/reports?view=sales&period=30d"],
    ["projects", "/b2b/projects?status=active"],
    ["saved_products", "/preview/showroom-suite-v2/saved"],
  ] as const)("%s opens %s", (key, href) => {
    expect(showroomKpiHref(entry(key), period)).toBe(href);
  });

  it("carries a custom range to period cards only", () => {
    const custom = { key: "custom" as const, from: "2026-01-01", to: "2026-01-31" };
    expect(showroomKpiHref(entry("rfqs_sent"), custom)).toBe("/b2b/rfqs?period=custom&from=2026-01-01&to=2026-01-31");
    expect(showroomKpiHref(entry("projects"), custom)).toBe("/b2b/projects?status=active");
  });

  it("never links to a hidden placeholder page", () => {
    const hidden = new Set(SHOWROOM_GROUPS.flatMap((g) => g.items).filter((i) => i.hidden).map((i) => i.id));
    for (const e of SHOWROOM_KPI_CATALOG) {
      expect(hidden.has(e.page)).toBe(false);
      expect(showroomKpiHref(e, period)).not.toMatch(/showroom-suite-v2\/(purchase-requests)/);
    }
  });
});

describe("capability behavior", () => {
  it("offers every card to an owner (org.manage)", () => {
    expect(keys(["org.manage"])).toHaveLength(11);
  });

  it("offers nothing to a member with no commerce capability", () => {
    expect(keys([])).toEqual([]);
  });

  it("keeps the buying cards away from a seller-only member", () => {
    const k = keys(["rfq.respond"]);
    expect(k).toEqual(expect.arrayContaining(["customer_rfqs_received", "customer_quotes_sent"]));
    expect(k).not.toContain("rfqs_sent");
    expect(k).not.toContain("quotes_received");
  });

  it("keeps the selling cards away from a buyer-only member", () => {
    const k = keys(["rfq.create"]);
    expect(k).toEqual(expect.arrayContaining(["rfqs_sent", "quotes_received"]));
    expect(k).not.toContain("customer_rfqs_received");
    expect(k).not.toContain("customer_quotes_sent");
  });
});

describe("persisted layout resolution", () => {
  const all = availableShowroomKpis(["org.manage"]);

  it("a caller who may not see one of the five reference cards gets four - never a substitute figure", () => {
    const buyerNoOrders = availableShowroomKpis(["rfq.create"]);
    expect(resolveShowroomKpiOrder(null, buyerNoOrders)).toEqual(["quotes_received", "rfqs_sent"]);
  });

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
