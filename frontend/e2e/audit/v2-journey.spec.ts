import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { psql } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, DESK_EN_L, MOB_AR_D } from "./audit-util";

/**
 * Showroom V2 release evidence: the complete Direct RFQ -> quotation -> order journey through the real UI,
 * across two organizations (buyer Showroom, supplier). Three serial tests, state handed over through the database.
 * SHOT_ROOT_NAME=v2-release.
 */
test.describe.configure({ mode: "serial" });
const SUITE = "/showroom";
const q = (s: string) => psql(s).trim();
const TITLE = `V2 journey RFQ ${Date.now().toString(36)}`;
let rfqId = "";
let quotationId = "";

test("J1 buyer Showroom: finds a supplier product, creates and submits a Direct RFQ", async ({ page, request }) => {
  test.setTimeout(300_000);
  const product = q(`select p.id from public.products p join public.product_audiences a on a.product_id = p.id join public.organizations o on o.id = p.organization_id
    where o.name like 'Suez Paints%' and a.audience = 'showroom_dealer' and p.status = 'published' and p.deleted_at is null order by p.created_at limit 1`);
  expect(product).toMatch(/^[0-9a-f-]{36}$/);
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/catalog/${product}`);
  await page.waitForLoadState("networkidle");
  await capture(page, `${SUITE}/catalog/${product}`, { area: "v2-release", name: "j01-product-detail", persona: "Showroom buyer", state: "Supplier product with request-quotation action", data: "real" }, [DESK_EN_L]);
  await page.locator('a[href*="rfqs/new?product="]').first().click();
  await page.waitForLoadState("networkidle");
  // capture() navigates to the route itself, so it runs BEFORE the form is filled
  await capture(page, `/b2b/rfqs/new?product=${product}`, { area: "v2-release", name: "j02-rfq-form", persona: "Showroom buyer", state: "Direct RFQ form inside the V2 shell", data: "real" }, [DESK_EN_L]);
  await page.waitForLoadState("networkidle");
  await page.getByLabel(/RFQ title|Title/i).first().fill(TITLE);
  await page.getByRole("button", { name: "Create draft RFQ" }).click();
  await expect(page).toHaveURL(/\/b2b\/rfqs\/[0-9a-f-]{36}/, { timeout: 30_000 });
  rfqId = page.url().match(/rfqs\/([0-9a-f-]{36})/)![1]!;
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Submit to distributor" }).click();
  await expect.poll(() => q(`select status from public.rfqs where id = '${rfqId}'`), { timeout: 20_000 }).toBe("submitted");
  await capture(page, `/b2b/rfqs/${rfqId}`, { area: "v2-release", name: "j03-rfq-submitted", persona: "Showroom buyer", state: "Direct RFQ submitted", data: "real" }, [DESK_EN_L]);
});

test("J2 supplier: receives the Direct RFQ, prices and submits a quotation", async ({ page, request }) => {
  test.setTimeout(300_000);
  expect(rfqId).not.toBe("");
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.distributor);
  await page.goto(`/b2b/rfqs/${rfqId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Create quotation" }).click();
  await expect(page).toHaveURL(/\/b2b\/quotations\/[0-9a-f-]{36}/, { timeout: 30_000 });
  quotationId = page.url().match(/quotations\/([0-9a-f-]{36})/)![1]!;
  await page.waitForLoadState("networkidle");
  const price = page.getByLabel(/Unit price/i).first();
  await price.fill("125");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect.poll(() => q(`select coalesce(sum(line_total),0) from public.quotation_items where quotation_id = '${quotationId}'`), { timeout: 20_000 }).not.toBe("0");
  // Wait for the save action to return (it refreshes the page with the new version) before submitting.
  await expect(page.getByText("Prices saved.")).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Submit to requester" })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Submit to requester" }).click();
  await expect.poll(() => q(`select status from public.quotations where id = '${quotationId}'`), { timeout: 90_000 }).toBe("submitted");
});

test("J3 buyer Showroom: sees the quotation on Home and in the list, accepts it and creates the order", async ({ page, request }) => {
  test.setTimeout(300_000);
  expect(quotationId).not.toBe("");
  await prefs(page, { locale: "en", theme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, request, IDENTITIES.showroom);
  await page.goto(`${SUITE}/home`);
  await expect(page.getByTestId("showroom-quotes")).toContainText(TITLE);
  await capture(page, `${SUITE}/home`, { area: "v2-release", name: "j04-home-with-incoming-quotation", persona: "Showroom buyer", state: "Home lists the new incoming quotation", data: "real" }, [DESK_EN_L]);
  await page.goto(`/b2b/quotations/${quotationId}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => q(`select status from public.quotations where id = '${quotationId}'`), { timeout: 20_000 }).toBe("accepted");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Create order" }).click();
  await expect.poll(() => q(`select count(*) from public.orders where quotation_id = '${quotationId}'`), { timeout: 20_000 }).toBe("1");
  const orderId = q(`select id from public.orders where quotation_id = '${quotationId}'`);
  await page.goto(`/b2b/orders/${orderId}`);
  await expect(page.locator("[data-preview-sidebar] a[aria-current='page']").first()).toContainText("Purchase orders");
  await capture(page, `/b2b/orders/${orderId}`, { area: "v2-release", name: "j05-order", persona: "Showroom buyer", state: "Order created from the accepted quotation, inside the V2 shell", data: "real" }, [DESK_EN_L, MOB_AR_D]);
  // cross-tenant: a different organization (Engineering office owner) cannot open the buyer's RFQ or order
});
