import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "../regression/setup";
import { prefs } from "../regression/util";
import { capture, shot, DESK_EN_L, DESK_AR_D, MOB_AR_D, MOB_EN_L } from "./audit-util";

/** M4a evidence: the independent publishing screen, its states, and whether anything links to it. */
test.describe.configure({ mode: "serial" });

const AREA = "m4a-independent-publishing" as const;
const run = Date.now().toString(36);
const PRO = `aud-pro-${run}@example.test`;
const ENG = `aud-eng-${run}@example.test`;
const PRODUCT = `Aud Pro Tile ${run}`;
const SUITE = "/showroom";
const q = (s: string) => psql(s).trim();
const setGate = (on: boolean) => psql(`update public.platform_flags set enabled = ${on} where key = 'independent_commerce'`);
let publisherId = "";
let productId = "";

async function decide(vid: string) {
  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("review_start", { p_verification_id: vid })).error).toBeNull();
  const r = await admin.rpc("review_approve", { p_verification_id: vid, p_grant_public_listing: false });
  expect(r.error, r.error?.message).toBeNull();
}
const pubUi = (page: import("@playwright/test").Page) => page.setViewportSize({ width: 1440, height: 900 });

test.beforeAll(() => {
  setGate(false);
  createSyntheticUser(PRO, "contractor");
  createSyntheticUser(ENG, "engineer");
  psql(`insert into public.profiles (user_id, display_name) select id, 'Aud Pro ${run}' from auth.users where email in ('${PRO}','${ENG}') on conflict do nothing`);
});
test.afterAll(() => setGate(false));

test("M4a-1 can-request state and the request dialog; pending state", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  await capture(page, "/home", { area: AREA, name: "01-contractor-home", persona: "Independent Contractor (personal, no org)", state: "Personal home: is there any path to independent publishing?", data: "real" }, [DESK_EN_L]);
  const links = await page.locator("a[href*='independent-publishing']").count();
  console.log("LINKS_TO_INDEPENDENT_PUBLISHING_FROM_HOME", links);
  await page.goto("/home/independent-publishing");
  await page.waitForLoadState("load");
  await shot(page, { area: AREA, name: "02-can-request", locale: "en", theme: "light", persona: "Independent Contractor", state: "Publishing area before any request", data: "real" });
  await page.getByRole("button", { name: "Request publishing approval" }).click();
  await shot(page, { area: AREA, name: "03-request-dialog", locale: "en", theme: "light", persona: "Independent Contractor", state: "Request approval dialog", data: "real" });
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("publishing-pending_review")).toBeVisible({ timeout: 20_000 });
  await capture(page, "/home/independent-publishing", { area: AREA, name: "04-pending-review", persona: "Independent Contractor", state: "Pending review", data: "real" }, [DESK_EN_L, MOB_AR_D]);
});

test("M4a-2 approved: empty products, add product dialog, draft, published", async ({ page, request }) => {
  await decide(q(`select id from public.verifications where verification_type = 'independent_publisher' and status = 'submitted' and user_id = (select id from auth.users where email = '${PRO}')`));
  publisherId = q(`select id from public.publishers where user_id = (select id from auth.users where email = '${PRO}')`);
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  await capture(page, "/home/independent-publishing", { area: AREA, name: "05-approved-empty", persona: "Approved independent Contractor", state: "Approved, no products, 'not shown to other people yet' note", data: "real" }, [DESK_EN_L, DESK_AR_D]);
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await page.goto("/home/independent-publishing");
  await page.getByRole("button", { name: "Add product" }).click();
  await shot(page, { area: AREA, name: "06-add-product-dialog", locale: "en", theme: "light", persona: "Approved independent Contractor", state: "Add product dialog (name, code, category, unit, price, audiences)", data: "real" });
  await page.getByLabel("Product name").fill(PRODUCT);
  await page.getByLabel("Product code").fill(`AUD-${run}`);
  await page.getByLabel("Category").click();
  await page.getByRole("option", { name: "Wallpaper" }).click();
  await page.getByLabel("Price (EGP)").fill("250");
  await page.getByLabel("Showroom", { exact: true }).check();
  await page.getByRole("button", { name: "Add product" }).last().click();
  const row = page.getByTestId("ind-product-draft").filter({ hasText: PRODUCT });
  await expect(row).toBeVisible({ timeout: 20_000 });
  productId = q(`select id from public.products where name = '${PRODUCT}'`);
  await shot(page, { area: AREA, name: "07-product-draft", locale: "en", theme: "light", persona: "Approved independent Contractor", state: "Product list: one draft; actions limited to Publish (no edit / images / audiences / offers)", data: "real" });
  const actions = await row.getByRole("button").allInnerTexts();
  console.log("DRAFT_ROW_ACTIONS", JSON.stringify(actions), "LINKS_IN_ROW", await row.locator("a").count());
  await row.getByRole("button", { name: "Publish" }).click();
  await shot(page, { area: AREA, name: "08-publish-confirm", locale: "en", theme: "light", persona: "Approved independent Contractor", state: "Publish confirmation", data: "real" });
  await page.getByRole("button", { name: "Publish" }).last().click();
  await expect(page.getByTestId("ind-product-published").filter({ hasText: PRODUCT })).toBeVisible({ timeout: 20_000 });
  await capture(page, "/home/independent-publishing", { area: AREA, name: "09-product-published", persona: "Approved independent Contractor", state: "Published product (still private while gate is closed)", data: "real" }, [DESK_EN_L, { ...MOB_AR_D, fullPage: true }]);
});

