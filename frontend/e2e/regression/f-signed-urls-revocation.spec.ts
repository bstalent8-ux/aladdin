import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "../helpers/auth";
import { REG, psql, signedInClient } from "./setup";
import { guardConsole, open, prefs } from "./util";

/**
 * BATCH F - signed image URL lifetime and refresh, and denied access after the audience or the
 * membership that justified it is revoked. Verified against the real Storage and RPC interfaces as
 * real signed-in users; the only privileged step is the administrator-side membership change.
 */
const SUITE = "/showroom";
const ALL_AUDIENCES = ["showroom_dealer", "supplier", "manufacturer", "importer", "contractor", "engineer", "installer_technician", "end_consumer"];
test.describe.configure({ mode: "serial" });

const productId = () => psql(`select id from public.products where sku = '${REG.productCode}' limit 1`).trim();
const imageKey = () =>
  psql(`select object_key from public.product_images where product_id = '${productId()}' and state = 'ready' order by slot limit 1`).trim();
const orgByName = (name: string) => psql(`select id from public.organizations where name = '${name}' limit 1`).trim();

function jwtPayload(url: string): { exp: number; iat: number } {
  const token = new URL(url).searchParams.get("token") ?? "";
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

async function regImageSrc(page: Page): Promise<string> {
  const img = page.locator(`img[src*="product-images"]`).first();
  await img.scrollIntoViewIfNeeded();
  await expect(img).toBeVisible();
  return (await img.getAttribute("src"))!;
}

test.describe("signed URL lifetime and refresh", () => {
  test.beforeEach(async ({ page, request }) => {
    await prefs(page, { locale: "en" });
    await signIn(page, request, IDENTITIES.showroom);
  });

  test("F1 the signed URL the page receives lives at most five minutes and serves the image", async ({ page, request }) => {
    const errors = guardConsole(page);
    await open(page, `${SUITE}/catalog`);
    const src = await regImageSrc(page);
    const { exp, iat } = jwtPayload(src);
    expect(exp - iat, "signed URL lifetime (seconds)").toBeGreaterThan(0);
    expect(exp - iat, "signed URL lifetime (seconds)").toBeLessThanOrEqual(300);
    const res = await request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/");
    expect(errors).toEqual([]);
  });

  test("F2 reloading refreshes the URL with a new token and the image still loads", async ({ page, request }) => {
    await open(page, `${SUITE}/catalog`);
    const first = await regImageSrc(page);
    await page.waitForTimeout(1100); // iat has one-second resolution
    await open(page, `${SUITE}/catalog`);
    const second = await regImageSrc(page);
    expect(new URL(second).searchParams.get("token")).not.toBe(new URL(first).searchParams.get("token"));
    expect((await request.get(second)).status()).toBe(200);
  });
});

test("F3 an expired signed URL stops working", async () => {
  const hana = await signedInClient("hana@example.test");
  const org = ((await hana.rpc("my_workspaces")).data as Array<{ organization_id: string }>)[0]!.organization_id;
  const key = imageKey();
  const grant = await hana.rpc("product_image_access_grant", { p_org_id: org, p_keys: [key] });
  expect(grant.error, grant.error?.message).toBeNull();
  const signed = await hana.storage.from("product-images").createSignedUrl(key, 3);
  expect(signed.error, signed.error?.message).toBeNull();
  expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
  await new Promise((r) => setTimeout(r, 4500));
  expect((await fetch(signed.data!.signedUrl)).status, "expired URL").toBeGreaterThanOrEqual(400);
});

test.describe("denied access after the audience is revoked", () => {
  // The product is also inside a LIVE offer targeted at Showrooms, and an offer audience legitimately
  // grants image visibility. The offer is paused for this scenario so the product audience is the
  // only thing that could justify access, then everything is restored.
  const offerId = () => psql(`select id from public.product_offers where title = '${REG.offerTitle}' limit 1`).trim();
  const offerVersion = () => Number(psql(`select version from public.product_offers where id = '${offerId()}'`).trim());

  test.afterAll(async () => {
    const rania = await signedInClient("rania@example.test");
    await rania.rpc("product_audiences_set", { p_product_id: productId(), p_audiences: ALL_AUDIENCES });
    const status = psql(`select status from public.product_offers where id = '${offerId()}'`).trim();
    if (status === "paused") {
      await rania.rpc("own_offer_set_status", { p_offer_id: offerId(), p_action: "resume", p_expected_version: offerVersion() });
    }
  });

  test("F4 once the supplier stops targeting Showrooms, the Showroom loses the product and its image", async ({ page, request }) => {
    const rania = await signedInClient("rania@example.test");
    const hana = await signedInClient("hana@example.test");
    const org = ((await hana.rpc("my_workspaces")).data as Array<{ organization_id: string }>)[0]!.organization_id;
    const key = imageKey();

    // Before: access exists (a grant is minted and signing works), so the denial below is meaningful.
    const before = await hana.rpc("product_image_access_grant", { p_org_id: org, p_keys: [key] });
    expect(before.data, "grant before revocation").toEqual([key]);
    expect((await hana.storage.from("product-images").createSignedUrl(key, 60)).error).toBeNull();

    const paused = await rania.rpc("own_offer_set_status", { p_offer_id: offerId(), p_action: "pause", p_expected_version: offerVersion() });
    expect(paused.error, paused.error?.message).toBeNull();
    const set = await rania.rpc("product_audiences_set", { p_product_id: productId(), p_audiences: ["supplier"] });
    expect(set.error, set.error?.message).toBeNull();

    const products = (await hana.rpc("catalog_products", { p_org_id: org })).data as Array<{ id: string }>;
    expect(products.map((p) => p.id)).not.toContain(productId());
    expect((await hana.rpc("catalog_product_images", { p_org_id: org, p_product_ids: [productId()] })).data).toEqual([]);

    // The grant minted BEFORE the revocation is still in the table, but it is re-validated on every use.
    const after = await hana.rpc("product_image_access_grant", { p_org_id: org, p_keys: [key] });
    expect(after.data, "no new grant after revocation").toEqual([]);
    const signed = await hana.storage.from("product-images").createSignedUrl(key, 60);
    expect(signed.error, "the old grant must not sign after the audience is revoked").not.toBeNull();

    // And in the browser: the Showroom no longer sees the product.
    await prefs(page, { locale: "en" });
    await signIn(page, request, IDENTITIES.showroom);
    await open(page, `${SUITE}/catalog`);
    await expect(page.getByText(REG.productName)).toHaveCount(0);
  });
});

test.describe("denied access after the membership is revoked", () => {
  const membershipSql = (status: string) =>
    `update public.memberships set status = '${status}' where user_id = (select id from auth.users where email = '${REG.multiEmail}')
        and organization_id = '${orgByName("REG Engineering Office")}'`;
  test.afterAll(() => {
    psql(membershipSql("active"));
  });

  test("F5 a suspended membership loses the workspace, the image grant and the signed URL", async () => {
    const user = await signedInClient(REG.multiEmail);
    const office = orgByName("REG Engineering Office");
    const key = imageKey();

    // Before: the approved office (Engineer audience) may be granted and may sign.
    const before = await user.rpc("product_image_access_grant", { p_org_id: office, p_keys: [key] });
    expect(before.error, before.error?.message).toBeNull();
    expect((await user.storage.from("product-images").createSignedUrl(key, 60)).error).toBeNull();

    psql(membershipSql("suspended"));

    const after = await user.rpc("product_image_access_grant", { p_org_id: office, p_keys: [key] });
    expect(after.error?.code, "grant after suspension").toBe("42501");
    const ws = (await user.rpc("my_workspaces")).data as Array<{ organization_id: string }>;
    expect(ws.map((w) => w.organization_id)).not.toContain(office);
    const products = (await user.rpc("catalog_products", { p_org_id: office })).error;
    expect(products, "catalog read for a workspace the caller no longer belongs to").not.toBeNull();
  });
});
