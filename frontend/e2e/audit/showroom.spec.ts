import { test } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D, DESK_AR_D } from "./audit-util";

/** Existing Showroom commerce evidence (what M4b must extend). One persona, hana: buyer AND seller data. */
const AREA = "existing-showroom-commerce" as const;
const SUITE = "/showroom";
const q = (s: string) => psql(s).trim();

test("S-1 Showroom suite (preview shell) and /b2b commerce screens", async ({ page, request }) => {
  test.setTimeout(900_000);
  const product = q(`select p.id from public.products p join public.organizations o on o.id = p.organization_id where o.name like 'Cairo Ceramics%' and p.deleted_at is null order by p.created_at limit 1`);
  const other = q(`select p.id from public.products p join public.organizations o on o.id = p.organization_id where o.name not like 'Cairo Ceramics%' and p.status = 'published' and p.deleted_at is null order by p.created_at limit 1`);
  const offer = q(`select id from public.product_offers limit 1`);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  const P = "Showroom/Dealer (hana, buyer + seller data)";
  const shots: Array<[string, string, string, boolean?]> = [
    [`${SUITE}/home`, "s01-suite-home", "Showroom suite home"],
    [`${SUITE}/catalog`, "s02-suite-catalog", "Suite catalog"],
    [`${SUITE}/catalog/${other}`, "s03-suite-catalog-detail", "Suite product detail (org seller) with request-quote CTA"],
    [`${SUITE}/offers`, "s04-suite-offers", "Suite offers feed"],
    [`${SUITE}/offers/${offer}`, "s05-suite-offer-detail", "Suite offer detail"],
    [`${SUITE}/my-products`, "s06-suite-my-products", "Suite my products"],
    [`${SUITE}/my-products/new`, "s07-suite-my-products-new", "Suite product form"],
    [`${SUITE}/my-products/${product}/edit`, "s08-suite-my-products-edit", "Suite product edit (images, audiences)"],
    [`${SUITE}/my-offers`, "s09-suite-my-offers", "Suite offers management"],
    [`${SUITE}/my-offers/new`, "s10-suite-my-offers-new", "Suite offer builder"],
    [`${SUITE}/saved`, "s11-suite-saved", "Suite saved products"],
    ["/b2b", "b01-b2b-home", "B2B dashboard"],
    ["/b2b/catalog", "b02-b2b-catalog", "B2B catalog"],
    ["/b2b/rfqs", "b03-b2b-rfqs", "RFQ list (buyer + supplier tabs)"],
    ["/b2b/rfqs/d8000001-0000-4000-8000-000000000001", "b04-b2b-rfq-buyer", "RFQ detail (buyer side)"],
    ["/b2b/rfqs/d2000001-0000-4000-8000-000000000001", "b05-b2b-rfq-supplier", "RFQ detail (supplier side)"],
    ["/b2b/quotations", "b06-b2b-quotations", "Quotations list"],
    ["/b2b/quotations/d3000001-0000-4000-8000-000000000001", "b07-b2b-quotation-supplier", "Quotation detail (supplier editor)"],
    ["/b2b/orders", "b08-b2b-orders", "Orders list"],
    ["/b2b/orders/da000001-0000-4000-8000-000000000001", "b09-b2b-order-buyer", "Order detail (buyer)"],
    ["/b2b/projects", "b10-b2b-projects", "Projects list"],
    ["/b2b/projects/db000001-0000-4000-8000-000000000001", "b11-b2b-project", "Project detail"],
    ["/b2b/products", "b12-b2b-products", "B2B products table"],
    ["/b2b/offers", "b13-b2b-offers", "B2B offers"],
    ["/b2b/saved", "b14-b2b-saved", "B2B saved products"],
    ["/b2b/organization", "b15-b2b-organization", "Organization / people"],
    ["/b2b/settings", "b16-b2b-settings", "Settings"],
    ["/b2b/leads", "b17-b2b-leads", "Sales: leads"],
  ];
  for (const [route, name, state] of shots) {
    await capture(page, route, { area: AREA, name, persona: P, state, data: "real" }, [DESK_EN_L]);
  }
  // mobile Arabic dark for the highest-traffic commerce screens
  for (const [route, name, state] of [shots[1]!, shots[13]!, shots[18]!, shots[7]!]) {
    await capture(page, route, { area: AREA, name, persona: P, state, data: "real" }, [MOB_AR_D]);
  }
  await capture(page, shots[0]![0], { area: AREA, name: shots[0]![1], persona: P, state: shots[0]![2], data: "real" }, [DESK_AR_D]);
});
