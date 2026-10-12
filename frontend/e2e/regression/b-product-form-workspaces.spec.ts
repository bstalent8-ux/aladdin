import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql } from "./setup";
import { expectImagesLoaded, guardConsole, open, prefs } from "./util";

/**
 * BATCH B - Create/Edit Product, target audiences, product images, workspace switching.
 * The Showroom owner (hana) exercises the product form on the Showroom suite; the synthetic
 * multi-organization engineer (two APPROVED organizations + one PENDING application) exercises
 * workspace switching and proves a pending application is never a workspace in the browser either.
 */
const SUITE = "/preview/showroom-suite-v2";
test.describe.configure({ mode: "serial" });

const AUDIENCE_LABELS = ["Showroom", "Supplier", "Manufacturer", "Importer", "Contractor", "Engineer", "Craftsman", "End customer"];

test.describe("showroom product form", () => {
  test.beforeEach(async ({ page, request }) => {
    await prefs(page, { locale: "en" });
    await signIn(page, request, IDENTITIES.showroom);
  });

  test("B1 Create Product offers exactly the eight canonical audiences (no Sales Team)", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, `${SUITE}/my-products/new`);
    const body = await page.locator("main").innerText();
    for (const label of AUDIENCE_LABELS) expect(body, label).toContain(label);
    expect(body).not.toMatch(/sales team/i);
    expect(errors).toEqual([]);
  });

  test("B2 Edit Product loads the saved product with its image manager", async ({ page }) => {
    const errors = guardConsole(page);
    const id = psql(`select id from public.products where sku = '${REG.ownCode}' limit 1`).trim();
    await open(page, `${SUITE}/my-products/${id}/edit`);
    await expect(page.locator("main")).toContainText(REG.ownName);
    await expect(page.getByTestId("image-manager")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("B3 uploading a product image works end to end and the signed image loads", async ({ page }) => {
    const errors = guardConsole(page);
    const id = psql(`select id from public.products where sku = '${REG.ownCode}' limit 1`).trim();
    await open(page, `${SUITE}/my-products/${id}/edit`);
    const before = await page.getByTestId("image-slots").locator("img").count();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.getByTestId("image-input").setInputFiles({ name: "second.png", mimeType: "image/png", buffer: png });
    await expect.poll(async () => page.getByTestId("image-slots").locator("img").count(), { timeout: 30_000 }).toBeGreaterThan(before);
    await expectImagesLoaded(page, "after upload");
    expect(errors).toEqual([]);
  });
});

test.describe("workspace switching (two approved organizations, one pending application)", () => {
  test.beforeEach(async ({ page, request }) => {
    await prefs(page, { locale: "en" });
    await signIn(page, request, REG.multiEmail, /\/(b2b|home)(\/|$)/);
  });

  test("B4 the switcher lists approved organizations only, with a link to the applications page", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, "/b2b");
    await page.getByTestId("workspace-switcher").first().click();
    const menu = page.getByRole("menu").first();
    await expect(menu).toContainText("REG Engineering Office");
    await expect(menu).toContainText("REG Import House");
    await expect(menu).not.toContainText("REG Pending Supply");
    await expect(menu.getByRole("menuitem", { name: /organization applications/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("B5 the applications page separates approved organizations from the pending application", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, "/business/applications");
    await expect(page.getByTestId("not-a-workspace-note")).toBeVisible();
    // Two approved organizations can each be opened; the pending application has no such control.
    await expect(page.getByRole("button", { name: /open workspace/i })).toHaveCount(2);
    await expect(page.getByTestId("application-pending_review")).toContainText("REG Pending Supply");
    await expect(page.getByTestId("application-blocked")).toBeVisible();
    await expect(page.getByRole("link", { name: /add another organization/i })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("B6 a forged workspace cookie naming the pending organization never makes it active", async ({ page, context }) => {
    const pendingId = psql(`select id from public.organizations where name = 'REG Pending Supply' limit 1`).trim();
    await context.addCookies([{ name: "aladdin-org", value: pendingId, url: "http://127.0.0.1" }]);
    const errors = guardConsole(page);
    await open(page, "/b2b");
    const header = await page.locator("header").first().innerText();
    expect(header).not.toContain("REG Pending Supply");
    expect(header).toMatch(/REG (Engineering Office|Import House)/);
    expect(errors).toEqual([]);
  });

  test("B7 switching to the second approved organization changes the active workspace", async ({ page }) => {
    await open(page, "/b2b");
    await page.getByTestId("workspace-switcher").first().click();
    await page.getByRole("menuitem", { name: /REG Import House/ }).click();
    await expect(page.locator("header").first()).toContainText("REG Import House", { timeout: 20_000 });
  });
});
