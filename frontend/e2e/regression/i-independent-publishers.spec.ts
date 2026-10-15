import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { createSyntheticUser, psql, signedInClient } from "./setup";
import { expectNoHorizontalOverflow, guardConsole, open, prefs } from "./util";

/**
 * BATCH I - M4a independent publishers, through the real screens and the real Storage / RPC interfaces.
 *   approval is Admin-only; ownership is the professional, never an organization;
 *   independent content is invisible to buyers until the platform gate is opened (isolated test only);
 *   suspension / revocation withdraws content and refuses new image signatures.
 * The gate (platform_flags.independent_commerce) is opened only inside H4/H5 and ALWAYS closed again.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const PRO = `reg-ind-${run}@example.test`;
const PRODUCT = `Ind Tile ${run}`;
const SUITE = "/showroom";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const q = (sql: string) => psql(sql).trim();
const setGate = (on: boolean) => psql(`update public.platform_flags set enabled = ${on} where key = 'independent_commerce'`);
let publisherId = "";
let productId = "";
let imageKey = "";

async function decide(verificationId: string) {
  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("review_start", { p_verification_id: verificationId })).error).toBeNull();
  const r = await admin.rpc("review_approve", { p_verification_id: verificationId, p_grant_public_listing: false });
  expect(r.error, r.error?.message).toBeNull();
}

test.beforeAll(() => {
  setGate(false);
  createSyntheticUser(PRO, "contractor");
  psql(`insert into public.profiles (user_id, display_name) select id, 'Ind Pro ${run}' from auth.users where email = '${PRO}' on conflict do nothing`);
});
test.afterAll(() => {
  setGate(false);
});

test("I1 an independent Contractor requests approval; nothing can be published before it", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);
  await open(page, "/home/independent-publishing");
  await expect(page.getByTestId("publishing-can_request")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add product" })).toHaveCount(0);
  await page.getByRole("button", { name: "Request publishing approval" }).click();
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("publishing-pending_review")).toBeVisible({ timeout: 20_000 });
  expect(q(`select count(*) from public.verifications where verification_type = 'independent_publisher' and status = 'submitted'
              and user_id = (select id from auth.users where email = '${PRO}')`)).toBe("1");
  expect(q(`select count(*) from public.publishers where user_id = (select id from auth.users where email = '${PRO}')`)).toBe("0");
  // the database refuses a forged identity and an unapproved write
  const pro = await signedInClient(PRO);
  const forged = await pro.rpc("publisher_product_create", {
    p_publisher_id: "00000000-0000-4000-8000-000000000000", p_name: "Nope", p_code: "N-1", p_category_code: "wallpaper", p_unit: "roll",
  });
  expect(forged.error?.code).toBe("42501");
  expect(errors).toEqual([]);
});

test("I2 after Admin approval the professional manages products under their own name", async ({ page, request }) => {
  const vid = q(`select id from public.verifications where verification_type = 'independent_publisher' and status = 'submitted'
                   and user_id = (select id from auth.users where email = '${PRO}')`);
  await decide(vid);
  await prefs(page, { locale: "en" });
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  await open(page, "/home/independent-publishing");
  await expect(page.getByTestId("publishing-active")).toBeVisible();
  await expect(page.getByText("not shown to other people yet", { exact: false })).toBeVisible();
  publisherId = q(`select id from public.publishers where user_id = (select id from auth.users where email = '${PRO}')`);
  expect(q(`select kind from public.publishers where id = '${publisherId}'`)).toBe("independent_contractor");
  expect(q(`select organization_id is null from public.publishers where id = '${publisherId}'`)).toBe("t");

  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Product name").fill(PRODUCT);
  await page.getByLabel("Product code").fill(`IND-${run}`);
  await page.getByLabel("Category").click();
  await page.getByRole("option", { name: "Wallpaper" }).click();
  await page.getByLabel("Price (EGP)").fill("250");
  await page.getByLabel("Showroom", { exact: true }).check();
  await page.getByRole("button", { name: "Add product" }).last().click();
  const row = page.getByTestId("ind-product-draft").filter({ hasText: PRODUCT });
  await expect(row).toBeVisible({ timeout: 20_000 });
  productId = q(`select id from public.products where name = '${PRODUCT}'`);
  expect(q(`select publisher_id = '${publisherId}' and organization_id is null from public.products where id = '${productId}'`)).toBe("t");

  await row.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Publish" }).last().click();
  await expect(page.getByTestId("ind-product-published").filter({ hasText: PRODUCT })).toBeVisible({ timeout: 20_000 });

  // a real Storage upload through the publisher-authorized path
  const pro = await signedInClient(PRO);
  const key = await pro.rpc("product_image_request_upload", { p_product_id: productId, p_content_type: "image/png" });
  expect(key.error, key.error?.message).toBeNull();
  imageKey = key.data as string;
  expect(imageKey.startsWith(publisherId)).toBe(true);
  const up = await pro.storage.from("product-images").upload(imageKey, PNG, { contentType: "image/png" });
  expect(up.error, up.error?.message).toBeNull();
  expect((await pro.rpc("product_image_confirm_upload", { p_object_key: imageKey })).error).toBeNull();
  expect((await pro.storage.from("product-images").createSignedUrl(imageKey, 60)).error).toBeNull();
  // another professional cannot write to it
  const other = await signedInClient("youssef@example.test");
  expect((await other.rpc("product_image_request_upload", { p_product_id: productId, p_content_type: "image/png" })).error?.code).toBe("42501");
});

test("I3 with the gate closed a buyer cannot discover, open, save or sign the independent product", async ({ page, request }) => {
  const hana = await signedInClient("hana@example.test");
  const org = ((await hana.rpc("my_workspaces")).data as Array<{ organization_id: string }>)[0]!.organization_id;
  expect(((await hana.rpc("catalog_products", { p_org_id: org })).data as Array<{ id: string }>).map((p) => p.id)).not.toContain(productId);
  expect((await hana.rpc("product_image_access_grant", { p_org_id: org, p_keys: [imageKey] })).data).toEqual([]);
  expect((await hana.storage.from("product-images").createSignedUrl(imageKey, 60)).error).not.toBeNull();
  expect((await hana.rpc("save_product", { p_organization_id: org, p_product_id: productId })).error?.code).toBe("P0002");
  expect((await hana.from("product_prices").select("product_id").eq("product_id", productId)).data ?? []).toEqual([]);

  await prefs(page, { locale: "en" });
  await signIn(page, request, IDENTITIES.showroom);
  await open(page, `${SUITE}/catalog`);
  await expect(page.getByText(PRODUCT)).toHaveCount(0);
  await page.goto(`${SUITE}/catalog/${productId}`);
  await page.waitForLoadState("load");
  // not-found streams after the shell, so judge the page content rather than the first status line
  await expect(page.getByText(PRODUCT)).toHaveCount(0);
  await expect(page.getByTestId("independent-no-request")).toHaveCount(0);
});

test("I4 with the gate opened (isolated test) an eligible buyer sees the professional - and no request action", async ({ page, request }) => {
  setGate(true);
  try {
    const hana = await signedInClient("hana@example.test");
    const org = ((await hana.rpc("my_workspaces")).data as Array<{ organization_id: string }>)[0]!.organization_id;
    const grant = await hana.rpc("product_image_access_grant", { p_org_id: org, p_keys: [imageKey] });
    expect(grant.data).toEqual([imageKey]);
    expect((await hana.storage.from("product-images").createSignedUrl(imageKey, 60)).error).toBeNull();

    await prefs(page, { locale: "en" });
    await signIn(page, request, IDENTITIES.showroom);
    const errors = guardConsole(page);
    await open(page, `${SUITE}/catalog/${productId}`);
    await expect(page.getByText(PRODUCT).first()).toBeVisible();
    await expect(page.getByTestId("independent-no-request")).toBeVisible();
    await expect(page.getByRole("button", { name: /request (a )?quote/i })).toHaveCount(0);
    expect(errors).toEqual([]);

    // suspension withdraws the content and refuses NEW signatures, even with the gate open
    const admin = await signedInClient("admin@example.test");
    const s = await admin.rpc("publisher_suspend", { p_publisher_id: publisherId, p_reason: "Under investigation" });
    expect(s.error, s.error?.message).toBeNull();
    expect(((await hana.rpc("catalog_products", { p_org_id: org })).data as Array<{ id: string }>).map((p) => p.id)).not.toContain(productId);
    expect((await hana.rpc("product_image_access_grant", { p_org_id: org, p_keys: [imageKey] })).data).toEqual([]);
    expect((await hana.storage.from("product-images").createSignedUrl(imageKey, 60)).error).not.toBeNull();
    expect(q(`select status from public.products where id = '${productId}'`)).toBe("draft");
    expect(q(`select count(*) from public.products where id = '${productId}' and deleted_at is null`)).toBe("1");
  } finally {
    setGate(false);
  }
});

test("I5 a suspended professional sees their history and cannot write; revocation allows a fresh request", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  await open(page, "/home/independent-publishing");
  await expect(page.getByTestId("publishing-suspended")).toBeVisible();
  await expect(page.getByTestId("publishing-reason")).toContainText("Under investigation");
  await expect(page.getByRole("button", { name: "Add product" })).toHaveCount(0);
  const pro = await signedInClient(PRO);
  const w = await pro.rpc("product_image_request_upload", { p_product_id: productId, p_content_type: "image/png" });
  expect(w.error?.code).toBe("42501");

  const admin = await signedInClient("admin@example.test");
  expect((await admin.rpc("publisher_revoke", { p_publisher_id: publisherId, p_reason: "Fraud" })).error).toBeNull();
  await open(page, "/home/independent-publishing");
  await expect(page.getByTestId("publishing-revoked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request publishing approval" })).toBeVisible();
});

test("I6 a person who is not a Contractor/Engineer has no independent publishing", async ({ page, request }) => {
  await prefs(page, { locale: "en" });
  await signIn(page, request, IDENTITIES.consumer, /\/(home|b2b|onboarding)(\/|$)/);
  await page.goto("/home/independent-publishing");
  await page.waitForLoadState("load");
  await expect(page.getByTestId("independent-publishing")).toHaveCount(0);
});

test("I7 the professional area renders in Arabic, dark, 390px with no overflow", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prefs(page, { locale: "ar", theme: "dark" });
  await signIn(page, request, PRO, /\/(home|b2b)(\/|$)/);
  const errors = guardConsole(page);
  await open(page, "/home/independent-publishing");
  await expect(page.getByTestId("independent-publishing")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await expectNoHorizontalOverflow(page, "independent publishing @390 ar dark");
  expect(errors).toEqual([]);
});
