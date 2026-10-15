import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql } from "./setup";
import { expectImagesLoaded, guardConsole, open, prefs } from "./util";

/**
 * BATCH A - Showroom Home, Browse Products, Product Details, My Products, Saved Products.
 * Signed in as the Cairo Ceramics Showroom owner (a real approved Showroom workspace).
 * Verifies real authorization (the supplier's published product is visible to a Showroom), a
 * successful signed image, and the page interactions - not just that a screen renders.
 */
const SUITE = "/preview/showroom-suite-v2";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, IDENTITIES.showroom);
});

test("A1 Showroom Home renders its workspace without console errors", async ({ page }) => {
  const errors = guardConsole(page);
  await open(page, `${SUITE}/home`);
  await expect(page.locator("main")).toBeVisible();
  // The Home BODY must render its data, not just the shell: the newest published product of
  // another organization is recommended here (a failing query takes this section down).
  await expect(page.getByText(REG.productName).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("A2 Browse Products lists the supplier's published product with a real image", async ({ page }) => {
  const errors = guardConsole(page);
  await open(page, `${SUITE}/catalog`);
  const card = page.getByText(REG.productName).first();
  await expect(card).toBeVisible();
  await expectImagesLoaded(page, "browse");
  expect(errors).toEqual([]);
});

test("A3 Product Details opens from Browse and shows the product", async ({ page }) => {
  const errors = guardConsole(page);
  await open(page, `${SUITE}/catalog`);
  await page.getByText(REG.productName).first().click();
  await page.waitForURL(/\/catalog\/[0-9a-f-]{36}/);
  await expect(page.getByText(REG.productName).first()).toBeVisible();
  await expectImagesLoaded(page, "details");
  expect(errors).toEqual([]);
});

test("A4 My Products (a Showroom's own list) renders", async ({ page }) => {
  const errors = guardConsole(page);
  await open(page, `${SUITE}/my-products`);
  await expect(page.locator("main")).toBeVisible();
  // Another organization's product must never appear in MY products.
  await expect(page.getByText(REG.productName)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("A5 Saved Products: save from Browse and see it under Saved", async ({ page }) => {
  // Saving toggles, so start from "not saved" to keep the test repeatable.
  psql(`delete from public.saved_products where product_id = (select id from public.products where sku = '${REG.productCode}')`);
  const errors = guardConsole(page);
  await open(page, `${SUITE}/catalog`);
  // The save control of THIS product's card (the first card on the page is not necessarily ours).
  const card = page.getByText(REG.productName).first().locator("xpath=ancestor::*[.//button[contains(@aria-label,'ave') or contains(.,'Save')]][1]");
  await card.getByRole("button", { name: /save/i }).first().click();
  await expect(card.getByRole("button", { name: /remove from saved|saved|unsave/i }).first()).toBeVisible();
  await open(page, `${SUITE}/saved`);
  await expect(page.getByText(REG.productName).first()).toBeVisible();
  expect(errors).toEqual([]);
});