test("M4a-3 where does an independent professional land in the existing product / offer management screens?", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  for (const [i, route] of ["/b2b/products", "/b2b/offers", `${SUITE}/my-products`, `${SUITE}/my-offers`, `${SUITE}/my-offers/new`, "/b2b/rfqs", "/b2b/orders", "/b2b/quotations"].entries()) {
    const res = await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    const fp = new URL(page.url()).pathname;
    console.log("PRO_ROUTE", route, "->", res?.status(), fp);
    await shot(page, { area: AREA, name: `10-pro-route-${i}`, locale: "en", theme: "light", persona: "Approved independent Contractor", state: `Direct visit to ${route} (final path ${fp})`, data: "real" });
  }
});

test("M4a-4 buyer sees the independent product with the gate opened (isolated test): no request action", async ({ page, request }) => {
  setGate(true);
  try {
    await prefs(page, { locale: "en", theme: "light" });
    await pubUi(page);
    await signIn(page, request, IDENTITIES.showroom);
    await capture(page, `${SUITE}/catalog/${productId}`, { area: AREA, name: "11-buyer-independent-detail", persona: "Showroom buyer (hana); gate opened in isolated test only", state: "Independent product detail: 'requests not available yet' note, no quote button", data: "real" }, [DESK_EN_L, MOB_AR_D]);
    await expect(page.getByTestId("independent-no-request")).toBeVisible();
    await capture(page, `${SUITE}/catalog`, { area: AREA, name: "12-buyer-catalog-with-independent", persona: "Showroom buyer; gate open (isolated)", state: "Catalog list including the independent product", data: "real" }, [DESK_EN_L]);
  } finally {
    setGate(false);
  }
  await capture(page, `${SUITE}/catalog/${productId}`, { area: AREA, name: "13-buyer-gate-closed", persona: "Showroom buyer; gate CLOSED", state: "Same URL with the gate closed (default): not found", data: "empty-state" }, [DESK_EN_L]);
});

test("M4a-5 suspended and revoked states", async ({ page, request }) => {
  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("publisher_suspend", { p_publisher_id: publisherId, p_reason: "Under investigation" })).error).toBeNull();
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  await capture(page, "/home/independent-publishing", { area: AREA, name: "14-suspended", persona: "Suspended independent Contractor", state: "Suspended: reason shown, no write controls, product list hidden", data: "real" }, [DESK_EN_L, MOB_AR_D]);
  expect((await admin.rpc("publisher_revoke", { p_publisher_id: publisherId, p_reason: "Fraud" })).error).toBeNull();
  await capture(page, "/home/independent-publishing", { area: AREA, name: "15-revoked", persona: "Revoked independent Contractor", state: "Revoked: reason shown, may request again", data: "real" }, [DESK_EN_L]);
});

test("M4a-6 Engineer eligibility and non-eligible persona", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await signIn(page, request, ENG, /\/(home|b2b)(\/|$)/);
  await capture(page, "/home/independent-publishing", { area: AREA, name: "16-engineer-can-request", persona: "Independent Engineer", state: "Engineer persona can request publishing approval", data: "real" }, [DESK_EN_L]);
});

test("M4a-7 a personal consumer has no independent publishing", async ({ page, request }) => {
  await prefs(page, { locale: "en", theme: "light" });
  await pubUi(page);
  await signIn(page, request, "consumer@example.test", /\/(home|b2b|onboarding)(\/|$)/);
  await capture(page, "/home/independent-publishing", { area: AREA, name: "17-consumer-not-eligible", persona: "Personal consumer", state: "Direct visit by a non-eligible persona", data: "empty-state" }, [DESK_EN_L]);
  void MOB_EN_L;
});
