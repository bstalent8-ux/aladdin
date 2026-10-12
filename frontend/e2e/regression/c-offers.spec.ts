import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, signedInClient } from "./setup";
import { expectImagesLoaded, guardConsole, open, prefs } from "./util";

/**
 * BATCH C - Offers Feed, Offer Details, My Offers, Create/Edit Offers.
 * The supplier's published offer targets Showrooms only: a Showroom sees it (with a real signed
 * image); an organization of another type does not, proven against the database interface itself.
 */
const SUITE = "/preview/showroom-suite-v2";
test.describe.configure({ mode: "serial" });

const AUDIENCE_GROUPS = ["Showroom", "Supplier", "Manufacturer", "Importer", "Contractor", "Engineer", "Craftsman", "End customer"];

test.describe("showroom viewer", () => {
  test.beforeEach(async ({ page, request }) => {
    await prefs(page, { locale: "en" });
    await signIn(page, request, IDENTITIES.showroom);
  });

  test("C1 Offers Feed shows the targeted offer with a real image", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, `${SUITE}/offers`);
    await expect(page.getByText(REG.offerTitle).first()).toBeVisible();
    await expectImagesLoaded(page, "offers feed");
    expect(errors).toEqual([]);
  });

  test("C2 Offer Details opens from the feed and shows the offer", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, `${SUITE}/offers`);
    // The details link of THIS offer's card (the feed may list other offers first).
    const card = page.getByText(REG.offerTitle).first().locator("xpath=ancestor::*[.//a[contains(@href,'/offers/')]][1]");
    await card.locator("a[href*='/offers/']").first().click();
    await page.waitForURL(/\/offers\/[0-9a-f-]{36}/);
    await expect(page.getByText(REG.offerTitle).first()).toBeVisible();
    await expectImagesLoaded(page, "offer details");
    expect(errors).toEqual([]);
  });

  test("C3 My Offers renders for the Showroom's own workspace", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, `${SUITE}/my-offers`);
    await expect(page.locator("main")).toBeVisible();
    // The supplier's offer is not the Showroom's own.
    await expect(page.getByText(REG.offerTitle)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("C4 Create Offer offers the eight canonical audience groups (no Sales Team)", async ({ page }) => {
    const errors = guardConsole(page);
    await open(page, `${SUITE}/my-offers/new`);
    const body = await page.locator("main").innerText();
    for (const label of AUDIENCE_GROUPS) expect(body, label).toContain(label);
    expect(body).not.toMatch(/sales team/i);
    expect(errors).toEqual([]);
  });

  test("C5 a Showroom cannot open an edit page for another organization's offer", async ({ page }) => {
    const id = process.env.REG_OFFER_ID;
    expect(id, "REG_OFFER_ID from setup").toBeTruthy();
    const res = await page.goto(`${SUITE}/my-offers/${id}/edit`, { waitUntil: "domcontentloaded" });
    // Either an explicit not-found or a redirect away; never the edit form for someone else's offer.
    const body = await page.locator("body").innerText();
    expect(res?.status() === 404 || !/offer name/i.test(body) || page.url().includes("/my-offers/") === false).toBeTruthy();
    await expect(page.getByText(REG.offerTitle)).toHaveCount(0);
  });
});

test.describe("audience enforcement through the database interface", () => {
  test("C6 an Engineering Office workspace does not receive the Showroom-targeted offer", async () => {
    const user = await signedInClient(REG.multiEmail);
    const ws = (await user.rpc("my_workspaces")).data as Array<{ organization_id: string; name: string; is_approved: boolean }>;
    const office = ws.find((w) => w.name === "REG Engineering Office")!;
    const feed = (await user.rpc("offers_feed", { p_org_id: office.organization_id })).data as Array<{ title?: string }>;
    expect(feed.map((o) => o.title)).not.toContain(REG.offerTitle);
  });

  test("C7 the pending organization has no offer audience at all", async () => {
    const user = await signedInClient(REG.multiEmail);
    const ws = (await user.rpc("my_workspaces")).data as Array<{ organization_id: string; name: string; is_approved: boolean }>;
    const pending = ws.find((w) => w.name === "REG Pending Supply")!;
    expect(pending.is_approved).toBe(false);
    const feed = (await user.rpc("offers_feed", { p_org_id: pending.organization_id })).data as unknown[];
    expect(feed).toEqual([]);
  });
});
