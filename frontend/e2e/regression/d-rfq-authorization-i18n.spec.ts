import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql, signedInClient } from "./setup";
import { dirOf, guardConsole, open, prefs } from "./util";

/**
 * BATCH D - Direct RFQ, workspace authorization (cross-organization), Arabic RTL and English LTR.
 * Direct RFQ behaviour is unchanged for an APPROVED business and refused for a pending one; a
 * Showroom cannot reach another organization's edit pages; the Showroom suite is closed to a
 * workspace that is not a Showroom.
 */
const SUITE = "/preview/showroom-suite-v2";
test.describe.configure({ mode: "serial" });

const orgIdByName = (name: string) => psql(`select id from public.organizations where name = '${name.replace(/'/g, "''")}' limit 1`).trim();

test("D1 Direct RFQ: an approved Showroom can create one to a supplier", async () => {
  const hana = await signedInClient("hana@example.test");
  const requester = ((await hana.rpc("my_workspaces")).data as Array<{ organization_id: string }>)[0]!.organization_id;
  const supplier = orgIdByName("Suez Paints & Coatings");
  const { data, error } = await hana.rpc("create_rfq", {
    p_requester_org_id: requester,
    p_supplier_org_id: supplier,
    p_title: "REG direct RFQ",
    p_note: null,
    p_required_date: null,
    p_branch_id: null,
  });
  expect(error, error?.message).toBeNull();
  expect(typeof data).toBe("string");
});

test("D2 Direct RFQ: a PENDING organization cannot issue one", async () => {
  const user = await signedInClient(REG.multiEmail);
  const supplier = orgIdByName("Suez Paints & Coatings");
  const { error } = await user.rpc("create_rfq", {
    p_requester_org_id: orgIdByName("REG Pending Supply"),
    p_supplier_org_id: supplier,
    p_title: "REG pending RFQ",
    p_note: null,
    p_required_date: null,
    p_branch_id: null,
  });
  expect(error?.code).toBe("42501");
});

test.describe("browser", () => {
  test.beforeEach(async ({ page }) => {
    await prefs(page, { locale: "en" });
  });

  test("D3 the RFQ screens render for the Showroom", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.showroom);
    const errors = guardConsole(page);
    await open(page, "/b2b/rfqs");
    await expect(page.locator("main")).toBeVisible();
    await open(page, "/b2b/rfqs/new");
    await expect(page.locator("main")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("D4 a Showroom cannot open another organization's product edit page", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.showroom);
    const id = process.env.REG_PRODUCT_ID;
    expect(id, "REG_PRODUCT_ID from setup").toBeTruthy();
    await page.goto(`${SUITE}/my-products/${id}/edit`, { waitUntil: "domcontentloaded" });
    // The supplier's product must never appear as an editable record of the Showroom.
    await expect(page.getByTestId("image-manager")).toHaveCount(0);
    await expect(page.getByText(REG.productName)).toHaveCount(0);
  });

  test("D5 the business suite is closed to a personal consumer account", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.consumer, /\/(home|b2b)(\/|$)/);
    await page.goto(`${SUITE}/catalog`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    expect(page.url()).not.toContain("/preview/showroom-suite-v2/catalog");
    await expect(page.getByText(REG.productName)).toHaveCount(0);
  });

  test("D6 English is LTR and Arabic is RTL on the same page, with the same product", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.showroom);
    await open(page, `${SUITE}/catalog`);
    expect(await dirOf(page)).toBe("ltr");
    await expect(page.getByText(REG.productName).first()).toBeVisible();

    await prefs(page, { locale: "ar" });
    await open(page, `${SUITE}/catalog`);
    expect(await dirOf(page)).toBe("rtl");
    await expect(page.getByText(REG.productName).first()).toBeVisible();
  });

  test("D7 the applications page renders RTL in Arabic with translated status text", async ({ page, request }) => {
    await prefs(page, { locale: "ar" });
    await signIn(page, request, REG.multiEmail, /\/(b2b|home)(\/|$)/);
    await open(page, "/business/applications");
    expect(await dirOf(page)).toBe("rtl");
    await expect(page.getByRole("heading", { name: "مؤسساتي وطلباتي" })).toBeVisible();
    await expect(page.getByText("قيد المراجعة").first()).toBeVisible();
  });
});
